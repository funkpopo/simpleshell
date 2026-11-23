// @ts-check

const {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_OPTIONS,
  normalizeTerminalThemeId,
} = require("./uiSettingsDefaults");

/**
 * @typedef {Object} TerminalAnsiPalette
 * @property {string} background
 * @property {string} foreground
 * @property {string} cursor
 * @property {string} cursorAccent
 * @property {string} selectionBackground
 * @property {string} black
 * @property {string} red
 * @property {string} green
 * @property {string} yellow
 * @property {string} blue
 * @property {string} magenta
 * @property {string} cyan
 * @property {string} white
 * @property {string} brightBlack
 * @property {string} brightRed
 * @property {string} brightGreen
 * @property {string} brightYellow
 * @property {string} brightBlue
 * @property {string} brightMagenta
 * @property {string} brightCyan
 * @property {string} brightWhite
 */

/** @type {{ background: string, foreground: string, cursor: string, ansi: string[] }} */
const DEFAULT_AUTO_LIGHT_SWATCH = {
  background: "#f6f8fa",
  foreground: "#24292f",
  cursor: "#0969da",
  ansi: ["#cf222e", "#116329", "#9a6700", "#0969da", "#8250df", "#1b7c83"],
};

/** @type {{ background: string, foreground: string, cursor: string, ansi: string[] }} */
const DEFAULT_AUTO_DARK_SWATCH = {
  background: "#1e1e1e",
  foreground: "#e6edf3",
  cursor: "#58a6ff",
  ansi: ["#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf"],
};

/** @type {Record<string, { isLight: boolean, palette: TerminalAnsiPalette }>} */
const FIXED_PRESET_PALETTES = {
  "one-dark": {
    isLight: false,
    palette: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "rgba(82, 139, 255, 0.35)",
      black: "#3f4451",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#dcdfe4",
      brightBlack: "#5c6370",
      brightRed: "#e88388",
      brightGreen: "#a8d18b",
      brightYellow: "#ebd09c",
      brightBlue: "#7ec0f8",
      brightMagenta: "#d48ee8",
      brightCyan: "#6ec7d2",
      brightWhite: "#ffffff",
    },
  },
  dracula: {
    isLight: false,
    palette: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#ff79c6",
      cursorAccent: "#282a36",
      selectionBackground: "rgba(68, 71, 90, 0.72)",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  nord: {
    isLight: false,
    palette: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#88c0d0",
      cursorAccent: "#2e3440",
      selectionBackground: "rgba(136, 192, 208, 0.32)",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#616e88",
      brightRed: "#d06f79",
      brightGreen: "#b1d196",
      brightYellow: "#f0d399",
      brightBlue: "#8cafd2",
      brightMagenta: "#c89ec0",
      brightCyan: "#93ccdc",
      brightWhite: "#eceff4",
    },
  },
  "tokyo-night": {
    isLight: false,
    palette: {
      background: "#1a1b26",
      foreground: "#c0caf5",
      cursor: "#7aa2f7",
      cursorAccent: "#1a1b26",
      selectionBackground: "rgba(51, 70, 124, 0.65)",
      black: "#15161e",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#bb9af7",
      cyan: "#7dcfff",
      white: "#a9b1d6",
      brightBlack: "#565f89",
      brightRed: "#ff899d",
      brightGreen: "#afd67a",
      brightYellow: "#e9c080",
      brightBlue: "#8db4ff",
      brightMagenta: "#cbaeff",
      brightCyan: "#97dcff",
      brightWhite: "#c0caf5",
    },
  },
  "catppuccin-mocha": {
    isLight: false,
    palette: {
      background: "#1e1e2e",
      foreground: "#cdd6f4",
      cursor: "#f5e0dc",
      cursorAccent: "#1e1e2e",
      selectionBackground: "rgba(88, 91, 112, 0.55)",
      black: "#45475a",
      red: "#f38ba8",
      green: "#a6e3a1",
      yellow: "#f9e2af",
      blue: "#89b4fa",
      magenta: "#f5c2e7",
      cyan: "#94e2d5",
      white: "#bac2de",
      brightBlack: "#585b70",
      brightRed: "#f5a1b9",
      brightGreen: "#b8ebb4",
      brightYellow: "#fbeac1",
      brightBlue: "#9dc3fc",
      brightMagenta: "#f7d0ec",
      brightCyan: "#a7eae0",
      brightWhite: "#cdd6f4",
    },
  },
  "catppuccin-latte": {
    isLight: true,
    palette: {
      background: "#eff1f5",
      foreground: "#4c4f69",
      cursor: "#dc8a78",
      cursorAccent: "#eff1f5",
      selectionBackground: "rgba(172, 176, 190, 0.5)",
      black: "#5c5f77",
      red: "#d20f39",
      green: "#40a02b",
      yellow: "#df8e1d",
      blue: "#1e66f5",
      magenta: "#ea76cb",
      cyan: "#179299",
      white: "#6c6f85",
      brightBlack: "#7c7f93",
      brightRed: "#c10d34",
      brightGreen: "#358823",
      brightYellow: "#c97b14",
      brightBlue: "#1857d8",
      brightMagenta: "#c65ba7",
      brightCyan: "#12787e",
      brightWhite: "#4c4f69",
    },
  },
  "gruvbox-dark": {
    isLight: false,
    palette: {
      background: "#282828",
      foreground: "#ebdbb2",
      cursor: "#fe8019",
      cursorAccent: "#282828",
      selectionBackground: "rgba(215, 153, 33, 0.34)",
      black: "#3c3836",
      red: "#cc241d",
      green: "#98971a",
      yellow: "#d79921",
      blue: "#458588",
      magenta: "#b16286",
      cyan: "#689d6a",
      white: "#a89984",
      brightBlack: "#928374",
      brightRed: "#fb4934",
      brightGreen: "#b8bb26",
      brightYellow: "#fabd2f",
      brightBlue: "#83a598",
      brightMagenta: "#d3869b",
      brightCyan: "#8ec07c",
      brightWhite: "#ebdbb2",
    },
  },
  "solarized-dark": {
    isLight: false,
    palette: {
      background: "#002b36",
      foreground: "#93a1a1",
      cursor: "#268bd2",
      cursorAccent: "#002b36",
      selectionBackground: "rgba(38, 139, 210, 0.36)",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#93a1a1",
      brightYellow: "#d4a617",
      brightBlue: "#56a8e2",
      brightMagenta: "#8589d6",
      brightCyan: "#39b7ad",
      brightWhite: "#fdf6e3",
    },
  },
  "solarized-light": {
    isLight: true,
    palette: {
      background: "#fdf6e3",
      foreground: "#586e75",
      cursor: "#268bd2",
      cursorAccent: "#fdf6e3",
      selectionBackground: "rgba(38, 139, 210, 0.28)",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#657b83",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#6c8300",
      brightYellow: "#9c7500",
      brightBlue: "#1e76b6",
      brightMagenta: "#6c71c4",
      brightCyan: "#1f857d",
      brightWhite: "#073642",
    },
  },
};

/**
 * Extract preview swatch colors for settings UI and Command Palette pickers.
 * @param {TerminalAnsiPalette} palette
 * @returns {{ background: string, foreground: string, cursor: string, ansi: string[] }}
 */
function toSwatch(palette) {
  return {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursor,
    ansi: [
      palette.red,
      palette.green,
      palette.yellow,
      palette.blue,
      palette.magenta,
      palette.cyan,
    ],
  };
}

const TERMINAL_THEME_PRESETS = Object.freeze(
  TERMINAL_THEME_OPTIONS.map((id) => {
    if (id === DEFAULT_TERMINAL_THEME) {
      return Object.freeze({
        id,
        appearance: /** @type {const} */ ("auto"),
        swatch: DEFAULT_AUTO_DARK_SWATCH,
        swatchLight: DEFAULT_AUTO_LIGHT_SWATCH,
      });
    }
    const entry = FIXED_PRESET_PALETTES[id];
    return Object.freeze({
      id,
      appearance: entry.isLight
        ? /** @type {const} */ ("light")
        : /** @type {const} */ ("dark"),
      swatch: toSwatch(entry.palette),
    });
  }),
);

/**
 * Look up preset metadata descriptor by theme ID, falling back to default-auto.
 * @param {unknown} presetId
 */
function getTerminalThemePreset(presetId) {
  const normalized = normalizeTerminalThemeId(presetId);
  return (
    TERMINAL_THEME_PRESETS.find((preset) => preset.id === normalized) ||
    TERMINAL_THEME_PRESETS[0]
  );
}

/**
 * Resolve localized display label for a terminal theme preset ID.
 * Uses static i18n keys so strict static translation checks can verify every key.
 * @param {(key: string) => string} t
 * @param {unknown} presetId
 * @returns {string}
 */
function getTerminalThemePresetLabel(t, presetId) {
  switch (normalizeTerminalThemeId(presetId)) {
    case "one-dark":
      return t("settings.terminalThemePresets.oneDark");
    case "dracula":
      return t("settings.terminalThemePresets.dracula");
    case "nord":
      return t("settings.terminalThemePresets.nord");
    case "tokyo-night":
      return t("settings.terminalThemePresets.tokyoNight");
    case "catppuccin-mocha":
      return t("settings.terminalThemePresets.catppuccinMocha");
    case "catppuccin-latte":
      return t("settings.terminalThemePresets.catppuccinLatte");
    case "gruvbox-dark":
      return t("settings.terminalThemePresets.gruvboxDark");
    case "solarized-dark":
      return t("settings.terminalThemePresets.solarizedDark");
    case "solarized-light":
      return t("settings.terminalThemePresets.solarizedLight");
    case "default-auto":
    default:
      return t("settings.terminalThemePresets.defaultAuto");
  }
}

module.exports = {
  DEFAULT_TERMINAL_THEME,
  TERMINAL_THEME_OPTIONS,
  normalizeTerminalThemeId,
  FIXED_PRESET_PALETTES,
  TERMINAL_THEME_PRESETS,
  getTerminalThemePreset,
  getTerminalThemePresetLabel,
};
