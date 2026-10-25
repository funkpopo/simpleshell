const { isPromptReadyFromTerminal } = require("./promptDetection.js");

const normalizeCommandSuggestionInput = (input = "") =>
  String(input ?? "").trim();

const shouldRequestCommandSuggestions = (input = "") =>
  normalizeCommandSuggestionInput(input).length >= 1;

// xterm emits CSI in normal cursor mode and SS3 in application cursor mode.
const isHistoryNavigationInput = (data = "") =>
  typeof data === "string" && /^\u001b(?:\[[0-9;]*|O)[AB]$/.test(data);

const HISTORY_EDITING_INPUTS = new Set([
  "\b",
  "\x7f",
  "\x03",
  "\r",
  "\n",
  "\t",
  "\x15",
  "\x17",
  "\x0b",
  "\x04",
  "\x14",
  "\x19",
  "\x1b[3~",
]);

const shouldResumeSuggestionsAfterHistory = (data = "") =>
  typeof data === "string" &&
  data.length > 0 &&
  (!/[\u0000-\u001f\u007f]/.test(data) ||
    HISTORY_EDITING_INPUTS.has(data) ||
    data.includes("\u001b[200~"));

const isSuggestionTrackingContext = (term, { inEditorMode = false } = {}) => {
  if (!term || inEditorMode) {
    return false;
  }

  return term?.buffer?.active?.type !== "alternate";
};

const isPlainTextTerminalInput = (data = "") => {
  if (typeof data !== "string" || data.length !== 1) {
    return false;
  }

  return !/[\u0000-\u001f\u007f]/.test(data);
};

const shouldResumePromptTrackingOnInput = ({
  term,
  inEditorMode = false,
  data = "",
} = {}) =>
  isSuggestionTrackingContext(term, { inEditorMode }) &&
  isPromptReadyFromTerminal(term) &&
  isPlainTextTerminalInput(data);

const shouldDisplayCommandSuggestions = ({
  showSuggestions = false,
  suggestions = [],
  currentInput = "",
  inEditorMode = false,
  isCommandExecuting = false,
} = {}) =>
  Boolean(showSuggestions) &&
  Array.isArray(suggestions) &&
  suggestions.length > 0 &&
  shouldRequestCommandSuggestions(currentInput) &&
  !inEditorMode &&
  !isCommandExecuting;

const shouldIgnoreCommandSuggestionKeyEvent = (event = {}) =>
  event?.isComposing === true ||
  event?.keyCode === 229 ||
  event?.key === "Process" ||
  event?.key === "Unidentified" ||
  event?.key === "Dead" ||
  event?.key === "Shift" ||
  event?.key === "AltGraph" ||
  event?.key === "ModeChange" ||
  event?.key === "Convert" ||
  event?.key === "NonConvert" ||
  event?.key === "HangulMode" ||
  event?.key === "HanjaMode" ||
  event?.key === "KanaMode" ||
  event?.key === "KanjiMode";

/**
 * 光标是否位于输入末尾（其后没有字符）。在行中间编辑时弹出建议，选中后按
 * 当前输入长度发送退格会从光标处删字，破坏整行，因此这种情况下不提示。
 * 无法读取缓冲区时返回 true，保持原有行为。
 */
const isCursorAtInputEnd = (term) => {
  const active = term?.buffer?.active;
  if (!active || typeof active.getLine !== "function") {
    return true;
  }

  const { cursorX, cursorY } = active;
  if (!Number.isFinite(cursorX) || !Number.isFinite(cursorY)) {
    return true;
  }

  const row = (active.baseY || 0) + cursorY;
  const line = active.getLine(row);
  if (!line || typeof line.translateToString !== "function") {
    return true;
  }

  const fullText = line.translateToString(true);
  if (fullText.length > cursorX && line.translateToString(true, cursorX)) {
    return false;
  }

  // 输入折行到下一行时，光标后面还有内容
  const nextLine = active.getLine(row + 1);
  return !(nextLine?.isWrapped && nextLine.translateToString(true));
};

const CURSOR_MOVE_KEYS = new Set(["ArrowLeft", "ArrowRight", "Home", "End"]);

/**
 * 建议弹窗的键盘语义（纯函数，便于测试）：
 * - 朝弹窗方向的方向键进入/在列表中移动（弹窗在下方为 ↓，在上方为 ↑），到底不回绕；
 * - 反方向键在首项时退回输入行，未选中时原样交给 shell（不劫持历史命令）；
 * - Enter / Delete 仅在已用方向键选中某项时生效，否则照常输入；
 * - 左右移动光标会关闭弹窗并放行按键；带修饰键的组合一律放行。
 */
const resolveCommandSuggestionKeyAction = ({
  key,
  selectedIndex = -1,
  count = 0,
  showAbove = false,
  ctrlKey = false,
  altKey = false,
  metaKey = false,
  shiftKey = false,
} = {}) => {
  if (count <= 0 || ctrlKey || altKey || metaKey || shiftKey) {
    return { type: "pass" };
  }

  const hasSelection = selectedIndex >= 0 && selectedIndex < count;
  const towardKey = showAbove ? "ArrowUp" : "ArrowDown";
  const awayKey = showAbove ? "ArrowDown" : "ArrowUp";

  switch (key) {
    case towardKey:
      return {
        type: "move",
        index: hasSelection ? Math.min(selectedIndex + 1, count - 1) : 0,
      };
    case awayKey:
      return hasSelection
        ? { type: "move", index: selectedIndex - 1 }
        : { type: "pass" };
    case "Enter":
      return hasSelection
        ? { type: "accept", index: selectedIndex }
        : { type: "pass" };
    case "Delete":
      return hasSelection
        ? { type: "remove", index: selectedIndex }
        : { type: "pass" };
    case "Escape":
      return { type: "close" };
    default:
      return CURSOR_MOVE_KEYS.has(key) ? { type: "dismiss" } : { type: "pass" };
  }
};

module.exports = {
  isCursorAtInputEnd,
  resolveCommandSuggestionKeyAction,
  normalizeCommandSuggestionInput,
  shouldRequestCommandSuggestions,
  isHistoryNavigationInput,
  shouldResumeSuggestionsAfterHistory,
  isSuggestionTrackingContext,
  shouldResumePromptTrackingOnInput,
  shouldDisplayCommandSuggestions,
  shouldIgnoreCommandSuggestionKeyEvent,
};
