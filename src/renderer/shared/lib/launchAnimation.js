import { Zoom } from "@mui/material";

const transitionProps = (anchorEl) => {
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

  if (prefersReducedMotion) {
    return { timeout: 0 };
  }

  if (!anchorEl) {
    return { timeout: 250 };
  }

  // 获取锚点元素的位置
  const rect = anchorEl.getBoundingClientRect();
  const anchorX = rect.left + rect.width / 2;
  const anchorY = rect.top + rect.height / 2;

  return {
    timeout: 250,
    style: {
      transformOrigin: `${anchorX}px ${anchorY}px`,
    },
  };
};

/**
 * 从指定元素位置展开的 Dialog 过渡（MUI v9 slots 写法）。
 * MUI v9 已移除 TransitionComponent / TransitionProps，过渡必须经由
 * `slots.transition` 与 `slotProps.transition` 传入；其余 slotProps 一并合并，
 * 避免展开时覆盖调用方的 slotProps。
 * @param {HTMLElement|null} anchorEl - 锚点元素（通常是触发按钮）
 * @param {Object} [slotProps] - 需要一并传给 Dialog 的其他 slotProps
 * @returns {{slots: Object, slotProps: Object}}
 */
export const createAnchoredTransition = (anchorEl, slotProps = {}) => ({
  slots: { transition: Zoom },
  slotProps: {
    ...slotProps,
    transition: {
      ...(slotProps.transition || {}),
      ...transitionProps(anchorEl),
    },
  },
});
