export const SIDEBAR_WIDTHS = {
  DEFAULT: 300, // px
  MIN: 240, // px
  MAX: 560, // px
  AI_ASSISTANT: 300, // px
  RESOURCE_MONITOR: 300, // px
  CONNECTION_MANAGER: 300, // px
  FILE_MANAGER: 300, // px
  SHORTCUT_COMMANDS: 300, // px
  COMMAND_HISTORY: 300, // px
  IP_ADDRESS_QUERY: 300, // px
  RANDOM_PASSWORD_GENERATOR: 300, // px
  SECURITY_TOOLS: 300, // px
  LOCAL_TERMINAL_SIDEBAR: 300, // px
  TRANSFER_SIDEBAR: 300, // px - 传输侧边栏宽度
  // 图标轨（Activity Rail）宽度 — 与 --sidebar-rail-width 对齐
  SIDEBAR_BUTTONS_WIDTH: 48, // px
  // 额外安全边距，确保内容不会被遮挡
  SAFETY_MARGIN: 2, // px
  // 废弃的默认边距（保留兼容性）
  DEFAULT_PADDING: 5, //px
};

/** 侧栏面板视觉 token（与 theme-variables.css 同步，供 JS 侧引用） */
export const SIDEBAR_TOKENS = {
  RAIL_WIDTH: 48,
  RAIL_ITEM_GAP: 4,
  ITEM_INSET_X: 6,
  ACTIVE_BORDER_WIDTH: 2,
};

// 底部传输栏高度
export const TRANSFER_BAR_HEIGHT = 56; // px
