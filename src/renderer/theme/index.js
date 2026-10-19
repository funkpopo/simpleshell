import { getThemeTokens, getThemePalette } from "../../shared/themeTokens.js";
import { Z_INDEX } from "../../shared/constants/zIndex.js";
import { createElement, forwardRef } from "react";
import Grow from "@mui/material/Grow";
import Slide from "@mui/material/Slide";
import useMediaQuery from "@mui/material/useMediaQuery";
import { createTheme, alpha as colorAlpha } from "@mui/material/styles";

const REDUCED_MOTION_QUERY = "@media (prefers-reduced-motion: reduce)";
const PRESS_TRANSITION =
  "transform 120ms cubic-bezier(0.2, 0, 0, 1), border-color 160ms ease, background-color 160ms ease, color 160ms ease";

const RADIUS_SM = Number.parseInt(getThemeTokens(false)["--radius-sm"], 10);
const RADIUS_MD = Number.parseInt(getThemeTokens(false)["--radius-md"], 10);
const RADIUS_LG = Number.parseInt(getThemeTokens(false)["--radius-lg"], 10);

export const RADIUS = { SM: RADIUS_SM, MD: RADIUS_MD, LG: RADIUS_LG };

const primaryColor = (darkMode) =>
  getThemeTokens(darkMode)["--color-primary-main"];
const primaryAlpha = (darkMode, opacity) =>
  colorAlpha(primaryColor(darkMode), opacity);

const hoverBg = (darkMode) => getThemeTokens(darkMode)["--color-hover"];
const selectedBg = (darkMode) => primaryAlpha(darkMode, 0.1);
const selectedHoverBg = (darkMode) => primaryAlpha(darkMode, 0.14);

const borderClr = (darkMode) => getThemeTokens(darkMode)["--color-border"];

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
    zIndex: {
      modal: Z_INDEX.modal,
      snackbar: Z_INDEX.snackbar,
      tooltip: Z_INDEX.modalPopup,
    },
    palette: {
      ...getThemePalette(darkMode),
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
              ? getThemeTokens(true)["--float-shadow"]
              : getThemeTokens(false)["--float-shadow"],
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
            color: getThemeTokens(darkMode)["--color-primary-contrast"],
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
            fontSize: "0.875rem",
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

      /* 列表项字号层级（原 typography.css 规则迁移至此，单一事实来源） */
      MuiListItemText: {
        styleOverrides: {
          primary: {
            fontSize: "0.875rem",
            lineHeight: 1.5,
          },
          secondary: {
            fontSize: "0.75rem",
            lineHeight: 1.4,
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
