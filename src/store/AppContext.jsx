import { createContext, useContext, useReducer, useMemo } from "react";
import { appReducer, initialState } from "./appReducer.js";

// 创建 Context
const AppStateContext = createContext(undefined);
const AppDispatchContext = createContext(undefined);

/**
 * 用 preload 注入的启动主题初始化 darkMode，避免 React 默认深色与用户浅色配置
 * 在首帧之间来回切换造成闪屏。
 */
function createBootstrappedInitialState() {
  const bootDarkMode = window.simpleshellBoot?.darkMode;
  if (typeof bootDarkMode === "boolean") {
    return {
      ...initialState,
      darkMode: bootDarkMode,
    };
  }
  return initialState;
}

// Provider 组件
export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(
    appReducer,
    undefined,
    createBootstrappedInitialState,
  );

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

// 便捷的 Selector Hook，用于只订阅特定状态
// （细粒度选择器由调用方以模块级 selector 函数传入）
export function useAppSelector(selector) {
  const state = useAppState();
  return useMemo(() => selector(state), [state, selector]);
}

// 特定状态的 Hook
export function useTheme() {
  return useAppSelector((state) => ({
    darkMode: state.darkMode,
    themeLoading: state.themeLoading,
  }));
}

