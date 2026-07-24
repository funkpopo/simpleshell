import { alpha } from "@mui/material/styles";

const SELECTED_OPACITY = 0.1;
const SELECTED_HOVER_OPACITY = 0.14;
const REDUCED_MOTION_QUERY = "@media (prefers-reduced-motion: reduce)";

/** 列表项圆角：对齐 --radius-sm */
export const SIDEBAR_ITEM_RADIUS = "var(--radius-sm, 6px)";

/** 列表项水平 inset（轻微缩进） */
export const SIDEBAR_ITEM_INSET_X = 0.75;

export const SIDEBAR_TITLE_BAR_HEIGHT = 44;

export const SIDEBAR_RAIL_WIDTH = 48;
export const SIDEBAR_RAIL_GAP = 0.5;
export const SIDEBAR_RAIL_SECTION_GAP = 1;

// 侧边栏 Paper 外壳统一样式
export const sidebarPaperSx = (theme, { borderLeft = true } = {}) => {
  const isDark = theme.palette.mode === "dark";
  const border = borderLeft
    ? { borderLeft: `1px solid ${theme.palette.divider}` }
    : {};

  return {
    width: "100%",
    minWidth: 0,
    height: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    borderRadius: 0,
    bgcolor: "background.paper",
    ...border,
    // 暗色：细边框 + 弱内阴影；亮色：靠 paper/default 对比，减少厚 elevation
    boxShadow: isDark
      ? "inset 0 0 0 1px rgba(255,255,255,0.04), inset 1px 0 12px rgba(0,0,0,0.18)"
      : "none",
  };
};

// 侧边栏展开后的标题栏统一样式（高度、内边距、分隔线）
export const sidebarTitleBarSx = (theme) => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  px: 1.25,
  py: 0.75,
  minHeight: SIDEBAR_TITLE_BAR_HEIGHT,
  flexShrink: 0,
  borderBottom: `1px solid ${theme.palette.divider}`,
  gap: 1,
});

// 标题栏内操作按钮（刷新/关闭等）统一尺寸
export const sidebarTitleIconButtonSx = {
  p: 0.5,
  "& .MuiSvgIcon-root": { fontSize: 18 },
};

export const getSidebarItemSelectedBg = (theme) =>
  alpha(theme.palette.primary.main, SELECTED_OPACITY);

export const getSidebarItemSelectedHoverBg = (theme) =>
  alpha(theme.palette.primary.main, SELECTED_HOVER_OPACITY);

export const getSidebarItemHoverBg = (theme) => theme.palette.action.hover;

export const getSidebarItemSurfaceBg = (theme) =>
  theme.palette.mode === "dark"
    ? "rgba(255, 255, 255, 0.04)"
    : "rgba(0, 0, 0, 0.03)";

const sidebarListItemBase = (theme, active = false) => ({
  backgroundColor: active ? getSidebarItemSelectedBg(theme) : "transparent",
  borderRadius: SIDEBAR_ITEM_RADIUS,
  mx: SIDEBAR_ITEM_INSET_X,
  overflow: "hidden",
  transition: theme.transitions.create(["background-color"], {
    duration: theme.transitions.duration.shortest,
  }),
  [REDUCED_MOTION_QUERY]: {
    transition: "none",
  },
  "&:hover": {
    backgroundColor: active
      ? getSidebarItemSelectedHoverBg(theme)
      : getSidebarItemHoverBg(theme),
  },
});

export const sidebarListItemSx = (theme, active = false) =>
  sidebarListItemBase(theme, active);

export const sidebarListItemButtonSx = (theme, active = false) =>
  sidebarListItemBase(theme, active);

/**
 * 图标轨按钮统一样式。
 * 默认 text.secondary；hover/active 用 primary；激活态左侧 2px accent + 浅底。
 */
export const sidebarRailButtonSx = (theme, active = false) => ({
  position: "relative",
  color: active ? "primary.main" : "text.secondary",
  borderRadius: SIDEBAR_ITEM_RADIUS,
  bgcolor: active ? getSidebarItemSelectedBg(theme) : "transparent",
  transition: theme.transitions.create(["background-color", "color"], {
    duration: theme.transitions.duration.shortest,
  }),
  [REDUCED_MOTION_QUERY]: {
    transition: "none",
  },
  "&:hover": {
    color: "primary.main",
    bgcolor: active
      ? getSidebarItemSelectedHoverBg(theme)
      : theme.palette.action.hover,
  },
  "&.Mui-disabled": {
    color: "text.disabled",
  },
  ...(active
    ? {
        "&::before": {
          content: '""',
          position: "absolute",
          left: 2,
          top: "22%",
          bottom: "22%",
          width: 2,
          borderRadius: 1,
          bgcolor: "primary.main",
        },
      }
    : {}),
});

/**
 * 图标轨短分隔线
 */
export const sidebarRailDividerSx = {
  height: "1px",
  width: 28,
  bgcolor: "divider",
  my: 0.5,
  flexShrink: 0,
  opacity: 0.85,
};

/**
 * 侧栏内容滑入容器。
 * @param {object} theme
 * @param {boolean} open
 * @param {{ animating?: boolean, slideFrom?: 'left'|'right' }} [options]
 */
export const sidebarContentSx = (
  theme,
  open,
  { animating = false, slideFrom = "right" } = {},
) => {
  const hiddenX = slideFrom === "left" ? "-100%" : "100%";
  const duration = theme.transitions.duration.enteringScreen;

  return {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    height: "100%",
    flexShrink: 0,
    boxSizing: "border-box",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    backfaceVisibility: "hidden",
    contain: "layout paint",
    pointerEvents: open ? "auto" : "none",
    transform: open ? "translate3d(0, 0, 0)" : `translate3d(${hiddenX}, 0, 0)`,
    // 动画结束后清除 willChange，避免长期占用合成层
    willChange: animating ? "transform" : "auto",
    transition: theme.transitions.create("transform", {
      easing: theme.transitions.easing.sharp,
      duration,
    }),
    [REDUCED_MOTION_QUERY]: {
      transition: "none",
      willChange: "auto",
    },
  };
};
