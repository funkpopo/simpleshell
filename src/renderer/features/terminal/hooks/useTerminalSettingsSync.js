import { useCallback, useEffect } from "react";
import {
  normalizeTerminalLineHeight,
  DEFAULT_TERMINAL_LINE_HEIGHT,
  DEFAULT_TERMINAL_THEME,
  getTerminalTheme,
  normalizeTerminalThemeId,
} from "../model/terminalTheme.js";
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from "../../../../shared/domain/terminalScrollback.js";
import { getTerminalFontFamily } from "../../../shared/lib/fonts.js";
import { terminalCache } from "../runtime/terminalSessionStore.js";
import {
  applyTerminalUiOptionsToInstance,
  ensureTerminalDiagnostics,
  shouldEnableTerminalPerfMonitor,
} from "../runtime/terminalBootstrap.js";
import {
  normalizePerformanceSettings,
  normalizeTerminalUiSettings,
} from "../../../../shared/settings/uiSettingsDefaults.js";

/** Positive integer from a settings value, or null when absent/invalid. */
const parsePositiveInt = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/**
 * Loads persisted font/renderer settings for new terminals (`getFontSettings`)
 * and applies live `settingsChanged` updates to the cached terminal.
 */
export function useTerminalSettingsSync({
  sessionKey,
  terminalRef,
  termRef,
  fitAddonRef,
  scrollbackUsageTrackerRef,
  performanceMonitorRef,
  webglRendererEnabledRef,
  setWebglRendererEnabled,
  tryEnableWebglRenderer,
  disableWebglRenderer,
  eventManager,
  scheduleTerminalLayoutSyncRef,
  themeModeRef,
  terminalThemeRef,
}) {
  const getFontSettings = useCallback(async () => {
    try {
      if (window.terminalAPI?.loadUISettings) {
        const settings = await window.terminalAPI.loadUISettings();
        const hardwareOn =
          settings?.performance?.hardwareAcceleration !== false;
        const enabled =
          hardwareOn && settings?.performance?.webglEnabled !== false;
        // setWebglRendererEnabled 已被 WebTerminal 包装：同时尊重设置项与
        // 分屏窗格数（allowWebgl）并同步 ref
        setWebglRendererEnabled(enabled);
        // 单一来源：默认值与夹取范围见 model/terminalScrollback.js
        const terminalScrollbackLines = normalizeTerminalScrollbackLines(
          settings.terminalScrollbackLines,
        );
        const terminalUi = normalizeTerminalUiSettings(settings);
        const perfUi = normalizePerformanceSettings(settings);
        if (terminalThemeRef) {
          terminalThemeRef.current = terminalUi.terminalTheme;
        }
        return {
          fontSize: settings.terminalFontSize || 14,
          fontFamily: getTerminalFontFamily(
            settings.terminalFont || "Fira Code",
          ),
          fontWeight: settings.terminalFontWeight || 500,
          lineHeight: normalizeTerminalLineHeight(settings.terminalLineHeight),
          terminalTheme: terminalUi.terminalTheme,
          terminalScrollbackLines,
          cursorStyle: terminalUi.cursorStyle,
          cursorBlink: terminalUi.cursorBlink,
          letterSpacing: terminalUi.letterSpacing,
          fontWeightBold: terminalUi.fontWeightBold,
          copyOnSelect: terminalUi.copyOnSelect,
          rightClickSelectsWord: terminalUi.rightClickSelectsWord,
          middleClickPaste: terminalUi.middleClickPaste,
          macOptionIsMeta: terminalUi.macOptionIsMeta,
          terminalPerfMonitor: perfUi.terminalPerfMonitor,
        };
      }
    } catch {
      // Failed to load font settings from config
    }
    setWebglRendererEnabled(true);
    const defaults = normalizeTerminalUiSettings({});
    return {
      fontSize: 14,
      fontFamily: getTerminalFontFamily("Fira Code"),
      fontWeight: 500,
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
      terminalTheme: DEFAULT_TERMINAL_THEME,
      terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
      cursorStyle: defaults.cursorStyle,
      cursorBlink: defaults.cursorBlink,
      letterSpacing: defaults.letterSpacing,
      fontWeightBold: defaults.fontWeightBold,
      copyOnSelect: defaults.copyOnSelect,
      rightClickSelectsWord: defaults.rightClickSelectsWord,
      middleClickPaste: defaults.middleClickPaste,
      macOptionIsMeta: defaults.macOptionIsMeta,
      terminalPerfMonitor: false,
    };
  }, [setWebglRendererEnabled, webglRendererEnabledRef]);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = async (event) => {
      const detail = event.detail || {};
      const {
        terminalFontSize,
        terminalFont,
        terminalFontWeight,
        terminalLineHeight,
        terminalTheme,
        performance,
        terminalScrollbackLines,
        terminalCursorStyle,
        terminalCursorBlink,
        terminalLetterSpacing,
        terminalFontWeightBold,
        terminalCopyOnSelect,
        terminalRightClickSelectsWord,
        terminalMiddleClickPaste,
        terminalMacOptionIsMeta,
      } = detail;

      if (terminalScrollbackLines !== undefined) {
        // 单一来源：与设置项/终端创建共享同一夹取函数，避免漂移
        const scrollLines = normalizeTerminalScrollbackLines(
          terminalScrollbackLines,
        );
        if (terminalCache[sessionKey]) {
          terminalCache[sessionKey].options.scrollback = scrollLines;
        }
        if (scrollbackUsageTrackerRef.current) {
          scrollbackUsageTrackerRef.current.maxLines = scrollLines;
        }
      }

      if (
        performance &&
        Object.prototype.hasOwnProperty.call(performance, "terminalPerfMonitor")
      ) {
        const monitorOn = Boolean(performance.terminalPerfMonitor);
        if (
          monitorOn &&
          performanceMonitorRef &&
          !performanceMonitorRef.current
        ) {
          ensureTerminalDiagnostics({
            performanceMonitorRef,
            scrollbackUsageTrackerRef,
            perfMonitorEnabled: true,
          });
        } else if (
          !monitorOn &&
          !shouldEnableTerminalPerfMonitor(false) &&
          performanceMonitorRef?.current
        ) {
          performanceMonitorRef.current.destroy?.();
          performanceMonitorRef.current = null;
        }
      }

      if (
        performance &&
        (Object.prototype.hasOwnProperty.call(performance, "webglEnabled") ||
          Object.prototype.hasOwnProperty.call(
            performance,
            "hardwareAcceleration",
          ))
      ) {
        const hardwareOn = performance.hardwareAcceleration !== false;
        const enabled = hardwareOn && performance.webglEnabled !== false;
        setWebglRendererEnabled(enabled);
        if (termRef.current) {
          if (enabled) {
            tryEnableWebglRenderer(termRef.current);
          } else {
            disableWebglRenderer(termRef.current);
          }
        }
      }

      const cachedTerminal = terminalCache[sessionKey];
      if (cachedTerminal) {
        // 无效数值（NaN）不写入 xterm，保留当前值
        const fontSize = parsePositiveInt(terminalFontSize);
        if (fontSize !== null) {
          cachedTerminal.options.fontSize = fontSize;
        }
        if (terminalFont !== undefined) {
          cachedTerminal.options.fontFamily =
            getTerminalFontFamily(terminalFont);
        }
        const fontWeight = parsePositiveInt(terminalFontWeight);
        if (fontWeight !== null) {
          cachedTerminal.options.fontWeight = fontWeight;
        }
        if (terminalLineHeight !== undefined) {
          cachedTerminal.options.lineHeight =
            normalizeTerminalLineHeight(terminalLineHeight);
        }
        if (terminalTheme !== undefined) {
          const nextTheme = normalizeTerminalThemeId(terminalTheme);
          if (terminalThemeRef) {
            terminalThemeRef.current = nextTheme;
          }
          cachedTerminal.options.theme = getTerminalTheme(
            themeModeRef?.current || "dark",
            nextTheme,
          );
        }

        const hasTerminalUiUpdates =
          terminalCursorStyle !== undefined ||
          terminalCursorBlink !== undefined ||
          terminalLetterSpacing !== undefined ||
          terminalFontWeightBold !== undefined ||
          terminalCopyOnSelect !== undefined ||
          terminalRightClickSelectsWord !== undefined ||
          terminalMiddleClickPaste !== undefined ||
          terminalMacOptionIsMeta !== undefined;
        if (hasTerminalUiUpdates) {
          const normalizedUi = normalizeTerminalUiSettings(detail);
          if (terminalCursorStyle === undefined) {
            normalizedUi.cursorStyle = cachedTerminal.options.cursorStyle;
          }
          if (terminalCursorBlink === undefined) {
            normalizedUi.cursorBlink = cachedTerminal.options.cursorBlink;
          }
          if (terminalLetterSpacing === undefined) {
            normalizedUi.letterSpacing = cachedTerminal.options.letterSpacing;
          }
          if (terminalFontWeightBold === undefined) {
            normalizedUi.fontWeightBold = cachedTerminal.options.fontWeightBold;
          }
          if (terminalCopyOnSelect === undefined) {
            normalizedUi.copyOnSelect = cachedTerminal.options.copyOnSelect;
          }
          if (terminalRightClickSelectsWord === undefined) {
            normalizedUi.rightClickSelectsWord =
              cachedTerminal.options.rightClickSelectsWord;
          }
          if (terminalMiddleClickPaste === undefined) {
            normalizedUi.middleClickPaste =
              cachedTerminal.__simpleShellMiddleClickPaste !== false;
          }
          if (terminalMacOptionIsMeta === undefined) {
            normalizedUi.macOptionIsMeta =
              cachedTerminal.options.macOptionIsMeta;
          }
          applyTerminalUiOptionsToInstance(cachedTerminal, normalizedUi);
        }

        // 字体选项随时写入缓存终端；重新布局需要已挂载且 fitAddon 就绪
        if (terminalRef.current && fitAddonRef.current) {
          eventManager.setTimeout(() => {
            scheduleTerminalLayoutSyncRef.current("theme-updated");
          }, 100);
        }
      }
    };

    const handleSetTerminalTheme = (event) => {
      const detail = event?.detail || {};
      const rawTheme = detail.terminalTheme ?? detail.themeId;
      if (!rawTheme) {
        return;
      }
      const nextTheme = normalizeTerminalThemeId(rawTheme);
      if (terminalThemeRef) {
        terminalThemeRef.current = nextTheme;
      }
      const cachedTerminal = terminalCache[sessionKey];
      if (cachedTerminal) {
        cachedTerminal.options.theme = getTerminalTheme(
          themeModeRef?.current || "dark",
          nextTheme,
        );
      }
    };

    const removeSettingsChangedListener = eventManager.addEventListener(
      window,
      "settingsChanged",
      handleSettingsChanged,
    );
    const removeTerminalThemeListener = eventManager.addEventListener(
      window,
      "simpleshell:setTerminalTheme",
      handleSetTerminalTheme,
    );

    return () => {
      removeSettingsChangedListener();
      removeTerminalThemeListener();
    };
  }, [
    sessionKey,
    eventManager,
    disableWebglRenderer,
    tryEnableWebglRenderer,
    fitAddonRef,
    scheduleTerminalLayoutSyncRef,
    scrollbackUsageTrackerRef,
    performanceMonitorRef,
    setWebglRendererEnabled,
    termRef,
    terminalRef,
    webglRendererEnabledRef,
    themeModeRef,
    terminalThemeRef,
  ]);

  return getFontSettings;
}
