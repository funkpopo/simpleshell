use crate::connect::*;
use crate::ops::*;
use crate::protocol::*;
use crate::watch::*;
use core_protocol::service::Input;
use netutil::NetworkPath;
use openssh_sftp_client::Sftp;
use russh::Disconnect;
use std::time::Instant;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};

pub async fn run_sftp_request(mut input: Input) -> Result<(), String> {
    let stage_started_at = Instant::now();
    let mut payload = String::new();
    input
        .read_to_string(&mut payload)
        .await
        .map_err(|error| format!("failed to read request: {error}"))?;

    let envelope: SftpEnvelope = match serde_json::from_str(payload.trim()) {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(
                None,
                None,
                SIDECAR_PROCESS_TYPE,
                &format!("failed to parse request: {error}"),
                None,
            )?;
            return Ok(());
        }
    };
    let operation = envelope.request.operation.clone();
    let request_id = envelope.request.request_id.as_deref();
    let parsed_operation = match SftpOperation::parse(&operation) {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(
                Some(&operation),
                request_id,
                SIDECAR_PROCESS_TYPE,
                &error,
                None,
            )?;
            return Ok(());
        }
    };
    let _schema_version = envelope
        .request
        .schema_version
        .or(envelope.schema_version)
        .unwrap_or(SIDECAR_SCHEMA_VERSION);

    let network_path = resolve_network_path(&envelope.config);
    let _ = emit_stage(
        request_id,
        "requestStarted",
        stage_started_at.elapsed().as_millis() as u64,
    );

    let (sftp, handle) = match connect_sftp(&envelope.config, request_id, &stage_started_at).await {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(
                Some(&operation),
                request_id,
                SIDECAR_PROCESS_TYPE,
                &error,
                Some(&network_path),
            )?;
            return Ok(());
        }
    };
    let _ = emit_stage(
        request_id,
        "operationStarted",
        stage_started_at.elapsed().as_millis() as u64,
    );
    let result = execute_request(&sftp, &envelope.request, parsed_operation).await;
    let _ = emit_stage(
        request_id,
        "operationCompleted",
        stage_started_at.elapsed().as_millis() as u64,
    );

    let close_result = sftp.close().await.map_err(|error| error.to_string());
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;

    if let Err(error) = close_result {
        if result.is_ok() {
            emit_error_result(
                Some(&operation),
                request_id,
                SIDECAR_PROCESS_TYPE,
                &error,
                Some(&network_path),
            )?;
            return Ok(());
        }
    }

    match result {
        Ok(value) => emit_result(Some(&operation), request_id, value, Some(&network_path))?,
        Err(error) => emit_error_result(
            Some(&operation),
            request_id,
            SIDECAR_PROCESS_TYPE,
            &error,
            Some(&network_path),
        )?,
    }
    Ok(())
}

/// Serve multiple SFTP requests over one SSH/SFTP connection.
///
/// The first line is the normal `{config, request}` envelope. Subsequent lines
/// contain only `SftpRequest` objects and are correlated by requestId. Requests
/// are deliberately processed serially: this keeps the SFTP client/channel
/// state predictable while still allowing progress events to be flushed after
/// every transfer chunk.
pub async fn run_sftp_session(input: Input) -> Result<(), String> {
    let mut lines = input.lines();
    let first_line = lines
        .next_line()
        .await
        .map_err(|error| format!("failed to read session request: {error}"))?
        .ok_or_else(|| "SFTP session ended before initialization".to_string())?;
    let envelope: SftpEnvelope = match serde_json::from_str(first_line.trim()) {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(
                None,
                None,
                SIDECAR_PROCESS_TYPE,
                &format!("failed to parse session envelope: {error}"),
                None,
            )?;
            return Ok(());
        }
    };

    let network_path = resolve_network_path(&envelope.config);
    let first_request_id = envelope.request.request_id.as_deref();
    let session_started_at = Instant::now();
    let _ = emit_stage(
        first_request_id,
        "requestStarted",
        session_started_at.elapsed().as_millis() as u64,
    );
    let (sftp, handle) =
        match connect_sftp(&envelope.config, first_request_id, &session_started_at).await {
            Ok(value) => value,
            Err(error) => {
                emit_error_result(
                    Some(&envelope.request.operation),
                    first_request_id,
                    SIDECAR_PROCESS_TYPE,
                    &error,
                    Some(&network_path),
                )?;
                return Ok(());
            }
        };

    process_session_request(&sftp, &envelope.request, &network_path, false).await?;

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("failed to read SFTP session request: {error}"))?
    {
        let request: SftpRequest = match serde_json::from_str(line.trim()) {
            Ok(value) => value,
            Err(error) => {
                emit_error_result(
                    None,
                    None,
                    SIDECAR_PROCESS_TYPE,
                    &format!("failed to parse SFTP session request: {error}"),
                    Some(&network_path),
                )?;
                continue;
            }
        };

        if request.operation == "closeSession" {
            break;
        }
        process_session_request(&sftp, &request, &network_path, true).await?;
    }

    let close_result = sftp.close().await.map_err(|error| error.to_string());
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;
    close_result
}

pub(crate) async fn process_session_request(
    sftp: &Sftp,
    request: &SftpRequest,
    network_path: &NetworkPath,
    emit_request_started: bool,
) -> Result<(), String> {
    let operation = request.operation.clone();
    let request_id = request.request_id.as_deref();
    let parsed_operation = match SftpOperation::parse(&operation) {
        Ok(value) => value,
        Err(error) => {
            emit_error_result(
                Some(&operation),
                request_id,
                SIDECAR_PROCESS_TYPE,
                &error,
                Some(network_path),
            )?;
            return Ok(());
        }
    };
    let operation_started_at = Instant::now();
    if emit_request_started {
        let _ = emit_stage(
            request_id,
            "requestStarted",
            operation_started_at.elapsed().as_millis() as u64,
        );
    }
    let _ = emit_stage(
        request_id,
        "operationStarted",
        operation_started_at.elapsed().as_millis() as u64,
    );
    let result = execute_request(sftp, request, parsed_operation).await;
    let _ = emit_stage(
        request_id,
        "operationCompleted",
        operation_started_at.elapsed().as_millis() as u64,
    );

    match result {
        Ok(value) => emit_result(Some(&operation), request_id, value, Some(network_path)),
        Err(error) => emit_error_result(
            Some(&operation),
            request_id,
            SIDECAR_PROCESS_TYPE,
            &error,
            Some(network_path),
        ),
    }
}

pub async fn run_sftp_watch(mut input: Input) -> Result<(), String> {
    let stage_started_at = Instant::now();
    let mut payload = String::new();
    input
        .read_to_string(&mut payload)
        .await
        .map_err(|error| format!("failed to read request: {error}"))?;

    let envelope: SftpEnvelope = match serde_json::from_str(payload.trim()) {
        Ok(value) => value,
        Err(error) => {
            emit_watch_error(
                None,
                None,
                SIDECAR_PROCESS_TYPE,
                &format!("failed to parse request: {error}"),
                None,
            )?;
            return Ok(());
        }
    };
    let operation = envelope.request.operation.clone();
    let request_id = envelope.request.request_id.as_deref();
    let parsed_operation = match SftpOperation::parse(&operation) {
        Ok(value) => value,
        Err(error) => {
            emit_watch_error(
                Some(&operation),
                request_id,
                SIDECAR_PROCESS_TYPE,
                &error,
                None,
            )?;
            return Ok(());
        }
    };

    if parsed_operation != SftpOperation::WatchDirectory {
        emit_watch_error(
            Some(&operation),
            request_id,
            SIDECAR_PROCESS_TYPE,
            &format!(
                "unsupported watch operation: {}",
                envelope.request.operation
            ),
            None,
        )?;
        return Ok(());
    }

    let network_path = resolve_network_path(&envelope.config);

    let _ = emit_stage(
        request_id,
        "requestStarted",
        stage_started_at.elapsed().as_millis() as u64,
    );
    let (sftp, handle) = match connect_sftp(&envelope.config, request_id, &stage_started_at).await {
        Ok(value) => value,
        Err(error) => {
            emit_watch_error(
                Some(&operation),
                request_id,
                SIDECAR_PROCESS_TYPE,
                &error,
                Some(&network_path),
            )?;
            return Ok(());
        }
    };
    let watch_result = watch_directory(&sftp, &envelope.request).await;

    let close_result = sftp.close().await.map_err(|error| error.to_string());
    let _ = handle
        .disconnect(Disconnect::ByApplication, "", "English")
        .await;

    if let Err(error) = watch_result {
        emit_watch_error(
            Some(&operation),
            request_id,
            SIDECAR_PROCESS_TYPE,
            &error,
            Some(&network_path),
        )?;
        return Ok(());
    }
    if let Err(error) = close_result {
        emit_watch_error(
            Some(&operation),
            request_id,
            SIDECAR_PROCESS_TYPE,
            &error,
            Some(&network_path),
        )?;
    }
    Ok(())
}
