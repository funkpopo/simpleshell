//! `pty` driven in-process with the platform shell.

use core_protocol::testing::TestStream;
use serde_json::{json, Value};

fn shell() -> (&'static str, Vec<&'static str>) {
    if cfg!(windows) {
        ("cmd.exe", vec!["/Q"])
    } else {
        ("/bin/sh", vec![])
    }
}

fn open(extra: Value) -> TestStream {
    let (file, args) = shell();
    let stream = TestStream::open(localpty::serve);
    let mut event = json!({"type": "open", "file": file, "args": args, "cols": 100, "rows": 30});
    event
        .as_object_mut()
        .unwrap()
        .extend(extra.as_object().unwrap().clone());
    stream.send(event);
    stream
}

#[tokio::test]
async fn runs_an_interactive_shell_until_it_exits() {
    // `env` replaces the environment, so callers pass all of it.
    let mut env: serde_json::Map<String, Value> = std::env::vars()
        .map(|(name, value)| (name, Value::String(value)))
        .collect();
    env.insert("SIMPLESHELL_PTY_TEST".into(), "marker-42".into());
    let mut pty = open(json!({"env": env}));
    let spawned = pty.event_of("spawned").await;
    assert!(spawned["pid"].as_u64().unwrap() > 0);
    if cfg!(windows) {
        // ConPTY asks for the cursor position first and waits for the
        // answer, as xterm.js gives it in the app.
        pty.stdout_until("[6n").await;
        pty.write("[1;1R");
    }

    // The given environment is used, and input reaches the shell.
    if cfg!(windows) {
        pty.write("echo value=%SIMPLESHELL_PTY_TEST%\r\n");
    } else {
        pty.write("echo value=$SIMPLESHELL_PTY_TEST\n");
    }
    pty.stdout_until("value=marker-42").await;
    pty.send(json!({"type": "resize", "cols": 120, "rows": 40}));
    pty.write(if cfg!(windows) {
        "exit 7\r\n"
    } else {
        "exit 7\n"
    });
    let exit = pty.event_of("exit").await;
    assert_eq!(exit["exitCode"], 7);
}

#[tokio::test]
async fn kill_ends_the_program() {
    let mut pty = open(json!({}));
    pty.event_of("spawned").await;
    pty.send(json!({"type": "kill"}));
    let exit = pty.event_of("exit").await;
    assert_ne!(exit["exitCode"], 0);
}

#[tokio::test]
async fn reports_a_missing_program() {
    let mut pty = TestStream::open(localpty::serve);
    pty.send(json!({"type": "open", "file": "simpleshell-no-such-program"}));
    let error = pty.event().await;
    assert_eq!(error["type"], "error");
    assert_eq!(error["code"], "ENOENT", "{error}");
}
