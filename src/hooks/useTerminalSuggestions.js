import { useCallback, useEffect, useRef, useState } from "react";
import { useWindowEvent } from "./useWindowEvent.js";
import { getCharacterMetricsCss } from "../modules/terminal/controller/terminalDom.js";
import { processCache } from "../modules/terminal/controller/terminalSessionStore.js";

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
  const [cursorPosition, setCursorPosition] = useState({ x: 0, y: 0 });
  const [currentInput, setCurrentInput] = useState("");
  const [suggestionsHiddenByEsc, setSuggestionsHiddenByEsc] = useState(false);
  const [suggestionsSuppressedUntilEnter, setSuggestionsSuppressedUntilEnter] =
    useState(false);

  const suppressionContextRef = useRef({ input: "", timestamp: 0 });
  const suggestionsSuppressedRef = useRef(false);
  const suggestionSelectedRef = useRef(false);

  useEffect(() => {
    suggestionsSuppressedRef.current = suggestionsSuppressedUntilEnter;
  }, [suggestionsSuppressedUntilEnter]);

  const updateCursorPosition = useCallback(() => {
    if (!termRef.current || !terminalRef.current) {
      setCursorPosition({ x: 0, y: 0 });
      return;
    }

    try {
      const term = termRef.current;
      const container = terminalRef.current;
      const suggestionHeight = Math.min(
        (suggestions?.length || 0) * 28 + 28,
        300,
      );

      const cursorElement = term.element?.querySelector(".xterm-cursor");
      if (cursorElement) {
        const cursorRect = cursorElement.getBoundingClientRect();
        if (cursorRect.width > 0 && cursorRect.height > 0) {
          const containerRect = container.getBoundingClientRect();
          const gap = 20;
          const showAbove =
            cursorRect.bottom + suggestionHeight + gap > containerRect.bottom &&
            cursorRect.top - suggestionHeight - gap >= containerRect.top;

          setCursorPosition({
            x: cursorRect.left,
            y: cursorRect.top,
            cursorHeight: cursorRect.height || 18,
            cursorBottom:
              cursorRect.bottom || cursorRect.top + (cursorRect.height || 18),
            showAbove,
          });
          return;
        }
      }

      const metrics = getCharacterMetricsCss(term);
      if (metrics) {
        const cursorX = term.buffer.active.cursorX;
        const cursorY = term.buffer.active.cursorY;
        const screen =
          term.element?.querySelector(".xterm-viewport") ||
          term.element?.querySelector(".xterm-screen") ||
          container;
        const screenRect = screen.getBoundingClientRect();
        const terminalPadding = 8;
        const absoluteX =
          screenRect.left + cursorX * metrics.charWidth + terminalPadding;
        const absoluteY =
          screenRect.top + cursorY * metrics.charHeight + terminalPadding;
        const containerRect = container.getBoundingClientRect();
        const gap = 20;
        const showAbove =
          absoluteY + suggestionHeight + gap > containerRect.bottom &&
          absoluteY - suggestionHeight - gap >= containerRect.top;

        setCursorPosition({
          x: absoluteX,
          y: absoluteY,
          cursorHeight: metrics.charHeight || 18,
          cursorBottom: absoluteY + (metrics.charHeight || 18),
          showAbove,
        });
        return;
      }

      const containerRect = container.getBoundingClientRect();
      setCursorPosition({
        x: containerRect.left + 20,
        y: containerRect.top + 20,
        cursorHeight: 18,
        cursorBottom: containerRect.top + 38,
      });
    } catch {
      try {
        const containerRect = terminalRef.current.getBoundingClientRect();
        setCursorPosition({
          x: containerRect.left + 50,
          y: containerRect.top + 50,
          cursorHeight: 18,
          cursorBottom: containerRect.top + 68,
        });
      } catch {
        setCursorPosition({
          x: 100,
          y: 100,
          cursorHeight: 18,
          cursorBottom: 118,
        });
      }
    }
  }, [suggestions?.length, termRef, terminalRef]);

  const getSuggestions = useCallback(
    async (input) => {
      if (!input || input.trim() === "" || inEditorMode || isCommandExecuting) {
        setSuggestions([]);
        setShowSuggestions(false);
        return;
      }

      const trimmedInput = input.trim();
      if (trimmedInput.length < 2) {
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
              setSuggestions(filteredSuggestions);
              updateCursorPosition();
              requestAnimationFrame(() => {
                setShowSuggestions(true);
              });
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
      if (!suggestion || !termRef.current || !processCache[tabId]) {
        setShowSuggestions(false);
        return;
      }

      try {
        suggestionSelectedRef.current = true;

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
    suggestionSelectedRef,
    getSuggestions,
    updateCursorPosition,
    handleSuggestionSelect,
    closeSuggestions,
  };
};
