import * as React from "react";
import { memo, useCallback, useMemo, useReducer, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import ListItemText from "@mui/material/ListItemText";

// Icons
import AppsIcon from "@mui/icons-material/Apps";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import RefreshIcon from "@mui/icons-material/Refresh";
import PowerOffIcon from "@mui/icons-material/PowerOff";
import SettingsIcon from "@mui/icons-material/Settings";
import InfoIcon from "@mui/icons-material/Info";
import ExitToAppIcon from "@mui/icons-material/ExitToApp";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import AddIcon from "@mui/icons-material/Add";

// Components
import AIIcon from "./components/AIIcon.jsx";
import WebTerminal from "./components/WebTerminal.jsx";
import WelcomePage from "./components/WelcomePage.jsx";
import ConnectionManager from "./components/ConnectionManager.jsx";
import MergedTabContent from "./components/MergedTabContent.jsx";
import RandomPasswordGenerator from "./components/RandomPasswordGenerator.jsx";
import AIChatWindow from "./components/AIChatWindow.jsx";

// Refactored Components
import SidebarManager from "./components/SidebarManager.jsx";
import TabManager from "./components/TabManager.jsx";
import AboutDialog from "./components/AboutDialog.jsx";

// Lazy loaded components
import {
  ResourceMonitorWithSuspense as ResourceMonitor,
  FileManagerWithSuspense as FileManager,
  IPAddressQueryWithSuspense as IPAddressQuery,
  SettingsWithSuspense as Settings,
  CommandHistoryWithSuspense as CommandHistory,
  ShortcutCommandsWithSuspense as ShortcutCommands,
  preloadComponents,
  smartPreload,
} from "./components/LazyComponents.jsx";

// Store and reducer
import { appReducer, initialState, actions } from "./store/appReducer.js";

// i18n
import { useTranslation } from "react-i18next";
import "./i18n/i18n";
import { changeLanguage } from "./i18n/i18n";

// Styles and constants
import "./index.css";
import { SIDEBAR_WIDTHS } from "./constants/layout.js";
import "flag-icons/css/flag-icons.min.css";

// Core utilities
import {
  findGroupByTab,
  getGroups,
  addGroup,
  addTabToGroup,
  removeTabFromGroup,
} from "./core/syncInputGroups";
import { dispatchCommandToGroup } from "./core/syncGroupCommandDispatcher";

// Main App component with useReducer
function App() {
  const { t, i18n } = useTranslation();
  const [state, dispatch] = useReducer(appReducer, initialState);
  const [prevTabsLength, setPrevTabsLength] = React.useState(state.tabs.length);

  // Theme configuration
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: state.darkMode ? "dark" : "light",
          primary: {
            main: state.darkMode ? "#90caf9" : "#1976d2",
          },
          secondary: {
            main: state.darkMode ? "#f48fb1" : "#dc004e",
          },
          background: {
            default: state.darkMode ? "#121212" : "#f5f5f5",
            paper: state.darkMode ? "#1e1e1e" : "#ffffff",
          },
        },
        typography: {
          fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
        },
      }),
    [state.darkMode]
  );

  // Load theme settings on mount
  useEffect(() => {
    const loadThemeSettings = async () => {
      try {
        dispatch(actions.setThemeLoading(true));
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          if (settings && settings.darkMode !== undefined) {
            dispatch(actions.setDarkMode(settings.darkMode));
          }
        }
      } catch (error) {
        const fallbackTheme = localStorage.getItem("terminalDarkMode");
        if (fallbackTheme !== null) {
          dispatch(actions.setDarkMode(fallbackTheme === "true"));
        }
      } finally {
        dispatch(actions.setThemeLoading(false));
      }
    };
    loadThemeSettings();
  }, []);

  // Load connections on mount
  useEffect(() => {
    const loadConnections = async () => {
      if (window.terminalAPI?.loadConnections) {
        const connections = await window.terminalAPI.loadConnections();
        dispatch(actions.setConnections(connections || []));
        
        const topConns = connections?.filter((conn) => conn.isTop) || [];
        dispatch(actions.setTopConnections(topConns));
      }
    };
    loadConnections();
  }, []);

  // Update tabs when language changes
  useEffect(() => {
    dispatch(actions.updateTab(0, {
      ...state.tabs[0],
      label: t("terminal.welcome"),
    }));
  }, [i18n.language, t]);

  // Preload components
  useEffect(() => {
    const timer = setTimeout(() => {
      preloadComponents();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  // Smart preload based on tab changes
  useEffect(() => {
    if (state.tabs.length > prevTabsLength) {
      smartPreload();
    }
    setPrevTabsLength(state.tabs.length);
  }, [state.tabs.length, prevTabsLength]);

  // Calculate active sidebar margin
  useEffect(() => {
    let margin = 0;
    if (state.connectionManagerOpen) margin = SIDEBAR_WIDTHS.CONNECTION_MANAGER;
    else if (state.resourceMonitorOpen) margin = SIDEBAR_WIDTHS.RESOURCE_MONITOR;
    else if (state.fileManagerOpen) margin = SIDEBAR_WIDTHS.FILE_MANAGER;
    else if (state.ipAddressQueryOpen) margin = SIDEBAR_WIDTHS.IP_ADDRESS_QUERY;
    else if (state.randomPasswordGeneratorOpen) margin = SIDEBAR_WIDTHS.RANDOM_PASSWORD_GENERATOR;
    else if (state.shortcutCommandsOpen) margin = SIDEBAR_WIDTHS.SHORTCUT_COMMANDS;
    else if (state.commandHistoryOpen) margin = SIDEBAR_WIDTHS.COMMAND_HISTORY;
    
    dispatch(actions.setActiveSidebarMargin(margin));
  }, [
    state.connectionManagerOpen,
    state.resourceMonitorOpen,
    state.fileManagerOpen,
    state.ipAddressQueryOpen,
    state.randomPasswordGeneratorOpen,
    state.shortcutCommandsOpen,
    state.commandHistoryOpen,
  ]);

  // Theme toggle handler
  const handleThemeToggle = useCallback(async () => {
    const newDarkMode = !state.darkMode;
    dispatch(actions.setDarkMode(newDarkMode));
    
    localStorage.setItem("terminalDarkMode", newDarkMode.toString());
    
    if (window.terminalAPI?.saveUISettings) {
      try {
        await window.terminalAPI.saveUISettings({ darkMode: newDarkMode });
      } catch (error) {
        console.error("Failed to save theme settings:", error);
      }
    }
  }, [state.darkMode]);

  // Sidebar toggle handler
  const handleSidebarToggle = useCallback((sidebarName, isOpen) => {
    if (isOpen) {
      dispatch(actions.setLastOpenedSidebar(sidebarName));
      
      // Close other sidebars
      if (sidebarName !== 'connectionManager') dispatch(actions.setConnectionManagerOpen(false));
      if (sidebarName !== 'resourceMonitor') dispatch(actions.setResourceMonitorOpen(false));
      if (sidebarName !== 'fileManager') dispatch(actions.setFileManagerOpen(false));
      if (sidebarName !== 'ipAddressQuery') dispatch(actions.setIpAddressQueryOpen(false));
      if (sidebarName !== 'randomPasswordGenerator') dispatch(actions.setRandomPasswordGeneratorOpen(false));
      if (sidebarName !== 'shortcutCommands') dispatch(actions.setShortcutCommandsOpen(false));
      if (sidebarName !== 'commandHistory') dispatch(actions.setCommandHistoryOpen(false));
    }
  }, []);

  // Tab operations
  const handleTabClose = useCallback((index) => {
    const tab = state.tabs[index];
    
    // Clean up terminal instance
    if (state.terminalInstances[tab.id]) {
      const instance = state.terminalInstances[tab.id];
      if (instance.processId && window.terminalAPI?.killTerminal) {
        window.terminalAPI.killTerminal(instance.processId);
      }
    }
    
    // Remove tab
    dispatch(actions.removeTab(index));
    
    // Adjust current tab
    if (state.currentTab >= index && state.currentTab > 0) {
      dispatch(actions.setCurrentTab(state.currentTab - 1));
    }
  }, [state.tabs, state.terminalInstances, state.currentTab]);

  const handleAddTab = useCallback((connectionInfo = null) => {
    const newTabId = `tab-${Date.now()}`;
    const newTab = {
      id: newTabId,
      title: connectionInfo ? connectionInfo.name : "Local PowerShell",
      type: connectionInfo ? "ssh" : "local",
      sessionId: `terminal-${Date.now()}`,
      connectionInfo,
    };
    
    dispatch(actions.addTab(newTab));
    dispatch(actions.setCurrentTab(state.tabs.length));
    
    return newTabId;
  }, [state.tabs.length]);

  // Menu handlers
  const handleMenuOpen = useCallback((event) => {
    dispatch(actions.setAnchorEl(event.currentTarget));
  }, []);

  const handleMenuClose = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
  }, []);

  // Current tab content determination
  const currentTabContent = useMemo(() => {
    if (state.tabs.length === 0) {
      return <WelcomePage onConnect={handleAddTab} />;
    }
    
    const currentTabData = state.tabs[state.currentTab];
    if (!currentTabData) return null;
    
    if (state.mergedTabs[currentTabData.id]) {
      return (
        <MergedTabContent
          parentTab={currentTabData}
          childTabs={state.mergedTabs[currentTabData.id]}
          activeTabId={state.activeSplitTabId}
          onActiveTabChange={(tabId) => dispatch(actions.setActiveSplitTab(tabId))}
        />
      );
    }
    
    return (
      <WebTerminal
        key={currentTabData.id}
        tabId={currentTabData.id}
        sessionId={currentTabData.sessionId}
        connectionInfo={currentTabData.connectionInfo}
        onTitleChange={(newTitle) => {
          dispatch(actions.updateTab(state.currentTab, {
            ...currentTabData,
            title: newTitle,
          }));
        }}
      />
    );
  }, [state.tabs, state.currentTab, state.mergedTabs, state.activeSplitTabId, handleAddTab]);

  // Check if file manager can be shown
  const canShowFileManager = useMemo(() => {
    const currentTabData = state.tabs[state.currentTab];
    return currentTabData?.type === "ssh" || currentTabData?.type === "telnet";
  }, [state.tabs, state.currentTab]);

  if (state.themeLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          backgroundColor: state.darkMode ? "#121212" : "#f5f5f5",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
        {/* App Bar */}
        <AppBar position="static" sx={{ zIndex: 1300 }}>
          <Toolbar>
            <Typography variant="h6" sx={{ flexGrow: 0, mr: 2 }}>
              SimpleShell
            </Typography>
            
            {/* Tab Manager */}
            <TabManager
              state={state}
              dispatch={dispatch}
              actions={actions}
              activeSidebarMargin={state.activeSidebarMargin}
              onTabClose={handleTabClose}
            />
            
            {/* Toolbar Actions */}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Tooltip title={t("app.newTab")}>
                <IconButton color="inherit" onClick={() => handleAddTab()}>
                  <AddIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title={t("app.aiAssistant")}>
                <IconButton
                  color="inherit"
                  onClick={() => dispatch(actions.setAiChatStatus("visible"))}
                >
                  <AIIcon />
                </IconButton>
              </Tooltip>
              
              <IconButton color="inherit" onClick={handleThemeToggle}>
                {state.darkMode ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
              
              <IconButton color="inherit" onClick={handleMenuOpen}>
                <AppsIcon />
              </IconButton>
            </Box>
          </Toolbar>
        </AppBar>

        {/* Main Content Area */}
        <Box sx={{ display: "flex", flexGrow: 1, position: "relative" }}>
          {/* Sidebar */}
          <SidebarManager
            state={state}
            dispatch={dispatch}
            actions={actions}
            onSidebarToggle={handleSidebarToggle}
            canShowFileManager={canShowFileManager}
          />
          
          {/* Sidebar Panels */}
          {state.connectionManagerOpen && (
            <ConnectionManager
              onConnect={handleAddTab}
              connections={state.connections}
              onConnectionsChange={(conns) => dispatch(actions.setConnections(conns))}
            />
          )}
          
          {state.resourceMonitorOpen && <ResourceMonitor />}
          
          {state.fileManagerOpen && canShowFileManager && (
            <FileManager
              sessionId={state.tabs[state.currentTab]?.sessionId}
              connectionInfo={state.tabs[state.currentTab]?.connectionInfo}
            />
          )}
          
          {state.ipAddressQueryOpen && <IPAddressQuery />}
          
          {state.randomPasswordGeneratorOpen && <RandomPasswordGenerator />}
          
          {state.shortcutCommandsOpen && (
            <ShortcutCommands
              sessionId={state.tabs[state.currentTab]?.sessionId}
            />
          )}
          
          {state.commandHistoryOpen && (
            <CommandHistory
              sessionId={state.tabs[state.currentTab]?.sessionId}
            />
          )}
          
          {/* Terminal Content */}
          <Box
            sx={{
              flexGrow: 1,
              ml: `${state.activeSidebarMargin + 56}px`,
              transition: "margin-left 0.3s ease",
              position: "relative",
            }}
          >
            {currentTabContent}
          </Box>
        </Box>

        {/* Dialogs */}
        <AboutDialog
          open={state.aboutDialogOpen}
          onClose={() => dispatch(actions.setAboutDialogOpen(false))}
        />
        
        {state.settingsDialogOpen && (
          <Settings
            open={state.settingsDialogOpen}
            onClose={() => dispatch(actions.setSettingsDialogOpen(false))}
          />
        )}
        
        {/* AI Chat Window */}
        {state.aiChatStatus === "visible" && (
          <AIChatWindow
            status={state.aiChatStatus}
            onStatusChange={(status) => dispatch(actions.setAiChatStatus(status))}
            inputPreset={state.aiInputPreset}
            onInputPresetChange={(preset) => dispatch(actions.setAiInputPreset(preset))}
          />
        )}

        {/* App Menu */}
        <Menu
          anchorEl={state.anchorEl}
          open={Boolean(state.anchorEl)}
          onClose={handleMenuClose}
        >
          <MenuItem onClick={() => {
            handleMenuClose();
            dispatch(actions.setSettingsDialogOpen(true));
          }}>
            <SettingsIcon sx={{ mr: 1 }} />
            {t("app.settings")}
          </MenuItem>
          
          <MenuItem onClick={() => {
            handleMenuClose();
            dispatch(actions.setAboutDialogOpen(true));
          }}>
            <InfoIcon sx={{ mr: 1 }} />
            {t("app.about")}
          </MenuItem>
          
          <Divider />
          
          <MenuItem onClick={() => {
            handleMenuClose();
            window.close();
          }}>
            <ExitToAppIcon sx={{ mr: 1 }} />
            {t("app.exit")}
          </MenuItem>
        </Menu>
      </Box>
    </ThemeProvider>
  );
}

// Root rendering
const container = document.getElementById("root");
const root = createRoot(container);
root.render(<App />);

export default App;