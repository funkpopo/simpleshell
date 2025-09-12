import React, { memo } from "react";
import {
  Box,
  Skeleton,
  Stack,
  Typography,
  useTheme,
  alpha,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  IconButton,
  CircularProgress,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
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
  const theme = useTheme();
  return (
    <Box sx={{ p: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ mb: 2, display: "block" }}
      >
        {t("common.skeleton.resourceMonitor")}
      </Typography>

      {/* 系统信息卡片轮廓 */}
      <Box
        sx={{
          mb: 1,
          borderRadius: 1,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            py: 1.25,
            px: 2,
            borderLeft: `4px solid ${theme.palette.primary.main}`,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Skeleton variant="circular" width={20} height={20} sx={{ mr: 1 }} />
          <Skeleton variant="text" width={80} height={20} />
          <Box sx={{ ml: "auto" }}>
            <Skeleton variant="rectangular" width={18} height={18} />
          </Box>
        </Box>
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" width="60%" height={16} sx={{ mb: 1 }} />
          <Skeleton variant="text" width="40%" height={14} sx={{ mb: 1 }} />
          <Skeleton variant="text" width="50%" height={14} />
        </Box>
      </Box>

      {/* CPU 卡片轮廓 */}
      <Box
        sx={{
          mb: 1,
          borderRadius: 1,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            py: 1.25,
            px: 2,
            borderLeft: `4px solid ${theme.palette.warning.main}`,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Skeleton variant="circular" width={20} height={20} sx={{ mr: 1 }} />
          <Skeleton variant="text" width={60} height={20} />
          <Box sx={{ ml: "auto" }}>
            <Skeleton variant="rectangular" width={18} height={18} />
          </Box>
        </Box>
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" width="30%" height={16} sx={{ mb: 1 }} />
          <Skeleton
            variant="rectangular"
            width="100%"
            height={8}
            sx={{ borderRadius: 1 }}
          />
        </Box>
      </Box>

      {/* 内存 卡片轮廓 */}
      <Box
        sx={{
          mb: 1,
          borderRadius: 1,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            py: 1.25,
            px: 2,
            borderLeft: `4px solid ${theme.palette.info.main}`,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Skeleton variant="circular" width={20} height={20} sx={{ mr: 1 }} />
          <Skeleton variant="text" width={60} height={20} />
          <Box sx={{ ml: "auto" }}>
            <Skeleton variant="rectangular" width={18} height={18} />
          </Box>
        </Box>
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" width="50%" height={16} sx={{ mb: 1 }} />
          <Skeleton variant="text" width="40%" height={14} sx={{ mb: 1 }} />
          <Skeleton
            variant="rectangular"
            width="100%"
            height={8}
            sx={{ borderRadius: 1 }}
          />
        </Box>
      </Box>

      {/* 进程列表 卡片轮廓 */}
      <Box
        sx={{
          mb: 1,
          borderRadius: 1,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            py: 1.25,
            px: 2,
            borderLeft: `4px solid ${theme.palette.secondary.main}`,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Skeleton variant="circular" width={20} height={20} sx={{ mr: 1 }} />
          <Skeleton variant="text" width={60} height={20} />
          <Box sx={{ ml: "auto" }}>
            <Skeleton variant="rectangular" width={18} height={18} />
          </Box>
        </Box>
        <Box sx={{ p: 2 }}>
          {/* 表头轮廓 */}
          <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
            <Skeleton variant="text" width="50%" height={14} />
            <Skeleton variant="text" width="20%" height={14} sx={{ ml: 2 }} />
            <Skeleton variant="text" width="20%" height={14} sx={{ ml: 2 }} />
          </Box>
          {/* 行轮廓 */}
          {Array.from({ length: 4 }).map((_, i) => (
            <Box
              key={i}
              sx={{ display: "flex", alignItems: "center", py: 0.75 }}
            >
              <Skeleton variant="text" width="45%" height={14} />
              <Skeleton
                variant="rectangular"
                width="20%"
                height={10}
                sx={{ ml: 2, borderRadius: 1 }}
              />
              <Skeleton
                variant="rectangular"
                width="20%"
                height={10}
                sx={{ ml: 2, borderRadius: 1 }}
              />
            </Box>
          ))}
        </Box>
      </Box>
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

export const LocalTerminalSidebarSkeleton = memo((props) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { onClose } = props || {};
  return (
    <Box
      sx={{
        width: 300,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: theme.palette.background.paper,
      }}
    >
      {/* 头部（不使用骨架） */}
      <Box
        sx={{
          p: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="subtitle1" fontWeight="medium" sx={{ flexGrow: 1 }}>
          {t("localTerminal.title")}
        </Typography>
        <Tooltip title={t("localTerminal.refresh")}>
          <span>
            <IconButton size="small" disabled>
              <CircularProgress size={18} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={t("common.close")}>
          <span>
            <IconButton size="small" onClick={onClose} disabled={!onClose}>
              <CloseIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* 搜索框骨架 */}
      <Box sx={{ p: 2, pb: 1 }}>
        <Skeleton
          variant="rectangular"
          width="100%"
          height={36}
          sx={{ borderRadius: 2 }}
        />
      </Box>

      {/* 标题骨架 */}
      <Box sx={{ px: 2, pb: 1 }}>
        <Skeleton variant="text" width={150} height={20} />
      </Box>

      {/* 终端列表骨架（与真实列表一致） */}
      <Box sx={{ px: 2, flex: 1, overflow: "hidden" }}>
        <List disablePadding>
          {Array.from({ length: 6 }, (_, index) => (
            <ListItem key={index} disablePadding sx={{ mb: 0.5 }}>
              <ListItemButton
                sx={{
                  borderRadius: 1,
                  minHeight: 48,
                  py: 1,
                  pr: 2,
                  "&:hover": {
                    backgroundColor: theme.palette.action.hover,
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.palette.background.paper,
                      border: `1px solid ${theme.palette.divider}`,
                    }}
                  >
                    <Skeleton variant="circular" width={20} height={20} />
                  </Box>
                </ListItemIcon>

                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Skeleton variant="text" width="60%" height={16} />
                    </Box>
                  }
                  secondary={<Skeleton variant="text" width="40%" height={12} />}
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>
    </Box>
  );
});

SkeletonLoader.displayName = "SkeletonLoader";

export default SkeletonLoader;
