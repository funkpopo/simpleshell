import { useEffect, useRef } from "react";
import { useCleanupManager } from "./useAutoCleanup.js";

/**
 * 自定义 Hook：监听 window 事件
 * 统一管理 window 事件监听，避免重复代码和内存泄漏
 *
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {Object} options - 事件监听选项（passive, capture 等）
 *
 * @example
 * // 基本使用
 * useWindowEvent('resize', () => {
 *   console.log('Window resized');
 * });
 *
 * @example
 * // 使用 passive 选项
 * useWindowEvent('scroll', handleScroll, { passive: true });
 *
 * @example
 * // 监听自定义事件
 * useWindowEvent('settingsChanged', (event) => {
 *   console.log('Settings changed:', event.detail);
 * });
 */
export function useWindowEvent(eventName, handler, options = {}) {
  const eventManager = useCleanupManager();
  const handlerRef = useRef(handler);

  // 保持 handler 引用最新，避免闭包问题
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!eventName || !handlerRef.current) {
      return;
    }

    // 使用稳定的 handler 引用
    const stableHandler = (...args) => handlerRef.current?.(...args);

    const removeListener = eventManager.addEventListener(
      window,
      eventName,
      stableHandler,
      options,
    );

    return removeListener;
  }, [eventManager, eventName, options]);
}

/**
 * 自定义 Hook：监听多个 window 事件
 *
 * @param {Object} eventHandlers - 事件名称和处理函数的映射对象
 * @param {Object} options - 全局事件监听选项
 *
 * @example
 * useWindowEvents({
 *   'settingsChanged': handleSettingsChanged,
 *   'toggleGlobalAI': handleToggleGlobalAI,
 *   'sendToAI': handleSendToAI
 * });
 */
export function useWindowEvents(eventHandlers, options = {}) {
  const eventManager = useCleanupManager();
  const handlersRef = useRef(eventHandlers);

  // 保持 handlers 引用最新
  useEffect(() => {
    handlersRef.current = eventHandlers;
  }, [eventHandlers]);

  useEffect(() => {
    if (!eventHandlers || typeof eventHandlers !== "object") {
      return;
    }

    const removeListeners = [];

    // 为每个事件添加监听器
    Object.entries(eventHandlers).forEach(([eventName, handler]) => {
      if (eventName && typeof handler === "function") {
        const stableHandler = (...args) => {
          const currentHandler = handlersRef.current[eventName];
          if (currentHandler) {
            currentHandler(...args);
          }
        };

        const removeListener = eventManager.addEventListener(
          window,
          eventName,
          stableHandler,
          options,
        );

        removeListeners.push(removeListener);
      }
    });

    // 清理所有监听器
    return () => {
      removeListeners.forEach((remove) => remove?.());
    };
  }, [eventManager, options]);
}
/**
 * 自定义 Hook：条件性监听 window 事件
 * 只在条件满足时添加事件监听
 *
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {boolean} enabled - 是否启用监听
 * @param {Object} options - 事件监听选项
 *
 * @example
 * // 仅在对话框打开时监听 ESC 键
 * useConditionalWindowEvent('keydown', handleEscape, dialogOpen);
 */
export function useConditionalWindowEvent(
  eventName,
  handler,
  enabled = true,
  options = {},
) {
  const eventManager = useCleanupManager();
  const handlerRef = useRef(handler);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled || !eventName || !handlerRef.current) {
      return;
    }

    const stableHandler = (...args) => handlerRef.current?.(...args);

    const removeListener = eventManager.addEventListener(
      window,
      eventName,
      stableHandler,
      options,
    );

    return removeListener;
  }, [eventManager, eventName, enabled, options]);
}
