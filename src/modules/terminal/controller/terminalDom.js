const ESC_CHAR = String.fromCharCode(27);

export const TERMINAL_RESIZE_QUERY_REGEX = new RegExp(
  ESC_CHAR + "[[]8;[0-9]+;[0-9]+t",
);

/**
 * Surface styles live in styles/terminal.css (single source).
 * Shared injected style element is retained for any future runtime CSS hooks.
 */
export const terminalStyles = "";
export const searchBarStyles = "";

const SHARED_STYLE_ELEMENT_ID = "web-terminal-shared-style";
const TERMINAL_LINK_CTRL_ACTIVE_CLASS = "xterm-link-ctrl-pressed";

let sharedStyleElement = null;

export const syncTerminalLinkCtrlState = (term, isCtrlPressed) => {
  if (!term?.element?.classList) {
    return;
  }

  term.element.classList.toggle(
    TERMINAL_LINK_CTRL_ACTIVE_CLASS,
    Boolean(isCtrlPressed),
  );
};

export const isCtrlLeftMouseClick = (event) => {
  if (typeof MouseEvent === "undefined" || !(event instanceof MouseEvent)) {
    return false;
  }

  return event.button === 0 && event.ctrlKey;
};

export const ensureSharedTerminalStyles = () => {
  if (sharedStyleElement && document.contains(sharedStyleElement)) {
    return sharedStyleElement;
  }

  const existing = document.getElementById(SHARED_STYLE_ELEMENT_ID);
  if (existing) {
    sharedStyleElement = existing;
    return sharedStyleElement;
  }

  const style = document.createElement("style");
  style.id = SHARED_STYLE_ELEMENT_ID;
  document.head.appendChild(style);
  sharedStyleElement = style;
  return sharedStyleElement;
};

const getCharacterMetrics = (term) => {
  if (!term || !term.element) return null;

  try {
    const charMeasureElement = term.element.querySelector(
      ".xterm-char-measure-element",
    );
    let charWidth = 9;
    let charHeight = 17;

    if (charMeasureElement) {
      charWidth = charMeasureElement.getBoundingClientRect().width;
      charHeight = charMeasureElement.getBoundingClientRect().height;
    } else {
      const viewport = term.element.querySelector(".xterm-viewport");
      const screen = term.element.querySelector(".xterm-screen");
      const fallbackRect = (screen || viewport)?.getBoundingClientRect();
      const cols = Math.max(1, term.cols || 1);
      const rows = Math.max(1, term.rows || 1);

      if (fallbackRect?.width > 0) {
        charWidth = fallbackRect.width / cols;
      }
      if (fallbackRect?.height > 0) {
        charHeight = fallbackRect.height / rows;
      }
    }

    charWidth = Math.max(1, Math.round(charWidth * 100) / 100);
    charHeight = Math.max(1, Math.round(charHeight * 100) / 100);

    const viewport = term.element.querySelector(".xterm-viewport");
    const screen = term.element.querySelector(".xterm-screen");
    const viewportRect = viewport?.getBoundingClientRect() || {
      left: 0,
      top: 0,
    };
    const screenRect = screen?.getBoundingClientRect() || { left: 0, top: 0 };
    const scrollTop = viewport ? viewport.scrollTop : 0;
    const scrollLeft = viewport ? viewport.scrollLeft : 0;
    const terminalScrollPosition = term.buffer?.active?.viewportY || 0;
    const terminalHasScrolled = terminalScrollPosition > 0;
    const termScale =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;

    return {
      charWidth,
      charHeight,
      viewportOffset: {
        x: viewportRect.left,
        y: viewportRect.top,
        scrollLeft,
        scrollTop,
      },
      screenOffset: {
        x: screenRect.left,
        y: screenRect.top,
      },
      scrollPosition: terminalScrollPosition,
      hasScrolled: terminalHasScrolled,
      scaleFactor: termScale,
      debug: {
        viewportRect: {
          left: viewportRect.left,
          top: viewportRect.top,
          width: viewportRect.width,
          height: viewportRect.height,
        },
        screenRect: {
          left: screenRect.left,
          top: screenRect.top,
          width: screenRect.width,
          height: screenRect.height,
        },
      },
    };
  } catch (error) {
    console.warn("Failed to get character metrics:", error);
    return {
      charWidth: 9,
      charHeight: 17,
      viewportOffset: { x: 0, y: 0, scrollLeft: 0, scrollTop: 0 },
      screenOffset: { x: 0, y: 0 },
      scrollPosition: 0,
      hasScrolled: false,
      scaleFactor: 1,
    };
  }
};

export const getCharacterMetricsCss = (term) => {
  const base = getCharacterMetrics(term);
  if (!base || !term || !term.element) return base;

  let { charWidth, charHeight } = base;
  try {
    const cme = term.element.querySelector(".xterm-char-measure-element");
    const dpr =
      typeof window !== "undefined" && window.devicePixelRatio
        ? window.devicePixelRatio
        : 1;

    if (cme) {
      const rect = cme.getBoundingClientRect();
      if (rect && rect.width > 0) charWidth = rect.width;
      if (rect && rect.height > 0) charHeight = rect.height;
    } else if (dpr > 1) {
      const viewport = term.element.querySelector(".xterm-viewport");
      const screen = term.element.querySelector(".xterm-screen");
      const refEl = viewport || screen || term.element;
      const rect = refEl.getBoundingClientRect
        ? refEl.getBoundingClientRect()
        : { width: term.cols * charWidth, height: term.rows * charHeight };
      if (charWidth * (term.cols || 1) > (rect.width || 0) + 2) {
        charWidth = charWidth / dpr;
      }
      if (charHeight * (term.rows || 1) > (rect.height || 0) + 2) {
        charHeight = charHeight / dpr;
      }
    }
  } catch {
    // ignore
  }
  return { ...base, charWidth, charHeight, scaleFactor: 1 };
};
