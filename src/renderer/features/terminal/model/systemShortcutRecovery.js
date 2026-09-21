const SYSTEM_SHORTCUT_RECOVERY_KEYS = Object.freeze(
  new Set([
    "Shift",
    "Alt",
    "AltGraph",
    "ModeChange",
    "Process",
    "Convert",
    "NonConvert",
    "HangulMode",
    "HanjaMode",
    "KanaMode",
    "KanjiMode",
  ]),
);

const getShortcutKey = (eventOrKey) => {
  if (typeof eventOrKey === "string") {
    return eventOrKey;
  }

  return typeof eventOrKey?.key === "string" ? eventOrKey.key : "";
};

const isSystemShortcutRecoveryKey = (eventOrKey) =>
  SYSTEM_SHORTCUT_RECOVERY_KEYS.has(getShortcutKey(eventOrKey));

const shouldArmSystemShortcutRecovery = (
  event,
  { terminalFocused = false } = {},
) => {
  if (!terminalFocused || !event || event.repeat) {
    return false;
  }

  if (event.metaKey) {
    return false;
  }

  if (event.ctrlKey && getShortcutKey(event) !== "AltGraph") {
    return false;
  }

  return isSystemShortcutRecoveryKey(event);
};

module.exports = {
  isSystemShortcutRecoveryKey,
  shouldArmSystemShortcutRecovery,
};
