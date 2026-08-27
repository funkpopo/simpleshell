import React, { Suspense, lazy, memo } from "react";
import { useTranslation } from "react-i18next";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoadingFallback from "./LoadingFallback.jsx";
import { SettingsSkeleton, SidebarLazySkeleton } from "./SkeletonLoader.jsx";

const ComponentLoadError = memo(({ getName }) => {
  const { t } = useTranslation();
  return (
    <div style={{ padding: "20px", textAlign: "center" }}>
      {t("common.componentLoadFailed", {
        name: getName(t),
      })}
    </div>
  );
});
ComponentLoadError.displayName = "ComponentLoadError";

// React 19 优化：使用 memo 包装懒加载组件工厂函数，减少不必要的重渲染
// getFallbackMessage / getComponentName 必须用静态 t("...") 字面量 key，便于 i18n 检查。
const createLazyComponent = (
  importFn,
  getFallbackMessage,
  getComponentName,
  SkeletonComponent,
) => {
  const LazyComponent = lazy(() =>
    importFn().catch((error) => {
      console.error("Failed to load lazy component:", error);
      return {
        default: () => <ComponentLoadError getName={getComponentName} />,
      };
    }),
  );

  // React 19: memo 优化包装器组件，避免 props 未变化时的重渲染
  return memo((props) => {
    const { t } = useTranslation();
    const fallbackMessage = getFallbackMessage(t);
    const componentName = getComponentName(t);

    const fallback = SkeletonComponent ? (
      <SkeletonComponent {...props} loadingLabel={fallbackMessage} />
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
const createSidebarFallback = (variant) => {
  const SidebarFallback = (props) => (
    <SidebarLazySkeleton {...props} variant={variant} />
  );
  SidebarFallback.displayName = `${variant}SidebarFallback`;
  return memo(SidebarFallback);
};

const createLazySidebarComponent = (
  importFn,
  getFallbackMessage,
  getComponentName,
  variant = "list",
) =>
  createLazyComponent(
    importFn,
    getFallbackMessage,
    getComponentName,
    createSidebarFallback(variant),
  );

// 使用工厂函数创建懒加载组件
export const ResourceMonitorWithSuspense = createLazySidebarComponent(
  () => import("./ResourceMonitor.jsx"),
  (t) => t("common.skeleton.resourceMonitor"),
  (t) => t("common.componentNames.resourceMonitor"),
  "resource",
);

export const IPAddressQueryWithSuspense = createLazySidebarComponent(
  () => import("./IPAddressQuery.jsx"),
  (t) => t("common.skeleton.ipAddressQuery"),
  (t) => t("common.componentNames.ipAddressQuery"),
  "ipAddress",
);

export const SettingsWithSuspense = createLazyComponent(
  () => import("./Settings.jsx"),
  (t) => t("common.skeleton.settings"),
  (t) => t("common.componentNames.settings"),
  SettingsSkeleton,
);

export const CommandHistoryWithSuspense = createLazySidebarComponent(
  () => import("./CommandHistory.jsx"),
  (t) => t("common.skeleton.commandHistory"),
  (t) => t("common.componentNames.commandHistory"),
  "history",
);

export const ShortcutCommandsWithSuspense = createLazySidebarComponent(
  () => import("./ShortcutCommands.jsx"),
  (t) => t("common.skeleton.shortcutCommands"),
  (t) => t("common.componentNames.shortcutCommands"),
  "shortcut",
);

export const LocalTerminalSidebarWithSuspense = createLazySidebarComponent(
  () => import("./LocalTerminalSidebar.jsx"),
  (t) => t("common.skeleton.localTerminal"),
  (t) => t("common.componentNames.localTerminal"),
  "localTerminal",
);

// 启动路径上的重型功能必须在真正显示时才下载和执行。调用方仍需通过
// open/present 状态控制是否挂载这些包装器，避免仅仅渲染一个关闭的对话框就
// 触发动态 import。
export const WebTerminalWithSuspense = createLazyComponent(
  () => import("./WebTerminal.jsx"),
  (t) => t("common.skeleton.webTerminal"),
  (t) => t("common.componentNames.terminal"),
);

export const ConnectionManagerWithSuspense = createLazySidebarComponent(
  () => import("./ConnectionManager.jsx"),
  (t) => t("common.skeleton.connections"),
  (t) => t("common.componentNames.connectionManager"),
  "connection",
);

export const FileManagerWithSuspense = createLazySidebarComponent(
  () => import("./FileManager.jsx"),
  (t) => t("common.skeleton.fileManager"),
  (t) => t("common.componentNames.fileManager"),
  "file",
);

export const SecurityToolsWithSuspense = createLazySidebarComponent(
  () => import("./SecurityTools.jsx"),
  (t) => t("common.skeleton.securityTools"),
  (t) => t("common.componentNames.securityTools"),
  "security",
);

export const AIChatWindowWithSuspense = createLazyComponent(
  () => import("./AIChatWindow.jsx"),
  (t) => t("common.skeleton.aiChat"),
  (t) => t("common.componentNames.aiAssistant"),
);

export const FirstRunDialogWithSuspense = createLazyComponent(
  () => import("./FirstRunDialog.jsx"),
  (t) => t("common.skeleton.firstRun"),
  (t) => t("common.componentNames.firstRun"),
);

export const AboutDialogWithSuspense = createLazyComponent(
  () => import("./AboutDialog.jsx"),
  (t) => t("common.skeleton.about"),
  (t) => t("common.componentNames.about"),
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

export { smartPreload };
