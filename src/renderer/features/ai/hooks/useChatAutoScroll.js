import { useCallback, useEffect, useRef, useState } from "react";

// 消息列表滚动：新消息时滚到底部、从最小化恢复时立即滚到底部、点状导航跳转。
export default function useChatAutoScroll({ messages, windowState }) {
  const [prevWindowState, setPrevWindowState] = useState(null);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const messageRefsMap = useRef({});

  // 滚动到指定消息
  const scrollToMessage = useCallback((messageId) => {
    const messageEl = messageRefsMap.current[messageId];
    if (messageEl && messagesContainerRef.current) {
      messageEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  // 滚动到底部
  const scrollToBottom = useCallback((instant = false) => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop =
        messagesContainerRef.current.scrollHeight;
    } else {
      messagesEndRef.current?.scrollIntoView({
        behavior: instant ? "instant" : "smooth",
      });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 监听窗口状态变化，从最小化恢复时滚动到底部
  useEffect(() => {
    if (prevWindowState === "minimized" && windowState === "visible") {
      // 延迟一帧确保DOM已更新
      requestAnimationFrame(() => {
        scrollToBottom(true);
      });
    }
    setPrevWindowState(windowState);
  }, [windowState, prevWindowState, scrollToBottom]);

  return {
    messagesEndRef,
    messagesContainerRef,
    messageRefsMap,
    scrollToMessage,
  };
}
