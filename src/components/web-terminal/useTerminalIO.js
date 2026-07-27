import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMMENT_LINE_SEND_INTERVAL_MS,
  INPUT_SEND_CHUNK_SIZE,
  INPUT_SEND_FRAME_DELAY_MS,
  INPUT_SEND_MAX_CHUNKS_PER_FRAME,
  processMultilineInput,
  shouldChunkInputPayload,
} from "../../modules/terminal/controller/terminalInput.js";
import { processCache } from "../../modules/terminal/controller/terminalSessionStore.js";

const OFFLINE_INPUT_MAX_CHARS = 16 * 1024;
const LARGE_PASTE_OFFLINE_THRESHOLD = 256;

const matchesTabPayload = (payload, tabId) => {
  if (!payload || tabId === undefined || tabId === null) {
    return false;
  }
  const payloadTabId = payload.tabId ?? payload.sessionId ?? payload.id;
  return String(payloadTabId) === String(tabId);
};

/**
 * Input queue, paste pipeline, and chunked send path for WebTerminal.
 *
 * `suggestionUiRef` is a late-bound ref populated by the suggestion hook so
 * paste can clear the suggestion window without creating a circular hook dep.
 */
export function useTerminalIO({
  tabId,
  terminalIOMailboxRef,
  eventManager,
  suggestionUiRef,
}) {
  const lastPasteTimeRef = useRef(0);
  const inputQueueRef = useRef([]);
  const inputQueueBytesRef = useRef(0);
  const inputQueueDrainHandleRef = useRef(null);
  const inputQueueDrainHandleTypeRef = useRef(null);

  const isOfflineRef = useRef(false);
  const offlineBufferRef = useRef("");
  const [offlineBufferState, setOfflineBufferState] = useState({
    active: false,
    chars: 0,
    pendingSend: false,
  });

  const setOfflineActive = useCallback((active) => {
    isOfflineRef.current = active === true;
    setOfflineBufferState((prev) => ({
      ...prev,
      active: active === true,
      chars: offlineBufferRef.current.length,
      pendingSend:
        active === true
          ? false
          : offlineBufferRef.current.length > 0
            ? true
            : false,
    }));
  }, []);

  const appendOfflineBuffer = useCallback((text) => {
    const incoming = typeof text === "string" ? text : String(text || "");
    if (!incoming) {
      return { accepted: true, reason: null };
    }

    const remaining = Math.max(
      0,
      OFFLINE_INPUT_MAX_CHARS - offlineBufferRef.current.length,
    );
    if (remaining <= 0) {
      return { accepted: false, reason: "full" };
    }

    offlineBufferRef.current += incoming.slice(0, remaining);
    setOfflineBufferState({
      active: true,
      chars: offlineBufferRef.current.length,
      pendingSend: false,
    });

    if (incoming.length > remaining) {
      return { accepted: false, reason: "full" };
    }
    return { accepted: true, reason: null };
  }, []);

  const clearOfflineBuffer = useCallback(() => {
    offlineBufferRef.current = "";
    setOfflineBufferState((prev) => ({
      ...prev,
      chars: 0,
      pendingSend: false,
    }));
  }, []);

  const flushOfflineBuffer = useCallback(
    (processId) => {
      const buffered = offlineBufferRef.current;
      if (!buffered) {
        setOfflineBufferState((prev) => ({
          ...prev,
          chars: 0,
          pendingSend: false,
        }));
        return false;
      }

      const targetProcessId = processId ?? processCache[tabId];
      if (targetProcessId === undefined || targetProcessId === null) {
        return false;
      }

      offlineBufferRef.current = "";
      setOfflineBufferState((prev) => ({
        ...prev,
        chars: 0,
        pendingSend: false,
      }));

      // Reuse normal enqueue path after clearing offline flag
      isOfflineRef.current = false;
      const forceChunk = shouldChunkInputPayload(buffered);
      if (!forceChunk) {
        const mailbox = terminalIOMailboxRef.current;
        if (
          mailbox &&
          String(mailbox.getProcessId()) === String(targetProcessId)
        ) {
          mailbox.sendInput(buffered);
        } else if (window.terminalAPI?.sendToProcess) {
          window.terminalAPI.sendToProcess(targetProcessId, buffered);
        }
        return true;
      }

      const chunkSize = INPUT_SEND_CHUNK_SIZE;
      for (let offset = 0; offset < buffered.length; offset += chunkSize) {
        const chunk = buffered.slice(offset, offset + chunkSize);
        inputQueueRef.current.push({
          processId: targetProcessId,
          input: chunk,
        });
        inputQueueBytesRef.current += chunk.length;
      }
      // schedule drain via existing mechanism — call schedule after definition through ref
      return { scheduled: true, processId: targetProcessId };
    },
    [tabId, terminalIOMailboxRef],
  );

  useEffect(() => {
    if (tabId === undefined || tabId === null) {
      return undefined;
    }

    const handleSessionRestored = (event) => {
      const detail = event?.detail || {};
      if (detail.tabId && String(detail.tabId) !== String(tabId)) {
        return;
      }
      setOfflineActive(false);
    };

    const handleSessionRestoreFailed = (event) => {
      const detail = event?.detail || {};
      if (detail.tabId && String(detail.tabId) !== String(tabId)) {
        return;
      }
      // 最终失败时清空缓冲，避免误发危险命令
      offlineBufferRef.current = "";
      isOfflineRef.current = false;
      setOfflineBufferState({
        active: false,
        chars: 0,
        pendingSend: false,
      });
    };

    const handleTabConnectionStatus = (payload) => {
      if (!matchesTabPayload(payload, tabId)) {
        return;
      }
      const status = payload?.connectionStatus || {};
      if (status.isConnected === false) {
        setOfflineActive(true);
        return;
      }
      if (status.isConnected === true && status.isConnecting !== true) {
        setOfflineActive(false);
      }
    };

    const cleanups = [];

    // 可安全卸载的订阅（返回 cleanup）
    if (typeof window.terminalAPI?.onTabConnectionStatus === "function") {
      const cleanup = window.terminalAPI.onTabConnectionStatus(
        handleTabConnectionStatus,
      );
      if (typeof cleanup === "function") {
        cleanups.push(cleanup);
      }
    }
    if (typeof window.terminalAPI?.onTerminalSessionRestored === "function") {
      const cleanup = window.terminalAPI.onTerminalSessionRestored((data) => {
        if (!matchesTabPayload(data, tabId)) {
          return;
        }
        setOfflineActive(false);
      });
      if (typeof cleanup === "function") {
        cleanups.push(cleanup);
      }
    }
    if (
      typeof window.terminalAPI?.onTerminalSessionRestoreFailed === "function"
    ) {
      const cleanup = window.terminalAPI.onTerminalSessionRestoreFailed(
        (data) => {
          if (!matchesTabPayload(data, tabId)) {
            return;
          }
          offlineBufferRef.current = "";
          isOfflineRef.current = false;
          setOfflineBufferState({
            active: false,
            chars: 0,
            pendingSend: false,
          });
        },
      );
      if (typeof cleanup === "function") {
        cleanups.push(cleanup);
      }
    }

    window.addEventListener("terminalSessionRestored", handleSessionRestored);
    window.addEventListener(
      "terminalSessionRestoreFailed",
      handleSessionRestoreFailed,
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      window.removeEventListener(
        "terminalSessionRestored",
        handleSessionRestored,
      );
      window.removeEventListener(
        "terminalSessionRestoreFailed",
        handleSessionRestoreFailed,
      );
    };
  }, [setOfflineActive, tabId]);

  const sendInputToProcess = useCallback(
    (processId, input) => {
      if (
        processId === undefined ||
        processId === null ||
        input === undefined ||
        input === null
      ) {
        return;
      }

      const inputStr = typeof input === "string" ? input : input.toString();
      if (!inputStr) {
        return;
      }

      if (isOfflineRef.current) {
        appendOfflineBuffer(inputStr);
        return;
      }

      const mailbox = terminalIOMailboxRef.current;
      if (mailbox && String(mailbox.getProcessId()) === String(processId)) {
        mailbox.sendInput(inputStr);
        return;
      }

      if (window.terminalAPI?.sendToProcess) {
        window.terminalAPI.sendToProcess(processId, inputStr);
      }
    },
    [appendOfflineBuffer, terminalIOMailboxRef],
  );

  const cancelInputQueueDrain = useCallback(() => {
    if (inputQueueDrainHandleRef.current === null) {
      return;
    }

    if (
      inputQueueDrainHandleTypeRef.current === "raf" &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(inputQueueDrainHandleRef.current);
    } else {
      clearTimeout(inputQueueDrainHandleRef.current);
    }

    inputQueueDrainHandleRef.current = null;
    inputQueueDrainHandleTypeRef.current = null;
  }, []);

  const scheduleInputQueueDrain = useCallback(() => {
    if (inputQueueDrainHandleRef.current !== null) {
      return;
    }

    const runDrain = () => {
      inputQueueDrainHandleRef.current = null;
      inputQueueDrainHandleTypeRef.current = null;

      const queue = inputQueueRef.current;
      if (!queue.length) {
        return;
      }

      let processedChunks = 0;
      while (
        queue.length > 0 &&
        processedChunks < INPUT_SEND_MAX_CHUNKS_PER_FRAME
      ) {
        const chunkItem = queue.shift();
        if (!chunkItem) {
          continue;
        }

        inputQueueBytesRef.current = Math.max(
          0,
          inputQueueBytesRef.current - chunkItem.input.length,
        );
        sendInputToProcess(chunkItem.processId, chunkItem.input);
        processedChunks += 1;
      }

      if (queue.length > 0) {
        scheduleInputQueueDrain();
      }
    };

    if (
      INPUT_SEND_FRAME_DELAY_MS <= 16 &&
      typeof requestAnimationFrame === "function"
    ) {
      inputQueueDrainHandleTypeRef.current = "raf";
      inputQueueDrainHandleRef.current = requestAnimationFrame(runDrain);
      return;
    }

    inputQueueDrainHandleTypeRef.current = "timeout";
    inputQueueDrainHandleRef.current = setTimeout(
      runDrain,
      INPUT_SEND_FRAME_DELAY_MS,
    );
  }, [sendInputToProcess]);

  const enqueueInputToProcess = useCallback(
    (processId, input, options = {}) => {
      if (
        processId === undefined ||
        processId === null ||
        input === undefined ||
        input === null
      ) {
        return;
      }

      const inputStr = typeof input === "string" ? input : input.toString();
      if (!inputStr) {
        return;
      }

      if (isOfflineRef.current) {
        appendOfflineBuffer(inputStr);
        return;
      }

      const forceChunk = options.forceChunk === true;
      const chunkSize = Math.max(
        256,
        Math.floor(Number(options.chunkSize) || INPUT_SEND_CHUNK_SIZE),
      );
      const hasPendingQueue = inputQueueRef.current.length > 0;
      const shouldChunk =
        forceChunk || hasPendingQueue || shouldChunkInputPayload(inputStr);

      if (!shouldChunk) {
        sendInputToProcess(processId, inputStr);
        return;
      }

      for (let offset = 0; offset < inputStr.length; offset += chunkSize) {
        const chunk = inputStr.slice(offset, offset + chunkSize);
        inputQueueRef.current.push({ processId, input: chunk });
        inputQueueBytesRef.current += chunk.length;
      }

      scheduleInputQueueDrain();
    },
    [appendOfflineBuffer, scheduleInputQueueDrain, sendInputToProcess],
  );

  const sendOfflineBufferNow = useCallback(() => {
    const result = flushOfflineBuffer(processCache[tabId]);
    if (result && result.scheduled) {
      scheduleInputQueueDrain();
      return true;
    }
    return Boolean(result);
  }, [flushOfflineBuffer, scheduleInputQueueDrain, tabId]);

  const sendCommentLinesToProcess = useCallback(
    (processId, lines) => {
      if (!Array.isArray(lines) || lines.length === 0) {
        return;
      }

      let currentIndex = 0;
      const sendNextLine = () => {
        if (currentIndex >= lines.length) {
          return;
        }

        const line = lines[currentIndex] || "";
        const chunk = `${line}${currentIndex < lines.length - 1 ? "\n" : ""}`;
        enqueueInputToProcess(processId, chunk, { forceChunk: true });
        currentIndex += 1;

        if (currentIndex < lines.length) {
          eventManager.setTimeout(sendNextLine, COMMENT_LINE_SEND_INTERVAL_MS);
        }
      };

      sendNextLine();
    },
    [enqueueInputToProcess, eventManager],
  );

  const sendProcessedInputToProcess = useCallback(
    (processId, processedInput, options = {}) => {
      if (
        processId === undefined ||
        processId === null ||
        processedInput === undefined ||
        processedInput === null
      ) {
        return;
      }

      if (
        processedInput &&
        typeof processedInput === "object" &&
        processedInput.type === "multiline-with-comments"
      ) {
        sendCommentLinesToProcess(processId, processedInput.lines);
        return;
      }

      enqueueInputToProcess(processId, processedInput, options);
    },
    [enqueueInputToProcess, sendCommentLinesToProcess],
  );

  const markPasteIfAllowed = useCallback(() => {
    const now = Date.now();
    if (now - lastPasteTimeRef.current < 100) {
      return false;
    }

    lastPasteTimeRef.current = now;
    return true;
  }, []);

  const handlePasteText = useCallback(
    (text, options = {}) => {
      const processId = processCache[tabId];
      if (!text || !processId) {
        return { ok: false, reason: "no-process" };
      }

      if (
        isOfflineRef.current &&
        String(text).length > LARGE_PASTE_OFFLINE_THRESHOLD
      ) {
        return { ok: false, reason: "offline-paste-blocked" };
      }

      const suggestionUi = suggestionUiRef?.current;
      if (suggestionUi) {
        suggestionUi.setShowSuggestions?.(false);
        suggestionUi.setSuggestions?.([]);
        suggestionUi.setCurrentInput?.("");
        suggestionUi.setSuggestionsHiddenByEsc?.(false);
      }

      const processedText = processMultilineInput(text);
      sendProcessedInputToProcess(processId, processedText, {
        ...options,
        forceChunk: true,
      });
      return { ok: true, reason: null };
    },
    [sendProcessedInputToProcess, suggestionUiRef, tabId],
  );

  const clearInputQueue = useCallback(() => {
    cancelInputQueueDrain();
    inputQueueRef.current = [];
    inputQueueBytesRef.current = 0;
  }, [cancelInputQueueDrain]);

  return {
    lastPasteTimeRef,
    inputQueueRef,
    inputQueueBytesRef,
    sendInputToProcess,
    enqueueInputToProcess,
    sendProcessedInputToProcess,
    cancelInputQueueDrain,
    clearInputQueue,
    markPasteIfAllowed,
    handlePasteText,
    offlineBufferState,
    clearOfflineBuffer,
    sendOfflineBufferNow,
    isTerminalOffline: () => isOfflineRef.current,
  };
}
