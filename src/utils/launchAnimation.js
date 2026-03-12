import { Grow } from "@mui/material";
import React, { forwardRef } from "react";

/**
 * 创建从指定元素位置开始的动画过渡组件
 * @param {HTMLElement|null} anchorEl - 锚点元素（通常是触发按钮）
 * @returns {Object} TransitionProps 对象，可直接传递给 Dialog
 */
export const createAnchoredTransition = (anchorEl) => {
  if (!anchorEl) {
    // 如果没有锚点元素，返回默认配置
    return {
      TransitionComponent: Grow,
      TransitionProps: {
        timeout: 225,
      },
    };
  }

  // 获取锚点元素的位置
  const rect = anchorEl.getBoundingClientRect();
  const anchorX = rect.left + rect.width / 2;
  const anchorY = rect.top + rect.height / 2;

  // 创建自定义过渡组件
  const AnchoredGrow = forwardRef((props, ref) => {
    return React.createElement(Grow, {
      ...props,
      ref: ref,
      timeout: 225,
      style: {
        transformOrigin: `${anchorX}px ${anchorY}px`,
      },
    });
  });

  AnchoredGrow.displayName = "AnchoredGrow";

  return {
    TransitionComponent: AnchoredGrow,
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
