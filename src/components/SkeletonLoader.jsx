import React, { memo } from "react";
import {
  Box,
  Paper,
  Skeleton,
  Stack,
  Typography,
  useTheme,
  alpha,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import {
  sidebarContentSx,
  sidebarPaperSx,
  sidebarTitleBarSx,
} from "./sidebarItemStyles";

// 基础骨架屏组件
const SkeletonLoader = memo(
  ({
    type = "default",
    width = "100%",
    height = 20,
    variant = "rectangular",
    animation = undefined, // 使用主题默认动画
    lines = 1,
    spacing = 1,
    showAvatar = false,
    avatarSize = 40,
    sx = {},
    ...props
  }) => {
    const theme = useTheme();

    const baseSkeletonSx = {
      // 颜色与动画由主题统一控制，这里不再覆盖
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
                  <Box
                    sx={{
                      width: 28,
                      minWidth: 28,
                      mr: 1,
                      display: "flex",
                      justifyContent: "center",
                    }}
                  >
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
    <Box
      sx={{
        p: 1,
        width: "100%",
        minWidth: 0,
        height: "100%",
        flex: 1,
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <Box sx={{ flex: 1, height: "100%" }}>
        <SkeletonLoader type="fileList" lines={12} />
      </Box>
    </Box>
  );
});

/**
 * 动态模块下载期间使用的统一侧栏外壳。
 *
 * 外层尺寸、表面和滑入行为刻意与 SidebarPanel 保持一致，避免各业务骨架按
 * 内容最小宽度布局，或在模块就绪后突然切换背景和运动轨迹。
 */
export const SidebarLazySkeleton = memo(
  ({ open = false, variant = "list", loadingLabel }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const isFileManager = variant === "file";

    return (
      <Paper
        aria-busy="true"
        aria-label={loadingLabel || t("common.loading")}
        sx={{
          ...sidebarPaperSx(theme),
          position: "relative",
        }}
        elevation={theme.palette.mode === "dark" ? 1 : 0}
      >
        <Box sx={sidebarContentSx(theme, open)}>
          <Box sx={sidebarTitleBarSx(theme)}>
            <Skeleton variant="text" width="42%" height={24} />
            <Skeleton variant="circular" width={26} height={26} />
          </Box>

          {isFileManager && (
            <Box
              sx={{
                px: 1.5,
                py: 1,
                display: "flex",
                flexDirection: "column",
                gap: 1,
                flexShrink: 0,
                borderBottom: `1px solid ${theme.palette.divider}`,
                bgcolor: "background.paper",
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton
                    key={index}
                    variant="circular"
                    width={26}
                    height={26}
                  />
                ))}
              </Box>
              <Skeleton variant="rounded" width="100%" height={32} />
            </Box>
          )}

          <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {isFileManager ? (
              <FileManagerSkeleton />
            ) : (
              <Box sx={{ p: 1.5, width: "100%", boxSizing: "border-box" }}>
                <Skeleton variant="rounded" width="100%" height={36} />
                <Box sx={{ mt: 1.5 }}>
                  <SkeletonLoader type="list" lines={8} />
                </Box>
              </Box>
            )}
          </Box>
        </Box>
      </Paper>
    );
  },
);

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

SkeletonLoader.displayName = "SkeletonLoader";

export default SkeletonLoader;
