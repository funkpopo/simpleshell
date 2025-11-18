import { useEffect, useRef, useCallback } from "react";
import { useEventManager } from "../core/utils/eventManager.js";

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
  const eventManager = useEventManager();
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
      options
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
  const eventManager = useEventManager();
  const handlersRef = useRef(eventHandlers);

  // 保持 handlers 引用最新
  useEffect(() => {
    handlersRef.current = eventHandlers;
  }, [eventHandlers]);

  useEffect(() => {
    if (!eventHandlers || typeof eventHandlers !== 'object') {
      return;
    }

    const removeListeners = [];

    // 为每个事件添加监听器
    Object.entries(eventHandlers).forEach(([eventName, handler]) => {
      if (eventName && typeof handler === 'function') {
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
          options
        );

        removeListeners.push(removeListener);
      }
    });

    // 清理所有监听器
    return () => {
      removeListeners.forEach(remove => remove?.());
    };
  }, [eventManager, options]);
}

/**
 * 自定义 Hook：监听 DOM 元素事件
 *
 * @param {React.RefObject} elementRef - DOM 元素的 ref
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {Object} options - 事件监听选项
 *
 * @example
 * const scrollerRef = useRef(null);
 * useElementEvent(scrollerRef, 'wheel', handleWheel, { passive: false });
 */
export function useElementEvent(elementRef, eventName, handler, options = {}) {
  const eventManager = useEventManager();
  const handlerRef = useRef(handler);

  // 保持 handler 引用最新
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    const element = elementRef?.current;
    if (!element || !eventName || !handlerRef.current) {
      return;
    }

    // 使用稳定的 handler 引用
    const stableHandler = (...args) => handlerRef.current?.(...args);

    const removeListener = eventManager.addEventListener(
      element,
      eventName,
      stableHandler,
      options
    );

    return removeListener;
  }, [eventManager, elementRef, eventName, options]);
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
export function useConditionalWindowEvent(eventName, handler, enabled = true, options = {}) {
  const eventManager = useEventManager();
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
      options
    );

    return removeListener;
  }, [eventManager, eventName, enabled, options]);
}

/**
 * 自定义 Hook：监听自定义事件并提供发射函数
 *
 * @param {string} eventName - 自定义事件名称
 * @param {Function} handler - 事件处理函数
 *
 * @returns {Function} emit - 发射事件的函数
 *
 * @example
 * // 在组件 A 中监听
 * useCustomEvent('dataUpdated', (event) => {
 *   console.log('Data:', event.detail);
 * });
 *
 * // 在组件 B 中发射
 * const emitDataUpdated = useCustomEventEmitter('dataUpdated');
 * emitDataUpdated({ id: 1, name: 'Test' });
 */
export function useCustomEvent(eventName, handler) {
  useWindowEvent(eventName, handler);
}

/**
 * 自定义 Hook：创建自定义事件发射器
 *
 * @param {string} eventName - 自定义事件名称
 * @returns {Function} emit - 发射事件的函数
 */
export function useCustomEventEmitter(eventName) {
  return useCallback((detail) => {
    const event = new CustomEvent(eventName, { detail });
    window.dispatchEvent(event);
  }, [eventName]);
}

/**
 * 自定义 Hook：节流的 window 事件监听
 *
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {number} delay - 节流延迟（毫秒）
 * @param {Object} options - 事件监听选项
 *
 * @example
 * // resize 事件节流处理
 * useThrottledWindowEvent('resize', handleResize, 200);
 */
export function useThrottledWindowEvent(eventName, handler, delay = 200, options = {}) {
  const eventManager = useEventManager();
  const handlerRef = useRef(handler);
  const lastCallRef = useRef(0);
  const timeoutRef = useRef(null);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!eventName || !handlerRef.current) {
      return;
    }

    const throttledHandler = (...args) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallRef.current;

      if (timeSinceLastCall >= delay) {
        lastCallRef.current = now;
        handlerRef.current?.(...args);
      } else {
        // 确保最后一次调用会被执行
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          lastCallRef.current = Date.now();
          handlerRef.current?.(...args);
        }, delay - timeSinceLastCall);
      }
    };

    const removeListener = eventManager.addEventListener(
      window,
      eventName,
      throttledHandler,
      options
    );

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      removeListener();
    };
  }, [eventManager, eventName, delay, options]);
}

/**
 * 自定义 Hook：防抖的 window 事件监听
 *
 * @param {string} eventName - 事件名称
 * @param {Function} handler - 事件处理函数
 * @param {number} delay - 防抖延迟（毫秒）
 * @param {Object} options - 事件监听选项
 *
 * @example
 * // scroll 事件防抖处理
 * useDebouncedWindowEvent('scroll', handleScroll, 300);
 */
export function useDebouncedWindowEvent(eventName, handler, delay = 300, options = {}) {
  const eventManager = useEventManager();
  const handlerRef = useRef(handler);
  const timeoutRef = useRef(null);

  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!eventName || !handlerRef.current) {
      return;
    }

    const debouncedHandler = (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        handlerRef.current?.(...args);
      }, delay);
    };

    const removeListener = eventManager.addEventListener(
      window,
      eventName,
      debouncedHandler,
      options
    );

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      removeListener();
    };
  }, [eventManager, eventName, delay, options]);
}
