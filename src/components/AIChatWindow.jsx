import React, { useState, useEffect, useRef, useCallback } from "react";
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
  InputLabel,
  useTheme,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import SettingsIcon from "@mui/icons-material/Settings";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import { useTranslation } from "react-i18next";
import { Resizable } from "react-resizable";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import AISettings from "./AISettings.jsx";
import ThinkContent from "./ThinkContent.jsx";
import { StreamThinkProcessor, parseThinkContent } from "../utils/thinkContentProcessor.js";
import "react-resizable/css/styles.css";
import "highlight.js/styles/github.css"; // 代码高亮样式

// 防抖工具函数
const useDebounce = (callback, delay) => {
  const timeoutRef = useRef(null);

  return useCallback((...args) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      callback(...args);
    }, delay);
  }, [callback, delay]);
};

// 窗口状态枚举
const WINDOW_STATE = {
  VISIBLE: 'visible',
  CLOSED: 'closed'
};

const AIChatWindow = ({ windowState, onClose }) => {
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

  // 窗口位置和尺寸状态
  const [windowSize, setWindowSize] = useState({ width: 350, height: 450 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [maxConstraints, setMaxConstraints] = useState([800, 600]);
  const windowRef = useRef(null);

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
  const calculateInitialPosition = () => {
    const margin = 20; // 距离边缘的边距
    const x = window.innerWidth - windowSize.width - margin;
    const y = window.innerHeight - windowSize.height - margin;
    return {
      x: Math.max(margin, x),
      y: Math.max(margin, y)
    };
  };

  const [windowPosition, setWindowPosition] = useState(calculateInitialPosition);

  // 初始化最大尺寸约束
  useEffect(() => {
    const updateMaxConstraints = () => {
      const newConstraints = calculateMaxConstraints();
      setMaxConstraints(newConstraints);
    };

    // 初始设置
    updateMaxConstraints();

    // 监听窗口尺寸变化
    window.addEventListener('resize', updateMaxConstraints);

    return () => {
      window.removeEventListener('resize', updateMaxConstraints);
    };
  }, [calculateMaxConstraints]);

  // 加载API配置
  useEffect(() => {
    loadApiConfigs();
  }, []);

  const loadApiConfigs = async () => {
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
  };

  // 切换API配置
  const handleApiChange = async (apiId) => {
    try {
      const result = await window.terminalAPI.setCurrentApiConfig(apiId);
      if (result) {
        // 重新加载配置以更新当前API
        await loadApiConfigs();

        // 显示切换成功消息
        const selectedApi = apiConfigs.find(api => api.id === apiId);
        if (selectedApi) {
          setErrorWithAutoClean(t("aiSettings.apiSwitched", { name: selectedApi.name }));
        }
      } else {
        setError(t("aiSettings.setCurrentFailed"));
      }
    } catch (error) {
      setError(t("aiSettings.setCurrentFailed"));
    }
  };

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      // 使用 setTimeout 确保 DOM 更新后再滚动
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
          inline: "nearest"
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
      if (data.tabId === "ai" && data.chunk && data.sessionId === currentSessionId) {
        // 初始化思考内容处理器（如果还没有）
        if (!streamThinkProcessorRef.current) {
          streamThinkProcessorRef.current = new StreamThinkProcessor();
        }

        // 处理数据块
        const result = streamThinkProcessorRef.current.processChunk(data.chunk);

        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];

          if (lastMessage && lastMessage.role === "assistant" && lastMessage.streaming) {
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
    };

    const handleStreamEnd = (data) => {
      if (data.tabId === "ai" && data.sessionId === currentSessionId) {
        // 完成思考内容处理
        if (streamThinkProcessorRef.current) {
          const finalResult = streamThinkProcessorRef.current.finalize();

          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage && lastMessage.role === "assistant" && lastMessage.streaming) {
              lastMessage.streaming = false;
              lastMessage.content = finalResult.normalContent;
              lastMessage.thinkContent = finalResult.thinkContent;
            }
            return newMessages;
          });

          // 重置处理器
          streamThinkProcessorRef.current = null;
        } else {
          setMessages(prev => {
            const newMessages = [...prev];
            const lastMessage = newMessages[newMessages.length - 1];
            if (lastMessage && lastMessage.role === "assistant" && lastMessage.streaming) {
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
    const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 11);
    setCurrentSessionId(sessionId);

    const userMessage = {
      role: "user",
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
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
        messages: [...messages, userMessage].map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      };

      if (streamEnabled) {
        await window.terminalAPI.sendAPIRequest(requestData, true);
      } else {
        const result = await window.terminalAPI.sendAPIRequest(requestData, false);
        if (result && result.choices && result.choices[0]) {
          const rawContent = result.choices[0].message.content;
          const { thinkContent, normalContent } = parseThinkContent(rawContent);

          const assistantMessage = {
            role: "assistant",
            content: normalContent,
            thinkContent: thinkContent,
            timestamp: Date.now(),
          };
          setMessages(prev => [...prev, assistantMessage]);
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

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearMessages = () => {
    setMessages([]);
    clearErrorTimeout();
    setError("");
  };

  const handleCopyMessage = async (message) => {
    try {
      let contentToCopy = message.content || '';

      // 如果有思考内容，也包含在复制内容中
      if (message.thinkContent) {
        contentToCopy = `<think>\n${message.thinkContent}\n</think>\n\n${contentToCopy}`;
      }

      await navigator.clipboard.writeText(contentToCopy);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // 清除错误消息定时器
  const clearErrorTimeout = () => {
    if (errorTimeoutRef.current) {
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = null;
    }
  };

  // 设置错误消息并启动自动清除定时器
  const setErrorWithAutoClean = (errorMessage) => {
    clearErrorTimeout(); // 清除之前的定时器
    setError(errorMessage);

    // 3秒后自动清除错误消息
    errorTimeoutRef.current = setTimeout(() => {
      setError("");
      errorTimeoutRef.current = null;
    }, 3000);
  };

  // 中止当前请求
  const handleStopRequest = () => {
    if (isLoading) {
      setIsLoading(false);
      setErrorWithAutoClean(t("aiAssistant.requestCancelled"));

      // 如果有正在进行的流式响应，标记最后一条消息为完成状态
      setMessages(prev => {
        const newMessages = [...prev];
        const lastMessage = newMessages[newMessages.length - 1];
        if (lastMessage && lastMessage.role === "assistant" && lastMessage.streaming) {
          lastMessage.streaming = false;
        }
        return newMessages;
      });

      // 清理当前会话ID，确保下次请求是新会话
      setCurrentSessionId(null);

      // 通知后端中止请求（如果API支持）
      if (window.terminalAPI?.cancelAPIRequest) {
        window.terminalAPI.cancelAPIRequest();
      }
    }
  };

  // Markdown渲染配置
  const markdownComponents = {
    // 自定义代码块样式
    code: ({ node, inline, className, children, ...props }) => {
      return !inline ? (
        <Box
          component="pre"
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
            p: 1.5,
            borderRadius: 1,
            overflow: 'auto',
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            border: `1px solid ${theme.palette.divider}`,
            my: 1,
            maxWidth: '100%',
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
          }}
        >
          <code className={className} {...props}>
            {children}
          </code>
        </Box>
      ) : (
        <Box
          component="code"
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}
          {...props}
        >
          {children}
        </Box>
      );
    },
    // 自定义段落样式
    p: ({ children }) => (
      <Typography
        variant="body2"
        sx={{
          fontSize: '0.8rem',
          lineHeight: 1.4,
          mb: 1,
          wordBreak: 'break-word',
          overflowWrap: 'break-word',
          '&:last-child': { mb: 0 },
        }}
      >
        {children}
      </Typography>
    ),
    // 自定义列表样式
    ul: ({ children }) => (
      <Box component="ul" sx={{
        pl: 2,
        my: 1,
        fontSize: '0.8rem',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }}>
        {children}
      </Box>
    ),
    ol: ({ children }) => (
      <Box component="ol" sx={{
        pl: 2,
        my: 1,
        fontSize: '0.8rem',
        wordBreak: 'break-word',
        overflowWrap: 'break-word',
      }}>
        {children}
      </Box>
    ),
    // 自定义表格样式
    table: ({ children }) => (
      <Box
        component="table"
        sx={{
          width: '100%',
          maxWidth: '100%',
          borderCollapse: 'collapse',
          my: 1,
          fontSize: '0.75rem',
          overflow: 'auto',
          display: 'block',
          whiteSpace: 'nowrap',
        }}
      >
        {children}
      </Box>
    ),
    // 自定义链接样式
    a: ({ children, href }) => (
      <Box
        component="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        sx={{
          color: 'primary.main',
          textDecoration: 'underline',
          wordBreak: 'break-all',
          overflowWrap: 'break-word',
          '&:hover': {
            color: 'primary.dark',
          },
        }}
      >
        {children}
      </Box>
    ),
  };

  // 拖拽事件处理
  const handleMouseDown = (e) => {
    if (e.target.closest('.window-controls')) return; // 不在控制按钮上拖拽

    // 阻止默认行为，防止选中文本
    e.preventDefault();

    setIsDragging(true);
    setDragStart({
      x: e.clientX - windowPosition.x,
      y: e.clientY - windowPosition.y,
    });

    // 添加全局样式，防止拖拽时选中内容
    document.body.style.userSelect = 'none';
    document.body.style.pointerEvents = 'none';
    // 保持窗口的pointer-events
    if (windowRef.current) {
      windowRef.current.style.pointerEvents = 'auto';
    }
  };

  const handleMouseMove = (e) => {
    if (!isDragging) return;

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;

    // 边界限制
    const maxX = window.innerWidth - windowSize.width;
    const maxY = window.innerHeight - windowSize.height;

    setWindowPosition({
      x: Math.max(0, Math.min(newX, maxX)),
      y: Math.max(0, Math.min(newY, maxY)),
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);

    // 恢复全局样式
    document.body.style.userSelect = '';
    document.body.style.pointerEvents = '';
    if (windowRef.current) {
      windowRef.current.style.pointerEvents = '';
    }
  };

  // 尺寸调整处理（使用防抖优化）
  const handleResize = useCallback((_, { size }) => {
    // 立即更新尺寸以保持响应性
    setWindowSize(size);

    // 防抖处理其他相关更新
    debouncedSetWindowSize(size);
  }, [debouncedSetWindowSize]);

  // 添加全局鼠标事件监听
  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, dragStart, windowPosition, windowSize]);

  // 窗口尺寸变化时重新计算位置（确保不超出边界）
  useEffect(() => {
    const margin = 20;
    const maxX = window.innerWidth - windowSize.width - margin;
    const maxY = window.innerHeight - windowSize.height - margin;

    setWindowPosition(prev => ({
      x: Math.max(margin, Math.min(prev.x, maxX)),
      y: Math.max(margin, Math.min(prev.y, maxY))
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
      resizeHandles={['se', 'e', 's']}
    >
      <Paper
        ref={windowRef}
        elevation={8}
        sx={{
          position: "fixed",
          left: windowPosition.x,
          top: windowPosition.y,
          width: windowSize.width,
          height: windowSize.height,
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          zIndex: 1300,
          overflow: "hidden",
          backdropFilter: "blur(10px)",
          border: `1px solid ${theme.palette.divider}`,
          cursor: isDragging ? 'grabbing' : 'default',
          opacity: windowState === WINDOW_STATE.VISIBLE ? 1 : 0.9,
          transition: 'opacity 0.3s ease-in-out, width 0.1s ease-out, height 0.1s ease-out',
          userSelect: isDragging ? 'none' : 'auto',
        }}
      >
        {/* 标题栏 */}
        <Box
          onMouseDown={handleMouseDown}
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            p: 1.5,
            bgcolor: "primary.main",
            color: "primary.contrastText",
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none', // 防止标题栏文字被选中
            '&:active': {
              cursor: 'grabbing',
            },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
            <Typography variant="subtitle2" fontWeight="medium">
              {t("aiAssistant.title")}
            </Typography>

            {/* API选择器 */}
            {apiConfigs.length > 0 && (
              <FormControl
                size="small"
                sx={{
                  minWidth: 120,
                  '& .MuiOutlinedInput-root': {
                    color: 'inherit',
                    fontSize: '0.75rem',
                    '& fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.3)',
                    },
                    '&:hover fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.5)',
                    },
                    '&.Mui-focused fieldset': {
                      borderColor: 'rgba(255, 255, 255, 0.7)',
                    },
                  },
                  '& .MuiSelect-icon': {
                    color: 'inherit',
                  },
                }}
              >
                <Select
                  value={currentApiId || ""}
                  onChange={(e) => handleApiChange(e.target.value)}
                  displayEmpty
                  variant="outlined"
                  sx={{
                    color: 'inherit',
                    fontSize: '0.75rem',
                  }}
                  onMouseDown={(e) => e.stopPropagation()} // 防止拖拽，但不影响Select的正常功能
                >
                  {apiConfigs.map((api) => (
                    <MenuItem key={api.id} value={api.id}>
                      <Typography variant="body2" fontSize="0.75rem">
                        {api.name}
                      </Typography>
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>

          <Box className="window-controls">
            <Tooltip title={t("aiAssistant.clear")}>
              <IconButton onClick={handleClearMessages} size="small" sx={{ color: "inherit" }}>
                <CleaningServicesIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("aiAssistant.settings")}>
              <IconButton onClick={() => setSettingsOpen(true)} size="small" sx={{ color: "inherit" }}>
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("aiAssistant.close")}>
              <IconButton onClick={onClose} size="small" sx={{ color: "inherit" }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* 错误提示 */}
        {error && (
          <Box sx={{ p: 1 }}>
            <Alert severity="error" size="small" onClose={() => {
              clearErrorTimeout();
              setError("");
            }}>
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
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              background: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '3px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: 'rgba(0,0,0,0.3)',
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
              {messages.map((message, index) => (
                <ListItem
                  key={index}
                  sx={{
                    display: "block",
                    p: 1,
                    mb: 1,
                    borderRadius: 1,
                    bgcolor: message.role === "user"
                      ? "primary.main"
                      : "background.paper",
                    color: message.role === "user"
                      ? "primary.contrastText"
                      : "text.primary",
                    boxShadow: 1,
                  }}
                >
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <Box
                      sx={{
                        flex: 1,
                        maxWidth: '100%',
                        wordBreak: "break-word",
                        overflowWrap: 'break-word',
                        '& > *:first-of-type': { mt: 0 },
                        '& > *:last-child': { mb: 0 },
                        '& pre': {
                          maxWidth: '100%',
                          overflow: 'auto',
                        },
                        '& table': {
                          maxWidth: '100%',
                          overflow: 'auto',
                          display: 'block',
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
                        <CircularProgress size={10} sx={{ ml: 1, display: 'inline-block' }} />
                      )}
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => handleCopyMessage(message)}
                      sx={{
                        ml: 1,
                        color: message.role === "user"
                          ? "primary.contrastText"
                          : "text.secondary"
                      }}
                    >
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      opacity: 0.7,
                      color: message.role === "user"
                        ? "primary.contrastText"
                        : "text.secondary",
                      fontSize: "0.7rem",
                      mt: 0.5,
                      display: "block"
                    }}
                  >
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </Typography>
                </ListItem>
              ))}
              <div ref={messagesEndRef} style={{ height: '1px' }} />
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
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                // 用户开始输入时立即清除错误消息
                if (error) {
                  clearErrorTimeout();
                  setError("");
                }
              }}
              onKeyDown={handleKeyDown}
              placeholder={t("aiAssistant.placeholder")}
              multiline
              maxRows={2}
              fullWidth
              size="small"
              disabled={isLoading}
              variant="outlined"
              sx={{
                "& .MuiOutlinedInput-root": {
                  fontSize: "0.8rem",
                }
              }}
            />
            <IconButton
              onClick={isLoading ? handleStopRequest : handleSendMessage}
              disabled={!isLoading && !inputValue.trim()}
              color={isLoading ? "error" : "primary"}
              size="small"
              sx={{ alignSelf: "flex-end" }}
            >
              {isLoading ? <StopIcon fontSize="small" /> : <SendIcon fontSize="small" />}
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
};

export default AIChatWindow;
