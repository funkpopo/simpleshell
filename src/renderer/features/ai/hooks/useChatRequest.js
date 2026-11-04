import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  generateSystemPrompt,
  generateMemoryContext,
} from "../lib/aiSystemPrompt";
import {
  hasConfiguredApiKey,
  buildInlineApiKeyPayload,
} from "../lib/aiKeyUtils.js";
import {
  createApiResponseError,
  formatBriefApiError,
} from "../lib/aiApiErrors.js";

// AI 请求生命周期：发送（流式/非流式）、流事件订阅与清理、中断、
// 编辑/重试截断历史、清空对话。消息、输入与错误状态由调用方持有。
export default function useChatRequest({
  sessionKey,
  connectionInfo,
  currentApi,
  messages,
  setMessages,
  input,
  setInput,
  setError,
  isPending,
  startTransition,
  inputRef,
}) {
  const { t, i18n } = useTranslation();
  const [abortController, setAbortController] = useState(null);
  const streamHandlersRef = useRef({});
  const activeRequestRef = useRef(null);

  const cleanupStreamHandlers = useCallback((sessionId) => {
    if (!sessionId) {
      return;
    }

    const handlers = streamHandlersRef.current[sessionId];
    if (!handlers) {
      return;
    }

    handlers.unsubscribeChunk?.();
    handlers.unsubscribeEnd?.();
    handlers.unsubscribeError?.();
    delete streamHandlersRef.current[sessionId];
  }, []);

  const cancelActiveRequest = useCallback(() => {
    const request = activeRequestRef.current;
    if (!request) return;
    activeRequestRef.current = null;
    request.controller.abort();
    cleanupStreamHandlers(request.id);
    if (request.sent) {
      void window.terminalAPI
        .cancelAPIRequest(request.id)
        .catch((error) => console.warn("Failed to cancel AI request:", error));
    }
  }, [cleanupStreamHandlers]);

  useEffect(
    () => () => {
      cancelActiveRequest();
      Object.keys(streamHandlersRef.current).forEach(cleanupStreamHandlers);
    },
    [cancelActiveRequest, cleanupStreamHandlers],
  );

  const markAssistantMessageComplete = (messageId) => {
    startTransition(() => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === messageId
            ? {
                ...message,
                isStreaming: false,
              }
            : message,
        ),
      );
    });
  };

  const sendMessageContent = async (
    content,
    historyMessages = messages,
    options = {},
  ) => {
    const trimmedContent = content.trim();
    if (!trimmedContent || isPending || activeRequestRef.current) return;

    // 在执行任何操作之前验证 API 配置
    if (
      !currentApi ||
      !currentApi.apiUrl ||
      !hasConfiguredApiKey(currentApi) ||
      !currentApi.model
    ) {
      setError(t("ai.noApiConfigured"));
      return;
    }

    const requestTimestamp = Date.now();
    const userMessage = {
      id: requestTimestamp,
      role: "user",
      content: trimmedContent,
      timestamp: new Date(),
    };

    setMessages((prev) =>
      options.replaceHistory
        ? [...historyMessages, userMessage]
        : [...prev, userMessage],
    );
    if (options.clearInput) {
      setInput("");
    }
    setError("");

    const controller = new AbortController();
    const request = {
      id: `ai_${sessionKey}_${crypto.randomUUID()}`,
      controller,
      sent: false,
    };
    activeRequestRef.current = request;
    setAbortController(controller);
    let activeAssistantMessageId = null;

    try {
      // 加载记忆文件
      const memory = await window.terminalAPI.loadMemory();
      if (controller.signal.aborted || activeRequestRef.current !== request)
        return;

      // 生成系统提示词
      let systemPrompt = generateSystemPrompt({
        language: i18n.language,
        connectionInfo: connectionInfo,
      });

      // 如果有记忆，注入到系统提示词开头
      if (memory) {
        systemPrompt =
          generateMemoryContext(memory, i18n.language) + systemPrompt;
      }

      // 构建消息列表，包含系统提示词
      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...historyMessages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessage.content },
      ];

      const requestData = {
        sessionId: request.id,
        apiConfigId: currentApi.id || undefined,
        url: currentApi.apiUrl,
        ...buildInlineApiKeyPayload(currentApi),
        model: currentApi.model,
        provider: currentApi.provider || "openai",
        messages: apiMessages,
        stream: currentApi.streamEnabled !== false,
      };

      if (currentApi.streamEnabled !== false) {
        // 流式响应
        const assistantMessage = {
          id: requestTimestamp + 1,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        };
        activeAssistantMessageId = assistantMessage.id;
        setMessages((prev) => [...prev, assistantMessage]);

        // 生成会话ID
        const sessionId = request.id;
        requestData.sessionId = sessionId;

        // 设置流式事件监听器
        const handleStreamChunk = (event, data) => {
          if (
            data.sessionId === sessionId &&
            activeRequestRef.current === request &&
            !controller.signal.aborted
          ) {
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (lastMessage && lastMessage.id === assistantMessage.id) {
                lastMessage.content += data.chunk;
              }
              return newMessages;
            });
          }
        };

        const handleStreamEnd = (event, data) => {
          if (
            data.sessionId === sessionId &&
            activeRequestRef.current === request &&
            !controller.signal.aborted
          ) {
            startTransition(() => {
              setMessages((prev) => {
                const newMessages = [...prev];
                const lastMessage = newMessages[newMessages.length - 1];
                if (lastMessage && lastMessage.id === assistantMessage.id) {
                  lastMessage.isStreaming = false;
                }
                return newMessages;
              });
            });
            activeRequestRef.current = null;
            setAbortController(null);
            // 清理监听器
            cleanupStreamHandlers(sessionId);
          }
        };

        const handleStreamError = (event, data) => {
          if (
            data.sessionId === sessionId &&
            activeRequestRef.current === request &&
            !controller.signal.aborted
          ) {
            markAssistantMessageComplete(assistantMessage.id);
            setError(formatBriefApiError(data.error, t("ai.requestFailed")));
            activeRequestRef.current = null;
            setAbortController(null);
            cleanupStreamHandlers(sessionId);
          }
        };

        // 注册监听器
        const unsubscribeChunk =
          window.terminalAPI.onAIStreamChunk(handleStreamChunk);
        const unsubscribeEnd =
          window.terminalAPI.onAIStreamEnd(handleStreamEnd);
        const unsubscribeError =
          window.terminalAPI.onAIStreamError(handleStreamError);

        // 保存监听器引用
        streamHandlersRef.current[sessionId] = {
          chunk: handleStreamChunk,
          end: handleStreamEnd,
          error: handleStreamError,
          unsubscribeChunk,
          unsubscribeEnd,
          unsubscribeError,
        };

        // 请求 ID 同时用于流事件路由和精确取消。
        request.sent = true;

        const response = await window.terminalAPI.sendAPIRequest(
          requestData,
          true,
        );

        if (controller.signal.aborted || activeRequestRef.current !== request)
          return;
        if (response && response.error) {
          // 清理监听器
          cleanupStreamHandlers(sessionId);
          throw createApiResponseError(response, t("ai.requestFailed"));
        }
      } else {
        // 非流式响应
        request.sent = true;
        const response = await window.terminalAPI.sendAPIRequest(
          requestData,
          false,
        );

        if (controller.signal.aborted || activeRequestRef.current !== request)
          return;
        if (response && response.content) {
          const assistantMessage = {
            id: Date.now() + 1,
            role: "assistant",
            content: response.content,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, assistantMessage]);
        } else if (response && response.error) {
          throw createApiResponseError(response, t("ai.requestFailed"));
        } else {
          throw new Error(t("ai.unknownError"));
        }
      }
    } catch (err) {
      if (controller.signal.aborted || activeRequestRef.current !== request)
        return;
      activeRequestRef.current = null;
      setAbortController(null);
      cleanupStreamHandlers(request.id);
      if (activeAssistantMessageId) {
        markAssistantMessageComplete(activeAssistantMessageId);
      }
      if (err.name !== "AbortError") {
        setError(formatBriefApiError(err, t("ai.requestFailed")));
      }
    } finally {
      if (
        currentApi?.streamEnabled === false &&
        activeRequestRef.current === request
      ) {
        activeRequestRef.current = null;
        setAbortController(null);
      }
    }
  };

  // 发送消息
  const handleSendMessage = async () => {
    await sendMessageContent(input, messages, { clearInput: true });
  };

  const clearMemoryAfterTruncate = async () => {
    if (window.terminalAPI?.deleteMemory) {
      try {
        await window.terminalAPI.deleteMemory();
      } catch (err) {
        console.error("Failed to reset AI memory after truncating chat:", err);
      }
    }
  };

  const handleEditMessage = async (message) => {
    if (message.role !== "user" || isPending || abortController) {
      return;
    }

    const messageIndex = messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) {
      return;
    }

    setInput(message.content);
    setError("");
    setMessages((prev) => prev.slice(0, messageIndex));
    await clearMemoryAfterTruncate();
    requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  };

  const handleRetryMessage = async (message) => {
    if (message.role !== "user" || isPending || abortController) {
      return;
    }

    const messageIndex = messages.findIndex((item) => item.id === message.id);
    if (messageIndex < 0) {
      return;
    }

    const historyMessages = messages.slice(0, messageIndex);
    await clearMemoryAfterTruncate();
    setError("");
    await sendMessageContent(message.content, historyMessages, {
      replaceHistory: true,
    });
  };

  // 中断请求
  const handleAbortRequest = () => {
    if (abortController) {
      cancelActiveRequest();
      setAbortController(null);

      // 标记最后一条消息为非流式状态
      startTransition(() => {
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (
            lastMessage &&
            lastMessage.role === "assistant" &&
            lastMessage.isStreaming
          ) {
            lastMessage.isStreaming = false;
          }
          return newMessages;
        });
      });
    }
  };

  // 清空对话
  const handleClearChat = async () => {
    cancelActiveRequest();
    setAbortController(null);
    setMessages([]);
    setError("");
    // 删除记忆文件
    if (window.terminalAPI?.deleteMemory) {
      await window.terminalAPI.deleteMemory();
    }
  };

  return {
    abortController,
    cancelActiveRequest,
    handleSendMessage,
    handleEditMessage,
    handleRetryMessage,
    handleAbortRequest,
    handleClearChat,
  };
}
