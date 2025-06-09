import React, { useState, useEffect, useRef } from "react";
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
  Fade,
} from "@mui/material";
import SendIcon from "@mui/icons-material/Send";
import SettingsIcon from "@mui/icons-material/Settings";
import ClearIcon from "@mui/icons-material/Clear";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MinimizeIcon from "@mui/icons-material/Minimize";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import AISettings from "./AISettings.jsx";

const AIChatWindow = ({ open, onClose, onMinimize }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messagesEndRef = useRef(null);

  // 滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 监听流式响应
  useEffect(() => {
    if (!window.terminalAPI?.on) return;

    const handleStreamChunk = (data) => {
      if (data.tabId === "ai" && data.chunk) {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.role === "assistant" && lastMessage.streaming) {
            lastMessage.content += data.chunk;
          } else {
            newMessages.push({
              role: "assistant",
              content: data.chunk,
              timestamp: Date.now(),
              streaming: true,
            });
          }
          return newMessages;
        });
      }
    };

    const handleStreamEnd = (data) => {
      if (data.tabId === "ai") {
        setMessages(prev => {
          const newMessages = [...prev];
          const lastMessage = newMessages[newMessages.length - 1];
          if (lastMessage && lastMessage.role === "assistant" && lastMessage.streaming) {
            lastMessage.streaming = false;
          }
          return newMessages;
        });
        setIsLoading(false);
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
  }, [t]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = {
      role: "user",
      content: inputValue.trim(),
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);
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
          const assistantMessage = {
            role: "assistant",
            content: result.choices[0].message.content,
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

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearMessages = () => {
    setMessages([]);
    setError("");
  };

  const handleCopyMessage = async (content) => {
    try {
      await navigator.clipboard.writeText(content);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  if (!open) return null;

  return (
    <Fade in={open}>
      <Paper
        elevation={8}
        sx={{
          position: "fixed",
          bottom: 20,
          right: 20,
          width: 350,
          height: 450,
          display: "flex",
          flexDirection: "column",
          borderRadius: 2,
          zIndex: 1300,
          overflow: "hidden",
          backdropFilter: "blur(10px)",
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        {/* 标题栏 */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            p: 1.5,
            bgcolor: "primary.main",
            color: "primary.contrastText",
          }}
        >
          <Typography variant="subtitle2" fontWeight="medium">
            {t("aiAssistant.title")}
          </Typography>
          <Box>
            <Tooltip title={t("aiAssistant.clear")}>
              <IconButton onClick={handleClearMessages} size="small" sx={{ color: "inherit" }}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("aiAssistant.settings")}>
              <IconButton onClick={() => setSettingsOpen(true)} size="small" sx={{ color: "inherit" }}>
                <SettingsIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("aiAssistant.minimize")}>
              <IconButton onClick={onMinimize} size="small" sx={{ color: "inherit" }}>
                <MinimizeIcon fontSize="small" />
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
            <Alert severity="error" size="small" onClose={() => setError("")}>
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
            <List sx={{ p: 0 }}>
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
                    <Typography variant="body2" sx={{ flex: 1, whiteSpace: "pre-wrap", fontSize: "0.8rem" }}>
                      {message.content}
                      {message.streaming && (
                        <CircularProgress size={10} sx={{ ml: 1 }} />
                      )}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => handleCopyMessage(message.content)}
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
                </ListItem>
              ))}
              <div ref={messagesEndRef} />
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
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
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
              onClick={handleSendMessage}
              disabled={!inputValue.trim() || isLoading}
              color="primary"
              size="small"
              sx={{ alignSelf: "flex-end" }}
            >
              {isLoading ? <CircularProgress size={16} /> : <SendIcon fontSize="small" />}
            </IconButton>
          </Box>
        </Box>

        {/* AI设置对话框 */}
        <AISettings
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </Paper>
    </Fade>
  );
};

export default AIChatWindow;
