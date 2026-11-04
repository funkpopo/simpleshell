import React from "react";
import { IconButton, Box, Paper, Tooltip } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import ReplayIcon from "@mui/icons-material/Replay";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import { aiClassName } from "../lib/aiClassName.js";
import {
  MARKDOWN_ALLOWED_ELEMENTS,
  MARKDOWN_REMARK_PLUGINS,
  markdownContentSx,
} from "../lib/chatMarkdown.js";
import { splitAssistantContent } from "../lib/chatMessageContent.js";
import { StreamContent, ThinkContent } from "../AIMessageParts.jsx";

// 复制消息
const handleCopyMessage = async (content) => {
  try {
    await window.clipboardAPI.writeText(content);
  } catch (err) {
    console.error("Failed to copy:", err);
  }
};

// 单条消息：气泡（助手消息含思考块与命令渲染）+ 编辑/重试/复制操作。
export default function ChatMessageItem({
  message,
  showThinking,
  isThinkingExpanded,
  onToggleThinking,
  requestBusy,
  messageRefsMap,
  renderMessageContent,
  markdownComponents,
  markdownUrlTransform,
  onEditMessage,
  onRetryMessage,
}) {
  const { t } = useTranslation();
  const isUserMessage = message.role === "user";
  const isStreaming = Boolean(message.isStreaming);
  const messageActionsDisabled = Boolean(requestBusy || isStreaming);

  const { thinkParts: assistantThinkParts, textContent: assistantTextContent } =
    message.role === "assistant"
      ? splitAssistantContent(message.content, showThinking)
      : { thinkParts: [], textContent: "" };

  return (
    <Box
      className={aiClassName(
        `ai-message-row ${isUserMessage ? "is-user" : "is-assistant"}`,
      )}
      ref={(el) => {
        if (el) {
          messageRefsMap.current[message.id] = el;
        } else {
          delete messageRefsMap.current[message.id];
        }
      }}
    >
      <Paper
        elevation={0}
        className={aiClassName(
          `ai-message-bubble ${isUserMessage ? "is-user" : "is-assistant"}${isStreaming ? " is-streaming" : ""}`,
        )}
      >
        {message.role === "assistant" ? (
          <>
            {assistantThinkParts.map((part, index) => (
              <ThinkContent
                key={`think-${index}`}
                content={part.content}
                isExpanded={isThinkingExpanded}
                onToggle={() => onToggleThinking(message.id)}
                isStreaming={Boolean(isStreaming && part.open)}
              />
            ))}
            {assistantTextContent.trim() ||
            (isStreaming && assistantThinkParts.length === 0) ? (
              <StreamContent isStreaming={isStreaming}>
                {renderMessageContent(
                  assistantTextContent,
                  isStreaming,
                )}
              </StreamContent>
            ) : null}
          </>
        ) : (
          <Box
            className={aiClassName("ai-message-content")}
            sx={markdownContentSx}
          >
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
      <Box className={aiClassName("ai-message-actions")}>
        {isUserMessage && (
          <>
            <Tooltip title={t("ai.editMessage")}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => onEditMessage(message)}
                  disabled={messageActionsDisabled}
                  className={aiClassName("ai-message-action")}
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
                  onClick={() => onRetryMessage(message)}
                  disabled={messageActionsDisabled}
                  className={aiClassName("ai-message-action")}
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
            className={aiClassName("ai-message-action")}
            aria-label={t("ai.copyMessage")}
          >
            <ContentCopyIcon />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );
}
