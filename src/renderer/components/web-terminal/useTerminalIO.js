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

const matchesTabPayload = (payload, sessionKey) => {
  if (!payload || sessionKey === undefined || sessionKey === null) {
    return false;
  }
  const payloadTabId = payload.tabId ?? payload.sessionId ?? payload.id;
  return String(payloadTabId) === String(sessionKey);
};

/**
 * Input queue, paste pipeline, and chunked send path for WebTerminal.
 *
 * `suggestionUiRef` is a late-bound ref populated by the suggestion hook so
 * paste can clear the suggestion window without creating a circular hook dep.
 */
export function useTerminalIO({
  sessionKey,
  refreshKey,
  reconnectStatus,
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
  const [inputBlocked, setInputBlocked] = useState(false);
  const inputGenerationRef = useRef(0);

  const cancelInputQueueDrain = useCallback(() => {
    if (inputQueueDrainHandleRef.current === null) return;
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

  const clearInputQueue = useCallback(() => {
    inputGenerationRef.current += 1;
    cancelInputQueueDrain();
    inputQueueRef.current = [];
    inputQueueBytesRef.current = 0;
  }, [cancelInputQueueDrain]);

  const setOfflineActive = useCallback(
    (active) => {
      if (isOfflineRef.current !== active) clearInputQueue();
      isOfflineRef.current = active;
      setInputBlocked(active);
    },
    [clearInputQueue],
  );

  useEffect(() => {
    setOfflineActive(false);
    clearInputQueue();
    if (sessionKey === undefined || sessionKey === null) return undefined;

    const setForSession = (data, active) => {
      if (matchesTabPayload(data, sessionKey)) setOfflineActive(active);
    };
    const handleSessionRestored = (event) =>
      setForSession(event?.detail, false);
    const handleSessionRestoreFailed = (event) =>
      setForSession(event?.detail, true);
    const cleanups = [];
    const subscribe = (name, callback) => {
      const cleanup = window.terminalAPI?.[name]?.(callback);
      if (typeof cleanup === "function") cleanups.push(cleanup);
    };

    // Stop input as soon as the transport is lost, even if the old shell has
    // not emitted close. Transport recovery alone does not make a shell ready.
    for (const name of [
      "onConnectionLost",
      "onReconnectStart",
      "onReconnectProgress",
      "onReconnectFailed",
      "onReconnectAbandoned",
    ]) {
      subscribe(name, (_event, data) => setForSession(data, true));
    }
    subscribe("onTabConnectionStatus", (data) => {
      if (!matchesTabPayload(data, sessionKey)) return;
      const status = data?.connectionStatus || {};
      if (status.isConnected === false) setOfflineActive(true);
      else if (status.isConnected === true && status.isConnecting !== true) {
        setOfflineActive(false);
      }
    });
    subscribe("onTerminalSessionRestored", (data) =>
      setForSession(data, false),
    );
    subscribe("onTerminalSessionRestoreFailed", (data) =>
      setForSession(data, true),
    );
    window.addEventListener("terminalSessionRestored", handleSessionRestored);
    window.addEventListener(
      "terminalSessionRestoreFailed",
      handleSessionRestoreFailed,
    );

    return () => {
      cleanups.forEach((cleanup) => cleanup());
      clearInputQueue();
      window.removeEventListener(
        "terminalSessionRestored",
        handleSessionRestored,
      );
      window.removeEventListener(
        "terminalSessionRestoreFailed",
        handleSessionRestoreFailed,
      );
    };
  }, [clearInputQueue, setOfflineActive, sessionKey, refreshKey]);

  // A cached/remounted pane can already be reconnecting before it subscribes.
  useEffect(() => {
    if (reconnectStatus?.state) setOfflineActive(true);
  }, [reconnectStatus, setOfflineActive, refreshKey]);

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
    [terminalIOMailboxRef],
  );

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
    [scheduleInputQueueDrain, sendInputToProcess],
  );

  const sendCommentLinesToProcess = useCallback(
    (processId, lines) => {
      if (!Array.isArray(lines) || lines.length === 0) {
        return;
      }

      const generation = inputGenerationRef.current;
      let currentIndex = 0;
      const sendNextLine = () => {
        if (
          generation !== inputGenerationRef.current ||
          isOfflineRef.current ||
          currentIndex >= lines.length
        ) {
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
      const processId = processCache[sessionKey];
      if (!text || !processId) {
        return { ok: false, reason: "no-process" };
      }

      if (isOfflineRef.current) {
        return { ok: false, reason: "offline-paste-blocked" };
      }

      const suggestionUi = suggestionUiRef?.current;
      if (suggestionUi) {
        suggestionUi.setShowSuggestions?.(false);
        suggestionUi.setSuggestions?.([]);
        suggestionUi.setCurrentInput?.("");
        suggestionUi.setSuggestionsHiddenByEsc?.(false);
        suggestionUi.setSuggestionsSuppressedUntilEnter?.(false);
      }

      const processedText = processMultilineInput(text);
      sendProcessedInputToProcess(processId, processedText, {
        ...options,
        forceChunk: true,
      });
      return { ok: true, reason: null };
    },
    [sendProcessedInputToProcess, suggestionUiRef, sessionKey],
  );

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
    inputBlocked,
    isTerminalOffline: () => isOfflineRef.current,
  };
}
