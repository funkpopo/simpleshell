import { shouldIgnoreCommandSuggestionKeyEvent } from "../model/commandSuggestionState.js";
import {
  isSystemShortcutRecoveryKey,
  shouldArmSystemShortcutRecovery,
} from "../model/systemShortcutRecovery.js";
import { syncTerminalLinkCtrlState } from "./terminalDom.js";
import { isEditableNonXtermTarget } from "../../../shared/lib/keyboardTarget.js";

export const DEFAULT_TERMINAL_FONT_SIZE = 14;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 30;

const isCtrlOrMetaOnly = (event) =>
  Boolean((event?.ctrlKey || event?.metaKey) && !event?.altKey);

const isCtrlShiftChord = (event, targetKey) =>
  Boolean(
    isCtrlOrMetaOnly(event) &&
    event?.shiftKey &&
    String(event?.key || "").toLowerCase() === targetKey,
  );

export function getTerminalZoomAction(event) {
  if (!event || !isCtrlOrMetaOnly(event)) {
    return null;
  }
  const key = event.key;
  const code = event.code || "";
  if (key === "=" || key === "+" || code === "Equal" || code === "NumpadAdd") {
    return "in";
  }
  if (
    !event.shiftKey &&
    (key === "-" || code === "Minus" || code === "NumpadSubtract")
  ) {
    return "out";
  }
  if (
    !event.shiftKey &&
    (key === "0" || code === "Digit0" || code === "Numpad0")
  ) {
    return "reset";
  }
  return null;
}

export function computeNextTerminalFontSize(currentSize, action) {
  const base = Number.isFinite(Number(currentSize))
    ? Number(currentSize)
    : DEFAULT_TERMINAL_FONT_SIZE;
  if (action === "reset") {
    return DEFAULT_TERMINAL_FONT_SIZE;
  }
  const delta = action === "in" ? 1 : action === "out" ? -1 : 0;
  return Math.min(
    MAX_TERMINAL_FONT_SIZE,
    Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(base + delta)),
  );
}

/**
 * Determines whether xterm.js should process a key event and emit PTY bytes.
 * Returns false for host/application shortcuts (Command Palette, Tab/Split/Focus
 * navigation, Ctrl+Shift+C/V, Zoom, Alt+F1) while explicitly returning true for
 * shell editing chords such as Ctrl+K (kill-line) and Ctrl+C (SIGINT).
 */
export function shouldXtermHandleKeyEvent(event) {
  if (!event) return true;

  if (event.altKey && event.key === "F1") {
    return false;
  }

  // Explicitly preserve Ctrl+K (kill-line) and unshifted Ctrl+C (SIGINT) for shells.
  if (
    event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    ["k", "c"].includes(String(event.key || "").toLowerCase())
  ) {
    return true;
  }

  if (
    isCtrlShiftChord(event, "p") ||
    isCtrlShiftChord(event, "c") ||
    isCtrlShiftChord(event, "v") ||
    isCtrlShiftChord(event, "t") ||
    isCtrlShiftChord(event, "e") ||
    isCtrlShiftChord(event, "h") ||
    isCtrlShiftChord(event, "w")
  ) {
    return false;
  }

  if (event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Tab") {
    return false;
  }

  if (
    isCtrlOrMetaOnly(event) &&
    !event.shiftKey &&
    (/^[1-9]$/.test(String(event.key || "")) ||
      /^Digit[1-9]$/.test(String(event.code || "")))
  ) {
    return false;
  }

  if (
    event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    return false;
  }

  if (getTerminalZoomAction(event) !== null) {
    return false;
  }

  return true;
}

/**
 * Document/window keyboard shortcuts for a terminal (copy/paste/clear/search,
 * suggestion dismissal), link Ctrl state, and focus/visibility/IME driven
 * recovery after system shortcuts. Listeners are owned by `lifecycleManager`.
 * Live UI state is read through `shortcutUiRef` so the handlers never close
 * over mount-time values.
 *
 * Returns `scheduleActivationRecovery` for the container visibility handler.
 */
export function attachTerminalShortcutHandlers({
  term,
  terminalRef,
  lifecycleManager,
  isActiveRef,
  searchAddonRef,
  shortcutUiRef,
  pendingSystemShortcutRecoveryRef,
  recoverTerminalInteractionStateRef,
  recoverTerminalAfterActivation,
  imeCompositionActiveRef,
  markPasteIfAllowedRef,
  handlePasteTextRef,
  clearTerminalRef,
}) {
  const isTerminalShortcutContext = (target) => {
    const helperTextarea = term.element?.querySelector(
      ".xterm-helper-textarea",
    );

    if (helperTextarea) {
      return (
        target === helperTextarea ||
        Boolean(term.element?.contains?.(target)) ||
        document.activeElement === helperTextarea
      );
    }

    return Boolean(target?.classList?.contains?.("xterm-helper-textarea"));
  };

  const isActiveTerminalClipboardContext = (target) => {
    if (!isActiveRef.current) {
      return false;
    }

    if (
      term.element?.contains?.(target) ||
      terminalRef.current?.contains?.(target)
    ) {
      return true;
    }

    if (target?.classList?.contains?.("xterm-helper-textarea")) {
      return !term.element;
    }

    const tagName = target?.tagName;
    if (
      tagName === "INPUT" ||
      tagName === "TEXTAREA" ||
      tagName === "SELECT" ||
      target?.isContentEditable
    ) {
      return false;
    }

    return true;
  };

  const scheduleShortcutRecovery = ({
    delays = [0, 40, 120],
    refocus = true,
    refreshSuggestions = false,
  } = {}) => {
    if (!pendingSystemShortcutRecoveryRef.current) {
      return;
    }

    delays.forEach((delay) => {
      lifecycleManager.setTimeout(() => {
        if (!pendingSystemShortcutRecoveryRef.current) {
          return;
        }

        recoverTerminalInteractionStateRef.current({
          refocus,
          refreshSuggestions,
        });
      }, delay);
    });
  };

  const scheduleActivationRecovery = ({
    delays = [0, 60, 160],
    refreshSuggestions = false,
  } = {}) => {
    delays.forEach((delay) => {
      lifecycleManager.setTimeout(() => {
        if (document.hidden) {
          return;
        }

        recoverTerminalAfterActivation({
          resize: true,
          refocus: true,
          refreshSuggestions,
        });
      }, delay);
    });
  };

  const handleKeyDown = (e) => {
    syncTerminalLinkCtrlState(term, e.ctrlKey);

    if (shouldIgnoreCommandSuggestionKeyEvent(e)) {
      if (
        shouldArmSystemShortcutRecovery(e, {
          terminalFocused: isTerminalShortcutContext(e.target),
        })
      ) {
        pendingSystemShortcutRecoveryRef.current = true;
      }
      return;
    }

    if (
      shouldArmSystemShortcutRecovery(e, {
        terminalFocused: isTerminalShortcutContext(e.target),
      })
    ) {
      pendingSystemShortcutRecoveryRef.current = true;
      return;
    }

    if (e.altKey && e.key === "F1") {
      return;
    }

    const isTerminalInput =
      e.target &&
      e.target.classList &&
      e.target.classList.contains("xterm-helper-textarea");

    if (isTerminalInput) {
      const allowedKeys = [
        "/",
        "Escape",
        "F3",
        ",",
        ".",
        ";",
        "'",
        "g",
        "l",
        "L",
      ];

      const isAllowedKey =
        allowedKeys.includes(e.key) ||
        (e.key === "g" && e.ctrlKey) ||
        (e.key === "/" && e.ctrlKey) ||
        (e.key === "," && e.ctrlKey) ||
        (e.key === "." && e.ctrlKey) ||
        (e.key === ";" && e.ctrlKey) ||
        (e.key === "'" && e.ctrlKey) ||
        (e.key.toLowerCase?.() === "l" && e.ctrlKey) ||
        isCtrlShiftChord(e, "c") ||
        isCtrlShiftChord(e, "v") ||
        getTerminalZoomAction(e) !== null;

      if (!isAllowedKey) {
        return;
      }
    }

    const zoomAction = getTerminalZoomAction(e);
    if (zoomAction) {
      if (!isActiveTerminalClipboardContext(e.target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (typeof shortcutUiRef.current?.onZoom === "function") {
        shortcutUiRef.current.onZoom(zoomAction);
      } else {
        const nextSize = computeNextTerminalFontSize(
          term?.options?.fontSize,
          zoomAction,
        );
        if (term?.options) {
          term.options.fontSize = nextSize;
        }
        window.dispatchEvent(
          new CustomEvent("settingsChanged", {
            detail: { terminalFontSize: nextSize },
          }),
        );
      }
      return;
    }

    if ((e.ctrlKey && e.key === ";") || isCtrlShiftChord(e, "c")) {
      if (!isActiveTerminalClipboardContext(e.target)) {
        return;
      }
      const selection = term.getSelection();
      if (selection) {
        e.preventDefault();
        Promise.resolve(window.clipboardAPI.writeText(selection)).catch(
          () => {},
        );
      }
    } else if ((e.ctrlKey && e.key === "'") || isCtrlShiftChord(e, "v")) {
      if (!isActiveTerminalClipboardContext(e.target)) {
        return;
      }
      e.preventDefault();

      if (!markPasteIfAllowedRef.current()) {
        return;
      }

      Promise.resolve(window.clipboardAPI.readText())
        .then((text) => {
          handlePasteTextRef.current(text);
        })
        .catch(() => {});
    } else if (
      e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "l"
    ) {
      if (!isActiveRef.current || isEditableNonXtermTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      clearTerminalRef.current();
    } else if (e.ctrlKey && e.key === "/") {
      if (!isActiveRef.current || isEditableNonXtermTarget(e.target)) return;

      e.preventDefault();
      e.stopPropagation();
      shortcutUiRef.current.toggleSearchBar?.();
    } else if (e.key === "Escape") {
      const ui = shortcutUiRef.current;
      if (ui.showSearchBar) {
        if (!isActiveRef.current || isEditableNonXtermTarget(e.target)) return;
        e.preventDefault();
        ui.closeSearchBar?.();
      } else if (ui.showSuggestions) {
        if (isEditableNonXtermTarget(e.target)) return;
        e.preventDefault();
        ui.setShowSuggestions?.(false);
        ui.setSuggestions?.([]);
        ui.setSuggestionsHiddenByEsc?.(true);
        ui.setSuggestionsSuppressedUntilEnter?.(true);
        if (ui.suppressionContextRef) {
          ui.suppressionContextRef.current = {
            input: ui.currentInput,
            timestamp: Date.now(),
          };
        }
      }
    } else if (
      (e.key === "F3" && !e.shiftKey) ||
      (e.ctrlKey && e.key === "g") ||
      (e.ctrlKey && e.key === ".")
    ) {
      const ui = shortcutUiRef.current;
      if (searchAddonRef.current && ui.searchTerm) {
        if (!isActiveRef.current || isEditableNonXtermTarget(e.target)) return;
        e.preventDefault();
        ui.handleSearch?.();
      }
    } else if ((e.shiftKey && e.key === "F3") || (e.ctrlKey && e.key === ",")) {
      const ui = shortcutUiRef.current;
      if (searchAddonRef.current && ui.searchTerm) {
        if (!isActiveRef.current || isEditableNonXtermTarget(e.target)) return;
        e.preventDefault();
        ui.handleSearchPrevious?.();
      }
    }
  };

  const handleKeyUp = (e) => {
    syncTerminalLinkCtrlState(term, e.ctrlKey);

    if (
      pendingSystemShortcutRecoveryRef.current &&
      isSystemShortcutRecoveryKey(e)
    ) {
      scheduleShortcutRecovery();
    }
  };

  const handleWindowBlur = () => {
    syncTerminalLinkCtrlState(term, false);
  };

  const handleWindowFocus = () => {
    if (pendingSystemShortcutRecoveryRef.current) {
      scheduleShortcutRecovery({ delays: [0, 60, 160] });
    }

    scheduleActivationRecovery();
  };

  const handleShortcutRecoveryVisibilityChange = () => {
    if (!document.hidden) {
      if (pendingSystemShortcutRecoveryRef.current) {
        scheduleShortcutRecovery({ delays: [0, 80, 180] });
      }

      scheduleActivationRecovery({ delays: [40, 140, 260] });
    }
  };

  lifecycleManager.addEventListener(document, "keydown", handleKeyDown);
  lifecycleManager.addEventListener(document, "keyup", handleKeyUp);
  lifecycleManager.addEventListener(window, "blur", handleWindowBlur);
  lifecycleManager.addEventListener(window, "focus", handleWindowFocus);
  lifecycleManager.addEventListener(
    document,
    "visibilitychange",
    handleShortcutRecoveryVisibilityChange,
  );

  if (terminalRef.current) {
    const helperTextarea = term.element?.querySelector(
      ".xterm-helper-textarea",
    );
    if (helperTextarea) {
      lifecycleManager.addEventListener(
        helperTextarea,
        "compositionstart",
        () => {
          imeCompositionActiveRef.current = true;
        },
      );
      lifecycleManager.addEventListener(helperTextarea, "blur", () => {
        if (pendingSystemShortcutRecoveryRef.current) {
          scheduleShortcutRecovery({ delays: [20, 100, 220] });
        }
      });
      lifecycleManager.addEventListener(
        helperTextarea,
        "compositionend",
        () => {
          imeCompositionActiveRef.current = false;
          if (pendingSystemShortcutRecoveryRef.current) {
            scheduleShortcutRecovery({ delays: [0, 40, 120] });
          }
        },
      );
      lifecycleManager.addEventListener(
        helperTextarea,
        "compositioncancel",
        () => {
          imeCompositionActiveRef.current = false;
          if (pendingSystemShortcutRecoveryRef.current) {
            scheduleShortcutRecovery({ delays: [0, 40, 120] });
          }
        },
      );
    }
  }

  return { scheduleActivationRecovery };
}
