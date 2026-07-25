import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { processCache } from "../../../modules/terminal/controller/terminalSessionStore.js";
import {
  COMMAND_BLOCK_STATUS,
  MAX_COMMAND_BLOCKS,
  completeCommandBlock,
  createCommandBlock,
  disposeCommandBlocks,
  isAlternateOrEditorBuffer,
  mapBufferLineToViewport,
  pruneCommandBlocks,
  resolveBlockLine,
} from "./commandBlockModel.js";

/**
 * Logical command blocks + gutter layout sync for WebTerminal.
 * Boundary events are driven by usePromptTracking (submit → next prompt).
 */
export function useCommandBlocks({
  tabId,
  termRef,
  terminalRef,
  inEditorModeRef,
  currentProcessId,
  sendInputToProcess,
  isActive = true,
}) {
  const [blocks, setBlocks] = useState([]);
  const [gutterItems, setGutterItems] = useState([]);
  const [gutterHidden, setGutterHidden] = useState(false);

  const blocksRef = useRef([]);
  const activeBlockIdRef = useRef(null);
  const layoutFrameRef = useRef(null);
  const scrollListenerCleanupRef = useRef(null);

  const setBlocksSafe = useCallback((updater) => {
    setBlocks((previous) => {
      const next =
        typeof updater === "function" ? updater(previous) : updater;
      const pruned = pruneCommandBlocks(next, { max: MAX_COMMAND_BLOCKS });
      blocksRef.current = pruned;
      return pruned;
    });
  }, []);

  const clearBlocks = useCallback(() => {
    disposeCommandBlocks(blocksRef.current);
    blocksRef.current = [];
    activeBlockIdRef.current = null;
    setBlocks([]);
    setGutterItems([]);
  }, []);

  const recomputeGutterLayout = useCallback(() => {
    const term = termRef.current;
    const container = terminalRef.current;
    if (!term || !container || !isActive) {
      setGutterItems([]);
      setGutterHidden(true);
      return;
    }

    const hide =
      isAlternateOrEditorBuffer(term, inEditorModeRef?.current) ||
      blocksRef.current.length === 0;
    setGutterHidden(hide);
    if (hide) {
      setGutterItems([]);
      return;
    }

    const containerRect = container.getBoundingClientRect();
    if (!containerRect?.width || !containerRect?.height) {
      setGutterItems([]);
      return;
    }

    // Drop trimmed markers while recomputing.
    const live = pruneCommandBlocks(blocksRef.current, {
      max: MAX_COMMAND_BLOCKS,
    });
    if (live.length !== blocksRef.current.length) {
      blocksRef.current = live;
      setBlocks(live);
    }

    const items = [];
    for (const block of live) {
      const startLine = resolveBlockLine(block, "start");
      if (startLine == null) {
        continue;
      }
      const mapped = mapBufferLineToViewport(term, startLine, containerRect);
      if (!mapped?.visible) {
        continue;
      }

      let spanHeight = mapped.height;
      const endLine = resolveBlockLine(block, "end");
      if (
        typeof endLine === "number" &&
        endLine >= startLine &&
        !block.folded
      ) {
        const endMapped = mapBufferLineToViewport(term, endLine, containerRect);
        if (endMapped) {
          spanHeight = Math.max(
            mapped.height,
            endMapped.top + endMapped.height - mapped.top,
          );
        }
      }

      items.push({
        id: block.id,
        command: block.command,
        status: block.status,
        folded: Boolean(block.folded),
        exitCode: block.exitCode,
        top: mapped.top,
        height: mapped.height,
        spanHeight,
        isActive: block.id === activeBlockIdRef.current,
      });
    }

    setGutterItems(items);
  }, [inEditorModeRef, isActive, termRef, terminalRef]);

  const scheduleGutterLayout = useCallback(() => {
    if (layoutFrameRef.current != null) {
      return;
    }
    const schedule =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (cb) => setTimeout(cb, 16);
    layoutFrameRef.current = schedule(() => {
      layoutFrameRef.current = null;
      recomputeGutterLayout();
    });
  }, [recomputeGutterLayout]);

  const onCommandStart = useCallback(
    ({ command, term } = {}) => {
      const normalized = String(command || "").trim();
      if (!normalized || !term) {
        return;
      }

      // Close any orphaned running block (e.g. prompt never detected).
      if (activeBlockIdRef.current) {
        setBlocksSafe((previous) =>
          previous.map((block) =>
            block.id === activeBlockIdRef.current &&
            block.status === COMMAND_BLOCK_STATUS.RUNNING
              ? completeCommandBlock(block, term, {
                  status: COMMAND_BLOCK_STATUS.UNKNOWN,
                })
              : block,
          ),
        );
      }

      const block = createCommandBlock(term, normalized);
      activeBlockIdRef.current = block.id;
      setBlocksSafe((previous) => [...previous, block]);
      scheduleGutterLayout();
    },
    [scheduleGutterLayout, setBlocksSafe],
  );

  const onCommandEnd = useCallback(
    ({ term, status, exitCode } = {}) => {
      const activeId = activeBlockIdRef.current;
      if (!activeId) {
        scheduleGutterLayout();
        return;
      }

      setBlocksSafe((previous) =>
        previous.map((block) => {
          if (block.id !== activeId) {
            return block;
          }
          if (block.status !== COMMAND_BLOCK_STATUS.RUNNING) {
            return block;
          }
          return completeCommandBlock(block, term || termRef.current, {
            status: status || COMMAND_BLOCK_STATUS.SUCCESS,
            exitCode: typeof exitCode === "number" ? exitCode : null,
          });
        }),
      );
      activeBlockIdRef.current = null;
      scheduleGutterLayout();
    },
    [scheduleGutterLayout, setBlocksSafe, termRef],
  );

  const onCommandInterrupt = useCallback(() => {
    const activeId = activeBlockIdRef.current;
    if (!activeId) {
      return;
    }
    setBlocksSafe((previous) =>
      previous.map((block) =>
        block.id === activeId &&
        block.status === COMMAND_BLOCK_STATUS.RUNNING
          ? {
              ...block,
              status: COMMAND_BLOCK_STATUS.CANCELLED,
              endedAt: Date.now(),
            }
          : block,
      ),
    );
  }, [setBlocksSafe]);

  const toggleFold = useCallback(
    (blockId) => {
      setBlocksSafe((previous) =>
        previous.map((block) =>
          block.id === blockId
            ? { ...block, folded: !block.folded }
            : block,
        ),
      );
      scheduleGutterLayout();
    },
    [scheduleGutterLayout, setBlocksSafe],
  );

  const copyCommand = useCallback(async (command) => {
    const text = String(command || "");
    if (!text) {
      return false;
    }
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      /* fall through */
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(textarea);
      return ok;
    } catch {
      return false;
    }
  }, []);

  const rerunCommand = useCallback(
    (command) => {
      const text = String(command || "").trim();
      if (!text) {
        return false;
      }

      const processId =
        processCache[tabId] ||
        currentProcessId?.current ||
        null;
      if (processId === undefined || processId === null) {
        return false;
      }

      const commandToSend = `${text}\r`;
      try {
        window.dispatchEvent(
          new CustomEvent("externalCommandSending", {
            detail: {
              tabId,
              command: commandToSend,
              timestamp: Date.now(),
            },
          }),
        );
      } catch {
        /* intentionally ignored */
      }

      if (typeof sendInputToProcess === "function") {
        sendInputToProcess(processId, commandToSend);
        return true;
      }

      if (window.terminalAPI?.sendToProcess) {
        window.terminalAPI.sendToProcess(processId, commandToSend);
        return true;
      }

      return false;
    },
    [currentProcessId, sendInputToProcess, tabId],
  );

  // Attach scroll / render listeners when the terminal element is available.
  useEffect(() => {
    const term = termRef.current;
    if (!term) {
      return undefined;
    }

    const disposables = [];
    if (typeof term.onScroll === "function") {
      const d = term.onScroll(() => scheduleGutterLayout());
      if (d?.dispose) disposables.push(d);
    }
    if (typeof term.onRender === "function") {
      const d = term.onRender(() => scheduleGutterLayout());
      if (d?.dispose) disposables.push(d);
    }
    if (typeof term.onResize === "function") {
      const d = term.onResize(() => scheduleGutterLayout());
      if (d?.dispose) disposables.push(d);
    }

    const viewport = term.element?.querySelector(".xterm-viewport");
    if (viewport && typeof viewport.addEventListener === "function") {
      const onViewportScroll = () => scheduleGutterLayout();
      viewport.addEventListener("scroll", onViewportScroll, { passive: true });
      scrollListenerCleanupRef.current = () => {
        viewport.removeEventListener("scroll", onViewportScroll);
      };
    }

    scheduleGutterLayout();

    return () => {
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          /* intentionally ignored */
        }
      }
      if (scrollListenerCleanupRef.current) {
        scrollListenerCleanupRef.current();
        scrollListenerCleanupRef.current = null;
      }
    };
  }, [scheduleGutterLayout, termRef, blocks.length, isActive]);

  useEffect(() => {
    scheduleGutterLayout();
  }, [isActive, scheduleGutterLayout]);

  useEffect(() => {
    return () => {
      if (layoutFrameRef.current != null) {
        if (typeof cancelAnimationFrame === "function") {
          cancelAnimationFrame(layoutFrameRef.current);
        } else {
          clearTimeout(layoutFrameRef.current);
        }
        layoutFrameRef.current = null;
      }
      disposeCommandBlocks(blocksRef.current);
      blocksRef.current = [];
    };
  }, []);

  const commandBlockCallbacks = useMemo(
    () => ({
      onCommandStart,
      onCommandEnd,
      onCommandInterrupt,
      onReset: clearBlocks,
      onLayout: scheduleGutterLayout,
    }),
    [
      clearBlocks,
      onCommandEnd,
      onCommandInterrupt,
      onCommandStart,
      scheduleGutterLayout,
    ],
  );

  return {
    blocks,
    gutterItems,
    gutterHidden,
    commandBlockCallbacks,
    clearBlocks,
    toggleFold,
    copyCommand,
    rerunCommand,
    scheduleGutterLayout,
    recomputeGutterLayout,
  };
}
