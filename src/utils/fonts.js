// 等宽字体族常量与终端字体族映射，供终端/编辑器/命令建议等组件共享

export const FIRA_CODE_FONT_FAMILY =
  '"Fira Code", "Consolas", "Monaco", "Courier New", monospace';

export const SPACE_MONO_FONT_FAMILY =
  '"Space Mono", "Consolas", "Monaco", "Courier New", monospace';

export const CONSOLAS_FONT_FAMILY =
  '"Consolas", "Monaco", "Courier New", monospace';

const TERMINAL_FONT_FAMILY_MAP = Object.freeze({
  "Fira Code": FIRA_CODE_FONT_FAMILY,
  "Space Mono": SPACE_MONO_FONT_FAMILY,
  Consolas: CONSOLAS_FONT_FAMILY,
});

// 根据字体名称生成完整的字体族字符串（未知字体回退到 Fira Code）
export const getTerminalFontFamily = (fontName) =>
  TERMINAL_FONT_FAMILY_MAP[fontName] || TERMINAL_FONT_FAMILY_MAP["Fira Code"];
