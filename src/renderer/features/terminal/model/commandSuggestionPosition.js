const CONTAINER_PADDING = 8;
// 弹窗与光标行之间的间距：只留一条细缝，紧贴输入行但绝不覆盖它
const CURSOR_GAP = 4;

/** 建议弹窗尺寸口径（CommandSuggestion.jsx 与 useTerminalSuggestions.js 共用，避免双源漂移）。
 *  注意：本文件被 tests/unit/terminalSuggestionLayout.test.js 以 require() 导入，
 *  必须保持 CommonJS（module.exports），不要改用 ESM export。 */
const SUGGESTION_ITEM_HEIGHT = 28;
const SUGGESTION_BOTTOM_BAR_HEIGHT = 24;
// Paper 上下 1px 边框，计入总高度，否则最后一行会被裁掉 2px
const SUGGESTION_FRAME_BORDER = 2;
const SUGGESTION_MAX_HEIGHT = 280;
// 至少能完整显示一行建议，否则宁可不显示，避免出现残缺的细条
const SUGGESTION_MIN_HEIGHT = SUGGESTION_ITEM_HEIGHT + SUGGESTION_FRAME_BORDER;
// 偏好方向只要还能舒适地显示 3 行就保持不变，避免随条目数变化上下跳动
const SUGGESTION_COMFORT_HEIGHT =
  SUGGESTION_ITEM_HEIGHT * 3 +
  SUGGESTION_BOTTOM_BAR_HEIGHT +
  SUGGESTION_FRAME_BORDER;

const getSuggestionWindowHeight = (count = 0) =>
  Math.min(
    Math.max(0, count) * SUGGESTION_ITEM_HEIGHT +
      SUGGESTION_BOTTOM_BAR_HEIGHT +
      SUGGESTION_FRAME_BORDER,
    SUGGESTION_MAX_HEIGHT,
  );

const isFiniteNumber = (value) =>
  typeof value === "number" && Number.isFinite(value);

const resolveCommandSuggestionWindowPosition = ({
  position = null,
  windowDimensions = null,
  terminalRect = null,
  windowWidth = 0,
  windowHeight = 0,
  preferAbove = null,
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

  const suggestionWidth = Math.max(1, windowDimensions.width);
  const suggestionHeight = Math.max(1, windowDimensions.height);

  const bounds = {
    left: Math.max(0, terminalRect.left) + CONTAINER_PADDING,
    top: Math.max(0, terminalRect.top) + CONTAINER_PADDING,
    right: Math.min(windowWidth, terminalRect.right) - CONTAINER_PADDING,
    bottom: Math.min(windowHeight, terminalRect.bottom) - CONTAINER_PADDING,
  };

  if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) {
    return null;
  }

  const cursorTop = position.y;
  const cursorBottom = Math.max(cursorTop, position.cursorBottom);

  // 两侧可用空间都已扣除容器内边距，按此尺寸摆放后不会再触发二次钳制，
  // 因此弹窗永远不会被挤回光标所在行上方/下方而遮住正在输入的命令。
  const spaceBelow = Math.max(0, bounds.bottom - cursorBottom - CURSOR_GAP);
  const spaceAbove = Math.max(0, cursorTop - bounds.top - CURSOR_GAP);

  const preferredAbove =
    typeof preferAbove === "boolean"
      ? preferAbove
      : Boolean(position.showAbove);
  const preferredSpace = preferredAbove ? spaceAbove : spaceBelow;
  const otherSpace = preferredAbove ? spaceBelow : spaceAbove;

  let showAbove;
  if (preferredSpace >= suggestionHeight) {
    showAbove = preferredAbove;
  } else if (otherSpace >= suggestionHeight) {
    showAbove = !preferredAbove;
  } else if (
    preferredSpace >= Math.min(suggestionHeight, SUGGESTION_COMFORT_HEIGHT)
  ) {
    showAbove = preferredAbove;
  } else {
    showAbove = spaceAbove > spaceBelow;
  }

  const sideSpace = showAbove ? spaceAbove : spaceBelow;
  const height = Math.min(suggestionHeight, sideSpace);
  if (height < Math.min(suggestionHeight, SUGGESTION_MIN_HEIGHT)) {
    return null;
  }

  const width = Math.min(suggestionWidth, bounds.right - bounds.left);
  const anchorX = isFiniteNumber(position.anchorX)
    ? position.anchorX
    : position.x;
  const left = Math.max(bounds.left, Math.min(anchorX, bounds.right - width));
  const top = showAbove
    ? cursorTop - CURSOR_GAP - height
    : cursorBottom + CURSOR_GAP;

  return { left, top, width, height, showAbove };
};

/**
 * 在已分配的窗口区域内排布列表与提示栏，并返回实际渲染高度。
 * 提示栏是否显示只取决于剩余空间（不取决于条目数量），且贴近光标的一边
 * 始终按实际高度对齐：弹窗在上方时底边固定在光标上方 CURSOR_GAP 处，
 * 内容比分配区域矮时也不会在弹窗与输入行之间留下空隙。
 */
const resolveCommandSuggestionFrameLayout = ({
  windowPosition,
  itemCount = 0,
} = {}) => {
  const innerHeight = windowPosition.height - SUGGESTION_FRAME_BORDER;
  const contentHeight = Math.max(0, itemCount) * SUGGESTION_ITEM_HEIGHT;
  // 空间不足时优先保证建议条目可见（至少两行，或全部条目），其次才是提示栏
  const showFooter =
    innerHeight - SUGGESTION_BOTTOM_BAR_HEIGHT >=
    Math.min(contentHeight, SUGGESTION_ITEM_HEIGHT * 2);
  const listMaxHeight = Math.max(
    SUGGESTION_ITEM_HEIGHT,
    innerHeight - (showFooter ? SUGGESTION_BOTTOM_BAR_HEIGHT : 0),
  );
  const listHeight = Math.min(contentHeight, listMaxHeight);
  const height =
    listHeight +
    (showFooter ? SUGGESTION_BOTTOM_BAR_HEIGHT : 0) +
    SUGGESTION_FRAME_BORDER;
  const top = windowPosition.showAbove
    ? windowPosition.top + windowPosition.height - height
    : windowPosition.top;

  return {
    top,
    height,
    listHeight,
    listScrollable: contentHeight > listHeight,
    showFooter,
  };
};

module.exports = {
  SUGGESTION_ITEM_HEIGHT,
  SUGGESTION_BOTTOM_BAR_HEIGHT,
  SUGGESTION_FRAME_BORDER,
  SUGGESTION_MAX_HEIGHT,
  CURSOR_GAP,
  getSuggestionWindowHeight,
  resolveCommandSuggestionWindowPosition,
  resolveCommandSuggestionFrameLayout,
};
