const fs = require("fs");
const path = require("path");
const { Receiver, Sender, ZACK_HEADER } = require("zmodem2");
const { logToFile } = require("../utils/logger");
const { IPC_EVENT_CHANNELS } = require("../ipc/schema/channels");
const { resolveLanguage, t: mainT } = require("../../shared/mainI18n");

// ZMODEM 十六进制帧头公共起始序列 "**\x18B0"（sz/rz 均以此开场）：
// 42 42 24? 注意 ZDLE=0x18=24(十进制)，'B'=66，'0'=48
const ZMODEM_INTRO = [42, 42, 24, 66, 48];
// 起始序列后的类型字符（帧类型十六进制首位）：
//   '0'(48)=ZRQINIT → 对端发送文件（下载）
//   '1'(49)=ZRINIT  → 对端等待接收（上传）
//   '2'(50)=ZSINIT  → 对端发送转义能力协商（仅会话中出现）
const ZRQINIT_NEXT = 48;
const ZRINIT_NEXT = 49;
const ZSINIT_NEXT = 50;
const ZSINIT_PATTERN = [...ZMODEM_INTRO, ZSINIT_NEXT];
// 取消序列：5×CAN + 5×BS（lrzsz 约定）
const CANCEL_SEQUENCE = Buffer.from([24, 24, 24, 24, 24, 8, 8, 8, 8, 8]);

const PROGRESS_EMIT_INTERVAL_MS = 150;
const SESSION_INACTIVITY_TIMEOUT_MS = 45 * 1000;
const WATCHDOG_INTERVAL_MS = 5 * 1000;
// 扣留的起始序列前缀字节的空闲冲刷延迟：真实的 sz/rz 起始序列
// 会在提示符后立即连续发送，超过该时长仍无后续数据即视为普通输出
const SCAN_TAIL_FLUSH_DELAY_MS = 500;

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

/** 在字节序列中查找 ZMODEM 起始序列（含类型字符校验） */
const findZmodemIntro = (buf) => {
  outer: for (let i = 0; i + ZMODEM_INTRO.length <= buf.length; i += 1) {
    for (let j = 0; j < ZMODEM_INTRO.length; j += 1) {
      if (buf[i + j] !== ZMODEM_INTRO[j]) {
        continue outer;
      }
    }
    const nextIndex = i + ZMODEM_INTRO.length;
    if (nextIndex >= buf.length) {
      // 类型字符在后续字节中，等待更多数据
      return { index: i, type: null };
    }
    const type = buf[nextIndex];
    if (type === ZRQINIT_NEXT || type === ZRINIT_NEXT) {
      return { index: i, type };
    }
    // 非会话起始帧类型（如 ZSINIT），跳过继续扫描
  }
  return null;
};

/** 在字节序列中查找子序列 */
const findSubarray = (buf, needle) => {
  outer: for (let i = 0; i + needle.length <= buf.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (buf[i + j] !== needle[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
};

/**
 * 计算缓冲区尾部与 ZMODEM 起始序列前缀的最长匹配长度。
 * 只有这些字节才可能成为跨块起始序列的开头，需要扣留等待后续数据；
 * 其余尾部字节不可能与后续数据拼出起始序列，应立即放行到终端。
 */
const introPrefixSuffixLength = (buf) => {
  const maxLength = Math.min(buf.length, ZMODEM_INTRO.length);
  for (let length = maxLength; length > 0; length -= 1) {
    let matched = true;
    for (let i = 0; i < length; i += 1) {
      if (buf[buf.length - length + i] !== ZMODEM_INTRO[i]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return length;
    }
  }
  return 0;
};

/**
 * ZMODEM（rz/sz）传输服务（基于 zmodem2 状态机）。
 *
 * 挂接在 SSH 流的原始字节输出路径上（早于 UTF-8 解码），自行检测输出流中的
 * ZMODEM 起始序列（"**\x18B0…"）：
 *  - 对端运行 `sz`（发来 ZRQINIT）→ 用 Receiver 自动接收文件到本地下载目录；
 *  - 对端运行 `rz`（发来 ZRINIT）→ 弹出文件选择框后用 Sender 向对端发送文件。
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
   * 将 SSH 流的原始字节喂给 ZMODEM 检测器。
   *
   * @param {number|string} processId
   * @param {Buffer} chunk 原始输出字节
   * @param {object} context { stream, tabId, sshConfig, emitTerminalText }
   * @returns {Buffer} 应继续进入终端渲染管线的字节（可能为空）
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
    state.lastFeedAt = Date.now();

    // 会话进行中：全部字节交给协议状态机，不进入终端渲染
    if (state.machine) {
      state.pendingInput = state.pendingInput.length
        ? Buffer.concat([state.pendingInput, chunk])
        : Buffer.from(chunk);
      if (state.direction === "download") {
        this._respondZsinit(state);
      }
      void this._driveSession(state);
      return Buffer.alloc(0);
    }
    // 检测模式：扫描起始序列；仅扣留「构成起始序列前缀」的尾部字节
    // 以处理跨块截断，其余字节立即放行（避免终端输出尾部被隐藏）
    const combined = state.scanTail.length
      ? Buffer.concat([state.scanTail, chunk])
      : chunk;
    const found = findZmodemIntro(combined);
    if (!found || found.type === null) {
      const holdLength = introPrefixSuffixLength(combined);
      const outLength = combined.length - holdLength;
      state.scanTail =
        holdLength > 0
          ? Buffer.from(combined.subarray(outLength))
          : Buffer.alloc(0);
      this._scheduleScanTailFlush(state);
      if (outLength > 0) {
        return Buffer.from(combined.subarray(0, outLength));
      }
      return Buffer.alloc(0);
    }

    // 检测到 ZMODEM 起始序列：序列之前的字节照常进入终端，序列及之后
    // 的字节交给协议状态机（起始头本身不会显示到终端）
    this._clearScanTailTimer(state);
    state.scanTail = Buffer.alloc(0);
    const sessionInput = Buffer.from(combined.subarray(found.index));
    if (found.type === ZRQINIT_NEXT) {
      this._startDownload(state, sessionInput);
    } else {
      this._startUpload(state, sessionInput);
    }
    return Buffer.from(combined.subarray(0, found.index));
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
      machine: null,
      pendingInput: Buffer.alloc(0),
      scanTail: Buffer.alloc(0),
      scanTailFlushTimer: null,
      active: false,
      finished: true,
      driving: false,
      driveAgain: false,
      direction: null,
      cancelRequested: false,
      zsinitAcked: false,
      lastFeedAt: Date.now(),
      filesDone: 0,
      filesTotal: null,
      currentFile: null,
      uploadQueue: [],
      uploadActive: null,
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
   * 扫描尾扣留字节的空闲冲刷：若超过延迟仍无后续输出，说明这些字节
   * 只是恰好与起始序列前缀同形的普通输出（如提示符尾部），放行到终端。
   */
  _scheduleScanTailFlush(state) {
    this._clearScanTailTimer(state);
    if (!state.scanTail.length) {
      return;
    }
    const timer = setTimeout(() => {
      state.scanTailFlushTimer = null;
      // 扫描尾仅在检测模式下存在（会话开始时已被清空）
      if (state.machine || !state.scanTail.length) {
        return;
      }
      const pending = state.scanTail;
      state.scanTail = Buffer.alloc(0);
      if (typeof state.emitTerminalText === "function") {
        try {
          state.emitTerminalText(pending.toString("latin1"));
        } catch (error) {
          logToFile(`ZMODEM scan tail flush failed: ${error.message}`, "DEBUG");
        }
      }
    }, SCAN_TAIL_FLUSH_DELAY_MS);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    state.scanTailFlushTimer = timer;
  }

  _clearScanTailTimer(state) {
    if (state.scanTailFlushTimer) {
      clearTimeout(state.scanTailFlushTimer);
      state.scanTailFlushTimer = null;
    }
  }

  // ------------------------------------------------------------------
  // 会话建立
  // ------------------------------------------------------------------

  _startDownload(state, sessionInput) {
    state.machine = new Receiver();
    state.active = true;
    state.finished = false;
    state.cancelRequested = false;
    state.filesDone = 0;
    state.filesTotal = null;
    state.currentFile = null;
    state.direction = "download";
    state.pendingInput = sessionInput;

    logToFile(
      `ZMODEM session started: process=${state.processId}, direction=download`,
      "INFO",
    );

    this._emitEvent(state, "start", {});
    this._emitTerminalText(state, "zmodemReceivingStarted");
    void this._driveSession(state);
  }

  _startUpload(state, sessionInput) {
    state.machine = new Sender(false);
    state.active = true;
    state.finished = false;
    state.cancelRequested = false;
    state.filesDone = 0;
    state.filesTotal = null;
    state.currentFile = null;
    state.direction = "upload";
    state.pendingInput = sessionInput;

    logToFile(
      `ZMODEM session started: process=${state.processId}, direction=upload`,
      "INFO",
    );

    this._emitEvent(state, "start", { waitingForFiles: true });
    this._emitTerminalText(state, "zmodemSendingStarted");

    void (async () => {
      try {
        await this._driveSession(state);
        if (!state.active || state.cancelRequested) {
          return;
        }
        await this._beginUpload(state);
      } catch (error) {
        logToFile(
          `ZMODEM upload bootstrap failed: ${error?.message || error}`,
          "ERROR",
        );
        this._finishSession(state, "error", error?.message || String(error));
      }
    })();
  }

  /**
   * 对端 sz 若发送 ZSINIT（转义能力协商），协议状态机不处理该帧；
   * lrzsz 会等待 ZACK，这里检测到后直接代答一次，避免无谓超时。
   */
  _respondZsinit(state) {
    if (
      !state.zsinitAcked &&
      findSubarray(state.pendingInput, ZSINIT_PATTERN) !== -1
    ) {
      state.zsinitAcked = true;
      try {
        this._writeToStream(state, ZACK_HEADER.withCount(0).encode());
      } catch (error) {
        logToFile(`ZMODEM ZSINIT ack failed: ${error.message}`, "DEBUG");
      }
    }
  }

  // ------------------------------------------------------------------
  // 上传流程
  // ------------------------------------------------------------------

  async _beginUpload(state) {
    const filePaths = await this._pickUploadFiles(state);
    if (!state.active || state.cancelRequested) {
      return;
    }
    if (!filePaths || !filePaths.length) {
      this._cancelSession(state, "user");
      return;
    }

    const stats = await Promise.all(
      filePaths.map(async (fp) => {
        try {
          const s = await fs.promises.stat(fp);
          return s.isFile() ? { fp, s } : null;
        } catch {
          return null;
        }
      }),
    );
    const valid = stats.filter(Boolean);
    if (!valid.length) {
      this._cancelSession(state, "no-files");
      return;
    }

    state.filesTotal = valid.length;
    state.uploadQueue = valid;
    this._emitEvent(state, "offer", {
      fileName: valid.map((item) => path.basename(item.fp)).join(", "),
      fileSize: valid.reduce((total, item) => total + item.s.size, 0),
      filesTotal: state.filesTotal,
      batchSummary: true,
    });

    await this._startNextUploadFile(state);
    await this._driveSession(state);
  }

  async _startNextUploadFile(state) {
    const next = state.uploadQueue && state.uploadQueue.shift();
    if (!next) {
      // 全部文件发送完毕，请求结束会话（后续由对端 ZFIN 触发 SessionComplete）
      state.machine.finishSession();
      return;
    }

    const fh = await fs.promises.open(next.fp, "r");
    state.uploadActive = { fp: next.fp, s: next.s, fh };
    state.machine.startFile(
      path.basename(next.fp),
      next.s.size,
      Math.floor(next.s.mtimeMs),
    );
    state.currentFile = {
      name: path.basename(next.fp),
      size: next.s.size,
      transferred: 0,
      savePath: next.fp,
    };
    this._emitEvent(state, "offer", {
      fileName: path.basename(next.fp),
      fileSize: next.s.size,
      filesTotal: state.filesTotal,
    });
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

  // ------------------------------------------------------------------
  // 状态机驱动
  // ------------------------------------------------------------------

  /**
   * 驱动协议状态机：喂入待处理字节、取出发送字节、处理事件与文件数据。
   * feedOutput / 文件请求回调均会汇入此处，driving 标记防止重入。
   *
   * zmodem2 的 feedIncoming 语义：返回值 n 表示本次调用只消费到输入的第 n 字节；
   * 返回 0 且入口无阻塞条件时，表示不完整帧头已整体吸收进内部缓冲，
   * 必须丢弃这批字节（不可重喂，否则会重复计入帧头缓冲导致解析错误）。
   */
  async _driveSession(state) {
    if (!state.machine || state.finished) {
      return;
    }
    if (state.driving) {
      state.driveAgain = true;
      return;
    }
    state.driving = true;
    try {
      let progressed = true;
      while (progressed && !state.finished && state.machine) {
        progressed = false;
        state.driveAgain = false;

        // 1) 处理事件与文件数据（接收写盘 / 发送读盘）
        if (await this._pumpMachine(state)) {
          progressed = true;
        }
        if (state.finished || !state.machine) {
          break;
        }

        // 2) 取出待发送字节写入 SSH 流
        const outgoing = state.machine.drainOutgoing();
        if (outgoing.length) {
          this._writeToStream(state, outgoing);
          progressed = true;
        }

        // 3) 喂入待处理字节
        if (
          state.pendingInput.length &&
          !state.finished &&
          this._canAbsorbInput(state)
        ) {
          let consumed = 0;
          try {
            consumed = state.machine.feedIncoming(state.pendingInput);
          } catch (error) {
            logToFile(
              `ZMODEM protocol error: process=${state.processId}, ${error?.message || error}`,
              "WARN",
            );
            this._finishSession(
              state,
              "error",
              error?.message || String(error),
            );
            return;
          }
          if (consumed > 0) {
            state.pendingInput = state.pendingInput.subarray(consumed);
          } else {
            // 入口无阻塞条件且返回 0：不完整帧头已吸收全部输入，直接丢弃
            state.pendingInput = Buffer.alloc(0);
          }
          progressed = true;
        }

        if (state.driveAgain) {
          progressed = true;
        }
      }
    } finally {
      state.driving = false;
    }
  }

  /**
   * 判断状态机当前是否可吸收输入（复刻 feedIncoming 入口阻塞条件；
   * 阻塞时返回 0 且不吸收任何字节，此时字节必须保留待后续重试）。
   */
  _canAbsorbInput(state) {
    const machine = state.machine;
    if (!machine) {
      return false;
    }
    if (machine.hasOutgoing()) {
      return false;
    }
    if (machine.state === 7) {
      return false;
    }
    if (state.direction === "download") {
      return !machine.hasFileData() && !machine.pendingEventsFull();
    }
    return machine.pendingRequest === null;
  }

  /** 处理状态机事件、接收文件数据、响应发送文件请求；返回是否有动作 */
  async _pumpMachine(state) {
    let acted = false;
    const machine = state.machine;
    if (!machine || state.finished) {
      return acted;
    }

    // 事件
    if (state.direction === "download") {
      let event = machine.pollEvent();
      while (event) {
        acted = true;
        await this._handleReceiverEvent(state, event);
        if (state.finished) {
          return acted;
        }
        event = machine.pollEvent();
      }

      // 接收中的文件数据
      let data = machine.drainFile();
      while (data && data.length) {
        acted = true;
        this._writeReceivedChunk(state, data);
        data = machine.drainFile();
      }
    } else {
      let event = machine.pollEvent();
      while (event) {
        acted = true;
        await this._handleSenderEvent(state, event);
        if (state.finished) {
          return acted;
        }
        event = machine.pollEvent();
      }

      // 发送文件数据请求
      const request = machine.pollFile();
      if (request) {
        acted = true;
        await this._feedUploadChunk(state, request);
      }
    }

    return acted;
  }

  async _handleReceiverEvent(state, event) {
    if (event === "FileStart") {
      const fileName = path.basename(
        String(state.machine.getFileName() || `zmodem-${Date.now()}`),
      );
      const fileSize = Number(state.machine.getFileSize()) || 0;

      let savePath;
      let writeStream;
      try {
        const saveRoot = await this._ensureSaveRoot();
        savePath = await uniqueSavePath(saveRoot, fileName);
        writeStream = fs.createWriteStream(savePath);
      } catch (error) {
        logToFile(`ZMODEM save failed: ${error.message}`, "ERROR");
        this._finishSession(state, "error", error.message);
        return;
      }

      state.currentFile = {
        name: fileName,
        size: fileSize,
        transferred: 0,
        savePath,
        writeStream,
      };
      this._emitEvent(state, "offer", { fileName, fileSize });
      return;
    }

    if (event === "FileComplete") {
      const current = state.currentFile;
      state.currentFile = null;
      if (current && current.writeStream) {
        await new Promise((resolve) => {
          current.writeStream.end(resolve);
        });
      }
      state.filesDone += 1;
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
      return;
    }

    if (event === "SessionComplete") {
      this._finishSession(state, "complete");
    }
  }

  async _handleSenderEvent(state, event) {
    if (event === "FileComplete") {
      const current = state.currentFile;
      state.currentFile = null;
      const active = state.uploadActive;
      state.uploadActive = null;
      if (active && active.fh) {
        try {
          await active.fh.close();
        } catch {
          /* ignore */
        }
      }
      state.filesDone += 1;
      this._emitTerminalText(state, "zmodemFileSent", {
        name: current?.name || "unknown",
        size: formatBytes(current?.size || 0),
      });
      this._emitEvent(state, "file-done", {
        fileName: current?.name || null,
        fileSize: current?.size || 0,
        transferred: current?.transferred || current?.size || 0,
        filesDone: state.filesDone,
      });

      if (state.uploadQueue && state.uploadQueue.length) {
        await this._startNextUploadFile(state);
      } else {
        state.machine.finishSession();
      }
      return;
    }

    if (event === "SessionComplete") {
      this._finishSession(state, "complete");
    }
  }

  _writeReceivedChunk(state, data) {
    const current = state.currentFile;
    if (!current || !current.writeStream) {
      return;
    }
    const buf = Buffer.from(data);
    current.writeStream.write(buf);
    current.transferred += buf.length;
    this._maybeEmitProgress(state);
  }

  async _feedUploadChunk(state, request) {
    const active = state.uploadActive;
    const current = state.currentFile;
    if (!active || !active.fh || !current) {
      throw new Error("upload file handle missing");
    }
    const remaining = Math.max(0, current.size - request.offset);
    const len = Math.min(request.len, remaining);
    if (len <= 0) {
      throw new Error(`invalid upload request offset=${request.offset}`);
    }
    const buf = Buffer.alloc(len);
    const { bytesRead } = await active.fh.read(buf, 0, len, request.offset);
    if (bytesRead <= 0) {
      throw new Error(
        `unexpected EOF reading ${current.name} at offset ${request.offset}`,
      );
    }
    // zmodem2 状态机要求写入字节数不超过请求长度
    state.machine.feedFile(buf.subarray(0, bytesRead));
    current.transferred = request.offset + bytesRead;
    this._maybeEmitProgress(state);
  }

  async _ensureSaveRoot() {
    const saveRoot = this._getSaveRoot();
    await fs.promises.mkdir(saveRoot, { recursive: true });
    return saveRoot;
  }

  _writeToStream(state, octets) {
    if (!state.stream || typeof state.stream.write !== "function") {
      return;
    }
    try {
      state.stream.write(Buffer.from(octets));
    } catch (error) {
      logToFile(`ZMODEM send error: ${error.message}`, "WARN");
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
    this._cancelSession(state, "user");
    return true;
  }

  _cancelSession(state, reason) {
    if (state.cancelRequested) {
      return;
    }
    state.cancelRequested = true;
    // zmodem2 未内建中止：直接发送 5×CAN + 5×BS 取消序列，对端将中止传输
    this._writeToStream(state, CANCEL_SEQUENCE);
    this._finishSession(state, "cancelled", reason);
  }

  _finishSession(state, status, detail) {
    if (!state || state.finished) {
      return;
    }
    state.finished = true;
    state.active = false;
    state.machine = null;
    this._clearScanTailTimer(state);
    state.pendingInput = Buffer.alloc(0);
    state.scanTail = Buffer.alloc(0);
    state.uploadQueue = [];

    const currentFile = state.currentFile;
    state.currentFile = null;
    if (currentFile && currentFile.writeStream) {
      try {
        currentFile.writeStream.end();
      } catch {
        /* ignore */
      }
    }
    const uploadActive = state.uploadActive;
    state.uploadActive = null;
    if (uploadActive && uploadActive.fh) {
      uploadActive.fh.close().catch(() => {});
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
  }

  destroyProcess(id) {
    const state = this._findState(id);
    if (!state) {
      return false;
    }

    if (state.active) {
      this._cancelSession(state, "connection-closed");
    }

    this._clearScanTailTimer(state);
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
          this._cancelSession(state, "timeout");
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
