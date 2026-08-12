mod sidecars;

use std::env;
use std::process;

#[tokio::main]
async fn main() {
    sidecars::file_management::install_panic_hook();
    if let Err(error) = run().await {
        eprintln!("{error}");
        process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let command = args.next().ok_or_else(|| {
        "missing command, expected ai-serve, scan-folder, sftp-request, or sftp-watch".to_string()
    })?;

    match command.as_str() {
        "ai-serve" => sidecars::ai::serve().await,
        "scan-folder" => sidecars::file_management::run_scan_folder(args),
        "sftp-request" => sidecars::file_management::run_sftp_request().await,
        "sftp-watch" => sidecars::file_management::run_sftp_watch().await,
        "--version" => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        other => Err(format!("unsupported command: {other}")),
    }
}
