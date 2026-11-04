import remarkGfm from "remark-gfm";
import { getMarkdownContentSx } from "../../../shared/ui/markdownContentSx.js";

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm];
// Markdown 基础排版共用共享层；浮窗宽度约束和复制控件样式留在 CSS 模块。
export const markdownContentSx = getMarkdownContentSx({
  density: "comfortable",
});
export const MARKDOWN_ALLOWED_ELEMENTS = [
  "p",
  "a",
  "code",
  "pre",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
];
