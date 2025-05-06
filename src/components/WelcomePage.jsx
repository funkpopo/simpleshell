import React from "react";
import { Box, Typography, Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";
import { keyframes } from "@emotion/react";

const WelcomePage = () => {
  const theme = useTheme();
  
  // 定义逆时针水流动画
  const flowAnimation = keyframes`
    0% {
      transform: rotate(0deg);
      opacity: 0.5;
    }
    50% {
      opacity: 0.8;
    }
    100% {
      transform: rotate(-360deg);
      opacity: 0.5;
    }
  `;
  
  // 水流渐变线条样式
  const waterFlowStyles = {
    position: "absolute",
    top: "5%",
    left: "5%",
    width: "90%",
    height: "90%",
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    "&::before, &::after": {
      content: '""',
      position: "absolute",
      top: "-5%",
      left: "-5%",
      width: "110%",
      height: "110%",
      borderRadius: "45%",
      background: `linear-gradient(45deg, transparent 30%, ${theme.palette.primary.main}40 70%, ${theme.palette.primary.main}70)`,
      animation: `${flowAnimation} 8s linear infinite`,
    },
    "&::after": {
      background: `linear-gradient(135deg, transparent 30%, ${theme.palette.primary.main}30 60%, ${theme.palette.primary.main}60)`,
      animationDuration: "12s",
      animationDelay: "-1s",
    },
    zIndex: 0,
    pointerEvents: "none",
  };

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        p: 3,
        bgcolor: "background.default",
        position: "relative", // 添加相对定位
        overflow: "hidden", // 防止动画溢出
      }}
    >
      {/* 水流动画背景 */}
      <Box sx={waterFlowStyles} />
      
      {/* 添加第二层水流效果，增强立体感 */}
      <Box
        sx={{
          ...waterFlowStyles,
          "&::before": {
            ...waterFlowStyles["&::before"],
            animationDuration: "15s",
            animationDirection: "reverse",
            background: `linear-gradient(225deg, transparent 40%, ${theme.palette.primary.main}20 65%, ${theme.palette.primary.main}50)`,
          },
          "&::after": {
            ...waterFlowStyles["&::after"],
            animationDuration: "20s",
            animationDelay: "-5s",
            background: `linear-gradient(315deg, transparent 40%, ${theme.palette.primary.main}20 65%, ${theme.palette.primary.main}50)`,
          },
        }}
      />

      <Paper
        elevation={3}
        sx={{
          p: 5,
          borderRadius: 2,
          maxWidth: 800,
          width: "100%",
          textAlign: "center",
          bgcolor: "background.paper",
          position: "relative", // 确保内容在动画上层
          zIndex: 1, // 确保内容在动画上层
        }}
      >
        <Box sx={{ mb: 4, display: "flex", justifyContent: "center" }}>
          <ComputerIcon sx={{ fontSize: 80, color: "primary.main", mb: 2 }} />
        </Box>

        <Typography
          variant="h4"
          gutterBottom
          sx={{ fontWeight: "bold", mb: 3 }}
        >
          欢迎使用 SimpleShell
        </Typography>

        <Typography variant="body1" paragraph sx={{ mb: 4 }}>
          SimpleShell
          是一个轻量级的终端模拟器，提供了简单易用的界面和强大的功能。
        </Typography>
      </Paper>
    </Box>
  );
};

export default WelcomePage;
