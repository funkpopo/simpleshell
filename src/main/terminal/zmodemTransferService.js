const fs = require("fs");
const path = require("path");
const { logToFile } = require("../utils/logger");
const { IPC_EVENT_CHANNELS } = require("../../shared/contracts/ipc/channels");
const { resolveLanguage, t: mainT } = require("../../shared/mainI18n");

const PROGRESS_EMIT_INTERVAL_MS = 150;

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
 * ZMODEM（rz/sz）传输服务。
 *
 * SSH 终端以管道通道运行（attachChannel）：ZMODEM 检测、协议、超时与背压
 * 都在 core 的流内完成，会话期间协议字节不进入终端渲染管线。本模块只处理
 * 通道的 zmodem 事件并下发 accept/send/cancel；文件选择框、保存策略、
 * 国际化、进度节流与 IPC 事件仍在 JS。
 */
class ZmodemTransferService {
  constructor(options = {}) {
    this._options = options;
    this._states = new Map(); // processId -> state
    this._byTabId = new Map(); // tabId -> processId
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
   * The channel emits `zmodem` (kind, event) and takes `zmodemAccept` /
   * `zmodemSend` / `zmodemCancel`. Returns a detach function.
   */
  attachChannel(processId, channel, context = {}) {
    const state =
      this._states.get(String(processId)) ||
      this._createState(processId, context);
    if (!state) {
      return () => {};
    }
    state.channel = channel;
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
    if (typeof context.emitTerminalText === "function") {
      state.emitTerminalText = context.emitTerminalText;
    }
    if (context.sshConfig !== undefined) {
      state.sshConfig = context.sshConfig;
    }
    const onZmodem = (kind, event = {}) => {
      // The core's session is over once it reports an outcome.
      if (kind === "intro") {
        state.remoteEnded = false;
      } else if (["done", "cancelled", "error"].includes(kind)) {
        state.remoteEnded = true;
      }
      void this._handleNativeEvent(state, {
        kind,
        event,
        filesDone: event.filesDone,
      });
    };
    channel.on("zmodem", onZmodem);
    return () => {
      channel.removeListener("zmodem", onZmodem);
      if (state.channel === channel) {
        state.channel = null;
      }
    };
  }

  /** Sends a ZMODEM command to the session's pipe channel. */
  _sendZmodem(state, command) {
    return state.channel ? state.channel.sendZmodem(command) : false;
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
      emitTerminalText:
        typeof context?.emitTerminalText === "function"
          ? context.emitTerminalText
          : null,
      channel: null,
      remoteEnded: false,
      active: false,
      finished: false,
      direction: null,
      cancelRequested: false,
      filesDone: 0,
      filesTotal: null,
      currentFile: null,
      lastProgressEmit: 0,
    };

    this._states.set(state.processId, state);
    if (state.tabId) {
      this._byTabId.set(state.tabId, state.processId);
    }
    return state;
  }

  /** core 的 zmodem 事件映射为 ZMODEM IPC 事件 */
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
          this._sendZmodem(state, { type: "zmodemAccept", path: target });
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
          event.message || event.error || "zmodem error",
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

  /** 上传：选择文件后按授权路径下发给 core */
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
    this._sendZmodem(state, { type: "zmodemSend", files: valid });
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

  /** 会话取消：先发取消消息（core 向远端发 CAN 序列），事件驱动结束 */
  _cancelNativeSession(state, reason) {
    if (state.cancelRequested || state.finished) {
      return;
    }
    state.cancelRequested = true;
    if (!this._sendZmodem(state, { type: "zmodemCancel" })) {
      // 通道已关闭：直接终结（远端由 SSH 断开回收）
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
    if (!state.remoteEnded) {
      this._sendZmodem(state, { type: "zmodemCancel" });
    }

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
    state.direction = null;
    state.currentFile = null;
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
}

const zmodemTransferService = new ZmodemTransferService({});

module.exports = {
  ZmodemTransferService,
  zmodemTransferService,
  formatBytes,
};
