import React, { useCallback, useMemo } from "react";
import { Typography } from "@mui/material";
import ReactMarkdown from "react-markdown";
import { useTranslation } from "react-i18next";
import ExecutableCommand from "../ExecutableCommand";
import {
  MarkdownCodeBlock,
  MarkdownInlineCode,
  MarkdownTable,
} from "../MarkdownCode.jsx";
import { parseCommandsFromResponse } from "../lib/aiSystemPrompt";
import { normalizeSafeMarkdownHref } from "../../../shared/lib/markdownLinks.js";
import {
  MARKDOWN_ALLOWED_ELEMENTS,
  MARKDOWN_REMARK_PLUGINS,
} from "../lib/chatMarkdown.js";
import { splitContentByCommands } from "../lib/chatMessageContent.js";

// 消息 Markdown 渲染：安全链接、代码块组件映射，以及把 <cmd> 命令块
// 渲染为可执行命令卡片（执行结果失败时通过 setError 反馈）。
export default function useChatMarkdownRenderer({
  windowState,
  commandEnabled,
  onExecuteCommand,
  setError,
}) {
  const { t } = useTranslation();

  // 处理命令执行
  const handleExecuteCommand = useCallback(
    (command) => {
      if (windowState !== "visible" || !commandEnabled) return;
      const result = onExecuteCommand(command);
      if (!result?.success)
        setError(result?.error || t("commandHistory.noActiveSession"));
      return result;
    },
    [onExecuteCommand, commandEnabled, windowState, t],
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
      pre: MarkdownCodeBlock,
      code: MarkdownInlineCode,
      table: MarkdownTable,
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
      const parts = splitContentByCommands(content, commands);

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
                  disabled={
                    isStreaming || !commandEnabled || windowState !== "visible"
                  }
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
      commandEnabled,
      windowState,
      markdownComponents,
      markdownUrlTransform,
    ],
  );

  return { markdownComponents, markdownUrlTransform, renderMessageContent };
}
