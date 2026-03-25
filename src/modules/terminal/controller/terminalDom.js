const ESC_CHAR = String.fromCharCode(27);

export const ANSI_CSI_SEQUENCE_REGEX = new RegExp(
  ESC_CHAR + "[[][0-9;]*[a-zA-Z]",
  "g",
);

export const TERMINAL_RESIZE_QUERY_REGEX = new RegExp(
  ESC_CHAR + "[[]8;[0-9]+;[0-9]+t",
);

export const terminalStyles = `
.xterm {
  height: 100%;
  width: 100%;
  background: inherit;
  overflow: hidden;
}
.xterm-viewport {
  width: 100% !important;
  height: 100% !important;
  overflow-y: auto;
  overflow-x: hidden;
  background: inherit !important;
}
.xterm-viewport::-webkit-scrollbar {
  width: 10px;
}
.xterm-viewport::-webkit-scrollbar-track {
  background: transparent;
}
.xterm-viewport::-webkit-scrollbar-thumb {
  background-color: rgba(128, 128, 128, 0.4);
  border-radius: 5px;
  border: 2px solid transparent;
  background-clip: content-box;
  transition: background-color 0.2s ease;
}
.xterm-viewport::-webkit-scrollbar-thumb:hover {
  background-color: rgba(128, 128, 128, 0.7);
}
.terminal-container {
  display: flex;
  flex-direction: column;
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

/* 增强版选中高亮样式 */
.xterm-selection {
  opacity: 1 !important;
  z-index: 10 !important;
  pointer-events: none !important;
  position: absolute !important;
}

/* 默认隐藏所有选择div */
.xterm .xterm-selection div {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
  position: absolute !important;
  box-sizing: border-box !important;
}

/* 仅显示第一个选择容器中的第一个div */
.xterm .xterm-selection:first-of-type div:first-child {
  display: block !important;
  opacity: 1 !important;
  visibility: visible !important;
  will-change: transform, width, height !important;
  transition: transform 0.05s ease, opacity 0.1s ease !important;
  box-sizing: border-box !important;
  border-radius: 2px !important;
}

/* 彻底隐藏任何额外的选择容器 */
.xterm-selection:not(:first-of-type) {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
}

/* 标记为重复的选择元素彻底隐藏 */
.xterm-selection-duplicate {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

/* 选择高亮颜色 - 增强可见度 */
.xterm .xterm-selection div {
  background: linear-gradient(to bottom, rgba(88, 166, 255, 0.28), rgba(88, 166, 255, 0.38)) !important;
  box-shadow: 0 0 4px rgba(88, 166, 255, 0.3) !important;
}

/* 深色主题下的选择高亮 - 使用更亮的颜色 */
.dark-theme .xterm .xterm-selection div {
  background: linear-gradient(to bottom, rgba(255, 223, 0, 0.25), rgba(255, 223, 0, 0.35)) !important;
  box-shadow: 0 0 4px rgba(255, 223, 0, 0.25) !important;
}

/* 浅色主题下的选择高亮 - 使用更深的蓝色 */
.light-theme .xterm .xterm-selection div,
body:not(.dark-theme) .xterm .xterm-selection div {
  background: linear-gradient(to bottom, rgba(9, 105, 218, 0.25), rgba(9, 105, 218, 0.35)) !important;
  box-shadow: 0 0 4px rgba(9, 105, 218, 0.3) !important;
}

/* 搜索结果高亮 */
.xterm-find-result-decoration,
.xterm-find-active-result-decoration {
  border-radius: 0 !important;
  outline: none !important;
  pointer-events: none !important;
  background-clip: padding-box !important;
  transition:
    background-color 0.12s ease,
    box-shadow 0.12s ease !important;
}

.xterm-decoration-overview-ruler {
  border-radius: 999px !important;
}

/* 搜索模式下隐藏 selection 叠层，避免与 active decoration 叠加后出现范围偏移 */
.xterm.xterm-search-selection-hidden .xterm-selection,
.xterm.xterm-search-selection-hidden .xterm-selection div {
  opacity: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
}

/* 深色主题下的搜索高亮：使用偏冷色，避免压住浅色终端文字 */
.dark-theme .xterm-find-result-decoration,
body:not(.light-theme) .xterm-find-result-decoration {
  background: rgba(72, 132, 214, 0.28) !important;
  box-shadow: inset 0 0 0 1px rgba(148, 196, 255, 0.34) !important;
}

.dark-theme .xterm-find-active-result-decoration,
body:not(.light-theme) .xterm-find-active-result-decoration {
  background: rgba(92, 156, 255, 0.36) !important;
  box-shadow:
    inset 0 0 0 1px rgba(220, 236, 255, 0.8),
    inset 0 0 0 2px rgba(18, 58, 102, 0.12) !important;
}

.dark-theme .xterm-decoration-overview-ruler,
body:not(.light-theme) .xterm-decoration-overview-ruler {
  background: rgba(124, 184, 255, 0.78) !important;
}

/* 浅色主题下的搜索高亮：使用更轻的冷色，减少对深色文字的覆盖 */
.light-theme .xterm-find-result-decoration,
body:not(.dark-theme) .xterm-find-result-decoration {
  background: rgba(132, 191, 255, 0.26) !important;
  box-shadow: inset 0 0 0 1px rgba(46, 108, 184, 0.24) !important;
}

.light-theme .xterm-find-active-result-decoration,
body:not(.dark-theme) .xterm-find-active-result-decoration {
  background: rgba(104, 169, 255, 0.34) !important;
  box-shadow:
    inset 0 0 0 1px rgba(28, 88, 166, 0.38),
    inset 0 0 0 2px rgba(214, 232, 255, 0.52) !important;
}

.light-theme .xterm-decoration-overview-ruler,
body:not(.dark-theme) .xterm-decoration-overview-ruler {
  background: rgba(72, 136, 214, 0.7) !important;
}
`;

export const searchBarStyles = `
/* 深色主题搜索框样式 */
.dark-theme .search-bar,
body:not(.light-theme) .search-bar {
  position: absolute;
  top: 8px;
  right: 15px;
  z-index: 10;
  display: flex;
  background: linear-gradient(to bottom, rgba(30, 30, 30, 0.95), rgba(20, 20, 20, 0.95));
  border: 1px solid rgba(88, 166, 255, 0.3);
  border-radius: 6px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(88, 166, 255, 0.1);
  align-items: center;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(10px);
}
.dark-theme .search-bar:focus-within,
body:not(.light-theme) .search-bar:focus-within {
  border-color: rgba(88, 166, 255, 0.5);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(88, 166, 255, 0.3);
}

/* 浅色主题搜索框样式 */
.light-theme .search-bar {
  position: absolute;
  top: 8px;
  right: 15px;
  z-index: 10;
  display: flex;
  background: linear-gradient(to bottom, rgba(248, 249, 250, 0.95), rgba(240, 242, 245, 0.95));
  border: 1px solid rgba(88, 166, 255, 0.4);
  border-radius: 6px;
  padding: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(88, 166, 255, 0.15);
  align-items: center;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  backdrop-filter: blur(10px);
}
.light-theme .search-bar:focus-within {
  border-color: rgba(88, 166, 255, 0.6);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(88, 166, 255, 0.4);
}

/* 深色主题输入框样式 */
.dark-theme .search-input,
body:not(.light-theme) .search-input {
  border: none;
  outline: none;
  background: transparent;
  color: #e6edf3;
  font-size: 14px;
  font-family: inherit;
  padding: 4px 8px;
  width: 200px;
  transition: all 0.2s ease;
}
.dark-theme .search-input::placeholder,
body:not(.light-theme) .search-input::placeholder {
  color: rgba(255, 255, 255, 0.4);
}
.dark-theme .search-input:focus,
body:not(.light-theme) .search-input:focus {
  border-bottom: 1px solid rgba(88, 166, 255, 0.5);
}

/* 浅色主题输入框样式 */
.light-theme .search-input {
  border: none;
  outline: none;
  background: transparent;
  color: #24292f;
  font-size: 14px;
  font-family: inherit;
  padding: 4px 8px;
  width: 200px;
  transition: all 0.2s ease;
}
.light-theme .search-input::placeholder {
  color: rgba(0, 0, 0, 0.4);
}
.light-theme .search-input:focus {
  border-bottom: 1px solid rgba(88, 166, 255, 0.6);
}

/* 深色主题按钮样式 */
.dark-theme .search-button,
body:not(.light-theme) .search-button {
  color: white !important;
  cursor: pointer;
  margin-left: 2px;
  opacity: 0.7;
  transition: all 0.2s ease;
  border-radius: 4px;
}
.dark-theme .search-button:hover,
body:not(.light-theme) .search-button:hover {
  background-color: rgba(88, 166, 255, 0.2) !important;
  opacity: 1;
  transform: scale(1.05);
}
.dark-theme .search-button:disabled,
body:not(.light-theme) .search-button:disabled {
  opacity: 0.3 !important;
  cursor: not-allowed;
}

/* 浅色主题按钮样式 */
.light-theme .search-button {
  color: rgba(0, 0, 0, 0.7) !important;
  cursor: pointer;
  margin-left: 2px;
  opacity: 0.8;
  transition: all 0.2s ease;
  border-radius: 4px;
}
.light-theme .search-button:hover {
  background-color: rgba(88, 166, 255, 0.15) !important;
  color: rgba(0, 0, 0, 0.9) !important;
  opacity: 1;
  transform: scale(1.05);
}
.light-theme .search-button:disabled {
  opacity: 0.3 !important;
  cursor: not-allowed;
}
/* 深色主题搜索图标按钮 */
.dark-theme .search-icon-btn,
body:not(.light-theme) .search-icon-btn {
  position: absolute;
  top: 8px;
  right: 15px;
  z-index: 9;
  border-radius: 6px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0.8;
  backdrop-filter: blur(5px);
  color: rgba(255, 255, 255, 0.7);
  background: linear-gradient(to bottom, rgba(88, 166, 255, 0.15), rgba(88, 166, 255, 0.1));
  border: 1px solid rgba(88, 166, 255, 0.2);
}
.dark-theme .search-icon-btn:hover,
body:not(.light-theme) .search-icon-btn:hover {
  opacity: 1;
  transform: scale(1.05);
  color: white;
  background: linear-gradient(to bottom, rgba(88, 166, 255, 0.25), rgba(88, 166, 255, 0.2));
  border-color: rgba(88, 166, 255, 0.4);
}

/* 浅色主题搜索图标按钮 */
.light-theme .search-icon-btn {
  position: absolute;
  top: 8px;
  right: 15px;
  z-index: 9;
  border-radius: 6px;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  opacity: 0.8;
  backdrop-filter: blur(5px);
  color: rgba(0, 0, 0, 0.7);
  background: linear-gradient(to bottom, rgba(248, 249, 250, 0.9), rgba(240, 242, 245, 0.9));
  border: 1px solid rgba(88, 166, 255, 0.3);
}
.light-theme .search-icon-btn:hover {
  opacity: 1;
  transform: scale(1.05);
  color: rgba(0, 0, 0, 0.9);
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0.95), rgba(248, 249, 250, 0.95));
  border-color: rgba(88, 166, 255, 0.5);
}
`;

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
