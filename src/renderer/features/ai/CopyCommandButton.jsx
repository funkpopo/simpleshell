import React, { useEffect, useState } from "react";
import { IconButton, Tooltip } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import { useTranslation } from "react-i18next";
import { aiClassName } from "./lib/aiClassName.js";

export default function CopyCommandButton({ content, onCopy, code = false }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState("idle");

  useEffect(() => {
    setStatus("idle");
  }, [content]);

  useEffect(() => {
    if (status === "idle") return;
    const timeout = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timeout);
  }, [status]);

  const handleCopy = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      await window.clipboardAPI.writeText(content);
      setStatus("copied");
      onCopy?.(content);
    } catch (error) {
      setStatus("error");
      console.error("Failed to copy command:", error);
    }
  };

  return (
    <Tooltip
      title={
        status === "copied"
          ? t("ai.copied")
          : status === "error"
            ? t("ai.copyFailed")
            : code
              ? t("ai.copyCode")
              : t("ai.copyCommand")
      }
    >
      <IconButton
        size="small"
        className={aiClassName("ai-copy-command")}
        onClick={handleCopy}
        color={status === "error" ? "error" : "default"}
        aria-label={
          status === "copied"
            ? t("ai.copied")
            : status === "error"
              ? t("ai.copyFailed")
              : code
                ? t("ai.copyCode")
                : t("ai.copyCommand")
        }
      >
        {status === "copied" ? (
          <CheckIcon fontSize="inherit" />
        ) : (
          <ContentCopyIcon fontSize="inherit" />
        )}
      </IconButton>
    </Tooltip>
  );
}
