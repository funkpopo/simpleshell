import React from "react";
import { Box, Collapse, Typography } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTranslation } from "react-i18next";
import { aiClassName } from "./lib/aiClassName.js";
import { getMarkdownContentSx } from "../../shared/ui/markdownContentSx.js";

// 与 AIChatWindow 消息正文共用同一排版
const markdownContentSx = getMarkdownContentSx({ density: "comfortable" });

const ThinkSparkIcon = () => (
  <svg
    className={aiClassName("ai-think-spark")}
    width="16"
    height="16"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path
      d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"
      fill="currentColor"
    />
  </svg>
);

// 思考内容组件
export const ThinkContent = ({
  content,
  isExpanded,
  onToggle,
  isStreaming,
}) => {
  const { t } = useTranslation();
  return (
    <Box
      className={aiClassName(
        `ai-think-block${isStreaming ? " is-streaming" : ""}${isExpanded ? " is-expanded" : ""}`,
      )}
    >
      <Box
        className={aiClassName("ai-think-toggle")}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        aria-live="polite"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <span className={aiClassName("ai-think-spark-wrap")} aria-hidden="true">
          <ThinkSparkIcon />
        </span>
        <Typography
          component="span"
          className={aiClassName("ai-think-label")}
          variant="caption"
        >
          {t("ai.thinkingProcess")}
        </Typography>
        {isStreaming && (
          <span className={aiClassName("ai-think-dots")} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        )}
        <ExpandMoreIcon
          className={aiClassName(
            `ai-think-caret${isExpanded ? " is-open" : ""}`,
          )}
          fontSize="small"
        />
      </Box>
      <Collapse in={isExpanded}>
        <Box className={aiClassName("ai-think-trace")}>
          <Typography className={aiClassName("ai-think-body")} variant="body2">
            {content}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  );
};

/** 流式输出包装：稳定正文，只让最新尾部的细线光标保持呼吸。 */
export const StreamContent = ({ isStreaming, children }) => {
  return (
    <Box
      className={aiClassName(
        `ai-stream-wrap ${isStreaming ? "ai-stream-active" : "ai-stream-done"}`,
      )}
    >
      <Box
        className={aiClassName("ai-message-content ai-stream-body")}
        sx={markdownContentSx}
      >
        {children}
      </Box>
    </Box>
  );
};
