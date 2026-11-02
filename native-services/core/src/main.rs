//! `simpleshell-core`: the native process behind SimpleShell.
//!
//! * `simpleshell-core serve [--role core|aux]` runs the resident frame server
//!   used by the Electron supervisor.
//! * `simpleshell-core <service> [args]` runs one service over plain stdio,
//!   which keeps every protocol testable on its own.

mod diagnostics;
mod panic;
mod server;
mod services;

use core_protocol::StreamIo;
use std::env;
use std::process;

fn parse_role(mut args: impl Iterator<Item = String>) -> Result<String, String> {
    let mut role = "core".to_string();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--role" => role = args.next().ok_or("--role requires a value")?,
            other => return Err(format!("unsupported serve argument: {other}")),
        }
    }
    Ok(role)
}

#[tokio::main]
async fn main() {
    panic::install_hook();
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        eprintln!(
            "missing command, expected serve, --version or one of: {}",
            services::SERVICES.join(", ")
        );
        process::exit(1);
    };

    let result = match command.as_str() {
        "serve" => match parse_role(args) {
            Ok(role) => server::serve(role).await,
            Err(error) => Err(error),
        },
        "--version" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        name if services::is_service(name) => {
            services::run(name, args.collect(), StreamIo::stdio()).await
        }
        other => Err(format!("unsupported command: {other}")),
    };

    // Shared SSH connections end with a proper disconnect, not a reset.
    ssh_hub::global().shutdown().await;

    if let Err(error) = result {
        // An empty error means the failure was already reported on stdout.
        if !error.is_empty() {
            eprintln!("{error}");
        }
        process::exit(1);
    }
}
