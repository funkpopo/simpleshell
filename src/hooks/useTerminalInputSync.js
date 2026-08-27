import { useCallback, useEffect, useRef } from "react";
import { findGroupByTab } from "../core/syncInputGroups";
import { useAppSelector } from "../store/AppContext.jsx";
import {
  processCache,
  registerTerminalRef,
  unregisterTerminalRef,
} from "../modules/terminal/controller/terminalSessionStore.js";

const selectSyncGroups = (state) => state.syncGroups;

// 并发输入仲裁窗口：本端用户最近 N ms 内有过本地输入时，丢弃远端同步输入
const LOCAL_ACTIVE_WINDOW_MS = 1500;
// 并发输入警告 toast 的节流间隔
const CONCURRENT_INPUT_NOTICE_THROTTLE_MS = 3000;
// 成员端补全建议刷新的防抖间隔
const SUGGESTION_REFRESH_DELAY_MS = 150;

const dispatchSyncGroupNotice = (detail) => {
  window.dispatchEvent(new CustomEvent("syncGroupNotice", { detail }));
};

export const useTerminalInputSync = ({
  tabId,
  enqueueInputToProcess,
  handlePasteText,
  termRef,
  eventManager,
  suggestionUiRef,
}) => {
  const syncGroups = useAppSelector(selectSyncGroups);

  // 并发输入仲裁：记录本端最近一次本地输入时间
  const lastLocalInputAtRef = useRef(0);
  const lastConcurrentNoticeAtRef = useRef(0);

  // 成员端镜像输入缓冲：远端逐键同步到达时维护一份与源端一致的
  // 当前输入文本，用于刷新补全弹层，避免补全与输入行脱节
  const syncedInputBufferRef = useRef("");
  const suggestionRefreshTimerRef = useRef(null);

  const resetSyncedUiInput = useCallback(() => {
    syncedInputBufferRef.current = "";
    const ui = suggestionUiRef?.current;
    if (!ui) {
      return;
    }
    ui.setShowSuggestions?.(false);
    ui.setSuggestions?.([]);
    ui.setCurrentInput?.("");
  }, [suggestionUiRef]);

  // 把远端按键同步到成员端 suggestion / currentInput 状态
  const applySyncedKeystrokeToUi = useCallback(
    (input) => {
      const ui = suggestionUiRef?.current;
      if (!ui || typeof input !== "string" || input.length === 0) {
        return;
      }

      // 粘贴包裹标记 / 回车 / Ctrl+C / Tab / Esc：与源端 onData 的处理对齐，
      // 直接清空输入跟踪与补全弹层
      const isReset =
        input.includes("\u001b[200~") ||
        input.includes("\u001b[201~") ||
        input.includes("\r") ||
        input.includes("\n") ||
        input.includes("\x03") ||
        input.includes("\t") ||
        input.includes("\x1b");

      if (isReset) {
        resetSyncedUiInput();
        ui.setSuggestionsHiddenByEsc?.(false);
        ui.setSuggestionsSuppressedUntilEnter?.(false);
        return;
      }

      if (input === "\b" || input === "\x7f") {
        syncedInputBufferRef.current =
          syncedInputBufferRef.current.slice(0, -1);
      } else {
        syncedInputBufferRef.current += input;
      }

      const buffer = syncedInputBufferRef.current;
      ui.setCurrentInput?.(buffer);

      if (suggestionRefreshTimerRef.current !== null) {
        clearTimeout(suggestionRefreshTimerRef.current);
      }
      suggestionRefreshTimerRef.current = setTimeout(() => {
        suggestionRefreshTimerRef.current = null;
        if (buffer.trim()) {
          ui.getSuggestions?.(buffer);
        } else {
          ui.setShowSuggestions?.(false);
          ui.setSuggestions?.([]);
        }
      }, SUGGESTION_REFRESH_DELAY_MS);
    },
    [resetSyncedUiInput, suggestionUiRef],
  );

  useEffect(
    () => () => {
      if (suggestionRefreshTimerRef.current !== null) {
        clearTimeout(suggestionRefreshTimerRef.current);
        suggestionRefreshTimerRef.current = null;
      }
    },
    [],
  );

  const broadcastInputToGroup = useCallback(
    (input, sourceTabId) => {
      // 本端有真实按键输入：刷新本地活跃时间戳，并重置远端镜像缓冲
      lastLocalInputAtRef.current = Date.now();
      syncedInputBufferRef.current = "";

      const group = findGroupByTab(syncGroups, tabId);
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
    [tabId, syncGroups],
  );

  // Some input paths (native paste, middle-click paste and the context menu)
  // do not pass through xterm's onData callback. Keep them on a separate event
  // channel so they can use the receiving terminal's normal paste pipeline.
  const broadcastTerminalActionToGroup = useCallback(
    (action, payload = {}, sourceTabId = tabId) => {
      const group = findGroupByTab(syncGroups, tabId);
      if (!group?.members || group.members.length <= 1) {
        return;
      }

      // 粘贴 / 清除属于显式动作，同步后重置成员端镜像缓冲
      syncedInputBufferRef.current = "";

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
    [tabId, syncGroups],
  );

  useEffect(() => {
    if (termRef.current && tabId) {
      registerTerminalRef(tabId, termRef.current);
    }

    return () => {
      unregisterTerminalRef(tabId, termRef.current);
    };
  }, [tabId, termRef]);

  useEffect(() => {
    // 并发输入仲裁：本端用户正在输入时丢弃远端同步按键，并给出节流警告
    const shouldDropForConcurrentInput = () => {
      if (
        Date.now() - lastLocalInputAtRef.current < LOCAL_ACTIVE_WINDOW_MS
      ) {
        const now = Date.now();
        if (
          now - lastConcurrentNoticeAtRef.current >=
          CONCURRENT_INPUT_NOTICE_THROTTLE_MS
        ) {
          lastConcurrentNoticeAtRef.current = now;
          dispatchSyncGroupNotice({ kind: "concurrent-input", tabId });
        }
        return true;
      }
      return false;
    };

    const handleSyncInput = (event) => {
      const { input, targetTabId } = event.detail || {};
      if (targetTabId === tabId && processCache[tabId]) {
        if (!termRef.current) {
          return;
        }
        if (shouldDropForConcurrentInput()) {
          return;
        }
        enqueueInputToProcess(processCache[tabId], input, {
          forceChunk: true,
        });
        applySyncedKeystrokeToUi(input);
      }
    };

    // 分组快捷命令投递（P2）：命令经成员端自己的输入管道发送，
    // 离线 / 重连中时自动进入成员端离线缓冲，与源终端行为一致。
    const handleSyncTerminalCommand = (event) => {
      const { targetTabId, groupId, command, execute } = event.detail || {};
      if (targetTabId !== tabId) {
        return;
      }

      const pid = processCache[tabId];
      if (!pid || !termRef.current) {
        dispatchSyncGroupNotice({
          kind: "member-unreachable",
          groupId: groupId ?? null,
          tabIds: [tabId],
        });
        return;
      }

      if (shouldDropForConcurrentInput()) {
        return;
      }

      const commandToSend = execute === false ? command : `${command}\r`;

      // 保留外部输入通道标记，供 onData 的防重放识别使用（契约不变）
      termRef.current._externalInputChannel = { payload: commandToSend };

      // 经成员端管道发送：离线时进入离线缓冲，重连后随缓冲发送
      enqueueInputToProcess(pid, commandToSend);

      // 成员端 UI 状态同步：与源端快捷命令后的输入行状态保持一致
      const ui = suggestionUiRef?.current;
      if (ui) {
        if (execute === false) {
          syncedInputBufferRef.current = command;
          ui.setCurrentInput?.(command);
        } else {
          syncedInputBufferRef.current = "";
          ui.setShowSuggestions?.(false);
          ui.setSuggestions?.([]);
          ui.setCurrentInput?.("");
          ui.setSuggestionsHiddenByEsc?.(false);
          ui.setSuggestionsSuppressedUntilEnter?.(false);
        }
      }
    };

    const handleSyncTerminalAction = (event) => {
      const { action, payload, targetTabId } = event.detail || {};
      if (targetTabId !== tabId) {
        return;
      }

      // 同步动作会重写输入行，成员端镜像缓冲一并重置
      syncedInputBufferRef.current = "";

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
    const removeCommandListener = eventManager.addEventListener(
      window,
      "syncTerminalCommand",
      handleSyncTerminalCommand,
    );
    const removeActionListener = eventManager.addEventListener(
      window,
      "syncTerminalAction",
      handleSyncTerminalAction,
    );

    return () => {
      removeSyncListener();
      removeCommandListener();
      removeActionListener();
    };
  }, [
    applySyncedKeystrokeToUi,
    enqueueInputToProcess,
    eventManager,
    handlePasteText,
    suggestionUiRef,
    tabId,
    termRef,
  ]);

  return {
    broadcastInputToGroup,
    broadcastTerminalActionToGroup,
  };
};
