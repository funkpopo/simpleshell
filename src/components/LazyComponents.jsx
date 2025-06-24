import React, { Suspense, lazy } from "react";
import ErrorBoundary from "./ErrorBoundary.jsx";
import LoadingFallback from "./LoadingFallback.jsx";

// 文件管理器懒加载组件
const FileManager = lazy(() =>
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
const ResourceMonitor = lazy(() =>
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
const AIAssistant = lazy(() =>
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

// IP地址查询组件的懒加载实现
const IPAddressQuery = lazy(() =>
  import("./IPAddressQuery.jsx").catch((error) => {
    return {
      default: () => (
        <div style={{ padding: "20px", textAlign: "center" }}>
          IP地址查询组件加载失败，请刷新页面重试
        </div>
      ),
    };
  }),
);

export const FileManagerWithSuspense = (props) => (
  <ErrorBoundary componentName="文件管理器">
    <Suspense fallback={<LoadingFallback message="正在加载文件管理器..." />}>
      <FileManager {...props} />
    </Suspense>
  </ErrorBoundary>
);

export const ResourceMonitorWithSuspense = (props) => (
  <ErrorBoundary componentName="资源监控">
    <Suspense fallback={<LoadingFallback message="正在加载资源监控..." />}>
      <ResourceMonitor {...props} />
    </Suspense>
  </ErrorBoundary>
);

export const AIAssistantWithSuspense = (props) => (
  <ErrorBoundary componentName="AI助手">
    <Suspense fallback={<LoadingFallback message="正在加载AI助手..." />}>
      <AIAssistant {...props} />
    </Suspense>
  </ErrorBoundary>
);

export const IPAddressQueryWithSuspense = (props) => (
  <ErrorBoundary componentName="IP地址查询">
    <Suspense fallback={<LoadingFallback message="正在加载IP地址查询..." />}>
      <IPAddressQuery {...props} />
    </Suspense>
  </ErrorBoundary>
);

// 预加载函数对象，为提高应用启动速度，延迟加载非关键组件
const preloadComponents = {
  fileManager: () => import("./FileManager.jsx"),
  resourceMonitor: () => import("./ResourceMonitor.jsx"),
  aiAssistant: () => import("./AIAssistant.jsx"),
  ipAddressQuery: () => import("./IPAddressQuery.jsx"),
};

// 导出懒加载组件以供直接使用（如果需要）
export {
  FileManager,
  ResourceMonitor,
  AIAssistant,
  IPAddressQuery,
  preloadComponents,
};
