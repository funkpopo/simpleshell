const fs = require("fs");
const path = require("path");
const { logToFile } = require("../utils/logger");
const { IPC_EVENT_CHANNELS } = require("../../shared/contracts/ipc/channels");
const { resolveLanguage, t: mainT } = require("../../shared/mainI18n");

const PROGRESS_EMIT_INTERVAL_MS = 150;
const SESSION_INACTIVITY_TIMEOUT_MS = 45 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 1000;

const { formatBytes } = require("../../shared/common");

const uniqueSavePath = async (dir, fileName) => {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let candidate = path.join(dir, fileName);
  for (let index = 1; index < 1000; index += 1) {
    try {
      await fs.promises.access(candidate);
    } catch {
      return candidate;
    }
    candidate = path.join(dir, `${base}-${index}${ext}`);
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
};

/**
 * ZMODEM（rz/sz）传输服务（native sidecar 编排器）。
 *
 * 自 P3.9 起协议状态机完全由 native sidecar（zmodem-serve，Rust）承担，
 * 旧的 JS zmodem2 状态机路径已移除。本模块仅负责编排：
 *  - 将 SSH 流的原始字节按序投递给 sidecar（检测、协议与透传均在 sidecar 内）；
 *  - 透传字节经 onRawOutput 回调进入原有解码/输出缓冲管线；
 *  - 文件选择框、保存策略、国际化、进度节流与 IPC 事件仍在 JS；
 *  - 背压经独立 "zmodem" 暂停原因接入统一流控。
 *
 * 会话期间 ZMODEM 协议字节被拦截，不再进入终端渲染管线；会话结束后自动恢复。
 */
class ZmodemTransferService {
  constructor(options = {}) {
    this._options = options;
    this._states = new Map(); // processId -> state
    this._byTabId = new Map(); // tabId -> processId
    this._watchdog = null;
  }

  // ------------------------------------------------------------------
  // 依赖获取（可注入，便于测试）
  // ------------------------------------------------------------------

  _getMainWindow() {
    if (typeof this._options.getMainWindow === "function") {
      return this._options.getMainWindow();
    }
    const { getPrimaryWindow } = require("../window/windowManager");
    return getPrimaryWindow();
  }

  _getSaveRoot() {
    if (typeof this._options.getSaveRoot === "function") {
      return this._options.getSaveRoot();
    }
    const { app } = require("electron");
    return path.join(app.getPath("downloads"), "zmodem");
  }

  async _ensureSaveRoot() {
    const saveRoot = this._getSaveRoot();
    await fs.promises.mkdir(saveRoot, { recursive: true });
    return saveRoot;
  }

  _emitIpc(payload) {
    if (typeof this._options.emitIpc === "function") {
      this._options.emitIpc(payload);
      return;
    }
    try {
      const mainWindow = this._getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send(IPC_EVENT_CHANNELS.ZMODEM_EVENT, payload);
      }
    } catch (error) {
      logToFile(`ZMODEM emit event failed: ${error.message}`, "WARN");
    }
  }

  // ------------------------------------------------------------------
  // 查询
  // ------------------------------------------------------------------

  _findState(id) {
    if (id === undefined || id === null) {
      return null;
    }
    const key = String(id);
    const direct = this._states.get(key);
    if (direct) {
      return direct;
    }
    const primaryId = this._byTabId.get(key);
    return primaryId ? this._states.get(primaryId) || null : null;
  }

  hasActiveSession(id) {
    const state = this._findState(id);
    return Boolean(state && state.active);
  }

  // ------------------------------------------------------------------
  // 输出流挂接
  // ------------------------------------------------------------------

  /**
   * 将 SSH 流的原始字节喂给 sidecar 检测器。
   *
   * @param {number|string} processId
   * @param {Buffer} chunk 原始输出字节
   * @param {object} context { stream, tabId, sshConfig, emitTerminalText, onRawOutput, onBackpressure }
   * @returns {Buffer} 应继续进入终端渲染管线的字节（native 始终为空，透传经 onRawOutput）
   */
  feedOutput(processId, chunk, context = {}) {
    if (!chunk || !chunk.length) {
      return chunk || Buffer.alloc(0);
    }

    let state = this._states.get(String(processId));
    if (!state) {
      state = this._createState(processId, context);
      if (!state) {
        return chunk;
      }
    }

    if (context.stream) {
      state.stream = context.stream;
    }
    if (typeof context.emitTerminalText === "function") {
      state.emitTerminalText = context.emitTerminalText;
    }
    if (context.tabId !== undefined && context.tabId !== null) {
      const tabKey = String(context.tabId);
      if (state.tabId !== tabKey) {
        if (state.tabId) {
          this._byTabId.delete(state.tabId);
        }
        state.tabId = tabKey;
        this._byTabId.set(tabKey, state.processId);
      }
    }
    if (context.sshConfig !== undefined) {
      state.sshConfig = context.sshConfig;
    }
    if (typeof context.onRawOutput === "function") {
      state.onRawOutput = context.onRawOutput;
    }
    if (typeof context.onBackpressure === "function") {
      state.onBackpressure = context.onBackpressure;
    }
    state.lastFeedAt = Date.now();

    // 字节全部交给 sidecar（含检测与透传），透传字节经 onRawOutput 回调
    // 进入原有解码/输出缓冲管线，保持字节归属与顺序
    return this._feedNative(state, chunk);
  }

  _createState(processId, context) {
    if (processId === undefined || processId === null) {
      return null;
    }

    const state = {
      processId: String(processId),
      rawProcessId: processId,
      tabId:
        context?.tabId !== undefined && context?.tabId !== null
          ? String(context.tabId)
          : null,
      sshConfig: context?.sshConfig || null,
      stream: context?.stream || null,
      emitTerminalText:
        typeof context?.emitTerminalText === "function"
          ? context.emitTerminalText
          : null,
      backend: "native",
      native: {
        chunks: [], // 有序待发送字节块（发送前计入背压统计）
        openSent: false,
        pumping: false,
        remoteQueue: [], // writeRemote 背压队列（stream.write 返回 false 时）
        streamBusy: false,
        paused: false,
      },
      active: false,
      // 会话在 intro 事件前处于检测阶段：finished=false 允许输入泵开启会话
      finished: false,
      direction: null,
      cancelRequested: false,
      lastFeedAt: Date.now(),
      filesDone: 0,
      filesTotal: null,
      currentFile: null,
      lastProgressEmit: 0,
    };

    this._states.set(state.processId, state);
    if (state.tabId) {
      this._byTabId.set(state.tabId, state.processId);
    }
    this._ensureWatchdog();
    return state;
  }

  /**
   * sidecar 未决字节统计（输入队列 + writeRemote 队列），
   * 供 sshHandlers 计入 terminalIOMailboxManager 背压缓冲统计。
   */
  getHeldBytes(id) {
    const state = this._findState(id);
    if (!state || !state.native) {
      return 0;
    }
    let total = 0;
    for (const chunk of state.native.chunks) {
      total += chunk.length;
    }
    for (const chunk of state.native.remoteQueue) {
      total += chunk.length;
    }
    return total;
  }

  // ------------------------------------------------------------------
  // native 后端（sidecar zmodem-serve 编排）
  // ------------------------------------------------------------------

  /** 惰性获取共享 sidecar 客户端并绑定消息路由 */
  _ensureClient() {
    if (this._client) {
      return this._client;
    }
    const { nativeZmodemClient } = require("../native/nativeZmodemClient");
    nativeZmodemClient.setMessageHandler((type, sessionId, message) => {
      this._handleNativeMessage(type, sessionId, message);
    });
    nativeZmodemClient.setExitHandler(() => {
      this._handleNativeProcessExit();
    });
    this._client = nativeZmodemClient;
    return nativeZmodemClient;
  }

  /** 会话输入：块进入有序队列，异步泵向 sidecar，返回空 Buffer */
  _feedNative(state, chunk) {
    state.native.chunks.push(Buffer.from(chunk));
    this._maybeNativeBackpressure(state);
    void this._pumpNative(state);
    return Buffer.alloc(0);
  }

  /** 有序投递：open（首次）→ 依次发送输入块；sidecar 不可用时终结会话 */
  async _pumpNative(state) {
    if (state.native.pumping || state.finished) {
      return;
    }
    state.native.pumping = true;
    try {
      if (state.finished) {
        return;
      }
      const client = this._ensureClient();
      if (!(await client.ensureReady())) {
        this._finishNativeSession(
          state,
          "error",
          "zmodem sidecar unavailable",
        );
        return;
      }
      if (!state.native.openSent) {
        state.native.openSent = true;
        if (!client.open(state.processId)) {
          this._finishNativeSession(
            state,
            "error",
            "zmodem sidecar unavailable",
          );
          return;
        }
      }
      while (state.native.chunks.length && !state.finished) {
        const chunk = state.native.chunks.shift();
        if (!client.input(state.processId, chunk)) {
          this._finishNativeSession(
            state,
            "error",
            "zmodem sidecar write failed",
          );
          return;
        }
      }
    } finally {
      state.native.pumping = false;
    }
  }

  /** writeRemote 背压：stream.write 返回 false 时排队，drain 后续发 */
  _writeNativeRemote(state, chunk) {
    if (state.native.streamBusy) {
      state.native.remoteQueue.push(Buffer.from(chunk));
      this._maybeNativeBackpressure(state);
      return;
    }
    if (!state.stream || typeof state.stream.write !== "function") {
      return;
    }
    let writable = false;
    try {
      writable = state.stream.write(Buffer.from(chunk));
    } catch (error) {
      logToFile(`ZMODEM native write failed: ${error.message}`, "WARN");
      return;
    }
    if (!writable) {
      state.native.streamBusy = true;
      const onDrain = () => {
        state.stream?.off?.("drain", onDrain);
        state.native.streamBusy = false;
        const queued = state.native.remoteQueue;
        state.native.remoteQueue = [];
        for (const pending of queued) {
          this._writeNativeRemote(state, pending);
        }
        this._maybeNativeBackpressure(state);
      };
      if (state.stream && typeof state.stream.on === "function") {
        state.stream.on("drain", onDrain);
      } else {
        // 无 drain 事件的流：避免永久阻塞
        state.native.streamBusy = false;
      }
    }
  }

  /**
   * 背压暂停原因：sidecar 未决字节超过会话预算（2 MiB）时暂停 SSH 流读取；
   * 回落到恢复水位（1 MiB）以下时恢复。通过独立 "zmodem" 暂停原因交由统一
   * 流控协调，单次恢复不清除 renderer 等其他原因。
   */
  _maybeNativeBackpressure(state) {
    if (typeof state.onBackpressure !== "function") {
      return;
    }
    const held = this.getHeldBytes(state.processId);
    if (!state.native.paused && held > 2 * 1024 * 1024) {
      state.native.paused = true;
      try {
        state.onBackpressure(true);
      } catch (error) {
        logToFile(`ZMODEM backpressure pause failed: ${error.message}`, "WARN");
      }
    } else if (state.native.paused && held <= 1024 * 1024) {
      state.native.paused = false;
      try {
        state.onBackpressure(false);
      } catch (error) {
        logToFile(
          `ZMODEM backpressure resume failed: ${error.message}`,
          "WARN",
        );
      }
    }
  }

  /** sidecar 消息路由（单会话，同步字段/字节归属见 sidecar README） */
  _handleNativeMessage(type, sessionId, message) {
    const state = sessionId ? this._states.get(String(sessionId)) : null;
    if (!state) {
      // 旧进程事件或未注册会话：通过代次丢弃（重启只服务新会话）
      return;
    }
    switch (type) {
      case "passthrough": {
        const chunk = Buffer.from(message.dataBase64 || "", "base64");
        if (chunk.length && typeof state.onRawOutput === "function") {
          try {
            state.onRawOutput(chunk);
          } catch (error) {
            logToFile(
              `ZMODEM passthrough delivery failed: ${error.message}`,
              "WARN",
            );
          }
        }
        return;
      }
      case "writeRemote": {
        const chunk = Buffer.from(message.dataBase64 || "", "base64");
        if (chunk.length) {
          this._writeNativeRemote(state, chunk);
        }
        return;
      }
      case "event": {
        this._handleNativeEvent(state, message);
        return;
      }
      default:
        return;
    }
  }

  /** sidecar 事件映射为现有 ZMODEM IPC（事件名与旧实现完全兼容） */
  async _handleNativeEvent(state, message) {
    const kind = message.kind;
    const event = message.event || {};
    // intro 仅在检测阶段有效；其余事件仅在会话进行中有效
    //（会话结束后旧会话的迟到事件不可开启新会话）
    if (kind === "intro" ? state.active : !state.active) {
      return;
    }
    switch (kind) {
      case "intro": {
        state.direction = event.direction || state.direction;
        state.active = true;
        state.finished = false;
        state.filesDone = 0;
        if (state.direction === "upload") {
          this._emitEvent(state, "start", { waitingForFiles: true });
          this._emitTerminalText(state, "zmodemSendingStarted");
          try {
            await this._beginNativeUpload(state);
          } catch (error) {
            logToFile(
              `ZMODEM upload bootstrap failed: ${error?.message || error}`,
              "ERROR",
            );
            this._finishNativeSession(
              state,
              "error",
              error?.message || String(error),
            );
          }
        } else {
          this._emitEvent(state, "start", {});
          this._emitTerminalText(state, "zmodemReceivingStarted");
        }
        return;
      }
      case "offer": {
        if (state.direction === "download" && event.awaitingAccept) {
          // 下载：JS 校验名称并选择目标，远端名不能直接决定本地写入位置
          const rawName = event.nameBase64
            ? Buffer.from(event.nameBase64, "base64").toString("utf8")
            : String(event.fileName || "");
          const fileName = this._safeDownloadName(rawName);
          if (!fileName) {
            this.cancelTransfer(state.processId);
            return;
          }
          let target;
          try {
            const saveRoot = await this._ensureSaveRoot();
            target = await uniqueSavePath(saveRoot, fileName);
          } catch (error) {
            logToFile(`ZMODEM save failed: ${error.message}`, "ERROR");
            this._finishNativeSession(state, "error", error.message);
            return;
          }
          state.currentFile = {
            name: fileName,
            size: Number(event.fileSize) || 0,
            transferred: 0,
            savePath: target,
          };
          this._client.acceptFile(state.processId, target);
          this._emitEvent(state, "offer", {
            fileName,
            fileSize: Number(event.fileSize) || 0,
          });
        } else {
          this._emitEvent(state, "offer", {
            fileName: event.fileName || null,
            fileSize: Number(event.fileSize) || 0,
          });
        }
        return;
      }
      case "progress": {
        if (state.currentFile && Number.isFinite(event.deltaBytes)) {
          state.currentFile.transferred += Number(event.deltaBytes) || 0;
        }
        this._maybeEmitProgress(state);
        return;
      }
      case "fileDone": {
        const current = state.currentFile;
        state.currentFile = null;
        state.filesDone = Number(message.filesDone) || state.filesDone + 1;
        if (state.direction === "download") {
          this._emitTerminalText(state, "zmodemFileReceived", {
            name: current?.name || "unknown",
            size: formatBytes(current?.transferred || 0),
            path: current?.savePath || "",
          });
          this._emitEvent(state, "file-done", {
            fileName: current?.name || null,
            fileSize: current?.size || 0,
            transferred: current?.transferred || 0,
            filesDone: state.filesDone,
            savePath: current?.savePath || null,
          });
        } else {
          this._emitTerminalText(state, "zmodemFileSent", {
            name: current?.name || "unknown",
            size: formatBytes(current?.transferred || 0),
          });
          this._emitEvent(state, "file-done", {
            fileName: current?.name || null,
            fileSize: current?.size || 0,
            transferred: current?.transferred || 0,
            filesDone: state.filesDone,
          });
        }
        return;
      }
      case "done":
        this._finishNativeSession(state, "complete");
        return;
      case "cancelled":
        this._finishNativeSession(state, "cancelled", "remote");
        return;
      case "acceptFailed":
        this._finishNativeSession(
          state,
          "error",
          event.message || "accept file failed",
        );
        return;
      case "error":
        this._finishNativeSession(
          state,
          "error",
          event.message || event.error || "zmodem sidecar error",
        );
        return;
      default:
        return;
    }
  }

  /** 下载文件名安全化：路径分隔符/.. /空名全部拒绝（而非重写到其他位置） */
  _safeDownloadName(rawName) {
    if (!rawName || typeof rawName !== "string") {
      return null;
    }
    if (
      rawName.includes("/") ||
      rawName.includes("\\") ||
      rawName.includes("..")
    ) {
      return null;
    }
    const base = path.basename(rawName).trim();
    if (!base || base === "." || base === "..") {
      return null;
    }
    return base;
  }

  /** 上传：选择文件后按授权路径下发给 sidecar */
  async _beginNativeUpload(state) {
    const filePaths = await this._pickUploadFiles(state);
    if (state.finished || state.cancelRequested) {
      return;
    }
    if (!filePaths || !filePaths.length) {
      this._cancelNativeSession(state, "user");
      return;
    }
    const stats = await Promise.all(
      filePaths.map(async (filePath) => {
        try {
          const s = await fs.promises.stat(filePath);
          return s.isFile()
            ? {
                path: filePath,
                name: path.basename(filePath),
                size: s.size,
                mtimeMs: Math.floor(s.mtimeMs),
              }
            : null;
        } catch {
          return null;
        }
      }),
    );
    const valid = stats.filter(Boolean);
    if (!valid.length) {
      this._cancelNativeSession(state, "no-files");
      return;
    }
    state.filesTotal = valid.length;
    this._emitEvent(state, "offer", {
      fileName: valid.map((file) => file.name).join(", "),
      fileSize: valid.reduce((total, file) => total + file.size, 0),
      filesTotal: state.filesTotal,
      batchSummary: true,
    });
    this._client.sendFiles(state.processId, valid);
  }

  async _pickUploadFiles(state) {
    const { dialog } = require("electron");
    const parentWindow = this._getMainWindow();
    const options = {
      title: this._text(state, "zmodemUploadSelectFiles"),
      properties: ["openFile", "multiSelections"],
    };
    const result =
      parentWindow && !parentWindow.isDestroyed()
        ? await dialog.showOpenDialog(parentWindow, options)
        : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths;
  }

  /** 会话取消：先发取消消息（sidecar 向远端发 CAN 序列），事件驱动结束 */
  _cancelNativeSession(state, reason) {
    if (state.cancelRequested || state.finished) {
      return;
    }
    state.cancelRequested = true;
    if (!this._ensureClient().cancel(state.processId)) {
      // sidecar 不可用：直接终结（远端由 SSH 断开回收）
      this._finishNativeSession(state, "cancelled", reason);
    }
  }

  _finishNativeSession(state, status, detail) {
    if (!state || state.finished) {
      return;
    }
    state.finished = true;
    state.active = false;
    state.cancelRequested = false;
    state.native.chunks = [];
    state.native.remoteQueue = [];
    state.native.paused = false;
    if (typeof state.onBackpressure === "function") {
      try {
        state.onBackpressure(false);
      } catch {
        /* ignore */
      }
    }
    this._client?.close?.(state.processId);

    if (status === "error") {
      this._emitTerminalText(state, "zmodemSessionFailed", {
        message: detail || "unknown",
      });
    } else if (status === "cancelled") {
      this._emitTerminalText(state, "zmodemSessionCancelled");
    } else {
      this._emitTerminalText(state, "zmodemSessionDone");
    }

    logToFile(
      `ZMODEM session finished: process=${state.processId}, status=${status}, files=${state.filesDone}`,
      "INFO",
    );
    this._emitEvent(state, "end", {
      status,
      error: status === "error" ? detail || "unknown" : null,
      filesDone: state.filesDone,
    });
    // 会话结束后回到检测阶段：同一 SSH 流上的后续输出（重连、再次 rz/sz）
    // 可开启新会话；active=false 期间迟到事件被忽略， destroys 不发伪 end
    state.finished = false;
    state.active = false;
    state.cancelRequested = false;
    state.native.openSent = false;
    state.direction = null;
    state.currentFile = null;
  }

  /** sidecar 进程退出：终结所有进行中的会话并释放暂停原因 */
  _handleNativeProcessExit() {
    for (const state of Array.from(this._states.values())) {
      if (!state.active || state.finished) {
        continue;
      }
      this._finishNativeSession(state, "error", "zmodem sidecar crashed");
    }
  }

  // ------------------------------------------------------------------
  // 取消 / 结束
  // ------------------------------------------------------------------

  cancelTransfer(id) {
    const state = this._findState(id);
    if (!state || !state.active) {
      return false;
    }
    this._cancelNativeSession(state, "user");
    return true;
  }

  destroyProcess(id) {
    const state = this._findState(id);
    if (!state) {
      return false;
    }

    if (state.active && !state.finished) {
      this._cancelNativeSession(state, "connection-closed");
      if (!state.finished) {
        this._finishNativeSession(state, "cancelled", "connection-closed");
      }
    }
    this._states.delete(state.processId);
    if (state.tabId) {
      this._byTabId.delete(state.tabId);
    }
    return true;
  }

  destroyAll() {
    for (const processId of Array.from(this._states.keys())) {
      this.destroyProcess(processId);
    }
  }

  // ------------------------------------------------------------------
  // 辅助
  // ------------------------------------------------------------------

  _text(state, key, params = {}) {
    const lng = resolveLanguage(state.sshConfig || {});
    // 依静态 key 分发（i18n 检查要求翻译 key 为字面量）
    switch (key) {
      case "zmodemReceivingStarted":
        return mainT("mainProcess.terminal.zmodemReceivingStarted", { lng });
      case "zmodemSendingStarted":
        return mainT("mainProcess.terminal.zmodemSendingStarted", { lng });
      case "zmodemUploadSelectFiles":
        return mainT("mainProcess.terminal.zmodemUploadSelectFiles", { lng });
      case "zmodemFileReceived":
        return mainT("mainProcess.terminal.zmodemFileReceived", {
          lng,
          name: params.name,
          size: params.size,
          path: params.path,
        });
      case "zmodemFileSent":
        return mainT("mainProcess.terminal.zmodemFileSent", {
          lng,
          name: params.name,
          size: params.size,
        });
      case "zmodemSessionDone":
        return mainT("mainProcess.terminal.zmodemSessionDone", { lng });
      case "zmodemSessionCancelled":
        return mainT("mainProcess.terminal.zmodemSessionCancelled", { lng });
      case "zmodemSessionFailed":
        return mainT("mainProcess.terminal.zmodemSessionFailed", {
          lng,
          error: params.message || params.error || "unknown",
        });
      default:
        return key;
    }
  }

  _emitTerminalText(state, key, params = {}) {
    if (typeof state.emitTerminalText !== "function") {
      return;
    }
    try {
      const text = this._text(state, key, params);
      state.emitTerminalText(`\r\n\x1b[36m*** ${text} ***\x1b[0m\r\n`);
    } catch (error) {
      logToFile(`ZMODEM terminal text failed: ${error.message}`, "DEBUG");
    }
  }

  _emitEvent(state, type, extra = {}) {
    this._emitIpc({
      processId: state.rawProcessId,
      tabId: state.tabId,
      type,
      direction: state.direction,
      filesDone: state.filesDone,
      filesTotal: state.filesTotal,
      timestamp: Date.now(),
      ...extra,
    });
  }

  _maybeEmitProgress(state) {
    const now = Date.now();
    if (now - state.lastProgressEmit < PROGRESS_EMIT_INTERVAL_MS) {
      return;
    }
    state.lastProgressEmit = now;
    const current = state.currentFile;
    this._emitEvent(state, "progress", {
      fileName: current?.name || null,
      fileSize: current?.size || 0,
      transferred: current?.transferred || 0,
    });
  }

  _ensureWatchdog() {
    if (this._watchdog) {
      return;
    }
    this._watchdog = setInterval(() => {
      const now = Date.now();
      for (const state of Array.from(this._states.values())) {
        if (
          state.active &&
          now - state.lastFeedAt > SESSION_INACTIVITY_TIMEOUT_MS
        ) {
          logToFile(
            `ZMODEM session timed out (inactivity): process=${state.processId}`,
            "WARN",
          );
          this._cancelNativeSession(state, "timeout");
        }
      }
    }, WATCHDOG_INTERVAL_MS);
    if (typeof this._watchdog.unref === "function") {
      this._watchdog.unref();
    }
  }
}

const zmodemTransferService = new ZmodemTransferService({});

module.exports = {
  ZmodemTransferService,
  zmodemTransferService,
  formatBytes,
};
