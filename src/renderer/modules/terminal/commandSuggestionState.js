const normalizeCommandSuggestionInput = (input = "") =>
  String(input ?? "").trim();

const shouldRequestCommandSuggestions = (input = "") =>
  normalizeCommandSuggestionInput(input).length >= 1;

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
  isSuggestionTrackingContext,
  shouldResumePromptTrackingOnInput,
  shouldDisplayCommandSuggestions,
  shouldIgnoreCommandSuggestionKeyEvent,
};
