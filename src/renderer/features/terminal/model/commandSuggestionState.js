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

module.exports = {
  normalizeCommandSuggestionInput,
  shouldRequestCommandSuggestions,
  isHistoryNavigationInput,
  shouldResumeSuggestionsAfterHistory,
  isSuggestionTrackingContext,
  shouldResumePromptTrackingOnInput,
  shouldDisplayCommandSuggestions,
  shouldIgnoreCommandSuggestionKeyEvent,
};
