import { createElement, forwardRef } from "react";
import Grow from "@mui/material/Grow";
import Slide from "@mui/material/Slide";
import useMediaQuery from "@mui/material/useMediaQuery";
import { createTheme } from "@mui/material/styles";

const REDUCED_MOTION_QUERY = "@media (prefers-reduced-motion: reduce)";
const PRESS_TRANSITION =
  "transform 100ms ease-out, box-shadow 0.2s ease, background-color 0.2s ease";

const RADIUS_SM = 6;
const RADIUS_MD = 10;
const RADIUS_LG = 16;

export const RADIUS = { SM: RADIUS_SM, MD: RADIUS_MD, LG: RADIUS_LG };

const primaryColor = (darkMode) => (darkMode ? "#90caf9" : "#1976d2");
const primaryAlpha = (darkMode, alpha) =>
  darkMode ? `rgba(144, 202, 249, ${alpha})` : `rgba(25, 118, 210, ${alpha})`;

const hoverBg = (darkMode) =>
  darkMode ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)";
const selectedBg = (darkMode) => primaryAlpha(darkMode, 0.12);
const selectedHoverBg = (darkMode) => primaryAlpha(darkMode, 0.16);

const sh = (darkMode, y, blur, darkOpacity, lightOpacity) =>
  `0 ${y}px ${blur}px rgba(0,0,0,${darkMode ? darkOpacity : lightOpacity})`;

const borderClr = (darkMode) =>
  darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";

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
        light: darkMode ? "#bbdefb" : "#42a5f5",
        dark: darkMode ? "#5c9bd1" : "#1565c0",
      },
      secondary: {
        main: darkMode ? "#f48fb1" : "#dc004e",
        light: darkMode ? "#f8bbd9" : "#e91e63",
        dark: darkMode ? "#c2185b" : "#ad0e4e",
      },
      background: {
        default: darkMode ? "#121212" : "#e8eaed",
        paper: darkMode ? "#1e1e1e" : "#f3f4f6",
      },
      success: { main: darkMode ? "#4caf50" : "#2e7d32" },
      warning: { main: darkMode ? "#ff9800" : "#ed6c02" },
      error: { main: darkMode ? "#f44336" : "#d32f2f" },
    },
    shape: {
      borderRadius: RADIUS_SM,
    },
    typography: {
      fontFamily: [
        "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "Roboto",
        '"Helvetica Neue"', "Arial", "sans-serif",
      ].join(","),
      h6: { fontSize: "1rem", fontWeight: 600, lineHeight: 1.3 },
      subtitle2: { fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.3 },
      body2: { fontSize: "0.875rem", lineHeight: 1.5 },
      caption: { fontSize: "0.75rem", lineHeight: 1.4 },
      button: {
        textTransform: "none",
        fontWeight: 600,
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
            fontWeight: 600,
            boxShadow: "none",
            transition: PRESS_TRANSITION,
            transform: "translateZ(0)",
            "&:hover": {
              boxShadow: sh(darkMode, 2, 8, 0.3, 0.15),
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
            boxShadow: sh(darkMode, 1, 3, 0.3, 0.12),
            "&:hover": {
              boxShadow: sh(darkMode, 2, 8, 0.4, 0.24),
            },
          },
          outlined: {
            borderWidth: "1.5px",
            "&:hover": {
              borderWidth: "1.5px",
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
                borderWidth: "2px",
              },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderWidth: "2px",
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
            boxShadow: sh(darkMode, 2, 8, 0.3, 0.12),
            border: `1px solid ${borderClr(darkMode)}`,
            transition: "all 0.3s ease",
            "&:hover": {
              boxShadow: sh(darkMode, 4, 16, 0.4, 0.15),
              transform: "translateY(-1px)",
            },
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
              transform: "scale(1.05)",
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
            borderRadius: RADIUS_LG,
            fontWeight: 500,
            transition: "all 0.2s ease",
            "&:hover": {
              transform: "scale(1.02)",
            },
          },
          outlined: {
            borderWidth: "1.5px",
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
              ? "rgba(97, 97, 97, 0.95)"
              : "rgba(97, 97, 97, 0.9)",
            boxShadow: sh(darkMode, 2, 8, 0.3, 0.15),
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
            boxShadow: sh(darkMode, 4, 16, 0.4, 0.18),
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
            borderRadius: `${RADIUS_SM}px ${RADIUS_SM}px 0 0`,
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
            height: 3,
            borderRadius: "1.5px 1.5px 0 0",
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
