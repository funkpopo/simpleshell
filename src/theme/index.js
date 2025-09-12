import { createTheme } from "@mui/material/styles";

/**
 * 创建统一的Material-UI主题配置
 * @param {boolean} darkMode - 是否为深色模式
 * @returns {object} Material-UI主题对象
 */
export const createUnifiedTheme = (darkMode) =>
  createTheme({
    palette: {
      mode: darkMode ? "dark" : "light",
      primary: {
        main: darkMode ? "#90caf9" : "#1976d2",
        light: darkMode ? "#bbdefb" : "#42a5f5",
        dark: darkMode ? "#5c9bd1" : "#1565c0",
      },
      secondary: {
        main: darkMode ? "#f48fb1" : "#dc004e",
        light: darkMode ? "#f8bbd9" : "#e91e63",
        dark: darkMode ? "#c2185b" : "#ad0e4e",
      },
      background: {
        default: darkMode ? "#121212" : "#f5f5f5",
        paper: darkMode ? "#1e1e1e" : "#ffffff",
      },
      success: {
        main: darkMode ? "#4caf50" : "#2e7d32",
      },
      warning: {
        main: darkMode ? "#ff9800" : "#ed6c02",
      },
      error: {
        main: darkMode ? "#f44336" : "#d32f2f",
      },
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      button: {
        textTransform: "none",
        fontWeight: 600,
      },
    },
    components: {
      // 统一骨架屏样式
      MuiSkeleton: {
        defaultProps: {
          // 统一动画：亮色使用 wave，暗色使用 pulse（柔和）
          animation: darkMode ? "pulse" : "wave",
        },
        styleOverrides: {
          root: {
            // 统一底色：基于主题动态透明度
            backgroundColor: darkMode
              ? "rgba(255,255,255,0.08)"
              : "rgba(0,0,0,0.08)",
            borderRadius: 6,
          },
          text: {
            borderRadius: 6,
          },
          rectangular: {
            borderRadius: 8,
          },
          circular: {
            // 保持圆形
          },
          wave: {
            // 调整高亮带颜色以匹配主题
            "&::after": {
              background:
                darkMode
                  ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent)"
                  : "linear-gradient(90deg, transparent, rgba(0,0,0,0.06), transparent)",
            },
          },
        },
      },
      // 统一按钮样式
      MuiButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            textTransform: "none",
            fontWeight: 600,
            boxShadow: "none",
            transition: "all 0.2s ease",
            "&:hover": {
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            },
          },
          contained: {
            boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
            "&:hover": {
              boxShadow: "0 2px 8px rgba(0,0,0,0.24)",
            },
          },
          outlined: {
            borderWidth: "1.5px",
            "&:hover": {
              borderWidth: "1.5px",
              backgroundColor: darkMode
                ? "rgba(144, 202, 249, 0.04)"
                : "rgba(25, 118, 210, 0.04)",
            },
          },
          text: {
            "&:hover": {
              backgroundColor: darkMode
                ? "rgba(144, 202, 249, 0.04)"
                : "rgba(25, 118, 210, 0.04)",
            },
          },
        },
      },

      // 统一输入框样式
      MuiTextField: {
        defaultProps: {
          variant: "outlined",
        },
        styleOverrides: {
          root: {
            "& .MuiOutlinedInput-root": {
              borderRadius: 8,
              backgroundColor: darkMode
                ? "rgba(255,255,255,0.02)"
                : "rgba(255,255,255,0.8)",
              transition: "all 0.2s ease",
              "&:hover .MuiOutlinedInput-notchedOutline": {
                borderColor: darkMode ? "#90caf9" : "#1976d2",
                borderWidth: "2px",
              },
              "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
                borderWidth: "2px",
              },
            },
            "& .MuiInputLabel-outlined": {
              "&.Mui-focused": {
                color: darkMode ? "#90caf9" : "#1976d2",
              },
            },
          },
        },
      },

      // 统一卡片样式
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            boxShadow: darkMode
              ? "0 2px 8px rgba(0,0,0,0.3)"
              : "0 2px 8px rgba(0,0,0,0.1)",
            border: `1px solid ${darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
            transition: "all 0.3s ease",
            "&:hover": {
              boxShadow: darkMode
                ? "0 4px 16px rgba(0,0,0,0.4)"
                : "0 4px 16px rgba(0,0,0,0.15)",
              transform: "translateY(-1px)",
            },
          },
        },
      },

      // 统一纸张组件样式
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            backgroundImage: "none",
          },
          elevation1: {
            boxShadow: darkMode
              ? "0 1px 3px rgba(0,0,0,0.3)"
              : "0 1px 3px rgba(0,0,0,0.12)",
          },
          elevation3: {
            boxShadow: darkMode
              ? "0 3px 6px rgba(0,0,0,0.4)"
              : "0 3px 6px rgba(0,0,0,0.16)",
          },
        },
      },

      // 统一图标按钮样式
      MuiIconButton: {
        styleOverrides: {
          root: {
            borderRadius: 8,
            transition: "all 0.2s ease",
            "&:hover": {
              backgroundColor: darkMode
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.04)",
              transform: "scale(1.05)",
            },
          },
        },
      },

      // 统一对话框样式
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: 12,
            backgroundImage: "none",
            border: `1px solid ${darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
          },
        },
      },

      // 统一选择器样式
      MuiSelect: {
        styleOverrides: {
          outlined: {
            borderRadius: 8,
            backgroundColor: darkMode
              ? "rgba(255,255,255,0.02)"
              : "rgba(255,255,255,0.8)",
            "&:hover .MuiOutlinedInput-notchedOutline": {
              borderColor: darkMode ? "#90caf9" : "#1976d2",
            },
          },
        },
      },

      // 统一列表项样式 - 避免多层高亮
      MuiListItem: {
        styleOverrides: {
          root: {
            paddingTop: 4,
            paddingBottom: 4,
            minHeight: 50,
            maxHeight: 50,
            borderRadius: 6,
            // 移除ListItem的hover效果，让ListItemButton处理
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

      // 统一列表按钮样式 - 统一管理交互效果
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 6,
            transition: "all 0.2s ease",
            // 默认状态下的背景
            backgroundColor: "transparent",
            // 悬停状态
            "&:hover": {
              backgroundColor: darkMode
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.04)",
            },
            // 选中状态
            "&.Mui-selected": {
              backgroundColor: darkMode
                ? "rgba(144, 202, 249, 0.12)"
                : "rgba(25, 118, 210, 0.08)",
              // 选中时的悬停效果，避免过度高亮
              "&:hover": {
                backgroundColor: darkMode
                  ? "rgba(144, 202, 249, 0.16)"
                  : "rgba(25, 118, 210, 0.12)",
              },
            },
            // 聚焦状态
            "&.Mui-focusVisible": {
              backgroundColor: darkMode
                ? "rgba(144, 202, 249, 0.12)"
                : "rgba(25, 118, 210, 0.08)",
            },
          },
        },
      },

      // 统一芯片样式
      MuiChip: {
        styleOverrides: {
          root: {
            borderRadius: 16,
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

      // 统一工具提示样式
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 6,
            fontSize: "0.75rem",
            backgroundColor: darkMode
              ? "rgba(97, 97, 97, 0.95)"
              : "rgba(97, 97, 97, 0.9)",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          },
        },
      },

      // 统一菜单样式
      MuiMenu: {
        styleOverrides: {
          paper: {
            borderRadius: 8,
            marginTop: 4,
            boxShadow: darkMode
              ? "0 4px 16px rgba(0,0,0,0.4)"
              : "0 4px 16px rgba(0,0,0,0.15)",
            border: `1px solid ${darkMode ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)"}`,
          },
        },
      },

      // 统一菜单项样式 - 避免多层高亮
      MuiMenuItem: {
        styleOverrides: {
          root: {
            borderRadius: 4,
            margin: "2px 4px",
            transition: "all 0.2s ease",
            backgroundColor: "transparent",
            // 悬停状态
            "&:hover": {
              backgroundColor: darkMode
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.04)",
            },
            // 选中状态
            "&.Mui-selected": {
              backgroundColor: darkMode
                ? "rgba(144, 202, 249, 0.12)"
                : "rgba(25, 118, 210, 0.08)",
              // 选中时的悬停效果，使用稍微深一点的颜色但避免过度高亮
              "&:hover": {
                backgroundColor: darkMode
                  ? "rgba(144, 202, 249, 0.16)"
                  : "rgba(25, 118, 210, 0.12)",
              },
            },
            // 聚焦状态
            "&.Mui-focusVisible": {
              backgroundColor: darkMode
                ? "rgba(144, 202, 249, 0.12)"
                : "rgba(25, 118, 210, 0.08)",
            },
          },
        },
      },

      // 统一标签页样式
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: "none",
            fontWeight: 500,
            borderRadius: "8px 8px 0 0",
            transition: "all 0.2s ease",
            "&:hover": {
              backgroundColor: darkMode
                ? "rgba(255,255,255,0.08)"
                : "rgba(0,0,0,0.04)",
            },
            "&.Mui-selected": {
              fontWeight: 600,
            },
          },
        },
      },

      // 统一标签页容器样式
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 3,
            borderRadius: "1.5px 1.5px 0 0",
          },
        },
      },

      // 统一开关样式
      MuiSwitch: {
        styleOverrides: {
          root: {
            "& .MuiSwitch-switchBase.Mui-checked": {
              color: darkMode ? "#90caf9" : "#1976d2",
              "& + .MuiSwitch-track": {
                backgroundColor: darkMode ? "#90caf9" : "#1976d2",
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

      // 统一滑块样式
      MuiSlider: {
        styleOverrides: {
          root: {
            "& .MuiSlider-thumb": {
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)",
              "&:hover, &.Mui-focusVisible": {
                boxShadow: `0 0 0 8px ${darkMode ? "rgba(144, 202, 249, 0.16)" : "rgba(25, 118, 210, 0.16)"}`,
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
