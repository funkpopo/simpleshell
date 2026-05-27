const CONTAINER_PADDING = 8;
const CURSOR_GAP = 20;

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const resolveCommandSuggestionWindowPosition = ({
  position = null,
  windowDimensions = null,
  terminalRect = null,
  windowWidth = 0,
  windowHeight = 0,
} = {}) => {
  if (!position || !terminalRect) {
    return null;
  }

  if (
    !isFiniteNumber(position.x) ||
    !isFiniteNumber(position.y) ||
    !isFiniteNumber(position.cursorHeight) ||
    !isFiniteNumber(position.cursorBottom)
  ) {
    return null;
  }

  if (
    !isFiniteNumber(terminalRect.left) ||
    !isFiniteNumber(terminalRect.top) ||
    !isFiniteNumber(terminalRect.right) ||
    !isFiniteNumber(terminalRect.bottom) ||
    terminalRect.right <= terminalRect.left ||
    terminalRect.bottom <= terminalRect.top
  ) {
    return null;
  }

  if (
    !isFiniteNumber(windowWidth) ||
    !isFiniteNumber(windowHeight) ||
    windowWidth <= 0 ||
    windowHeight <= 0 ||
    !isFiniteNumber(windowDimensions?.width) ||
    !isFiniteNumber(windowDimensions?.height) ||
    windowDimensions.width <= 0 ||
    windowDimensions.height <= 0
  ) {
    return null;
  }

  const viewportWidth = windowWidth;
  const viewportHeight = windowHeight;
  const suggestionWidth = Math.max(1, windowDimensions.width);
  const suggestionHeight = Math.max(1, windowDimensions.height);

  let left = position.x;
  let top = position.y;

  const bounds = {
    left: Math.max(0, terminalRect.left),
    top: Math.max(0, terminalRect.top),
    right: Math.min(viewportWidth, terminalRect.right),
    bottom: Math.min(viewportHeight, terminalRect.bottom),
  };

  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return null;
  }

  const cursorBottom = position.cursorBottom;

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
      const flippedTop = position.y - height - CURSOR_GAP;
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
