import { useCallback, useEffect, useRef } from "react";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const CURSOR_BY_MODE = {
  both: "nwse-resize",
  height: "ns-resize",
  width: "ew-resize",
};

/**
 * 右下角浮窗的拖拽调整尺寸 Hook（左边缘 / 上边缘手柄）。
 * TransferSidebar（仅宽度）与 AIChatWindow（宽 / 高 / 双向）共用。
 *
 * @param {object} options
 * @param {Function} options.getStart 拖拽开始时返回 { width, height } 起始值
 * @param {Function} options.getBounds 拖拽开始时返回
 *   { minWidth, maxWidth, minHeight, maxHeight }（仅需提供启用轴的边界）
 * @param {Function} options.onResize 每次移动回调 { width?, height? }（仅包含启用的轴）
 * @param {Function} [options.onStateChange] 拖拽状态变化回调 (mode | null)
 * @param {Function} [options.onEnd] 拖拽结束回调（{ width, height } 最终值）
 * @param {boolean} [options.stopPropagation] mousedown 时是否阻止事件冒泡
 * @param {boolean} [options.manageBodyStyles] 是否接管 body 的 cursor / userSelect
 * @returns {Function} startResize(mode) => onMouseDown handler，
 *   mode: "width" | "height" | "both"
 */
export default function useDragResize({
  getStart,
  getBounds,
  onResize,
  onStateChange,
  onEnd,
  stopPropagation = false,
  manageBodyStyles = false,
}) {
  const optionsRef = useRef(null);
  optionsRef.current = { getStart, getBounds, onResize, onStateChange, onEnd };

  const listenersRef = useRef({ move: null, up: null });

  const clearListeners = useCallback(() => {
    const { move, up } = listenersRef.current;
    if (move) {
      document.removeEventListener("mousemove", move);
    }
    if (up) {
      document.removeEventListener("mouseup", up);
    }
    listenersRef.current = { move: null, up: null };
    if (manageBodyStyles) {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
  }, [manageBodyStyles]);

  useEffect(() => () => clearListeners(), [clearListeners]);

  const startResize = useCallback(
    (mode) => (e) => {
      e.preventDefault();
      if (stopPropagation) {
        e.stopPropagation();
      }
      clearListeners();
      optionsRef.current.onStateChange?.(mode);

      const startX = e.clientX;
      const startY = e.clientY;
      const start = optionsRef.current.getStart() || {};
      const bounds = optionsRef.current.getBounds() || {};
      let latestWidth = start.width;
      let latestHeight = start.height;

      const handleMouseMove = (moveEvent) => {
        const next = {};
        if (mode === "width" || mode === "both") {
          const deltaX = startX - moveEvent.clientX;
          latestWidth = clamp(
            start.width + deltaX,
            bounds.minWidth,
            bounds.maxWidth,
          );
          next.width = latestWidth;
        }
        if (mode === "height" || mode === "both") {
          const deltaY = startY - moveEvent.clientY;
          latestHeight = clamp(
            start.height + deltaY,
            bounds.minHeight,
            bounds.maxHeight,
          );
          next.height = latestHeight;
        }
        optionsRef.current.onResize?.(next);
      };

      const handleMouseUp = () => {
        optionsRef.current.onStateChange?.(null);
        clearListeners();
        optionsRef.current.onEnd?.({
          width: latestWidth,
          height: latestHeight,
        });
      };

      listenersRef.current = { move: handleMouseMove, up: handleMouseUp };
      if (manageBodyStyles) {
        document.body.style.userSelect = "none";
        document.body.style.cursor = CURSOR_BY_MODE[mode] || "ew-resize";
      }
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [clearListeners, manageBodyStyles, stopPropagation],
  );

  return startResize;
}
