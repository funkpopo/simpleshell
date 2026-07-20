import { Zoom } from "@mui/material";

/**
 * 获取从指定元素位置开始的动画过渡配置
 * @param {HTMLElement|null} anchorEl - 锚点元素（通常是触发按钮）
 * @returns {Object} 包含 TransitionComponent 和 TransitionProps 的对象
 */
export const createAnchoredTransition = (anchorEl) => {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (prefersReducedMotion) {
    return {
      TransitionComponent: Zoom,
      TransitionProps: {
        timeout: 0,
      },
    };
  }

  if (!anchorEl) {
    return {
      TransitionComponent: Zoom,
      TransitionProps: {
        timeout: 250,
      },
    };
  }

  // 获取锚点元素的位置
  const rect = anchorEl.getBoundingClientRect();
  const anchorX = rect.left + rect.width / 2;
  const anchorY = rect.top + rect.height / 2;

  return {
    TransitionComponent: Zoom,
    TransitionProps: {
      timeout: 250,
      style: {
        transformOrigin: `${anchorX}px ${anchorY}px`,
      },
    },
  };
};
