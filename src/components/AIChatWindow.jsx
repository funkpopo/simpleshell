import React, { useState, useEffect, useRef, useCallback, memo, useTransition } from "react";
import {
  Dialog,
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
  Avatar,
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
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";
import AIIcon from "./AIIcon";
import AISettings from "./AISettings";
import ExecutableCommand from "./ExecutableCommand";
import { useTranslation } from "react-i18next";
import { styled } from "@mui/material/styles";
import ReactMarkdown from "react-markdown";
import {
  generateSystemPrompt,
  parseCommandsFromResponse,
  RISK_LEVELS,
  setCustomRiskRules,
} from "../utils/aiSystemPrompt";
import "./AIChatWindow.css";
import "./CodeHighlight.css";

// 自定义浮动窗口对话框
const FloatingDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiDialog-paper": {
    position: "fixed",
    right: 50,
    bottom: 20,
    margin: 0,
    width: 400,
    maxWidth: "90vw",
    height: 600,
    maxHeight: "80vh",
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(30, 30, 30, 0.95)"
        : "rgba(255, 255, 255, 0.95)",
    backdropFilter: "blur(10px)",
    borderRadius: 16,
    boxShadow:
      theme.palette.mode === "dark"
        ? "0 10px 40px rgba(0, 0, 0, 0.6)"
        : "0 10px 40px rgba(0, 0, 0, 0.2)",
  },
}));

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
          思考内容
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
  const [commandExecutionStatus, setCommandExecutionStatus] = useState({});
  const streamHandlersRef = useRef({});

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 加载API配置
  const loadApiSettings = async () => {
    try {
      if (window.terminalAPI?.loadAISettings) {
        const settings = await window.terminalAPI.loadAISettings();
        setAvailableApis(settings.configs || []);
        if (settings.current) {
          setCurrentApi(settings.current);
        } else if (settings.configs && settings.configs.length > 0) {
          setCurrentApi(settings.configs[0]);
        }
        // 加载自定义风险规则
        if (settings.customRiskRules) {
          setCustomRiskRules(settings.customRiskRules);
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
      if (inputRef.current) {
        inputRef.current.focus();
      }
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
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // 发送消息
  const handleSendMessage = async () => {
    if (!input.trim() || isPending) return;

    // 在执行任何操作之前验证 API 配置
    if (!currentApi || !currentApi.apiUrl || !currentApi.apiKey || !currentApi.model) {
      setError(t("ai.noApiConfigured"));
      return;
    }

    const userMessage = {
      id: Date.now(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    startTransition(() => {
      setMessages((prev) => [...prev, userMessage]);
    });
    setInput("");
    setError("");

    const controller = new AbortController();
    setAbortController(controller);

    try {
      // 生成系统提示词
      const systemPrompt = generateSystemPrompt({
        language: i18n.language,
        connectionInfo: connectionInfo,
      });

      // 构建消息列表，包含系统提示词
      const apiMessages = [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: userMessage.content },
      ];

      const requestData = {
        url: currentApi.apiUrl,
        apiKey: currentApi.apiKey,
        model: currentApi.model,
        messages: apiMessages,
        temperature: currentApi.temperature || 0.7,
        max_tokens: currentApi.maxTokens || 2000,
        stream: currentApi.streamEnabled !== false,
      };

      if (currentApi.streamEnabled !== false) {
        // 流式响应
        const assistantMessage = {
          id: Date.now() + 1,
          role: "assistant",
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        };
        setMessages((prev) => [...prev, assistantMessage]);

        // 生成会话ID
        const sessionId = `session_${Date.now()}`;
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
            window.terminalAPI.off("stream-chunk", handleStreamChunk);
            window.terminalAPI.off("stream-end", handleStreamEnd);
            delete streamHandlersRef.current[sessionId];
          }
        };

        // 注册监听器
        window.terminalAPI.on("stream-chunk", handleStreamChunk);
        window.terminalAPI.on("stream-end", handleStreamEnd);

        // 保存监听器引用
        streamHandlersRef.current[sessionId] = {
          chunk: handleStreamChunk,
          end: handleStreamEnd,
        };

        // 注册abort事件处理
        requestData.signal = controller.signal;

        const response = await window.terminalAPI.sendAPIRequest(
          requestData,
          true,
        );

        if (response && response.error) {
          // 清理监听器
          window.terminalAPI.off("stream-chunk", handleStreamChunk);
          window.terminalAPI.off("stream-end", handleStreamEnd);
          delete streamHandlersRef.current[sessionId];
          setCurrentSessionId(null);
          throw new Error(response.error);
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
          throw new Error(response.error);
        } else {
          throw new Error(t("ai.unknownError"));
        }
      }
    } catch (err) {
      if (err.name !== "AbortError") {
        setError(err.message || t("ai.requestFailed"));
      }
      // 如果是中断错误，确保消息状态正确
      if (err.name === "AbortError") {
        // 清理所有监听器
        if (currentSessionId && window.terminalAPI) {
          const handlers = streamHandlersRef.current[currentSessionId];
          if (handlers) {
            window.terminalAPI.off("stream-chunk", handlers.chunk);
            window.terminalAPI.off("stream-end", handlers.end);
            delete streamHandlersRef.current[currentSessionId];
          }
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
      if (!currentApi.streamEnabled || currentApi.streamEnabled === false) {
        setAbortController(null);
      }
    }
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
          window.terminalAPI.off("stream-chunk", handlers.chunk);
          window.terminalAPI.off("stream-end", handlers.end);
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
  const handleClearChat = () => {
    setMessages([]);
    setError("");
  };

  // 处理关闭窗口（清空对话内容）
  const handleClose = () => {
    setMessages([]);
    setInput("");
    setError("");
    setExpandedThinking({});
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
  const handleExecuteCommand = useCallback((command) => {
    if (onExecuteCommand && typeof onExecuteCommand === 'function') {
      onExecuteCommand(command);
    } else {
      // 如果没有提供执行回调，尝试使用全局方式
      console.warn('No command execution handler provided');
    }
  }, [onExecuteCommand]);

  // 处理命令复制
  const handleCopyCommand = useCallback((command) => {
    // 可以添加额外的复制成功提示逻辑
  }, []);

  // 渲染消息内容，包含命令块的解析
  const renderMessageContent = useCallback((content, messageId, isStreaming) => {
    // 解析命令块
    const commands = parseCommandsFromResponse(content);

    // 如果没有命令块，直接渲染原始内容
    if (commands.length === 0) {
      // 移除 <cmd> 标签（以防有未正确解析的）
      const cleanContent = content.replace(/<cmd[^>]*>[\s\S]*?<\/cmd>/gi, '');
      return (
        <ReactMarkdown
          components={{
            p: ({ children }) => (
              <Typography variant="body2" sx={{ mb: 1 }}>
                {children}
              </Typography>
            ),
            code: ({ className, children }) => (
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
          }}
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
            type: 'text',
            content: textBefore,
            key: `text-${idx}`,
          });
        }
      }

      // 添加命令块
      parts.push({
        type: 'command',
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
          type: 'text',
          content: textAfter,
          key: 'text-last',
        });
      }
    }

    return (
      <>
        {parts.map((part) => {
          if (part.type === 'text') {
            return (
              <ReactMarkdown
                key={part.key}
                components={{
                  p: ({ children }) => (
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      {children}
                    </Typography>
                  ),
                  code: ({ className, children }) => (
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
                }}
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
  }, [handleExecuteCommand, handleCopyCommand, connectionInfo]);

  // 切换API
  const handleApiChange = (api) => {
    setCurrentApi(api);
    window.terminalAPI.setCurrentApiConfig(api.id);
    setApiMenuAnchor(null);
  };

  return (
    <FloatingDialog
      open={windowState === "visible"}
      onClose={onMinimize}
      hideBackdrop
      disableEscapeKeyDown={isPending || abortController}
    >
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
            <IconButton
              size="small"
              onClick={onMinimize}
              sx={{ p: 0.5 }}
            >
              <AIIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Typography variant="h6">{t("ai.title")}</Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={0.5}>
          {currentApi && (
            <Chip
              label={currentApi.name || currentApi.model}
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
                {api.name} ({api.model})
              </MenuItem>
            ))}
            <Divider />
            <MenuItem onClick={() => setSettingsOpen(true)}>
              <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
              {t("ai.manageApis")}
            </MenuItem>
          </Menu>
          <Tooltip title={t("ai.clearChat")}>
            <IconButton size="small" onClick={handleClearChat}>
              <DeleteIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("ai.settings")}>
            <IconButton size="small" onClick={() => setSettingsOpen(true)}>
              <SettingsIcon />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={handleClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <Divider />
      <DialogContent
        sx={{
          display: "flex",
          flexDirection: "column",
          p: 2,
          overflow: "hidden",
        }}
      >
        {/* 消息列表 */}
        <Box
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
              {!currentApi || !currentApi.apiUrl || !currentApi.apiKey || !currentApi.model ? (
                <>
                  <Typography color="warning.main" variant="body2" textAlign="center">
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
          {messages.map((message) => (
            <MessageBubble key={message.id} isUser={message.role === "user"}>
              <Box display="flex" alignItems="flex-start" gap={1}>
                <Box flex={1}>
                  {message.role === "assistant" ? (
                    showThinking ? (
                      processThinkContent(message.content).map((part, index) => (
                        <Box key={index}>
                          {part.type === "text" ? (
                            renderMessageContent(part.content, message.id, message.isStreaming)
                          ) : (
                            <ThinkContent
                              content={part.content}
                              isExpanded={expandedThinking[message.id]}
                              onToggle={() => toggleThinking(message.id)}
                            />
                          )}
                        </Box>
                      ))
                    ) : (
                      renderMessageContent(
                        message.content.replace(/<think>[\s\S]*?<\/think>/g, ""),
                        message.id,
                        message.isStreaming
                      )
                    )
                  ) : (
                    <ReactMarkdown
                      components={{
                        p: ({ children }) => (
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            {children}
                          </Typography>
                        ),
                        code: ({ className, children }) => (
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
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                  {message.isStreaming && (
                    <CircularProgress size={12} sx={{ ml: 1 }} />
                  )}
                </Box>
                <Tooltip title={t("ai.copyMessage")}>
                  <IconButton
                    size="small"
                    onClick={() => handleCopyMessage(message.content)}
                    sx={{ opacity: 0.7 }}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            </MessageBubble>
          ))}
          <div ref={messagesEndRef} />
        </Box>

        {/* 错误提示 */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
            {error}
          </Alert>
        )}

        {/* 输入区域 */}
        <Box display="flex" gap={1} alignItems="flex-end">
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
          />
          {(isPending || abortController) ? (
            <Fab
              size="small"
              color="error"
              onClick={handleAbortRequest}
              sx={{ flexShrink: 0 }}
            >
              <StopIcon />
            </Fab>
          ) : (
            <Fab
              size="small"
              color="primary"
              onClick={handleSendMessage}
              disabled={!input.trim() || !currentApi || !currentApi.apiUrl || !currentApi.apiKey || !currentApi.model}
              sx={{ flexShrink: 0 }}
            >
              <SendIcon />
            </Fab>
          )}
        </Box>

        {/* 显示思考内容开关 */}
        <Box sx={{ mt: 1 }}>
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
