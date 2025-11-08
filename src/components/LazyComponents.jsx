import React, { Suspense, lazy } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoadingFallback from "./LoadingFallback.jsx";
import {
  ResourceMonitorSkeleton,
  LocalTerminalSidebarSkeleton,
  SettingsSkeleton,
  CommandHistorySkeleton,
  AIChatSkeleton,
  ConnectionManagerSkeleton,
} from "./SkeletonLoader.jsx";

// 路由级别的懒加载组件工厂函数
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

  return (props) => {
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
  };
};

// 使用工厂函数创建懒加载组件
export const ResourceMonitorWithSuspense = createLazyComponent(
  () => import("./ResourceMonitor.jsx"),
  "正在加载资源监控...",
  "资源监控",
  ResourceMonitorSkeleton,
);

export const IPAddressQueryWithSuspense = createLazyComponent(
  () => import("./IPAddressQuery.jsx"),
  "正在加载IP地址查询...",
  "IP地址查询",
);

export const SettingsWithSuspense = createLazyComponent(
  () => import("./Settings.jsx"),
  "正在加载设置...",
  "设置",
  SettingsSkeleton,
);

export const CommandHistoryWithSuspense = createLazyComponent(
  () => import("./CommandHistory.jsx"),
  "正在加载命令历史...",
  "命令历史",
  CommandHistorySkeleton,
);

export const ShortcutCommandsWithSuspense = createLazyComponent(
  () => import("./ShortcutCommands.jsx"),
  "正在加载快捷命令...",
  "快捷命令",
);

export const LocalTerminalSidebarWithSuspense = createLazyComponent(
  () => import("./LocalTerminalSidebar.jsx"),
  "正在加载本地终端...",
  "本地终端",
  LocalTerminalSidebarSkeleton,
);

// AI助手组件（如果存在）- 保持兼容性
export const AIAssistantWithSuspense = createLazyComponent(
  () => import("./AIChatWindow.jsx"),
  "正在加载AI助手...",
  "AI助手",
  AIChatSkeleton,
);

// 为了向后兼容，创建直接的懒加载组件引用
const ResourceMonitor = lazy(() => import("./ResourceMonitor.jsx"));
const IPAddressQuery = lazy(() => import("./IPAddressQuery.jsx"));
const Settings = lazy(() => import("./Settings.jsx"));
const CommandHistory = lazy(() => import("./CommandHistory.jsx"));
const ShortcutCommands = lazy(() => import("./ShortcutCommands.jsx"));
const LocalTerminalSidebar = lazy(() => import("./LocalTerminalSidebar.jsx"));

// 预加载函数对象，为提高应用启动速度，延迟加载非关键组件
const preloadComponents = {
  resourceMonitor: () => import("./ResourceMonitor.jsx"),
  ipAddressQuery: () => import("./IPAddressQuery.jsx"),
  settings: () => import("./Settings.jsx"),
  commandHistory: () => import("./CommandHistory.jsx"),
  shortcutCommands: () => import("./ShortcutCommands.jsx"),
  localTerminalSidebar: () => import("./LocalTerminalSidebar.jsx"),
};

// 智能预加载策略 - 基于用户交互预测加载侧边栏组件
const smartPreload = {
  // 预加载所有侧边栏组件（在应用空闲时）
  preloadSidebarComponents: () => {
    const queue = [
      preloadComponents.settings,
      preloadComponents.commandHistory,
      preloadComponents.shortcutCommands,
      preloadComponents.resourceMonitor,
      preloadComponents.ipAddressQuery,
    ];

    const runNext = () => {
      if (!queue.length) {
        return;
      }
      const loader = queue.shift();
      if (typeof loader === "function") {
        Promise.resolve(loader())
          .catch(() => {})
          .finally(() => {
            if (queue.length) {
              scheduleNext();
            }
          });
      } else if (queue.length) {
        scheduleNext();
      }
    };

    const scheduleNext = () => {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback((deadline) => {
          if (deadline.timeRemaining() > 10 || deadline.didTimeout) {
            runNext();
          } else {
            scheduleNext();
          }
        });
      } else {
        setTimeout(runNext, 400);
      }
    };

    scheduleNext();
  },

  // 按需预加载特定组件
  preloadComponent: (componentName) => {
    if (preloadComponents[componentName]) {
      preloadComponents[componentName]().catch(() => {});
    }
  },
};

// 导出懒加载组件以供直接使用（如果需要）
export {
  ResourceMonitor,
  IPAddressQuery,
  Settings,
  CommandHistory,
  ShortcutCommands,
  LocalTerminalSidebar,
  preloadComponents,
  smartPreload,
};
