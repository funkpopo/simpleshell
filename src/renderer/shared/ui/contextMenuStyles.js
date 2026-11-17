import { alpha } from "@mui/material/styles";

export const compactContextMenuPaperSx = {
  minWidth: 172,
  py: 0.5,
  "& .MuiList-root": {
    py: 0.25,
  },
  "& .MuiMenuItem-root": {
    minHeight: 32,
    px: 1.25,
    py: 0.5,
    gap: 0.75,
    fontSize: "0.875rem",
    lineHeight: 1.25,
  },
  "& .MuiListItemIcon-root": {
    minWidth: 28,
    color: "inherit",
  },
  "& .MuiMenuItem-root > .MuiSvgIcon-root": {
    mr: 0.75,
    fontSize: "1.15rem",
  },
  "& .MuiListItemText-root": {
    my: 0,
  },
  "& .MuiListItemText-primary": {
    fontSize: "0.875rem",
    lineHeight: 1.25,
  },
  "& .MuiTypography-caption": {
    ml: 1.5,
    fontSize: "0.72rem",
    lineHeight: 1.2,
  },
  "& .MuiDivider-root": {
    my: 0.25,
  },
};

export const getWebTerminalContextMenuPaperSx = (theme) => {
  const isDark = theme.palette.mode === "dark";

  return {
    ...compactContextMenuPaperSx,
    borderRadius: "var(--radius-md, 6px)",
    boxShadow: "var(--shadow-md)",
    border: "1px solid var(--color-border)",
    bgcolor: alpha(theme.palette.background.paper, isDark ? 0.86 : 0.9),
    color: "text.primary",
    backdropFilter: "blur(16px) saturate(1.15)",
    WebkitBackdropFilter: "blur(16px) saturate(1.15)",
  };
};
