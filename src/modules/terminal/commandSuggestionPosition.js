const DEFAULT_WIDTH = 200;
const DEFAULT_HEIGHT = 100;
const DEFAULT_CURSOR_HEIGHT = 18;
const DEFAULT_FALLBACK_OFFSET = 50;
const DEFAULT_FALLBACK_POSITION = 100;
const CONTAINER_PADDING = 8;
const CURSOR_GAP = 20;

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const sanitizeNumber = (value, fallback) =>
  isFiniteNumber(value) ? value : fallback;

const resolveCommandSuggestionWindowPosition = ({
  position = { x: 0, y: 0, showAbove: false },
  windowDimensions = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
  terminalRect = null,
  windowWidth = 0,
  windowHeight = 0,
} = {}) => {
  const viewportWidth = sanitizeNumber(windowWidth, 0) || 1024;
  const viewportHeight = sanitizeNumber(windowHeight, 0) || 768;
  const suggestionWidth = Math.max(
    1,
    sanitizeNumber(windowDimensions?.width, DEFAULT_WIDTH),
  );
  const suggestionHeight = Math.max(
    1,
    sanitizeNumber(windowDimensions?.height, DEFAULT_HEIGHT),
  );

  const fallbackLeft = terminalRect
    ? terminalRect.left + DEFAULT_FALLBACK_OFFSET
    : DEFAULT_FALLBACK_POSITION;
  const fallbackTop = terminalRect
    ? terminalRect.top + DEFAULT_FALLBACK_OFFSET
    : DEFAULT_FALLBACK_POSITION;

  let left = sanitizeNumber(position?.x, fallbackLeft);
  let top = sanitizeNumber(position?.y, fallbackTop);

  const bounds = terminalRect
    ? {
        left: terminalRect.left,
        top: terminalRect.top,
        right: terminalRect.right,
        bottom: terminalRect.bottom,
      }
    : { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight };

  const cursorHeight = Math.max(
    1,
    sanitizeNumber(position?.cursorHeight, DEFAULT_CURSOR_HEIGHT),
  );
  const cursorBottom = sanitizeNumber(position?.cursorBottom, top + cursorHeight);

  const spaceBelow = Math.max(0, bounds.bottom - cursorBottom - CURSOR_GAP);
  const spaceAbove = Math.max(0, top - bounds.top - CURSOR_GAP);

  let showAbove = Boolean(position?.showAbove);
  const belowFits = spaceBelow >= Math.min(suggestionHeight, 120);
  const aboveFits = spaceAbove >= Math.min(suggestionHeight, 120);

  if (!belowFits && !aboveFits) {
    showAbove = spaceAbove > spaceBelow;
  } else if (showAbove && !aboveFits && belowFits) {
    showAbove = false;
  } else if (!showAbove && !belowFits && aboveFits) {
    showAbove = true;
  }

  const containerWidthAvailable = Math.max(
    50,
    bounds.right - bounds.left - CONTAINER_PADDING * 2,
  );
  const containerHeightAvailable = Math.max(
    40,
    bounds.bottom - bounds.top - CONTAINER_PADDING * 2,
  );
  const sideSpace = showAbove ? spaceAbove : spaceBelow;

  const width = Math.min(suggestionWidth, containerWidthAvailable);
  let height = Math.min(suggestionHeight, containerHeightAvailable, sideSpace);
  if (!isFiniteNumber(height) || height <= 0) {
    height = Math.min(suggestionHeight, containerHeightAvailable);
  }

  const maxLeftWithin = bounds.right - width - CONTAINER_PADDING;
  const minLeftWithin = bounds.left + CONTAINER_PADDING;
  if (left > maxLeftWithin) {
    left = Math.max(minLeftWithin, maxLeftWithin);
  }
  if (left < minLeftWithin) {
    left = minLeftWithin;
  }

  if (showAbove) {
    top = top - height - CURSOR_GAP;
  } else {
    top = cursorBottom + CURSOR_GAP;
  }

  const maxTopWithin = bounds.bottom - height - CONTAINER_PADDING;
  const minTopWithin = bounds.top + CONTAINER_PADDING;

  if (top > maxTopWithin) {
    if (!showAbove && isFiniteNumber(position?.y)) {
      const flippedTop = sanitizeNumber(position?.y, fallbackTop) - height - CURSOR_GAP;
      top = Math.max(minTopWithin, Math.min(flippedTop, maxTopWithin));
    } else {
      top = Math.max(minTopWithin, maxTopWithin);
    }
  }

  if (top < minTopWithin) {
    if (showAbove && isFiniteNumber(position?.y)) {
      const flippedTop = cursorBottom + CURSOR_GAP;
      top = Math.max(minTopWithin, Math.min(flippedTop, maxTopWithin));
    } else {
      top = minTopWithin;
    }
  }

  return { left, top, width, height, showAbove };
};

module.exports = {
  resolveCommandSuggestionWindowPosition,
};
