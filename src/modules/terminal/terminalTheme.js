/**
 * WebTerminal xterm theme builder.
 * Keeps the pre-existing GitHub/VS Code–inspired palette (no surface redesign).
 */

export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.0;
export const MIN_TERMINAL_LINE_HEIGHT = 1.0;
export const MAX_TERMINAL_LINE_HEIGHT = 1.4;

/**
 * Clamp and normalize terminal line height for xterm options.
 * @param {unknown} value
 * @returns {number}
 */
export const normalizeTerminalLineHeight = (value) => {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return DEFAULT_TERMINAL_LINE_HEIGHT;
  }
  const clamped = Math.min(
    MAX_TERMINAL_LINE_HEIGHT,
    Math.max(MIN_TERMINAL_LINE_HEIGHT, raw),
  );
  // Keep one decimal place for stable xterm geometry.
  return Math.round(clamped * 100) / 100;
};

/**
 * Build an xterm.js theme object for the given mode.
 * Colors match the historical WebTerminal palette (before d52c38e surface redesign).
 * @param {"light"|"dark"} mode
 * @returns {Record<string, string|undefined>}
 */
export const getTerminalTheme = (mode = "dark") => {
  const isLight = mode === "light";

  return {
    // 现代化背景色 - 深色更深，浅色更柔和
    background: isLight ? "#f6f8fa" : "#1e1e1e",
    // 文本颜色 - 提高对比度
    foreground: isLight ? "#24292f" : "#e6edf3",
    // 光标颜色 - 更醒目
    cursor: isLight ? "#0969da" : "#58a6ff",
    cursorAccent: isLight ? "#f3f4f6" : "#0d1117",
    // 选择高亮 - 优化可见度，日间和夜间模式下都有足够的对比度
    selectionBackground: isLight
      ? "rgba(79, 126, 255, 0.43)"
      : "rgba(212, 253, 62, 0.49)",
    selectionForeground: undefined,
    // ANSI颜色 - 现代化配色方案（参考GitHub/VSCode主题）
    black: isLight ? "#24292f" : "#484f58",
    red: isLight ? "#cf222e" : "#ff7b72",
    green: isLight ? "#116329" : "#3fb950",
    yellow: isLight ? "#9a6700" : "#d29922",
    blue: isLight ? "#0969da" : "#58a6ff",
    magenta: isLight ? "#8250df" : "#bc8cff",
    cyan: isLight ? "#1b7c83" : "#39c5cf",
    white: isLight ? "#6e7781" : "#b1bac4",
    // 亮色版本 - 更高饱和度
    brightBlack: isLight ? "#57606a" : "#6e7681",
    brightRed: isLight ? "#d1242f" : "#ffa198",
    brightGreen: isLight ? "#1a7f37" : "#56d364",
    brightYellow: isLight ? "#bf8700" : "#e3b341",
    brightBlue: isLight ? "#218bff" : "#79c0ff",
    brightMagenta: isLight ? "#a371f7" : "#d2a8ff",
    brightCyan: isLight ? "#3192aa" : "#56d4dd",
    brightWhite: isLight ? "#8c959f" : "#f0f6fc",
  };
};
