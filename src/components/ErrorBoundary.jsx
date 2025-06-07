import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import RefreshIcon from "@mui/icons-material/Refresh";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import { useTheme } from "@mui/material/styles";

/**
 * 错误边界组件，用于捕获和处理懒加载组件的错误
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
    };
  }

  static getDerivedStateFromError(error) {
    // 更新state以显示错误UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // 记录错误信息 - 可以考虑使用项目的日志系统
    this.setState({
      error: error,
      errorInfo: errorInfo,
    });
  }

  handleRetry = () => {
    // 重试加载组件
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
