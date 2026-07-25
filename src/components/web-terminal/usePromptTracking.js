import { useCallback, useEffect, useRef, useState } from "react";
import { isPromptReadyFromTerminal } from "../../modules/terminal/promptDetection.js";
import {
  isSuggestionTrackingContext,
  shouldResumePromptTrackingOnInput,
} from "../../modules/terminal/commandSuggestionState.js";
import { shouldChunkInputPayload } from "../../modules/terminal/controller/terminalInput.js";
import {
  TERMINAL_COMMAND_LINE_REGEX,
  FULLSCREEN_COMMAND_REGEX,
  PASSWORD_PROMPT_REGEX,
  createPromptTrackingState,
  isCursorInsideWrappedInputBlock,
  clearPendingWrappedInputRefresh,
  extractCurrentCommandInput,
} from "./terminalHelpers.js";

/**
 * Prompt / command-boundary tracking and setupCommandDetection for WebTerminal.
 * Cursor + suggestion UI refreshes are coalesced onto one delayed timer so
 * xterm has time to update the cursor DOM before we measure it.
 */
export function usePromptTracking({
  tabId,
  termRef,
  inEditorModeRef,
  isCommandExecutingRef,
  lastExecutedCommandTimeRef,
  lastExecutedCommandRef,
  scheduleTerminalLayoutSyncRef,
  scheduleTerminalRedrawRef,
  scheduleTerminalRedraw,
  focusTerminalInput,
  broadcastInputToGroup,
  sendInputToProcess,
  enqueueInputToProcess,
  suggestionApi,
  commandBlockCallbacks = null,
}) {
  const [, setInEditorMode] = useState(false);
  const [, setIsCommandExecuting] = useState(false);
  const promptTrackingStateRef = useRef(createPromptTrackingState());
  const pendingCommandBoundaryRef = useRef({
    command: "",
    capturedAt: 0,
  });

  // Always read the latest suggestion API from a ref so long-lived onData
  // listeners never capture a stale object identity from render N.
  const suggestionApiRef = useRef(suggestionApi);
  suggestionApiRef.current = suggestionApi;

  // Command-block boundary callbacks (P1 logical blocks). Ref-bound so
  // setupCommandDetection never freezes a stale closure.
  const commandBlockCallbacksRef = useRef(commandBlockCallbacks);
  commandBlockCallbacksRef.current = commandBlockCallbacks;

  // Coalesce cursor + suggestion refresh (replaces paired setTimeout 10/16).
  // Delay is intentional: xterm must process the keystroke before we measure
  // .xterm-cursor for the floating suggestion window.
  const INPUT_UI_FLUSH_DELAY_MS = 12;
  const pendingInputUiRefreshRef = useRef({
    cursor: false,
    suggestionInput: null,
    requestSuggestions: false,
  });
  const inputUiRefreshTimerRef = useRef(null);

  const cancelInputUiRefresh = useCallback(() => {
    if (inputUiRefreshTimerRef.current !== null) {
      clearTimeout(inputUiRefreshTimerRef.current);
      inputUiRefreshTimerRef.current = null;
    }
    pendingInputUiRefreshRef.current = {
      cursor: false,
      suggestionInput: null,
      requestSuggestions: false,
    };
  }, []);

  const flushInputUiRefresh = useCallback(() => {
    inputUiRefreshTimerRef.current = null;
    const pending = pendingInputUiRefreshRef.current;
    pendingInputUiRefreshRef.current = {
      cursor: false,
      suggestionInput: null,
      requestSuggestions: false,
    };

    const api = suggestionApiRef.current;
    if (pending.cursor && typeof api.updateCursorPosition === "function") {
      api.updateCursorPosition();
    }

    if (pending.requestSuggestions) {
      const fn = api.getSuggestionsRef?.current;
      if (typeof fn === "function" && pending.suggestionInput != null) {
        fn(pending.suggestionInput);
      }
    }
  }, []);

  const scheduleInputUiRefresh = useCallback(
    ({
      cursor = false,
      suggestionInput = null,
      requestSuggestions = false,
    } = {}) => {
      const pending = pendingInputUiRefreshRef.current;
      if (cursor) {
        pending.cursor = true;
      }
      if (requestSuggestions) {
        pending.requestSuggestions = true;
        pending.suggestionInput = suggestionInput;
      }

      if (inputUiRefreshTimerRef.current !== null) {
        return;
      }

      inputUiRefreshTimerRef.current = setTimeout(
        flushInputUiRefresh,
        INPUT_UI_FLUSH_DELAY_MS,
      );
    },
    [flushInputUiRefresh],
  );

  useEffect(() => () => cancelInputUiRefresh(), [cancelInputUiRefresh]);

  const setEditorModeState = useCallback((nextInEditorMode) => {
    const normalizedInEditorMode = Boolean(nextInEditorMode);
    inEditorModeRef.current = normalizedInEditorMode;
    setInEditorMode((previousInEditorMode) =>
      previousInEditorMode === normalizedInEditorMode
        ? previousInEditorMode
        : normalizedInEditorMode,
    );
    try {
      commandBlockCallbacksRef.current?.onLayout?.();
    } catch {
      /* intentionally ignored */
    }
  }, [inEditorModeRef]);

  const applyPromptTrackingState = useCallback((nextState = {}) => {
    const state = promptTrackingStateRef.current;
    const wasCommandExecuting = state.commandRunning && !state.promptReady;
    let promptStateChanged = false;
    let commandRunningChanged = false;

    if (
      typeof nextState.promptReady === "boolean" &&
      state.promptReady !== nextState.promptReady
    ) {
      state.promptReady = nextState.promptReady;
      promptStateChanged = true;
    }

    if (
      typeof nextState.commandRunning === "boolean" &&
      state.commandRunning !== nextState.commandRunning
    ) {
      state.commandRunning = nextState.commandRunning;
      commandRunningChanged = true;
    }

    if (promptStateChanged || commandRunningChanged) {
      const nextIsCommandExecuting =
        state.commandRunning && !state.promptReady;
      isCommandExecutingRef.current = nextIsCommandExecuting;
      setIsCommandExecuting(nextIsCommandExecuting);

      // Command block boundary: running → prompt ready closes the open block.
      if (wasCommandExecuting && state.promptReady && !state.commandRunning) {
        try {
          commandBlockCallbacksRef.current?.onCommandEnd?.({
            term: termRef.current,
          });
        } catch {
          /* intentionally ignored */
        }
      }
    }
  }, [termRef]);

  const resetPromptTracking = useCallback(() => {
    promptTrackingStateRef.current = createPromptTrackingState();
    pendingCommandBoundaryRef.current = {
      command: "",
      capturedAt: 0,
    };
    clearPendingWrappedInputRefresh(termRef.current);

    isCommandExecutingRef.current = false;
    setIsCommandExecuting(false);

    try {
      commandBlockCallbacksRef.current?.onReset?.();
    } catch {
      /* intentionally ignored */
    }
  }, [termRef]);

  const resumePromptTrackingForSuggestionInput = useCallback(
    (term) => {
      if (
        !isSuggestionTrackingContext(term, {
          inEditorMode: inEditorModeRef.current,
        })
      ) {
        return false;
      }

      clearPendingWrappedInputRefresh(term);
      applyPromptTrackingState({
        promptReady: true,
        commandRunning: false,
      });
      return true;
    },
    [applyPromptTrackingState, inEditorModeRef],
  );

  const commitExecutedCommand = useCallback(() => {
    const pendingCommand = pendingCommandBoundaryRef.current?.command || "";
    const command = pendingCommand.trim();
    if (!command || inEditorModeRef.current) {
      return;
    }

    const now = Date.now();
    const isNearDuplicate =
      command === lastExecutedCommandRef.current &&
      now - lastExecutedCommandTimeRef.current < 300;
    if (isNearDuplicate) {
      return;
    }

    lastExecutedCommandRef.current = command;
    lastExecutedCommandTimeRef.current = now;

    const selectedSuggestionCommand =
      typeof suggestionApiRef.current.suggestionSelectedRef?.current === "string"
        ? suggestionApiRef.current.suggestionSelectedRef.current.trim()
        : "";

    if (
      selectedSuggestionCommand &&
      selectedSuggestionCommand === command &&
      window.terminalAPI?.incrementCommandUsage
    ) {
      void window.terminalAPI.incrementCommandUsage(command);
      return;
    }

    if (window.terminalAPI?.addToCommandHistory) {
      void window.terminalAPI.addToCommandHistory(command);
    }
  }, [inEditorModeRef]);

  const syncPromptTrackingFromTerminal = useCallback(
    (term) => {
      if (!term) {
        return;
      }

      const promptReady = isPromptReadyFromTerminal(term);
      if (promptReady) {
        clearPendingWrappedInputRefresh(term);
        applyPromptTrackingState({
          promptReady: true,
          commandRunning: false,
        });
        return;
      }

      applyPromptTrackingState({ promptReady: false });
    },
    [applyPromptTrackingState],
  );

  const recoverTerminalInteractionState = useCallback(
    ({
      refocus = true,
      refreshSuggestions = false,
      pendingSystemShortcutRecoveryRef,
      imeCompositionActiveRef,
      currentInput,
    } = {}) => {
      const term = termRef.current;
      if (!term) {
        if (pendingSystemShortcutRecoveryRef) {
          pendingSystemShortcutRecoveryRef.current = false;
        }
        return;
      }

      clearPendingWrappedInputRefresh(term);

      if (refocus) {
        focusTerminalInput();
      }

      syncPromptTrackingFromTerminal(term);

      const api = suggestionApiRef.current;
      const terminalInput = extractCurrentCommandInput(term);
      const effectiveInput = terminalInput || currentInput;
      const normalizedInput = effectiveInput.trim();

      if (terminalInput && terminalInput !== currentInput) {
        api.setCurrentInput(terminalInput);
      } else if (!terminalInput && currentInput && !normalizedInput) {
        api.setCurrentInput("");
      }

      if (normalizedInput) {
        resumePromptTrackingForSuggestionInput(term);
      }

      api.updateCursorPosition();
      scheduleTerminalRedraw(term);

      const promptReady =
        promptTrackingStateRef.current.promptReady &&
        !promptTrackingStateRef.current.commandRunning;

      if (
        refreshSuggestions &&
        !(imeCompositionActiveRef && imeCompositionActiveRef.current)
      ) {
        if (
          promptReady &&
          normalizedInput &&
          !inEditorModeRef.current &&
          !api.suggestionsHiddenByEscRef.current &&
          !api.suggestionsSuppressedRef.current &&
          !isCommandExecutingRef.current
        ) {
          api.getSuggestions(effectiveInput);
        } else if (!promptReady || !normalizedInput) {
          api.setShowSuggestions(false);
          api.setSuggestions([]);
        }
      }

      if (pendingSystemShortcutRecoveryRef) {
        pendingSystemShortcutRecoveryRef.current = false;
      }
    },
    [
      focusTerminalInput,
      inEditorModeRef,
      resumePromptTrackingForSuggestionInput,
      scheduleTerminalRedraw,
      syncPromptTrackingFromTerminal,
      termRef,
    ],
  );

  /**
   * Attach onData / buffer / render listeners that track prompt state and
   * command submission boundaries.
   */
  const setupCommandDetection = useCallback(
    (
      term,
      processId,
      isRemoteInput = false,
      disposables = [],
      {
        pendingSystemShortcutRecoveryRef,
        setContentUpdated,
      } = {},
    ) => {
      console.debug(
        `[setupCommandDetection] Starting for processId=${processId}, isRemoteInput=${isRemoteInput}, disposables.length=${disposables.length}`,
      );

      // Resolve suggestion controls from the live ref on each attach so we
      // never freeze a stale API object into the onData closure.
      // Prefer live ref on each use; also bind stable locals for the common path.
      const {
        setShowSuggestions,
        setSuggestions,
        setCurrentInput,
        setSuggestionsHiddenByEsc,
        setSuggestionsSuppressedUntilEnter,
        suppressionContextRef,
        suggestionsSuppressedRef,
        suggestionsHiddenByEscRef,
        suggestionSelectedRef,
      } = suggestionApiRef.current;

      let currentInputBuffer = "";
      let isEscapeSequence = false;
      let inEditorMode = false;
      let tabCompletionUsed = false;
      let currentLineBeforeTab = null;

      const editorCommandRegex =
        /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
      const extractCommand = (line) => {
        const normalizedLine =
          typeof line === "string" ? line : line?.toString?.() || "";
        const commandMatch = normalizedLine.match(TERMINAL_COMMAND_LINE_REGEX);

        if (commandMatch && commandMatch[1] && commandMatch[1].trim() !== "") {
          return commandMatch[1].trim();
        }

        if (currentInputBuffer.trim() !== "") {
          return currentInputBuffer.trim();
        }

        return "";
      };

      const syncPromptState = () => {
        if (inEditorMode) {
          applyPromptTrackingState({ promptReady: false });
          return;
        }

        if (
          !promptTrackingStateRef.current.commandRunning &&
          currentInputBuffer.trim() !== ""
        ) {
          applyPromptTrackingState({
            promptReady: true,
            commandRunning: false,
          });
          return;
        }

        syncPromptTrackingFromTerminal(term);
      };

      const bufferTypeObserver = {
        handleBufferTypeChange: (type) => {
          if (type === "alternate") {
            inEditorMode = true;
            clearPendingWrappedInputRefresh(term);
            applyPromptTrackingState({ promptReady: false });
            setEditorModeState(true);
            scheduleTerminalLayoutSyncRef.current("alternate-buffer-force", {
              immediate: true,
            });

            if (processId && window.terminalAPI?.notifyEditorModeChange) {
              window.terminalAPI.notifyEditorModeChange(processId, true);
            }

            setShowSuggestions(false);
            setSuggestions([]);
          } else if (type === "normal") {
            clearPendingWrappedInputRefresh(term);
            if (inEditorMode) {
              inEditorMode = false;
              setEditorModeState(false);

              if (processId && window.terminalAPI?.notifyEditorModeChange) {
                window.terminalAPI.notifyEditorModeChange(processId, false);
              }
            }
            syncPromptState();
          }
        },
      };

      if (term.buffer && typeof term.buffer.onBufferChange === "function") {
        const bufferDisposable = term.buffer.onBufferChange(() => {
          bufferTypeObserver.handleBufferTypeChange(term.buffer.active.type);
        });
        if (bufferDisposable && typeof bufferDisposable.dispose === "function") {
          disposables.push(bufferDisposable);
        }

        bufferTypeObserver.handleBufferTypeChange(term.buffer.active.type);
      }

      const onDataDisposable = term.onData((data) => {
        if (
          pendingSystemShortcutRecoveryRef?.current &&
          typeof data === "string" &&
          data.length > 0 &&
          !["\x1b", "Shift", "Alt"].includes(data)
        ) {
          pendingSystemShortcutRecoveryRef.current = false;
        }

        let canTrackPromptInput =
          promptTrackingStateRef.current.promptReady &&
          !promptTrackingStateRef.current.commandRunning;

        if (
          !canTrackPromptInput &&
          shouldResumePromptTrackingOnInput({
            term,
            inEditorMode,
            data,
          })
        ) {
          canTrackPromptInput = resumePromptTrackingForSuggestionInput(term);
        }

        if (
          canTrackPromptInput &&
          !inEditorMode &&
          (data === "\b" || data === "\x7f" || data === "\x03") &&
          isCursorInsideWrappedInputBlock(term)
        ) {
          term.__pendingWrappedInputRefresh = true;
        }

        scheduleTerminalRedraw(term);

        let shouldSkipSendToProcess = false;
        if (term._externalCommand) {
          const extCmd = term._externalCommand;
          if (extCmd.processedLength < extCmd.totalLength) {
            const expectedChar = extCmd.command[extCmd.processedLength];
            if (data === expectedChar) {
              shouldSkipSendToProcess = true;
              extCmd.processedLength++;

              if (extCmd.processedLength >= extCmd.totalLength) {
                delete term._externalCommand;
              }
            } else {
              delete term._externalCommand;
            }
          }
        }

        if (!isRemoteInput) {
          broadcastInputToGroup(data, tabId);
        }

        if (
          typeof data === "string" &&
          (shouldChunkInputPayload(data) ||
            (data.includes("\u001b[200~") && data.includes("\u001b[201~")))
        ) {
          currentInputBuffer = "";
          setCurrentInput("");
          setShowSuggestions(false);
          setSuggestions([]);
          if (processId && !shouldSkipSendToProcess) {
            enqueueInputToProcess(processId, data, { forceChunk: true });
          }
          return;
        }

        if (data === "\x1b") {
          isEscapeSequence = true;
          if (processId && !shouldSkipSendToProcess) {
            sendInputToProcess(processId, data);
          }
          return;
        }

        if (isEscapeSequence) {
          if (/[A-Za-z~]/.test(data)) {
            isEscapeSequence = false;
          }

          if (processId && !shouldSkipSendToProcess) {
            sendInputToProcess(processId, data);
          }
          return;
        }

        // Ctrl+C while a command is running → mark block cancelled (soft).
        if (data === "\x03") {
          try {
            if (promptTrackingStateRef.current.commandRunning) {
              commandBlockCallbacksRef.current?.onCommandInterrupt?.();
            }
          } catch {
            /* intentionally ignored */
          }
        }

        if (data === "\b" || data === "\x7f") {
          if (
            canTrackPromptInput &&
            !tabCompletionUsed &&
            currentInputBuffer.length > 0
          ) {
            currentInputBuffer = currentInputBuffer.slice(0, -1);

            if (!inEditorMode) {
              setCurrentInput(currentInputBuffer);

              if (suggestionsSuppressedRef.current) {
                try {
                  const anchor = (
                    suppressionContextRef.current?.input || ""
                  ).trim();
                  const nowInput = currentInputBuffer.trim();
                  if (!anchor || nowInput.length === 0 || nowInput !== anchor) {
                    setSuggestionsSuppressedUntilEnter(false);
                    setSuggestionsHiddenByEsc(false);
                  }
                } catch {
                  /* intentionally ignored */
                }
              }

              // Continuing input after suppression must clear live refs before
              // checking whether to request suggestions.
              if (
                !suggestionsHiddenByEscRef.current &&
                !suggestionsSuppressedRef.current &&
                !isCommandExecutingRef.current
              ) {
                scheduleInputUiRefresh({
                  cursor: true,
                  requestSuggestions: true,
                  suggestionInput: currentInputBuffer,
                });
              } else {
                scheduleInputUiRefresh({ cursor: true });
              }

              if (currentInputBuffer.length === 0) {
                setSuggestionsHiddenByEsc(false);
                setSuggestionsSuppressedUntilEnter(false);
              }
            } else {
              scheduleInputUiRefresh({ cursor: true });
            }
          }
          if (processId && !shouldSkipSendToProcess) {
            sendInputToProcess(processId, data);
          }
          return;
        }

        if (data === "\t") {
          if (canTrackPromptInput) {
            tabCompletionUsed = true;
            currentInputBuffer = "";

            currentLineBeforeTab = {
              y: term.buffer.active.cursorY,
              content:
                term.buffer.active
                  .getLine(term.buffer.active.cursorY)
                  ?.translateToString() || "",
            };

            if (!inEditorMode) {
              setShowSuggestions(false);
              setSuggestions([]);
              setCurrentInput("");
              setSuggestionsHiddenByEsc(false);
              setSuggestionsSuppressedUntilEnter(false);
            }
          }

          if (processId && !shouldSkipSendToProcess) {
            sendInputToProcess(processId, data);
          }
          return;
        }

        if (data === "\r" || data === "\n") {
          if (shouldSkipSendToProcess) {
            return;
          }

          clearPendingWrappedInputRefresh(term);

          if (!canTrackPromptInput) {
            currentInputBuffer = "";
            setCurrentInput("");
            if (processId) {
              sendInputToProcess(processId, data);
            }
            return;
          }

          setSuggestionsHiddenByEsc(false);
          setSuggestionsSuppressedUntilEnter(false);

          try {
            const lastLine =
              term.buffer.active
                .getLine(term.buffer.active.cursorY)
                ?.translateToString() || "";

            if (PASSWORD_PROMPT_REGEX.test(lastLine.trimEnd())) {
              currentInputBuffer = "";
              tabCompletionUsed = false;
              currentLineBeforeTab = null;
              pendingCommandBoundaryRef.current = {
                command: "",
                capturedAt: 0,
              };
              setCurrentInput("");
              setShowSuggestions(false);
              setSuggestions([]);
              setSuggestionsHiddenByEsc(false);
              setSuggestionsSuppressedUntilEnter(false);
              applyPromptTrackingState({
                promptReady: false,
                commandRunning: true,
              });
              suggestionSelectedRef.current = false;
              if (processId) {
                sendInputToProcess(processId, data);
              }
              return;
            }

            let command = extractCommand(lastLine);
            if (tabCompletionUsed) {
              command = extractCommand(lastLine);
            }

            if (
              command &&
              editorCommandRegex.test(command) &&
              (!term.buffer || typeof term.buffer.onBufferChange !== "function")
            ) {
              inEditorMode = true;
              setEditorModeState(true);

              if (processId && window.terminalAPI?.notifyEditorModeChange) {
                window.terminalAPI.notifyEditorModeChange(processId, true);
              }
            }

            pendingCommandBoundaryRef.current = {
              command,
              capturedAt: Date.now(),
            };

            tabCompletionUsed = false;
            currentLineBeforeTab = null;
            currentInputBuffer = "";

            setShowSuggestions(false);
            setSuggestions([]);
            setCurrentInput("");
            setSuggestionsHiddenByEsc(false);
            applyPromptTrackingState({
              promptReady: false,
              commandRunning: true,
            });

            // Open a logical command block at the submit boundary (P1).
            // Keep pendingCommandBoundary long enough for history commit, then
            // clear; the block store owns the running lifetime separately.
            if (command && !inEditorMode) {
              try {
                commandBlockCallbacksRef.current?.onCommandStart?.({
                  command,
                  term,
                });
              } catch {
                /* intentionally ignored */
              }
            }

            commitExecutedCommand();
            suggestionSelectedRef.current = false;
            pendingCommandBoundaryRef.current = {
              command: "",
              capturedAt: 0,
            };

            if (FULLSCREEN_COMMAND_REGEX.test(lastLine)) {
              setContentUpdated?.(true);
              scheduleTerminalLayoutSyncRef.current("fullscreen-command-force");
            }
          } catch {
            // ignore
          }

          if (processId) {
            sendInputToProcess(processId, data);
          }
          return;
        } else if (data !== "\t") {
          if (canTrackPromptInput && !tabCompletionUsed) {
            currentInputBuffer += data;
          }

          const firstCode = data.length > 0 ? data.charCodeAt(0) : 0;
          const isPrintableInput =
            data.length >= 1 &&
            firstCode >= 32 &&
            firstCode !== 0x7f &&
            !/[\u0000-\u001f\u007f]/.test(data);

          if (
            canTrackPromptInput &&
            !inEditorMode &&
            !tabCompletionUsed &&
            isPrintableInput
          ) {
            setCurrentInput(currentInputBuffer);

            if (suggestionsSuppressedRef.current) {
              try {
                const anchor = (
                  suppressionContextRef.current?.input || ""
                ).trim();
                const nowInput = currentInputBuffer.trim();
                if (!anchor || nowInput.length === 0 || nowInput !== anchor) {
                  setSuggestionsSuppressedUntilEnter(false);
                  setSuggestionsHiddenByEsc(false);
                }
              } catch {
                /* intentionally ignored */
              }
            }

            if (
              !suggestionsHiddenByEscRef.current &&
              !suggestionsSuppressedRef.current &&
              !isCommandExecutingRef.current
            ) {
              scheduleInputUiRefresh({
                cursor: true,
                requestSuggestions: true,
                suggestionInput: currentInputBuffer,
              });
            } else {
              scheduleInputUiRefresh({ cursor: true });
            }
          } else {
            scheduleInputUiRefresh({ cursor: true });
          }
        }

        if (processId && !shouldSkipSendToProcess) {
          sendInputToProcess(processId, data);
        }
      });

      const onLineFeedDisposable = term.onLineFeed(() => {
        try {
          if (
            inEditorMode &&
            (!term.buffer || typeof term.buffer.onBufferChange !== "function")
          ) {
            const linesCount = term.buffer.active.length;
            const lastRowsToCheck = Math.min(5, linesCount);

            for (let i = 0; i < lastRowsToCheck; i++) {
              const line =
                term.buffer.active
                  .getLine(linesCount - 1 - i)
                  ?.translateToString() || "";
              if (/(?:[>$#][>$#]?|[\w-]+@[\w-]+:[~\w/.]+[$#>])\s*$/.test(line)) {
                inEditorMode = false;
                setEditorModeState(false);

                if (processId && window.terminalAPI?.notifyEditorModeChange) {
                  window.terminalAPI.notifyEditorModeChange(processId, false);
                }
                break;
              }
            }
          }

          syncPromptState();
        } catch {
          // ignore
        }
      });

      if (
        onLineFeedDisposable &&
        typeof onLineFeedDisposable.dispose === "function"
      ) {
        disposables.push(onLineFeedDisposable);
      }

      const onRenderDisposable = term.onRender(() => {
        if (tabCompletionUsed && currentLineBeforeTab) {
          try {
            const currentLine =
              term.buffer.active
                .getLine(term.buffer.active.cursorY)
                ?.translateToString() || "";
            const previousContent = currentLineBeforeTab.content;

            if (currentLine !== previousContent) {
              const commandMatch = currentLine.match(
                TERMINAL_COMMAND_LINE_REGEX,
              );
              if (
                commandMatch &&
                commandMatch[1] &&
                commandMatch[1].trim() !== ""
              ) {
                currentInputBuffer = commandMatch[1].trim();

                if (!inEditorMode) {
                  setCurrentInput(currentInputBuffer);
                }
              }
            }

            // Coalesce tab-completion reset onto the next frame
            scheduleInputUiRefresh({ cursor: false });
            const lineSnapshot = currentLineBeforeTab;
            requestAnimationFrame(() => {
              if (currentLineBeforeTab === lineSnapshot) {
                currentLineBeforeTab = null;
              }
            });
          } catch {
            // ignore
          }
        }

        syncPromptState();
      });

      if (
        onRenderDisposable &&
        typeof onRenderDisposable.dispose === "function"
      ) {
        disposables.push(onRenderDisposable);
      }

      const onWriteParsedDisposable = term.onWriteParsed(() => {
        scheduleTerminalRedrawRef.current(term);
        syncPromptState();
      });

      if (
        onWriteParsedDisposable &&
        typeof onWriteParsedDisposable.dispose === "function"
      ) {
        disposables.push(onWriteParsedDisposable);
      }

      if (onDataDisposable && typeof onDataDisposable.dispose === "function") {
        disposables.push(onDataDisposable);
      }
    },
    [
      applyPromptTrackingState,
      broadcastInputToGroup,
      commitExecutedCommand,
      enqueueInputToProcess,
      resumePromptTrackingForSuggestionInput,
      scheduleInputUiRefresh,
      scheduleTerminalLayoutSyncRef,
      scheduleTerminalRedraw,
      scheduleTerminalRedrawRef,
      sendInputToProcess,
      setEditorModeState,
      syncPromptTrackingFromTerminal,
      tabId,
    ],
  );

  return {
    inEditorModeRef,
    isCommandExecutingRef,
    lastExecutedCommandTimeRef,
    lastExecutedCommandRef,
    promptTrackingStateRef,
    pendingCommandBoundaryRef,
    setEditorModeState,
    applyPromptTrackingState,
    resetPromptTracking,
    resumePromptTrackingForSuggestionInput,
    commitExecutedCommand,
    syncPromptTrackingFromTerminal,
    recoverTerminalInteractionState,
    setupCommandDetection,
    scheduleInputUiRefresh,
    cancelInputUiRefresh,
  };
}
