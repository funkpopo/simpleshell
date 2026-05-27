import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowEvent } from "./useWindowEvent.js";
import { getCharacterMetricsCss } from "../modules/terminal/controller/terminalDom.js";
import { processCache } from "../modules/terminal/controller/terminalSessionStore.js";
import {
  normalizeCommandSuggestionInput,
  shouldRequestCommandSuggestions,
} from "../modules/terminal/commandSuggestionState.js";

const waitForTerminalLayoutFrame = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }

    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });

const isUsableRect = (rect) =>
  rect &&
  Number.isFinite(rect.left) &&
  Number.isFinite(rect.top) &&
  Number.isFinite(rect.width) &&
  Number.isFinite(rect.height) &&
  rect.width > 0 &&
  rect.height > 0;

const isPointInsideRect = (x, y, rect) =>
  Number.isFinite(x) &&
  Number.isFinite(y) &&
  isUsableRect(rect) &&
  x >= rect.left &&
  x <= rect.right &&
  y >= rect.top &&
  y <= rect.bottom;

export const useTerminalSuggestions = ({
  tabId,
  termRef,
  terminalRef,
  inEditorMode,
  isCommandExecuting,
  lastExecutedCommandRef,
  lastExecutedCommandTimeRef,
  sendInputToProcess,
}) => {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [currentInput, setCurrentInput] = useState("");
  const [suggestionsHiddenByEsc, setSuggestionsHiddenByEsc] = useState(false);
  const [suggestionsSuppressedUntilEnter, setSuggestionsSuppressedUntilEnter] =
    useState(false);

  const suppressionContextRef = useRef({ input: "", timestamp: 0 });
  const suggestionsSuppressedRef = useRef(false);
  const suggestionsHiddenByEscRef = useRef(false);
  const suggestionSelectedRef = useRef(false);
  const getSuggestionsRef = useRef(null);
  const suggestionRequestIdRef = useRef(0);

  useEffect(() => {
    suggestionsSuppressedRef.current = suggestionsSuppressedUntilEnter;
  }, [suggestionsSuppressedUntilEnter]);

  useEffect(() => {
    suggestionsHiddenByEscRef.current = suggestionsHiddenByEsc;
  }, [suggestionsHiddenByEsc]);

  const updateCursorPosition = useCallback(
    (suggestionCount = suggestions?.length || 0) => {
      if (!termRef.current || !terminalRef.current) {
        setCursorPosition(null);
        return null;
      }

      try {
        const term = termRef.current;
        const container = terminalRef.current;
        const suggestionHeight = Math.min(suggestionCount * 28 + 28, 300);
        const containerRect = container.getBoundingClientRect();
        if (!isUsableRect(containerRect)) {
          setCursorPosition(null);
          return null;
        }

        const cursorElement = term.element?.querySelector(".xterm-cursor");
        if (cursorElement) {
          const cursorRect = cursorElement.getBoundingClientRect();
          if (
            isUsableRect(cursorRect) &&
            isPointInsideRect(cursorRect.left, cursorRect.top, containerRect)
          ) {
            const gap = 20;
            const nextPosition = {
              x: cursorRect.left,
              y: cursorRect.top,
              cursorHeight: cursorRect.height || 18,
              cursorBottom:
                cursorRect.bottom || cursorRect.top + (cursorRect.height || 18),
              showAbove:
                cursorRect.bottom + suggestionHeight + gap >
                  containerRect.bottom &&
                cursorRect.top - suggestionHeight - gap >= containerRect.top,
            };

            setCursorPosition(nextPosition);
            return nextPosition;
          }
        }

        const metrics = getCharacterMetricsCss(term);
        if (metrics) {
          const cursorX = term.buffer.active.cursorX;
          const cursorY = term.buffer.active.cursorY;
          const screen =
            term.element?.querySelector(".xterm-screen") ||
            term.element?.querySelector(".xterm-viewport") ||
            container;
          const screenRect = screen.getBoundingClientRect();
          const absoluteX = screenRect.left + cursorX * metrics.charWidth;
          const absoluteY = screenRect.top + cursorY * metrics.charHeight;
          if (!isPointInsideRect(absoluteX, absoluteY, containerRect)) {
            setCursorPosition(null);
            return null;
          }

          const gap = 20;
          const nextPosition = {
            x: absoluteX,
            y: absoluteY,
            cursorHeight: metrics.charHeight || 18,
            cursorBottom: absoluteY + (metrics.charHeight || 18),
            showAbove:
              absoluteY + suggestionHeight + gap > containerRect.bottom &&
              absoluteY - suggestionHeight - gap >= containerRect.top,
          };

          setCursorPosition(nextPosition);
          return nextPosition;
        }

        setCursorPosition(null);
        return null;
      } catch {
        setCursorPosition(null);
        return null;
      }
    },
    [suggestions?.length, termRef, terminalRef],
  );

  const getSuggestions = useCallback(
    async (input) => {
      const requestId = suggestionRequestIdRef.current + 1;
      suggestionRequestIdRef.current = requestId;
      if (!input || input.trim() === "" || inEditorMode || isCommandExecuting) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      const trimmedInput = normalizeCommandSuggestionInput(input);
      if (!shouldRequestCommandSuggestions(trimmedInput)) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      if (
        lastExecutedCommandRef.current &&
        trimmedInput === lastExecutedCommandRef.current &&
        Date.now() - lastExecutedCommandTimeRef.current < 600
      ) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      try {
        if (window.terminalAPI && window.terminalAPI.getCommandSuggestions) {
          const response =
            await window.terminalAPI.getCommandSuggestions(trimmedInput);
          const commandSuggestions = response?.success
            ? response.suggestions
            : [];
          if (requestId !== suggestionRequestIdRef.current) {
            return;
          }

          if (commandSuggestions && commandSuggestions.length > 0) {
            const filteredSuggestions = commandSuggestions
              .filter(
                (suggestion) =>
                  suggestion.command &&
                  suggestion.command
                    .toLowerCase()
                    .includes(trimmedInput.toLowerCase()) &&
                  suggestion.command !== trimmedInput,
              )
              .sort((a, b) => {
                const aStartsWith = a.command
                  .toLowerCase()
                  .startsWith(trimmedInput.toLowerCase());
                const bStartsWith = b.command
                  .toLowerCase()
                  .startsWith(trimmedInput.toLowerCase());

                if (aStartsWith && !bStartsWith) return -1;
                if (!aStartsWith && bStartsWith) return 1;
                return (b.count || 0) - (a.count || 0);
              })
              .slice(0, 10);

            if (filteredSuggestions.length > 0) {
              await waitForTerminalLayoutFrame();
              if (requestId !== suggestionRequestIdRef.current) {
                return;
              }

              const nextPosition = updateCursorPosition(
                filteredSuggestions.length,
              );
              if (!nextPosition) {
                setSuggestions([]);
                setShowSuggestions(false);
                return;
              }

              setSuggestions(filteredSuggestions);
              setShowSuggestions(true);
            } else {
              setSuggestions([]);
              setShowSuggestions(false);
            }
          } else {
            setSuggestions([]);
            setShowSuggestions(false);
          }
        } else {
          setSuggestions([]);
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    },
    [
      inEditorMode,
      isCommandExecuting,
      lastExecutedCommandRef,
      lastExecutedCommandTimeRef,
      updateCursorPosition,
    ],
  );

  useEffect(() => {
    getSuggestionsRef.current = getSuggestions;
  }, [getSuggestions]);

  const handleRefreshSuggestions = useCallback(
    (event) => {
      const { input } = event.detail || {};
      if (
        input &&
        !suggestionsHiddenByEsc &&
        !suggestionsSuppressedUntilEnter &&
        !isCommandExecuting
      ) {
        getSuggestions(input);
      }
    },
    [
      getSuggestions,
      suggestionsHiddenByEsc,
      suggestionsSuppressedUntilEnter,
      isCommandExecuting,
    ],
  );

  useWindowEvent("refreshCommandSuggestions", handleRefreshSuggestions);

  const handleSuggestionSelect = useCallback(
    (suggestion) => {
      suggestionRequestIdRef.current += 1;
      if (!suggestion || !termRef.current || !processCache[tabId]) {
        setShowSuggestions(false);
        return;
      }

      try {
        suggestionSelectedRef.current = suggestion.command;

        const currentLine =
          termRef.current.buffer.active
            .getLine(termRef.current.buffer.active.cursorY)
            ?.translateToString() || "";
        const commandMatch = currentLine.match(
          /(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w/.]+[$#>])\s*(.*)$/,
        );
        const currentInputOnLine = commandMatch ? commandMatch[1] : "";
        const currentInputLength = currentInputOnLine.length;
        const deleteCount = currentInput.length || currentInputLength;

        for (let i = 0; i < deleteCount; i++) {
          sendInputToProcess(processCache[tabId], "\b");
        }

        sendInputToProcess(processCache[tabId], suggestion.command);
        setCurrentInput(suggestion.command);
        setShowSuggestions(false);
        setSuggestions([]);
      } catch {
        setShowSuggestions(false);
      }
    },
    [currentInput, sendInputToProcess, tabId, termRef],
  );

  const closeSuggestions = useCallback(() => {
    suggestionRequestIdRef.current += 1;
    setShowSuggestions(false);
    setSuggestions([]);
    setSuggestionsSuppressedUntilEnter(true);
    suppressionContextRef.current = {
      input: currentInput,
      timestamp: Date.now(),
    };
  }, [currentInput]);

  return {
    suggestions,
    setSuggestions,
    showSuggestions,
    setShowSuggestions,
    cursorPosition,
    currentInput,
    setCurrentInput,
    suggestionsHiddenByEsc,
    setSuggestionsHiddenByEsc,
    suggestionsSuppressedUntilEnter,
    setSuggestionsSuppressedUntilEnter,
    suppressionContextRef,
    suggestionsSuppressedRef,
    suggestionsHiddenByEscRef,
    suggestionSelectedRef,
    getSuggestions,
    getSuggestionsRef,
    updateCursorPosition,
    handleSuggestionSelect,
    closeSuggestions,
  };
};
