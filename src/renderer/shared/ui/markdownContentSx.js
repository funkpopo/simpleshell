/**
 * Markdown 渲染内容排版 sx（AboutDialog 更新日志 / AIChatWindow 消息共用）。
 *
 * 单一事实来源：此前 AboutDialog.releaseNoteSx（sx + theme.palette）与
 * AIChatWindow.css 的 .ai-message-content 系列（CSS + --ai-* 变量）双份维护，
 * 迁移至此统一由 theme.palette 驱动。
 *
 * 约定：
 * - 字号一律用 em（容器负责定基准字号），聊天气泡缩放场景不受影响；
 * - 容器属性（maxHeight/border/padding/overflow）留在调用方，不在此层；
 * - density: "comfortable"（AI 消息，13px 基准）| "compact"（About 更新日志，0.75rem 基准）
 *
 * 迁移后 AIChatWindow.css 仅保留：is-user 气泡反色覆盖（依赖气泡上下文）、
 * pre 滚动条定制。两者特异性均高于本层，不会被覆盖。
 */

const MONO_FONT_STACK =
  '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace';

const compactCodeBg = (theme) =>
  theme.palette.mode === "dark"
    ? "rgba(255, 255, 255, 0.08)"
    : "rgba(17, 24, 39, 0.08)";

const compactPreBg = (theme) =>
  theme.palette.mode === "dark"
    ? "rgba(0, 0, 0, 0.28)"
    : "rgba(17, 24, 39, 0.06)";

const compactBlockquoteBg = (theme) =>
  theme.palette.mode === "dark"
    ? "rgba(255, 255, 255, 0.04)"
    : "rgba(25, 118, 210, 0.06)";

const compactThBg = (theme) =>
  theme.palette.mode === "dark"
    ? "rgba(255, 255, 255, 0.04)"
    : "rgba(17, 24, 39, 0.05)";

export const getMarkdownContentSx = ({ density = "comfortable" } = {}) => {
  const compact = density === "compact";

  return {
    // 基准字号：em 排版下的容器基准（About 0.75rem / AI 13px，与原实现一致）
    fontSize: compact ? "0.75rem" : "13px",
    lineHeight: compact ? 1.6 : 1.55,
    ...(compact ? {} : { letterSpacing: "-0.005em", color: "text.primary" }),

    "& > :first-of-type": { mt: 0 },
    "& > :last-child": { mb: 0 },

    /* ---- Headings ---- */
    "& h1, & h2, & h3, & h4, & h5, & h6": compact
      ? { mt: 0, mb: 1, fontWeight: 700, lineHeight: 1.35 }
      : {
          margin: "0.75em 0 0.35em",
          fontWeight: 600,
          letterSpacing: "-0.015em",
          lineHeight: 1.3,
          color: "text.primary",
        },
    "& h1": { fontSize: compact ? "1.333em" : "1.231em" },
    "& h2": { fontSize: compact ? "1.267em" : "1.154em" },
    "& h3": { fontSize: compact ? "1.167em" : "1.077em" },
    "& h4, & h5, & h6": { fontSize: compact ? "1.167em" : "1em" },

    /* ---- Paragraphs / lists ---- */
    "& p": compact ? { my: 0, mb: 1 } : { my: "0.45em" },
    "& ul, & ol": compact
      ? { mt: 0, mb: 1, pl: 2.5 }
      : { my: "0.45em", pl: "1.35em" },
    ...(compact ? { "& li + li": { mt: 0.5 } } : { "& li": { my: "0.2em" } }),

    /* ---- Blockquote ---- */
    "& blockquote": compact
      ? {
          m: 0,
          mb: 1,
          py: 0.75,
          px: 1.25,
          borderLeft: "3px solid",
          borderColor: "primary.main",
          bgcolor: compactBlockquoteBg,
          color: "text.secondary",
        }
      : {
          margin: "0.55em 0",
          padding: "0.35em 0.8em",
          borderLeft: "2px solid",
          // --color-border 是全局语义变量（theme-variables.css :root）
          borderColor: "var(--color-border)",
          backgroundColor: "background.paper",
          borderRadius: "0 var(--radius-sm) var(--radius-sm) 0",
          fontStyle: "italic",
          color: "text.secondary",
        },

    "& hr": {
      border: 0,
      borderTop: "1px solid",
      borderColor: "divider",
      my: 1.25,
    },

    /* ---- Inline code（hljs 代码块内的 code 除外） ---- */
    "& code:not(.hljs)": {
      fontFamily: MONO_FONT_STACK,
      fontSize: compact ? "0.85em" : "0.88em",
      px: compact ? 0.5 : "0.35em",
      py: compact ? 0.125 : "0.12em",
      borderRadius: compact ? 0.75 : "var(--radius-sm)",
      bgcolor: compact ? compactCodeBg : "background.default",
      ...(compact ? {} : { color: "text.primary" }),
    },

    /* ---- Code blocks ---- */
    "& pre": {
      mt: compact ? 0 : "0.55em",
      mb: compact ? 1 : "0.55em",
      p: compact ? 1 : "10px 12px",
      overflowX: "auto",
      borderRadius: compact ? 1 : "var(--radius-md)",
      border: "1px solid",
      borderColor: "divider",
      bgcolor: compact ? compactPreBg : "background.paper",
      maxWidth: "100%",
    },
    "& pre code": {
      display: "block",
      p: 0,
      bgcolor: "transparent",
      fontSize: compact ? "1em" : "0.84em",
      ...(compact
        ? {}
        : {
            lineHeight: 1.45,
            color: "inherit",
            whiteSpace: "pre",
            wordWrap: "normal",
            overflowX: "auto",
          }),
    },
    /* hljs 高亮块背景交给高亮主题（原 .ai-message-content .hljs 规则迁入） */
    "& .hljs, & pre .hljs": {
      background: "transparent",
    },

    /* ---- Tables ---- */
    "& table": {
      width: "100%",
      mb: compact ? 1 : "0.55em",
      mt: compact ? 0 : "0.55em",
      borderCollapse: "collapse",
      ...(compact
        ? {}
        : {
            borderRadius: "var(--radius-sm)",
            border: "1px solid",
            borderColor: "divider",
          }),
    },
    "& th, & td": {
      border: "1px solid",
      borderColor: "divider",
      p: compact ? 0.75 : "0.4em 0.55em",
      textAlign: "left",
      verticalAlign: "top",
      ...(compact
        ? {}
        : { whiteSpace: "normal", wordWrap: "break-word", fontSize: "12px" }),
    },
    "& th": {
      fontWeight: 600,
      bgcolor: compact ? compactThBg : "background.default",
    },

    /* ---- Links（compact 保持 MUI 默认，避免改变 About 视觉） ---- */
    ...(compact
      ? {}
      : {
          "& a": {
            color: "primary.main",
            textDecoration: "none",
            textUnderlineOffset: "2px",
          },
          "& a:hover": {
            textDecoration: "underline",
          },
        }),

    /* ---- Task list checkboxes ---- */
    "& input[type='checkbox']": {
      pointerEvents: "none",
      mr: 0.75,
    },
  };
};

export default getMarkdownContentSx;
