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
    borderRadius: 1,
    boxShadow: isDark
      ? "0 8px 24px rgba(0,0,0,0.42)"
      : "0 8px 24px rgba(20,24,32,0.18)",
    border: `1px solid ${
      isDark ? "rgba(255,255,255,0.16)" : "rgba(20,24,32,0.12)"
    }`,
    bgcolor: isDark ? "rgba(26, 28, 34, 0.58)" : "rgba(255,255,255,0.62)",
    color: "text.primary",
    backdropFilter: "blur(16px) saturate(150%)",
    WebkitBackdropFilter: "blur(16px) saturate(150%)",
  };
};
