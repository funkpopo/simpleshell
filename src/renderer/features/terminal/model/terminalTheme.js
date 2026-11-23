/**
 * WebTerminal xterm theme builder and curated high-contrast ANSI 16-color presets.
 */
import {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_OPTIONS,
  normalizeTerminalThemeId,
  FIXED_PRESET_PALETTES,
  TERMINAL_THEME_PRESETS,
  getTerminalThemePreset,
} from "../../../../shared/settings/terminalThemePresets.js";

// Historical GitHub/VSCode-inspired palettes for default-auto
const DEFAULT_LIGHT_PALETTE = {
  background: "#f6f8fa",
  foreground: "#24292f",
  cursor: "#0969da",
  cursorAccent: "#f3f4f6",
  selectionBackground: "rgba(79, 126, 255, 0.43)",
  black: "#24292f",
  red: "#cf222e",
  green: "#116329",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#6e7781",
  brightBlack: "#57606a",
  brightRed: "#d1242f",
  brightGreen: "#1a7f37",
  brightYellow: "#bf8700",
  brightBlue: "#218bff",
  brightMagenta: "#a371f7",
  brightCyan: "#3192aa",
  brightWhite: "#8c959f",
};

const DEFAULT_DARK_PALETTE = {
  background: "#1e1e1e",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  cursorAccent: "#0d1117",
  selectionBackground: "rgba(212, 253, 62, 0.49)",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

export const DEFAULT_TERMINAL_LINE_HEIGHT = 1.0;
// 行高夹取范围（仅 normalizeTerminalLineHeight 内部使用）
const MIN_TERMINAL_LINE_HEIGHT = 1.0;
const MAX_TERMINAL_LINE_HEIGHT = 1.4;

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
  // Keep two decimal places for stable xterm geometry.
  return Math.round(clamped * 100) / 100;
};

const SCROLLBAR_DARK = {
  scrollbarSliderBackground: "rgba(180, 180, 180, 0.34)",
  scrollbarSliderHoverBackground: "rgba(200, 200, 200, 0.55)",
  scrollbarSliderActiveBackground: "rgba(216, 216, 216, 0.68)",
};

const SCROLLBAR_LIGHT = {
  scrollbarSliderBackground: "rgba(96, 96, 96, 0.3)",
  scrollbarSliderHoverBackground: "rgba(96, 96, 96, 0.48)",
  scrollbarSliderActiveBackground: "rgba(96, 96, 96, 0.64)",
};

const buildThemeSurface = (palette, isLight) => ({
  ...palette,
  selectionForeground: undefined,
  ...(isLight ? SCROLLBAR_LIGHT : SCROLLBAR_DARK),
  overviewRulerBorder: "transparent",
});

/**
 * Build an xterm.js theme object for the given app mode ("light"|"dark") and
 * optional curated terminal theme preset ID. Unknown preset IDs fall back to
 * `default-auto`.
 * @param {"light"|"dark"|string} [mode]
 * @param {string} [presetId]
 * @returns {Record<string, string|undefined>}
 */
export const getTerminalTheme = (
  mode = "dark",
  presetId = DEFAULT_TERMINAL_THEME,
) => {
  let effectiveMode = mode === "light" ? "light" : "dark";
  let effectivePreset = presetId;

  // Allow single-arg calls like getTerminalTheme("dracula") while preserving
  // historical getTerminalTheme("light" | "dark") calls.
  if (
    presetId === DEFAULT_TERMINAL_THEME &&
    typeof mode === "string" &&
    mode !== "light" &&
    mode !== "dark"
  ) {
    effectivePreset = mode;
    effectiveMode = "dark";
  }

  const normalizedId = normalizeTerminalThemeId(effectivePreset);
  if (normalizedId === DEFAULT_TERMINAL_THEME) {
    const isLight = effectiveMode === "light";
    return buildThemeSurface(
      isLight ? DEFAULT_LIGHT_PALETTE : DEFAULT_DARK_PALETTE,
      isLight,
    );
  }

  const preset = FIXED_PRESET_PALETTES[normalizedId];
  if (!preset) {
    const isLight = effectiveMode === "light";
    return buildThemeSurface(
      isLight ? DEFAULT_LIGHT_PALETTE : DEFAULT_DARK_PALETTE,
      isLight,
    );
  }

  return buildThemeSurface(preset.palette, preset.isLight);
};

export {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_OPTIONS,
  normalizeTerminalThemeId,
  TERMINAL_THEME_PRESETS,
  getTerminalThemePreset,
};
