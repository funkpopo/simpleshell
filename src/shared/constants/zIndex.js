/**
 * 集中式 z-index 层级常量表。
 *
 * 层级顺序（低 → 高）：
 *   局部控件、侧栏、终端叠层和全局浮层均由本表定义；
 *   floatWindow < modal < modalRaised < snackbar < lockscreen < themeSwitch
 *
 * 约束：
 * - 浮动窗口（AI 聊天 / 传输）必须始终低于 modal，避免盖住后打开的对话框；
 * - 主密码锁屏是安全语义，必须高于 snackbar 等一切可交互 UI；
 * - 主题切换遮罩为全屏瞬时动画，须覆盖一切。
 */
const Z_INDEX = Object.freeze({
  backgroundDecoration: -2,
  base: 0,
  raised: 1,
  control: 2,
  resizeCorner: 3,
  paneHeader: 4,
  paneControl: 5,
  terminalSelection: 9,
  terminalCursor: 10,
  terminalNotice: 30,
  paneDropOverlay: 900,
  latencyTooltip: 1000,
  tabDropIndicator: 1002,
  dragGhost: 1190,
  fileDropOverlay: 1150,
  sidebar: 90,
  sidebarLocalTerminal: 91,
  sidebarSecurity: 92,
  sidebarIpQuery: 93,
  sidebarHistory: 94,
  sidebarShortcut: 95,
  sidebarFile: 96,
  sidebarResource: 98,
  sidebarConnection: 99,
  sidebarActive: 101,
  sidebarFileActive: 103,
  sidebarShortcutActive: 104,
  sidebarHistoryActive: 105,
  sidebarIpQueryActive: 106,
  sidebarSecurityActive: 107,
  sidebarLocalTerminalActive: 108,
  sidebarRail: 110,
  sidebarResize: 120,
  popupOffset: 20,
  /** AI 聊天 / 传输等右下角浮动窗口（失去焦点时） */
  floatWindow: 1200,
  /** 最近聚焦的浮动窗口，仍须低于 modal */
  floatWindowActive: 1210,
  /** 终端命令建议弹窗：高于浮动窗口以保证输入时可见 */
  commandSuggestion: 1250,
  /** 标准模态对话框（与 MUI zIndex.modal 一致） */
  modal: 1300,
  /** 需要叠在浮动窗口/其它对话框之上的模态（如 AISettings） */
  modalRaised: 1320,
  /** 隶属于 modalRaised 的弹出层（Select 菜单、其上再叠的确认框） */
  modalPopup: 1340,
  /** 通知 Snackbar（与 MUI zIndex.snackbar 一致） */
  snackbar: 1400,
  /** 主密码锁屏遮罩：高于一切可交互 UI */
  lockscreen: 1500,
  /** 主题切换全屏动画遮罩：瞬时覆盖一切 */
  themeSwitch: 1600,
});

module.exports = { Z_INDEX };
