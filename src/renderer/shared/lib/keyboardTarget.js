/**
 * Returns true when a keyboard event originated inside an editable DOM field
 * (`INPUT`, `TEXTAREA`, `SELECT`, or `contentEditable`) other than xterm's
 * `.xterm-helper-textarea`.
 * @param {EventTarget | null | undefined} target
 * @returns {boolean}
 */
export function isEditableNonXtermTarget(target) {
  if (!target || typeof target !== "object") {
    return false;
  }
  const el = /** @type {any} */ (target);
  if (el.classList?.contains?.("xterm-helper-textarea")) {
    return false;
  }
  const tagName = el.tagName;
  return Boolean(
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT" ||
    el.isContentEditable,
  );
}
