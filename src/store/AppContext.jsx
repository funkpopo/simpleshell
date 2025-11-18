import { createContext, useContext, useReducer, useMemo } from "react";
import { appReducer, initialState } from "./appReducer.js";

// 创建 Context
const AppStateContext = createContext(undefined);
const AppDispatchContext = createContext(undefined);

// Provider 组件
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // 使用 useMemo 避免不必要的重渲染
  const stateValue = useMemo(() => state, [state]);
  const dispatchValue = useMemo(() => dispatch, [dispatch]);

  return (
    <AppStateContext.Provider value={stateValue}>
      <AppDispatchContext.Provider value={dispatchValue}>
        {children}
      </AppDispatchContext.Provider>
    </AppStateContext.Provider>
  );
}

// 自定义 Hook：获取全局状态
export function useAppState() {
  const context = useContext(AppStateContext);
  if (context === undefined) {
    throw new Error("useAppState must be used within AppProvider");
  }
  return context;
}

// 自定义 Hook：获取 dispatch 函数
export function useAppDispatch() {
  const context = useContext(AppDispatchContext);
  if (context === undefined) {
    throw new Error("useAppDispatch must be used within AppProvider");
  }
  return context;
}

// 自定义 Hook：同时获取状态和 dispatch
export function useApp() {
  return {
    state: useAppState(),
    dispatch: useAppDispatch(),
  };
}

// 便捷的 Selector Hooks，用于只订阅特定状态
export function useAppSelector(selector) {
  const state = useAppState();
  return useMemo(() => selector(state), [state, selector]);
}

// 特定状态的 Hooks
export function useTabs() {
  return useAppSelector((state) => ({
    tabs: state.tabs,
    currentTab: state.currentTab,
  }));
}

export function useSidebars() {
  return useAppSelector((state) => ({
    connectionManagerOpen: state.connectionManagerOpen,
    resourceMonitorOpen: state.resourceMonitorOpen,
    fileManagerOpen: state.fileManagerOpen,
    ipAddressQueryOpen: state.ipAddressQueryOpen,
    securityToolsOpen: state.securityToolsOpen,
    shortcutCommandsOpen: state.shortcutCommandsOpen,
    commandHistoryOpen: state.commandHistoryOpen,
    activeSidebarMargin: state.activeSidebarMargin,
    lastOpenedSidebar: state.lastOpenedSidebar,
  }));
}

export function useDialogs() {
  return useAppSelector((state) => ({
    aboutDialogOpen: state.aboutDialogOpen,
    settingsDialogOpen: state.settingsDialogOpen,
    tabContextMenu: state.tabContextMenu,
  }));
}

export function useTheme() {
  return useAppSelector((state) => ({
    darkMode: state.darkMode,
    themeLoading: state.themeLoading,
  }));
}

export function useAIChat() {
  return useAppSelector((state) => ({
    aiChatStatus: state.aiChatStatus,
    aiInputPreset: state.aiInputPreset,
  }));
}

export function useTerminals() {
  return useAppSelector((state) => ({
    terminalInstances: state.terminalInstances,
  }));
}

export function useConnections() {
  return useAppSelector((state) => ({
    connections: state.connections,
    topConnections: state.topConnections,
  }));
}
