/**
 * Keep xterm's native selection (word/line/column and wide characters) while
 * extending a drag across scrolling and outside the terminal/window bounds.
 * xterm 6 has no public API for continuing/ending a mouse selection; keep the
 * SelectionService integration here so dependency upgrades have one adapter.
 */
export function attachTerminalSelection(term, container) {
  const selection = term?._core?._selectionService;
  const element = term?.element;
  const document = element?.ownerDocument;
  const window = document?.defaultView;
  if (!selection || !container || !window) return () => {};

  const listeners = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  };
  let pointerId = null;
  let dragging = false;
  let suspended = false;
  let lastMouse = null;
  let wheelRemainder = 0;
  const nativeDragActive = () =>
    selection._dragScrollIntervalTimer !== undefined;

  const rememberMouse = (event) => {
    lastMouse = {
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      buttons: 1,
    };
  };

  const finishDrag = (mouseUpEvent) => {
    const wasDragging = dragging;
    dragging = false;
    suspended = false;
    wheelRemainder = 0;
    const capturedPointer = pointerId;
    pointerId = null;
    if (wasDragging && nativeDragActive()) {
      // End the native listeners/timer without clearing the selection or
      // turning a cancelled Alt-drag into cursor-movement input.
      selection._mouseUpListener(
        mouseUpEvent ??
          new window.MouseEvent("mouseup", { ...lastMouse, altKey: false }),
      );
    }
    if (
      capturedPointer !== null &&
      element.hasPointerCapture?.(capturedPointer)
    ) {
      element.releasePointerCapture(capturedPointer);
    }
    lastMouse = null;
  };

  const capturePointer = () => {
    if (pointerId === null || element.hasPointerCapture?.(pointerId)) return;
    try {
      element.setPointerCapture?.(pointerId);
    } catch {
      // The pointer may be temporarily outside the window or synthetic.
      // Keep the drag alive using document listeners until it returns.
    }
  };

  const suspendDrag = () => {
    if (!dragging) return;
    suspended = true;
    // Losing focus/capture is not a mouse release. Keep xterm's anchor and
    // drag listeners so a held button can continue the same selection when
    // events resume. Only pause unattended edge scrolling in the meantime.
    selection._dragScrollAmount = 0;
  };

  listen(
    container,
    "pointerdown",
    (event) => {
      if (event.pointerType === "mouse" && event.button === 0) {
        finishDrag();
        pointerId = event.pointerId;
      }
    },
    true,
  );

  listen(
    container,
    "mousedown",
    (event) => {
      if (event.button === 0 && dragging) {
        // A fresh press after a release outside the window starts a new drag;
        // remove the previous native timer before xterm registers another one.
        finishDrag();
      }
      if (event.button === 2 && term.hasSelection()) {
        finishDrag();
        // Mouse-reporting applications treat a right click as input, which
        // clears xterm's selection before our contextmenu handler can read it.
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  listen(element, "mousedown", (event) => {
    // Run after xterm has accepted the left click. In mouse-reporting mode a
    // normal click belongs to the application; only forced selection is ours.
    if (event.button !== 0 || !nativeDragActive()) return;
    dragging = true;
    suspended = false;
    wheelRemainder = 0;
    rememberMouse(event);
    // Capture on xterm so compatibility mouse events still reach its handlers.
    capturePointer();
  });

  listen(
    document,
    "mousemove",
    (event) => {
      if (!dragging) return;
      if (!(event.buttons & 1) || !nativeDragActive()) {
        finishDrag();
        return;
      }
      suspended = false;
      rememberMouse(event);
      capturePointer();
    },
    true,
  );

  listen(
    document,
    "mouseup",
    (event) => {
      if (event.button === 0) finishDrag(event);
    },
    true,
  );
  const handlePointerEnd = (event) => {
    if (event.pointerId === pointerId) finishDrag();
  };
  listen(document, "pointercancel", handlePointerEnd, true);
  listen(element, "lostpointercapture", (event) => {
    if (event.pointerId === pointerId) suspendDrag();
  });
  listen(window, "blur", suspendDrag);
  listen(document, "visibilitychange", () => {
    if (document.hidden) suspendDrag();
  });

  const scrollSubscription = term.onScroll(() => {
    if (dragging && !suspended && lastMouse && nativeDragActive()) {
      // A stationary pointer still needs a new buffer endpoint after scrolling.
      selection._mouseMoveListener(
        new window.MouseEvent("mousemove", lastMouse),
      );
    }
  });

  listen(
    document,
    "wheel",
    (event) => {
      if (!dragging || !nativeDragActive()) return;
      event.preventDefault();
      event.stopPropagation();
      // Do not forward selection scrolling as arrow keys / mouse reports: xterm
      // clears the selection on user input, notably in vim/tmux's alternate buffer.
      const cellHeight =
        term._core._renderService?.dimensions?.css?.cell?.height;
      if (!cellHeight || !event.deltaY) return;
      const unit =
        event.deltaMode === 1
          ? 1
          : event.deltaMode === 2
            ? term.rows
            : 1 / cellHeight;
      const fastModifier = term.options.fastScrollModifier;
      const fast = event[`${fastModifier}Key`];
      const sensitivity =
        (term.options.scrollSensitivity ?? 1) *
        (fast ? (term.options.fastScrollSensitivity ?? 5) : 1);
      wheelRemainder += event.deltaY * unit * sensitivity;
      const lines = Math.trunc(wheelRemainder);
      wheelRemainder -= lines;
      if (lines) term.scrollLines(lines);
    },
    { capture: true, passive: false },
  );

  return () => {
    finishDrag();
    scrollSubscription.dispose();
    listeners.forEach((remove) => remove());
  };
}
