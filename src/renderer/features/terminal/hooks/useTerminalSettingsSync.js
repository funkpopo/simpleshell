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

      if (
        terminalRef.current &&
        terminalCache[sessionKey] &&
        fitAddonRef.current
      ) {
        if (terminalFontSize !== undefined) {
          terminalCache[sessionKey].options.fontSize = parseInt(
            terminalFontSize,
            10,
          );
        }
        if (terminalFont !== undefined) {
          terminalCache[sessionKey].options.fontFamily =
            getTerminalFontFamily(terminalFont);
        }
        if (terminalFontWeight !== undefined) {
          terminalCache[sessionKey].options.fontWeight = parseInt(
            terminalFontWeight,
            10,
          );
        }
        if (terminalLineHeight !== undefined) {
          terminalCache[sessionKey].options.lineHeight =
            normalizeTerminalLineHeight(terminalLineHeight);
        }

        eventManager.setTimeout(() => {
          scheduleTerminalLayoutSyncRef.current("theme-updated");
        }, 100);
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
