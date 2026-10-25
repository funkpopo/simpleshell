import { useCallback, useRef } from "react";

/**
 * 返回身份恒定的回调，调用时总是执行最新一次渲染传入的函数。
 *
 * 用于把每次渲染都会重建的处理函数传给 memo 过的列表行：行组件不再因为
 * 回调引用变化而整列表重渲染，同时也不会读到过期的闭包状态。
 * 仅适用于事件处理等渲染之外调用的回调。
 */
export default function useStableCallback(callback) {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...args) => callbackRef.current?.(...args), []);
}
