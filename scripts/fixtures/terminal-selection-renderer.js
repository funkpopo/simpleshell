import { ipcRenderer } from "electron";

const assert = (condition, message) => {
  if (!condition) throw new Error(`Terminal selection: ${message}`);
};
const delay = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

export async function runTerminalSelectionChecks(term) {
  const screen = term.element.querySelector(".xterm-screen");
  const write = (data) => new Promise((resolve) => term.write(data, resolve));
  await write(
    Array.from(
      { length: 120 },
      (_, i) =>
        `\r\nselection-${String(i).padStart(3, "0")} 中文 edge characters`,
    ).join(""),
  );
  await delay(150);
  const cell = term._core._renderService.dimensions.css.cell;
  const rect = screen.getBoundingClientRect();
  const point = (col, row) => ({
    clientX: rect.left + col * cell.width,
    clientY: rect.top + (row + 0.5) * cell.height,
  });
  const mouse = (type, position, options = {}, target = screen) => {
    target.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "mouseup" ? 0 : 1,
        detail: 1,
        ...position,
        ...options,
      }),
    );
  };
  const start = (options = {}) => {
    term.scrollToBottom();
    mouse("mousedown", point(0, 4), options);
    mouse("mousemove", point(12, 6), options);
    assert(term.hasSelection(), "drag must create a selection");
  };
  const end = () => mouse("mouseup", point(12, 6), {}, document);
  const wheel = (deltaY, deltaMode = 1, options = {}) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY,
      deltaMode,
      ...point(12, 6),
      ...options,
    });
    screen.dispatchEvent(event);
    return event;
  };
  const sent = [];
  const dataSubscription = term.onData((data) => sent.push(data));
  const previousClipboard = window.clipboardAPI;
  let copied = "";
  window.clipboardAPI = {
    writeText: async (text) => {
      copied = text;
    },
    readText: async () => "",
  };
  try {
    start();
    const anchor = term.getSelectionPosition().start;
    const viewport = term.buffer.active.viewportY;
    wheel(-2);
    await delay();
    assert(
      term.buffer.active.viewportY === viewport - 2,
      "drag wheel must scroll history",
    );
    assert(
      term.getSelectionPosition().start.y === anchor.y,
      "wheel must retain the drag anchor",
    );
    assert(
      term.getSelectionPosition().end.y === viewport + 4,
      "stationary pointer must follow the scrolled buffer",
    );
    wheel(1);
    await delay();
    assert(
      term.getSelectionPosition().end.y === viewport + 5,
      "reverse wheel must keep extending from the same anchor",
    );
    const fractionalViewport = term.buffer.active.viewportY;
    wheel(-cell.height / 4, 0);
    wheel(-cell.height / 4, 0);
    wheel(-cell.height / 4, 0);
    wheel(-cell.height / 4, 0);
    await delay();
    assert(
      term.buffer.active.viewportY === fractionalViewport - 1,
      "trackpad pixel deltas must accumulate",
    );
    end();
    const completed = term.getSelection();
    wheel(-1);
    await delay();
    assert(
      term.getSelection() === completed,
      "scrolling after mouseup must retain the completed selection",
    );

    start();
    mouse("mousemove", point(term.cols + 4, 6), {}, document);
    assert(
      term.getSelectionPosition().end.x === term.cols,
      "drag outside right edge must select the last cell",
    );
    mouse("mousemove", point(-4, 2), {}, document);
    assert(
      term.getSelectionPosition().start.x === 0,
      "drag outside left edge must reach the first cell",
    );
    mouse("mousemove", point(12, 6));
    end();
    const outside = term.getSelection();
    mouse("mousemove", point(20, 8), { buttons: 0 }, document);
    assert(
      term.getSelection() === outside,
      "mouseup outside the terminal must end the drag",
    );

    start();
    const edgeAnchor = term.getSelectionPosition().start;
    mouse("mousemove", point(12, -2), {}, document);
    const edgeViewport = term.buffer.active.viewportY;
    await delay(120);
    assert(
      term.buffer.active.viewportY < edgeViewport,
      "drag above viewport must autoscroll",
    );
    window.dispatchEvent(new Event("blur"));
    const blurred = term.getSelection();
    const blurredViewport = term.buffer.active.viewportY;
    await delay(100);
    assert(
      term.buffer.active.viewportY === blurredViewport,
      "blur must pause unattended edge autoscroll",
    );
    mouse("mousemove", point(term.cols + 4, 6), {}, document);
    const resumed = term.getSelectionPosition();
    assert(
      [resumed.start, resumed.end].some(
        (endpoint) =>
          endpoint.x === term.cols &&
          endpoint.y === term.buffer.active.viewportY + 6,
      ) && term.getSelection() !== blurred,
      "held mouse must continue selecting after leaving the window",
    );
    assert(
      [resumed.start, resumed.end].some(
        (endpoint) =>
          endpoint.x === edgeAnchor.x && endpoint.y === edgeAnchor.y,
      ),
      "returning with the button held must retain the original anchor",
    );
    const resumedText = term.getSelection();
    mouse("mousemove", point(20, 8), { buttons: 0 });
    assert(
      term.getSelection() === resumedText,
      "external release after resuming must preserve the final selection",
    );
    start();
    const missedRelease = term.getSelection();
    mouse("mousemove", point(20, 8), { buttons: 0 });
    assert(
      term.getSelection() === missedRelease,
      "returning after an external release must not change the selection",
    );

    // A real pointerdown is needed to exercise setPointerCapture. Hidden
    // Electron windows do not deliver sendInputEvent mouseMove during capture,
    // so continue the drag with DOM events after verifying Chromium's capture.
    term.scrollToBottom();
    const input = async (type, col, row, extra = {}) => {
      const position = point(col, row);
      await ipcRenderer.invoke("fixture-mouse", {
        type,
        x: Math.round(position.clientX),
        y: Math.round(position.clientY),
        ...extra,
      });
      await delay();
    };
    await input("mouseDown", 1, 4, { button: "left", clickCount: 1 });
    assert(
      term.element.hasPointerCapture(1),
      "native drag must capture the mouse pointer",
    );
    mouse("mousemove", point(12, 6), {}, document);
    const captureAnchor = term.getSelectionPosition().start;
    term.element.releasePointerCapture(1);
    term.element.dispatchEvent(
      new PointerEvent("lostpointercapture", {
        pointerId: 1,
        pointerType: "mouse",
        bubbles: true,
      }),
    );
    mouse("mousemove", point(term.cols + 4, 6), {}, document);
    assert(
      term.getSelectionPosition().end.x === term.cols,
      "drag must continue outside the right edge after capture loss",
    );
    assert(
      term.getSelectionPosition().start.x === captureAnchor.x &&
        term.getSelectionPosition().start.y === captureAnchor.y,
      "capture loss must preserve the original drag anchor",
    );
    assert(
      term.element.hasPointerCapture(1),
      "held pointer must regain capture",
    );
    mouse("mousemove", point(18, 8));
    assert(
      term.getSelectionPosition().end.x === 18,
      "drag must keep extending after re-entering the terminal",
    );
    await input("mouseUp", term.cols + 4, 6, { button: "left", clickCount: 1 });
    end();
    assert(!term.element.hasPointerCapture(1), "mouseup must release capture");

    await write("\x1b[?1049h\x1b[?1000h\x1b[?1006h");
    await write(
      "\x1b[H" +
        Array.from(
          { length: 12 },
          (_, i) => `application-${i} 中文 selection text`,
        ).join("\r\n"),
    );
    await delay();
    const beforeInput = sent.length;
    mouse("mousedown", point(0, 4));
    end();
    assert(
      sent.length > beforeInput,
      "ordinary application mouse reporting must still work",
    );
    start({ shiftKey: true });
    const selectedInApp = term.getSelection();
    const beforeWheel = sent.length;
    wheel(-3, 1, { shiftKey: true });
    await delay();
    assert(
      term.getSelection() === selectedInApp,
      "forced drag + wheel must preserve alternate-buffer selection",
    );
    assert(
      sent.length === beforeWheel,
      "selection wheel must not send mouse reports or arrow input",
    );
    end();
    const beforeRightClick = sent.length;
    mouse("mousedown", point(30, 10), { button: 2, buttons: 2 });
    mouse("contextmenu", point(30, 10), { button: 2, buttons: 2 });
    mouse("mouseup", point(30, 10), { button: 2, buttons: 0 });
    await delay();
    assert(
      sent.length === beforeRightClick,
      "right click with a selection must not become application input",
    );
    assert(
      term.getSelection() === selectedInApp,
      "right click outside the selection must preserve it",
    );
    const copyItem = Array.from(
      document.querySelectorAll('[role="menuitem"]'),
    ).find((item) => item.textContent.startsWith("Copy"));
    assert(
      copyItem && copyItem.getAttribute("aria-disabled") !== "true",
      "context menu must enable copying the selection",
    );
    copyItem.click();
    await delay();
    assert(
      copied === selectedInApp,
      "menu must copy the original selected text",
    );
    assert(
      term.getSelection() === selectedInApp,
      "copy/menu dismissal must retain the selection",
    );

    // Without mouse reporting, xterm otherwise sends arrows for alt-buffer wheel.
    await write("\x1b[?1000l\x1b[?1006l");
    start();
    const noMouseSelection = term.getSelection();
    const beforeArrows = sent.length;
    wheel(2);
    assert(
      sent.length === beforeArrows,
      "alternate-buffer selection wheel must not send arrow keys",
    );
    assert(
      term.getSelection() === noMouseSelection,
      "alternate-buffer wheel must retain the selection",
    );
    end();
    console.log("SCREEN_SPLIT terminal mouse selection checks passed");
  } finally {
    end();
    await write("\x1b[?1000l\x1b[?1006l\x1b[?1049l");
    term.clearSelection();
    dataSubscription.dispose();
    window.clipboardAPI = previousClipboard;
  }
}
