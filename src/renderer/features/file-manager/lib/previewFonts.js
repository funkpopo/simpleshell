import {
  CONSOLAS_FONT_FAMILY,
  FIRA_CODE_FONT_FAMILY,
  SPACE_MONO_FONT_FAMILY,
} from "../../../shared/lib/fonts.js";

export const normalizeEditorFontSetting = (fontSetting) => {
  if (!fontSetting || typeof fontSetting !== "string") {
    return "system";
  }

  const normalized = fontSetting.trim().toLowerCase();
  switch (normalized) {
    case "fira code":
    case "fira-code":
      return "fira-code";
    case "space mono":
    case "space-mono":
      return "space-mono";
    case "consolas":
      return "consolas";
    case "system":
    default:
      return "system";
  }
};

// 获取字体族名称
export const getFontFamily = (fontSetting) => {
  switch (normalizeEditorFontSetting(fontSetting)) {
    case "fira-code":
      return FIRA_CODE_FONT_FAMILY;
    case "consolas":
      return CONSOLAS_FONT_FAMILY;
    case "space-mono":
      return SPACE_MONO_FONT_FAMILY;
    case "system":
    default:
      return CONSOLAS_FONT_FAMILY;
  }
};

export const resolveGlobalEditorFontSetting = (settings) => {
  if (!settings || typeof settings !== "object") {
    return "system";
  }

  const normalizedEditorFont = normalizeEditorFontSetting(settings.editorFont);
  if (settings.editorFont && normalizedEditorFont !== "system") {
    return normalizedEditorFont;
  }

  return settings.terminalFont || normalizedEditorFont;
};
