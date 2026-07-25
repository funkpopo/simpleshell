/**
 * Logical command-block model for WebTerminal (Warp-style, still on xterm).
 * Blocks are bounded by "command submit → next prompt ready".
 * CommonJS so static check scripts can require() pure helpers.
 */

const COMMAND_BLOCK_STATUS = Object.freeze({
  RUNNING: "running",
  SUCCESS: "success",
  FAILED: "failed",
  UNKNOWN: "unknown",
  CANCELLED: "cancelled",
});

/** Hard cap for retained blocks under large scrollback. */
const MAX_COMMAND_BLOCKS = 200;

let blockIdCounter = 0;

const createCommandBlockId = () => {
  blockIdCounter += 1;
  return `cmd-block-${Date.now()}-${blockIdCounter}`;
};

/**
 * Absolute buffer line index for the current cursor (viewport-relative → absolute).
 */
const getAbsoluteCursorLine = (term) => {
  const buffer = term?.buffer?.active;
  if (!buffer) {
    return 0;
  }
  return (Number(buffer.baseY) || 0) + (Number(buffer.cursorY) || 0);
};

/**
 * Register an xterm marker at the current cursor line (auto-tracks scrollback trim).
 * Returns null when markers are unavailable.
 */
const registerCursorMarker = (term) => {
  if (!term || typeof term.registerMarker !== "function") {
    return null;
  }
  try {
    return term.registerMarker(0);
  } catch {
    return null;
  }
};

const disposeMarker = (marker) => {
  if (!marker || marker.isDisposed) {
    return;
  }
  try {
    if (typeof marker.dispose === "function") {
      marker.dispose();
    }
  } catch {
    /* intentionally ignored */
  }
};

const resolveBlockLine = (block, which = "start") => {
  if (!block) {
    return null;
  }
  const marker = which === "end" ? block.endMarker : block.startMarker;
  if (marker && !marker.isDisposed && typeof marker.line === "number") {
    return marker.line;
  }
  const fallback = which === "end" ? block.endLine : block.startLine;
  return typeof fallback === "number" ? fallback : null;
};

/**
 * Drop blocks whose start markers were trimmed from scrollback, then enforce max size.
 */
const pruneCommandBlocks = (blocks, { max = MAX_COMMAND_BLOCKS } = {}) => {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return [];
  }

  const kept = [];
  for (const block of blocks) {
    if (block?.startMarker?.isDisposed) {
      disposeMarker(block.endMarker);
      continue;
    }
    kept.push(block);
  }

  if (kept.length <= max) {
    return kept;
  }

  const overflow = kept.length - max;
  for (let i = 0; i < overflow; i += 1) {
    disposeMarker(kept[i]?.startMarker);
    disposeMarker(kept[i]?.endMarker);
  }
  return kept.slice(overflow);
};

const createCommandBlock = (term, command, options = {}) => {
  const startMarker = registerCursorMarker(term);
  const startLine =
    startMarker && typeof startMarker.line === "number"
      ? startMarker.line
      : getAbsoluteCursorLine(term);

  return {
    id: options.id || createCommandBlockId(),
    command: String(command || "").trim(),
    startLine,
    endLine: null,
    startedAt: options.startedAt || Date.now(),
    endedAt: null,
    status: COMMAND_BLOCK_STATUS.RUNNING,
    exitCode: null,
    folded: false,
    startMarker,
    endMarker: null,
  };
};

const completeCommandBlock = (
  block,
  term,
  {
    status = COMMAND_BLOCK_STATUS.SUCCESS,
    exitCode = null,
    endedAt = Date.now(),
  } = {},
) => {
  if (!block) {
    return null;
  }

  const endMarker = registerCursorMarker(term);
  const endLine =
    endMarker && typeof endMarker.line === "number"
      ? endMarker.line
      : getAbsoluteCursorLine(term);

  return {
    ...block,
    endMarker: endMarker || block.endMarker,
    endLine,
    endedAt,
    status,
    exitCode,
  };
};

const disposeCommandBlock = (block) => {
  if (!block) {
    return;
  }
  disposeMarker(block.startMarker);
  disposeMarker(block.endMarker);
};

const disposeCommandBlocks = (blocks) => {
  if (!Array.isArray(blocks)) {
    return;
  }
  for (const block of blocks) {
    disposeCommandBlock(block);
  }
};

/**
 * Map absolute buffer line → pixel top/height relative to a container rect.
 * Returns null when the line is outside the current viewport.
 */
const mapBufferLineToViewport = (term, absoluteLine, containerRect) => {
  if (!term?.buffer?.active || typeof absoluteLine !== "number") {
    return null;
  }

  const buffer = term.buffer.active;
  const viewportY = Number(buffer.viewportY) || 0;
  const rows = Math.max(1, Number(term.rows) || 1);
  const rowInViewport = absoluteLine - viewportY;

  if (rowInViewport < -1 || rowInViewport >= rows + 1) {
    return null;
  }

  let charHeight = 17;
  try {
    const screen =
      term.element?.querySelector(".xterm-screen") ||
      term.element?.querySelector(".xterm-viewport");
    const screenRect = screen?.getBoundingClientRect?.();
    if (screenRect?.height > 0) {
      charHeight = screenRect.height / rows;
    }
  } catch {
    /* intentionally ignored */
  }

  const screen =
    term.element?.querySelector(".xterm-screen") ||
    term.element?.querySelector(".xterm-viewport") ||
    term.element;
  const screenRect = screen?.getBoundingClientRect?.();
  if (!screenRect || !containerRect) {
    return null;
  }

  const top = screenRect.top - containerRect.top + rowInViewport * charHeight;
  return {
    top,
    height: charHeight,
    rowInViewport,
    visible: rowInViewport >= 0 && rowInViewport < rows,
  };
};

const isAlternateOrEditorBuffer = (term, inEditorMode = false) => {
  if (inEditorMode) {
    return true;
  }
  return term?.buffer?.active?.type === "alternate";
};

module.exports = {
  COMMAND_BLOCK_STATUS,
  MAX_COMMAND_BLOCKS,
  createCommandBlockId,
  getAbsoluteCursorLine,
  registerCursorMarker,
  disposeMarker,
  resolveBlockLine,
  pruneCommandBlocks,
  createCommandBlock,
  completeCommandBlock,
  disposeCommandBlock,
  disposeCommandBlocks,
  mapBufferLineToViewport,
  isAlternateOrEditorBuffer,
};
