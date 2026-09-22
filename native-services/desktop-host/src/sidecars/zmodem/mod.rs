//! ZMODEM 终端输出链路 sidecar（Phase 3）。
//!
//! 命令：`zmodem-serve`。协议：NDJSON 控制消息 + Base64 字节载荷
//! （复用宿主已有依赖；Base64 体积/编解码开销由行为契约检查测量）。
//!
//! 职责划分：
//! - Rust：检测、帧校验、转义、握手、重试、取消、有界文件读写、字节归属；
//! - JS：文件选择框、保存策略、国际化、进度节流、IPC、SSH 流背压协调。
//!
//! 字节归属：原始输入中的每个字节最终只能归属终端（`passthrough`）、
//! 协议（`writeRemote`/机器内部缓冲）或待判定缓冲（检测前缀扣留）之一，
//! 不重复透传、不无声丢失。
//!
//! 初始流量限制：单个原始字节块不超过 64 KiB；每会话未处理原始字节预算
//! 2 MiB、恢复水位 1 MiB；全局预算计入 Base64/JSON 开销。超预算发
//! `pause` 事件，由 JS 通过统一流控暂停 SSH 流。
//!
//! 可见行为保持：起始序列前缀空闲冲刷 500 ms、会话空闲超时 45 s。
//! 进度节流（150 ms）由 JS 持有。

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::fs::OpenOptions;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex;
use tokio::time::interval;
use zmodem2::{Action, Event as ZEvent, FileInfo, Position, Receiver, Sender};

const ZMODEM_SCHEMA_VERSION: u32 = 1;
/// 起始序列 "**\x18B0"（42 42 24 66 48）：hex 编码下帧类型在前两字节
/// hex 字符中，'B0' 后的 1 字节才是类型字符（48/49）。
const INTRO_PREFIX: [u8; 5] = [42, 42, 24, 66, 48];
/// 类型字符：48 = ZRQINIT（对端发文件 → 本端下载）、49 = ZRINIT（对端收文件 → 本端上传）。
const ZRQINIT_TYPE: u8 = 48;
const ZRINIT_TYPE: u8 = 49;

const MAX_INPUT_CHUNK_BYTES: usize = 64 * 1024;
const SESSION_BUDGET_BYTES: usize = 2 * 1024 * 1024;
const RESUME_WATERMARK_BYTES: usize = 1024 * 1024;
const GLOBAL_BUDGET_BYTES: usize = 8 * 1024 * 1024;
const FILE_IO_CHUNK_BYTES: usize = 32 * 1024;
const SCAN_TAIL_FLUSH_DELAY_MS: u64 = 500;
const SESSION_INACTIVITY_TIMEOUT_MS: u64 = 45 * 1000;
const WATCHDOG_INTERVAL_MS: u64 = 100;

#[derive(Debug, Deserialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "type"
)]
enum ZmodemInput {
    /// 注册会话（检测模式）。
    Open {
        #[serde(default)]
        request_id: Option<String>,
        session_id: String,
        #[serde(default)]
        generation: Option<u32>,
    },
    /// 原始 SSH 输出字节（有序投递）。
    Input {
        session_id: String,
        #[allow(dead_code)]
        #[serde(default)]
        seq: u64,
        data_base64: String,
    },
    /// wireAck：writeRemote 字节已写入 SSH 流。
    WireAck {
        session_id: String,
        #[allow(dead_code)]
        #[serde(default)]
        n: u64,
    },
    /// 上传文件已由 JS 授予路径。
    SendFiles {
        #[serde(default)]
        request_id: Option<String>,
        session_id: String,
        files: Vec<GrantedFile>,
    },
    /// 下载目标已由 JS 批准。
    AcceptFile {
        #[serde(default)]
        request_id: Option<String>,
        session_id: String,
        path: String,
    },
    Cancel {
        #[serde(default)]
        request_id: Option<String>,
        session_id: String,
    },
    Close {
        #[serde(default)]
        request_id: Option<String>,
        session_id: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrantedFile {
    path: String,
    name: String,
    #[serde(default)]
    size: Option<u64>,
    #[allow(dead_code)]
    #[serde(default)]
    mtime_ms: Option<u64>,
}

enum Machine {
    Receive(Box<Receiver>),
    Send(Box<Sender>),
}

struct UploadFile {
    granted: GrantedFile,
    handle: Option<tokio::fs::File>,
}

struct Session {
    id: String,
    generation: u32,
    /// 检测模式扣留的起始序列前缀字节。
    scan: Vec<u8>,
    scan_since: Option<Instant>,
    /// 传输模式待提交输入（原始字节）。
    pending_input: Vec<u8>,
    machine: Option<Machine>,
    direction: Option<&'static str>,
    paused: bool,
    /// 下载目标（JS 批准后设置）。
    download_target: Option<PathBuf>,
    download_file: Option<tokio::fs::File>,
    awaiting_accept: bool,
    upload_queue: Vec<GrantedFile>,
    upload_active: Option<UploadFile>,
    files_done: u32,
    files_total: Option<u32>,
    finished: bool,
    last_activity: Instant,
}

impl Session {
    fn new(id: String, generation: u32) -> Self {
        Self {
            id,
            generation,
            scan: Vec::new(),
            scan_since: None,
            pending_input: Vec::new(),
            machine: None,
            direction: None,
            paused: false,
            download_target: None,
            download_file: None,
            awaiting_accept: false,
            upload_queue: Vec::new(),
            upload_active: None,
            files_done: 0,
            files_total: None,
            finished: false,
            last_activity: Instant::now(),
        }
    }

    fn unprocessed_bytes(&self) -> usize {
        self.scan.len() + self.pending_input.len()
    }
}

fn emit(value: &Value) -> Result<(), String> {
    let line = serde_json::to_string(value)
        .map_err(|error| format!("failed to serialize zmodem output: {error}"))?;
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(line.as_bytes())
        .map_err(|error| format!("failed to write stdout: {error}"))?;
    stdout
        .write_all(b"\n")
        .map_err(|error| format!("failed to write stdout newline: {error}"))?;
    stdout
        .flush()
        .map_err(|error| format!("failed to flush stdout: {error}"))
}

fn emit_event(session_id: &str, kind: &str, extra: Value) {
    let _ = emit(&json!({
        "type": "event",
        "schemaVersion": ZMODEM_SCHEMA_VERSION,
        "sessionId": session_id,
        "kind": kind,
        "event": extra,
    }));
}

fn emit_error_message(session_id: Option<&str>, message: &str, error_code: &str) {
    let _ = emit(&json!({
        "type": "error",
        "schemaVersion": ZMODEM_SCHEMA_VERSION,
        "sessionId": session_id,
        "errorCode": error_code,
        "errorKind": "protocol",
        "retryable": false,
        "error": message,
    }));
}

/// 在缓冲中查找起始序列（含类型字符校验，与 JS `findZmodemIntro` 一致）。
fn find_intro(buf: &[u8]) -> Option<(usize, u8)> {
    for i in 0..buf.len() {
        if i + INTRO_PREFIX.len() > buf.len() {
            return None;
        }
        if buf[i..i + INTRO_PREFIX.len()] != INTRO_PREFIX {
            continue;
        }
        let next_index = i + INTRO_PREFIX.len();
        if next_index >= buf.len() {
            // 类型字符在后续字节中：等待更多数据（由扣留前缀机制处理）
            return None;
        }
        let intro_type = buf[next_index];
        if intro_type == ZRQINIT_TYPE || intro_type == ZRINIT_TYPE {
            return Some((i, intro_type));
        }
        // 非会话起始帧类型（如 ZSINIT），继续扫描
    }
    None
}

/// 缓冲尾部与起始序列前缀的最长匹配长度（与 JS `introPrefixSuffixLength` 一致）。
fn intro_prefix_suffix_length(buf: &[u8]) -> usize {
    let max_length = buf.len().min(INTRO_PREFIX.len());
    for length in (1..=max_length).rev() {
        if buf[buf.len() - length..] == INTRO_PREFIX[..length] {
            return length;
        }
    }
    0
}

struct SidecarState {
    sessions: HashMap<String, Session>,
}

impl SidecarState {
    fn new() -> Self {
        Self {
            sessions: HashMap::new(),
        }
    }

    fn global_unprocessed(&self) -> usize {
        self.sessions.values().map(Session::unprocessed_bytes).sum()
    }
}

/// 检测模式：扫描起始序列；仅扣留「构成起始序列前缀」的尾部字节。
/// 其余字节立即放行（保持终端输出顺序）；扣留字节空闲 500 ms 后冲刷。
async fn process_detection(session: &mut Session, chunk: &[u8]) {
    session.last_activity = Instant::now();
    let mut combined = std::mem::take(&mut session.scan);
    combined.extend_from_slice(chunk);

    match find_intro(&combined) {
        None => {
            let hold_length = intro_prefix_suffix_length(&combined);
            let out_length = combined.len() - hold_length;
            if hold_length > 0 {
                session.scan = combined[out_length..].to_vec();
                if session.scan_since.is_none() {
                    session.scan_since = Some(Instant::now());
                }
            } else {
                session.scan_since = None;
            }
            if out_length > 0 {
                emit_passthrough(&session.id, &combined[..out_length]);
            }
        }
        Some((index, intro_type)) => {
            // 序列之前的字节照常进入终端；序列及之后交给协议状态机
            let prefix = combined[..index].to_vec();
            let session_input = combined[index..].to_vec();
            if !prefix.is_empty() {
                emit_passthrough(&session.id, &prefix);
            }
            session.scan.clear();
            session.scan_since = None;
            start_session_machine(session, intro_type, session_input).await;
        }
    }
}

async fn start_session_machine(session: &mut Session, intro_type: u8, session_input: Vec<u8>) {
    session.pending_input = session_input;
    match intro_type {
        ZRQINIT_TYPE => {
            // 对端运行 sz：本端接收文件（下载），等待 JS 批准目标路径
            match Receiver::new() {
                Ok(mut receiver) => {
                    receiver.set_manual_file_accept(true);
                    // 丢弃构造时携带的主动 ZRINIT：内容与 ZRQINIT 应答完全一致，
                    // 只在收到 ZRQINIT 后应答一次，避免对端状态机收到重复帧
                    if let Action::WriteWire(bytes) = receiver.poll() {
                        let n = bytes.len();
                        receiver.wire_written(n);
                    }
                    session.machine = Some(Machine::Receive(Box::new(receiver)));
                    session.direction = Some("download");
                }
                Err(error) => {
                    emit_error_message(
                        Some(&session.id),
                        &format!("failed to create zmodem receiver: {error}"),
                        "ZMODEM_MACHINE_START_FAILED",
                    );
                    session.finished = true;
                    return;
                }
            }
        }
        ZRINIT_TYPE => {
            // 对端运行 rz：本端等待 JS 选择上传文件
            match Sender::new() {
                Ok(sender) => {
                    session.machine = Some(Machine::Send(Box::new(sender)));
                    session.direction = Some("upload");
                }
                Err(error) => {
                    emit_error_message(
                        Some(&session.id),
                        &format!("failed to create zmodem sender: {error}"),
                        "ZMODEM_MACHINE_START_FAILED",
                    );
                    session.finished = true;
                    return;
                }
            }
        }
        _ => unreachable!(),
    }

    emit_event(
        &session.id,
        "intro",
        json!({ "direction": session.direction, "generation": session.generation }),
    );
    drive_session(session).await;
}

fn emit_passthrough(session_id: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let _ = emit(&json!({
        "type": "passthrough",
        "schemaVersion": ZMODEM_SCHEMA_VERSION,
        "sessionId": session_id,
        "dataBase64": BASE64_STANDARD.encode(bytes),
    }));
}

fn emit_write_remote(session_id: &str, bytes: &[u8]) {
    if bytes.is_empty() {
        return;
    }
    let _ = emit(&json!({
        "type": "writeRemote",
        "schemaVersion": ZMODEM_SCHEMA_VERSION,
        "sessionId": session_id,
        "dataBase64": BASE64_STANDARD.encode(bytes),
    }));
}

/// 驱动协议状态机：先排空待发字节与事件，Idle 时再提交待处理输入。
/// Receiver::new() 构造时即携带主动 ZRINIT，必须先发出再处理输入。
async fn drive_session(session: &mut Session) {
    let mut guard = 0;
    loop {
        guard += 1;
        if guard > 100_000 || session.finished {
            return;
        }

        // 1. 轮询一个动作（复制字节以释放 machine 借用）
        enum Step {
            WriteWire(Vec<u8>),
            WriteFile(Vec<u8>),
            ReadFile { offset: u32, max_len: usize },
            FileStarted { name: Vec<u8>, size: Option<u32> },
            FileCompleted,
            SessionCompleted,
            Aborted,
            Idle,
        }
        let step = {
            let Some(machine) = session.machine.as_mut() else {
                return;
            };
            let action = match machine {
                Machine::Receive(receiver) => receiver.poll(),
                Machine::Send(sender) => sender.poll(),
            };
            match action {
                Action::WriteWire(bytes) => Step::WriteWire(bytes.to_vec()),
                Action::WriteFile(bytes) => Step::WriteFile(bytes.to_vec()),
                Action::ReadFile { offset, max_len } => Step::ReadFile {
                    offset: offset.get(),
                    max_len,
                },
                Action::Event(event) => match event {
                    ZEvent::FileStarted(info) => Step::FileStarted {
                        name: info.name.to_vec(),
                        size: info.size.map(|position| position.get()),
                    },
                    ZEvent::FileCompleted => Step::FileCompleted,
                    ZEvent::SessionCompleted => Step::SessionCompleted,
                    ZEvent::Aborted => Step::Aborted,
                    _ => return,
                },
                Action::Idle => Step::Idle,
                _ => return,
            }
        };

        // 2. 执行动作（machine 借用已释放）
        match step {
            Step::WriteWire(bytes) => {
                let n = bytes.len();
                emit_write_remote(&session.id, &bytes);
                if let Some(machine) = session.machine.as_mut() {
                    match machine {
                        Machine::Receive(receiver) => receiver.wire_written(n),
                        Machine::Send(sender) => sender.wire_written(n),
                    }
                }
            }
            Step::WriteFile(bytes) => {
                if let Err(error) = handle_write_file(session, &bytes).await {
                    fail_session(session, &format!("zmodem file write failed: {error}"));
                    return;
                }
            }
            Step::ReadFile { offset, max_len } => {
                if let Err(error) = handle_read_file(session, Position::new(offset), max_len).await
                {
                    fail_session(session, &format!("zmodem file read failed: {error}"));
                    return;
                }
            }
            Step::FileStarted { name, size } => {
                handle_file_started(session, &name, size);
                if session.direction == Some("download") {
                    // 下载：等待 JS 批准目标路径（manual accept）
                    return;
                }
            }
            Step::FileCompleted => {
                session.files_done += 1;
                finish_upload_file(session).await;
                emit_event(
                    &session.id,
                    "fileDone",
                    json!({ "filesDone": session.files_done }),
                );
                if session.direction == Some("upload") {
                    // 对端 rz 发出 ZRINIT（准备好下一文件）后触发：
                    // 队列非空则启动下一文件，否则 sender.finish() 发 ZFIN
                    if let Err(error) = start_next_upload_file(session).await {
                        fail_session(session, &format!("upload start failed: {error}"));
                        return;
                    }
                }
            }
            Step::SessionCompleted => {
                // zmodem2 poll 语义：事件优先于待发 wire 字节；接收器对对端
                // ZFIN 的 ZFIN 应答仍留在机器的 outgoing 缓冲中，必须在结束
                // 会话前冲刷，否则真实 sz 会一直等待应答而挂起
                if let Some(machine) = session.machine.as_mut() {
                    loop {
                        let wire_len = {
                            let action = match machine {
                                Machine::Receive(receiver) => receiver.poll(),
                                Machine::Send(sender) => sender.poll(),
                            };
                            let Action::WriteWire(bytes) = action else {
                                break;
                            };
                            emit_write_remote(&session.id, &bytes);
                            bytes.len()
                        };
                        // Rust crate drain_outgoing 不自动推进，
                        // 必须回写长度释放缓冲，否则无限循环
                        match machine {
                            Machine::Receive(receiver) => {
                                receiver.wire_written(wire_len);
                            }
                            Machine::Send(sender) => {
                                sender.wire_written(wire_len);
                            }
                        }
                    }
                }
                emit_event(&session.id, "done", json!({}));
                finish_session(session);
                return;
            }
            Step::Aborted => {
                emit_event(&session.id, "cancelled", json!({}));
                finish_session(session);
                return;
            }
            Step::Idle => {
                // 3. Idle：提交待处理输入；无输入或机器阻塞则返回
                if session.pending_input.is_empty() {
                    return;
                }
                let before_len = session.pending_input.len();
                let Some(machine) = session.machine.as_mut() else {
                    return;
                };
                let result = match machine {
                    Machine::Receive(receiver) => {
                        submit_pending(receiver.as_mut(), &mut session.pending_input)
                    }
                    Machine::Send(sender) => {
                        submit_pending(sender.as_mut(), &mut session.pending_input)
                    }
                };
                if let Err(error) = result {
                    fail_session(session, &format!("zmodem wire error: {error}"));
                    return;
                }
                if session.pending_input.len() == before_len {
                    // 无进展（机器阻塞）：等待 wireAck / 文件数据等外部事件
                    return;
                }
            }
        }
    }
}

fn fail_session(session: &mut Session, message: &str) {
    emit_event(&session.id, "error", json!({ "message": message }));
    finish_session(session);
}

fn finish_session(session: &mut Session) {
    session.finished = true;
    // 归还未消费输入：普通检测模式按确认范围归还；此处会话已结束，
    // 剩余 pending_input 属于 shell 输出，按顺序放行到终端。
    if !session.pending_input.is_empty() {
        let remaining = std::mem::take(&mut session.pending_input);
        emit_passthrough(&session.id, &remaining);
    }
    session.machine = None;
    session.download_file = None;
    session.upload_active = None;
    session.awaiting_accept = false;
}

fn submit_pending(
    machine: &mut dyn ZmodemWire,
    pending: &mut Vec<u8>,
) -> Result<(), zmodem2::Error> {
    loop {
        if pending.is_empty() {
            return Ok(());
        }
        let consumed = machine.submit_wire(pending)?;
        if consumed == 0 {
            // 机器阻塞（等待 wire_written / 文件数据等）：保留未消费字节
            return Ok(());
        }
        pending.drain(..consumed);
    }
}

trait ZmodemWire {
    fn submit_wire(&mut self, input: &[u8]) -> Result<usize, zmodem2::Error>;
}

impl ZmodemWire for Receiver {
    fn submit_wire(&mut self, input: &[u8]) -> Result<usize, zmodem2::Error> {
        Receiver::submit_wire(self, input)
    }
}

impl ZmodemWire for Sender {
    fn submit_wire(&mut self, input: &[u8]) -> Result<usize, zmodem2::Error> {
        Sender::submit_wire(self, input)
    }
}

async fn handle_write_file(session: &mut Session, bytes: &[u8]) -> Result<(), String> {
    if session.download_file.is_none() {
        return Err("no accepted download target".to_string());
    }
    let file = session.download_file.as_mut().unwrap();
    file.write_all(bytes)
        .await
        .map_err(|error| format!("write failed: {error}"))?;
    let n = bytes.len();
    if let Some(Machine::Receive(receiver)) = session.machine.as_mut() {
        receiver
            .file_written(n)
            .map_err(|error| format!("file_written failed: {error}"))?;
    }
    // 进度事件：节流由 JS 负责
    emit_event(
        &session.id,
        "progress",
        json!({ "deltaBytes": n, "direction": "download" }),
    );
    Ok(())
}

async fn handle_read_file(
    session: &mut Session,
    offset: Position,
    max_len: usize,
) -> Result<(), String> {
    let Some(upload) = session.upload_active.as_mut() else {
        return Err("no active upload file".to_string());
    };
    if upload.handle.is_none() {
        let file = tokio::fs::File::open(&upload.granted.path)
            .await
            .map_err(|error| format!("open upload file failed: {error}"))?;
        upload.handle = Some(file);
    }
    let file = upload.handle.as_mut().unwrap();
    let read_len = max_len.min(FILE_IO_CHUNK_BYTES);
    let mut buffer = vec![0u8; read_len];
    file.seek(std::io::SeekFrom::Start(offset.get() as u64))
        .await
        .map_err(|error| format!("seek upload file failed: {error}"))?;
    let n = file
        .read(&mut buffer)
        .await
        .map_err(|error| format!("read upload file failed: {error}"))?;
    if let Some(Machine::Send(sender)) = session.machine.as_mut() {
        sender
            .submit_file(&buffer[..n])
            .map_err(|error| format!("submit_file failed: {error}"))?;
    }
    emit_event(
        &session.id,
        "progress",
        json!({
            "deltaBytes": n,
            "offset": offset.get(),
            "direction": "upload",
            "fileName": upload.granted.name,
        }),
    );
    Ok(())
}

fn handle_file_started(session: &mut Session, name: &[u8], size: Option<u32>) {
    let name_string = String::from_utf8_lossy(name).to_string();
    match session.direction {
        Some("download") => {
            session.awaiting_accept = true;
            session.download_target = None;
            session.download_file = None;
            emit_event(
                &session.id,
                "offer",
                json!({
                    "fileName": name_string,
                    "fileSize": size,
                    "nameBase64": BASE64_STANDARD.encode(name),
                    "awaitingAccept": true,
                }),
            );
        }
        _ => {
            emit_event(
                &session.id,
                "offer",
                json!({ "fileName": name_string, "fileSize": size }),
            );
        }
    }
}

async fn finish_upload_file(session: &mut Session) {
    if let Some(mut upload) = session.upload_active.take() {
        if let Some(file) = upload.handle.take() {
            let _ = file.sync_all().await;
        }
    }
}

/// 会话空闲看门狗：扣留前缀冲刷（500 ms）与会话空闲超时（45 s）。
async fn watchdog(state: Arc<Mutex<SidecarState>>) {
    let mut ticker = interval(Duration::from_millis(WATCHDOG_INTERVAL_MS));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        let mut state = state.lock().await;
        let ids: Vec<String> = state.sessions.keys().cloned().collect();
        let mut changed = false;
        for id in ids {
            let session = state.sessions.get_mut(&id);
            let Some(session) = session else { continue };
            if session.finished {
                continue;
            }
            // 扣留前缀空闲冲刷
            if !session.scan.is_empty() {
                if let Some(since) = session.scan_since {
                    if since.elapsed() >= Duration::from_millis(SCAN_TAIL_FLUSH_DELAY_MS) {
                        let pending = std::mem::take(&mut session.scan);
                        session.scan_since = None;
                        // 扫描尾仅在检测模式下存在；放行到终端
                        emit_passthrough(&session.id, &pending);
                        changed = true;
                    }
                }
            }
            // 会话空闲超时（仅传输模式）
            if session.machine.is_some()
                && session.last_activity.elapsed()
                    >= Duration::from_millis(SESSION_INACTIVITY_TIMEOUT_MS)
            {
                if let Some(machine) = session.machine.as_mut() {
                    match machine {
                        Machine::Receive(receiver) => {
                            let _ = receiver.abort();
                        }
                        Machine::Send(sender) => sender.abort(),
                    }
                }
                drive_session(session).await;
                changed = true;
            }
        }
        // 清理已结束会话
        let before = state.sessions.len();
        state.sessions.retain(|_, session| !session.finished);
        let _ = (changed, before);
    }
}

/// 会话未处理预算：超预算发 pause，低于水位发 resume（由 JS 统一协调 SSH 流控）。
fn update_flow_control(state: &SidecarState, session_id: &str) {
    let Some(session) = state.sessions.get(session_id) else {
        return;
    };
    let unprocessed = session.unprocessed_bytes();
    if !session.paused && unprocessed > SESSION_BUDGET_BYTES {
        let _ = emit(&json!({
            "type": "pause",
            "schemaVersion": ZMODEM_SCHEMA_VERSION,
            "sessionId": session_id,
            "scope": "session",
            "unprocessedBytes": unprocessed,
        }));
    } else if session.paused && unprocessed <= RESUME_WATERMARK_BYTES {
        let _ = emit(&json!({
            "type": "resume",
            "schemaVersion": ZMODEM_SCHEMA_VERSION,
            "sessionId": session_id,
            "scope": "session",
        }));
    }
    let global = state.global_unprocessed();
    if global > GLOBAL_BUDGET_BYTES {
        let _ = emit(&json!({
            "type": "pause",
            "schemaVersion": ZMODEM_SCHEMA_VERSION,
            "scope": "global",
            "unprocessedBytes": global,
        }));
    }
}

fn acknowledge(request_id: Option<&String>, extra: Value) {
    if let Some(request_id) = request_id {
        let _ = emit(&json!({
            "type": "result",
            "schemaVersion": ZMODEM_SCHEMA_VERSION,
            "requestId": request_id,
            "acknowledged": true,
            "event": extra,
        }));
    }
}

async fn handle_send_files(
    state: &mut SidecarState,
    session_id: &str,
    files: Vec<GrantedFile>,
    request_id: Option<String>,
) {
    let Some(session) = state.sessions.get_mut(session_id) else {
        emit_error_message(
            Some(session_id),
            "unknown session",
            "ZMODEM_UNKNOWN_SESSION",
        );
        return;
    };
    session.last_activity = Instant::now();
    session.upload_queue = files.clone();
    session.files_total = Some(files.len() as u32);
    // 记录文件清单：upload_queue 由驱动循环逐个 start_file
    if let Err(error) = start_next_upload_file(session).await {
        fail_session(session, &format!("upload start failed: {error}"));
        return;
    }
    acknowledge(
        request_id.as_ref(),
        json!({ "filesTotal": session.files_total }),
    );
    drive_session(session).await;
}

async fn start_next_upload_file(session: &mut Session) -> Result<(), String> {
    let Some(machine) = session.machine.as_mut() else {
        return Err("no upload machine".to_string());
    };
    let Machine::Send(sender) = machine else {
        return Err("not an upload session".to_string());
    };
    let next = session.upload_queue.first().cloned();
    let Some(next) = next else {
        // 全部文件发送完毕，请求结束会话
        let _ = sender.finish();
        return Ok(());
    };
    let size = next
        .size
        .map(|value| Position::new(value.min(u32::MAX as u64) as u32));
    let name = next.name.as_bytes().to_vec();
    sender
        .start_file(FileInfo { name: &name, size })
        .map_err(|error| format!("start_file failed: {error}"))?;
    // 启动后出队，避免 FileCompleted 后重复启动同一文件
    session.upload_queue.remove(0);
    session.upload_active = Some(UploadFile {
        granted: next,
        handle: None,
    });
    Ok(())
}

pub async fn serve() -> Result<(), String> {
    emit(&json!({
        "type": "ready",
        "schemaVersion": ZMODEM_SCHEMA_VERSION,
        "capabilities": ["detect", "send", "receive", "manual-accept"],
        "maxInputChunkBytes": MAX_INPUT_CHUNK_BYTES,
        "sessionBudgetBytes": SESSION_BUDGET_BYTES,
        "resumeWatermarkBytes": RESUME_WATERMARK_BYTES,
        "globalBudgetBytes": GLOBAL_BUDGET_BYTES,
    }))?;

    let state = Arc::new(Mutex::new(SidecarState::new()));
    tokio::spawn(watchdog(Arc::clone(&state)));

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();

    while let Some(line) = lines
        .next_line()
        .await
        .map_err(|error| format!("failed to read stdin: {error}"))?
    {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let input: ZmodemInput = match serde_json::from_str(trimmed) {
            Ok(value) => value,
            Err(error) => {
                emit_error_message(
                    None,
                    &format!("failed to parse request: {error}"),
                    "ZMODEM_INVALID_REQUEST",
                );
                continue;
            }
        };

        match input {
            ZmodemInput::Open {
                request_id,
                session_id,
                generation,
            } => {
                let mut state = state.lock().await;
                state.sessions.insert(
                    session_id.clone(),
                    Session::new(session_id.clone(), generation.unwrap_or(0)),
                );
                acknowledge(request_id.as_ref(), json!({}));
            }
            ZmodemInput::Input {
                session_id,
                seq: _,
                data_base64,
            } => {
                let bytes = match BASE64_STANDARD.decode(data_base64.trim()) {
                    Ok(value) => value,
                    Err(_) => {
                        emit_error_message(
                            Some(&session_id),
                            "invalid base64 input",
                            "ZMODEM_INVALID_REQUEST",
                        );
                        continue;
                    }
                };
                if bytes.len() > MAX_INPUT_CHUNK_BYTES {
                    emit_error_message(
                        Some(&session_id),
                        "input chunk exceeds 64 KiB limit",
                        "ZMODEM_INPUT_OVERFLOW",
                    );
                    continue;
                }
                if bytes.is_empty() {
                    continue;
                }
                let mut state = state.lock().await;
                let known = state.sessions.contains_key(&session_id);
                if !known {
                    // 未注册会话的输入：仅透传（保持终端输出不丢失）
                    emit_passthrough(&session_id, &bytes);
                    continue;
                }
                let session = state.sessions.get_mut(&session_id).unwrap();
                if session.finished {
                    // 已结束会话的迟到输入按普通输出放行
                    emit_passthrough(&session_id, &bytes);
                    continue;
                }
                if session.machine.is_none() {
                    process_detection(session, &bytes).await;
                } else {
                    // 传输模式：全部字节交给协议状态机，不进入终端
                    session.last_activity = Instant::now();
                    session.pending_input.extend_from_slice(&bytes);
                    // 分离 state 与 session 的借用：drive_session 只用 session
                    let mut session = std::mem::replace(session, Session::new(String::new(), 0));
                    drive_session(&mut session).await;
                    state.sessions.insert(session_id.clone(), session);
                }
                update_flow_control(&state, &session_id);
            }
            ZmodemInput::WireAck { session_id, n: _ } => {
                let mut state = state.lock().await;
                let Some(session) = state.sessions.get_mut(&session_id) else {
                    continue;
                };
                session.last_activity = Instant::now();
                // wire_written 即时确认模型：ack 用于推进传输节奏（背压由 JS 队列持有）
            }
            ZmodemInput::SendFiles {
                request_id,
                session_id,
                files,
            } => {
                let mut state = state.lock().await;
                handle_send_files(&mut state, &session_id, files, request_id).await;
            }
            ZmodemInput::AcceptFile {
                request_id,
                session_id,
                path,
            } => {
                let mut state = state.lock().await;
                let Some(session) = state.sessions.get_mut(&session_id) else {
                    emit_error_message(
                        Some(&session_id),
                        "unknown session",
                        "ZMODEM_UNKNOWN_SESSION",
                    );
                    continue;
                };
                session.last_activity = Instant::now();
                let file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&path)
                    .await;
                match file {
                    Ok(file) => {
                        session.download_target = Some(PathBuf::from(&path));
                        session.download_file = Some(file);
                        session.awaiting_accept = false;
                        if let Some(Machine::Receive(receiver)) = session.machine.as_mut() {
                            if let Err(error) = receiver.accept_file_at(0) {
                                fail_session(session, &format!("accept_file failed: {error}"));
                                continue;
                            }
                        }
                        acknowledge(request_id.as_ref(), json!({ "path": path }));
                        let mut session =
                            std::mem::replace(session, Session::new(String::new(), 0));
                        drive_session(&mut session).await;
                        state.sessions.insert(session_id.clone(), session);
                    }
                    Err(error) => {
                        // 排他创建失败（重名/权限）：交回 JS 决定重试或取消
                        emit_event(
                            &session_id,
                            "acceptFailed",
                            json!({ "path": path, "message": format!("create target failed: {error}") }),
                        );
                    }
                }
            }
            ZmodemInput::Cancel {
                request_id,
                session_id,
            } => {
                let mut state = state.lock().await;
                let Some(session) = state.sessions.get_mut(&session_id) else {
                    acknowledge(request_id.as_ref(), json!({}));
                    continue;
                };
                // 与 JS 旧实现一致：先向远端发送 5×CAN + 5×BS 取消序列，
                // 让对端 lrzsz 立即中止传输，再结束本端会话
                emit_write_remote(&session.id, &[24, 24, 24, 24, 24, 8, 8, 8, 8, 8]);
                if let Some(machine) = session.machine.as_mut() {
                    match machine {
                        Machine::Receive(receiver) => {
                            let _ = receiver.abort();
                        }
                        Machine::Send(sender) => sender.abort(),
                    }
                }
                session.finished = false;
                drive_session(session).await;
                state.sessions.remove(&session_id);
                acknowledge(request_id.as_ref(), json!({}));
            }
            ZmodemInput::Close {
                request_id,
                session_id,
            } => {
                let mut state = state.lock().await;
                if let Some(mut session) = state.sessions.remove(&session_id) {
                    if let Some(machine) = session.machine.as_mut() {
                        match machine {
                            Machine::Receive(receiver) => {
                                let _ = receiver.abort();
                            }
                            Machine::Send(sender) => sender.abort(),
                        }
                    }
                    // 普通检测模式：按确认范围归还尚未处理的字节
                    if session.machine.is_none() && !session.scan.is_empty() {
                        let pending = std::mem::take(&mut session.scan);
                        emit_passthrough(&session_id, &pending);
                    }
                }
                acknowledge(request_id.as_ref(), json!({}));
            }
        }
    }

    // stdin EOF：取消全部会话、归还扣留字节
    let mut state = state.lock().await;
    for (session_id, mut session) in state.sessions.drain() {
        if let Some(machine) = session.machine.as_mut() {
            match machine {
                Machine::Receive(receiver) => {
                    let _ = receiver.abort();
                }
                Machine::Send(sender) => sender.abort(),
            }
        }
        if session.machine.is_none() && !session.scan.is_empty() {
            let pending = std::mem::take(&mut session.scan);
            emit_passthrough(&session_id, &pending);
        }
    }
    Ok(())
}

#[cfg(test)]
mod loopback_tests {
    use super::*;

    /// crate Receiver：提交 ZRQINIT 后应只发出一次 ZRINIT 应答。
    #[test]
    fn receiver_single_zrinit_response() {
        let mut receiver = Receiver::new().unwrap();
        // 构造时即携带主动 ZRINIT：先排空，再提交输入
        match receiver.poll() {
            Action::WriteWire(bytes) => {
                let n = bytes.len();
                receiver.wire_written(n);
            }
            other => panic!("expected initial WriteWire, got {other:?}"),
        }
        let frame: Vec<u8> = vec![
            42, 42, 24, 66, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 48, 13, 10, 17,
        ];
        let consumed = receiver.submit_wire(&frame).unwrap();
        // 十六进制行尾（\r\n XON）不在本次消费范围，由后续输入排空
        assert_eq!(consumed, frame.len() - 3);

        let mut zrinit_count = 0;
        for _ in 0..3 {
            match receiver.poll() {
                Action::WriteWire(bytes) => {
                    zrinit_count += 1;
                    assert_eq!(bytes[0], 42);
                    let n = bytes.len();
                    receiver.wire_written(n);
                }
                Action::Idle => break,
                other => panic!("unexpected action: {other:?}"),
            }
        }
        assert_eq!(zrinit_count, 1);
    }
}
