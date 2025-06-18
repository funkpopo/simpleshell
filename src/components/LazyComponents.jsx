import React, { Suspense } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoadingFallback from "./LoadingFallback.jsx";

// 文件管理器懒加载组件
const LazyFileManager = React.lazy(() =>
  import("./FileManager.jsx").catch((error) => {
    // 返回一个默认的错误组件
    return {
      default: () => (
        <div style={{ padding: "20px", textAlign: "center" }}>
          文件管理器组件加载失败，请刷新页面重试
        </div>
      ),
    };
  }),
);

// 资源监控懒加载组件
const LazyResourceMonitor = React.lazy(() =>
  import("./ResourceMonitor.jsx").catch((error) => {
    return {
      default: () => (
        <div style={{ padding: "20px", textAlign: "center" }}>
          资源监控组件加载失败，请刷新页面重试
        </div>
      ),
    };
  }),
);

// AI助手懒加载组件
const LazyAIAssistant = React.lazy(() =>
  import("./AIAssistant.jsx").catch((error) => {
    return {
      default: () => (
        <div style={{ padding: "20px", textAlign: "center" }}>
          AI助手组件加载失败，请刷新页面重试
        </div>
      ),
    };
  }),
);

export const FileManagerWithSuspense = (props) => (
  <ErrorBoundary componentName="文件管理器">
    <Suspense fallback={<LoadingFallback message="正在加载文件管理器..." />}>
      <LazyFileManager {...props} />
    </Suspense>
  </ErrorBoundary>
);

export const ResourceMonitorWithSuspense = (props) => (
  <ErrorBoundary componentName="资源监控">
    <Suspense fallback={<LoadingFallback message="正在加载资源监控..." />}>
      <LazyResourceMonitor {...props} />
    </Suspense>
  </ErrorBoundary>
);

export const AIAssistantWithSuspense = (props) => (
  <ErrorBoundary componentName="AI助手">
    <Suspense fallback={<LoadingFallback message="正在加载AI助手..." />}>
      <LazyAIAssistant {...props} />
    </Suspense>
  </ErrorBoundary>
);

export const preloadComponents = {
  fileManager: () => import("./FileManager.jsx"),
  resourceMonitor: () => import("./ResourceMonitor.jsx"),
  aiAssistant: () => import("./AIAssistant.jsx"),
};

export const preloadAllComponents = () => {
  Object.values(preloadComponents).forEach((preload) => {
    preload().catch((error) => {
      // 组件预加载失败，可以考虑使用项目的日志系统
    });
  });
};

// 导出懒加载组件以供直接使用（如果需要）
export { LazyFileManager, LazyResourceMonitor };
