import {
  debounce,
  createResizeObserver,
  isElementVisible,
} from "../../../shared/lib/performance.js";
import { attachTerminalSelection } from "./terminalSelection.js";

/**
 * Terminal container listeners: mouse/paste/context-menu routing, selection,
 * and the resize/sidebar/visibility/intersection triggers for layout sync.
 * Everything is registered on `lifecycleManager` except the resize observer,
 * which is returned so the caller can register it at its original position.
 */
export function attachTerminalContainerListeners({
  term,
  terminalRef,
  termRef,
  fitAddonRef,
  lifecycleManager,
  handleMouseDownRef,
  handleMouseMoveRef,
  handleMouseUpRef,
  handleContextMenuRef,
  markPasteIfAllowedRef,
  handlePasteTextRef,
  lastPasteTimeRef,
  scheduleTerminalLayoutSyncRef,
  isTerminalContainerVisible,
  hasMeaningfulLayoutGeometryChange,
  scheduleActivationRecovery,
}) {
  if (terminalRef.current) {
    lifecycleManager.addEventListener(
      terminalRef.current,
      "mousedown",
      (e) => handleMouseDownRef.current(e),
      { capture: true },
    );
    lifecycleManager.addEventListener(
      terminalRef.current,
      "auxclick",
      (e) => {
        if (e.button === 1) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );
    lifecycleManager.addEventListener(
      terminalRef.current,
      "paste",
      (e) => {
        const pastedText =
          typeof e.clipboardData?.getData === "function"
            ? e.clipboardData.getData("text/plain")
            : "";
        if (pastedText) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          if (markPasteIfAllowedRef.current()) {
            handlePasteTextRef.current(pastedText);
          }
          return;
        }

        const now = Date.now();
        const lastPasteAt = lastPasteTimeRef?.current || 0;
        if (now - lastPasteAt < 200) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
      },
      { capture: true },
    );

    lifecycleManager.addEventListener(terminalRef.current, "mousemove", (e) =>
      handleMouseMoveRef.current(e),
    );
    lifecycleManager.addEventListener(terminalRef.current, "mouseup", (e) =>
      handleMouseUpRef.current(e),
    );
  }

  if (terminalRef.current) {
    lifecycleManager.addCleanup(
      attachTerminalSelection(term, terminalRef.current),
    );
    lifecycleManager.addEventListener(
      terminalRef.current,
      "contextmenu",
      (event) => handleContextMenuRef.current(event),
      { capture: true },
    );
  }

  const handleResize = () => {
    scheduleTerminalLayoutSyncRef.current("resize");
  };

  handleResize();

  const resizeObserver = createResizeObserver(
    terminalRef.current,
    ({ width, height }) => {
      if (
        !terminalRef.current ||
        !termRef.current ||
        !fitAddonRef.current ||
        !isTerminalContainerVisible(terminalRef.current)
      ) {
        return;
      }

      if (hasMeaningfulLayoutGeometryChange(width, height)) {
        scheduleTerminalLayoutSyncRef.current("container-resize");
      }
    },
    { debounceTime: 16 },
  );

  lifecycleManager.addEventListener(window, "resize", handleResize);

  const handleSidebarChanged = (event) => {
    if (
      event.detail &&
      terminalRef.current &&
      fitAddonRef.current &&
      termRef.current
    ) {
      scheduleTerminalLayoutSyncRef.current("sidebar");
    }
  };

  lifecycleManager.addEventListener(
    window,
    "sidebarChanged",
    handleSidebarChanged,
  );

  const handleTerminalVisibilityChange = debounce(() => {
    if (
      !document.hidden &&
      termRef.current &&
      isElementVisible(terminalRef.current)
    ) {
      scheduleTerminalLayoutSyncRef.current("visibility");
      scheduleActivationRecovery({ delays: [60, 180] });
    }
  }, 50);

  lifecycleManager.addEventListener(
    document,
    "visibilitychange",
    handleTerminalVisibilityChange,
  );

  const intersectionObserver =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (
              entry.isIntersecting &&
              terminalRef.current &&
              termRef.current &&
              fitAddonRef.current
            ) {
              scheduleTerminalLayoutSyncRef.current("intersection");
            }
          });
        })
      : null;

  if (intersectionObserver && terminalRef.current) {
    intersectionObserver.observe(terminalRef.current);
    lifecycleManager.addObserver(intersectionObserver);
  }

  return resizeObserver;
}
