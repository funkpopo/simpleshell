import React from "react";
import { Box, Typography, Button } from "@mui/material";
import SettingsIcon from "@mui/icons-material/Settings";
import { useTranslation } from "react-i18next";
import { aiClassName } from "../lib/aiClassName.js";
import { isApiConfigReady } from "../lib/aiKeyUtils.js";
import ChatMessageItem from "./ChatMessageItem.jsx";

// 消息滚动区：空状态（未配置 API 时引导打开设置）+ 消息列表 + 底部锚点。
export default function ChatMessageList({
  messages,
  currentApi,
  onOpenSettings,
  messagesContainerRef,
  messagesEndRef,
  messageRefsMap,
  showThinking,
  expandedThinking,
  onToggleThinking,
  requestBusy,
  renderMessageContent,
  markdownComponents,
  markdownUrlTransform,
  onEditMessage,
  onRetryMessage,
}) {
  const { t } = useTranslation();

  return (
    <Box
      ref={messagesContainerRef}
      className={`${aiClassName("ai-chat-messages")} app-scrollbar app-scrollbar-compact`}
    >
      {messages.length === 0 && (
        <Box className={aiClassName("ai-chat-empty")}>
          {!isApiConfigReady(currentApi) ? (
            <>
              <Typography className={aiClassName("ai-chat-empty-title")}>
                {t("ai.noApiConfigured")}
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SettingsIcon />}
                onClick={onOpenSettings}
                className={aiClassName("ai-chat-empty-action")}
              >
                {t("ai.settings")}
              </Button>
            </>
          ) : (
            <>
              <Typography className={aiClassName("ai-chat-empty-title")}>
                {t("ai.startConversation")}
              </Typography>
              <Typography className={aiClassName("ai-chat-empty-hint")}>
                {t("ai.inputPlaceholder")}
              </Typography>
            </>
          )}
        </Box>
      )}
      {messages.map((message) => (
        <ChatMessageItem
          key={message.id}
          message={message}
          showThinking={showThinking}
          isThinkingExpanded={expandedThinking[message.id]}
          onToggleThinking={onToggleThinking}
          requestBusy={requestBusy}
          messageRefsMap={messageRefsMap}
          renderMessageContent={renderMessageContent}
          markdownComponents={markdownComponents}
          markdownUrlTransform={markdownUrlTransform}
          onEditMessage={onEditMessage}
          onRetryMessage={onRetryMessage}
        />
      ))}
      <div ref={messagesEndRef} />
    </Box>
  );
}

// 点状导航 - 消息快速跳转（多于一条消息时显示）
export function ChatMessageDots({ messages, onSelect }) {
  const { t } = useTranslation();

  if (messages.length <= 1) {
    return null;
  }

  return (
    <Box className={aiClassName("ai-chat-dots")}>
      {messages.map((message) => (
        <Box
          key={message.id}
          className={aiClassName(
            `ai-chat-dot ${message.role === "user" ? "is-user" : "is-assistant"}`,
          )}
          onClick={() => onSelect(message.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onSelect(message.id);
            }
          }}
          title={
            message.role === "user"
              ? t("ai.jumpToUserMessage")
              : t("ai.jumpToAssistantMessage")
          }
          aria-label={
            message.role === "user"
              ? t("ai.jumpToUserMessage")
              : t("ai.jumpToAssistantMessage")
          }
          role="button"
          tabIndex={0}
        />
      ))}
    </Box>
  );
}
