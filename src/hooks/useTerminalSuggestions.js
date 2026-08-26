import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowEvent } from "./useWindowEvent.js";
import { getCharacterMetricsCss } from "../modules/terminal/controller/terminalDom.js";
import { processCache } from "../modules/terminal/controller/terminalSessionStore.js";
import {
  buildCommandSuggestionCursorPosition,
  isUsableRect,
} from "../modules/terminal/commandSuggestionCursor.js";
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

const COMMAND_SUGGESTION_LIMIT = 10;

export const useTerminalSuggestions = ({
  tabId,
  termRef,
  terminalRef,
  inEditorModeRef,
  isCommandExecutingRef,
  lastExecutedCommandRef,
  lastExecutedCommandTimeRef,
  sendInputToProcess,
  broadcastInputToGroup,
}) => {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(null);
  const [currentInput, setCurrentInput] = useState("");
  const [suggestionsHiddenByEsc, setSuggestionsHiddenByEscState] =
    useState(false);
  const [
    suggestionsSuppressedUntilEnter,
    setSuggestionsSuppressedUntilEnterState,
  ] = useState(false);

  const suppressionContextRef = useRef({ input: "", timestamp: 0 });
  const suggestionsSuppressedRef = useRef(false);
  const suggestionsHiddenByEscRef = useRef(false);
  const suggestionSelectedRef = useRef(false);
  const getSuggestionsRef = useRef(null);
  const suggestionRequestIdRef = useRef(0);

  const setSuggestionsHiddenByEsc = useCallback((value) => {
    const nextValue =
      typeof value === "function"
        ? Boolean(value(suggestionsHiddenByEscRef.current))
        : Boolean(value);
    suggestionsHiddenByEscRef.current = nextValue;
    setSuggestionsHiddenByEscState(nextValue);
  }, []);

  const setSuggestionsSuppressedUntilEnter = useCallback((value) => {
    const nextValue =
      typeof value === "function"
        ? Boolean(value(suggestionsSuppressedRef.current))
        : Boolean(value);
    suggestionsSuppressedRef.current = nextValue;
    setSuggestionsSuppressedUntilEnterState(nextValue);
  }, []);

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

        const commitPosition = (rawPosition) => {
          const nextPosition = buildCommandSuggestionCursorPosition({
            ...rawPosition,
            suggestionHeight,
            containerRect,
          });
          if (!nextPosition) {
            setCursorPosition(null);
            return null;
          }
          setCursorPosition(nextPosition);
          return nextPosition;
        };

        // DOM cursor is only present with the DOM renderer. WebGL draws the
        // cursor on canvas, so this path often misses; metrics are the fallback.
        const cursorElement = term.element?.querySelector(".xterm-cursor");
        if (cursorElement) {
          const cursorRect = cursorElement.getBoundingClientRect();
          if (isUsableRect(cursorRect)) {
            const fromDom = commitPosition({
              x: cursorRect.left,
              y: cursorRect.top,
              cursorHeight: cursorRect.height || 18,
              cursorBottom:
                cursorRect.bottom || cursorRect.top + (cursorRect.height || 18),
            });
            if (fromDom) {
              return fromDom;
            }
          }
        }

        const metrics = getCharacterMetricsCss(term);
        if (metrics) {
          const cursorX = term.buffer?.active?.cursorX ?? 0;
          const cursorY = term.buffer?.active?.cursorY ?? 0;
          const screen =
            term.element?.querySelector(".xterm-screen") ||
            term.element?.querySelector(".xterm-viewport") ||
            container;
          const screenRect = screen.getBoundingClientRect();
          const charWidth = metrics.charWidth || 8;
          const charHeight = metrics.charHeight || 18;
          const absoluteX = screenRect.left + cursorX * charWidth;
          const absoluteY = screenRect.top + cursorY * charHeight;

          const fromMetrics = commitPosition({
            x: absoluteX,
            y: absoluteY,
            cursorHeight: charHeight,
            cursorBottom: absoluteY + charHeight,
          });
          if (fromMetrics) {
            return fromMetrics;
          }
        }

        // Last-resort anchor: keep suggestions usable even when cell metrics
        // disagree with the layout (typical after the prompt reaches the bottom).
        const fallback = commitPosition({
          x: containerRect.left + 12,
          y: Math.max(containerRect.top + 12, containerRect.bottom - 36),
          cursorHeight: 18,
          cursorBottom: Math.max(
            containerRect.top + 30,
            containerRect.bottom - 18,
          ),
        });
        return fallback;
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
      if (
        !input ||
        input.trim() === "" ||
        inEditorModeRef.current ||
        isCommandExecutingRef.current
      ) {
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
          const response = await window.terminalAPI.getCommandSuggestions(
            trimmedInput,
            COMMAND_SUGGESTION_LIMIT,
          );
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
              .slice(0, COMMAND_SUGGESTION_LIMIT);

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
      inEditorModeRef,
      isCommandExecutingRef,
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
        !isCommandExecutingRef.current
      ) {
        getSuggestions(input);
      }
    },
    [
      getSuggestions,
      isCommandExecutingRef,
      suggestionsHiddenByEsc,
      suggestionsSuppressedUntilEnter,
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
          broadcastInputToGroup("\b", tabId);
        }

        sendInputToProcess(processCache[tabId], suggestion.command);
        // Choosing a floating suggestion writes directly to the process instead
        // of going through xterm's onData event, so broadcast it explicitly.
        broadcastInputToGroup(suggestion.command, tabId);
        setCurrentInput(suggestion.command);
        setShowSuggestions(false);
        setSuggestions([]);
      } catch {
        setShowSuggestions(false);
      }
    },
    [broadcastInputToGroup, currentInput, sendInputToProcess, tabId, termRef],
  );

  const closeSuggestions = useCallback(
    (options = {}) => {
      const shouldSuppressUntilEnter = options?.suppressUntilEnter !== false;

      suggestionRequestIdRef.current += 1;
      setShowSuggestions(false);
      setSuggestions([]);

      if (shouldSuppressUntilEnter) {
        setSuggestionsSuppressedUntilEnter(true);
        suppressionContextRef.current = {
          input: currentInput,
          timestamp: Date.now(),
        };
      } else {
        setSuggestionsHiddenByEsc(false);
        setSuggestionsSuppressedUntilEnter(false);
        suppressionContextRef.current = {
          input: "",
          timestamp: 0,
        };
      }
    },
    [currentInput],
  );

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
