import { alpha } from "@mui/material/styles";

const SELECTED_OPACITY = 0.12;
const SELECTED_HOVER_OPACITY = 0.16;

export const SIDEBAR_ITEM_RADIUS = 1;

export const getSidebarItemSelectedBg = (theme) =>
  alpha(theme.palette.primary.main, SELECTED_OPACITY);

export const getSidebarItemSelectedHoverBg = (theme) =>
  alpha(theme.palette.primary.main, SELECTED_HOVER_OPACITY);

export const getSidebarItemHoverBg = (theme) => theme.palette.action.hover;

export const getSidebarItemSurfaceBg = (theme) =>
  theme.palette.mode === "dark"
    ? "rgba(255, 255, 255, 0.04)"
    : "rgba(0, 0, 0, 0.03)";

export const sidebarListItemSx = (theme, active = false) => ({
  backgroundColor: active ? getSidebarItemSelectedBg(theme) : "transparent",
  borderRadius: SIDEBAR_ITEM_RADIUS,
  overflow: "hidden",
  transition: theme.transitions.create(["background-color"], {
    duration: theme.transitions.duration.shortest,
  }),
  "&:hover": {
    backgroundColor: active
      ? getSidebarItemSelectedHoverBg(theme)
      : getSidebarItemHoverBg(theme),
  },
});

export const sidebarListItemButtonSx = (theme, active = false) => ({
  backgroundColor: active ? getSidebarItemSelectedBg(theme) : "transparent",
  borderRadius: SIDEBAR_ITEM_RADIUS,
  transition: theme.transitions.create(["background-color"], {
    duration: theme.transitions.duration.shortest,
  }),
  "&:hover": {
    backgroundColor: active
      ? getSidebarItemSelectedHoverBg(theme)
      : getSidebarItemHoverBg(theme),
  },
});

export const sidebarContentSx = (theme, open) => ({
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
  transform: open ? "translate3d(0, 0, 0)" : "translate3d(100%, 0, 0)",
  willChange: "transform",
  transition: theme.transitions.create("transform", {
    easing: theme.transitions.easing.sharp,
    duration: theme.transitions.duration.enteringScreen,
  }),
});
