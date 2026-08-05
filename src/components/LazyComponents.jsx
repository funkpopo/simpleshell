import React, { Suspense, lazy, memo } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoadingFallback from "./LoadingFallback.jsx";
import { SettingsSkeleton, SidebarLazySkeleton } from "./SkeletonLoader.jsx";

// React 19 优化：使用 memo 包装懒加载组件工厂函数，减少不必要的重渲染
const createLazyComponent = (
  importFn,
  fallbackMessage,
  componentName,
  SkeletonComponent,
) => {
  const LazyComponent = lazy(() =>
    importFn().catch((error) => {
      console.error(`Failed to load ${componentName}:`, error);
      return {
        default: () => (
          <div style={{ padding: "20px", textAlign: "center" }}>
            {componentName}组件加载失败，请刷新页面重试
          </div>
        ),
      };
    }),
  );

  // React 19: memo 优化包装器组件，避免 props 未变化时的重渲染
  return memo((props) => {
    const fallback = SkeletonComponent ? (
      <SkeletonComponent {...props} />
    ) : (
      <LoadingFallback message={fallbackMessage} />
    );

    return (
      <ErrorBoundary componentName={componentName}>
        <Suspense fallback={fallback}>
          <LazyComponent {...props} />
        </Suspense>
      </ErrorBoundary>
    );
  });
};

// 侧栏 fallback 必须与 SidebarPanel 保持同样的根布局；业务差异只存在于
// 骨架内容，不能改变首次展开时的宽高、背景或滑入轨迹。
const createSidebarFallback = (variant, loadingLabel) => {
  const SidebarFallback = (props) => (
    <SidebarLazySkeleton
      {...props}
      variant={variant}
      loadingLabel={loadingLabel}
    />
  );
  SidebarFallback.displayName = `${variant}SidebarFallback`;
  return memo(SidebarFallback);
};

const createLazySidebarComponent = (
  importFn,
  fallbackMessage,
  componentName,
  variant = "list",
) =>
  createLazyComponent(
    importFn,
    fallbackMessage,
    componentName,
    createSidebarFallback(variant, fallbackMessage),
  );

// 使用工厂函数创建懒加载组件
export const ResourceMonitorWithSuspense = createLazySidebarComponent(
  () => import("./ResourceMonitor.jsx"),
  "正在加载资源监控...",
  "资源监控",
  "resource",
);

export const IPAddressQueryWithSuspense = createLazySidebarComponent(
  () => import("./IPAddressQuery.jsx"),
  "正在加载IP地址查询...",
  "IP地址查询",
  "ipAddress",
);

export const SettingsWithSuspense = createLazyComponent(
  () => import("./Settings.jsx"),
  "正在加载设置...",
  "设置",
  SettingsSkeleton,
);

export const CommandHistoryWithSuspense = createLazySidebarComponent(
  () => import("./CommandHistory.jsx"),
  "正在加载命令历史...",
  "命令历史",
  "history",
);

export const ShortcutCommandsWithSuspense = createLazySidebarComponent(
  () => import("./ShortcutCommands.jsx"),
  "正在加载快捷命令...",
  "快捷命令",
  "shortcut",
);

export const LocalTerminalSidebarWithSuspense = createLazySidebarComponent(
  () => import("./LocalTerminalSidebar.jsx"),
  "正在加载本地终端...",
  "本地终端",
  "localTerminal",
);

// 启动路径上的重型功能必须在真正显示时才下载和执行。调用方仍需通过
// open/present 状态控制是否挂载这些包装器，避免仅仅渲染一个关闭的对话框就
// 触发动态 import。
export const WebTerminalWithSuspense = createLazyComponent(
  () => import("./WebTerminal.jsx"),
  "正在加载终端...",
  "终端",
);

export const ConnectionManagerWithSuspense = createLazySidebarComponent(
  () => import("./ConnectionManager.jsx"),
  "正在加载连接管理器...",
  "连接管理器",
  "connection",
);

export const FileManagerWithSuspense = createLazySidebarComponent(
  () => import("./FileManager.jsx"),
  "正在加载文件管理器...",
  "文件管理器",
  "file",
);

export const SecurityToolsWithSuspense = createLazySidebarComponent(
  () => import("./SecurityTools.jsx"),
  "正在加载安全工具...",
  "安全工具",
  "security",
);

export const AIChatWindowWithSuspense = createLazyComponent(
  () => import("./AIChatWindow.jsx"),
  "正在加载 AI 助手...",
  "AI 助手",
);

export const FirstRunDialogWithSuspense = createLazyComponent(
  () => import("./FirstRunDialog.jsx"),
  "正在加载首次运行向导...",
  "首次运行向导",
);

export const AboutDialogWithSuspense = createLazyComponent(
  () => import("./AboutDialog.jsx"),
  "正在加载关于信息...",
  "关于对话框",
);

// 仅在用户表现出打开意图时预加载。不要在启动/空闲阶段批量调用这些函数，
// 否则会抵消上述 React.lazy 对空载内存的优化。
const preloadComponents = {
  connectionManager: () => import("./ConnectionManager.jsx"),
  fileManager: () => import("./FileManager.jsx"),
  resourceMonitor: () => import("./ResourceMonitor.jsx"),
  ipAddressQuery: () => import("./IPAddressQuery.jsx"),
  securityTools: () => import("./SecurityTools.jsx"),
  settings: () => import("./Settings.jsx"),
  commandHistory: () => import("./CommandHistory.jsx"),
  shortcutCommands: () => import("./ShortcutCommands.jsx"),
  localTerminalSidebar: () => import("./LocalTerminalSidebar.jsx"),
  aiChatWindow: () => import("./AIChatWindow.jsx"),
  aboutDialog: () => import("./AboutDialog.jsx"),
};

const scheduledPreloads = new Map();

const cancelScheduledComponent = (componentName) => {
  const timer = scheduledPreloads.get(componentName);
  if (timer !== undefined) {
    clearTimeout(timer);
    scheduledPreloads.delete(componentName);
  }
};

const preloadComponent = (componentName) => {
  cancelScheduledComponent(componentName);
  const loader = preloadComponents[componentName];
  return loader ? loader().catch(() => {}) : Promise.resolve();
};

// 只有悬停达到阈值才加载，避免鼠标快速划过侧栏时下载多个重型 chunk。
const smartPreload = {
  preloadComponent,

  scheduleComponent: (componentName, delay = 200) => {
    if (!preloadComponents[componentName]) {
      return;
    }

    cancelScheduledComponent(componentName);
    const timer = setTimeout(() => {
      scheduledPreloads.delete(componentName);
      preloadComponent(componentName);
    }, delay);
    scheduledPreloads.set(componentName, timer);
  },

  cancelScheduledComponent,

  cancelAllScheduled: () => {
    scheduledPreloads.forEach((timer) => clearTimeout(timer));
    scheduledPreloads.clear();
  },

  // React 19 新增：并行预加载多个组件
  preloadMultiple: (componentNames) => {
    const promises = componentNames
      .filter((name) => preloadComponents[name])
      .map((name) => preloadComponents[name]().catch(() => {}));

    return Promise.allSettled(promises);
  },
};

export { preloadComponents, smartPreload };
