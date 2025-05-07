import React from "react";
import { Box, Typography, Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";
import { keyframes } from "@emotion/react";
import { useTranslation } from "react-i18next";

const WelcomePage = () => {
  const theme = useTheme();
  const { t } = useTranslation();
  
  // 定义更自然的水流波浪动画
  const wave1Animation = keyframes`
    0% {
      transform: translate(-50%, -50%) rotate(0deg) scale(1);
      border-radius: 43% 57% 51% 49% / 41% 43% 57% 59%;
      opacity: 0.6;
    }
    25% {
      transform: translate(-50%, -50%) rotate(-90deg) scale(1.05);
      border-radius: 49% 51% 43% 57% / 57% 49% 51% 43%;
      opacity: 0.7;
    }
    50% {
      transform: translate(-50%, -50%) rotate(-180deg) scale(1);
      border-radius: 57% 43% 49% 51% / 59% 57% 43% 41%;
      opacity: 0.8;
    }
    75% {
      transform: translate(-50%, -50%) rotate(-270deg) scale(1.05);
      border-radius: 51% 49% 57% 43% / 43% 51% 49% 57%;
      opacity: 0.7;
    }
    100% {
      transform: translate(-50%, -50%) rotate(-360deg) scale(1);
      border-radius: 43% 57% 51% 49% / 41% 43% 57% 59%;
      opacity: 0.6;
    }
  `;
  
  const wave2Animation = keyframes`
    0% {
      transform: translate(-50%, -50%) rotate(0deg) scale(1.1);
      border-radius: 53% 47% 39% 61% / 61% 39% 61% 39%;
      opacity: 0.5;
    }
    33% {
      transform: translate(-50%, -50%) rotate(-120deg) scale(1.15);
      border-radius: 61% 39% 47% 53% / 39% 61% 39% 61%;
      opacity: 0.6;
    }
    66% {
      transform: translate(-50%, -50%) rotate(-240deg) scale(1.1);
      border-radius: 47% 53% 61% 39% / 53% 47% 53% 47%;
      opacity: 0.5;
    }
    100% {
      transform: translate(-50%, -50%) rotate(-360deg) scale(1.1);
      border-radius: 53% 47% 39% 61% / 61% 39% 61% 39%;
      opacity: 0.5;
    }
  `;
  
  const wave3Animation = keyframes`
    0% {
      transform: translate(-50%, -50%) rotate(0deg) scale(1.2);
      border-radius: 37% 63% 45% 55% / 55% 45% 65% 35%;
      opacity: 0.4;
    }
    50% {
      transform: translate(-50%, -50%) rotate(180deg) scale(1.25);
      border-radius: 63% 37% 55% 45% / 35% 65% 35% 65%;
      opacity: 0.5;
    }
    100% {
      transform: translate(-50%, -50%) rotate(360deg) scale(1.2);
      border-radius: 37% 63% 45% 55% / 55% 45% 65% 35%;
      opacity: 0.4;
    }
  `;
  
  // 定义光影效果动画
  const shimmerAnimation = keyframes`
    0% {
      background-position: -200% center;
      opacity: 0.3;
    }
    100% {
      background-position: 200% center;
      opacity: 0.6;
    }
  `;
  
  // 定义微小水波纹动画
  const rippleAnimation = keyframes`
    0% {
      transform: scale(0);
      opacity: 0.8;
    }
    100% {
      transform: scale(2);
      opacity: 0;
    }
  `;
  
  // 定义内容卡片悬停动画
  const floatAnimation = keyframes`
    0% {
      transform: translateY(0px);
      box-shadow: 0 8px 24px 0 ${theme.palette.primary.main}30;
    }
    50% {
      transform: translateY(-10px);
      box-shadow: 0 16px 32px 0 ${theme.palette.primary.main}40;
    }
    100% {
      transform: translateY(0px);
      box-shadow: 0 8px 24px 0 ${theme.palette.primary.main}30;
    }
  `;
  
  // 更自然的水流层基础样式
  const waterLayerBaseStyles = {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: "130%",
    height: "130%",
    transform: "translate(-50%, -50%)",
    pointerEvents: "none",
    zIndex: 0,
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
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* 多层水流效果，共三层，增强深度和真实感 */}
      <Box
        sx={{
          ...waterLayerBaseStyles,
          animation: `${wave1Animation} 22s linear infinite`,
          background: `radial-gradient(circle at center, 
            ${theme.palette.primary.main}10 0%, 
            ${theme.palette.primary.main}30 40%, 
            ${theme.palette.primary.main}50 70%, 
            ${theme.palette.primary.main}10 100%)`,
          filter: "blur(8px)",
        }}
      />
      
      <Box
        sx={{
          ...waterLayerBaseStyles,
          animation: `${wave2Animation} 28s linear infinite`,
          background: `radial-gradient(circle at center, 
            ${theme.palette.primary.main}05 10%, 
            ${theme.palette.primary.main}25 45%, 
            ${theme.palette.primary.main}40 75%, 
            ${theme.palette.primary.main}05 100%)`,
          filter: "blur(6px)",
        }}
      />
      
      <Box
        sx={{
          ...waterLayerBaseStyles,
          animation: `${wave3Animation} 34s linear infinite`,
          background: `radial-gradient(circle at center, 
            ${theme.palette.primary.main}08 20%, 
            ${theme.palette.primary.main}20 50%, 
            ${theme.palette.primary.main}35 80%, 
            ${theme.palette.primary.main}00 100%)`,
          filter: "blur(4px)",
        }}
      />
      
      {/* 水面光影效果 */}
      <Box
        sx={{
          ...waterLayerBaseStyles,
          width: "150%",
          height: "150%",
          background: `linear-gradient(90deg, 
            transparent, 
            ${theme.palette.primary.main}15, 
            ${theme.palette.primary.main}25, 
            ${theme.palette.primary.main}15, 
            transparent)`,
          backgroundSize: "200% 100%",
          animation: `${shimmerAnimation} 12s ease-in-out infinite`,
          filter: "blur(12px)",
          transform: "translate(-50%, -50%) rotate(25deg)",
          mixBlendMode: "soft-light",
        }}
      />
      
      {/* 随机水波纹效果点缀 */}
      {[...Array(5)].map((_, i) => (
        <Box
          key={i}
          sx={{
            position: "absolute",
            width: 16,
            height: 16,
            borderRadius: "50%",
            backgroundColor: `${theme.palette.primary.main}40`,
            top: `${15 + Math.random() * 70}%`,
            left: `${15 + Math.random() * 70}%`,
            animation: `${rippleAnimation} ${3 + Math.random() * 4}s ease-out infinite ${Math.random() * 5}s`,
            opacity: 0,
            zIndex: 0,
          }}
        />
      ))}

      <Paper
        elevation={3}
        sx={{
          p: 5,
          borderRadius: 2,
          maxWidth: 800,
          width: "100%",
          textAlign: "center",
          bgcolor: "background.paper",
          position: "relative",
          zIndex: 1,
          boxShadow: `0 8px 32px 0 ${theme.palette.primary.main}30`,
          backdropFilter: "blur(8px)",
          border: `1px solid ${theme.palette.primary.main}20`,
          animation: `${floatAnimation} 6s ease-in-out infinite`,
          transition: "all 0.3s ease",
          "&:hover": {
            boxShadow: `0 16px 40px 0 ${theme.palette.primary.main}50`,
            backdropFilter: "blur(12px)",
            transform: "translateY(-5px) scale(1.01)",
          },
          "& *::selection": {
            backgroundColor: `${theme.palette.primary.main}30`,
          }
        }}
      >
        <Box sx={{ 
          mb: 4, 
          display: "flex", 
          justifyContent: "center",
          position: "relative",
          "&::after": {
            content: '""',
            position: "absolute",
            bottom: "-10px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "40%",
            height: "1px",
            background: `linear-gradient(90deg, transparent, ${theme.palette.primary.main}50, transparent)`,
          }
        }}>
          <ComputerIcon sx={{ 
            fontSize: 80, 
            color: "primary.main", 
            mb: 2,
            filter: `drop-shadow(0 4px 6px ${theme.palette.primary.main}40)`,
            transition: "all 0.3s ease",
            "&:hover": {
              transform: "scale(1.05)",
              filter: `drop-shadow(0 6px 8px ${theme.palette.primary.main}60)`,
            }
          }} />
        </Box>

        <Typography
          variant="h4"
          gutterBottom
          sx={{ 
            fontWeight: "bold", 
            mb: 3,
            background: `linear-gradient(120deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark} 50%, ${theme.palette.primary.main})`,
            backgroundSize: "200% auto",
            backgroundClip: "text",
            textFillColor: "transparent",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent", 
          }}
        >
          {t('welcome.title')}
        </Typography>

        <Typography variant="body1" paragraph sx={{ mb: 4, lineHeight: 1.8 }}>
          SimpleShell
          {t('welcome.description')}
        </Typography>
      </Paper>
    </Box>
  );
};

export default WelcomePage;
