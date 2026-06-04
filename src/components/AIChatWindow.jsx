import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
  useTransition,
} from "react";
import Dialog from "./AccessibleDialog.jsx";
import {
  DialogTitle,
  DialogContent,
  IconButton,
  TextField,
  Box,
  Typography,
  Paper,
  Fab,
  Tooltip,
  CircularProgress,
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
import SendIcon from "@mui/icons-material/Send";
import SettingsIcon from "@mui/icons-material/Settings";
import StopIcon from "@mui/icons-material/Stop";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import ReplayIcon from "@mui/icons-material/Replay";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import AIIcon from "./AIIcon";
import AISettings from "./AISettings";
import ExecutableCommand from "./ExecutableCommand";
import { useTranslation } from "react-i18next";
import { styled } from "@mui/material/styles";
import ReactMarkdown from "react-markdown";
import {
  generateSystemPrompt,
  generateMemoryContext,
  parseCommandsFromResponse,
  setCustomRiskRules,
} from "../utils/aiSystemPrompt";
import { createAnchoredTransition } from "../utils/launchAnimation.js";
import "./AIChatWindow.css";
import "./CodeHighlight.css";

const MAX_MARKDOWN_LINK_LENGTH = 2048;
const API_ERROR_SUMMARY_MAX_LENGTH = 180;
const MESSAGE_ACTION_BUTTON_SX = {
  width: 24,
  height: 24,
  p: 0.25,
  color: "text.secondary",
  opacity: 0.72,
  "&:hover": {
    opacity: 1,
  },
  "&.Mui-disabled": {
    color: "text.disabled",
    opacity: 0.35,
  },
};
const MESSAGE_ACTION_ICON_SX = {
  fontSize: 15,
};
const ALLOWED_MARKDOWN_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
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
];

const hasConfiguredApiKey = (apiConfig) =>
  Boolean(apiConfig?.apiKey?.trim()) || Boolean(apiConfig?.hasApiKey);

const buildInlineApiKeyPayload = (apiConfig) => {
  const apiKey =
    typeof apiConfig?.apiKey === "string" ? apiConfig.apiKey.trim() : "";
  return apiKey ? { apiKey } : {};
};

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
const DIALOG_PAPER_RADIUS = 16;
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
const FloatingDialog = styled(Dialog)(
  ({ theme, customwidth, customheight, customzindex }) => ({
    pointerEvents: "none",
    zIndex: customzindex || 1300,
    "& .MuiDialog-container": {
      pointerEvents: "none",
    },
    "& .MuiDialog-paper": {
      pointerEvents: "auto",
      position: "fixed",
      right: DIALOG_RIGHT_GAP,
      bottom: DIALOG_BOTTOM_GAP,
      margin: 0,
      width: customwidth || DEFAULT_WIDTH,
      minWidth: MIN_WIDTH,
      maxWidth: `calc(100vw - ${DIALOG_RIGHT_GAP * 2}px)`,
      height: customheight || DEFAULT_HEIGHT,
      minHeight: MIN_HEIGHT,
      maxHeight: `calc(100vh - ${DIALOG_BOTTOM_GAP + DIALOG_TOP_GAP}px)`,
      backgroundColor:
        theme.palette.mode === "dark"
          ? "rgba(30, 30, 30, 0.95)"
          : "rgba(255, 255, 255, 0.95)",
      backdropFilter: "blur(10px)",
      borderRadius: DIALOG_PAPER_RADIUS,
      boxShadow:
        theme.palette.mode === "dark"
          ? "0 10px 40px rgba(0, 0, 0, 0.6)"
          : "0 10px 40px rgba(0, 0, 0, 0.2)",
      overflow: "visible",
    },
  }),
);

// 消息气泡组件
const MessageBubble = styled(Paper)(({ theme, isUser }) => ({
  padding: theme.spacing(1.5, 2),
  marginBottom: theme.spacing(1.5),
  maxWidth: "85%",
  alignSelf: isUser ? "flex-end" : "flex-start",
  backgroundColor: isUser
    ? theme.palette.primary.main
    : theme.palette.mode === "dark"
      ? theme.palette.grey[800]
      : theme.palette.grey[100],
  color: isUser
    ? theme.palette.primary.contrastText
    : theme.palette.text.primary,
  borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
  wordBreak: "break-word",
  position: "relative",
}));

// 思考内容组件
const ThinkContent = ({ content, isExpanded, onToggle }) => {
  const { t } = useTranslation();
  return (
    <Box
      sx={{
        mt: 1,
        p: 1,
        borderRadius: 1,
        backgroundColor: "action.hover",
        cursor: "pointer",
      }}
      onClick={onToggle}
    >
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">
          {t("ai.thinkingProcess")}
        </Typography>
        {isExpanded ? (
          <ExpandLessIcon fontSize="small" />
        ) : (
          <ExpandMoreIcon fontSize="small" />
        )}
      </Box>
      <Collapse in={isExpanded}>
        <Typography
          variant="body2"
          sx={{ mt: 1, fontStyle: "italic", opacity: 0.8 }}
        >
          {content}
        </Typography>
      </Collapse>
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
  const resizeListenersRef = useRef({ move: null, up: null });

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

  const clearResizeListeners = useCallback(() => {
    const { move, up } = resizeListenersRef.current;
    if (move) {
      document.removeEventListener("mousemove", move);
    }
    if (up) {
      document.removeEventListener("mouseup", up);
    }
    resizeListenersRef.current = { move: null, up: null };
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  }, []);

  useEffect(
    () => () => {
      clearResizeListeners();
    },
    [clearResizeListeners],
  );

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
  const handleResizeStart = useCallback(
    (mode) => (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearResizeListeners();
      setIsResizing(mode);

      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = windowWidth;
      const startHeight = windowHeight;
      const maxWidth = getWidthLimit();
      const maxHeight = getHeightLimit();
      let latestWidth = startWidth;
      let latestHeight = startHeight;

      const handleMouseMove = (moveEvent) => {
        if (mode === "width" || mode === "both") {
          const deltaX = startX - moveEvent.clientX;
          const nextWidth = clampValue(
            startWidth + deltaX,
            MIN_WIDTH,
            maxWidth,
          );
          latestWidth = nextWidth;
          setWindowWidth(nextWidth);
        }

        if (mode === "height" || mode === "both") {
          const deltaY = startY - moveEvent.clientY;
          const nextHeight = clampValue(
            startHeight + deltaY,
            MIN_HEIGHT,
            maxHeight,
          );
          latestHeight = nextHeight;
          setWindowHeight(nextHeight);
        }
      };

      const handleMouseUp = () => {
        setIsResizing(null);
        clearResizeListeners();
        persistWindowSize(latestWidth, latestHeight);
      };

      resizeListenersRef.current = {
        move: handleMouseMove,
        up: handleMouseUp,
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor =
        mode === "both"
          ? "nwse-resize"
          : mode === "height"
            ? "ns-resize"
            : "ew-resize";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [
      clearResizeListeners,
      getHeightLimit,
      getWidthLimit,
      persistWindowSize,
      windowHeight,
      windowWidth,
    ],
  );

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

    if (lastIndex < text.length) {
      parts.push({
        type: "text",
        content: text.slice(lastIndex),
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
      p: ({ children }) => (
        <Typography variant="body2" sx={{ mb: 1 }}>
          {children}
        </Typography>
      ),
      code: ({ children }) => (
        <Box
          component="code"
          sx={{
            backgroundColor: "rgba(0, 0, 0, 0.1)",
            borderRadius: 1,
            px: 0.5,
            py: 0.2,
            fontFamily: "monospace",
            fontSize: "0.875em",
          }}
        >
          {children}
        </Box>
      ),
      pre: ({ children }) => (
        <Box
          sx={{
            backgroundColor: "rgba(0, 0, 0, 0.1)",
            borderRadius: 1,
            p: 1.5,
            my: 1,
            overflowX: "auto",
          }}
        >
          {children}
        </Box>
      ),
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

  // 切换API
  const handleApiChange = (api) => {
    setCurrentApi(api);
    window.terminalAPI.setCurrentApiConfig(api.id);
    setApiMenuAnchor(null);
  };

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
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box display="flex" alignItems="center" gap={1}>
          <Tooltip title={t("aiAssistant.minimize")}>
            <IconButton size="medium" onClick={onMinimize} sx={{ p: 0.5 }}
              aria-label={t("aiAssistant.minimize")}>
              <AIIcon />
            </IconButton>
          </Tooltip>
          <Typography variant="h6">{t("ai.title")}</Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={0.5}>
          {currentApi && (
            <Chip
              label={currentApi.model}
              size="small"
              onClick={(e) => setApiMenuAnchor(e.currentTarget)}
              sx={{ cursor: "pointer" }}
            />
          )}
          <Menu
            anchorEl={apiMenuAnchor}
            open={Boolean(apiMenuAnchor)}
            onClose={() => setApiMenuAnchor(null)}
            PaperProps={{
              sx: {
                border: 1,
                borderColor: "divider",
                boxShadow: 3,
              },
            }}
          >
            {availableApis.map((api) => (
              <MenuItem
                key={api.id}
                onClick={() => handleApiChange(api)}
                selected={currentApi?.id === api.id}
              >
                {api.model}
              </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={() => setSettingsOpen(true)}>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              {t("ai.manageApis")}
            </MenuItem>
          </Menu>
          <Tooltip title={t("ai.clearChat")}>
            <IconButton size="small" onClick={handleClearChat}
              aria-label={t("ai.clearChat")}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("ai.settings")}>
            <IconButton size="small" onClick={() => setSettingsOpen(true)}
              aria-label={t("ai.settings")}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("aiAssistant.close")}>
            <IconButton
              size="small"
              onClick={handleClose}
              aria-label={t("aiAssistant.close")}
            >
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          p: 2,
          overflow: "hidden",
          position: "relative",
        }}
      >
        {/* 消息列表 */}
        <Box
          ref={messagesContainerRef}
          sx={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            mb: 2,
            pr: 1,
          }}
        >
          {messages.length === 0 && (
            <Box
              sx={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2,
                p: 3,
              }}
            >
              {!currentApi ||
              !currentApi.apiUrl ||
              !hasConfiguredApiKey(currentApi) ||
              !currentApi.model ? (
                <>
                  <Typography
                    color="warning.main"
                    variant="body2"
                    textAlign="center"
                  >
                    {t("ai.noApiConfigured")}
                  </Typography>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<SettingsIcon />}
                    onClick={() => setSettingsOpen(true)}
                  >
                    {t("ai.settings")}
                  </Button>
                </>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  {t("ai.startConversation")}
                </Typography>
              )}
            </Box>
          )}
          {messages.map((message) => {
            const isUserMessage = message.role === "user";
            const messageActionsDisabled = Boolean(
              isPending || abortController || message.isStreaming,
            );

            return (
              <Box
                key={message.id}
                sx={{
                  alignSelf: isUserMessage ? "flex-end" : "flex-start",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: isUserMessage ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  mb: 1.25,
                }}
              >
                <MessageBubble
                  isUser={isUserMessage}
                  ref={(el) => {
                    if (el) messageRefsMap.current[message.id] = el;
                  }}
                  sx={{
                    alignSelf: "stretch",
                    maxWidth: "100%",
                    mb: 0,
                  }}
                >
                  <Box>
                    {message.role === "assistant" ? (
                      showThinking ? (
                        processThinkContent(message.content).map(
                          (part, index) => (
                            <Box key={index}>
                              {part.type === "text" ? (
                                renderMessageContent(
                                  part.content,
                                  message.id,
                                  message.isStreaming,
                                )
                              ) : (
                                <ThinkContent
                                  content={part.content}
                                  isExpanded={expandedThinking[message.id]}
                                  onToggle={() => toggleThinking(message.id)}
                                />
                              )}
                            </Box>
                          ),
                        )
                      ) : (
                        renderMessageContent(
                          message.content.replace(
                            /<think>[\s\S]*?<\/think>/g,
                            "",
                          ),
                          message.id,
                          message.isStreaming,
                        )
                      )
                    ) : (
                      <ReactMarkdown
                        components={markdownComponents}
                        allowedElements={MARKDOWN_ALLOWED_ELEMENTS}
                        unwrapDisallowed
                        urlTransform={markdownUrlTransform}
                        skipHtml
                      >
                        {message.content}
                      </ReactMarkdown>
                    )}
                    {message.isStreaming && (
                      <CircularProgress size={12} sx={{ ml: 1 }} />
                    )}
                  </Box>
                </MessageBubble>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 0.25,
                    mt: 0.25,
                    px: 0.5,
                  }}
                >
                  {isUserMessage && (
                    <>
                      <Tooltip title={t("ai.editMessage")}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleEditMessage(message)}
                            disabled={messageActionsDisabled}
                            sx={MESSAGE_ACTION_BUTTON_SX}
                            aria-label={t("ai.editMessage")}
                          >
                            <EditIcon sx={MESSAGE_ACTION_ICON_SX} />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={t("ai.retryMessage")}>
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => handleRetryMessage(message)}
                            disabled={messageActionsDisabled}
                            sx={MESSAGE_ACTION_BUTTON_SX}
                            aria-label={t("ai.retryMessage")}
                          >
                            <ReplayIcon sx={MESSAGE_ACTION_ICON_SX} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </>
                  )}
                  <Tooltip title={t("ai.copyMessage")}>
                    <IconButton
                      size="small"
                      onClick={() => handleCopyMessage(message.content)}
                      sx={MESSAGE_ACTION_BUTTON_SX}
                      aria-label={t("ai.copyMessage")}
                    >
                      <ContentCopyIcon sx={MESSAGE_ACTION_ICON_SX} />
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
          <Box
            sx={{
              position: "absolute",
              right: 6,
              top: "50%",
              transform: "translateY(-50%)",
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
              zIndex: 2,
              py: 1,
              px: 0.5,
              borderRadius: 2,
              backgroundColor: (theme) =>
                theme.palette.mode === "dark"
                  ? "rgba(0, 0, 0, 0.3)"
                  : "rgba(255, 255, 255, 0.8)",
            }}
          >
            {messages.map((message) => (
              <Box
                key={message.id}
                onClick={() => scrollToMessage(message.id)}
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  cursor: "pointer",
                  backgroundColor:
                    message.role === "user"
                      ? "primary.main"
                      : (theme) =>
                          theme.palette.mode === "dark"
                            ? "grey.500"
                            : "grey.400",
                  opacity: 0.7,
                  transition: "all 0.2s",
                  "&:hover": {
                    opacity: 1,
                    transform: "scale(1.3)",
                  },
                }}
              />
            ))}
          </Box>
        )}

        {/* 错误提示 */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {/* 输入区域 */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            alignItems: "center",
            width: "100%",
          }}
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
          {isPending || abortController ? (
            <Tooltip title={t("ai.stopGenerating")}>
              <Fab
                size="small"
                color="error"
                onClick={handleAbortRequest}
                aria-label={t("ai.stopGenerating")}
                sx={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  minHeight: 36,
                }}
              >
                <StopIcon />
              </Fab>
            </Tooltip>
          ) : (
            <Tooltip title={t("ai.sendMessage")}>
              <span>
                <Fab
                  size="small"
                  color="primary"
                  onClick={handleSendMessage}
                  disabled={
                    !input.trim() ||
                    !currentApi ||
                    !currentApi.apiUrl ||
                    !hasConfiguredApiKey(currentApi) ||
                    !currentApi.model
                  }
                  aria-label={t("ai.sendMessage")}
                  sx={{
                    flexShrink: 0,
                    width: 36,
                    height: 36,
                    minHeight: 36,
                  }}
                >
                  <SendIcon />
                </Fab>
              </span>
            </Tooltip>
          )}
        </Box>

        {/* 显示思考内容开关 */}
        <Box
          sx={{
            mt: 1,
          }}
        >
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showThinking}
                onChange={(e) => setShowThinking(e.target.checked)}
              />
            }
            label={t("ai.showThinking")}
          />
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
