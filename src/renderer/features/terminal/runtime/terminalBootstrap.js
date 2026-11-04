import { Terminal } from "@xterm/xterm";
import { TerminalPerformanceMonitor } from "./TerminalPerformanceMonitor.js";
import { ScrollbackUsageTracker } from "./ScrollbackUsageTracker.js";
import { RendererTerminalIOMailbox } from "../io/RendererTerminalIOMailbox.js";
import { registerTerminalIOMailbox } from "./terminalSessionStore.js";
import {
  DEFAULT_TERMINAL_LINE_HEIGHT,
  getTerminalTheme,
} from "../model/terminalTheme.js";
import { DEFAULT_TERMINAL_SCROLLBACK_LINES } from "../model/terminalScrollback.js";
import { FIRA_CODE_FONT_FAMILY } from "../../../shared/lib/fonts.js";
import {
  clearPendingWrappedInputRefresh,
  shouldForceTerminalViewportRefresh,
} from "../lib/terminalHelpers.js";
import { attachWorkingDirectoryTracking } from "../model/workingDirectoryTracking.js";

/**
 * P0：终端性能监控器实例化门控。
 * 仅在开发模式（生产构建下被 DefinePlugin 死代码消除）
 * 或用户显式设置诊断开关（localStorage）时开启。
 */
function shouldEnableTerminalPerfMonitor() {
  if (process.env.NODE_ENV === "development") {
    return true;
  }
  try {
    return (
      typeof localStorage !== "undefined" &&
      localStorage.getItem("simpleShell:terminalPerfMonitor") === "1"
    );
  } catch {
    return false;
  }
}

/** Creates a new xterm instance with the fixed-geometry defaults. */
export function createXtermTerminal(themeMode) {
  return new Terminal({
    cursorBlink: true,
    cursorStyle: "block",
    theme: getTerminalTheme(themeMode),
    fontFamily: FIRA_CODE_FONT_FAMILY,
    fontSize: 14,
    fontWeight: 500,
    fontWeightBold: 700,
    scrollback: DEFAULT_TERMINAL_SCROLLBACK_LINES,
    scrollbar: {
      width:
        Number.parseInt(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--app-scrollbar-size",
          ),
          10,
        ) || 8,
      showArrows: false,
    },
    allowTransparency: true,
    cols: 120,
    rows: 30,
    convertEol: true,
    disableStdin: false,
    rightClickSelectsWord: false,
    copyOnSelect: false,
    selectionScrollSpeed: 5,
    fastScrollModifier: "shift",
    letterSpacing: 0,
    lineHeight: DEFAULT_TERMINAL_LINE_HEIGHT,
    macOptionIsMeta: false,
    macOptionClickForcesSelection: false,
  });
}

/** Applies persisted font/scrollback settings once they load (fire-and-forget). */
export function applyStoredFontSettings({
  term,
  getFontSettings,
  scrollbackUsageTrackerRef,
  scheduleTerminalLayoutSyncRef,
}) {
  (async () => {
    try {
      const fontSettings = await getFontSettings();
      term.options.fontSize = fontSettings.fontSize;
      term.options.fontFamily = fontSettings.fontFamily;
      term.options.fontWeight = fontSettings.fontWeight;
      term.options.lineHeight = fontSettings.lineHeight;
      const scrollLines =
        fontSettings.terminalScrollbackLines ||
        DEFAULT_TERMINAL_SCROLLBACK_LINES;
      term.options.scrollback = scrollLines;
      if (scrollbackUsageTrackerRef.current) {
        scrollbackUsageTrackerRef.current.maxLines = scrollLines;
      }
      scheduleTerminalLayoutSyncRef.current("font-settings");
    } catch {
      // Failed to apply font settings
    }
  })();
}

/** Instantiates the optional performance monitor and scrollback tracker. */
export function ensureTerminalDiagnostics({
  performanceMonitorRef,
  scrollbackUsageTrackerRef,
}) {
  if (!performanceMonitorRef.current && shouldEnableTerminalPerfMonitor()) {
    // P0：性能监控器仅在开发模式或显式诊断开关开启时实例化。
    // 生产构建下 DefinePlugin 将 NODE_ENV 置为 production，
    // 本分支被死代码消除：0 interval、0 定时器、0 开销。
    performanceMonitorRef.current = new TerminalPerformanceMonitor({
      enabled: true,
      sampleRate: 100,
      maxHistorySize: 1000,
    });
  }

  // ScrollbackUsageTracker 仅用于向性能监控器喂数据（不保留行内容）。
  // 监控器未实例化时一并跳过，避免生产环境每段输出做逐行字节数统计
  // 的纯浪费 CPU（引用处处有 null guard，跳过创建是安全的）。
  if (!scrollbackUsageTrackerRef.current && performanceMonitorRef.current) {
    scrollbackUsageTrackerRef.current = new ScrollbackUsageTracker({
      maxLines: DEFAULT_TERMINAL_SCROLLBACK_LINES,
      onChange: (info) => {
        if (performanceMonitorRef.current) {
          performanceMonitorRef.current.recordBufferSize(info.bufferSize);
          performanceMonitorRef.current.recordScrollbackUsage(
            info.usagePercent,
          );
        }
      },
    });
  }
}

/**
 * Binds (or rebinds) the session's renderer IO mailbox to `term` and, for SSH
 * sessions, attaches the xterm-owned working-directory tracker once.
 */
export function bindTerminalIOMailbox(
  term,
  {
    sessionKey,
    terminalType,
    sshConfig,
    terminalIOMailboxRef,
    scrollbackUsageTrackerRef,
    performanceMonitorRef,
    inEditorModeRef,
    scheduleTerminalRedrawRef,
  },
) {
  if (
    terminalType === "ssh" &&
    sshConfig &&
    (!sshConfig.protocol || sshConfig.protocol === "ssh")
  ) {
    // The tracker belongs to xterm, not a mailbox binding. Retain OSC
    // precedence and learned host identity when listeners are rebound.
    if (!term.__workingDirectoryTracker) {
      term.__workingDirectoryTracker = attachWorkingDirectoryTracking(
        term,
        sessionKey,
        sshConfig,
      );
    }
  }
  const queueOutputHandler = (data) => {
    if (scrollbackUsageTrackerRef.current) {
      scrollbackUsageTrackerRef.current.addData(data);
    }
  };
  const writeCompleteHandler = ({ data, duration }) => {
    if (performanceMonitorRef.current) {
      performanceMonitorRef.current.recordWrite(data.length, duration);
    }
    // xterm already repaints the rows a write touched. Only the wrapped
    // input erase case needs an explicit full-viewport refresh.
    const forceRefresh = shouldForceTerminalViewportRefresh(
      term,
      inEditorModeRef.current,
    );
    clearPendingWrappedInputRefresh(term);
    if (forceRefresh) {
      scheduleTerminalRedrawRef.current(term, { force: true });
    }
  };

  if (!terminalIOMailboxRef.current) {
    terminalIOMailboxRef.current = new RendererTerminalIOMailbox({
      term,
      onQueueOutput: queueOutputHandler,
      onWriteComplete: writeCompleteHandler,
    });
  } else {
    terminalIOMailboxRef.current.setTerm(term);
    terminalIOMailboxRef.current.updateHandlers({
      onQueueOutput: queueOutputHandler,
      onWriteComplete: writeCompleteHandler,
    });
  }
  registerTerminalIOMailbox(sessionKey, terminalIOMailboxRef.current);
}
