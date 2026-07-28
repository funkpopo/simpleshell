const DEFAULT_CURSOR_HEIGHT = 18;
const DEFAULT_GAP = 20;

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const isUsableRect = (rect) =>
  rect &&
  isFiniteNumber(rect.left) &&
  isFiniteNumber(rect.top) &&
  isFiniteNumber(rect.width) &&
  isFiniteNumber(rect.height) &&
  rect.width > 0 &&
  rect.height > 0;

const clamp = (value, min, max) => {
  if (!isFiniteNumber(value)) {
    return min;
  }
  if (min > max) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

/**
 * Build a suggestion-anchor position from raw cursor coordinates.
 * Coordinates that drift slightly outside the terminal (common on the last
 * row with WebGL/CSS cell metrics) are clamped instead of rejected, so the
 * floating window can keep appearing after the prompt settles at the bottom.
 */
const buildCommandSuggestionCursorPosition = ({
  x,
  y,
  cursorHeight = DEFAULT_CURSOR_HEIGHT,
  cursorBottom,
  suggestionHeight = 100,
  containerRect = null,
  gap = DEFAULT_GAP,
} = {}) => {
  if (!isUsableRect(containerRect)) {
    return null;
  }

  if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
    return null;
  }

  const safeCursorHeight =
    isFiniteNumber(cursorHeight) && cursorHeight > 0
      ? cursorHeight
      : DEFAULT_CURSOR_HEIGHT;

  const maxY = Math.max(
    containerRect.top,
    containerRect.bottom - Math.min(safeCursorHeight, containerRect.height),
  );
  const clampedX = clamp(x, containerRect.left, containerRect.right);
  const clampedY = clamp(y, containerRect.top, maxY);
  const rawBottom = isFiniteNumber(cursorBottom)
    ? cursorBottom
    : clampedY + safeCursorHeight;
  const clampedBottom = clamp(
    rawBottom,
    clampedY,
    containerRect.bottom,
  );

  const showAbove =
    clampedBottom + suggestionHeight + gap > containerRect.bottom &&
    clampedY - suggestionHeight - gap >= containerRect.top;

  return {
    x: clampedX,
    y: clampedY,
    cursorHeight: safeCursorHeight,
    cursorBottom: clampedBottom,
    showAbove,
  };
};

module.exports = {
  isUsableRect,
  buildCommandSuggestionCursorPosition,
};
