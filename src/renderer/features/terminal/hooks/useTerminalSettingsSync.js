import { useCallback, useEffect } from "react";
import {
  normalizeTerminalLineHeight,
  DEFAULT_TERMINAL_LINE_HEIGHT,
} from "../model/terminalTheme.js";
import {
  DEFAULT_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from "../model/terminalScrollback.js";
import { getTerminalFontFamily } from "../../../shared/lib/fonts.js";
import { terminalCache } from "../runtime/terminalSessionStore.js";

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
  webglRendererEnabledRef,
  setWebglRendererEnabled,
  tryEnableWebglRenderer,
  disableWebglRenderer,
  eventManager,
  scheduleTerminalLayoutSyncRef,
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
        return {
          fontSize: settings.terminalFontSize || 14,
          fontFamily: getTerminalFontFamily(
            settings.terminalFont || "Fira Code",
          ),
          fontWeight: settings.terminalFontWeight || 500,
          lineHeight: normalizeTerminalLineHeight(settings.terminalLineHeight),
          terminalScrollbackLines,
        };
      }
    } catch {
      // Failed to load font settings from config
    }
    setWebglRendererEnabled(true);
    return {
      fontSize: 14,
      fontFamily: getTerminalFontFamily("Fira Code"),
      fontWeight: 500,
      lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
      terminalScrollbackLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
    };
  }, [setWebglRendererEnabled, webglRendererEnabledRef]);

  // 监听设置变更事件
  useEffect(() => {
    const handleSettingsChanged = async (event) => {
      const {
        terminalFontSize,
        terminalFont,
        terminalFontWeight,
        terminalLineHeight,
        performance,
        terminalScrollbackLines,
      } = event.detail;

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

        // 字体选项随时写入缓存终端；重新布局需要已挂载且 fitAddon 就绪
        if (terminalRef.current && fitAddonRef.current) {
          eventManager.setTimeout(() => {
            scheduleTerminalLayoutSyncRef.current("theme-updated");
          }, 100);
        }
      }
    };

    const removeSettingsChangedListener = eventManager.addEventListener(
      window,
      "settingsChanged",
      handleSettingsChanged,
    );

    return () => {
      removeSettingsChangedListener();
    };
  }, [
    sessionKey,
    eventManager,
    disableWebglRenderer,
    tryEnableWebglRenderer,
    fitAddonRef,
    scheduleTerminalLayoutSyncRef,
    scrollbackUsageTrackerRef,
    setWebglRendererEnabled,
    termRef,
    terminalRef,
    webglRendererEnabledRef,
  ]);

  return getFontSettings;
}
