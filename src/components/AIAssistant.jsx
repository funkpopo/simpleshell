import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box,
  Paper,
  Typography,
  TextField,
  IconButton,
  List,
  ListItem,
  Divider,
  Tooltip,
  CircularProgress,
  Alert,
  Fade,
  Slide,
  Select,
  MenuItem,
  FormControl,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import StopIcon from "@mui/icons-material/Stop";
import SettingsIcon from "@mui/icons-material/Settings";
import ClearIcon from "@mui/icons-material/Clear";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import AISettings from "./AISettings.jsx";
import ThinkContent from "./ThinkContent.jsx";
import {
  StreamThinkProcessor,
  parseThinkContent,
} from "../utils/thinkContentProcessor.js";
import "highlight.js/styles/github.css"; // 代码高亮样式

const AIAssistant = ({ open, onClose }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const errorTimeoutRef = useRef(null); // 用于错误消息自动清除的定时器

  // API选择相关状态
  const [apiConfigs, setApiConfigs] = useState([]);
  const [currentApiId, setCurrentApiId] = useState(null);
  const [currentApiName, setCurrentApiName] = useState("");

  // 思考内容处理器
  const streamThinkProcessorRef = useRef(null);

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
    if (!window.terminalAPI?.on) return;

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
        const result = streamThinkProcessorRef.current.processChunk(data.chunk);

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
      } else if (data.sessionId !== currentSessionId) {
        console.log(
          "AIAssistant - 忽略过期会话的数据:",
          data.sessionId,
          "当前会话:",
          currentSessionId,
        );
      }
    };

    const handleStreamEnd = (data) => {
      if (data.tabId === "ai" && data.sessionId === currentSessionId) {
        // 完成思考内容处理
        if (streamThinkProcessorRef.current) {
          const finalResult = streamThinkProcessorRef.current.finalize();

          console.log("[AIAssistant] 流式响应结束，最终处理结果:", {
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

              console.log("[AIAssistant] 强制二次处理结果:", {
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
      // 清理事件监听器
      if (window.terminalAPI?.removeListener) {
        window.terminalAPI.removeListener("stream-chunk", handleStreamChunk);
        window.terminalAPI.removeListener("stream-end", handleStreamEnd);
        window.terminalAPI.removeListener("stream-error", handleStreamError);
      }
    };
  }, [t, currentSessionId]);

  // 加载API配置
  useEffect(() => {
    if (open) {
      loadApiConfigs();
    }
  }, [open]);

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
        const selectedApi = apiConfigs.find((api) => api.id === apiId);
        if (selectedApi) {
          setErrorWithAutoClean(
            t("aiSettings.apiSwitched", { name: selectedApi.name }),
          );
        }
      } else {
        setError(t("aiSettings.setCurrentFailed"));
      }
    } catch (error) {
      setError(t("aiSettings.setCurrentFailed"));
    }
  };

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      clearErrorTimeout();
    };
  }, []);

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
      // 加载AI设置
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
        // 流式响应
        await window.terminalAPI.sendAPIRequest(requestData, true);
      } else {
        // 非流式响应
        const result = await window.terminalAPI.sendAPIRequest(
          requestData,
          false,
        );
        if (result && result.choices && result.choices[0]) {
          const rawContent = result.choices[0].message.content;
          const { thinkContent, normalContent } = parseThinkContent(rawContent);

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
      let contentToCopy = message.content || "";

      // 如果有思考内容，也包含在复制内容中
      if (message.thinkContent) {
        contentToCopy = `<think>${message.thinkContent}</think>${contentToCopy}`;
      }

      await navigator.clipboard.writeText(contentToCopy);
      // 可以添加一个临时的成功提示
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // 中止当前请求
  const handleStopRequest = () => {
    if (isLoading) {
      setIsLoading(false);
      setErrorWithAutoClean(t("aiAssistant.requestCancelled"));

      // 如果有正在进行的流式响应，标记最后一条消息为完成状态
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
            bgcolor: theme.palette.mode === "dark" ? "grey.900" : "grey.100",
            p: 1.5,
            borderRadius: 1,
            overflow: "auto",
            fontSize: "0.75rem",
            fontFamily: "monospace",
            border: `1px solid ${theme.palette.divider}`,
            my: 1,
            maxWidth: "100%",
            wordBreak: "break-all",
            whiteSpace: "pre-wrap",
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
            bgcolor: theme.palette.mode === "dark" ? "grey.800" : "grey.200",
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: "0.75rem",
            fontFamily: "monospace",
            wordBreak: "break-all",
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
          fontSize: "0.8rem",
          lineHeight: 1.4,
          mb: 1,
          wordBreak: "break-word",
          overflowWrap: "break-word",
          "&:last-child": { mb: 0 },
        }}
      >
        {children}
      </Typography>
    ),
    // 自定义列表样式
    ul: ({ children }) => (
      <Box
        component="ul"
        sx={{
          pl: 2,
          my: 1,
          fontSize: "0.8rem",
          wordBreak: "break-word",
          overflowWrap: "break-word",
        }}
      >
        {children}
      </Box>
    ),
    ol: ({ children }) => (
      <Box
        component="ol"
        sx={{
          pl: 2,
          my: 1,
          fontSize: "0.8rem",
          wordBreak: "break-word",
          overflowWrap: "break-word",
        }}
      >
        {children}
      </Box>
    ),
    // 自定义表格样式
    table: ({ children }) => (
      <Box
        component="table"
        sx={{
          width: "100%",
          maxWidth: "100%",
          borderCollapse: "collapse",
          my: 1,
          fontSize: "0.75rem",
          overflow: "auto",
          display: "block",
          whiteSpace: "nowrap",
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
          color: "primary.main",
          textDecoration: "underline",
          wordBreak: "break-all",
          overflowWrap: "break-word",
          "&:hover": {
            color: "primary.dark",
          },
        }}
      >
        {children}
      </Box>
    ),
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  if (!open) return null;

  return (
    <Slide direction="left" in={open} mountOnEnter unmountOnExit>
      <Paper
        elevation={4}
        sx={{
          width: 300,
          height: "100%",
          display: "flex",
          flexDirection: "column",
          borderRadius: 0,
          borderLeft: `1px solid ${theme.palette.divider}`,
        }}
      >
        {/* 标题栏 */}
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            p: 2,
            borderBottom: `1px solid ${theme.palette.divider}`,
            bgcolor: "background.paper",
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {t("aiAssistant.title")}
            </Typography>
            <Box>
              <Tooltip title={t("aiAssistant.clear")}>
                <IconButton onClick={handleClearMessages} size="small">
                  <ClearIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("aiAssistant.settings")}>
                <IconButton onClick={() => setSettingsOpen(true)} size="small">
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title={t("aiAssistant.close")}>
                <IconButton onClick={onClose} size="small">
                  <CloseIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>

          {/* API选择器 */}
          {apiConfigs.length > 0 && (
            <FormControl size="small" fullWidth>
              <Select
                value={currentApiId || ""}
                onChange={(e) => handleApiChange(e.target.value)}
                displayEmpty
                variant="outlined"
                sx={{
                  fontSize: "0.8rem",
                }}
              >
                {apiConfigs.map((api) => (
                  <MenuItem key={api.id} value={api.id}>
                    <Typography variant="body2" fontSize="0.8rem">
                      {api.name}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
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
              {messages.map((message, index) => (
                <ListItem
                  key={index}
                  sx={{
                    display: "block",
                    p: 1,
                    mb: 1,
                    borderRadius: 1,
                    bgcolor:
                      message.role === "user"
                        ? "primary.main"
                        : "background.default",
                    color:
                      message.role === "user"
                        ? "primary.contrastText"
                        : "text.primary",
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
                        <Box data-role="assistant">
                          {/* 思考内容 */}
                          {message.thinkContent && (
                            <Box>
                              <ThinkContent
                                content={message.thinkContent}
                                defaultExpanded={false}
                                variant="minimal"
                              />
                            </Box>
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
                          size={12}
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
                      mt: 0.5,
                      display: "block",
                    }}
                  >
                    {formatTimestamp(message.timestamp)}
                  </Typography>
                </ListItem>
              ))}
              <div ref={messagesEndRef} style={{ height: "1px" }} />
            </List>
          )}
        </Box>

        {/* 输入区域 */}
        <Box
          sx={{
            p: 2,
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: "background.paper",
          }}
        >
          <Box sx={{ display: "flex", gap: 1 }}>
            <TextField
              ref={inputRef}
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
              maxRows={3}
              fullWidth
              size="small"
              disabled={isLoading}
              variant="outlined"
            />
            <IconButton
              onClick={isLoading ? handleStopRequest : handleSendMessage}
              disabled={!isLoading && !inputValue.trim()}
              color={isLoading ? "error" : "primary"}
              sx={{ alignSelf: "flex-end" }}
            >
              {isLoading ? <StopIcon /> : <SendIcon />}
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
    </Slide>
  );
};

export default AIAssistant;
