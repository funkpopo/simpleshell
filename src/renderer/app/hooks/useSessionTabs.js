import { useCallback, useRef } from "react";
import { useAppStore, useAppDispatch } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import { sendCommandToActiveSession } from "../../features/terminal/model/activeSessionActions.js";
import { getParentTabId } from "../../features/terminal/model/paneLayout.js";
import { useTranslation } from "react-i18next";
import {
  disposeTerminalSession,
  getTerminalSessionDiagnostics,
  processCache as sessionProcessCache,
} from "../../features/terminal/runtime/terminalSessionStore.js";
import {
  notifyTerminalResize,
  resolveRecentConnection,
} from "../appShellUtils.js";

export default function useSessionTabs({
  tabs,
  liveSessionKeysRef,
  clearReconnectStatus,
  clearReconnectAction,
  paneRegistryRef,
  tabContextMenu,
  handleTabContextMenuClose,
  splitLayoutsRef,
  latestTabsForActionsRef,
  paneRegistry,
  markSessionConnecting,
  connections,
  currentPanelTab,
  splitLayouts,
  currentTab,
  sessionActionStateRef,
  sidebarRef,
}) {
  const dispatch = useAppDispatch();
  const appStore = useAppStore();
  const { t } = useTranslation();
  const handleTabChange = useCallback(
    (event, newValue) => {
      dispatch(actions.setCurrentTab(newValue));

      // 文件管理侧边栏状态已按标签页独立存储，切换标签页时
      // 各标签页恢复各自的开关状态，无需额外的锁定/同步逻辑

      // 触发自定义事件，通知WebTerminal组件进行大小调整
      if (newValue < tabs.length) {
        const currentTabId = tabs[newValue]?.id;
        if (currentTabId) {
          // 使用自定义事件通知特定标签页的WebTerminal组件
          window.dispatchEvent(
            new CustomEvent("tabChanged", {
              detail: {
                tabId: currentTabId,
                index: newValue,
              },
            }),
          );

          // 触发窗口resize事件，作为备用机制确保布局更新
          notifyTerminalResize(100);
        }
      }
    },
    [tabs, dispatch],
  );
  const refreshingTerminalSessionsRef = useRef(new Set());
  const refreshTerminalSession = async (sessionKey) => {
    if (
      !liveSessionKeysRef.current.has(sessionKey) ||
      refreshingTerminalSessionsRef.current.has(sessionKey)
    )
      return;
    refreshingTerminalSessionsRef.current.add(sessionKey);
    try {
      clearReconnectStatus(sessionKey);
      clearReconnectAction(sessionKey);
      const parentTabId = getParentTabId(sessionKey, paneRegistryRef.current);
      dispatch(actions.setResourceMonitorOpen(false));
      dispatch(actions.setFileManagerOpenForTab(parentTabId, false));
      dispatch(actions.setIpAddressQueryOpen(false));
      try {
        const processId = sessionProcessCache[sessionKey];
        if (processId && window.terminalAPI?.cleanupConnection) {
          await window.terminalAPI.cleanupConnection(processId);
        }
      } catch (cleanupError) {
        console.warn("Connection cleanup failed:", cleanupError);
      }
      if (!liveSessionKeysRef.current.has(sessionKey)) return;
      dispatch(actions.updateTerminalInstance(sessionKey, undefined));
      dispatch(actions.updateTerminalInstance(sessionKey, true));
      dispatch(
        actions.updateTerminalInstance(`${sessionKey}-refresh`, Date.now()),
      );
    } finally {
      refreshingTerminalSessionsRef.current.delete(sessionKey);
    }
  };
  const handleRefreshTerminal = async () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null && tabIndex < tabs.length) {
      await refreshTerminalSession(tabs[tabIndex].id);
    }
    handleTabContextMenuClose();
  };
  const handleCloseConnection = () => {
    const tabIndex = tabContextMenu.tabIndex;
    if (tabIndex !== null) {
      handleCloseTab(tabIndex);
    }
    handleTabContextMenuClose();
  };
  const handleUnsplitTab = useCallback(() => {
    const tabId = tabContextMenu.tabId;
    if (!tabId) {
      handleTabContextMenuClose();
      return;
    }
    const layout = splitLayoutsRef.current[tabId];
    if (!layout || (layout.panes || []).length <= 1) {
      handleTabContextMenuClose();
      return;
    }
    const currentTabs = latestTabsForActionsRef.current;
    const rootIndex = currentTabs.findIndex((item) => item.id === tabId);
    if (rootIndex < 0) {
      handleTabContextMenuClose();
      return;
    }
    dispatch(actions.unsplitTab(tabId));
    notifyTerminalResize();
    handleTabContextMenuClose();
  }, [
    dispatch,
    handleTabContextMenuClose,
    notifyTerminalResize,
    paneRegistry,
    tabContextMenu.tabId,
  ]);
  const handleCreateSSHConnection = useCallback(
    (connection) => {
      // 创建唯一的标签页ID
      const terminalId = `${connection.protocol || "ssh"}-${Date.now()}`;

      // 创建标签名（使用连接配置中的名称）
      const protocol =
        connection.protocol === "telnet"
          ? "Telnet"
          : connection.protocol === "serial"
            ? "Serial"
            : connection.protocol === "mosh"
              ? "Mosh"
              : "SSH";
      const tabName = connection.name || `${protocol}: ${connection.host}`;

      // 创建新标签页
      const newTab = {
        id: terminalId,
        label: tabName,
        type: connection.protocol || "ssh",
        connectionId: connection.id, // 存储连接ID以便后续使用
      };

      // 为连接添加tabId以便在main进程中识别
      const connectionConfigWithTabId = {
        ...connection,
        tabId: terminalId,
      };

      // 为新标签页创建终端实例缓存，并包含连接配置
      dispatch(
        actions.setTerminalInstances({
          ...appStore.getState().terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: connectionConfigWithTabId,
          // 将完整的连接配置存储在缓存中
          [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
        }),
      );

      // 添加标签并立即切换到新标签（使用当前tabs长度作为新索引）
      const newTabs = [...tabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));
      if ((connection.protocol || "ssh") === "ssh") {
        markSessionConnecting(terminalId, connection);
      }
    },
    [tabs, appStore, dispatch],
  );
  const handleOpenConnection = useCallback(
    (connection) => {
      const resolvedConnection = resolveRecentConnection(
        connection,
        connections,
      );
      if (!resolvedConnection || resolvedConnection.type !== "connection") {
        return;
      }
      handleCreateSSHConnection(resolvedConnection);
    },
    [connections, handleCreateSSHConnection],
  );
  const handleCloseTab = (index) => {
    // 不能关闭欢迎页
    if (tabs[index].id === "welcome") return;
    const tabToRemove = tabs[index];

    // 关闭SSH/Telnet连接 - 在清理缓存之前先断开连接
    const processId = sessionProcessCache[tabToRemove.id];
    if (
      processId &&
      (tabToRemove.type === "ssh" ||
        tabToRemove.type === "telnet" ||
        tabToRemove.type === "serial" ||
        tabToRemove.type === "mosh" ||
        tabToRemove.type === "local")
    ) {
      window.terminalAPI.killProcess(processId).catch((err) => {
        console.warn(`关闭连接时出错: ${err.message}`);
      });
    } else if (tabToRemove.type === "local") {
      window.terminalAPI.closeLocalTerminal?.(tabToRemove.id).catch((err) => {
        console.warn(`关闭本地终端时出错: ${err.message}`);
      });
    }

    // Release renderer-owned xterm/addon/listener/mailbox caches immediately.
    // The WebTerminal unmount cleanup calls the same idempotent path as a
    // safety net, but doing it here prevents output from reaching a closed tab
    // while React is committing the state update.
    const diagnosticsBeforeClose =
      process.env.NODE_ENV === "development"
        ? getTerminalSessionDiagnostics()
        : null;
    disposeTerminalSession(tabToRemove.id);
    if (process.env.NODE_ENV === "development") {
      const diagnosticsAfterClose = getTerminalSessionDiagnostics();
      const hadCachedTerminal = diagnosticsBeforeClose.terminalIds.includes(
        tabToRemove.id,
      );
      console.assert(
        !diagnosticsAfterClose.terminalIds.includes(tabToRemove.id) &&
          (!hadCachedTerminal ||
            diagnosticsAfterClose.terminalCount <
              diagnosticsBeforeClose.terminalCount),
        `[App] terminal cache count did not decrease after closing tabId=${tabToRemove.id}`,
        diagnosticsAfterClose,
      );
    }

    sidebarRef.current?.closeFileManagerForTab(tabToRemove.id);
    if (
      appStore.getState().resourceMonitorOpen &&
      currentPanelTab?.id === tabToRemove.id
    )
      dispatch(actions.setResourceMonitorOpen(false));
    // 分屏窗格：整组窗格随 tab 一并关闭（逐个结束会话并清理实例缓存）。
    // 被拖入的窗格（adoptedFromTab）的 sessionKey 是原 tabId，同理清理。
    const closingLayout = splitLayouts[tabToRemove.id];
    if (closingLayout?.panes) {
      closingLayout.panes.forEach((paneId) => {
        if (paneId === tabToRemove.id) return;
        const paneProcessId = sessionProcessCache[paneId];
        if (paneProcessId && window.terminalAPI?.killProcess) {
          window.terminalAPI.killProcess(paneProcessId).catch((err) => {
            console.warn(`关闭窗格会话时出错: ${err.message}`);
          });
        }
        disposeTerminalSession(paneId);
        // 同步分组中的窗格成员一并移除
        dispatch(actions.removeTabFromSyncGroups(paneId));
      });
      dispatch(actions.resetTabLayout(tabToRemove.id));
    }
    dispatch(actions.forgetSessions(closingLayout?.panes ?? [tabToRemove.id]));
    // 注：进程缓存（terminalSessionStore.processCache）已由上方
    // disposeTerminalSession(tabToRemove.id) 统一清理，无需在此重复处理。

    clearReconnectStatus(tabToRemove.id);
    clearReconnectAction(tabToRemove.id);

    // 同步输入分组：将该标签从所属分组中移除；若为组内最后一个成员，
    // 分组自动回收（由 reducer 完成）
    dispatch(actions.removeTabFromSyncGroups(tabToRemove.id));
    const newTabs = tabs.filter((_, i) => i !== index);
    dispatch(actions.setTabs(newTabs));

    // 如果关闭的是当前标签页，则选择相邻的非欢迎页标签（若存在）
    if (currentTab === index) {
      // newTabs 始终包含欢迎页（索引0）。当 newTabs.length > 1 时，说明仍有其他标签。
      if (newTabs.length > 1) {
        // 选择同位置的标签（若存在），否则选择前一个，但最小为1，避免退回欢迎页
        const target = Math.min(index, newTabs.length - 1);
        dispatch(actions.setCurrentTab(Math.max(1, target)));
      } else {
        // 仅剩欢迎页
        dispatch(actions.setCurrentTab(0));
      }
    } else if (currentTab > index) {
      // 如果关闭的标签在当前标签之前，当前标签索引需要减1
      const nextIndex = currentTab - 1;
      // 若仍存在其他标签，则避免落到0（欢迎页）
      if (newTabs.length > 1) {
        dispatch(actions.setCurrentTab(Math.max(1, nextIndex)));
      } else {
        dispatch(actions.setCurrentTab(0));
      }
    }
  };
  const handleCloseTabRef = useRef(handleCloseTab);
  handleCloseTabRef.current = handleCloseTab;
  const handleTabCloseRequest = useCallback((tabId) => {
    if (!tabId || tabId === "welcome") {
      return;
    }
    const index = latestTabsForActionsRef.current.findIndex(
      (t) => t.id === tabId,
    );
    if (index >= 0) {
      handleCloseTabRef.current(index);
    }
  }, []);
  const handleSendCommand = useCallback(
    (command, options = {}) => {
      const result = sendCommandToActiveSession(
        sessionActionStateRef.current,
        command,
        options,
      );
      if (result.success) return result;
      const error =
        result.reason === "noTerminal"
          ? t("commandHistory.noTerminalTab")
          : result.reason === "sessionChanged"
            ? t("commandHistory.sessionChanged")
            : t("commandHistory.noActiveSession");
      return {
        ...result,
        error,
      };
    },
    [t],
  );
  return {
    handleTabChange,
    handleTabCloseRequest,
    handleRefreshTerminal,
    handleCloseConnection,
    handleUnsplitTab,
    handleOpenConnection,
    handleSendCommand,
    handleCloseTabRef,
    refreshTerminalSession,
  };
}
