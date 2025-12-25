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

// Token估算函数
const estimateTokens = (text) => {
  if (!text) return 0;
  // 中文字符计数
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  // 非中文字符计数
  const otherChars = text.length - chineseChars;
  // 中文约1.5 token/字符，英文约0.25 token/字符
  return Math.ceil(chineseChars * 1.5 + otherChars * 0.25);
};

// Token使用扇形图组件
const TokenUsageChart = ({ used, max, onCompressClick, isCompressing }) => {
  const percentage = Math.min((used / max) * 100, 100);
  const angle = (percentage / 100) * 360;
  const radius = 12;
  const cx = 14;
  const cy = 14;
  const isWarning = percentage >= 80;

  // 计算扇形路径
  const getArcPath = (startAngle, endAngle) => {
    const start = {
      x: cx + radius * Math.cos((startAngle - 90) * Math.PI / 180),
      y: cy + radius * Math.sin((startAngle - 90) * Math.PI / 180),
    };
    const end = {
      x: cx + radius * Math.cos((endAngle - 90) * Math.PI / 180),
      y: cy + radius * Math.sin((endAngle - 90) * Math.PI / 180),
    };
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
  };

  const color = percentage > 90 ? '#f44336' : percentage > 70 ? '#ff9800' : '#4caf50';

  const tooltipContent = isWarning
    ? `${used.toLocaleString()} / ${max.toLocaleString()} tokens\n上下文容量警告：点击生成记忆摘要`
    : `${used.toLocaleString()} / ${max.toLocaleString()} tokens`;

  const handleClick = () => {
    if (isWarning && onCompressClick && !isCompressing) {
      onCompressClick();
    }
  };

  if (isCompressing) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
          记忆生成中...
        </Typography>
        <CircularProgress size={16} thickness={4} />
      </Box>
    );
  }

  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltipContent}</span>} placement="left" arrow>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: isWarning ? 'pointer' : 'default',
          '&:hover': isWarning ? { opacity: 0.8 } : {},
        }}
        onClick={handleClick}
      >
        <svg width="28" height="28" viewBox="0 0 28 28">
          <circle cx={cx} cy={cy} r={radius} fill="rgba(128,128,128,0.2)" />
          {angle > 0 && (
            <path d={getArcPath(0, Math.min(angle, 359.9))} fill={color} />
          )}
        </svg>
        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
          {percentage.toFixed(0)}%
        </Typography>
      </Box>
    </Tooltip>
  );
};

// 自定义浮动窗口对话框（支持动态宽度和z-index）
const FloatingDialog = styled(Dialog)(({ theme, customwidth, customzindex }) => ({
  pointerEvents: "none",
  zIndex: customzindex || 1300,
  "& .MuiDialog-container": {
    pointerEvents: "none",
  },
  "& .MuiDialog-paper": {
    pointerEvents: "auto",
    position: "fixed",
    right: 50,
    bottom: 20,
    margin: 0,
    width: customwidth || 400,
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
    overflow: "visible",
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

// 默认和限制宽度
const DEFAULT_WIDTH = 400;
const MIN_WIDTH = 300;
const MAX_WIDTH = 800;

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
  const [windowWidth, setWindowWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [prevWindowState, setPrevWindowState] = useState(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressedMessageCount, setCompressedMessageCount] = useState(0);
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
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: instant ? "instant" : "smooth" });
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

  // 拖拽调整宽度的处理
  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = windowWidth;

    const handleMouseMove = (moveEvent) => {
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth + deltaX));
      setWindowWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [windowWidth]);

  // 加载API配置
  const loadApiSettings = async () => {
    try {
      if (window.terminalAPI?.loadAISettings) {
        const settings = await window.terminalAPI.loadAISettings();
        setAvailableApis(settings.configs || []);
        if (settings.current) {
          // 从configs中获取最新的配置（确保maxTokens等设置是最新的）
          const latestConfig = settings.configs?.find(c => c.id === settings.current.id) || settings.current;
          setCurrentApi(latestConfig);
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
      // 加载记忆文件
      const memory = await window.terminalAPI.loadMemory();

      // 生成系统提示词
      let systemPrompt = generateSystemPrompt({
        language: i18n.language,
        connectionInfo: connectionInfo,
      });

      // 如果有记忆，注入到系统提示词开头
      if (memory) {
        const memoryContext = `[历史对话记忆 - ${memory.timestamp}]
摘要：${memory.summary}
关键点：${memory.keyPoints?.join('、') || '无'}
${memory.pendingTasks?.length ? `待处理：${memory.pendingTasks.join('、')}` : ''}

`;
        systemPrompt = memoryContext + systemPrompt;
      }

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
  const handleClearChat = async () => {
    setMessages([]);
    setError("");
    setCompressedMessageCount(0);
    // 删除记忆文件
    if (window.terminalAPI?.deleteMemory) {
      await window.terminalAPI.deleteMemory();
    }
  };

  // 生成记忆摘要
  const generateMemory = async (msgs, api) => {
    const conversationText = msgs
      .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
      .join('\n\n');

    const prompt = `请对以下对话历史进行摘要，提取关键信息：
1. 用户的主要意图和需求
2. 已完成的操作和结果
3. 重要的上下文信息（如文件路径、配置等）
4. 未完成的任务或待处理事项

请以JSON格式返回（不要包含markdown代码块标记）：
{
  "summary": "对话摘要",
  "keyPoints": ["关键点1", "关键点2"],
  "pendingTasks": ["待处理任务"],
  "context": { "重要上下文键值对" }
}

对话历史：
${conversationText}`;

    const response = await window.terminalAPI.sendAPIRequest({
      url: api.apiUrl,
      apiKey: api.apiKey,
      model: api.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
    }, false);

    if (response.error) {
      throw new Error(response.error);
    }

    // 从API响应中提取内容
    const responseContent = response.content ||
      (response.choices && response.choices[0]?.message?.content);

    if (!responseContent) {
      throw new Error('API返回内容为空');
    }

    // 尝试解析JSON，处理可能的markdown代码块
    let content = responseContent.trim();
    if (content.startsWith('```json')) {
      content = content.slice(7);
    } else if (content.startsWith('```')) {
      content = content.slice(3);
    }
    if (content.endsWith('```')) {
      content = content.slice(0, -3);
    }
    return JSON.parse(content.trim());
  };

  // 处理记忆压缩
  const handleCompressMemory = async () => {
    if (messages.length === 0 || !currentApi || isCompressing) return;

    setIsCompressing(true);
    try {
      const memory = await generateMemory(messages, currentApi);
      await window.terminalAPI.saveMemory({
        ...memory,
        timestamp: new Date().toISOString(),
        messageCount: messages.length,
      });
      // 记录已压缩的消息数量，用于重置token计数
      setCompressedMessageCount(messages.length);
    } catch (err) {
      setError(t('ai.compressFailed') + ': ' + err.message);
    } finally {
      setIsCompressing(false);
    }
  };

  // 处理关闭窗口（清空对话内容并删除记忆文件）
  const handleClose = async () => {
    setMessages([]);
    setInput("");
    setError("");
    setExpandedThinking({});
    setCompressedMessageCount(0);
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
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      disableEscapeKeyDown={isPending || abortController}
      customwidth={windowWidth}
      customzindex={zIndex}
      ref={dialogRef}
      onMouseDown={onFocus}
    >
      {/* 左侧拖动调整宽度手柄 */}
      <Box
        onMouseDown={handleResizeStart}
        sx={{
          position: "absolute",
          left: -4,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: "ew-resize",
          zIndex: 1,
          "&:hover": {
            backgroundColor: "primary.main",
            opacity: 0.3,
          },
          ...(isResizing && {
            backgroundColor: "primary.main",
            opacity: 0.5,
          }),
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
            <IconButton
              size="medium"
              onClick={onMinimize}
              sx={{ p: 0.5 }}
            >
              <AIIcon />
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
            <MessageBubble
              key={message.id}
              isUser={message.role === "user"}
              ref={(el) => {
                if (el) messageRefsMap.current[message.id] = el;
              }}
            >
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
            {messages.map((message, index) => (
              <Box
                key={message.id}
                onClick={() => scrollToMessage(message.id)}
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  cursor: "pointer",
                  backgroundColor: message.role === "user"
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

        {/* 显示思考内容开关和Token使用情况 */}
        <Box sx={{ mt: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
          {currentApi?.maxTokens && (
            <TokenUsageChart
              used={messages.slice(compressedMessageCount).reduce((sum, m) => sum + estimateTokens(m.content), 0) + estimateTokens(input)}
              max={currentApi.maxTokens}
              onCompressClick={handleCompressMemory}
              isCompressing={isCompressing}
            />
          )}
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
