import React from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";

/**
 * 懒加载组件的统一加载状态组件
 * @param {Object} props - 组件属性
 * @param {string} props.message - 加载提示信息
 * @param {number} props.size - 加载指示器大小
 * @param {boolean} props.showMessage - 是否显示加载信息
 */
const LoadingFallback = ({
  message = "正在加载组件...",
  size = 40,
  showMessage = true,
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
        color: theme.palette.text.secondary,
        gap: 2,
      }}
    >
      <CircularProgress
        size={size}
        color="primary"
        sx={{
          animation: "pulse 1.5s ease-in-out infinite",
          "@keyframes pulse": {
            "0%": {
              opacity: 1,
            },
            "50%": {
              opacity: 0.5,
            },
            "100%": {
              opacity: 1,
            },
          },
        }}
      />
      {showMessage && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            textAlign: "center",
            fontWeight: 400,
          }}
        >
          {message}
        </Typography>
      )}
    </Box>
  );
};

export default LoadingFallback;
