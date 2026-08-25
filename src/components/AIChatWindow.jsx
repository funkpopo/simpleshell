import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  useTransition,
} from "react";
import { createFloatingDialog } from "./styledDialogs.jsx";
import useDragResize from "../hooks/useDragResize.js";
import {
  DialogTitle,
  DialogContent,
  IconButton,
  TextField,
  Box,
  Typography,
  Paper,
  Tooltip,
  Alert,
  Menu,
  MenuItem,
  Chip,
  Divider,
  Collapse,
  FormControlLabel,
  Switch,
  Button,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MinimizeIcon from "@mui/icons-material/Minimize";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AIIcon from "./AIIcon";
import AISettings from "./AISettings";
import ExecutableCommand from "./ExecutableCommand";
import { useTranslation } from "react-i18next";
import { RADIUS } from "../theme";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  generateSystemPrompt,
  generateMemoryContext,
  parseCommandsFromResponse,
  setCustomRiskRules,
} from "../utils/aiSystemPrompt";
import { createAnchoredTransition } from "../utils/launchAnimation.js";
import {
  hasConfiguredApiKey,
  buildInlineApiKeyPayload,
} from "../utils/aiKeyUtils.js";
import "./AIChatWindow.css";
import "./CodeHighlight.css";

const MAX_MARKDOWN_LINK_LENGTH = 2048;
const API_ERROR_SUMMARY_MAX_LENGTH = 180;
const ALLOWED_MARKDOWN_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
const MARKDOWN_ALLOWED_ELEMENTS = [
  "p",
  "a",
  "code",
  "pre",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];

const pickApiErrorMessage = (errorLike, fallback) => {
  if (typeof errorLike === "string") {
    return errorLike;
  }

  if (!errorLike || typeof errorLike !== "object") {
    return fallback;
  }

  return (
    errorLike.message ||
    errorLike.error ||
    errorLike.technicalMessage ||
    errorLike.statusText ||
    errorLike.raw?.message ||
    errorLike.raw?.error ||
    fallback
  );
};

const getApiErrorStatusCode = (errorLike) => {
  if (!errorLike || typeof errorLike !== "object") {
    const match = String(errorLike || "").match(/\b([45]\d{2})\b/);
    return match ? Number(match[1]) : null;
  }

  const candidates = [
    errorLike.statusCode,
    errorLike.status,
    errorLike.raw?.statusCode,
    errorLike.raw?.status,
    errorLike.error?.statusCode,
    errorLike.error?.status,
  ];

  for (const candidate of candidates) {
    const statusCode = Number(candidate);
    if (statusCode >= 400 && statusCode <= 599) {
      return statusCode;
    }
  }

  const text = [
    errorLike.message,
    errorLike.error,
    errorLike.technicalMessage,
    errorLike.raw?.message,
    errorLike.raw?.error,
  ]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
};

const compactApiErrorMessage = (message) => {
  const compact = String(message || "")
    .replace(/\s+/g, " ")
    .trim();

  if (compact.length <= API_ERROR_SUMMARY_MAX_LENGTH) {
    return compact;
  }

  return `${compact.slice(0, API_ERROR_SUMMARY_MAX_LENGTH - 3)}...`;
};

const stripStatusPrefix = (message, statusCode) =>
  message
    .replace(
      new RegExp(
        `^\\s*API\\s*(?:请求失败|request failed)?\\s*:?\\s*${statusCode}\\s*:?\\s*`,
        "i",
      ),
      "",
    )
    .replace(new RegExp(`^\\s*${statusCode}\\s*:?\\s*`, "i"), "")
    .trim();

const formatBriefApiError = (errorLike, fallback) => {
  const statusCode = getApiErrorStatusCode(errorLike);
  const message = compactApiErrorMessage(
    pickApiErrorMessage(errorLike, fallback),
  );

  if (!statusCode) {
    return message || fallback;
  }

  return `API ${statusCode}: ${stripStatusPrefix(message, statusCode) || fallback}`;
};

const createApiResponseError = (response, fallback) => {
  const error = new Error(pickApiErrorMessage(response, fallback));
  const statusCode = getApiErrorStatusCode(response);
  if (statusCode) {
    error.statusCode = statusCode;
  }
  error.raw = response;
  return error;
};

const normalizeSafeMarkdownHref = (href) => {
  if (typeof href !== "string") {
    return null;
  }

  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.length > MAX_MARKDOWN_LINK_LENGTH) {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(trimmedHref);
  } catch {
    return null;
  }

  const protocol = urlObj.protocol.toLowerCase();
  if (!ALLOWED_MARKDOWN_LINK_PROTOCOLS.has(protocol)) {
    return null;
  }

  return urlObj.toString();
};

const DIALOG_RIGHT_GAP = 50;
const DIALOG_BOTTOM_GAP = 20;
const DIALOG_TOP_GAP = 20;
const DIALOG_PAPER_RADIUS = RADIUS.LG;
const HANDLE_VISUAL_INSET = 12;

// 默认和限制尺寸
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 540;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 900;

const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeWindowSize = (size) => {
  if (!size || typeof size !== "object") {
    return null;
  }

  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: clampValue(Math.round(width), MIN_WIDTH, MAX_WIDTH),
    height: clampValue(Math.round(height), MIN_HEIGHT, MAX_HEIGHT),
  };
};

// 自定义浮动窗口对话框（支持动态宽高和z-index）
const FloatingDialog = createFloatingDialog({
  right: DIALOG_RIGHT_GAP,
  bottom: DIALOG_BOTTOM_GAP,
  width: DEFAULT_WIDTH,
  minWidth: MIN_WIDTH,
  maxWidth: `calc(100vw - ${DIALOG_RIGHT_GAP * 2}px)`,
  height: DEFAULT_HEIGHT,
  minHeight: MIN_HEIGHT,
  maxHeight: `calc(100vh - ${DIALOG_BOTTOM_GAP + DIALOG_TOP_GAP}px)`,
  borderRadius: DIALOG_PAPER_RADIUS,
});

const ThinkSparkIcon = () => (
  <svg
    className="ai-think-spark"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"
      fill="currentColor"
    />
  </svg>
);

// 思考内容组件
const ThinkContent = ({ content, isExpanded, onToggle, isStreaming }) => {
  const { t } = useTranslation();
  return (
    <Box
      className={`ai-think-block${isStreaming ? " is-streaming" : ""}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <Box className="ai-think-toggle">
        <ThinkSparkIcon />
        <Typography className="ai-think-label" variant="caption">
          {t("ai.thinkingProcess")}
        </Typography>
        <ExpandMoreIcon
          className={`ai-think-caret${isExpanded ? " is-open" : ""}`}
          fontSize="small"
        />
      </Box>
      <Collapse in={isExpanded}>
        <Box className="ai-think-trace">
          <Typography className="ai-think-body" variant="body2">
            {content}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

/** 流式输出包装：底边淡入 + 细线光标 + 节流 chunk 淡入 */
const StreamContent = ({ isStreaming, contentLength = 0, children }) => {
  const [streamTick, setStreamTick] = useState(0);
  const lastLenRef = useRef(0);
  const lastTickAtRef = useRef(0);

  useEffect(() => {
    if (!isStreaming) {
      lastLenRef.current = contentLength;
      return undefined;
    }
    if (contentLength <= lastLenRef.current) {
      return undefined;
    }
    lastLenRef.current = contentLength;
    const now =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    // 约 16fps 节流，避免逐 token 重启动画造成闪烁
    if (now - lastTickAtRef.current < 60) {
      return undefined;
    }
    lastTickAtRef.current = now;
    setStreamTick((tick) => (tick + 1) % 2);
    return undefined;
  }, [isStreaming, contentLength]);

  return (
    <Box
      className={`ai-stream-wrap ${isStreaming ? "ai-stream-active" : "ai-stream-done"}`}
      data-stream-tick={isStreaming ? String(streamTick) : undefined}
    >
      <Box className="ai-message-content ai-stream-body">{children}</Box>
    </Box>
  );
};

const AIChatWindow = ({
  windowState,
  onClose,
  onMinimize,
  presetInput,
  onInputPresetUsed,
  connectionInfo,
  onExecuteCommand,
  zIndex,
  onFocus,
  anchorEl,
}) => {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentApi, setCurrentApi] = useState(null);
  const [showThinking, setShowThinking] = useState(true);
  const [expandedThinking, setExpandedThinking] = useState({});
  const [abortController, setAbortController] = useState(null);
  const [apiMenuAnchor, setApiMenuAnchor] = useState(null);
  const [availableApis, setAvailableApis] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [windowWidth, setWindowWidth] = useState(DEFAULT_WIDTH);
  const [windowHeight, setWindowHeight] = useState(DEFAULT_HEIGHT);
  const [isResizing, setIsResizing] = useState(null);
  const [prevWindowState, setPrevWindowState] = useState(null);
  const streamHandlersRef = useRef({});

  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const messageRefsMap = useRef({});
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

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

  const getWidthLimit = useCallback(() => {
    const viewportLimit = window.innerWidth - DIALOG_RIGHT_GAP * 2;
    return clampValue(viewportLimit, MIN_WIDTH, MAX_WIDTH);
  }, []);

  const getHeightLimit = useCallback(() => {
    const viewportLimit =
      window.innerHeight - DIALOG_BOTTOM_GAP - DIALOG_TOP_GAP;
    return clampValue(viewportLimit, MIN_HEIGHT, MAX_HEIGHT);
  }, []);

  // 窗口尺寸变化时，确保浮窗不会超过当前视口
  useEffect(() => {
    const syncSizeWithViewport = () => {
      const maxWidth = getWidthLimit();
      const maxHeight = getHeightLimit();
      setWindowWidth((prev) => clampValue(prev, MIN_WIDTH, maxWidth));
      setWindowHeight((prev) => clampValue(prev, MIN_HEIGHT, maxHeight));
    };

    syncSizeWithViewport();
    window.addEventListener("resize", syncSizeWithViewport);
    return () => {
      window.removeEventListener("resize", syncSizeWithViewport);
    };
  }, [getHeightLimit, getWidthLimit]);

  const persistWindowSize = useCallback(async (width, height) => {
    if (
      !window.terminalAPI?.loadAISettings ||
      !window.terminalAPI?.saveAISettings
    ) {
      return;
    }

    const normalizedSize = normalizeWindowSize({ width, height });
    if (!normalizedSize) {
      return;
    }

    try {
      const settings = (await window.terminalAPI.loadAISettings()) || {};
      await window.terminalAPI.saveAISettings({
        ...settings,
        windowSize: normalizedSize,
      });
    } catch (err) {
      console.error("Failed to persist AI window size:", err);
    }
  }, []);

  // 拖拽调整宽高
  const handleResizeStart = useDragResize({
    getStart: () => ({ width: windowWidth, height: windowHeight }),
    getBounds: () => ({
      minWidth: MIN_WIDTH,
      maxWidth: getWidthLimit(),
      minHeight: MIN_HEIGHT,
      maxHeight: getHeightLimit(),
    }),
    onResize: ({ width, height }) => {
      if (width !== undefined) {
        setWindowWidth(width);
      }
      if (height !== undefined) {
        setWindowHeight(height);
      }
    },
    onStateChange: setIsResizing,
    onEnd: ({ width, height }) => {
      persistWindowSize(width, height);
    },
    stopPropagation: true,
    manageBodyStyles: true,
  });

  // 加载API配置
  const loadApiSettings = async () => {
    try {
      if (window.terminalAPI?.loadAISettings) {
        const settings = await window.terminalAPI.loadAISettings();
        setAvailableApis(settings.configs || []);
        if (settings.current) {
          // 从configs中获取最新的配置
          const latestConfig =
            settings.configs?.find((c) => c.id === settings.current.id) ||
            settings.current;
          setCurrentApi(latestConfig);
        } else if (settings.configs && settings.configs.length > 0) {
          setCurrentApi(settings.configs[0]);
        }
        // 加载自定义风险规则
        if (settings.customRiskRules) {
          setCustomRiskRules(settings.customRiskRules);
        }

        const normalizedSize = normalizeWindowSize(settings.windowSize);
        if (normalizedSize) {
          const maxWidth = getWidthLimit();
          const maxHeight = getHeightLimit();
          setWindowWidth(clampValue(normalizedSize.width, MIN_WIDTH, maxWidth));
          setWindowHeight(
            clampValue(normalizedSize.height, MIN_HEIGHT, maxHeight),
          );
        }
      }
    } catch (err) {
      console.error("Failed to load API settings:", err);
    }
  };

  // 初始化加载设置
  useEffect(() => {
    if (windowState === "visible") {
      loadApiSettings();
      // 延迟聚焦以确保 DOM 已渲染
      setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      }, 100);
    }
  }, [windowState]);

  // 处理预设输入
  useEffect(() => {
    if (presetInput && windowState === "visible") {
      setInput(presetInput);
      onInputPresetUsed();
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [presetInput, windowState, onInputPresetUsed]);

  // 处理思考内容的处理
  const processThinkContent = (text) => {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = thinkRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        parts.push({
          type: "text",
          content: text.slice(lastIndex, match.index),
        });
      }
      parts.push({
        type: "think",
        content: match[1].trim(),
      });
      lastIndex = match.index + match[0].length;
    }

    const remainder = text.slice(lastIndex);
    const openThinkMatch = remainder.match(/<think>/i);
    if (openThinkMatch) {
      const openThinkIndex = openThinkMatch.index;
      if (openThinkIndex > 0) {
        parts.push({
          type: "text",
          content: remainder.slice(0, openThinkIndex),
        });
      }
      parts.push({
        type: "think",
        content: remainder
          .slice(openThinkIndex + openThinkMatch[0].length)
          .trim(),
        open: true,
      });
    } else if (remainder) {
      parts.push({
        type: "text",
        content: remainder,
      });
    }

    return parts;
  };

  // 复制消息
  const handleCopyMessage = async (content) => {
    try {
      await window.clipboardAPI.writeText(content);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

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
    if (!trimmedContent || isPending || abortController) return;

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
    setAbortController(controller);
    let activeSessionId = null;
    let activeAssistantMessageId = null;

    try {
      // 加载记忆文件
      const memory = await window.terminalAPI.loadMemory();

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
        const sessionId = `session_${requestTimestamp}`;
        activeSessionId = sessionId;
        requestData.sessionId = sessionId;
        setCurrentSessionId(sessionId);

        // 设置流式事件监听器
        const handleStreamChunk = (event, data) => {
          if (
            data.sessionId === sessionId &&
            controller.signal &&
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
          if (data.sessionId === sessionId) {
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
            setAbortController(null);
            setCurrentSessionId(null);
            // 清理监听器
            cleanupStreamHandlers(sessionId);
          }
        };

        const handleStreamError = (event, data) => {
          if (data.sessionId === sessionId) {
            markAssistantMessageComplete(assistantMessage.id);
            setError(formatBriefApiError(data.error, t("ai.requestFailed")));
            setAbortController(null);
            setCurrentSessionId(null);
            cleanupStreamHandlers(sessionId);
          }
        };

        // 注册监听器
        const unsubscribeChunk =
          window.terminalAPI.onAIStreamChunk?.(handleStreamChunk) || (() => {});
        const unsubscribeEnd =
          window.terminalAPI.onAIStreamEnd?.(handleStreamEnd) || (() => {});
        const unsubscribeError =
          window.terminalAPI.onAIStreamError?.(handleStreamError) || (() => {});

        // 保存监听器引用
        streamHandlersRef.current[sessionId] = {
          chunk: handleStreamChunk,
          end: handleStreamEnd,
          error: handleStreamError,
          unsubscribeChunk,
          unsubscribeEnd,
          unsubscribeError,
        };

        // 注册abort事件处理
        requestData.signal = controller.signal;

        const response = await window.terminalAPI.sendAPIRequest(
          requestData,
          true,
        );

        if (response && response.error) {
          // 清理监听器
          cleanupStreamHandlers(sessionId);
          setCurrentSessionId(null);
          throw createApiResponseError(response, t("ai.requestFailed"));
        }
      } else {
        // 非流式响应
        const response = await window.terminalAPI.sendAPIRequest(
          requestData,
          false,
        );

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
      if (err.name !== "AbortError") {
        if (activeAssistantMessageId) {
          markAssistantMessageComplete(activeAssistantMessageId);
        }
        if (activeSessionId) {
          cleanupStreamHandlers(activeSessionId);
          setCurrentSessionId(null);
        }
        setAbortController(null);
        setError(formatBriefApiError(err, t("ai.requestFailed")));
      }
      // 如果是中断错误，确保消息状态正确
      if (err.name === "AbortError") {
        // 清理所有监听器
        const sessionIdToClean = activeSessionId || currentSessionId;
        if (sessionIdToClean && window.terminalAPI) {
          cleanupStreamHandlers(sessionIdToClean);
        }
        setCurrentSessionId(null);

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
    } finally {
      if (currentApi?.streamEnabled === false) {
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
      abortController.abort();
      setAbortController(null);

      // 如果有当前会话，立即清理监听器
      if (currentSessionId && window.terminalAPI) {
        const handlers = streamHandlersRef.current[currentSessionId];
        if (handlers) {
          handlers.unsubscribeChunk?.();
          handlers.unsubscribeEnd?.();
          handlers.unsubscribeError?.();
          delete streamHandlersRef.current[currentSessionId];
        }
        setCurrentSessionId(null);
      }

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
    setMessages([]);
    setError("");
    // 删除记忆文件
    if (window.terminalAPI?.deleteMemory) {
      await window.terminalAPI.deleteMemory();
    }
  };

  // 处理关闭窗口（清空对话内容并删除记忆文件）
  const handleClose = async () => {
    setMessages([]);
    setInput("");
    setError("");
    setExpandedThinking({});
    // 删除记忆文件
    if (window.terminalAPI?.deleteMemory) {
      await window.terminalAPI.deleteMemory();
    }
    if (onClose) {
      onClose();
    }
  };

  // 切换思考内容展开状态
  const toggleThinking = (messageId) => {
    setExpandedThinking((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  // 处理命令执行
  const handleExecuteCommand = useCallback(
    (command) => {
      if (onExecuteCommand && typeof onExecuteCommand === "function") {
        onExecuteCommand(command);
      } else {
        // 如果没有提供执行回调，尝试使用全局方式
        console.warn("No command execution handler provided");
      }
    },
    [onExecuteCommand],
  );

  // 处理命令复制
  const handleCopyCommand = useCallback(() => {
    // 可以添加额外的复制成功提示逻辑
  }, []);

  const openMarkdownLinkSafely = useCallback(async (href) => {
    const safeHref = normalizeSafeMarkdownHref(href);
    if (!safeHref || !window.terminalAPI?.openExternal) {
      return;
    }

    const allowRestrictedProtocols = safeHref
      .toLowerCase()
      .startsWith("mailto:");

    try {
      await window.terminalAPI.openExternal(safeHref, {
        source: "ai-chat",
        allowRestrictedProtocols,
      });
    } catch (error) {
      console.warn("Failed to open markdown link:", error);
    }
  }, []);

  const markdownUrlTransform = useCallback(
    (url) => normalizeSafeMarkdownHref(url) || "",
    [],
  );

  const markdownComponents = useMemo(
    () => ({
      a: ({ href, children }) => {
        const safeHref = normalizeSafeMarkdownHref(href);

        if (!safeHref) {
          return (
            <Typography component="span" variant="body2">
              {children}
            </Typography>
          );
        }

        return (
          <Typography
            component="a"
            href={safeHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              event.preventDefault();
              void openMarkdownLinkSafely(safeHref);
            }}
            sx={{
              color: "primary.main",
              textDecoration: "underline",
              cursor: "pointer",
            }}
          >
            {children}
          </Typography>
        );
      },
    }),
    [openMarkdownLinkSafely],
  );

  // 渲染消息内容，包含命令块的解析
  const renderMessageContent = useCallback(
    (content, messageId, isStreaming) => {
      // 解析命令块
      const commands = parseCommandsFromResponse(content);

      // 如果没有命令块，直接渲染原始内容
      if (commands.length === 0) {
        // 移除 <cmd> 标签（以防有未正确解析的）
        const cleanContent = content.replace(/<cmd[^>]*>[\s\S]*?<\/cmd>/gi, "");
        return (
          <ReactMarkdown
            components={markdownComponents}
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            allowedElements={MARKDOWN_ALLOWED_ELEMENTS}
            unwrapDisallowed
            urlTransform={markdownUrlTransform}
            skipHtml
          >
            {cleanContent}
          </ReactMarkdown>
        );
      }

      // 有命令块时，分割内容并渲染
      const parts = [];
      let lastIndex = 0;

      commands.forEach((cmd, idx) => {
        // 添加命令之前的文本
        if (cmd.index > lastIndex) {
          const textBefore = content.slice(lastIndex, cmd.index);
          if (textBefore.trim()) {
            parts.push({
              type: "text",
              content: textBefore,
              key: `text-${idx}`,
            });
          }
        }

        // 添加命令块
        parts.push({
          type: "command",
          command: cmd.command,
          risk: cmd.risk,
          key: `cmd-${idx}`,
        });

        lastIndex = cmd.index + cmd.length;
      });

      // 添加最后的文本
      if (lastIndex < content.length) {
        const textAfter = content.slice(lastIndex);
        if (textAfter.trim()) {
          parts.push({
            type: "text",
            content: textAfter,
            key: "text-last",
          });
        }
      }

      return (
        <>
          {parts.map((part) => {
            if (part.type === "text") {
              return (
                <ReactMarkdown
                  key={part.key}
                  components={markdownComponents}
                  remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                  allowedElements={MARKDOWN_ALLOWED_ELEMENTS}
                  unwrapDisallowed
                  urlTransform={markdownUrlTransform}
                  skipHtml
                >
                  {part.content}
                </ReactMarkdown>
              );
            } else {
              return (
                <ExecutableCommand
                  key={part.key}
                  command={part.command}
                  risk={part.risk}
                  onExecute={handleExecuteCommand}
                  onCopy={handleCopyCommand}
                  disabled={isStreaming || !connectionInfo}
                />
              );
            }
          })}
        </>
      );
    },
    [
      handleExecuteCommand,
      handleCopyCommand,
      connectionInfo,
      markdownComponents,
      markdownUrlTransform,
    ],
  );

  // 切换 API / 模型配置
  const handleApiChange = useCallback(async (api) => {
    if (!api) {
      return;
    }

    setCurrentApi(api);
    setApiMenuAnchor(null);

    try {
      if (window.terminalAPI?.setCurrentApiConfig) {
        await window.terminalAPI.setCurrentApiConfig(api.id);
      }
    } catch (err) {
      console.error("Failed to set current API config:", err);
    }
  }, []);

  const handleOpenApiMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setApiMenuAnchor(event.currentTarget);
  }, []);

  const handleCloseApiMenu = useCallback(() => {
    setApiMenuAnchor(null);
  }, []);

  const handleOpenSettingsFromMenu = useCallback(() => {
    setApiMenuAnchor(null);
    setSettingsOpen(true);
  }, []);

  const modelChipLabel = useMemo(() => {
    if (!currentApi) {
      return t("ai.selectModel");
    }
    return currentApi.model || currentApi.name || t("ai.selectModel");
  }, [currentApi, t]);

  const apiMenuZIndex = (Number(zIndex) || 1300) + 20;
  const showModelChip = Boolean(currentApi) || availableApis.length > 0;

  return (
    <FloatingDialog
      open={windowState === "visible"}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      disableEscapeKeyDown={isPending || abortController}
      customwidth={windowWidth}
      customheight={windowHeight}
      customzindex={zIndex}
      ref={dialogRef}
      onMouseDown={onFocus}
      slotProps={{
        paper: {
          className: "ai-chat-paper",
        },
      }}
      {...createAnchoredTransition(anchorEl)}
    >
      {/* 左上角拖动调整宽高手柄 */}
      <Box
        onMouseDown={handleResizeStart("both")}
        sx={{
          position: "absolute",
          left: -6,
          top: -6,
          width: 14,
          height: 14,
          cursor: "nwse-resize",
          zIndex: 3,
          borderRadius: "8px 0 0 0",
          "&::after": {
            content: '""',
            position: "absolute",
            left: 4,
            top: 4,
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "primary.main",
            opacity: isResizing === "both" ? 0.55 : 0,
            transform: isResizing === "both" ? "scale(1.05)" : "scale(1)",
            transition: "opacity 120ms ease, transform 120ms ease",
          },
          "&:hover::after": {
            opacity: isResizing === "both" ? 0.55 : 0.35,
          },
        }}
      />
      {/* 顶部拖动调整高度手柄 */}
      <Box
        onMouseDown={handleResizeStart("height")}
        sx={{
          position: "absolute",
          left: 0,
          top: -4,
          right: 0,
          height: 8,
          cursor: "ns-resize",
          zIndex: 2,
          "&::after": {
            content: '""',
            position: "absolute",
            left: DIALOG_PAPER_RADIUS,
            right: DIALOG_PAPER_RADIUS,
            top: 3,
            height: 2,
            borderRadius: 999,
            backgroundColor: "primary.main",
            opacity: isResizing === "height" || isResizing === "both" ? 0.5 : 0,
            transform:
              isResizing === "height" || isResizing === "both"
                ? "scaleY(1.2)"
                : "scaleY(1)",
            transition: "opacity 120ms ease, transform 120ms ease",
          },
          "&:hover::after": {
            opacity:
              isResizing === "height" || isResizing === "both" ? 0.5 : 0.3,
          },
        }}
      />
      {/* 左侧拖动调整宽度手柄 */}
      <Box
        onMouseDown={handleResizeStart("width")}
        sx={{
          position: "absolute",
          left: -4,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: "ew-resize",
          zIndex: 2,
          "&::after": {
            content: '""',
            position: "absolute",
            top: HANDLE_VISUAL_INSET,
            bottom: HANDLE_VISUAL_INSET,
            left: 3,
            width: 2,
            borderRadius: 999,
            backgroundColor: "primary.main",
            opacity: isResizing === "width" || isResizing === "both" ? 0.5 : 0,
            transform:
              isResizing === "width" || isResizing === "both"
                ? "scaleX(1.2)"
                : "scaleX(1)",
            transformOrigin: "left center",
            transition: "opacity 120ms ease, transform 120ms ease",
          },
          "&:hover::after": {
            opacity:
              isResizing === "width" || isResizing === "both" ? 0.5 : 0.3,
          },
        }}
      />
      <DialogTitle
        className="ai-chat-header"
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <Box display="flex" alignItems="center" gap={0.75} minWidth={0}>
          <Tooltip title={t("aiAssistant.minimize")}>
            <IconButton
              size="small"
              onClick={onMinimize}
              className="ai-chat-header-btn"
              aria-label={t("aiAssistant.minimize")}
            >
              <AIIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography className="ai-chat-title" variant="h6" noWrap>
            {t("ai.title")}
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={0.35} flexShrink={0}>
          {showModelChip && (
            <Tooltip title={t("ai.switchModel")}>
              <Chip
                label={
                  <Box component="span" className="ai-chat-model-chip-content">
                    <Box component="span" className="ai-chat-model-chip-text">
                      {modelChipLabel}
                    </Box>
                    <ExpandMoreIcon
                      className={`ai-chat-model-chip-caret${
                        apiMenuAnchor ? " ai-chat-model-chip-caret-open" : ""
                      }`}
                      aria-hidden
                    />
                  </Box>
                }
                size="small"
                clickable
                onClick={handleOpenApiMenu}
                onMouseDown={(event) => event.stopPropagation()}
                className="ai-chat-model-chip"
                aria-label={t("ai.switchModel")}
                aria-haspopup="menu"
                aria-expanded={Boolean(apiMenuAnchor)}
              />
            </Tooltip>
          )}
          <Menu
            anchorEl={apiMenuAnchor}
            open={Boolean(apiMenuAnchor)}
            onClose={handleCloseApiMenu}
            disableScrollLock
            // 浮动窗 z-index 为 1300/1310，菜单需更高才能显示在其上方
            sx={{ zIndex: apiMenuZIndex }}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
            slotProps={{
              paper: {
                className: "ai-chat-model-menu",
                sx: {
                  borderRadius: "var(--radius-md)",
                  mt: 0.5,
                  minWidth: 168,
                  maxWidth: 280,
                  overflow: "hidden",
                },
              },
            }}
          >
            {availableApis.length === 0 ? (
              <MenuItem disabled dense>
                {t("ai.noApiConfigured")}
              </MenuItem>
            ) : (
              availableApis.map((api) => {
                const itemLabel = api.model || api.name || t("ai.selectModel");
                const isSelected = currentApi?.id === api.id;
                return (
                  <MenuItem
                    key={api.id}
                    onClick={() => handleApiChange(api)}
                    selected={isSelected}
                    dense
                  >
                    <Box
                      component="span"
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        minWidth: 0,
                        width: "100%",
                      }}
                    >
                      <Typography
                        variant="body2"
                        noWrap
                        sx={{
                          width: "100%",
                          fontWeight: isSelected ? 600 : 500,
                        }}
                      >
                        {itemLabel}
                      </Typography>
                      {api.provider ? (
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          noWrap
                          sx={{ width: "100%", lineHeight: 1.2 }}
                        >
                          {api.provider}
                        </Typography>
                      ) : null}
                    </Box>
                  </MenuItem>
                );
              })
            )}
            <Divider />
            <MenuItem onClick={handleOpenSettingsFromMenu} dense>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              {t("ai.manageApis")}
            </MenuItem>
          </Menu>
          <Tooltip title={t("ai.clearChat")}>
            <IconButton
              size="small"
              onClick={handleClearChat}
              className="ai-chat-header-btn"
              aria-label={t("ai.clearChat")}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("aiAssistant.minimize")}>
            <IconButton
              size="small"
              onClick={onMinimize}
              className="ai-chat-header-btn"
              aria-label={t("aiAssistant.minimize")}
            >
              <MinimizeIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("aiAssistant.close")}>
            <IconButton
              size="small"
              onClick={handleClose}
              className="ai-chat-header-btn ai-chat-close-btn"
              aria-label={t("aiAssistant.close")}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>
      <DialogContent className="ai-chat-content">
        {/* 消息列表 */}
        <Box ref={messagesContainerRef} className="ai-chat-messages">
          {messages.length === 0 && (
            <Box className="ai-chat-empty">
              {!currentApi ||
              !currentApi.apiUrl ||
              !hasConfiguredApiKey(currentApi) ||
              !currentApi.model ? (
                <>
                  <Typography className="ai-chat-empty-title">
                    {t("ai.noApiConfigured")}
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SettingsIcon />}
                    onClick={() => setSettingsOpen(true)}
                    className="ai-chat-empty-action"
                  >
                    {t("ai.settings")}
                  </Button>
                </>
              ) : (
                <>
                  <Typography className="ai-chat-empty-title">
                    {t("ai.startConversation")}
                  </Typography>
                  <Typography className="ai-chat-empty-hint">
                    {t("ai.inputPlaceholder")}
                  </Typography>
                </>
              )}
            </Box>
          )}
          {messages.map((message) => {
            const isUserMessage = message.role === "user";
            const isStreaming = Boolean(message.isStreaming);
            const messageActionsDisabled = Boolean(
              isPending || abortController || isStreaming,
            );

            const assistantParts =
              message.role === "assistant" && showThinking
                ? processThinkContent(message.content)
                : null;
            const assistantThinkParts = assistantParts
              ? assistantParts.filter((part) => part.type === "think")
              : [];
            const assistantTextContent =
              message.role === "assistant"
                ? showThinking
                  ? assistantParts
                      .filter((part) => part.type === "text")
                      .map((part) => part.content)
                      .join("")
                  : message.content
                      .replace(/<think>[\s\S]*?<\/think>/g, "")
                      .replace(/<think>[\s\S]*$/i, "")
                : "";

            return (
              <Box
                key={message.id}
                className={`ai-message-row ${isUserMessage ? "is-user" : "is-assistant"}`}
                ref={(el) => {
                  if (el) messageRefsMap.current[message.id] = el;
                }}
              >
                <Paper
                  elevation={0}
                  className={`ai-message-bubble ${isUserMessage ? "is-user" : "is-assistant"}${isStreaming ? " is-streaming" : ""}`}
                >
                  {message.role === "assistant" ? (
                    <>
                      {assistantThinkParts.map((part, index) => (
                        <ThinkContent
                          key={`think-${index}`}
                          content={part.content}
                          isExpanded={expandedThinking[message.id]}
                          onToggle={() => toggleThinking(message.id)}
                          isStreaming={Boolean(isStreaming && part.open)}
                        />
                      ))}
                      {assistantTextContent.trim() ||
                      (isStreaming && assistantThinkParts.length === 0) ? (
                        <StreamContent
                          isStreaming={isStreaming}
                          contentLength={
                            typeof assistantTextContent === "string"
                              ? assistantTextContent.length
                              : 0
                          }
                        >
                          {renderMessageContent(
                            assistantTextContent,
                            message.id,
                            isStreaming,
                          )}
                        </StreamContent>
                      ) : null}
                    </>
                  ) : (
                    <Box className="ai-message-content">
                      <ReactMarkdown
                        components={markdownComponents}
                        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                        allowedElements={MARKDOWN_ALLOWED_ELEMENTS}
                        unwrapDisallowed
                        urlTransform={markdownUrlTransform}
                        skipHtml
                      >
                        {message.content}
                      </ReactMarkdown>
                    </Box>
                  )}
                </Paper>
                <Box className="ai-message-actions">
                  {isUserMessage && (
                    <>
                      <Tooltip title={t("ai.editMessage")}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleEditMessage(message)}
                            disabled={messageActionsDisabled}
                            className="ai-message-action"
                            aria-label={t("ai.editMessage")}
                          >
                            <EditIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t("ai.retryMessage")}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleRetryMessage(message)}
                            disabled={messageActionsDisabled}
                            className="ai-message-action"
                            aria-label={t("ai.retryMessage")}
                          >
                            <ReplayIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip title={t("ai.copyMessage")}>
                    <IconButton
                      size="small"
                      onClick={() => handleCopyMessage(message.content)}
                      className="ai-message-action"
                      aria-label={t("ai.copyMessage")}
                    >
                      <ContentCopyIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
            );
          })}
          <div ref={messagesEndRef} />
        </Box>

        {/* 点状导航 - 消息快速跳转 */}
        {messages.length > 1 && (
          <Box className="ai-chat-dots">
            {messages.map((message) => (
              <Box
                key={message.id}
                className={`ai-chat-dot ${message.role === "user" ? "is-user" : "is-assistant"}`}
                onClick={() => scrollToMessage(message.id)}
                title={
                  message.role === "user"
                    ? t("ai.editMessage")
                    : t("ai.copyMessage")
                }
                role="button"
              />
            ))}
          </Box>
        )}

        {/* 错误提示 */}
        {error && (
          <Alert
            severity="error"
            className="ai-chat-error"
            onClose={() => setError("")}
          >
            {error}
          </Alert>
        )}

        {/* 输入区域 */}
        <Box className="ai-chat-footer">
          <Box
            className="ai-chat-composer"
            onClick={() => inputRef.current?.focus()}
          >
            <TextField
              fullWidth
              multiline
              maxRows={4}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder={t("ai.inputPlaceholder")}
              disabled={isPending || abortController}
              inputRef={inputRef}
              variant="outlined"
              size="small"
              sx={{
                flex: "1 1 0",
                minWidth: 0,
              }}
            />
            <Box className="ai-chat-composer-toolbar">
              <Box
                className={`ai-chat-options ${
                  showThinking ? "is-thinking-enabled" : "is-thinking-disabled"
                }`}
              >
                <FormControlLabel
                  className="ai-thinking-control"
                  control={
                    <Switch
                      size="small"
                      className="ai-thinking-switch"
                      checked={showThinking}
                      onChange={(e) => setShowThinking(e.target.checked)}
                    />
                  }
                  label={t("ai.showThinking")}
                />
              </Box>
              {isPending || abortController ? (
                <Tooltip title={t("ai.stopGenerating")}>
                  <IconButton
                    size="small"
                    onClick={handleAbortRequest}
                    aria-label={t("ai.stopGenerating")}
                    className="ai-chat-send-btn is-stop"
                  >
                    <StopIcon />
                  </IconButton>
                </Tooltip>
              ) : (
                <Tooltip title={t("ai.sendMessage")}>
                  <span>
                    <IconButton
                      size="small"
                      color="inherit"
                      onClick={handleSendMessage}
                      disabled={
                        !input.trim() ||
                        !currentApi ||
                        !currentApi.apiUrl ||
                        !hasConfiguredApiKey(currentApi) ||
                        !currentApi.model
                      }
                      aria-label={t("ai.sendMessage")}
                      className="ai-chat-send-btn"
                    >
                      <ArrowUpwardIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              )}
            </Box>
          </Box>
        </Box>
      </DialogContent>

      {/* AI设置对话框 */}
      <AISettings
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          loadApiSettings();
        }}
      />
    </FloatingDialog>
  );
};

export default memo(AIChatWindow);
