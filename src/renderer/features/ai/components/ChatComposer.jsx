import React from "react";
import {
  IconButton,
  TextField,
  Box,
  Tooltip,
  FormControlLabel,
  Switch,
  Chip,
} from "@mui/material";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import StopIcon from "@mui/icons-material/Stop";
import TerminalIcon from "@mui/icons-material/Terminal";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import PlaylistPlayIcon from "@mui/icons-material/PlaylistPlay";
import { useTranslation } from "react-i18next";
import { aiClassName } from "../lib/aiClassName.js";
import { isApiConfigReady } from "../lib/aiKeyUtils.js";

const formatShortCwd = (cwd) => {
  if (typeof cwd !== "string" || !cwd) return "";
  return cwd.length > 26 ? `...${cwd.slice(-23)}` : cwd;
};

// 底部输入区：终端上下文开关/快捷动作、多行输入（Enter 发送 / Shift+Enter 换行）、
// 思考显示开关、发送 / 停止按钮。
export default function ChatComposer({
  input,
  setInput,
  inputRef,
  isPending,
  abortController,
  currentApi,
  showThinking,
  setShowThinking,
  hasSessionContext = false,
  attachTerminalContext = false,
  terminalContext = null,
  onToggleTerminalContext = null,
  onQuickAction = null,
  onSend,
  onAbort,
}) {
  const { t } = useTranslation();
  const requestBusy = Boolean(isPending || abortController);
  const cwd = terminalContext?.cwd || "";
  const lineCount = Number.isFinite(terminalContext?.lineCount)
    ? terminalContext.lineCount
    : 0;

  const contextChipLabel = (() => {
    if (!attachTerminalContext) {
      return t("ai.terminalContext.chipDetached");
    }
    const shortCwd = formatShortCwd(cwd);
    if (shortCwd && lineCount > 0) {
      return t("ai.terminalContext.chipCwdLines", {
        cwd: shortCwd,
        count: lineCount,
      });
    }
    if (shortCwd) {
      return t("ai.terminalContext.chipCwdOnly", { cwd: shortCwd });
    }
    if (lineCount > 0) {
      return t("ai.terminalContext.chipLinesOnly", { count: lineCount });
    }
    return t("ai.terminalContext.chipActive");
  })();

  const contextTooltip = (() => {
    if (!attachTerminalContext) {
      return t("ai.terminalContext.tooltipDisabled");
    }
    const details = [t("ai.terminalContext.tooltipEnabled")];
    if (cwd) {
      details.push(t("ai.terminalContext.tooltipCwd", { cwd }));
    }
    if (terminalContext?.lastCommand) {
      details.push(
        t("ai.terminalContext.tooltipLastCommand", {
          command: terminalContext.lastCommand,
        }),
      );
    }
    if (lineCount > 0) {
      details.push(t("ai.terminalContext.tooltipLines", { count: lineCount }));
    }
    return details.join(" · ");
  })();

  return (
    <Box className={aiClassName("ai-chat-footer")}>
      {hasSessionContext && (
        <Box className={aiClassName("ai-chat-context-bar")}>
          <Tooltip title={contextTooltip}>
            <Chip
              size="small"
              clickable
              icon={<TerminalIcon />}
              label={contextChipLabel}
              onClick={() => onToggleTerminalContext?.()}
              onMouseDown={(event) => event.stopPropagation()}
              aria-pressed={Boolean(attachTerminalContext)}
              className={aiClassName(
                `ai-context-chip ${
                  attachTerminalContext ? "is-attached" : "is-detached"
                }`,
              )}
              data-testid="ai-terminal-context-chip"
            />
          </Tooltip>
          <Tooltip title={t("ai.quickActions.explainOutputTooltip")}>
            <span>
              <Chip
                size="small"
                clickable
                disabled={requestBusy}
                icon={<AutoFixHighIcon />}
                label={t("ai.quickActions.explainOutput")}
                onClick={() => onQuickAction?.("explainOutput")}
                onMouseDown={(event) => event.stopPropagation()}
                className={aiClassName("ai-quick-chip")}
                data-testid="ai-quick-explain-chip"
              />
            </span>
          </Tooltip>
          <Tooltip title={t("ai.quickActions.suggestCommandTooltip")}>
            <span>
              <Chip
                size="small"
                clickable
                disabled={requestBusy}
                icon={<PlaylistPlayIcon />}
                label={t("ai.quickActions.suggestCommand")}
                onClick={() => onQuickAction?.("suggestCommand")}
                onMouseDown={(event) => event.stopPropagation()}
                className={aiClassName("ai-quick-chip")}
                data-testid="ai-quick-suggest-chip"
              />
            </span>
          </Tooltip>
        </Box>
      )}
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
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              e.keyCode !== 229
            ) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder={t("ai.inputPlaceholder")}
          disabled={Boolean(isPending || abortController)}
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
