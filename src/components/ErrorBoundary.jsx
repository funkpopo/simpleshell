import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import RefreshIcon from "@mui/icons-material/Refresh";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useTheme } from "@mui/material/styles";

// 全局错误日志系统
class GlobalErrorLogger {
  static instance = null;

  constructor() {
    this.errorQueue = [];
    this.maxQueueSize = 50;
  }

  static getInstance() {
    if (!GlobalErrorLogger.instance) {
      GlobalErrorLogger.instance = new GlobalErrorLogger();
    }
    return GlobalErrorLogger.instance;
  }

  logError(error, source = "unknown", additionalInfo = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
      source,
      url: window.location.href,
      userAgent: navigator.userAgent,
      ...additionalInfo,
    };

    // 添加到错误队列
    this.errorQueue.unshift(errorEntry);
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.pop();
    }

    // 在开发模式下输出到控制台
    if (process.env.NODE_ENV === "development") {
      console.error(`[Global Error] ${source}:`, error, additionalInfo);
    }

    // 可以在这里添加远程日志上报逻辑
    // this.reportToRemote(errorEntry);
  }

  getRecentErrors() {
    return this.errorQueue.slice(0, 10);
  }

  clearErrors() {
    this.errorQueue = [];
  }
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
    this.errorLogger = GlobalErrorLogger.getInstance();
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });

    // 记录错误到全局日志系统
    this.errorLogger.logError(error, "ErrorBoundary", {
      componentStack: errorInfo.componentStack,
      componentName: this.props.componentName || "Unknown",
    });
  }

  handleRetry = () => {
    this.setState((prevState) => ({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: prevState.retryCount + 1,
    }));
  };

  render() {
    if (this.state.hasError) {
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={this.handleRetry}
          retryCount={this.state.retryCount}
          componentName={this.props.componentName}
        />
      );
    }

    return this.props.children;
  }
}

// 全局错误边界组件
class GlobalErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
    this.errorLogger = GlobalErrorLogger.getInstance();
    this.setupGlobalErrorHandlers();
  }

  setupGlobalErrorHandlers() {
    // 处理 JavaScript 运行时错误
    if (typeof window !== "undefined") {
      window.addEventListener("error", this.handleGlobalError);
      window.addEventListener(
        "unhandledrejection",
        this.handleUnhandledRejection,
      );
    }
  }

  componentWillUnmount() {
    if (typeof window !== "undefined") {
      window.removeEventListener("error", this.handleGlobalError);
      window.removeEventListener(
        "unhandledrejection",
        this.handleUnhandledRejection,
      );
    }
  }

  handleGlobalError = (event) => {
    const error = event.error || new Error(event.message);
    this.errorLogger.logError(error, "GlobalWindow", {
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });
  };

  handleUnhandledRejection = (event) => {
    const error =
      event.reason instanceof Error
        ? event.reason
        : new Error(String(event.reason));
    this.errorLogger.logError(error, "UnhandledPromiseRejection");

    // 阻止默认的未处理 Promise 拒绝行为
    if (!this.props.allowUnhandledRejections) {
      event.preventDefault();
    }
  };

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });

    this.errorLogger.logError(error, "GlobalErrorBoundary", {
      componentStack: errorInfo.componentStack,
    });
  }

  handleAppRestart = () => {
    // 清除错误日志
    this.errorLogger.clearErrors();

    // 重置状态
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });

    // 如果提供了重启回调，则调用它
    if (this.props.onRestart) {
      this.props.onRestart();
    } else {
      // 默认行为：重新加载页面
      window.location.reload();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <GlobalErrorFallback
          error={this.state.error}
          onRestart={this.handleAppRestart}
          errorLogger={this.errorLogger}
        />
      );
    }

    return this.props.children;
  }
}

/**
 * 全局错误回退UI组件
 */
const GlobalErrorFallback = ({ error, onRestart, errorLogger }) => {
  const theme = useTheme();
  const [showDetails, setShowDetails] = React.useState(false);
  const recentErrors = errorLogger.getRecentErrors();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100vh",
        width: "100vw",
        backgroundColor: theme.palette.background.default,
        p: 4,
      }}
    >
      <Alert
        severity="error"
        sx={{
          width: "100%",
          maxWidth: "600px",
          mb: 3,
        }}
        icon={<ErrorOutlineIcon />}
      >
        <AlertTitle>应用程序遇到严重错误</AlertTitle>
        <Typography variant="body2" sx={{ mb: 2 }}>
          SimpleShell 遇到了无法恢复的错误。您可以尝试重启应用程序来解决此问题。
        </Typography>
        <Typography variant="body2" color="text.secondary">
          如果问题持续存在，请联系技术支持并提供错误详情。
        </Typography>
      </Alert>

      <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={<RefreshIcon />}
          onClick={onRestart}
          size="large"
        >
          重启应用
        </Button>
        <Button
          variant="outlined"
          onClick={() => setShowDetails(!showDetails)}
          size="large"
        >
          {showDetails ? "隐藏详情" : "显示详情"}
        </Button>
      </Box>

      {showDetails && (
        <Box
          sx={{
            width: "100%",
            maxWidth: "800px",
            maxHeight: "400px",
            overflow: "auto",
            backgroundColor: theme.palette.background.paper,
            borderRadius: 2,
            p: 2,
            border: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography variant="h6" sx={{ mb: 2 }}>
            错误详情
          </Typography>

          {error && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" color="error" sx={{ mb: 1 }}>
                当前错误：
              </Typography>
              <Typography
                variant="body2"
                component="pre"
                sx={{
                  fontSize: "0.75rem",
                  fontFamily: "monospace",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  backgroundColor: theme.palette.grey[100],
                  p: 1,
                  borderRadius: 1,
                }}
              >
                {error.stack || error.toString()}
              </Typography>
            </Box>
          )}

          {recentErrors.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                最近的错误记录 ({recentErrors.length} 条)：
              </Typography>
              {recentErrors.slice(0, 5).map((errorEntry, index) => (
                <Box
                  key={index}
                  sx={{
                    mb: 2,
                    p: 1,
                    backgroundColor: theme.palette.grey[50],
                    borderRadius: 1,
                    borderLeft: `3px solid ${theme.palette.error.main}`,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {errorEntry.timestamp} - {errorEntry.source}
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      fontFamily: "monospace",
                      fontSize: "0.7rem",
                      mt: 0.5,
                    }}
                  >
                    {errorEntry.error.message}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

/**
 * 错误回退UI组件
 */
const ErrorFallback = ({
  error,
  onRetry,
  retryCount,
  componentName = "组件",
}) => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        minHeight: "200px",
        backgroundColor: theme.palette.background.paper,
        p: 3,
      }}
    >
      <Alert
        severity="error"
        sx={{
          width: "100%",
          maxWidth: "400px",
          mb: 2,
        }}
        icon={<ErrorOutlineIcon />}
      >
        <AlertTitle>组件加载失败</AlertTitle>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {componentName}加载时发生错误，请尝试重新加载。
        </Typography>
        {retryCount > 0 && (
          <Typography variant="caption" color="text.secondary">
            已重试 {retryCount} 次
          </Typography>
        )}
      </Alert>

      <Button
        variant="contained"
        color="primary"
        startIcon={<RefreshIcon />}
        onClick={onRetry}
        sx={{ mt: 1 }}
      >
        重新加载
      </Button>

      {process.env.NODE_ENV === "development" && error && (
        <Box
          sx={{
            mt: 2,
            p: 2,
            backgroundColor: theme.palette.grey[100],
            borderRadius: 1,
            maxWidth: "400px",
            width: "100%",
            maxHeight: "200px",
            overflow: "auto",
          }}
        >
          <Typography variant="caption" color="error">
            开发模式错误信息：
          </Typography>
          <Typography
            variant="caption"
            component="pre"
            sx={{
              fontSize: "0.7rem",
              wordBreak: "break-all",
              whiteSpace: "pre-wrap",
            }}
          >
            {error.toString()}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default ErrorBoundary;
export { GlobalErrorBoundary, GlobalErrorLogger };
