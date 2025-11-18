/**
 * App.jsx 重构示例 - 展示如何使用全局状态管理
 *
 * 此文件展示了如何将原有的 useState 迁移到全局状态
 */

import * as React from "react";
import { useAppState, useAppDispatch } from "./store/AppContext.jsx";
import { actions } from "./store/appReducer.js";

function AppContentExample() {
  // ============ 全局状态和 Dispatch ============
  const state = useAppState();
  const dispatch = useAppDispatch();

  // ============ 从全局状态读取值 ============
  // 替换原有的 const [tabs, setTabs] = useState([...])
  const tabs = state.tabs;
  const currentTab = state.currentTab;

  // 替换原有的侧边栏状态
  const connectionManagerOpen = state.connectionManagerOpen;
  const resourceMonitorOpen = state.resourceMonitorOpen;
  const fileManagerOpen = state.fileManagerOpen;
  const ipAddressQueryOpen = state.ipAddressQueryOpen;
  const securityToolsOpen = state.securityToolsOpen;
  const shortcutCommandsOpen = state.shortcutCommandsOpen;
  const commandHistoryOpen = state.commandHistoryOpen;
  const activeSidebarMargin = state.activeSidebarMargin;
  const lastOpenedSidebar = state.lastOpenedSidebar;

  // 替换原有的对话框状态
  const aboutDialogOpen = state.aboutDialogOpen;
  const settingsDialogOpen = state.settingsDialogOpen;
  const tabContextMenu = state.tabContextMenu;

  // 替换原有的主题状态
  const darkMode = state.darkMode;
  const themeLoading = state.themeLoading;

  // 替换原有的终端状态
  const terminalInstances = state.terminalInstances;

  // 替换原有的连接状态
  const connections = state.connections;
  const topConnections = state.topConnections;

  // 替换原有的文件管理器状态
  const fileManagerPaths = state.fileManagerPaths;

  // 替换原有的进程缓存状态
  const processCache = state.processCache;

  // 替换原有的 AI Chat 状态
  const aiChatStatus = state.aiChatStatus;  // 原来是 globalAiChatWindowState
  const aiInputPreset = state.aiInputPreset;

  // 替换原有的拖拽状态
  const draggedTabIndex = state.draggedTabIndex;
  const dragOverTabIndex = state.dragOverTabIndex;
  const dragInsertPosition = state.dragInsertPosition;

  // 替换原有的菜单状态
  const anchorEl = state.anchorEl;

  // ============ 使用 dispatch 替换 setState ============

  // 示例 1: 设置 tabs
  const handleAddTab = (newTab) => {
    dispatch(actions.addTab(newTab));
  };

  // 示例 2: 设置当前 tab
  const handleTabChange = (event, newValue) => {
    dispatch(actions.setCurrentTab(newValue));
  };

  // 示例 3: 切换侧边栏
  const toggleConnectionManager = () => {
    dispatch(actions.setConnectionManagerOpen(!connectionManagerOpen));
    if (!connectionManagerOpen) {
      dispatch(actions.setLastOpenedSidebar("connection"));
    }
  };

  // 示例 4: 切换主题
  const toggleTheme = async () => {
    const newDarkMode = !darkMode;
    dispatch(actions.setDarkMode(newDarkMode));

    // 保存到配置文件
    if (window.terminalAPI?.saveUISettings) {
      const currentSettings = await window.terminalAPI.loadUISettings() || {};
      await window.terminalAPI.saveUISettings({
        ...currentSettings,
        darkMode: newDarkMode,
      });
    }
  };

  // 示例 5: 设置对话框状态
  const handleOpenAbout = () => {
    dispatch(actions.setAnchorEl(null));  // 关闭菜单
    dispatch(actions.setAboutDialogOpen(true));
  };

  const handleCloseAbout = () => {
    dispatch(actions.setAboutDialogOpen(false));
  };

  // 示例 6: 设置 AI Chat 状态
  const handleToggleGlobalAiChatWindow = () => {
    const newStatus = aiChatStatus === "visible" ? "closed" : "visible";
    dispatch(actions.setAiChatStatus(newStatus));
  };

  const handleSendToAI = (text) => {
    dispatch(actions.setAiInputPreset(text));
    dispatch(actions.setAiChatStatus("visible"));
  };

  // 示例 7: 更新终端实例
  const updateTerminalInstance = (terminalId, instanceData) => {
    dispatch(actions.updateTerminalInstance(terminalId, {
      ...terminalInstances[terminalId],
      ...instanceData,
    }));
  };

  // 示例 8: 批量操作 - 关闭所有侧边栏
  const closeAllSidebars = () => {
    dispatch(actions.setConnectionManagerOpen(false));
    dispatch(actions.setResourceMonitorOpen(false));
    dispatch(actions.setFileManagerOpen(false));
    dispatch(actions.setShortcutCommandsOpen(false));
    dispatch(actions.setCommandHistoryOpen(false));
    dispatch(actions.setIpAddressQueryOpen(false));
    dispatch(actions.setSecurityToolsOpen(false));
  };

  // 示例 9: 拖拽操作
  const handleDragStart = (e, index) => {
    if (tabs[index].id === "welcome") {
      e.preventDefault();
      return;
    }
    dispatch(actions.setDraggedTab(index));
  };

  const handleDragEnd = () => {
    dispatch(actions.resetDragState());
  };

  // 示例 10: Tab 右键菜单
  const handleTabContextMenu = (event, index, tabId) => {
    event.preventDefault();
    if (tabs[index].id === "welcome") return;

    dispatch(actions.setTabContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 4,
      tabIndex: index,
      tabId: tabId,
    }));
  };

  const handleTabContextMenuClose = () => {
    dispatch(actions.setTabContextMenu({
      mouseX: null,
      mouseY: null,
      tabIndex: null,
      tabId: null,
    }));
  };

  return (
    <div>
      {/* 组件 JSX */}
    </div>
  );
}

export default AppContentExample;
