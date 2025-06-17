import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
  useMemo,
} from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  List,
  ListItem,
  Tooltip,
  CircularProgress,
  Alert,
  Select,
  MenuItem,
  FormControl,
  useTheme,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import SettingsIcon from "@mui/icons-material/Settings";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import CleaningServicesIcon from "@mui/icons-material/CleaningServices";
import { useTranslation } from "react-i18next";
import { Resizable } from "react-resizable";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import AISettings from "./AISettings.jsx";
import ThinkContent from "./ThinkContent.jsx";
import {
  StreamThinkProcessor,
  parseThinkContent,
} from "../utils/thinkContentProcessor.js";
import "react-resizable/css/styles.css";
import "highlight.js/styles/github.css"; // 代码高亮样式

// 防抖工具函数
const useDebounce = (callback, delay) => {
  const timeoutRef = useRef(null);

  return useCallback(
    (...args) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        callback(...args);
      }, delay);
    },
    [callback, delay],
  );
};

// 窗口状态枚举
const WINDOW_STATE = {
  VISIBLE: "visible",
  CLOSED: "closed",
};

// 自定义比较函数
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.windowState === nextProps.windowState &&
    prevProps.presetInput === nextProps.presetInput &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onInputPresetUsed === nextProps.onInputPresetUsed
  );
};

const AIChatWindow = memo(
  ({ windowState, onClose, presetInput, onInputPresetUsed }) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [currentSessionId, setCurrentSessionId] = useState(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const messagesEndRef = useRef(null);
    const currentRequestRef = useRef(null); // 用于跟踪当前请求以便中止
    const errorTimeoutRef = useRef(null); // 用于错误消息自动清除的定时器

    // API选择相关状态
    const [apiConfigs, setApiConfigs] = useState([]);
    const [currentApiId, setCurrentApiId] = useState(null);
    const [currentApiName, setCurrentApiName] = useState("");

    // 思考内容处理器
    const streamThinkProcessorRef = useRef(null);

    // 输入框引用
    const inputRef = useRef(null);

    // 处理预设输入值
    useEffect(() => {
      if (presetInput && windowState === WINDOW_STATE.VISIBLE) {
        setInputValue(presetInput);
        // 通知父组件预设输入已被使用
        if (onInputPresetUsed) {
          onInputPresetUsed();
        }
        // 聚焦到输入框
        setTimeout(() => {
          if (inputRef.current) {
            inputRef.current.focus();
          }
        }, 100);
      }
    }, [presetInput, windowState, onInputPresetUsed]);

    // 窗口位置和尺寸状态
    const [windowSize, setWindowSize] = useState({ width: 350, height: 450 });
    // const [isDragging, setIsDragging] = useState(false); // Replaced by isDraggingRef
    // const [dragStart, setDragStart] = useState({ x: 0, y: 0 }); // Replaced by dragStartOffsetRef
    const [maxConstraints, setMaxConstraints] = useState([800, 600]);
    const windowRef = useRef(null);

    // Refs for optimized dragging
    const isDraggingRef = useRef(false);
    const dragStartOffsetRef = useRef({ x: 0, y: 0 });
    const currentPositionRef = useRef({ x: 0, y: 0 });
    const animationFrameRef = useRef(null);

    // 动态计算最大尺寸限制
    const calculateMaxConstraints = useCallback(() => {
      const margin = 40; // 保留边距
      const maxWidth = Math.min(window.innerWidth - margin, 1000); // 最大不超过1000px
      const maxHeight = Math.min(window.innerHeight - margin, 800); // 最大不超过800px
      return [Math.max(400, maxWidth), Math.max(400, maxHeight)]; // 确保最小值
    }, []);

    // 防抖的尺寸更新函数
    const debouncedSetWindowSize = useDebounce((size) => {
      setWindowSize(size);
    }, 16); // 约60fps的更新频率

    // 计算初始位置（右下角）
    const calculateInitialPosition = useCallback(() => {
      const margin = 20; // 距离边缘的边距
      const x = window.innerWidth - windowSize.width - margin;
      const y = window.innerHeight - windowSize.height - margin;
      return {
        x: Math.max(margin, x),
        y: Math.max(margin, y),
      };
    }, [windowSize.width, windowSize.height]);

    const [windowPosition, setWindowPosition] = useState(
      calculateInitialPosition,
    );

    // Initialize currentPositionRef with the initial window position
    useEffect(() => {
      currentPositionRef.current = calculateInitialPosition();
    }, [calculateInitialPosition]); // 添加依赖

    // 初始化最大尺寸约束
    useEffect(() => {
      const updateMaxConstraints = () => {
        const newConstraints = calculateMaxConstraints();
        setMaxConstraints(newConstraints);
      };

      // 初始设置
      updateMaxConstraints();

      // 监听窗口尺寸变化
      window.addEventListener("resize", updateMaxConstraints);

      return () => {
        window.removeEventListener("resize", updateMaxConstraints);
      };
    }, [calculateMaxConstraints]);

    // 加载API配置
    useEffect(() => {
      loadApiConfigs();
    }, []);

    const loadApiConfigs = useCallback(async () => {
      try {
        const settings = await window.terminalAPI?.loadAISettings();
        if (settings) {
          setApiConfigs(settings.configs || []);
          if (settings.current) {
            setCurrentApiId(settings.current.id || null);
            setCurrentApiName(settings.current.name || "");
          }
        }
      } catch (error) {
        console.error("Failed to load API configs:", error);
      }
    }, []);

    // 切换API配置
    const handleApiChange = useCallback(
      async (apiId) => {
        try {
          const result = await window.terminalAPI.setCurrentApiConfig(apiId);
          if (result) {
            // 重新加载配置以更新当前API
            await loadApiConfigs();

            // 显示切换成功消息
            const selectedApi = apiConfigs.find((api) => api.id === apiId);
            if (selectedApi) {
              setErrorWithAutoClean(`已切换到 ${selectedApi.name}`);
            }
          }
        } catch (error) {
          console.error("Failed to switch API:", error);
          setErrorWithAutoClean("切换API失败");
        }
      },
      [apiConfigs, loadApiConfigs],
    );

    // 优化事件处理函数
    const handleKeyDown = useCallback((e) => {
      if (e.key === "Enter" && e.ctrlKey) {
        handleSendMessage();
      }
    }, []);

    const handleClearMessages = useCallback(() => {
      setMessages([]);
    }, []);

    const handleCopyMessage = useCallback(
      async (message) => {
        try {
          await navigator.clipboard.writeText(message.content);
          setErrorWithAutoClean(t("aiAssistant.copySuccess"));
        } catch (error) {
          console.error("Copy failed:", error);
          setErrorWithAutoClean(t("aiAssistant.copyFailed"));
        }
      },
      [t],
    );

    const clearErrorTimeout = useCallback(() => {
      if (errorTimeoutRef.current) {
        clearTimeout(errorTimeoutRef.current);
        errorTimeoutRef.current = null;
      }
    }, []);

    const setErrorWithAutoClean = useCallback(
      (errorMessage) => {
        clearErrorTimeout();
        setError(errorMessage);
        errorTimeoutRef.current = setTimeout(() => {
          setError("");
          errorTimeoutRef.current = null;
        }, 5000);
      },
      [clearErrorTimeout],
    );

    const handleStopRequest = useCallback(() => {
      if (currentRequestRef.current) {
        currentRequestRef.current.abort();
        currentRequestRef.current = null;
        setIsLoading(false);
      }
    }, []);

    // 使用 useMemo 优化 markdown 组件配置
    const markdownComponents = useMemo(
      () => ({
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <pre className={className} {...props}>
              <code>{children}</code>
            </pre>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        table({ children }) {
          return (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                {children}
              </table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th
              style={{
                border: "1px solid #ddd",
                padding: "8px",
                backgroundColor: "#f5f5f5",
                textAlign: "left",
              }}
            >
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td style={{ border: "1px solid #ddd", padding: "8px" }}>
              {children}
            </td>
          );
        },
      }),
      [],
    );

    // 使用 useMemo 优化消息列表渲染
    const messagesList = useMemo(() => {
      return messages.map((message, index) => (
        <ListItem
          key={index}
          sx={{
            display: "block",
            p: 1,
            mb: 1,
            borderRadius: 1,
            bgcolor:
              message.role === "user" ? "primary.main" : "background.paper",
            color:
              message.role === "user" ? "primary.contrastText" : "text.primary",
            boxShadow: 1,
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <Box
              sx={{
                flex: 1,
                maxWidth: "100%",
                wordBreak: "break-word",
                overflowWrap: "break-word",
                "& > *:first-of-type": { mt: 0 },
                "& > *:last-child": { mb: 0 },
                "& pre": {
                  maxWidth: "100%",
                  overflow: "auto",
                },
                "& table": {
                  maxWidth: "100%",
                  overflow: "auto",
                  display: "block",
                },
              }}
            >
              {message.role === "assistant" ? (
                <Box>
                  {/* 思考内容 */}
                  {message.thinkContent && (
                    <ThinkContent
                      content={message.thinkContent}
                      defaultExpanded={false}
                      variant="minimal"
                    />
                  )}

                  {/* 正常回复内容 */}
                  {message.content && (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      components={markdownComponents}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </Box>
              ) : (
                <Typography
                  variant="body2"
                  sx={{
                    whiteSpace: "pre-wrap",
                    fontSize: "0.8rem",
                    lineHeight: 1.4,
                    m: 0,
                  }}
                >
                  {message.content}
                </Typography>
              )}
              {message.streaming && (
                <CircularProgress
                  size={10}
                  sx={{ ml: 1, display: "inline-block" }}
                />
              )}
            </Box>
            <IconButton
              size="small"
              onClick={() => handleCopyMessage(message)}
              sx={{
                ml: 1,
                color:
                  message.role === "user"
                    ? "primary.contrastText"
                    : "text.secondary",
              }}
            >
              <ContentCopyIcon fontSize="small" />
            </IconButton>
          </Box>
          <Typography
            variant="caption"
            sx={{
              opacity: 0.7,
              color:
                message.role === "user"
                  ? "primary.contrastText"
                  : "text.secondary",
              fontSize: "0.7rem",
              mt: 0.5,
              display: "block",
            }}
          >
            {new Date(message.timestamp).toLocaleTimeString()}
          </Typography>
        </ListItem>
      ));
    }, [messages, markdownComponents, handleCopyMessage]);

    // 使用 useMemo 优化 API 选择器选项
    const apiOptions = useMemo(() => {
      return apiConfigs.map((config) => (
        <MenuItem key={config.id} value={config.id}>
          {config.name}
        </MenuItem>
      ));
    }, [apiConfigs]);

    // 处理输入变化
    const handleInputChange = useCallback(
      (e) => {
        setInputValue(e.target.value);
        // 用户开始输入时立即清除错误消息
        if (error) {
          clearErrorTimeout();
          setError("");
        }
      },
      [error, clearErrorTimeout],
    );

    // 滚动到底部
    const scrollToBottom = useCallback(() => {
      if (messagesEndRef.current) {
        // 使用 setTimeout 确保 DOM 更新后再滚动
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "end",
            inline: "nearest",
          });
        }, 10);
      }
    }, []);

    // 监听消息变化并自动滚动
    useEffect(() => {
      scrollToBottom();
    }, [messages, scrollToBottom]);

    // 专门处理流式响应时的滚动
    useEffect(() => {
      const lastMessage = messages[messages.length - 1];
      if (lastMessage && lastMessage.streaming) {
        // 流式响应时更频繁地滚动，确保用户能看到实时内容
        scrollToBottom();
      }
    }, [messages, scrollToBottom]);

    // 监听流式响应
    useEffect(() => {
      if (!window.terminalAPI?.on) {
        return;
      }

      const handleStreamChunk = (data) => {
        // 验证会话ID，防止接收到上一次对话的回复
        if (
          data.tabId === "ai" &&
          data.chunk &&
          data.sessionId === currentSessionId
        ) {
          // 初始化思考内容处理器（如果还没有）
          if (!streamThinkProcessorRef.current) {
            streamThinkProcessorRef.current = new StreamThinkProcessor();
          }

          // 处理数据块
          const result = streamThinkProcessorRef.current.processChunk(
            data.chunk,
          );

          if (result.hasUpdate) {
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];

              if (
                lastMessage &&
                lastMessage.role === "assistant" &&
                lastMessage.streaming
              ) {
                // 更新现有消息
                lastMessage.content = result.normalContent;
                lastMessage.thinkContent = result.thinkContent;
              } else {
                // 创建新消息
                const newMessage = {
                  role: "assistant",
                  content: result.normalContent,
                  thinkContent: result.thinkContent,
                  timestamp: Date.now(),
                  streaming: true,
                };
                newMessages.push(newMessage);
              }
              return newMessages;
            });
          }
        }
      };

      const handleStreamEnd = (data) => {
        if (data.tabId === "ai" && data.sessionId === currentSessionId) {
          // 完成思考内容处理
          if (streamThinkProcessorRef.current) {
            const finalResult = streamThinkProcessorRef.current.finalize();

            console.log("[AIChatWindow] 流式响应结束，最终处理结果:", {
              thinkContentLength: finalResult.thinkContent.length,
              normalContentLength: finalResult.normalContent.length,
              sessionId: currentSessionId,
            });

            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (
                lastMessage &&
                lastMessage.role === "assistant" &&
                lastMessage.streaming
              ) {
                // 额外的安全检查：对最终内容进行强制二次处理
                const combinedRawContent =
                  (finalResult.thinkContent
                    ? `<think>${finalResult.thinkContent}</think>`
                    : "") + finalResult.normalContent;

                const {
                  thinkContent: finalThinkContent,
                  normalContent: finalNormalContent,
                } = parseThinkContent(combinedRawContent);

                console.log("[AIChatWindow] 强制二次处理结果:", {
                  beforeThinkLength: finalResult.thinkContent.length,
                  afterThinkLength: finalThinkContent.length,
                  beforeNormalLength: finalResult.normalContent.length,
                  afterNormalLength: finalNormalContent.length,
                });

                lastMessage.streaming = false;
                lastMessage.content = finalNormalContent;
                lastMessage.thinkContent = finalThinkContent;

                // 添加处理完成的标记，便于调试
                lastMessage.processedAt = Date.now();
                lastMessage.hasThinkContent = !!finalThinkContent;
                lastMessage.finalProcessed = true;
              }
              return newMessages;
            });

            // 重置处理器
            streamThinkProcessorRef.current = null;
          } else {
            setMessages((prev) => {
              const newMessages = [...prev];
              const lastMessage = newMessages[newMessages.length - 1];
              if (
                lastMessage &&
                lastMessage.role === "assistant" &&
                lastMessage.streaming
              ) {
                lastMessage.streaming = false;
              }
              return newMessages;
            });
          }

          setIsLoading(false);

          // 如果是中断结束，清理会话ID
          if (data.aborted) {
            setCurrentSessionId(null);
          }
        }
      };

      const handleStreamError = (data) => {
        if (data.tabId === "ai") {
          setError(data.error?.message || t("aiAssistant.error"));
          setIsLoading(false);
        }
      };

      window.terminalAPI.on("stream-chunk", handleStreamChunk);
      window.terminalAPI.on("stream-end", handleStreamEnd);
      window.terminalAPI.on("stream-error", handleStreamError);

      return () => {
        if (window.terminalAPI?.removeListener) {
          window.terminalAPI.removeListener("stream-chunk", handleStreamChunk);
          window.terminalAPI.removeListener("stream-end", handleStreamEnd);
          window.terminalAPI.removeListener("stream-error", handleStreamError);
        }
      };
    }, [t, currentSessionId]);

    const handleSendMessage = async () => {
      if (!inputValue.trim() || isLoading) return;

      // 生成新的会话ID
      const sessionId =
        Date.now().toString() + Math.random().toString(36).substring(2, 11);
      setCurrentSessionId(sessionId);

      const userMessage = {
        role: "user",
        content: inputValue.trim(),
        timestamp: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInputValue("");
      setIsLoading(true);
      // 清除错误状态和定时器
      clearErrorTimeout();
      setError("");

      try {
        const settings = await window.terminalAPI?.loadAISettings();
        if (!settings || !settings.current) {
          setError(t("aiAssistant.apiError"));
          setIsLoading(false);
          return;
        }

        const { apiUrl, apiKey, model, streamEnabled } = settings.current;

        if (!apiUrl || !apiKey || !model) {
          setError(t("aiAssistant.apiError"));
          setIsLoading(false);
          return;
        }

        const requestData = {
          url: apiUrl,
          apiKey: apiKey,
          model: model,
          sessionId: sessionId,
          messages: [...messages, userMessage].map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
        };

        if (streamEnabled) {
          await window.terminalAPI.sendAPIRequest(requestData, true);
        } else {
          const result = await window.terminalAPI.sendAPIRequest(
            requestData,
            false,
          );
          if (result && result.choices && result.choices[0]) {
            const rawContent = result.choices[0].message.content;
            const { thinkContent, normalContent } =
              parseThinkContent(rawContent);

            const assistantMessage = {
              role: "assistant",
              content: normalContent,
              thinkContent: thinkContent,
              timestamp: Date.now(),
            };
            setMessages((prev) => [...prev, assistantMessage]);
          } else if (result && result.error) {
            setError(result.error);
          }
          setIsLoading(false);
        }
      } catch (err) {
        setError(err.message || t("aiAssistant.networkError"));
        setIsLoading(false);
      }
    };

    // Optimized Drag Event Handling

    const updateWindowStyleOnDrag = useCallback(() => {
      if (windowRef.current && currentPositionRef.current) {
        const { x, y } = currentPositionRef.current;
        windowRef.current.style.left = `${x}px`;
        windowRef.current.style.top = `${y}px`;
      }
      animationFrameRef.current = null;
    }, []);

    const handleGlobalMouseMove = useCallback(
      (e) => {
        if (!isDraggingRef.current) return;

        let newX = e.clientX - dragStartOffsetRef.current.x;
        let newY = e.clientY - dragStartOffsetRef.current.y;

        // Boundary checks
        const maxX = window.innerWidth - windowSize.width;
        const maxY = window.innerHeight - windowSize.height;
        newX = Math.max(0, Math.min(newX, maxX));
        newY = Math.max(0, Math.min(newY, maxY));

        currentPositionRef.current = { x: newX, y: newY };

        if (animationFrameRef.current === null) {
          animationFrameRef.current = requestAnimationFrame(
            updateWindowStyleOnDrag,
          );
        }
      },
      [windowSize.width, windowSize.height, updateWindowStyleOnDrag],
    );

    const handleGlobalMouseUp = useCallback(() => {
      if (!isDraggingRef.current) return;

      isDraggingRef.current = false;
      document.removeEventListener("mousemove", handleGlobalMouseMove);
      document.removeEventListener("mouseup", handleGlobalMouseUp);
      document.body.style.userSelect = "";

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      // Sync React state with the final position
      if (currentPositionRef.current) {
        setWindowPosition(currentPositionRef.current);
      }
    }, [handleGlobalMouseMove]);

    const handleMouseDown = useCallback(
      (e) => {
        if (
          e.target.closest(".window-controls") ||
          e.target.closest(".MuiSelect-root")
        ) {
          // Do not start drag if clicking on window controls or the select component
          return;
        }
        e.preventDefault();

        isDraggingRef.current = true;
        dragStartOffsetRef.current = {
          x: e.clientX - windowPosition.x,
          y: e.clientY - windowPosition.y,
        };
        // currentPositionRef.current is already up-to-date from setWindowPosition or initial state
        // No need to set it here if windowPosition is the source of truth before drag starts

        document.addEventListener("mousemove", handleGlobalMouseMove);
        document.addEventListener("mouseup", handleGlobalMouseUp);
        document.body.style.userSelect = "none";
      },
      [
        windowPosition.x,
        windowPosition.y,
        handleGlobalMouseMove,
        handleGlobalMouseUp,
      ],
    );

    // 尺寸调整处理（使用防抖优化）
    const handleResize = useCallback(
      (_, { size }) => {
        // 立即更新尺寸以保持响应性
        setWindowSize(size);
        // 防抖处理其他相关更新
        debouncedSetWindowSize(size);
      },
      [debouncedSetWindowSize],
    );

    // Cleanup global listeners if component unmounts while dragging
    useEffect(() => {
      return () => {
        if (isDraggingRef.current) {
          document.removeEventListener("mousemove", handleGlobalMouseMove);
          document.removeEventListener("mouseup", handleGlobalMouseUp);
          document.body.style.userSelect = "";
          if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
          }
        }
      };
    }, [handleGlobalMouseMove, handleGlobalMouseUp]);

    // 窗口尺寸变化时重新计算位置（确保不超出边界）
    useEffect(() => {
      const margin = 20;
      const maxX = window.innerWidth - windowSize.width - margin;
      const maxY = window.innerHeight - windowSize.height - margin;

      setWindowPosition((prev) => ({
        x: Math.max(margin, Math.min(prev.x, maxX)),
        y: Math.max(margin, Math.min(prev.y, maxY)),
      }));
    }, [windowSize]);

    // 组件卸载时清理定时器
    useEffect(() => {
      return () => {
        clearErrorTimeout();
      };
    }, []);

    // 根据窗口状态决定是否显示
    if (windowState === WINDOW_STATE.CLOSED) return null;

    return (
      <Resizable
        width={windowSize.width}
        height={windowSize.height}
        onResize={handleResize}
        minConstraints={[280, 300]}
        maxConstraints={maxConstraints}
        resizeHandles={["se", "e", "s"]}
      >
        <Paper
          ref={windowRef}
          elevation={8}
          sx={{
            position: "fixed",
            left: windowPosition.x, // Initial position from state
            top: windowPosition.y, // Initial position from state
            width: windowSize.width,
            height: windowSize.height,
            display: "flex",
            flexDirection: "column",
            borderRadius: 2,
            zIndex: 1300,
            overflow: "hidden",
            backdropFilter: "blur(10px)",
            border: `1px solid ${theme.palette.divider}`,
            // cursor will be set by onMouseDown logic
            opacity: windowState === WINDOW_STATE.VISIBLE ? 1 : 0.9,
            transition:
              "opacity 0.3s ease-in-out, width 0.1s ease-out, height 0.1s ease-out",
            // userSelect is handled globally during drag
          }}
        >
          {/* 标题栏 */}
          <Box
            onMouseDown={handleMouseDown} // Apply to the drag handle
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 1.5,
              bgcolor: "primary.main",
              color: "primary.contrastText",
              cursor: "grab", // Default cursor for draggable area
              userSelect: "none", // Prevent text selection on the title bar
              "&:active": {
                cursor: "grabbing", // Cursor while dragging
              },
            }}
          >
            <Box
              sx={{ display: "flex", alignItems: "center", gap: 1, flex: 1 }}
            >
              <Typography variant="subtitle2" fontWeight="medium">
                {t("aiAssistant.title")}
              </Typography>

              {/* API选择器 */}
              {apiConfigs.length > 0 && (
                <FormControl
                  size="small"
                  sx={{
                    minWidth: 120,
                    "& .MuiOutlinedInput-root": {
                      color: "inherit",
                      fontSize: "0.75rem",
                      "& fieldset": {
                        borderColor: "rgba(255, 255, 255, 0.3)",
                      },
                      "&:hover fieldset": {
                        borderColor: "rgba(255, 255, 255, 0.5)",
                      },
                      "&.Mui-focused fieldset": {
                        borderColor: "rgba(255, 255, 255, 0.7)",
                      },
                    },
                    "& .MuiSelect-icon": {
                      color: "inherit",
                    },
                  }}
                >
                  <Select
                    value={currentApiId || ""}
                    onChange={(e) => handleApiChange(e.target.value)}
                    displayEmpty
                    variant="outlined"
                    sx={{
                      color: "inherit",
                      fontSize: "0.75rem",
                    }}
                    onMouseDown={(e) => e.stopPropagation()} // 防止拖拽，但不影响Select的正常功能
                  >
                    {apiOptions}
                  </Select>
                </FormControl>
              )}
            </Box>

            <Box className="window-controls">
              <Tooltip title={t("aiAssistant.clear")}>
                <IconButton
                  onClick={handleClearMessages}
                  size="small"
                  sx={{ color: "inherit" }}
                >
                  <CleaningServicesIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("aiAssistant.settings")}>
                <IconButton
                  onClick={() => setSettingsOpen(true)}
                  size="small"
                  sx={{ color: "inherit" }}
                >
                  <SettingsIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("aiAssistant.close")}>
                <IconButton
                  onClick={onClose}
                  size="small"
                  sx={{ color: "inherit" }}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* 错误提示 */}
          {error && (
            <Box sx={{ p: 1 }}>
              <Alert
                severity="error"
                size="small"
                onClose={() => {
                  clearErrorTimeout();
                  setError("");
                }}
              >
                {error}
              </Alert>
            </Box>
          )}

          {/* 消息列表 */}
          <Box
            sx={{
              flex: 1,
              overflow: "auto",
              p: 1,
              bgcolor: "background.default",
              display: "flex",
              flexDirection: "column",
              minHeight: 0, // 确保flex子元素能正确收缩
              // 自定义滚动条样式
              "&::-webkit-scrollbar": {
                width: "6px",
              },
              "&::-webkit-scrollbar-track": {
                background: "transparent",
              },
              "&::-webkit-scrollbar-thumb": {
                background: "rgba(0,0,0,0.2)",
                borderRadius: "3px",
              },
              "&::-webkit-scrollbar-thumb:hover": {
                background: "rgba(0,0,0,0.3)",
              },
            }}
          >
            {messages.length === 0 ? (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  textAlign: "center",
                  color: "text.secondary",
                }}
              >
                <Typography variant="body2">
                  {t("aiAssistant.noMessages")}
                </Typography>
              </Box>
            ) : (
              <List sx={{ p: 0, flex: 1 }}>
                {messagesList}
                <div ref={messagesEndRef} style={{ height: "1px" }} />
              </List>
            )}
          </Box>

          {/* 输入区域 */}
          <Box
            sx={{
              p: 1.5,
              bgcolor: "background.paper",
              borderTop: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={t("aiAssistant.placeholder")}
                multiline
                maxRows={6} // <--- Changed from 2 to 6
                fullWidth
                size="small"
                disabled={isLoading}
                variant="outlined"
                sx={{
                  "& .MuiOutlinedInput-root": {
                    fontSize: "0.8rem",
                  },
                }}
              />
              <IconButton
                onClick={isLoading ? handleStopRequest : handleSendMessage}
                disabled={!isLoading && !inputValue.trim()}
                color={isLoading ? "error" : "primary"}
                size="small"
                sx={{ alignSelf: "flex-end" }}
              >
                {isLoading ? (
                  <StopIcon fontSize="small" />
                ) : (
                  <SendIcon fontSize="small" />
                )}
              </IconButton>
            </Box>
          </Box>

          {/* AI设置对话框 */}
          <AISettings
            open={settingsOpen}
            onClose={() => {
              setSettingsOpen(false);
              // 设置关闭后重新加载API配置
              loadApiConfigs();
            }}
          />
        </Paper>
      </Resizable>
    );
  },
  areEqual,
);

// 设置显示名称用于调试
AIChatWindow.displayName = "AIChatWindow";

export default AIChatWindow;
