import React from "react";
import {
  IconButton,
  TextField,
  Box,
  Tooltip,
  FormControlLabel,
  Switch,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";
import { useTranslation } from "react-i18next";
import { aiClassName } from "../lib/aiClassName.js";
import { isApiConfigReady } from "../lib/aiKeyUtils.js";

// 底部输入区：多行输入（Enter 发送 / Shift+Enter 换行）、思考显示开关、
// 发送 / 停止按钮。
export default function ChatComposer({
  input,
  setInput,
  inputRef,
  isPending,
  abortController,
  currentApi,
  showThinking,
  setShowThinking,
  onSend,
  onAbort,
}) {
  const { t } = useTranslation();

  return (
    <Box className={aiClassName("ai-chat-footer")}>
      <Box
        className={aiClassName("ai-chat-composer")}
        onClick={() => inputRef.current?.focus()}
      >
        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={t("ai.inputPlaceholder")}
          disabled={isPending || abortController}
          inputRef={inputRef}
          variant="outlined"
          size="small"
          sx={{
            flex: "1 1 0",
            minWidth: 0,
          }}
        />
        <Box className={aiClassName("ai-chat-composer-toolbar")}>
          <Box
            className={aiClassName(
              `ai-chat-options ${
                showThinking ? "is-thinking-enabled" : "is-thinking-disabled"
              }`,
            )}
          >
            <FormControlLabel
              className={aiClassName("ai-thinking-control")}
              control={
                <Switch
                  size="small"
                  className={aiClassName("ai-thinking-switch")}
                  checked={showThinking}
                  onChange={(e) => setShowThinking(e.target.checked)}
                />
              }
              label={t("ai.showThinking")}
            />
          </Box>
          {isPending || abortController ? (
            <Tooltip title={t("ai.stopGenerating")}>
              <IconButton
                size="small"
                onClick={onAbort}
                aria-label={t("ai.stopGenerating")}
                className={aiClassName("ai-chat-send-btn is-stop")}
              >
                <StopIcon />
              </IconButton>
            </Tooltip>
          ) : (
            <Tooltip title={t("ai.sendMessage")}>
              <span>
                <IconButton
                  size="small"
                  color="inherit"
                  onClick={onSend}
                  disabled={!input.trim() || !isApiConfigReady(currentApi)}
                  aria-label={t("ai.sendMessage")}
                  className={aiClassName("ai-chat-send-btn")}
                >
                  <ArrowUpwardIcon />
                </IconButton>
              </span>
            </Tooltip>
          )}
        </Box>
      </Box>
    </Box>
  );
}
