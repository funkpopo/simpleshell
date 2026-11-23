import * as React from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CampaignIcon from "@mui/icons-material/Campaign";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import { useTranslation } from "react-i18next";
import {
  dispatchBroadcastCommand,
  resolveBroadcastTargets,
} from "../../features/terminal/model/syncGroupCommandDispatcher.js";
import { findGroupByTab } from "../../features/terminal/model/syncInputGroups.js";

const MAX_BROADCAST_HISTORY = 50;
const MAX_VISIBLE_HOST_BADGES = 4;

export default function BroadcastCommandBar({
  open,
  onClose,
  activeSessionKey = null,
  tabs = [],
  panes = {},
  splitLayouts = {},
  syncGroups = [],
  terminalInstances = {},
  connectionStatusByTabId = {},
  processRegistry,
}) {
  const { t } = useTranslation();
  const [targetSelection, setTargetSelection] = React.useState("all");
  const [command, setCommand] = React.useState("");
  const [appendNewline, setAppendNewline] = React.useState(true);
  const [history, setHistory] = React.useState([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const inputRef = React.useRef(null);

  const activeGroup = React.useMemo(
    () =>
      activeSessionKey ? findGroupByTab(syncGroups, activeSessionKey) : null,
    [activeSessionKey, syncGroups],
  );

  // Default to active sync group when opening if the current session belongs to one
  React.useEffect(() => {
    if (!open) return undefined;
    if (activeGroup?.groupId) {
      setTargetSelection(`group:${activeGroup.groupId}`);
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const validGroupValues = React.useMemo(
    () => new Set(syncGroups.map((group) => `group:${group.groupId}`)),
    [syncGroups],
  );

  const effectiveTargetSelection =
    targetSelection === "all" || validGroupValues.has(targetSelection)
      ? targetSelection
      : "all";

  // Reset safely to "all" if selected group disappears when tabs close
  React.useEffect(() => {
    if (targetSelection !== effectiveTargetSelection) {
      setTargetSelection(effectiveTargetSelection);
    }
  }, [effectiveTargetSelection, targetSelection]);

  const resolvedMode = effectiveTargetSelection.startsWith("group:")
    ? "group"
    : "all";
  const resolvedGroupId = effectiveTargetSelection.startsWith("group:")
    ? effectiveTargetSelection.slice("group:".length)
    : null;

  const { targets, excludedCount } = React.useMemo(
    () =>
      resolveBroadcastTargets({
        mode: resolvedMode,
        groupId: resolvedGroupId,
        tabs,
        splitLayouts,
        panes,
        syncGroups,
        terminalInstances,
        connectionStatusByTabId,
        ...(processRegistry ? { processRegistry } : {}),
      }),
    [
      resolvedMode,
      resolvedGroupId,
      tabs,
      splitLayouts,
      panes,
      syncGroups,
      terminalInstances,
      connectionStatusByTabId,
      processRegistry,
    ],
  );

  const handleSend = React.useCallback(() => {
    if (targets.length === 0 || !command) {
      return;
    }
    const result = dispatchBroadcastCommand({
      command,
      targetSessionKeys: targets.map((item) => item.sessionKey),
      appendNewline,
      sourceTabId: activeSessionKey,
      groupId: resolvedGroupId,
      ...(processRegistry ? { processRegistry } : {}),
    });
    if (result.sentCount > 0) {
      setHistory((prev) =>
        [command, ...prev.filter((entry) => entry !== command)].slice(
          0,
          MAX_BROADCAST_HISTORY,
        ),
      );
      setHistoryIndex(-1);
      setCommand("");
    }
  }, [
    activeSessionKey,
    appendNewline,
    command,
    processRegistry,
    resolvedGroupId,
    targets,
  ]);

  const handleInputKeyDown = React.useCallback(
    (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        handleSend();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key === "ArrowUp" && history.length > 0) {
        const el = event.target;
        const atTop =
          el?.selectionStart === 0 || !String(command).includes("\n");
        if (atTop) {
          event.preventDefault();
          const nextIdx = Math.min(history.length - 1, historyIndex + 1);
          setHistoryIndex(nextIdx);
          setCommand(history[nextIdx]);
        }
      } else if (event.key === "ArrowDown" && historyIndex >= 0) {
        const el = event.target;
        const atBottom =
          el?.selectionEnd === String(command).length ||
          !String(command).includes("\n");
        if (atBottom) {
          event.preventDefault();
          const nextIdx = historyIndex - 1;
          setHistoryIndex(nextIdx);
          setCommand(nextIdx >= 0 ? history[nextIdx] : "");
        }
      }
    },
    [command, handleSend, history, historyIndex, onClose],
  );

  if (!open) {
    return null;
  }

  const visibleBadges = targets.slice(0, MAX_VISIBLE_HOST_BADGES);
  const overflowCount = Math.max(0, targets.length - MAX_VISIBLE_HOST_BADGES);

  return (
    <Paper
      square
      elevation={0}
      data-testid="broadcast-command-bar"
      sx={{
        borderTop: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        px: 1.5,
        py: 1,
        display: "flex",
        flexDirection: "column",
        gap: 0.75,
        flexShrink: 0,
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <CampaignIcon fontSize="small" color="primary" />
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            {t("broadcastBar.title")}
          </Typography>
        </Box>

        <Select
          size="small"
          value={effectiveTargetSelection}
          onChange={(e) => setTargetSelection(e.target.value)}
          aria-label={t("broadcastBar.targetMode")}
          sx={{
            minWidth: 160,
            "& .MuiSelect-select": { py: 0.35, fontSize: "0.78rem" },
          }}
        >
          <MenuItem value="all">{t("broadcastBar.allConnected")}</MenuItem>
          {syncGroups.map((group) => (
            <MenuItem key={group.groupId} value={`group:${group.groupId}`}>
              {t("broadcastBar.syncGroupOption", {
                groupId: group.groupId,
                count: group.members.length,
              })}
            </MenuItem>
          ))}
        </Select>

        <Chip
          size="small"
          color={targets.length > 0 ? "primary" : "default"}
          variant={targets.length > 0 ? "filled" : "outlined"}
          label={t("broadcastBar.targetSummary", { count: targets.length })}
        />

        {visibleBadges.map((target) => (
          <Chip
            key={target.sessionKey}
            size="small"
            variant="outlined"
            label={target.hostBadge}
            sx={{
              height: 22,
              fontSize: "0.72rem",
              ...(target.groupColor ? { borderColor: target.groupColor } : {}),
            }}
          />
        ))}
        {overflowCount > 0 ? (
          <Chip
            size="small"
            variant="outlined"
            label={`+${overflowCount}`}
            sx={{ height: 22, fontSize: "0.72rem" }}
          />
        ) : null}

        {excludedCount > 0 ? (
          <Typography variant="caption" color="text.secondary">
            {t("broadcastBar.excludedCount", { count: excludedCount })}
          </Typography>
        ) : null}

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title={t("common.close")}>
          <IconButton
            size="small"
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <TextField
          inputRef={inputRef}
          fullWidth
          size="small"
          multiline
          maxRows={3}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleInputKeyDown}
          placeholder={t("broadcastBar.placeholder")}
          slotProps={{
            htmlInput: {
              "aria-label": t("broadcastBar.placeholder"),
              style: { fontFamily: "monospace", fontSize: "0.82rem" },
            },
          }}
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={appendNewline}
              onChange={(e) => setAppendNewline(e.target.checked)}
            />
          }
          label={
            <Typography variant="caption">
              {t("broadcastBar.appendNewline")}
            </Typography>
          }
          sx={{ mr: 0, flexShrink: 0 }}
        />
        <Button
          size="small"
          variant="contained"
          endIcon={<SendIcon fontSize="small" />}
          disabled={targets.length === 0 || command.length === 0}
          onClick={handleSend}
          sx={{ flexShrink: 0 }}
        >
          {t("broadcastBar.send")}
        </Button>
      </Box>
    </Paper>
  );
}

BroadcastCommandBar.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  activeSessionKey: PropTypes.string,
  tabs: PropTypes.array,
  panes: PropTypes.object,
  splitLayouts: PropTypes.object,
  syncGroups: PropTypes.array,
  terminalInstances: PropTypes.object,
  connectionStatusByTabId: PropTypes.object,
  processRegistry: PropTypes.object,
};
