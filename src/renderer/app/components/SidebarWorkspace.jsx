import useSidebarResize from "../hooks/useSidebarResize.js";
import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  useAppStore,
  useAppDispatch,
  useAppSelector,
} from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import Box from "@mui/material/Box";
import { smartPreload } from "../LazyComponents.jsx";
import { SessionAIChatWorkspace } from "../SessionWorkspace.jsx";
import { shallowEqual } from "../state/subscriptionStore.js";
import {
  getParentTabId,
  isSessionFileManagerOpen,
  getSessionFileManagerProps,
  retainLiveSessionEntries,
} from "../../features/terminal/model/paneLayout.js";
import { useTranslation } from "react-i18next";
import { Z_INDEX } from "../../shared/constants/zIndex.js";
import { useCleanupManager } from "../../shared/hooks/useAutoCleanup.js";
import GlobalTransferFloat from "../../features/transfers/GlobalTransferFloat.jsx";
import TransferSidebar from "../../features/transfers/TransferSidebar.jsx";
import useAIPanel from "../hooks/useAIPanel.js";
import {
  notifyTerminalResize,
  areFileManagerHistoryStatesEqual,
  normalizeSidebarWidth,
} from "../appShellUtils.js";

import SidebarRail from "./SidebarRail.jsx";
import SidebarPanels from "./SidebarPanels.jsx";

export default function SidebarWorkspace({
  activeSession,
  sidebarWidth,
  sidebarPosition,
  setSidebarWidth,
  setUiSettingsSnapshot,
  setSidebarPosition,
  loadTabConnectionStatus,
  liveSessionKeysRef,
  tabs,
  sessionActionStateRef,
  handlePaneShortcutRef,
  darkMode,
  liveSessionKeys,
  activeSessionKey,
  handleConnectionsUpdate,
  handleOpenConnection,
  handleSendCommand,
  toggleTheme,
  transfers,
  ref,
}) {
  const dispatch = useAppDispatch();
  const appStore = useAppStore();
  const eventManager = useCleanupManager();
  const { t } = useTranslation();
  const state = useAppSelector(
    (state) => ({
      connectionManagerOpen: state.connectionManagerOpen,
      resourceMonitorOpen: state.resourceMonitorOpen,
      fileManagerOpenByTabId: state.fileManagerOpenByTabId,
      ipAddressQueryOpen: state.ipAddressQueryOpen,
      securityToolsOpen: state.securityToolsOpen,
      portForwardingOpen: state.portForwardingOpen,
      shortcutCommandsOpen: state.shortcutCommandsOpen,
      commandHistoryOpen: state.commandHistoryOpen,
      lastOpenedSidebar: state.lastOpenedSidebar,
      fileManagerPaths: state.fileManagerPaths,
      aiChatStatus: state.aiChatStatus,
      aiInputPreset: state.aiInputPreset,
      connections: state.connections,
    }),
    shallowEqual,
  );
  const connections = state.connections;
  const {
    transferFloatOpen,
    transferFloatInitialTransfer,
    transferSidebarOpen,
    setTransferSidebarOpen,
    resumableTransferCount,
    setResumableTransferCount,
    lastActiveFloatWindow,
    setLastActiveFloatWindow,
    handleCloseTransferFloat,
    handleToggleTransferSidebar,
  } = transfers;
  const [createConnectionSignal, setCreateConnectionSignal] = React.useState(0);
  const connectionManagerOpen = state.connectionManagerOpen;
  const resourceMonitorRequested = state.resourceMonitorOpen;
  const ipAddressQueryOpen = state.ipAddressQueryOpen;
  const securityToolsOpen = state.securityToolsOpen;
  const portForwardingOpen = state.portForwardingOpen;
  const shortcutCommandsOpen = state.shortcutCommandsOpen;
  const commandHistoryOpen = state.commandHistoryOpen;
  const lastOpenedSidebar = state.lastOpenedSidebar;
  const fileManagerPaths = state.fileManagerPaths;
  const aiChatStatus = state.aiChatStatus;
  const aiInputPreset = state.aiInputPreset;
  const canMonitorCurrentSession =
    !activeSession ||
    activeSession.type === "local" ||
    (activeSession.type === "ssh" && Boolean(activeSession.processId));
  const resourceMonitorOpen =
    resourceMonitorRequested && canMonitorCurrentSession;
  const fileManagerOpen = isSessionFileManagerOpen(state, activeSession);
  const [fileManagerHistoryByTabId, setFileManagerHistoryByTabId] = useState(
    {},
  );
  const [localTerminalSidebarOpen, setLocalTerminalSidebarOpen] =
    React.useState(false);

  const {
    aiPanelOpen,
    aiApiReachable,
    handleToggleGlobalAiChatWindow,
    handleMinimizeGlobalAiChatWindow,
    handleCloseGlobalAiChatWindow,
    handleSendToAI,
  } = useAIPanel({
    aiChatStatus,
    dispatch,
    setLastActiveFloatWindow,
  });

  const transferSidebarButtonRef = useRef(null);
  const aiChatButtonRef = useRef(null);
  const findFallbackSidebar = React.useCallback(
    (closingSidebar) => {
      const openSidebars = [
        ["localTerminal", localTerminalSidebarOpen],
        ["password", securityToolsOpen],
        ["forwarding", portForwardingOpen],
        ["ipquery", ipAddressQueryOpen],
        ["history", commandHistoryOpen],
        ["shortcut", shortcutCommandsOpen],
        ["file", fileManagerOpen],
        ["connection", connectionManagerOpen],
        ["resource", resourceMonitorOpen],
      ];
      return (
        openSidebars.find(
          ([sidebar, isOpen]) => sidebar !== closingSidebar && isOpen,
        )?.[0] || null
      );
    },
    [
      commandHistoryOpen,
      connectionManagerOpen,
      fileManagerOpen,
      ipAddressQueryOpen,
      localTerminalSidebarOpen,
      portForwardingOpen,
      resourceMonitorOpen,
      securityToolsOpen,
      shortcutCommandsOpen,
    ],
  );
  const setFallbackSidebarAfterClose = React.useCallback(
    (closingSidebar) => {
      if (lastOpenedSidebar === closingSidebar) {
        dispatch(
          actions.setLastOpenedSidebar(findFallbackSidebar(closingSidebar)),
        );
      }
    },
    [dispatch, findFallbackSidebar, lastOpenedSidebar],
  );
  const sidebarOpenFlags = {
    resource: resourceMonitorOpen,
    connection: connectionManagerOpen,
    file: fileManagerOpen,
    shortcut: shortcutCommandsOpen,
    history: commandHistoryOpen,
    ipquery: ipAddressQueryOpen,
    password: securityToolsOpen,
    forwarding: portForwardingOpen,
    localTerminal: localTerminalSidebarOpen,
  };
  const hasVisibleSidebar = Boolean(
    (lastOpenedSidebar && sidebarOpenFlags[lastOpenedSidebar]) ||
    findFallbackSidebar(null),
  );
  const runSidebarToggle = React.useCallback(
    (isOpen, setOpen, sidebarKey, { notifyResize = true } = {}) => {
      const willOpen = !isOpen;
      setOpen(willOpen);
      if (willOpen) {
        dispatch(actions.setLastOpenedSidebar(sidebarKey));
      } else {
        setFallbackSidebarAfterClose(sidebarKey);
      }
      if (notifyResize) {
        notifyTerminalResize();
      }
    },
    [dispatch, setFallbackSidebarAfterClose],
  );
  const runSidebarClose = React.useCallback(
    (setOpen, sidebarKey, { notifyResize = true } = {}) => {
      setOpen(false);
      setFallbackSidebarAfterClose(sidebarKey);
      if (notifyResize) {
        notifyTerminalResize();
      }
    },
    [setFallbackSidebarAfterClose],
  );
  const { sidebarResizing, handleSidebarResizeStart } = useSidebarResize({
    sidebarWidth,
    sidebarPosition,
    setSidebarWidth,
    setUiSettingsSnapshot,
  });
  React.useEffect(() => {
    const triggerDelays = [10, 100, 280];
    const timers = triggerDelays.map((delay) =>
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("sidebarChanged", {
            detail: {
              sidebarWidth: hasVisibleSidebar ? sidebarWidth : 0,
              timestamp: Date.now(),
            },
          }),
        );
      }, delay),
    );
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [hasVisibleSidebar, sidebarPosition, sidebarWidth]);
  const handleToggleSidebarPosition = useCallback(async () => {
    const nextPosition = sidebarPosition === "left" ? "right" : "left";
    setSidebarPosition(nextPosition);
    if (!window.terminalAPI?.saveUISettings) {
      return;
    }
    try {
      let currentSettings = {
        language: "zh-CN",
        fontSize: 14,
      };
      if (window.terminalAPI?.loadUISettings) {
        const loadedSettings = await window.terminalAPI.loadUISettings();
        if (loadedSettings) {
          currentSettings = loadedSettings;
        }
      }
      await window.terminalAPI.saveUISettings({
        ...currentSettings,
        sidebarPosition: nextPosition,
      });
    } catch (error) {
      console.error("Failed to save sidebar position:", error);
    }
  }, [sidebarPosition]);
  const toggleConnectionManager = useCallback(() => {
    runSidebarToggle(
      connectionManagerOpen,
      (open) => dispatch(actions.setConnectionManagerOpen(open)),
      "connection",
    );
  }, [connectionManagerOpen, dispatch, runSidebarToggle]);
  const handleCloseConnectionManager = useCallback(() => {
    runSidebarClose(
      (open) => dispatch(actions.setConnectionManagerOpen(open)),
      "connection",
      {
        notifyResize: false,
      },
    );
  }, [dispatch, runSidebarClose]);
  const handleRequestCreateConnection = useCallback(() => {
    dispatch(actions.setConnectionManagerOpen(true));
    dispatch(actions.setLastOpenedSidebar("connection"));
    setCreateConnectionSignal(Date.now());
    notifyTerminalResize();
  }, [dispatch]);
  const toggleResourceMonitor = useCallback(() => {
    runSidebarToggle(
      resourceMonitorOpen,
      (open) => dispatch(actions.setResourceMonitorOpen(open)),
      "resource",
    );
  }, [resourceMonitorOpen, dispatch, runSidebarToggle]);
  const handleCloseResourceMonitor = useCallback(() => {
    runSidebarClose(
      (open) => dispatch(actions.setResourceMonitorOpen(open)),
      "resource",
      {
        notifyResize: false,
      },
    );
  }, [dispatch, runSidebarClose]);
  const toggleFileManager = () => {
    const panelTab = activeSession;
    if (!panelTab) {
      return;
    }
    if (!fileManagerOpen && !isCurrentPanelSshConnected) {
      if (panelTab.type === "ssh") {
        void loadTabConnectionStatus(panelTab.id);
      }
      return;
    }
    const willOpen = !fileManagerOpen;
    dispatch(actions.setFileManagerOpenForTab(panelTab.parentTabId, willOpen));
    if (willOpen) {
      dispatch(actions.setLastOpenedSidebar("file"));
    } else {
      setFallbackSidebarAfterClose("file");
    }
    notifyTerminalResize();
  };
  const handleCloseFileManager = () => {
    const panelTab = activeSession;
    runSidebarClose((open) => {
      if (panelTab) {
        dispatch(actions.setFileManagerOpenForTab(panelTab.parentTabId, open));
      }
    }, "file");
  };
  const updateFileManagerPath = (tabId, path) => {
    if (tabId && path) {
      if (liveSessionKeysRef.current.has(tabId))
        dispatch(actions.updateFileManagerPath(tabId, path));
    }
  };
  const updateFileManagerHistory = useCallback((tabId, navigationState) => {
    if (!tabId || !navigationState || !liveSessionKeysRef.current.has(tabId)) {
      return;
    }
    const nextHistoryState = {
      pathHistory: Array.isArray(navigationState.pathHistory)
        ? navigationState.pathHistory
        : [],
      historyIndex: Number.isInteger(navigationState.historyIndex)
        ? navigationState.historyIndex
        : -1,
    };
    setFileManagerHistoryByTabId((previous) => {
      const current = previous[tabId];
      if (areFileManagerHistoryStatesEqual(current, nextHistoryState)) {
        return previous;
      }
      return {
        ...previous,
        [tabId]: nextHistoryState,
      };
    });
  }, []);
  const toggleShortcutCommands = () => {
    runSidebarToggle(
      shortcutCommandsOpen,
      (open) => dispatch(actions.setShortcutCommandsOpen(open)),
      "shortcut",
    );
  };
  const handleCloseShortcutCommands = () => {
    runSidebarClose(
      (open) => dispatch(actions.setShortcutCommandsOpen(open)),
      "shortcut",
    );
  };
  const toggleCommandHistory = () => {
    runSidebarToggle(
      commandHistoryOpen,
      (open) => dispatch(actions.setCommandHistoryOpen(open)),
      "history",
    );
  };
  const handleCloseCommandHistory = () => {
    runSidebarClose(
      (open) => dispatch(actions.setCommandHistoryOpen(open)),
      "history",
    );
  };
  const toggleIpAddressQuery = () => {
    runSidebarToggle(
      ipAddressQueryOpen,
      (open) => dispatch(actions.setIpAddressQueryOpen(open)),
      "ipquery",
    );
  };
  const handleCloseIpAddressQuery = () => {
    runSidebarClose(
      (open) => dispatch(actions.setIpAddressQueryOpen(open)),
      "ipquery",
    );
  };
  const toggleSecurityTools = () => {
    runSidebarToggle(
      securityToolsOpen,
      (open) => dispatch(actions.setSecurityToolsOpen(open)),
      "password",
      {
        notifyResize: false,
      },
    );
  };
  const togglePortForwarding = () => {
    runSidebarToggle(
      portForwardingOpen,
      (open) => dispatch(actions.setPortForwardingOpen(open)),
      "forwarding",
      {
        notifyResize: false,
      },
    );
  };
  const toggleLocalTerminalSidebar = () => {
    runSidebarToggle(
      localTerminalSidebarOpen,
      setLocalTerminalSidebarOpen,
      "localTerminal",
    );
  };
  const handleCloseLocalTerminalSidebar = () => {
    runSidebarClose(setLocalTerminalSidebarOpen, "localTerminal");
  };
  const handleLaunchLocalTerminal = useCallback(
    async (terminalConfig) => {
      if (!terminalConfig) {
        throw new Error(t("localTerminal.noTerminalSelected"));
      }
      const terminalId = `local-${Date.now()}`;
      const defaultDistribution = Array.isArray(
        terminalConfig.availableDistributions,
      )
        ? terminalConfig.availableDistributions.find(
            (dist) => dist.isDefault,
          ) || terminalConfig.availableDistributions[0]
        : null;
      const distribution =
        terminalConfig.distribution || defaultDistribution?.name || undefined;
      const baseLabel =
        terminalConfig.type === "wsl" && distribution
          ? distribution
          : terminalConfig.name || terminalConfig.executable || "Local";
      const sameLabelCount = tabs.filter(
        (tab) => tab.type === "local" && tab.label?.startsWith(baseLabel),
      ).length;
      const tabLabel =
        sameLabelCount > 0 ? `${baseLabel} ${sameLabelCount + 1}` : baseLabel;
      const completeConfig = {
        name: tabLabel,
        type: terminalConfig.type,
        executablePath: terminalConfig.executablePath,
        executable: terminalConfig.executable,
        command: terminalConfig.command,
        args: terminalConfig.args || terminalConfig.launchArgs || [],
        launchArgs: terminalConfig.launchArgs || terminalConfig.args || [],
        cwd: terminalConfig.cwd,
        env: terminalConfig.env,
        distribution,
        availableDistributions: terminalConfig.availableDistributions || [],
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
          ...appStore.getState().terminalInstances,
          [terminalId]: true,
          [`${terminalId}-config`]: completeConfig,
          [`${terminalId}-processId`]: null,
        }),
      );
      const newTabs = [...tabs, newTab];
      dispatch(actions.setTabs(newTabs));
      dispatch(actions.setCurrentTab(newTabs.length - 1));
      setLocalTerminalSidebarOpen(false);
      setFallbackSidebarAfterClose("localTerminal");
      notifyTerminalResize();
      return {
        success: true,
        data: newTab,
      };
    },
    [dispatch, setFallbackSidebarAfterClose, tabs, appStore],
  );
  const currentPanelConnectionStatus = activeSession?.status;
  const isCurrentPanelSshConnected =
    activeSession?.type === "ssh" &&
    currentPanelConnectionStatus?.isConnected === true &&
    currentPanelConnectionStatus?.isConnecting !== true;
  const resourceMonitorTabId =
    resourceMonitorOpen && activeSession?.type === "ssh"
      ? activeSession.processId
      : null;
  const fileManagerProps = useMemo(
    () =>
      getSessionFileManagerProps(
        activeSession,
        fileManagerPaths,
        fileManagerHistoryByTabId,
      ),
    [activeSession, fileManagerPaths, fileManagerHistoryByTabId],
  );
  const sidebarSessionContext = useMemo(() => {
    if (!activeSession) return null;
    const { type, config, label, status } = activeSession;
    if (type === "local")
      return {
        protocol: "LOCAL",
        host: label,
        quality: t("sidebar.sessionLocal"),
      };
    return {
      protocol: type.toUpperCase(),
      host: config?.host
        ? `${config.username ? `${config.username}@` : ""}${config.host}${config.port ? `:${config.port}` : ""}`
        : label,
      quality: status?.isConnecting
        ? t("sidebar.sessionConnecting")
        : status?.isConnected
          ? t("sidebar.sessionConnected")
          : t("sidebar.sessionDisconnected"),
    };
  }, [activeSession, t]);
  const isFileManagerButtonDisabled = !isCurrentPanelSshConnected;
  const activeSidebarContentWidth = hasVisibleSidebar
    ? normalizeSidebarWidth(sidebarWidth)
    : 0;
  React.useEffect(() => {
    // 处理欢迎页AI按钮点击事件
    const handleToggleGlobalAI = () => {
      handleToggleGlobalAiChatWindow();
    };

    // 监听发送到AI助手事件
    const handleSendToAIEvent = (event) => {
      const sessionKey = event.detail.sessionKey;
      if (sessionKey) {
        const current = sessionActionStateRef.current;
        const parentId = getParentTabId(sessionKey, current.panes);
        const index = current.tabs.findIndex((tab) => tab.id === parentId);
        if (index < 0) return;
        dispatch(actions.setCurrentTab(index));
        dispatch(actions.focusPane(parentId, sessionKey));
      }
      handleSendToAI(event.detail.text);
    };

    // Alt+F1 全局快捷键唤醒AI助手；Ctrl+Shift+W 关闭聚焦窗格
    // （分屏创建统一由拖拽标签页合并触发，无快捷键分屏入口）
    const handleGlobalKeyDown = (event) => {
      if (event.altKey && event.key === "F1") {
        event.preventDefault();
        handleToggleGlobalAiChatWindow();
        return;
      }
      if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "w") {
          event.preventDefault();
          handlePaneShortcutRef.current("close");
        }
      }
    };

    // 使用 useWindowEvents Hook 统一管理多个 window 事件监听
    // 注意：为了避免在 useEffect 中再使用 Hook，我们继续使用 eventManager

    const removeToggleListener = eventManager.addEventListener(
      window,
      "toggleGlobalAI",
      handleToggleGlobalAI,
    );
    const removeSendToAIListener = eventManager.addEventListener(
      window,
      "sendToAI",
      handleSendToAIEvent,
    );
    const removeKeyDownListener = eventManager.addEventListener(
      window,
      "keydown",
      handleGlobalKeyDown,
    );

    // 初始化应用设置

    return () => {
      smartPreload.cancelAllScheduled();
      removeToggleListener();
      removeSendToAIListener();
      removeKeyDownListener();
    };
  }, [darkMode, dispatch, aiChatStatus]);
  React.useEffect(() => {
    const keys = new Set(liveSessionKeys);
    setFileManagerHistoryByTabId((previous) =>
      retainLiveSessionEntries(previous, keys),
    );
  }, [liveSessionKeys]);
  React.useImperativeHandle(ref, () => ({
    requestCreateConnection: handleRequestCreateConnection,
    closeFileManagerForTab: (tabId) => {
      if (appStore.getState().fileManagerOpenByTabId[tabId]) {
        dispatch(actions.setFileManagerOpenForTab(tabId, false));
        if (fileManagerOpen) setFallbackSidebarAfterClose("file");
      }
    },
  }));
  return (
    <>
      <Box
        sx={{
          position: "relative",
          height: "100%",
          display: "flex",
          flexShrink: 0,
          flexDirection: sidebarPosition === "left" ? "row-reverse" : "row",
          zIndex: Z_INDEX.sidebar,
        }}
      >
        {/* 拖拽手柄放在无 overflow 裁剪的外层容器中，
                  否则 8px 手柄外移 4px 后一半被宽度动画容器裁掉 */}
        {activeSidebarContentWidth > 0 && (
          <Box
            role="separator"
            aria-orientation="vertical"
            aria-label={t("sidebar.resize")}
            tabIndex={-1}
            onPointerDown={handleSidebarResizeStart}
            sx={(theme) => ({
              position: "absolute",
              top: 0,
              bottom: 0,
              [sidebarPosition === "left" ? "right" : "left"]: 0,
              width: 8,
              cursor: "col-resize",
              zIndex: Z_INDEX.sidebarResize,
              touchAction: "none",
              outline: "none",
              transform:
                sidebarPosition === "left"
                  ? "translateX(4px)"
                  : "translateX(-4px)",
              "&::after": {
                content: '""',
                position: "absolute",
                top: 0,
                bottom: 0,
                left: "50%",
                width: 2,
                transform: "translateX(-50%)",
                bgcolor: sidebarResizing ? "primary.main" : "transparent",
                opacity: sidebarResizing ? 0.8 : 0,
                transition: theme.transitions.create(
                  ["background-color", "opacity"],
                  {
                    duration: theme.transitions.duration.shortest,
                  },
                ),
              },
              "&:hover::after": {
                bgcolor: "primary.main",
                opacity: 0.45,
              },
            })}
          />
        )}
        {/* 侧边栏内容区域 - 根据是否有侧边栏打开来显示 */}
        <SidebarPanels
          resourceMonitorOpen={resourceMonitorOpen}
          fileManagerOpen={fileManagerOpen}
          localTerminalSidebarOpen={localTerminalSidebarOpen}
          activeSidebarContentWidth={activeSidebarContentWidth}
          sidebarResizing={sidebarResizing}
          activeSessionKey={activeSessionKey}
          handleCloseResourceMonitor={handleCloseResourceMonitor}
          resourceMonitorTabId={resourceMonitorTabId}
          sidebarSessionContext={sidebarSessionContext}
          handleCloseConnectionManager={handleCloseConnectionManager}
          connections={connections}
          handleConnectionsUpdate={handleConnectionsUpdate}
          handleOpenConnection={handleOpenConnection}
          createConnectionSignal={createConnectionSignal}
          setCreateConnectionSignal={setCreateConnectionSignal}
          fileManagerProps={fileManagerProps}
          handleCloseFileManager={handleCloseFileManager}
          updateFileManagerPath={updateFileManagerPath}
          updateFileManagerHistory={updateFileManagerHistory}
          handleCloseShortcutCommands={handleCloseShortcutCommands}
          handleSendCommand={handleSendCommand}
          handleCloseCommandHistory={handleCloseCommandHistory}
          handleCloseIpAddressQuery={handleCloseIpAddressQuery}
          setFallbackSidebarAfterClose={setFallbackSidebarAfterClose}
          activeSession={activeSession}
          handleCloseLocalTerminalSidebar={handleCloseLocalTerminalSidebar}
          handleLaunchLocalTerminal={handleLaunchLocalTerminal}
        />

        {/* 图标轨 Activity Rail：上=会话区 / 中=工具 / 下=AI·主题·位置 */}
        <SidebarRail
          sidebarPosition={sidebarPosition}
          toggleConnectionManager={toggleConnectionManager}
          isFileManagerButtonDisabled={isFileManagerButtonDisabled}
          toggleFileManager={toggleFileManager}
          fileManagerOpen={fileManagerOpen}
          toggleShortcutCommands={toggleShortcutCommands}
          activeSession={activeSession}
          toggleCommandHistory={toggleCommandHistory}
          toggleResourceMonitor={toggleResourceMonitor}
          canMonitorCurrentSession={canMonitorCurrentSession}
          toggleIpAddressQuery={toggleIpAddressQuery}
          toggleSecurityTools={toggleSecurityTools}
          togglePortForwarding={togglePortForwarding}
          toggleLocalTerminalSidebar={toggleLocalTerminalSidebar}
          localTerminalSidebarOpen={localTerminalSidebarOpen}
          transferSidebarButtonRef={transferSidebarButtonRef}
          transferSidebarOpen={transferSidebarOpen}
          resumableTransferCount={resumableTransferCount}
          handleToggleTransferSidebar={handleToggleTransferSidebar}
          aiPanelOpen={aiPanelOpen}
          aiApiReachable={aiApiReachable}
          aiChatButtonRef={aiChatButtonRef}
          handleToggleGlobalAiChatWindow={handleToggleGlobalAiChatWindow}
          toggleTheme={toggleTheme}
          darkMode={darkMode}
          handleToggleSidebarPosition={handleToggleSidebarPosition}
        />
      </Box>
      {aiChatStatus !== "closed" && (
        <SessionAIChatWorkspace
          activeSessionKey={activeSessionKey}
          windowState={aiChatStatus}
          onClose={handleCloseGlobalAiChatWindow}
          onMinimize={handleMinimizeGlobalAiChatWindow}
          presetInput={aiInputPreset}
          onInputPresetUsed={() => dispatch(actions.setAiInputPreset(""))}
          onExecuteCommand={handleSendCommand}
          zIndex={
            lastActiveFloatWindow === "ai"
              ? Z_INDEX.floatWindowActive
              : Z_INDEX.floatWindow
          }
          onFocus={() => setLastActiveFloatWindow("ai")}
          anchorEl={aiChatButtonRef.current}
        />
      )}
      {/* 所有显示模式均可打开传输面板，恢复重启后保留的任务。 */}
      {
        <TransferSidebar
          open={transferSidebarOpen}
          onRecoveryCount={setResumableTransferCount}
          onClose={() => setTransferSidebarOpen(false)}
          zIndex={
            lastActiveFloatWindow === "transfer"
              ? Z_INDEX.floatWindowActive
              : Z_INDEX.floatWindow
          }
          onFocus={() => setLastActiveFloatWindow("transfer")}
          anchorEl={transferSidebarButtonRef.current}
        />
      }
      <GlobalTransferFloat
        open={transferFloatOpen}
        onClose={handleCloseTransferFloat}
        initialTransfer={transferFloatInitialTransfer}
      />
    </>
  );
}
