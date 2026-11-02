const { logToFile } = require("../utils/logger");
const {
  TERMINAL_IO_DEFAULTS,
  TERMINAL_IO_MESSAGE_TYPES,
  getTerminalIOMailboxOutputChannel,
  normalizeMailboxProcessId,
} = require("../../shared/contracts/terminalIOMailboxProtocol");

const normalizePositiveInteger = (value, fallback) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }

  return Math.floor(numericValue);
};

/**
 * Batches terminal output to the renderer and applies its flow control.
 *
 * By default the mailbox counts unacknowledged output and pauses the
 * process's flow-control target. A mailbox created with `remoteFlow`
 * (`{ack(bytes), pause(reason), resume(reason)}`) counts nothing: ACKs and
 * pause reasons go to the producer — the core, for terminal pipe channels.
 */
class TerminalIOMailboxManager {
  constructor(options = {}) {
    this.getMainWindow =
      typeof options.getMainWindow === "function"
        ? options.getMainWindow
        : () => null;

    this.mailboxes = new Map();
    this.aliasToPrimary = new Map();
  }

  _resolvePrimaryProcessId(processId) {
    const normalizedProcessId = normalizeMailboxProcessId(processId);
    if (normalizedProcessId === null) {
      return null;
    }

    return this.aliasToPrimary.get(normalizedProcessId) || normalizedProcessId;
  }

  _getMailbox(processId) {
    const primaryProcessId = this._resolvePrimaryProcessId(processId);
    if (primaryProcessId === null) {
      return null;
    }

    return this.mailboxes.get(primaryProcessId) || null;
  }

  _createMailboxState(primaryProcessId) {
    return {
      primaryProcessId,
      aliases: new Set(),
      pendingAckBytes: 0,
      bufferedBytes: 0,
      pausedReasons: new Set(),
      isFlowPaused: false,
      flowRecoveryTimer: null,
      resizeTimer: null,
      pendingResize: null,
      lastResize: null,
      getFlowControlTarget: null,
      applyResize: null,
      remoteFlow: null,
      // Renderer ACKs also cover untracked notices; they are no credit.
      untrackedAckBytes: 0,
      outputBatch: [],
      outputBatchBytes: 0,
      outputBatchTimer: null,
    };
  }

  _ensureMailbox(processId) {
    const normalizedProcessId = normalizeMailboxProcessId(processId);
    if (normalizedProcessId === null) {
      return null;
    }

    const primaryProcessId =
      this.aliasToPrimary.get(normalizedProcessId) || normalizedProcessId;

    if (!this.mailboxes.has(primaryProcessId)) {
      this.mailboxes.set(
        primaryProcessId,
        this._createMailboxState(primaryProcessId),
      );
    }

    return this.mailboxes.get(primaryProcessId);
  }

  _setAliases(mailbox, aliases = []) {
    mailbox.aliases.forEach((aliasProcessId) => {
      this.aliasToPrimary.delete(aliasProcessId);
    });
    mailbox.aliases.clear();

    aliases.forEach((aliasProcessId) => {
      const normalizedAlias = normalizeMailboxProcessId(aliasProcessId);
      if (
        normalizedAlias === null ||
        normalizedAlias === mailbox.primaryProcessId
      ) {
        return;
      }

      mailbox.aliases.add(normalizedAlias);
      this.aliasToPrimary.set(normalizedAlias, mailbox.primaryProcessId);
    });
  }

  _clearFlowRecoveryTimer(mailbox) {
    if (mailbox.flowRecoveryTimer !== null) {
      clearTimeout(mailbox.flowRecoveryTimer);
      mailbox.flowRecoveryTimer = null;
    }
  }

  _clearResizeTimer(mailbox) {
    if (mailbox.resizeTimer !== null) {
      clearTimeout(mailbox.resizeTimer);
      mailbox.resizeTimer = null;
    }
  }

  _getFlowControlTarget(mailbox) {
    if (typeof mailbox.getFlowControlTarget !== "function") {
      return null;
    }

    try {
      return mailbox.getFlowControlTarget();
    } catch (error) {
      logToFile(
        `Failed to resolve mailbox flow-control target for process ${mailbox.primaryProcessId}: ${error.message}`,
        "WARN",
      );
      return null;
    }
  }

  _updateFlowControl(mailbox) {
    if (!mailbox || mailbox.remoteFlow) {
      return;
    }

    const pauseThreshold = TERMINAL_IO_DEFAULTS.backpressurePauseThresholdBytes;
    const resumeThreshold = Math.floor(pauseThreshold / 2);
    const totalPendingBytes = mailbox.pendingAckBytes + mailbox.bufferedBytes;
    const shouldPause =
      mailbox.pausedReasons.size > 0 || totalPendingBytes >= pauseThreshold;
    const shouldResume =
      mailbox.pausedReasons.size === 0 && totalPendingBytes <= resumeThreshold;
    const flowControlTarget = this._getFlowControlTarget(mailbox);

    if (shouldPause && !mailbox.isFlowPaused) {
      if (flowControlTarget && typeof flowControlTarget.pause === "function") {
        try {
          flowControlTarget.pause();
        } catch (error) {
          logToFile(
            `Failed to pause mailbox flow-control target for process ${mailbox.primaryProcessId}: ${error.message}`,
            "WARN",
          );
        }
      }
      mailbox.isFlowPaused = true;
    } else if (shouldResume && mailbox.isFlowPaused) {
      if (flowControlTarget && typeof flowControlTarget.resume === "function") {
        try {
          flowControlTarget.resume();
        } catch (error) {
          logToFile(
            `Failed to resume mailbox flow-control target for process ${mailbox.primaryProcessId}: ${error.message}`,
            "WARN",
          );
        }
      }
      mailbox.isFlowPaused = false;
    }

    if (mailbox.isFlowPaused && mailbox.pausedReasons.size === 0) {
      if (mailbox.flowRecoveryTimer === null) {
        mailbox.flowRecoveryTimer = setTimeout(() => {
          mailbox.flowRecoveryTimer = null;
          this._updateFlowControl(mailbox);
        }, TERMINAL_IO_DEFAULTS.backpressureRecoveryIntervalMs);
      }
    } else {
      this._clearFlowRecoveryTimer(mailbox);
    }
  }

  _emitMailboxPayload(mailbox, messages) {
    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
      return false;
    }

    const channel = getTerminalIOMailboxOutputChannel(mailbox.primaryProcessId);
    if (!channel) {
      return false;
    }

    if (!messages.length) {
      return false;
    }

    if (messages.length === 1) {
      mainWindow.webContents.send(channel, messages[0]);
    } else {
      mainWindow.webContents.send(channel, messages);
    }
    return true;
  }

  _clearOutputBatchTimer(mailbox) {
    if (mailbox.outputBatchTimer !== null) {
      clearTimeout(mailbox.outputBatchTimer);
      mailbox.outputBatchTimer = null;
    }
  }

  _countOutputPayloadBytes(payload) {
    if (Buffer.isBuffer(payload)) {
      return payload.length;
    }
    if (typeof payload === "string") {
      return Buffer.byteLength(payload, "utf8");
    }
    return 0;
  }

  _flushOutputBatch(mailbox) {
    this._clearOutputBatchTimer(mailbox);
    if (!mailbox.outputBatch.length) {
      return false;
    }

    const pending = mailbox.outputBatch;
    mailbox.outputBatch = [];
    mailbox.outputBatchBytes = 0;

    const messages = pending.map((item) => ({
      type: TERMINAL_IO_MESSAGE_TYPES.OUTPUT,
      processId: mailbox.primaryProcessId,
      data: item.payload,
    }));

    const sent = this._emitMailboxPayload(mailbox, messages);
    if (!sent) {
      return false;
    }

    if (!mailbox.remoteFlow) {
      for (const item of pending) {
        if (item.trackBackpressure && item.bytes > 0) {
          mailbox.pendingAckBytes += item.bytes;
        }
      }
    }
    this._updateFlowControl(mailbox);
    return true;
  }

  _scheduleOutputBatchFlush(mailbox) {
    if (mailbox.outputBatchTimer !== null) {
      return;
    }
    mailbox.outputBatchTimer = setTimeout(() => {
      mailbox.outputBatchTimer = null;
      this._flushOutputBatch(mailbox);
    }, TERMINAL_IO_DEFAULTS.outputDispatchIntervalMs);
  }

  _enqueueBatchedOutput(mailbox, payload, trackBackpressure) {
    // 字节数只计算一次：入队累计与 flush 后的 ACK 统计共用
    const bytes = trackBackpressure
      ? this._countOutputPayloadBytes(payload)
      : 0;
    mailbox.outputBatch.push({ payload, trackBackpressure, bytes });
    mailbox.outputBatchBytes += bytes;

    if (
      mailbox.outputBatchBytes >=
      TERMINAL_IO_DEFAULTS.outputDispatchThresholdBytes
    ) {
      this._flushOutputBatch(mailbox);
      return;
    }
    this._scheduleOutputBatchFlush(mailbox);
  }

  _emitMailboxMessage(mailbox, message) {
    return this._emitMailboxPayload(mailbox, [message]);
  }

  _flushResize(mailbox) {
    this._clearResizeTimer(mailbox);

    if (!mailbox.pendingResize || typeof mailbox.applyResize !== "function") {
      return false;
    }

    const nextResize = mailbox.pendingResize;
    mailbox.pendingResize = null;

    try {
      const applied = mailbox.applyResize(nextResize.cols, nextResize.rows);
      if (applied === false) {
        return false;
      }

      mailbox.lastResize = nextResize;
      return true;
    } catch (error) {
      logToFile(
        `Failed to apply mailbox resize for process ${mailbox.primaryProcessId}: ${error.message}`,
        "ERROR",
      );
      return false;
    }
  }

  configureProcess(processId, options = {}) {
    const mailbox = this._ensureMailbox(processId);
    if (!mailbox) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(options, "aliases")) {
      this._setAliases(mailbox, options.aliases);
    }

    if (typeof options.getFlowControlTarget === "function") {
      mailbox.getFlowControlTarget = options.getFlowControlTarget;
    }

    if (typeof options.applyResize === "function") {
      mailbox.applyResize = options.applyResize;
    }

    if (Object.prototype.hasOwnProperty.call(options, "remoteFlow")) {
      // A new producer (e.g. after a reconnect) starts unpaused with fresh
      // credit: hand it the reasons still in effect.
      mailbox.remoteFlow = options.remoteFlow || null;
      mailbox.pendingAckBytes = 0;
      mailbox.untrackedAckBytes = 0;
      if (mailbox.remoteFlow) {
        mailbox.isFlowPaused = false;
        this._clearFlowRecoveryTimer(mailbox);
        for (const reason of mailbox.pausedReasons) {
          this._callRemoteFlow(mailbox, "pause", reason);
        }
      }
    }

    return mailbox;
  }

  createMailbox(processId, options = {}) {
    this.configureProcess(processId, options);

    return {
      emitOutput: (payload, emitOptions = {}) =>
        this.emitOutput(processId, payload, emitOptions),
      setBufferedBytes: (bytes) => this.setBufferedBytes(processId, bytes),
      requestResize: (cols, rows, resizeOptions = {}) =>
        this.requestResize(processId, cols, rows, resizeOptions),
      pause: (reason = "renderer") => this.pause(processId, reason),
      resume: (reason = "renderer") => this.resume(processId, reason),
      destroy: () => this.destroyProcess(processId),
    };
  }

  emitOutput(processId, payload, options = {}) {
    const mailbox = this._ensureMailbox(processId);
    if (!mailbox) {
      return false;
    }

    const trackBackpressure = options.trackBackpressure !== false;

    if (!trackBackpressure) {
      void this._flushOutputBatch(mailbox);
      const sent = this._emitMailboxMessage(mailbox, {
        type: TERMINAL_IO_MESSAGE_TYPES.OUTPUT,
        processId: mailbox.primaryProcessId,
        data: payload,
      });
      if (sent && mailbox.remoteFlow) {
        mailbox.untrackedAckBytes += this._countOutputPayloadBytes(payload);
      }
      return Boolean(sent);
    }

    this._enqueueBatchedOutput(mailbox, payload, true);
    return true;
  }

  setBufferedBytes(processId, bytes) {
    const mailbox = this._ensureMailbox(processId);
    if (!mailbox) {
      return false;
    }

    mailbox.bufferedBytes = normalizePositiveInteger(bytes, 0);
    this._updateFlowControl(mailbox);
    return true;
  }

  handleAck(processId, bytes) {
    const mailbox = this._getMailbox(processId);
    if (!mailbox) {
      return false;
    }

    const ackBytes = normalizePositiveInteger(bytes, -1);
    if (ackBytes <= 0) {
      return false;
    }

    if (mailbox.remoteFlow) {
      const untracked = Math.min(mailbox.untrackedAckBytes, ackBytes);
      mailbox.untrackedAckBytes -= untracked;
      if (ackBytes > untracked) {
        this._callRemoteFlow(mailbox, "ack", ackBytes - untracked);
      }
      return true;
    }

    mailbox.pendingAckBytes = Math.max(0, mailbox.pendingAckBytes - ackBytes);
    this._updateFlowControl(mailbox);
    return true;
  }

  _callRemoteFlow(mailbox, method, argument) {
    try {
      mailbox.remoteFlow[method](argument);
    } catch (error) {
      logToFile(
        `Remote flow control ${method} failed for process ${mailbox.primaryProcessId}: ${error.message}`,
        "WARN",
      );
    }
  }

  requestResize(processId, cols, rows, options = {}) {
    const mailbox =
      this._getMailbox(processId) || this._ensureMailbox(processId);
    if (!mailbox || typeof mailbox.applyResize !== "function") {
      return false;
    }

    const nextResize = {
      cols: Math.max(1, normalizePositiveInteger(cols, 1)),
      rows: Math.max(1, normalizePositiveInteger(rows, 1)),
    };

    if (
      mailbox.lastResize &&
      mailbox.lastResize.cols === nextResize.cols &&
      mailbox.lastResize.rows === nextResize.rows &&
      mailbox.pendingResize === null &&
      !options.force
    ) {
      return false;
    }

    mailbox.pendingResize = nextResize;

    if (options.immediate === true) {
      return this._flushResize(mailbox);
    }

    if (mailbox.resizeTimer !== null) {
      return true;
    }

    mailbox.resizeTimer = setTimeout(() => {
      mailbox.resizeTimer = null;
      this._flushResize(mailbox);
    }, TERMINAL_IO_DEFAULTS.resizeDebounceMs);

    return true;
  }

  resetResizeState(processId) {
    const mailbox = this._getMailbox(processId);
    if (!mailbox) {
      return false;
    }

    this._clearResizeTimer(mailbox);
    mailbox.pendingResize = null;
    mailbox.lastResize = null;
    return true;
  }

  pause(processId, reason = "renderer") {
    const mailbox =
      this._getMailbox(processId) || this._ensureMailbox(processId);
    if (!mailbox) {
      return false;
    }

    const key = String(reason || "renderer");
    if (mailbox.remoteFlow) {
      if (!mailbox.pausedReasons.has(key)) {
        this._callRemoteFlow(mailbox, "pause", key);
      }
    }
    mailbox.pausedReasons.add(key);
    this._updateFlowControl(mailbox);
    return true;
  }

  resume(processId, reason = "renderer") {
    const mailbox = this._getMailbox(processId);
    if (!mailbox) {
      return false;
    }

    const key = String(reason || "renderer");
    if (mailbox.remoteFlow && mailbox.pausedReasons.has(key)) {
      this._callRemoteFlow(mailbox, "resume", key);
    }
    mailbox.pausedReasons.delete(key);
    this._updateFlowControl(mailbox);
    return true;
  }

  destroyProcess(processId) {
    const mailbox = this._getMailbox(processId);
    if (!mailbox) {
      return false;
    }

    void this._flushOutputBatch(mailbox);
    this._clearFlowRecoveryTimer(mailbox);
    this._clearResizeTimer(mailbox);

    mailbox.aliases.forEach((aliasProcessId) => {
      this.aliasToPrimary.delete(aliasProcessId);
    });

    this.mailboxes.delete(mailbox.primaryProcessId);
    return true;
  }

  handleRendererMessage(processId, message, handlers = {}) {
    const normalizedProcessId = normalizeMailboxProcessId(processId);
    if (
      normalizedProcessId === null ||
      !message ||
      typeof message !== "object"
    ) {
      return false;
    }

    const messageType = message.type;
    switch (messageType) {
      case TERMINAL_IO_MESSAGE_TYPES.INPUT:
        if (typeof handlers.writeInput !== "function") {
          return false;
        }
        return handlers.writeInput(normalizedProcessId, message.data) !== false;
      case TERMINAL_IO_MESSAGE_TYPES.ACK:
        return this.handleAck(normalizedProcessId, message.bytes);
      case TERMINAL_IO_MESSAGE_TYPES.RESIZE:
        return this.requestResize(
          normalizedProcessId,
          message.cols,
          message.rows,
          {
            force: message.force === true,
            immediate: message.immediate === true,
          },
        );
      case TERMINAL_IO_MESSAGE_TYPES.PAUSE:
        return this.pause(normalizedProcessId, message.reason || "renderer");
      case TERMINAL_IO_MESSAGE_TYPES.RESUME:
        return this.resume(normalizedProcessId, message.reason || "renderer");
      default:
        return false;
    }
  }
}

module.exports = TerminalIOMailboxManager;
