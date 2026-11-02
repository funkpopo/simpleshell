//! Service registry: every protocol the core can host, by its stable name.
//!
//! The same names work as standalone subcommands (`simpleshell-core zmodem-serve`)
//! and as `open` targets inside the resident core.

use core_protocol::service::Input;

pub const SERVICES: &[&str] = &[
    "ai-serve",
    "checksum-file",
    "diagnostic-echo",
    "ip-query-serve",
    "latency-serve",
    "port-forward-prototype",
    "port-forward-serve",
    "scan-folder",
    "sftp-request",
    "sftp-session",
    "sftp-watch",
    "zmodem-serve",
];

pub fn is_service(name: &str) -> bool {
    SERVICES.contains(&name)
}

pub async fn run(name: &str, args: Vec<String>, input: Input) -> Result<(), String> {
    let args = args.into_iter();
    match name {
        "ai-serve" => auxsvc::ai::serve(input).await,
        "checksum-file" => sftp::run_checksum_file(args).await,
        "diagnostic-echo" => crate::diagnostics::echo(input).await,
        "ip-query-serve" => auxsvc::ip_query::serve(input).await,
        "latency-serve" => auxsvc::latency::serve(input).await,
        "port-forward-prototype" => forward::serve(true, input).await,
        "port-forward-serve" => forward::serve(false, input).await,
        "scan-folder" => sftp::run_scan_folder(args).await,
        "sftp-request" => sftp::run_sftp_request(input).await,
        "sftp-session" => sftp::run_sftp_session(input).await,
        "sftp-watch" => sftp::run_sftp_watch(input).await,
        "zmodem-serve" => zmodem::serve(input).await,
        other => Err(format!("unsupported service: {other}")),
    }
}
