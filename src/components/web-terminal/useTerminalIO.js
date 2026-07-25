import { useCallback, useRef } from "react";
import {
  COMMENT_LINE_SEND_INTERVAL_MS,
  INPUT_SEND_CHUNK_SIZE,
  INPUT_SEND_FRAME_DELAY_MS,
  INPUT_SEND_MAX_CHUNKS_PER_FRAME,
  processMultilineInput,
  shouldChunkInputPayload,
} from "../../modules/terminal/controller/terminalInput.js";
import { processCache } from "../../modules/terminal/controller/terminalSessionStore.js";

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
        return;
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
  };
}
