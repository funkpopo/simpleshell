import { createElement, forwardRef } from "react";
import Grow from "@mui/material/Grow";
import Slide from "@mui/material/Slide";
import useMediaQuery from "@mui/material/useMediaQuery";
import { createTheme } from "@mui/material/styles";

const REDUCED_MOTION_QUERY = "@media (prefers-reduced-motion: reduce)";
const PRESS_TRANSITION =
  "transform 120ms cubic-bezier(0.2, 0, 0, 1), border-color 160ms ease, background-color 160ms ease, color 160ms ease";

const RADIUS_SM = 3;
const RADIUS_MD = 6;
const RADIUS_LG = 10;

export const RADIUS = { SM: RADIUS_SM, MD: RADIUS_MD, LG: RADIUS_LG };

const primaryColor = (darkMode) => (darkMode ? "#f1f2ef" : "#151719");
const primaryAlpha = (darkMode, alpha) =>
  darkMode ? `rgba(241, 242, 239, ${alpha})` : `rgba(21, 23, 25, ${alpha})`;

const hoverBg = (darkMode) =>
  darkMode ? "rgba(241,242,239,0.07)" : "rgba(21,23,25,0.055)";
const selectedBg = (darkMode) => primaryAlpha(darkMode, 0.1);
const selectedHoverBg = (darkMode) => primaryAlpha(darkMode, 0.14);

const borderClr = (darkMode) =>
  darkMode ? "rgba(241,242,239,0.16)" : "rgba(16,18,20,0.16)";

const DialogGrowTransition = forwardRef(
  function DialogGrowTransition(props, ref) {
    const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
    return createElement(Grow, {
      ...props,
      timeout: prefersReducedMotion ? 0 : props.timeout,
      ref,
    });
  },
);

const SnackbarSlideTransition = forwardRef(
  function SnackbarSlideTransition(props, ref) {
    const prefersReducedMotion = useMediaQuery(REDUCED_MOTION_QUERY);
    return createElement(Slide, {
      ...props,
      direction: "left",
      timeout: prefersReducedMotion ? 0 : props.timeout,
      ref,
    });
  },
);

export const createUnifiedTheme = (darkMode) =>
  createTheme({
    palette: {
      mode: darkMode ? "dark" : "light",
      primary: {
        main: primaryColor(darkMode),
        light: darkMode ? "#ffffff" : "#34383c",
        dark: darkMode ? "#c7cac6" : "#050607",
        contrastText: darkMode ? "#08090a" : "#ffffff",
      },
      secondary: {
        main: darkMode ? "#9ca2a7" : "#60676e",
        light: darkMode ? "#bcc1c5" : "#7b838b",
        dark: darkMode ? "#737a80" : "#43494f",
      },
      background: {
        default: darkMode ? "#08090a" : "#f1f1ee",
        paper: darkMode ? "#0d0f11" : "#f8f8f5",
      },
      text: {
        primary: darkMode ? "#f1f2ef" : "#151719",
        secondary: darkMode ? "#959ba0" : "#62676c",
        disabled: darkMode ? "#555b60" : "#999da1",
      },
      divider: darkMode ? "rgba(241,242,239,0.09)" : "rgba(16,18,20,0.10)",
      success: { main: darkMode ? "#65b98b" : "#247a52" },
      warning: { main: darkMode ? "#d4a253" : "#9a6418" },
      error: { main: darkMode ? "#e06a63" : "#b53630" },
      info: { main: darkMode ? "#74a8c8" : "#356c91" },
      action: {
        hover: hoverBg(darkMode),
        selected: selectedBg(darkMode),
        focus: primaryAlpha(darkMode, 0.16),
      },
    },
    shape: {
      borderRadius: RADIUS_SM,
    },
    typography: {
      fontFamily: [
        "-apple-system",
        "BlinkMacSystemFont",
        '"Segoe UI"',
        "Roboto",
        '"Helvetica Neue"',
        "Arial",
        '"Noto Sans CJK SC"',
        '"Noto Sans SC"',
        '"WenQuanYi Micro Hei"',
        '"Microsoft YaHei"',
        '"PingFang SC"',
        "sans-serif",
      ].join(","),
      h6: {
        fontSize: "1rem",
        fontWeight: 650,
        lineHeight: 1.3,
        letterSpacing: "-0.015em",
      },
      subtitle2: { fontSize: "0.875rem", fontWeight: 650, lineHeight: 1.3 },
      body2: { fontSize: "0.875rem", lineHeight: 1.5 },
      caption: {
        fontSize: "0.75rem",
        lineHeight: 1.4,
        letterSpacing: "0.015em",
      },
      button: {
        textTransform: "none",
        fontWeight: 650,
        letterSpacing: "0.025em",
      },
    },
    components: {
      MuiSkeleton: {
        defaultProps: {
          animation: darkMode ? "pulse" : "wave",
        },
        styleOverrides: {
          root: {
            backgroundColor: darkMode
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.08)",
            borderRadius: RADIUS_SM,
          },
          text: { borderRadius: RADIUS_SM },
          rectangular: { borderRadius: RADIUS_SM },
          wave: {
            "&::after": {
              background: darkMode
                ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)"
                : "linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)",
            },
          },
        },
      },

      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 650,
            boxShadow: "none",
            transition: PRESS_TRANSITION,
            transform: "translateZ(0)",
            "&:hover": {
              boxShadow: "none",
              transform: "translateY(-1px)",
            },
            "&:active": {
              transform: "scale(0.97)",
            },
            [REDUCED_MOTION_QUERY]: {
              transition: "box-shadow 0.2s ease, background-color 0.2s ease",
              "&:active": { transform: "none" },
            },
          },
          contained: {
            boxShadow: "none",
            border: `1px solid ${primaryColor(darkMode)}`,
            "&:hover": {
              boxShadow: "none",
              backgroundColor: darkMode ? "#d9dbd7" : "#050607",
            },
          },
          outlined: {
            borderWidth: "1px",
            "&:hover": {
              borderWidth: "1px",
              backgroundColor: primaryAlpha(darkMode, 0.08),
            },
          },
          text: {
            "&:hover": {
              backgroundColor: primaryAlpha(darkMode, 0.08),
            },
          },
        },
      },

      MuiTextField: {
        defaultProps: { variant: "outlined" },
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              backgroundColor: darkMode
                ? "rgba(255,255,255,0.02)"
                : "rgba(0,0,0,0.02)",
              transition: "all 0.2s ease",
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: primaryColor(darkMode),
                borderWidth: "1px",
              },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderWidth: "1px",
              },
            },
            "& .MuiInputLabel-outlined": {
              "&.Mui-focused": {
                color: primaryColor(darkMode),
              },
            },
          },
        },
      },

      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS_MD,
            boxShadow: "none",
            border: `1px solid ${borderClr(darkMode)}`,
            transition: "border-color 160ms ease, background-color 160ms ease",
          },
        },
      },

      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: "none",
          },
        },
      },

      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: PRESS_TRANSITION,
            transform: "translateZ(0)",
            "&:hover": {
              backgroundColor: hoverBg(darkMode),
              transform: "translateY(-1px)",
            },
            "&:active": {
              transform: "scale(0.94)",
            },
            [REDUCED_MOTION_QUERY]: {
              transition: "background-color 0.2s ease",
              "&:hover": { transform: "none" },
              "&:active": { transform: "none" },
            },
          },
        },
      },

      MuiDialog: {
        defaultProps: {
          slots: { transition: DialogGrowTransition },
          transitionDuration: { enter: 220, exit: 180 },
        },
        styleOverrides: {
          paper: {
            borderRadius: RADIUS_MD,
            backgroundImage: "none",
            border: `1px solid ${borderClr(darkMode)}`,
            boxShadow: darkMode
              ? "0 20px 64px rgba(0,0,0,0.62)"
              : "0 18px 56px rgba(11,13,15,0.16)",
            transformOrigin: "center top",
            willChange: "transform, opacity",
          },
        },
      },

      MuiSnackbar: {
        defaultProps: {
          slots: { transition: SnackbarSlideTransition },
          transitionDuration: { enter: 300, exit: 220 },
        },
      },

      MuiSelect: {
        styleOverrides: {
          outlined: {
            backgroundColor: darkMode
              ? "rgba(255,255,255,0.02)"
              : "rgba(0,0,0,0.02)",
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: primaryColor(darkMode),
            },
          },
        },
      },

      MuiListItem: {
        styleOverrides: {
          root: {
            paddingTop: 4,
            paddingBottom: 4,
            minHeight: 50,
            maxHeight: 50,
            borderRadius: RADIUS_SM,
            "&:hover": {
              backgroundColor: "transparent",
            },
          },
          dense: {
            paddingTop: 2,
            paddingBottom: 2,
            minHeight: 50,
            maxHeight: 50,
          },
          gutters: {
            paddingLeft: 8,
            paddingRight: 8,
          },
        },
      },

      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS_SM,
            transition: "all 0.2s ease",
            backgroundColor: "transparent",
            "&:hover": {
              backgroundColor: hoverBg(darkMode),
            },
            "&.Mui-selected": {
              backgroundColor: selectedBg(darkMode),
              "&:hover": {
                backgroundColor: selectedHoverBg(darkMode),
              },
            },
            "&.Mui-focusVisible": {
              backgroundColor: selectedBg(darkMode),
            },
          },
        },
      },

      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS_SM,
            fontWeight: 500,
            transition: "all 0.2s ease",
            letterSpacing: "0.035em",
          },
          outlined: {
            borderWidth: "1px",
          },
        },
      },

      MuiTooltip: {
        defaultProps: {
          placement: "top",
          disableInteractive: true,
          enterDelay: 350,
          enterNextDelay: 120,
          leaveDelay: 60,
        },
        styleOverrides: {
          tooltip: {
            borderRadius: RADIUS_SM,
            fontSize: "0.75rem",
            backgroundColor: darkMode
              ? "rgba(241,242,239,0.96)"
              : "rgba(21,23,25,0.96)",
            color: darkMode ? "#08090a" : "#ffffff",
            border: `1px solid ${borderClr(!darkMode)}`,
            boxShadow: "none",
          },
          tooltipPlacementTop: { marginBottom: 4 },
          tooltipPlacementBottom: { marginTop: 4 },
          tooltipPlacementLeft: { marginRight: 4 },
          tooltipPlacementRight: { marginLeft: 4 },
        },
      },

      MuiMenu: {
        styleOverrides: {
          paper: {
            marginTop: 4,
            boxShadow: darkMode
              ? "0 14px 44px rgba(0,0,0,0.5)"
              : "0 14px 44px rgba(11,13,15,0.12)",
            border: `1px solid ${borderClr(darkMode)}`,
          },
        },
      },

      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: RADIUS_SM,
            margin: "2px 4px",
            transition: "all 0.2s ease",
            backgroundColor: "transparent",
            "&:hover": {
              backgroundColor: hoverBg(darkMode),
            },
            "&.Mui-selected": {
              backgroundColor: selectedBg(darkMode),
              "&:hover": {
                backgroundColor: selectedHoverBg(darkMode),
              },
            },
            "&.Mui-focusVisible": {
              backgroundColor: selectedBg(darkMode),
            },
          },
        },
      },

      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            borderRadius: 0,
            transition: "all 0.2s ease",
            "&:hover": {
              backgroundColor: hoverBg(darkMode),
            },
            "&.Mui-selected": {
              fontWeight: 600,
            },
          },
        },
      },

      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 1,
            borderRadius: 0,
          },
        },
      },

      MuiSwitch: {
        styleOverrides: {
          root: {
            "& .MuiSwitch-switchBase.Mui-checked": {
              color: primaryColor(darkMode),
              "& + .MuiSwitch-track": {
                backgroundColor: primaryColor(darkMode),
                opacity: 0.5,
              },
            },
          },
          track: {
            borderRadius: 10,
          },
          thumb: {
            boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
          },
        },
      },

      MuiSlider: {
        styleOverrides: {
          root: {
            "& .MuiSlider-thumb": {
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
              "&:hover, &.Mui-focusVisible": {
                boxShadow: `0 0 0 8px ${primaryAlpha(darkMode, 0.16)}`,
              },
            },
            "& .MuiSlider-track": {
              borderRadius: 2,
            },
            "& .MuiSlider-rail": {
              borderRadius: 2,
            },
          },
        },
      },
    },
  });

export default createUnifiedTheme;
