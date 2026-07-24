/**
 * WebTerminal xterm theme builder.
 * Aligns ANSI / surface colors with UI theme tokens (theme-variables.css + MUI palette).
 */

export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.2;
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
 * Colors mirror CSS custom properties under --terminal-*.
 * @param {"light"|"dark"} mode
 * @returns {Record<string, string|undefined>}
 */
export const getTerminalTheme = (mode = "dark") => {
  const isLight = mode === "light";

  if (isLight) {
    return {
      background: "#f3f4f6", // --color-bg-paper
      foreground: "#24292f", // --color-text-primary
      cursor: "#1976d2", // --color-primary-main
      cursorAccent: "#f3f4f6",
      selectionBackground: "rgba(25, 118, 210, 0.28)",
      selectionForeground: undefined,
      selectionInactiveBackground: "rgba(25, 118, 210, 0.16)",
      // ANSI aligned with success/error/warning/info + text tokens
      black: "#24292f",
      red: "#d32f2f", // --color-error
      green: "#2e7d32", // --color-success
      yellow: "#ed6c02", // --color-warning
      blue: "#1976d2", // --color-primary-main
      magenta: "#9c27b0",
      cyan: "#0288d1", // --color-info
      white: "#6e7781",
      brightBlack: "#57606a", // --color-text-secondary
      brightRed: "#ef5350",
      brightGreen: "#43a047",
      brightYellow: "#fb8c00",
      brightBlue: "#42a5f5", // --color-primary-light
      brightMagenta: "#ba68c8",
      brightCyan: "#29b6f6",
      brightWhite: "#8c959f", // --color-text-disabled
    };
  }

  return {
    background: "#1e1e1e", // --color-bg-paper
    foreground: "#e6edf3", // --color-text-primary
    cursor: "#90caf9", // --color-primary-main
    cursorAccent: "#121212",
    selectionBackground: "rgba(144, 202, 249, 0.32)",
    selectionForeground: undefined,
    selectionInactiveBackground: "rgba(144, 202, 249, 0.18)",
    black: "#484f58",
    red: "#f44336", // --color-error
    green: "#4caf50", // --color-success
    yellow: "#ff9800", // --color-warning
    blue: "#90caf9", // --color-primary-main
    magenta: "#ce93d8",
    cyan: "#29b6f6", // --color-info
    white: "#b1bac4",
    brightBlack: "#6e7681",
    brightRed: "#ef9a9a",
    brightGreen: "#81c784",
    brightYellow: "#ffb74d",
    brightBlue: "#bbdefb", // --color-primary-light
    brightMagenta: "#e1bee7",
    brightCyan: "#4fc3f7",
    brightWhite: "#f0f6fc",
  };
};
