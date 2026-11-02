//! Service registry: every protocol the core can host, by its stable name.
//!
//! The same names work as standalone subcommands (`simpleshell-core zmodem-serve`)
//! and as `open` targets inside the resident core.

use core_protocol::StreamIo;

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
    "ssh-channel",
    "ssh-connection",
    "zmodem-serve",
];

pub fn is_service(name: &str) -> bool {
    SERVICES.contains(&name)
}

pub async fn run(name: &str, args: Vec<String>, io: StreamIo) -> Result<(), String> {
    let args = args.into_iter();
    match name {
        "ai-serve" => auxsvc::ai::serve(io.input).await,
        "checksum-file" => sftp::run_checksum_file(args).await,
        "diagnostic-echo" => crate::diagnostics::echo(io.input).await,
        "ip-query-serve" => auxsvc::ip_query::serve(io.input).await,
        "latency-serve" => auxsvc::latency::serve(io.input).await,
        "port-forward-prototype" => forward::serve(true, io.input).await,
        "port-forward-serve" => forward::serve(false, io.input).await,
        "scan-folder" => sftp::run_scan_folder(args).await,
        "sftp-request" => sftp::run_sftp_request(io.input).await,
        "sftp-session" => sftp::run_sftp_session(io.input).await,
        "sftp-watch" => sftp::run_sftp_watch(io.input).await,
        "ssh-channel" => ssh_session::serve_channel(io).await,
        "ssh-connection" => ssh_session::serve_connection(io).await,
        "zmodem-serve" => zmodem::serve(io.input).await,
        other => Err(format!("unsupported service: {other}")),
    }
}
