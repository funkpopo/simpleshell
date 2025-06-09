import React, { Suspense } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoadingFallback from "./LoadingFallback.jsx";

/**
 * 懒加载组件定义
 * 使用React.lazy()创建懒加载的组件包装器
 */

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

/**
 * 带有Suspense和ErrorBoundary包装的文件管理器组件
 */
export const FileManagerWithSuspense = (props) => (
  <ErrorBoundary componentName="文件管理器">
    <Suspense fallback={<LoadingFallback message="正在加载文件管理器..." />}>
      <LazyFileManager {...props} />
    </Suspense>
  </ErrorBoundary>
);

/**
 * 带有Suspense和ErrorBoundary包装的资源监控组件
 */
export const ResourceMonitorWithSuspense = (props) => (
  <ErrorBoundary componentName="资源监控">
    <Suspense fallback={<LoadingFallback message="正在加载资源监控..." />}>
      <LazyResourceMonitor {...props} />
    </Suspense>
  </ErrorBoundary>
);

/**
 * 预加载函数 - 可以在用户可能需要时提前加载组件
 */
export const preloadComponents = {
  fileManager: () => import("./FileManager.jsx"),
  resourceMonitor: () => import("./ResourceMonitor.jsx"),
};

/**
 * 预加载所有懒加载组件
 */
export const preloadAllComponents = () => {
  Object.values(preloadComponents).forEach((preload) => {
    preload().catch((error) => {
      // 组件预加载失败，可以考虑使用项目的日志系统
    });
  });
};

// 导出懒加载组件以供直接使用（如果需要）
export { LazyFileManager, LazyResourceMonitor };
