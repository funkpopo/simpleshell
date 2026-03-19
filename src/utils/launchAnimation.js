import { Zoom } from "@mui/material";

/**
 * 获取从指定元素位置开始的动画过渡配置
 * @param {HTMLElement|null} anchorEl - 锚点元素（通常是触发按钮）
 * @returns {Object} 包含 TransitionComponent 和 TransitionProps 的对象
 */
export const createAnchoredTransition = (anchorEl) => {
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

/**
 * 计算从锚点到目标位置的 transform-origin
 * @param {HTMLElement|null} anchorEl - 锚点元素
 * @param {HTMLElement|null} targetEl - 目标元素（Dialog paper）
 * @returns {string} CSS transform-origin 值
 */
export const calculateTransformOrigin = (anchorEl, targetEl) => {
  if (!anchorEl || !targetEl) {
    return "center center";
  }

  const anchorRect = anchorEl.getBoundingClientRect();
  const targetRect = targetEl.getBoundingClientRect();

  // 计算锚点中心相对于目标元素的位置
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;

  const relativeX = anchorCenterX - targetRect.left;
  const relativeY = anchorCenterY - targetRect.top;

  return `${relativeX}px ${relativeY}px`;
};
