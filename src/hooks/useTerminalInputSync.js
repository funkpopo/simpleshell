import { useCallback, useEffect } from "react";
import { findGroupByTab } from "../core/syncInputGroups";
import { processCache } from "../modules/terminal/controller/terminalSessionStore.js";

export const useTerminalInputSync = ({
  tabId,
  enqueueInputToProcess,
  handlePasteText,
  termRef,
  eventManager,
}) => {
  const broadcastInputToGroup = useCallback(
    (input, sourceTabId) => {
      const group = findGroupByTab(tabId);
      if (group && group.members && group.members.length > 1) {
        group.members.forEach((targetTabId) => {
          if (
            targetTabId !== (sourceTabId || tabId) &&
            window.terminalAPI &&
            window.terminalAPI.sendToProcess &&
            processCache[targetTabId]
          ) {
            const event = new CustomEvent("syncTerminalInput", {
              detail: {
                input,
                sourceTabId: sourceTabId || tabId,
                targetTabId,
              },
            });
            window.dispatchEvent(event);
          }
        });
      }
    },
    [tabId],
  );

  // Some input paths (native paste, middle-click paste and the context menu)
  // do not pass through xterm's onData callback. Keep them on a separate event
  // channel so they can use the receiving terminal's normal paste pipeline.
  const broadcastTerminalActionToGroup = useCallback(
    (action, payload = {}, sourceTabId = tabId) => {
      const group = findGroupByTab(tabId);
      if (!group?.members || group.members.length <= 1) {
        return;
      }

      group.members.forEach((targetTabId) => {
        if (targetTabId === sourceTabId) {
          return;
        }

        window.dispatchEvent(
          new CustomEvent("syncTerminalAction", {
            detail: {
              action,
              payload,
              sourceTabId,
              targetTabId,
            },
          }),
        );
      });
    },
    [tabId],
  );

  useEffect(() => {
    if (typeof window !== "undefined" && !window.webTerminalRefs) {
      window.webTerminalRefs = {};
    }

    if (termRef.current && tabId) {
      window.webTerminalRefs[tabId] = termRef.current;
    }

    return () => {
      if (tabId && window.webTerminalRefs) {
        delete window.webTerminalRefs[tabId];
      }
    };
  }, [tabId, termRef]);

  useEffect(() => {
    const handleSyncInput = (event) => {
      const { input, targetTabId } = event.detail || {};
      if (targetTabId === tabId && processCache[tabId]) {
        if (termRef.current) {
          enqueueInputToProcess(processCache[tabId], input, {
            forceChunk: true,
          });
        }
      }
    };

    // Explicit external-input channel marker from the group command
    // dispatcher. The payload is delivered to the process by the dispatcher
    // itself; this marker only lets the terminal's onData handler recognize
    // (and skip) a channel replay. It is consumed on the next onData chunk
    // regardless of match — no timestamp window, no per-character matching —
    // so it can never swallow legitimate user keystrokes.
    const handleExternalCommand = (event) => {
      const { tabId: eventTabId, command } = event.detail || {};
      if (eventTabId === tabId && termRef.current) {
        termRef.current._externalInputChannel = {
          payload: command,
        };
      }
    };

    const handleSyncTerminalAction = (event) => {
      const { action, payload, targetTabId } = event.detail || {};
      if (targetTabId !== tabId) {
        return;
      }

      if (action === "paste" && processCache[tabId]) {
        handlePasteText(payload?.text);
        return;
      }

      if (action === "clear") {
        termRef.current?.clear();
      }
    };

    const removeSyncListener = eventManager.addEventListener(
      window,
      "syncTerminalInput",
      handleSyncInput,
    );
    const removeExternalListener = eventManager.addEventListener(
      window,
      "externalCommandSending",
      handleExternalCommand,
    );
    const removeActionListener = eventManager.addEventListener(
      window,
      "syncTerminalAction",
      handleSyncTerminalAction,
    );

    return () => {
      removeSyncListener();
      removeExternalListener();
      removeActionListener();
    };
  }, [enqueueInputToProcess, eventManager, handlePasteText, tabId, termRef]);

  return {
    broadcastInputToGroup,
    broadcastTerminalActionToGroup,
  };
};
