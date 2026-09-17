import * as React from "react";
import { useCallback } from "react";
import { createUnifiedTheme } from "../../../theme";
import { useAppState, useAppDispatch } from "../../../store/AppContext.jsx";
import { actions } from "../../../store/appReducer.js";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import { changeLanguage } from "../../../i18n/i18n";
import { useNotification } from "../../../contexts/NotificationContext.jsx";
import {
  DEFAULT_SIDEBAR_WIDTH,
  normalizeSidebarPosition,
  normalizeSidebarWidth,
} from "../appShellUtils.js";
export default function useAppTheme() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const { showError } = useNotification();
  const { t } = useTranslation();
  const [uiSettingsSnapshot, setUiSettingsSnapshot] = React.useState(null);
  const [uiSettingsLoaded, setUiSettingsLoaded] = React.useState(false);
  const darkMode = state.darkMode;
  const themeLoading = state.themeLoading;
  React.useEffect(() => {
    if (darkMode) {
      document.body.classList.add("dark-theme");
      document.body.classList.remove("light-theme");
    } else {
      document.body.classList.add("light-theme");
      document.body.classList.remove("dark-theme");
    }
    document.body.setAttribute(
      "data-mui-color-scheme",
      darkMode ? "dark" : "light",
    );
  }, [darkMode]);
  React.useEffect(() => {
    if (themeLoading || !uiSettingsLoaded) {
      return undefined;
    }
    let cancelled = false;
    let outerRaf = 0;
    let innerRaf = 0;

    // 与 shared/startupTheme.clearStartupThemeBootstrap 保持一致（避免 CJS 动态 import）
    document.body?.classList.remove("ss-bootstrapping");
    document.documentElement?.style.removeProperty("background-color");
    document.body?.style.removeProperty("background-color");
    document.getElementById("root")?.style.removeProperty("background-color");

    // 双 rAF：确保 CssBaseline / 首屏布局已提交到合成器后再 show
    outerRaf = requestAnimationFrame(() => {
      innerRaf = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }
        if (window.terminalAPI?.notifyWindowReady) {
          void window.terminalAPI.notifyWindowReady().catch(() => {
            /* main may already have revealed via fallback timeout */
          });
        }
      });
    });
    return () => {
      cancelled = true;
      if (outerRaf) {
        cancelAnimationFrame(outerRaf);
      }
      if (innerRaf) {
        cancelAnimationFrame(innerRaf);
      }
    };
  }, [themeLoading, uiSettingsLoaded]);
  const [dndEnabled, setDndEnabled] = React.useState(true);
  const [transferBarMode, setTransferBarMode] = React.useState("bottom");
  const [sidebarPosition, setSidebarPosition] = React.useState("right");
  const [sidebarWidth, setSidebarWidth] = React.useState(DEFAULT_SIDEBAR_WIDTH);
  const theme = React.useMemo(() => createUnifiedTheme(darkMode), [darkMode]);
  const toggleTheme = useCallback(
    async (event) => {
      try {
        const newDarkMode = !darkMode;

        // 保存按钮引用，避免在 setTimeout 中访问已失效的 event
        const button = event?.currentTarget;

        // 添加按钮点击动画
        if (button) {
          button.classList.add("theme-button-pulse");
          setTimeout(() => {
            if (button) {
              button.classList.remove("theme-button-pulse");
            }
          }, 300);
        }

        // 创建动画遮罩层
        const overlay = document.createElement("div");
        overlay.className = `theme-switch-overlay ${newDarkMode ? "dark" : "light"}`;
        document.body.appendChild(overlay);

        // 添加主题切换标记，启用过渡效果
        document.body.classList.add("theme-switching");

        // 启动动画
        requestAnimationFrame(() => {
          overlay.classList.add("animating");
        });

        // 立即切换主题状态，使用 startTransition 避免阻塞
        React.startTransition(() => {
          dispatch(actions.setDarkMode(newDarkMode));
        });

        // 动画结束后清理（0.5s 动画时长）
        setTimeout(() => {
          document.body.classList.remove("theme-switching");
          overlay.remove();
        }, 500);

        // 保存主题设置到配置文件
        if (window.terminalAPI?.saveUISettings) {
          // 先获取当前设置，然后更新主题设置
          let currentSettings = {
            language: "zh-CN",
            fontSize: 14,
          };
          try {
            if (window.terminalAPI?.loadUISettings) {
              const loadedSettings = await window.terminalAPI.loadUISettings();
              if (loadedSettings) {
                currentSettings = loadedSettings;
              }
            }
          } catch {
            // 获取当前设置失败，使用默认值
          }

          // 更新主题设置并保存
          const updatedSettings = {
            ...currentSettings,
            darkMode: newDarkMode,
          };
          await window.terminalAPI.saveUISettings(updatedSettings);
        }
      } catch (error) {
        showError(error?.message || t("settings.saveError"));
      }
    },
    [darkMode, dispatch, showError, t],
  );
  const applySettings = useCallback(
    (settings) => {
      const {
        language,
        fontSize,
        darkMode: newDarkMode,
        dnd,
        transferBarMode: newTransferBarMode,
        sidebarPosition: newSidebarPosition,
        sidebarWidth: newSidebarWidth,
        performance: perf,
      } = settings || {};

      // 同步硬件加速标志到 globalTransferStore（不需重启即可影响 RAF 节流路径）
      if (perf && perf.hardwareAcceleration !== undefined) {
        window.__hardwareAccelerationEnabled =
          perf.hardwareAcceleration !== false;
      }

      // React 19: 所有状态更新会自动批处理，提高性能
      // 应用主题设置
      if (newDarkMode !== undefined) {
        dispatch(actions.setDarkMode(newDarkMode));
      }

      // 应用字号设置
      if (fontSize) {
        document.documentElement.style.fontSize = `${fontSize}px`;
      }

      // 应用语言设置
      if (language) {
        // 通过i18n.js中的changeLanguage函数来改变语言
        changeLanguage(language);

        // 基本的HTML语言设置
        document.documentElement.lang = language;
      }

      // 应用 DnD 设置
      if (dnd?.enabled !== undefined) {
        setDndEnabled(dnd.enabled);
      }

      // 应用传输栏模式设置
      if (newTransferBarMode) {
        setTransferBarMode(newTransferBarMode);
      }

      // 应用侧边栏位置设置
      if (newSidebarPosition) {
        setSidebarPosition(normalizeSidebarPosition(newSidebarPosition));
      }

      if (newSidebarWidth !== undefined) {
        setSidebarWidth(normalizeSidebarWidth(newSidebarWidth));
      }
    },
    [dispatch],
  );
  React.useEffect(() => {
    let cancelled = false;
    const pendingUpdates = [];
    let loadingSettings = true;
    const handleSettingsChanged = (event) => {
      if (loadingSettings) pendingUpdates.push(event.detail);
      applySettings(event.detail);
    };
    window.addEventListener("settingsChanged", handleSettingsChanged);
    dispatch(actions.setThemeLoading(true));
    const loadSettings = async () => {
      try {
        const settings = await window.terminalAPI?.loadUISettings?.();
        if (cancelled) return;
        window.__hardwareAccelerationEnabled =
          settings?.performance?.hardwareAcceleration !== false;
        applySettings({ fontSize: 14, ...settings });
        pendingUpdates.forEach(applySettings);
        setUiSettingsSnapshot(Object.assign({}, settings, ...pendingUpdates));
      } catch {
        if (!cancelled && pendingUpdates.length === 0) {
          document.documentElement.style.fontSize = "14px";
          window.__hardwareAccelerationEnabled = true;
        }
      } finally {
        loadingSettings = false;
        if (!cancelled) {
          setUiSettingsLoaded(true);
          dispatch(actions.setThemeLoading(false));
        }
      }
    };
    void loadSettings();
    return () => {
      cancelled = true;
      window.removeEventListener("settingsChanged", handleSettingsChanged);
    };
  }, [dispatch, applySettings]);
  return {
    uiSettingsSnapshot,
    setUiSettingsSnapshot,
    uiSettingsLoaded,
    darkMode,
    themeLoading,
    dndEnabled,
    transferBarMode,
    sidebarPosition,
    setSidebarPosition,
    sidebarWidth,
    setSidebarWidth,
    theme,
    toggleTheme,
  };
}
