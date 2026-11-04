import { shouldIgnoreCommandSuggestionKeyEvent } from "../model/commandSuggestionState.js";
import {
  isSystemShortcutRecoveryKey,
  shouldArmSystemShortcutRecovery,
} from "../model/systemShortcutRecovery.js";
import { syncTerminalLinkCtrlState } from "./terminalDom.js";

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

    return (
      target?.classList?.contains?.("xterm-helper-textarea") ||
      document.activeElement === helperTextarea
    );
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
        (e.key.toLowerCase?.() === "l" && e.ctrlKey);

      if (!isAllowedKey) {
        return;
      }
    }

    if (e.ctrlKey && e.key === ";") {
      const selection = term.getSelection();
      if (selection) {
        e.preventDefault();
        window.clipboardAPI.writeText(selection);
      }
    } else if (e.ctrlKey && e.key === "'") {
      e.preventDefault();

      if (!markPasteIfAllowedRef.current()) {
        return;
      }

      window.clipboardAPI.readText().then((text) => {
        handlePasteTextRef.current(text);
      });
    } else if (
      e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key.toLowerCase() === "l"
    ) {
      if (!isActiveRef.current) return;
      e.preventDefault();
      e.stopPropagation();
      clearTerminalRef.current();
    } else if (e.ctrlKey && e.key === "/") {
      if (!isActiveRef.current) return;

      e.preventDefault();
      e.stopPropagation();
      shortcutUiRef.current.toggleSearchBar?.();
    } else if (e.key === "Escape") {
      const ui = shortcutUiRef.current;
      if (ui.showSearchBar) {
        if (!isActiveRef.current) return;
        e.preventDefault();
        ui.closeSearchBar?.();
      } else if (ui.showSuggestions) {
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
        if (!isActiveRef.current) return;
        e.preventDefault();
        ui.handleSearch?.();
      }
    } else if ((e.shiftKey && e.key === "F3") || (e.ctrlKey && e.key === ",")) {
      const ui = shortcutUiRef.current;
      if (searchAddonRef.current && ui.searchTerm) {
        if (!isActiveRef.current) return;
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
