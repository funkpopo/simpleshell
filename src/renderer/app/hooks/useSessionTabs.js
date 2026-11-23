import { useCallback, useRef } from "react";
import { useAppStore, useAppDispatch } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import { sendCommandToActiveSession } from "../../features/terminal/model/activeSessionActions.js";
import {
  MAX_PANES,
  createPaneId,
  getParentTabId,
} from "../../features/terminal/model/paneLayout.js";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../shared/notifications/NotificationContext.jsx";
import {
  disposeTerminalSession,
  getTerminalSessionDiagnostics,
  processCache as sessionProcessCache,
} from "../../features/terminal/runtime/terminalSessionStore.js";
import {
  findConnectionById,
  notifyTerminalResize,
  resolveRecentConnection,
} from "../appShellUtils.js";
import {
  buildTabSnapshot,
  resolveWorkspaceRestorePlan,
} from "../lib/workspaceSnapshot.js";

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
  currentTab,
  sessionActionStateRef,
  sidebarRef,
}) {
  const dispatch = useAppDispatch();
  const appStore = useAppStore();
  const { t } = useTranslation();
  const { showWarning } = useNotification();
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
      const currentState = appStore.getState();
      const latestTabs = currentState.tabs || tabs;
      // 创建唯一的标签页ID
      const terminalId = `${connection.protocol || "ssh"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

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
        connectionId: connection.connectionId || connection.id, // 存储连接ID以便后续使用
      };

      // 为连接添加tabId以便在main进程中识别
      const connectionConfigWithTabId = {
        ...connection,
        tabId: terminalId,
      };

      // 为新标签页创建终端实例缓存，并包含连接配置
      dispatch(
        actions.setTerminalInstances({
          ...currentState.terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: connectionConfigWithTabId,
          // 将完整的连接配置存储在缓存中
          [`${terminalId}-processId`]: null, // 预留存储进程ID的位置
        }),
      );

      // 添加标签并立即切换到新标签（使用当前tabs长度作为新索引）
      const newTabs = [...latestTabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));
      if ((connection.protocol || "ssh") === "ssh") {
        markSessionConnecting(terminalId, connection);
      }
      return newTab;
    },
    [tabs, appStore, dispatch, markSessionConnecting],
  );
  const handleOpenLocalTerminalTab = useCallback(
    (terminalConfig = { useDefaultShell: true }) => {
      const currentState = appStore.getState();
      const latestTabs = currentState.tabs || tabs;
      const terminalId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const baseLabel =
        terminalConfig?.name ||
        terminalConfig?.executable ||
        t("sidebar.localTerminal");
      const sameLabelCount = latestTabs.filter(
        (tab) => tab.type === "local" && tab.label?.startsWith(baseLabel),
      ).length;
      const tabLabel =
        sameLabelCount > 0 ? `${baseLabel} ${sameLabelCount + 1}` : baseLabel;
      const completeConfig = {
        useDefaultShell: terminalConfig?.useDefaultShell === true,
        name: tabLabel,
        type: terminalConfig?.type || "local",
        executablePath: terminalConfig?.executablePath,
        executable: terminalConfig?.executable,
        command: terminalConfig?.command,
        args: terminalConfig?.args || terminalConfig?.launchArgs || [],
        launchArgs: terminalConfig?.launchArgs || terminalConfig?.args || [],
        cwd: terminalConfig?.cwd,
        env: terminalConfig?.env,
        distribution: terminalConfig?.distribution,
        availableDistributions: terminalConfig?.availableDistributions || [],
        tabId: terminalId,
      };
      const newTab = {
        id: terminalId,
        label: tabLabel,
        type: "local",
        localConfig: completeConfig,
      };
      dispatch(
        actions.setTerminalInstances({
          ...currentState.terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: completeConfig,
          [`${terminalId}-processId`]: null,
        }),
      );
      const newTabs = [...latestTabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));
      notifyTerminalResize();
      return newTab;
    },
    [appStore, dispatch, t, tabs],
  );
  const handleOpenConnection = useCallback(
    (connection) => {
      if (connection?.isTransient) {
        handleCreateSSHConnection(connection);
        return;
      }
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
    const currentState = appStore.getState();
    const closedEntry = buildTabSnapshot(tabToRemove, currentState);
    if (closedEntry) {
      dispatch(actions.pushClosedTab(closedEntry));
    }

    disposeClosedTabResources(
      tabToRemove,
      {
        appStore,
        dispatch,
        currentPanelTabId: currentPanelTab?.id,
        sidebarRef,
        clearReconnectStatus,
        clearReconnectAction,
      },
      { forget: true },
    );

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
  const splitPane = useCallback(
    (tabId, paneId, direction = "right", mode = "duplicate") => {
      const currentState = appStore.getState();
      const targetTabId =
        tabId ||
        currentState.tabs[currentState.currentTab]?.id ||
        currentPanelTab?.id;
      if (!targetTabId || targetTabId === "welcome") return false;
      const layout = currentState.splitLayouts[targetTabId] || null;
      const currentPanes = layout?.panes || [targetTabId];
      if (currentPanes.length >= MAX_PANES) {
        showWarning(t("terminal.pane.maxReached"));
        return false;
      }
      const sourceSessionKey = paneId || layout?.focusedPaneId || targetTabId;
      const newPaneId = createPaneId(targetTabId, currentPanes);
      const sourceTab =
        currentState.panes[sourceSessionKey]?.tab ||
        currentState.tabs.find((item) => item.id === sourceSessionKey);
      const sourceConfig =
        currentState.terminalInstances[`${sourceSessionKey}-config`] || null;

      let paneType = "local";
      let label = t("sidebar.localTerminal");
      let config = {
        useDefaultShell: true,
        name: label,
        type: "local",
        tabId: newPaneId,
      };

      if (mode !== "local" && sourceTab?.type !== "local" && sourceConfig) {
        paneType = sourceTab?.type || sourceConfig.protocol || "ssh";
        label =
          sourceTab?.originalLabel ||
          sourceTab?.label ||
          sourceConfig.name ||
          sourceConfig.host ||
          newPaneId;
        config = {
          ...sourceConfig,
          tabId: newPaneId,
          splitReconnect: false,
        };
      } else if (mode !== "local" && sourceTab?.type === "local") {
        paneType = "local";
        label =
          sourceTab?.originalLabel ||
          sourceTab?.label ||
          sourceConfig?.name ||
          t("sidebar.localTerminal");
        config = {
          ...(sourceConfig ||
            sourceTab.localConfig || { useDefaultShell: true }),
          name: label,
          type: sourceConfig?.type || "local",
          tabId: newPaneId,
        };
      }

      dispatch(
        actions.splitPane(targetTabId, newPaneId, direction, {
          paneType,
          label,
          tab: {
            id: newPaneId,
            type: paneType,
            label,
            ...(config.connectionId || config.id
              ? { connectionId: config.connectionId || config.id }
              : {}),
            ...(paneType === "local" ? { localConfig: config } : {}),
          },
          config,
        }),
      );
      if (paneType === "ssh") {
        markSessionConnecting(newPaneId, config);
      }
      notifyTerminalResize();
      return true;
    },
    [
      appStore,
      currentPanelTab?.id,
      dispatch,
      markSessionConnecting,
      showWarning,
      t,
    ],
  );
  const focusAdjacentPane = useCallback(
    (tabId, direction) => {
      const currentState = appStore.getState();
      const targetTabId =
        tabId || currentState.tabs[currentState.currentTab]?.id;
      if (!targetTabId || targetTabId === "welcome") return false;
      if (!currentState.splitLayouts[targetTabId]) return false;
      dispatch(actions.focusAdjacentPane(targetTabId, direction));
      return true;
    },
    [appStore, dispatch],
  );
  const duplicateTab = useCallback(
    (tabId) => {
      const currentState = appStore.getState();
      const targetTabId =
        tabId || currentState.tabs[currentState.currentTab]?.id;
      const sourceTab = currentState.tabs.find(
        (item) => item.id === targetTabId,
      );
      if (!sourceTab || sourceTab.id === "welcome") return false;
      const sourceConfig =
        currentState.terminalInstances[`${sourceTab.id}-config`] || null;
      if (sourceTab.type === "local") {
        handleOpenLocalTerminalTab({
          ...(sourceConfig ||
            sourceTab.localConfig || { useDefaultShell: true }),
          name: sourceTab.originalLabel || sourceTab.label,
        });
        return true;
      }
      if (sourceConfig) {
        handleCreateSSHConnection({ ...sourceConfig, splitReconnect: false });
        return true;
      }
      if (sourceTab.connectionId) {
        const resolved = findConnectionById(
          currentState.connections,
          sourceTab.connectionId,
        );
        if (resolved) {
          handleCreateSSHConnection(resolved);
          return true;
        }
      }
      return false;
    },
    [appStore, handleCreateSSHConnection, handleOpenLocalTerminalTab],
  );
  const renameTab = useCallback(
    (tabId, customTitle) => {
      if (!tabId || tabId === "welcome") return;
      dispatch(actions.renameTab(tabId, customTitle));
    },
    [dispatch],
  );
  const teardownTabResources = useCallback(
    (tabToRemove, options) =>
      disposeClosedTabResources(
        tabToRemove,
        {
          appStore,
          dispatch,
          currentPanelTabId: currentPanelTab?.id,
          sidebarRef,
          clearReconnectStatus,
          clearReconnectAction,
        },
        options,
      ),
    [
      appStore,
      clearReconnectAction,
      clearReconnectStatus,
      currentPanelTab?.id,
      dispatch,
      sidebarRef,
    ],
  );
  const closeOtherTabs = useCallback(
    (tabId) => {
      const currentState = appStore.getState();
      const targetTabId =
        tabId || currentState.tabs[currentState.currentTab]?.id;
      if (!targetTabId) return;
      const closingTabs = currentState.tabs.filter(
        (item) => item.id !== "welcome" && item.id !== targetTabId,
      );
      if (closingTabs.length === 0) return;
      closingTabs.forEach((tab) =>
        teardownTabResources(tab, { forget: false }),
      );
      dispatch(actions.closeOtherTabs(targetTabId));
      notifyTerminalResize();
    },
    [appStore, dispatch, teardownTabResources],
  );
  const closeTabsToRight = useCallback(
    (tabId) => {
      const currentState = appStore.getState();
      const targetTabId =
        tabId || currentState.tabs[currentState.currentTab]?.id;
      const targetIndex = currentState.tabs.findIndex(
        (item) => item.id === targetTabId,
      );
      if (targetIndex < 0) return;
      const closingTabs = currentState.tabs
        .slice(targetIndex + 1)
        .filter((item) => item.id !== "welcome");
      if (closingTabs.length === 0) return;
      closingTabs.forEach((tab) =>
        teardownTabResources(tab, { forget: false }),
      );
      dispatch(actions.closeTabsToRight(targetTabId));
      notifyTerminalResize();
    },
    [appStore, dispatch, teardownTabResources],
  );
  const reopenLastClosedTab = useCallback(() => {
    const currentState = appStore.getState();
    const stack = currentState.closedTabsStack || [];
    if (stack.length === 0) return false;
    const entry = stack[0];
    dispatch(actions.popClosedTab());

    const plan = resolveWorkspaceRestorePlan(
      { version: 1, activeTabIndex: 1, tabs: [entry] },
      currentState.connections,
      {
        welcomeTab: currentState.tabs[0],
        idPrefix: `reopen-${Date.now()}`,
      },
    );
    if (!plan || plan.tabs.length <= 1) {
      return false;
    }
    const reopenedTabs = plan.tabs.slice(1);
    const nextTabs = [...currentState.tabs, ...reopenedTabs];
    dispatch(
      actions.restoreWorkspace({
        tabs: nextTabs,
        currentTab: currentState.tabs.length,
        splitLayouts: plan.splitLayouts,
        panes: plan.panes,
        terminalInstances: plan.terminalInstances,
      }),
    );
    plan.sshSessions.forEach(({ tabId: sessionId, config }) => {
      markSessionConnecting(sessionId, config);
    });
    notifyTerminalResize();
    return true;
  }, [appStore, dispatch, markSessionConnecting]);
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
    handleOpenLocalTerminalTab,
    handleSendCommand,
    handleCloseTabRef,
    refreshTerminalSession,
    splitPane,
    focusAdjacentPane,
    duplicateTab,
    renameTab,
    closeOtherTabs,
    closeTabsToRight,
    reopenLastClosedTab,
  };
}

function disposeClosedTabResources(
  tabToRemove,
  {
    appStore,
    dispatch,
    currentPanelTabId,
    sidebarRef,
    clearReconnectStatus,
    clearReconnectAction,
  },
  { forget = true } = {},
) {
  if (!tabToRemove || tabToRemove.id === "welcome") return;
  const currentState = appStore.getState();

  const processId = sessionProcessCache[tabToRemove.id];
  if (
    processId &&
    (tabToRemove.type === "ssh" ||
      tabToRemove.type === "telnet" ||
      tabToRemove.type === "serial" ||
      tabToRemove.type === "mosh" ||
      tabToRemove.type === "local")
  ) {
    window.terminalAPI?.killProcess?.(processId).catch((err) => {
      console.warn(`关闭连接时出错: ${err.message}`);
    });
  } else if (tabToRemove.type === "local") {
    window.terminalAPI?.closeLocalTerminal?.(tabToRemove.id).catch((err) => {
      console.warn(`关闭本地终端时出错: ${err.message}`);
    });
  }

  const diagnosticsBeforeClose =
    process.env.NODE_ENV === "development"
      ? getTerminalSessionDiagnostics()
      : null;
  disposeTerminalSession(tabToRemove.id);
  if (process.env.NODE_ENV === "development" && diagnosticsBeforeClose) {
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
    currentState.resourceMonitorOpen &&
    currentPanelTabId === tabToRemove.id
  ) {
    dispatch(actions.setResourceMonitorOpen(false));
  }

  const closingLayout = currentState.splitLayouts[tabToRemove.id];
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
      if (forget) {
        dispatch(actions.removeTabFromSyncGroups(paneId));
      }
    });
    if (forget) {
      dispatch(actions.resetTabLayout(tabToRemove.id));
    }
  }
  if (forget) {
    dispatch(actions.forgetSessions(closingLayout?.panes ?? [tabToRemove.id]));
    dispatch(actions.removeTabFromSyncGroups(tabToRemove.id));
  }

  clearReconnectStatus(tabToRemove.id);
  clearReconnectAction(tabToRemove.id);
}
