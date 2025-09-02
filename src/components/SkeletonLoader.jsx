import React, { memo } from "react";
import {
  Box,
  Skeleton,
  Stack,
  Typography,
  useTheme,
  alpha,
} from "@mui/material";
import { keyframes } from "@emotion/react";
import { useTranslation } from "react-i18next";

// 自定义脉冲动画
const pulseAnimation = keyframes`
  0% {
    opacity: 0.6;
  }
  50% {
    opacity: 0.3;
  }
  100% {
    opacity: 0.6;
  }
`;

// 自定义波浪动画
const waveAnimation = keyframes`
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(100%);
  }
  100% {
    transform: translateX(100%);
  }
`;

// 基础骨架屏组件
const SkeletonLoader = memo(
  ({
    type = "default",
    width = "100%",
    height = 20,
    variant = "rectangular",
    animation = "wave",
    lines = 1,
    spacing = 1,
    showAvatar = false,
    avatarSize = 40,
    sx = {},
    ...props
  }) => {
    const theme = useTheme();

    const baseSkeletonSx = {
      backgroundColor: alpha(theme.palette.text.primary, 0.1),
      ...(animation === "pulse" && {
        animation: `${pulseAnimation} 1.5s ease-in-out infinite`,
      }),
      ...sx,
    };

    // 根据类型渲染不同的骨架屏
    const renderSkeletonByType = () => {
      switch (type) {
        case "text":
          return (
            <Stack spacing={spacing}>
              {Array.from({ length: lines }, (_, index) => (
                <Skeleton
                  key={index}
                  variant="text"
                  width={index === lines - 1 ? "70%" : width}
                  height={height}
                  animation={animation}
                  sx={baseSkeletonSx}
                  {...props}
                />
              ))}
            </Stack>
          );

        case "profile":
          return (
            <Stack direction="row" spacing={2} alignItems="center">
              <Skeleton
                variant="circular"
                width={avatarSize}
                height={avatarSize}
                animation={animation}
                sx={baseSkeletonSx}
              />
              <Stack spacing={1} flex={1}>
                <Skeleton
                  variant="text"
                  width="60%"
                  height={16}
                  animation={animation}
                  sx={baseSkeletonSx}
                />
                <Skeleton
                  variant="text"
                  width="40%"
                  height={12}
                  animation={animation}
                  sx={baseSkeletonSx}
                />
              </Stack>
            </Stack>
          );

        case "card":
          return (
            <Box sx={{ width: "100%" }}>
              <Skeleton
                variant="rectangular"
                width="100%"
                height={120}
                animation={animation}
                sx={{ ...baseSkeletonSx, mb: 1 }}
              />
              <Skeleton
                variant="text"
                width="80%"
                height={20}
                animation={animation}
                sx={baseSkeletonSx}
              />
              <Skeleton
                variant="text"
                width="60%"
                height={16}
                animation={animation}
                sx={baseSkeletonSx}
              />
            </Box>
          );

        case "list":
          return (
            <Stack spacing={2}>
              {Array.from({ length: lines }, (_, index) => (
                <Stack
                  key={index}
                  direction="row"
                  spacing={2}
                  alignItems="center"
                >
                  {showAvatar && (
                    <Skeleton
                      variant="circular"
                      width={24}
                      height={24}
                      animation={animation}
                      sx={baseSkeletonSx}
                    />
                  )}
                  <Stack spacing={0.5} flex={1}>
                    <Skeleton
                      variant="text"
                      width="70%"
                      height={16}
                      animation={animation}
                      sx={baseSkeletonSx}
                    />
                    <Skeleton
                      variant="text"
                      width="40%"
                      height={12}
                      animation={animation}
                      sx={baseSkeletonSx}
                    />
                  </Stack>
                </Stack>
              ))}
            </Stack>
          );

        case "table":
          return (
            <Box sx={{ width: "100%" }}>
              {/* 表头 */}
              <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton
                    key={index}
                    variant="text"
                    width="100%"
                    height={20}
                    animation={animation}
                    sx={baseSkeletonSx}
                  />
                ))}
              </Stack>
              {/* 表格行 */}
              {Array.from({ length: lines }, (_, rowIndex) => (
                <Stack
                  key={rowIndex}
                  direction="row"
                  spacing={2}
                  sx={{ mb: 1 }}
                >
                  {Array.from({ length: 4 }, (_, colIndex) => (
                    <Skeleton
                      key={colIndex}
                      variant="text"
                      width="100%"
                      height={16}
                      animation={animation}
                      sx={baseSkeletonSx}
                    />
                  ))}
                </Stack>
              ))}
            </Box>
          );

        case "terminal":
          return (
            <Box
              sx={{
                backgroundColor:
                  theme.palette.mode === "dark" ? "#1e1e1e" : "#f5f5f5",
                padding: 2,
                borderRadius: 1,
                fontFamily: "monospace",
              }}
            >
              {Array.from({ length: lines }, (_, index) => (
                <Stack key={index} direction="row" spacing={1} sx={{ mb: 0.5 }}>
                  <Skeleton
                    variant="text"
                    width={20}
                    height={16}
                    animation={animation}
                    sx={{
                      ...baseSkeletonSx,
                      backgroundColor: alpha(theme.palette.primary.main, 0.2),
                    }}
                  />
                  <Skeleton
                    variant="text"
                    width={Math.random() > 0.5 ? "80%" : "60%"}
                    height={16}
                    animation={animation}
                    sx={baseSkeletonSx}
                  />
                </Stack>
              ))}
            </Box>
          );

        case "fileList":
          return (
            <Stack spacing={0.5} sx={{ width: "100%" }}>
              {Array.from({ length: lines }, (_, index) => (
                <Box
                  key={index}
                  sx={{
                    height: 36,
                    borderRadius: 1,
                    px: 2,
                    display: "flex",
                    alignItems: "center",
                    backgroundColor: alpha(theme.palette.text.primary, 0.05),
                  }}
                >
                  <Box sx={{ width: 28, minWidth: 28, mr: 1, display: "flex", justifyContent: "center" }}>
                    <Skeleton
                      variant="circular"
                      width={18}
                      height={18}
                      animation={animation}
                      sx={baseSkeletonSx}
                    />
                  </Box>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack spacing={0.25}>
                      <Skeleton
                        variant="text"
                        width="60%"
                        height={14}
                        animation={animation}
                        sx={baseSkeletonSx}
                      />
                      <Skeleton
                        variant="text"
                        width="40%"
                        height={12}
                        animation={animation}
                        sx={baseSkeletonSx}
                      />
                    </Stack>
                  </Box>
                </Box>
              ))}
            </Stack>
          );

        default:
          return (
            <Skeleton
              variant={variant}
              width={width}
              height={height}
              animation={animation}
              sx={baseSkeletonSx}
              {...props}
            />
          );
      }
    };

    return renderSkeletonByType();
  },
);

// 特定组件的骨架屏
export const ConnectionManagerSkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 2, display: "block" }}
      >
        {t("common.skeleton.connections")}
      </Typography>
      <SkeletonLoader type="profile" avatarSize={32} />
      <Box sx={{ mt: 2 }}>
        <SkeletonLoader type="list" lines={3} showAvatar />
      </Box>
    </Box>
  );
});

export const FileManagerSkeleton = memo(() => {
  return (
    <Box sx={{ p: 1, height: "100%", overflow: "hidden" }}>
      <Box sx={{ flex: 1, height: "100%" }}>
        <SkeletonLoader type="fileList" lines={12} />
      </Box>
    </Box>
  );
});

export const TerminalSkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        p: 2,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Typography variant="caption" color="text.secondary" sx={{ mb: 2 }}>
        {t("common.skeleton.terminal")}
      </Typography>
      <SkeletonLoader type="terminal" lines={12} />
    </Box>
  );
});

export const ResourceMonitorSkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 2, display: "block" }}
      >
        {t("common.skeleton.resourceMonitor")}
      </Typography>
      <SkeletonLoader type="text" lines={1} height={24} />
      <Box sx={{ mt: 2, mb: 2 }}>
        <SkeletonLoader height={200} />
      </Box>
      <SkeletonLoader type="table" lines={4} />
    </Box>
  );
});

export const SettingsSkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 2, display: "block" }}
      >
        {t("common.skeleton.settings")}
      </Typography>
      {Array.from({ length: 4 }, (_, sectionIndex) => (
        <Box key={sectionIndex} sx={{ mb: 3 }}>
          <SkeletonLoader type="text" width="30%" height={20} />
          <Box sx={{ mt: 1 }}>
            <SkeletonLoader type="list" lines={2} />
          </Box>
        </Box>
      ))}
    </Box>
  );
});

export const CommandHistorySkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 1 }}>
      <SkeletonLoader width="100%" height={36} />
      <Box sx={{ mt: 2 }}>
        <SkeletonLoader type="list" lines={6} showAvatar avatarSize={20} />
      </Box>
    </Box>
  );
});

export const AIChatSkeleton = memo(() => {
  const { t } = useTranslation();
  return (
    <Box sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 2, display: "block" }}
      >
        {t("common.skeleton.aiChat")}
      </Typography>
      <SkeletonLoader type="profile" avatarSize={28} />
      <Box sx={{ mt: 2 }}>
        <SkeletonLoader type="text" lines={3} spacing={1} />
      </Box>
      <Box sx={{ mt: 2, textAlign: "right" }}>
        <SkeletonLoader type="text" lines={2} width="80%" />
      </Box>
    </Box>
  );
});

SkeletonLoader.displayName = "SkeletonLoader";

export default SkeletonLoader;
