import { Z_INDEX } from "../shared/constants/zIndex.js";
import AppMenu from "./components/AppMenu.jsx";
import SessionContextMenu from "./components/SessionContextMenu.jsx";
import * as React from "react";
import { useCallback, useMemo, useRef } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import {
  useAppStore,
  useAppDispatch,
  useTerminalSelector,
  useReconnectSelector,
  useShellSelector,
} from "./state/AppContext.jsx";
import { actions } from "./state/appReducer.js";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tabs from "@mui/material/Tabs";
import AppsIcon from "@mui/icons-material/Apps";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import Tooltip from "@mui/material/Tooltip";
import WelcomePage from "../features/welcome/WelcomePage.jsx";
import { SessionWorkspace } from "./SessionWorkspace.jsx";
import SessionTab from "./SessionTab.jsx";
import PaneDropOverlay from "./PaneDropOverlay.jsx";
import { shallowEqual } from "./state/subscriptionStore.js";
import {
  getFocusedSessionKey,
  getSessionDescriptor,
} from "../features/terminal/model/paneLayout.js";
import NetworkLatencyIndicator from "../features/connections/NetworkLatencyIndicator.jsx";
import WindowControls from "./components/WindowControls.jsx";
import { useTranslation } from "react-i18next";
import { findGroupByTab } from "../features/terminal/model/syncInputGroups";
import { useCleanupManager } from "../shared/hooks/useAutoCleanup.js";
import GlobalTransferBar from "../features/transfers/GlobalTransferBar.jsx";
import { processCache as sessionProcessCache } from "../features/terminal/runtime/terminalSessionStore.js";
import useCredentialSecurity from "./hooks/useCredentialSecurity.js";
import useReconnect from "./hooks/useReconnect.js";
import useAppTheme from "./hooks/useAppTheme.js";
import useTransferPanels from "./hooks/useTransferPanels.js";
import useTabBarScroll from "./hooks/useTabBarScroll.js";

import useShellConnections from "./hooks/useShellConnections.js";
import useShellMenus from "./hooks/useShellMenus.js";
import useShellNotices from "./hooks/useShellNotices.js";
import useSessionTabs from "./hooks/useSessionTabs.js";
import useSessionDragDrop from "./hooks/useSessionDragDrop.js";
import SidebarWorkspace from "./components/SidebarWorkspace.jsx";
import DialogsLayer from "./components/DialogsLayer.jsx";

const selectShellLayout = (state) => ({
  tabs: state.tabs,
  syncGroups: state.syncGroups,
  currentTab: state.currentTab,
  tabContextMenu: state.tabContextMenu,
  connections: state.connections,
  topConnections: state.topConnections,
  splitLayouts: state.splitLayouts,
  panes: state.panes,
  anchorEl: state.anchorEl,
});
export default function AppShell() {
  const sidebarRef = useRef(null);
  const handleRequestCreateConnection = useCallback(
    () => sidebarRef.current?.requestCreateConnection(),
    [],
  );
  const { t, i18n } = useTranslation();
  const eventManager = useCleanupManager(); // 使用统一的事件管理器

  const state = useShellSelector(selectShellLayout, shallowEqual);
  const appStore = useAppStore();
  const dispatch = useAppDispatch();

  const {
    credentialSecurityStatus,
    masterPasswordError,
    unlockingCredentialStore,
    handleUnlockCredentialStore,
    handleLockApp,
  } = useCredentialSecurity();
  const {
    uiSettingsSnapshot,
    setUiSettingsSnapshot,
    uiSettingsLoaded,
    darkMode,
    themeLoading,
    dndEnabled,
    transferBarMode,
    sidebarPosition,
    setSidebarPosition,
    sidebarWidth,
    setSidebarWidth,
    theme,
    toggleTheme,
  } = useAppTheme();

  React.useEffect(() => {
    if (tabs.length > 0 && tabs[0].id === "welcome") {
      const newLabel = t("terminal.welcome");
      if (tabs[0].label !== newLabel) {
        dispatch(
          actions.setTabs([
            {
              ...tabs[0],
              label: newLabel,
            },
            ...tabs.slice(1),
          ]),
        );
      }
    }
  }, [i18n.language, t, dispatch]); // 移除 state.tabs 依赖

  const tabs = state.tabs;
  const syncGroups = state.syncGroups;
  const latestTabsForActionsRef = useRef(tabs);
  latestTabsForActionsRef.current = tabs;
  const currentTab = state.currentTab;

  const tabContextMenu = state.tabContextMenu;
  const connections = state.connections;
  const topConnections = state.topConnections;

  const splitLayouts = state.splitLayouts;
  const paneRegistry = state.panes;
  const anchorEl = state.anchorEl;
  const open = Boolean(anchorEl);

  const currentPanelTab =
    currentTab > 0 && tabs[currentTab] ? tabs[currentTab] : null;

  const activeSessionKey = getFocusedSessionKey(state);
  const sessionActionStateRef = useMemo(
    () => ({
      get current() {
        return appStore.getState();
      },
    }),
    [appStore],
  );

  const terminalInstancesRef = useMemo(
    () => ({
      get current() {
        return appStore.getState().terminalInstances;
      },
    }),
    [appStore],
  );
  const {
    markSessionConnecting,
    liveSessionKeys,
    liveSessionKeysRef,
    clearReconnectAction,
    clearReconnectStatus,
    loadTabConnectionStatus,
    loadReconnectStatus,
    handlePauseReconnect: handlePauseReconnectForTab,
    handleResumeReconnect: handleResumeReconnectForTab,
  } = useReconnect({
    tabs,
    splitLayouts,
  });
  const activeTerminal = useTerminalSelector(
    (instances) => ({
      config: instances[`${activeSessionKey}-config`],
      processId: instances[`${activeSessionKey}-processId`],
    }),
    shallowEqual,
  );
  const activeConnectionStatus = useReconnectSelector(
    (status) => status.connectionStatusByTabId[activeSessionKey],
  );
  const activeSession = useMemo(
    () =>
      getSessionDescriptor(
        {
          ...state,
          terminalInstances: {
            [`${activeSessionKey}-config`]: activeTerminal.config,
            [`${activeSessionKey}-processId`]: activeTerminal.processId,
          },
        },
        activeSessionKey,
        { [activeSessionKey]: activeConnectionStatus },
        sessionProcessCache,
      ),
    [
      tabs,
      paneRegistry,
      activeSessionKey,
      activeTerminal,
      activeConnectionStatus,
    ],
  );

  const transfers = useTransferPanels();
  const {
    transferFloatOpen,
    handleOpenTransferFloat,
    handleToggleTransferFloat,
  } = transfers;

  const { tabsRef, hasTabOverflow } = useTabBarScroll({
    tabCount: tabs.length,
    currentTab,
  });

  const contextMenuTab =
    tabContextMenu.tabIndex !== null &&
    tabContextMenu.tabIndex >= 0 &&
    tabContextMenu.tabIndex < tabs.length
      ? tabs[tabContextMenu.tabIndex]
      : null;

  React.useEffect(() => {
    const handleTerminalProcessIdUpdate = (event) => {
      const { terminalId, processId } = event.detail;
      if (terminalId && processId) {
        dispatch(
          actions.setTerminalInstances({
            ...terminalInstancesRef.current,
            [`${terminalId}-processId`]: processId,
          }),
        );
      }
    };
    const removeTerminalListener = eventManager.addEventListener(
      window,
      "terminalProcessIdUpdated",
      handleTerminalProcessIdUpdate,
    );
    return () => {
      removeTerminalListener();
    };
  }, [dispatch, eventManager]);

  const handleTabContextMenu = useCallback(
    (event, index, tabId) => {
      event.preventDefault();

      if (tabs[index].id === "welcome") return;
      dispatch(
        actions.setTabContextMenu({
          mouseX: event.clientX - 2,
          mouseY: event.clientY - 4,
          tabIndex: index,
          tabId: tabId,
        }),
      );
      if (tabs[index]?.type === "ssh") {
        void loadReconnectStatus(tabId);
      }
    },
    [tabs, dispatch, loadReconnectStatus],
  );
  const handleTabContextMenuRef = useRef(handleTabContextMenu);
  handleTabContextMenuRef.current = handleTabContextMenu;
  const handleTabContextMenuFromTab = useCallback((event, tabId, index) => {
    handleTabContextMenuRef.current(event, index, tabId);
  }, []);

  const handleTabContextMenuClose = useCallback(() => {
    dispatch(
      actions.setTabContextMenu({
        mouseX: null,
        mouseY: null,
        tabIndex: null,
        tabId: null,
      }),
    );
  }, [dispatch]);

  const splitLayoutsRef = useRef(splitLayouts);
  splitLayoutsRef.current = splitLayouts;
  const paneRegistryRef = useRef(paneRegistry);
  paneRegistryRef.current = paneRegistry;

  React.useEffect(() => {
    if (!activeSessionKey || activeSession?.type === "local") return;
    void loadTabConnectionStatus(activeSessionKey);
    void loadReconnectStatus(activeSessionKey);
  }, [
    activeSessionKey,
    activeSession?.type,
    loadTabConnectionStatus,
    loadReconnectStatus,
  ]);

  const handleJoinGroup = (tabId, groupId) => {
    dispatch(actions.joinSyncGroup(tabId, groupId));
    handleTabContextMenuClose();
  };
  const handleRemoveFromGroup = (tabId) => {
    dispatch(actions.removeTabFromSyncGroups(tabId));
    handleTabContextMenuClose();
  };
  const handleCreateGroup = (tabId) => {
    dispatch(actions.createSyncGroup(tabId));
    handleTabContextMenuClose();
  };

  const { handleConnectionsUpdate, connectionsRef, connectionsLoaded } =
    useShellConnections({
      connections,
      topConnections,
      credentialSecurityStatus,
      tabs,
    });
  const {
    handleTopBarInteraction,
    handleMenu,
    handleClose,
    handleOpenSettings,
    handleOpenLogDirectory,
    handleExportDiagnostics,
    handleOpenFeedbackIssue,
    handleOpenAbout,
    handleExit,
    handleCloseAbout,
    aboutUpdateCheckSignal,
    handleRemindUpdateLater,
    handleCloseSettings,
  } = useShellMenus({ open });
  const { diskAlertsByTabId } = useShellNotices({ liveSessionKeys });
  const {
    handleTabChange,
    handleTabCloseRequest,
    handleRefreshTerminal,
    handleCloseConnection,
    handleUnsplitTab,
    handleOpenConnection,
    handleSendCommand,
    handleCloseTabRef,
    refreshTerminalSession,
  } = useSessionTabs({
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
  });
  const {
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleTerminalAreaDragOver,
    handleTerminalAreaDragLeave,
    handleTerminalAreaDrop,
    handleFocusPane,
    handleClosePane,
    handleSetRatios,
    handlePaneDragStart,
    handlePaneDragOver,
    handlePaneDrop,
    handlePaneDragEnd,
    handlePaneShortcutRef,
  } = useSessionDragDrop({
    splitLayoutsRef,
    latestTabsForActionsRef,
    handleCloseTabRef,
    currentTab,
    paneRegistryRef,
    refreshTerminalSession,
    tabs,
  });

  const handlePauseReconnect = () =>
    handlePauseReconnectForTab(tabContextMenu.tabId).then((done) => {
      if (done) handleTabContextMenuClose();
    });
  const handleResumeReconnect = () =>
    handleResumeReconnectForTab(tabContextMenu.tabId).then((done) => {
      if (done) handleTabContextMenuClose();
    });
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {themeLoading ? (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            width: "100%",
            height: "100%",
            bgcolor: "background.default",
          }}
        >
          {/* 简单加载提示，不显示任何文本避免复杂化 */}
        </Box>
      ) : (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            width: "100%",
            height: "100%",
            overflow: "hidden",
          }}
        >
          <AppBar
            position="relative"
            sx={{
              width: "100%",
              bgcolor: "background.paper",
              color: "text.primary",
              boxShadow: "none",
              borderBottom: "1px solid",
              borderColor: "divider",

              zIndex: Z_INDEX.control,
            }}
          >
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
                WebkitAppRegion: "drag",
              }}
            >
              <Toolbar
                variant="dense"
                onMouseDownCapture={handleTopBarInteraction}
                sx={{
                  px: 1,
                  minHeight: "30px",
                  display: "flex",
                  alignItems: "center",
                  gap: 0.5,
                  WebkitAppRegion: "no-drag",
                }}
              >
                <Tooltip title={t("menu.mainMenu")}>
                  <IconButton
                    edge="start"
                    color="inherit"
                    aria-label={t("menu.mainMenu")}
                    data-main-menu-button="true"
                    sx={{
                      mr: 1,
                      WebkitAppRegion: "no-drag",
                    }}
                    onClick={handleMenu}
                  >
                    <AppsIcon />
                  </IconButton>
                </Tooltip>
                {credentialSecurityStatus.masterPasswordEnabled && (
                  <Tooltip title={t("menu.lockApp")}>
                    <IconButton
                      color="inherit"
                      size="small"
                      aria-label={t("menu.lockApp")}
                      sx={{
                        mr: 1,
                        WebkitAppRegion: "no-drag",
                      }}
                      onClick={handleLockApp}
                    >
                      <LockOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
                <AppMenu
                  anchorEl={anchorEl}
                  open={open}
                  handleClose={handleClose}
                  handleOpenSettings={handleOpenSettings}
                  t={t}
                  handleOpenLogDirectory={handleOpenLogDirectory}
                  handleExportDiagnostics={handleExportDiagnostics}
                  handleOpenFeedbackIssue={handleOpenFeedbackIssue}
                  handleOpenAbout={handleOpenAbout}
                  handleExit={handleExit}
                />
                <Box
                  sx={{
                    flexGrow: 1,
                    alignSelf: "stretch",
                    WebkitAppRegion: open ? "no-drag" : "drag",
                  }}
                />
                <WindowControls />
              </Toolbar>

              <Box
                onMouseDownCapture={handleTopBarInteraction}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  minHeight: "30px",
                  px: 1,
                  pb: 0,
                  gap: 0.5,
                  WebkitAppRegion: "drag",
                  borderTop: "1px solid",
                  borderColor: "divider",
                }}
              >
                <Box
                  sx={{
                    flexGrow: 1,
                    minWidth: 0,
                    display: "flex",
                    alignItems: "center",
                    WebkitAppRegion: "no-drag",
                    pr: 0.5,
                  }}
                >
                  {/* 标签页 */}
                  <Tabs
                    ref={tabsRef}
                    value={currentTab}
                    onChange={handleTabChange}
                    variant="scrollable"
                    scrollButtons={hasTabOverflow ? "auto" : false}
                    sx={{
                      flexGrow: 1,
                      minWidth: 0,
                      minHeight: 30,
                      "& .MuiTabs-scroller": {
                        px: 0.5,
                      },
                      "& .MuiTabs-flexContainer": {
                        gap: 0,
                      },
                      "& .MuiTabs-indicator": {
                        display: "none",
                      },
                      "& .MuiTabs-scrollButtons": {
                        width: 24,
                        color: "text.secondary",
                        transition:
                          "opacity 0.2s ease, width 0.2s ease, min-width 0.2s ease",
                      },
                      "& .MuiTabs-scrollButtons.Mui-disabled": {
                        opacity: 0,
                        width: 0,
                        minWidth: 0,
                        overflow: "hidden",
                      },
                    }}
                  >
                    {tabs.map((tab, index) => (
                      <SessionTab
                        key={tab.id}
                        tab={tab}
                        index={index}
                        value={index}
                        splitLayouts={splitLayouts}
                        paneRegistry={paneRegistry}
                        diskAlert={diskAlertsByTabId[String(tab.id)] || null}
                        onClose={
                          tab.id !== "welcome" ? handleTabCloseRequest : null
                        }
                        onContextMenu={handleTabContextMenuFromTab}
                        draggable={dndEnabled && tab.id !== "welcome"}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                        selected={currentTab === index}
                        group={findGroupByTab(syncGroups, tab.id)}
                      />
                    ))}
                  </Tabs>
                </Box>

                {/* 网络延迟指示器（自带占位容器，不可见时不渲染） */}
                <NetworkLatencyIndicator
                  currentTab={currentTab}
                  tabs={tabs}
                  activeSession={activeSession}
                  placement="inline"
                />
              </Box>
            </Box>

            {/* 标签页右键菜单 */}
            <SessionContextMenu
              tabContextMenu={tabContextMenu}
              handleTabContextMenuClose={handleTabContextMenuClose}
              handleRefreshTerminal={handleRefreshTerminal}
              t={t}
              handleCloseConnection={handleCloseConnection}
              contextMenuTab={contextMenuTab}
              splitLayouts={splitLayouts}
              handleUnsplitTab={handleUnsplitTab}
              handlePauseReconnect={handlePauseReconnect}
              handleResumeReconnect={handleResumeReconnect}
              syncGroups={syncGroups}
              handleJoinGroup={handleJoinGroup}
              handleRemoveFromGroup={handleRemoveFromGroup}
              handleCreateGroup={handleCreateGroup}
            />
          </AppBar>
          <Box
            sx={{
              display: "flex",
              flexGrow: 1,
              overflow: "hidden",
              position: "relative",
              flexDirection: "column",
            }}
          >
            {/* 主内容和侧边栏容器 */}
            <Box
              sx={{
                display: "flex",
                flex: 1,
                minHeight: 0,
                overflow: "hidden",
                position: "relative",
                flexDirection:
                  sidebarPosition === "left" ? "row-reverse" : "row",
              }}
            >
              {/* 主内容区域 */}
              <Box
                onDragOver={handleTerminalAreaDragOver}
                onDragLeave={handleTerminalAreaDragLeave}
                onDrop={handleTerminalAreaDrop}
                sx={{
                  flex: 1,
                  minHeight: 0,
                  overflow: "hidden",
                  p: 0,
                  display: "flex",
                  flexDirection: "column",
                  width: "100%",
                  bgcolor: "background.paper",
                  margin: 0,
                  position: "relative",
                }}
              >
                {/* 拖拽标签页到终端区时的投隆区高亮 */}
                <PaneDropOverlay />
                {/* 欢迎页 - 使用条件渲染优化性能 */}
                {currentTab === 0 && (
                  <Box
                    sx={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: "100%",
                      zIndex: Z_INDEX.raised,
                    }}
                  >
                    <WelcomePage
                      connections={connections}
                      topConnections={topConnections}
                      onOpenConnection={handleOpenConnection}
                      onCreateConnection={handleRequestCreateConnection}
                      onConnectionsUpdate={handleConnectionsUpdate}
                    />
                  </Box>
                )}

                <SessionWorkspace
                  tabs={tabs.slice(1)}
                  layouts={splitLayouts}
                  activeTabId={currentPanelTab?.id}
                  onFocusPane={handleFocusPane}
                  onClosePane={handleClosePane}
                  onSetRatios={handleSetRatios}
                  onPaneDragStart={handlePaneDragStart}
                  onPaneDragOver={handlePaneDragOver}
                  onPaneDrop={handlePaneDrop}
                  onPaneDragEnd={handlePaneDragEnd}
                />
              </Box>

              {/* 可切换位置的侧边栏容器 */}
              <SidebarWorkspace
                activeSession={activeSession}
                sidebarWidth={sidebarWidth}
                sidebarPosition={sidebarPosition}
                setSidebarWidth={setSidebarWidth}
                setUiSettingsSnapshot={setUiSettingsSnapshot}
                setSidebarPosition={setSidebarPosition}
                loadTabConnectionStatus={loadTabConnectionStatus}
                liveSessionKeysRef={liveSessionKeysRef}
                tabs={tabs}
                sessionActionStateRef={sessionActionStateRef}
                handlePaneShortcutRef={handlePaneShortcutRef}
                darkMode={darkMode}
                liveSessionKeys={liveSessionKeys}
                activeSessionKey={activeSessionKey}
                handleConnectionsUpdate={handleConnectionsUpdate}
                handleOpenConnection={handleOpenConnection}
                handleSendCommand={handleSendCommand}
                toggleTheme={toggleTheme}
                transfers={transfers}
                ref={sidebarRef}
              />
            </Box>

            {/* 全局传输底部栏 - 仅在bottom模式下显示 */}
            {transferBarMode === "bottom" && (
              <GlobalTransferBar
                onOpenFloat={handleOpenTransferFloat}
                onToggleFloat={handleToggleTransferFloat}
                isFloatOpen={transferFloatOpen}
              />
            )}
          </Box>
        </Box>
      )}

      <DialogsLayer
        connectionsRef={connectionsRef}
        terminalInstancesRef={terminalInstancesRef}
        liveSessionKeysRef={liveSessionKeysRef}
        liveSessionKeys={liveSessionKeys}
        uiSettingsLoaded={uiSettingsLoaded}
        connectionsLoaded={connectionsLoaded}
        uiSettingsSnapshot={uiSettingsSnapshot}
        setUiSettingsSnapshot={setUiSettingsSnapshot}
        credentialSecurityStatus={credentialSecurityStatus}
        handleCloseAbout={handleCloseAbout}
        aboutUpdateCheckSignal={aboutUpdateCheckSignal}
        handleRemindUpdateLater={handleRemindUpdateLater}
        handleCloseSettings={handleCloseSettings}
        unlockingCredentialStore={unlockingCredentialStore}
        masterPasswordError={masterPasswordError}
        handleUnlockCredentialStore={handleUnlockCredentialStore}
        handleExit={handleExit}
      />
    </ThemeProvider>
  );
}
