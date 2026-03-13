import { useCallback, useEffect } from "react";
import { findGroupByTab } from "../core/syncInputGroups";
import { processCache } from "../modules/terminal/controller/terminalSessionStore.js";

export const useTerminalInputSync = ({
  tabId,
  enqueueInputToProcess,
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

    const handleExternalCommand = (event) => {
      const { tabId: eventTabId, command, timestamp } = event.detail || {};
      if (eventTabId === tabId && termRef.current) {
        termRef.current._externalCommand = {
          command,
          timestamp,
          processedLength: 0,
          totalLength: command.length,
        };

        setTimeout(() => {
          if (termRef.current && termRef.current._externalCommand) {
            delete termRef.current._externalCommand;
          }
        }, 2000);
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

    return () => {
      removeSyncListener();
      removeExternalListener();
    };
  }, [enqueueInputToProcess, eventManager, tabId, termRef]);

  return {
    broadcastInputToGroup,
  };
};
