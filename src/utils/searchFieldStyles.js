import { alpha } from "@mui/material/styles";

const REDUCED_MOTION_QUERY = "@media (prefers-reduced-motion: reduce)";

/**
 * 共享搜索框样式生成器
 * 替代 FileManager 和 ConnectionManager 中重复的 getSearchFieldMotionSx
 */
export const getSearchFieldMotionSx = (theme, options = {}) => {
  const {
    borderRadius = 1.5,
    backgroundColor = theme.palette.mode === "dark"
      ? alpha(theme.palette.background.default, 0.5)
      : theme.palette.background.default,
    hoverBackgroundColor = theme.palette.background.paper,
    focusedBackgroundColor = theme.palette.background.paper,
    enableScale = false,
  } = options;

  const focusOutlineColor =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.primary.light, 0.28)
      : alpha(theme.palette.primary.main, 0.22);
  const focusShadowColor =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.primary.main, 0.3)
      : alpha(theme.palette.primary.main, 0.16);

  return {
    "& .MuiOutlinedInput-root": {
      borderRadius,
      backgroundColor,
      transition: enableScale
        ? "transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease"
        : "background-color 0.2s ease",
      transformOrigin: "center",
      "&:hover": {
        backgroundColor: hoverBackgroundColor,
      },
      "&.Mui-focused": {
        backgroundColor: focusedBackgroundColor,
        transform: enableScale ? "scale(1.01)" : "none",
        boxShadow: enableScale
          ? `0 0 0 1px ${focusOutlineColor}, 0 10px 24px ${focusShadowColor}`
          : `0 0 0 2px ${focusOutlineColor}`,
        "& .MuiOutlinedInput-notchedOutline": {
          borderColor: focusShadowColor,
        },
      },
      [REDUCED_MOTION_QUERY]: {
        transition: enableScale
          ? "box-shadow 0.2s ease, background-color 0.2s ease"
          : "none",
        "&.Mui-focused": {
          transform: "none",
        },
      },
    },
  };
};
