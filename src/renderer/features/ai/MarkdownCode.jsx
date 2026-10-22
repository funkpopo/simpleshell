import React from "react";
import { Box } from "@mui/material";
import CopyCommandButton from "./CopyCommandButton.jsx";
import { aiClassName } from "./lib/aiClassName.js";

export function MarkdownCodeBlock({ children }) {
  const codeElement = React.Children.toArray(children).find(
    React.isValidElement,
  );
  // Markdown adds a final newline to fenced/indented blocks. Copy only the code.
  const content = String(codeElement?.props.children ?? "").replace(/\n$/, "");
  const className = codeElement?.props.className;
  const language = className?.match(/language-(\S+)/)?.[1];

  return (
    <Box className={aiClassName("ai-code-block")}>
      <Box className={aiClassName("ai-code-toolbar")}>
        <span>{language}</span>
        <CopyCommandButton content={content} code />
      </Box>
      <pre>
        <code className={className}>{content}</code>
      </pre>
    </Box>
  );
}

export function MarkdownInlineCode({ children }) {
  return (
    <Box component="span" className={aiClassName("ai-inline-code")}>
      <code>{children}</code>
      <CopyCommandButton content={String(children)} />
    </Box>
  );
}

export function MarkdownTable({ children }) {
  return (
    <Box className={aiClassName("ai-markdown-table")}>
      <table>{children}</table>
    </Box>
  );
}
