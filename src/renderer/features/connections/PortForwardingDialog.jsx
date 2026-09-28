import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import AccessibleDialog from "../../shared/ui/AccessibleDialog.jsx";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import SidebarPanel from "../../shared/ui/SidebarPanel.jsx";

const EMPTY_FORM = {
  id: null,
  name: "",
  type: "local",
  listenHost: "127.0.0.1",
  listenPort: "",
  remoteHost: "127.0.0.1",
  remotePort: "",
  autoStart: false,
};

const buildRuleSummary = (rule) => {
  const typeTag =
    rule.type === "local" ? "L" : rule.type === "remote" ? "R" : "D";
  const listen = `${rule.listenHost || "127.0.0.1"}:${rule.listenPort}`;
  if (rule.type === "dynamic") {
    return `${typeTag} ${listen} (SOCKS5)`;
  }
  return `${typeTag} ${listen} -> ${rule.remoteHost}:${rule.remotePort}`;
};

// IPC failures resolve to structured results; only transport failures reject.
const requireResult = (result, fallback) => {
  if (result?.success === false) {
    throw new Error(result.error || result.message || fallback);
  }
  return result;
};

/**
 * 端口转发（SSH隧道）管理侧边栏
 * 支持 L/R/D 三类转发规则的图形化管理和状态指示
 */
const PortForwardingDialog = ({
  open,
  onClose,
  sessionContext = null,
  activeTabId = null,
  activeSessionConnected = false,
}) => {
  const { t } = useTranslation();

  const [rules, setRules] = useState([]);
  const [runtimeStatus, setRuntimeStatus] = useState({});
  const [sessions, setSessions] = useState([]);
  const [sessionSelection, setSessionSelection] = useState(null);
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [targetHostEdited, setTargetHostEdited] = useState(false);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyRules, setBusyRules] = useState({});
  const refreshVersion = useRef(0);
  const rulesVersion = useRef(0);

  // A manual selection applies to the focused tab; changing focus follows the
  // new SSH tab, while refreshing the list keeps the user's selection.
  const selectedSession =
    sessions.find(
      (session) =>
        sessionSelection?.activeTabId === activeTabId &&
        session.tabId === sessionSelection?.tabId,
    ) ||
    sessions.find((session) => session.tabId === activeTabId) ||
    sessions[0];
  const selectedTabId = selectedSession?.tabId || "";
  // -L connects from the SSH server to the target; -R connects from this
  // computer. Never use the SSH server address as a local listen address.
  const targetHost =
    !form.id && !targetHostEdited
      ? (form.type === "local" && selectedSession?.host) ||
        EMPTY_FORM.remoteHost
      : form.remoteHost;

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const snapshotVersion = rulesVersion.current;
    setLoading(true);
    try {
      const [rulesResult, sessionsResult] = await Promise.all([
        window.terminalAPI.getPortForwardRules(),
        window.terminalAPI.getPortForwardActiveSessions(),
      ]);
      requireResult(rulesResult, t("portForwarding.loadFailed"));
      requireResult(sessionsResult, t("portForwarding.loadFailed"));
      if (
        !Array.isArray(rulesResult?.rules) ||
        !Array.isArray(sessionsResult)
      ) {
        throw new Error(t("portForwarding.loadFailed"));
      }
      if (version !== refreshVersion.current) return;
      if (snapshotVersion === rulesVersion.current) {
        setRules(rulesResult.rules);
        setRuntimeStatus(rulesResult.runtimeStatus || {});
      }
      setSessions(sessionsResult);
      setActionError("");
    } catch (error) {
      if (version === refreshVersion.current)
        setActionError(error?.message || t("portForwarding.loadFailed"));
    } finally {
      if (version === refreshVersion.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();

    const unsubscribe =
      window.terminalAPI.onPortForwardStatusUpdated?.((payload) => {
        if (!Array.isArray(payload?.rules)) return;
        rulesVersion.current++;
        setRules(payload.rules);
        setRuntimeStatus(payload.runtimeStatus || {});
      }) || null;

    return () => {
      refreshVersion.current++;
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [open, refresh, activeTabId, activeSessionConnected]);

  const handleOpenCreate = () => {
    setForm({ ...EMPTY_FORM });
    setTargetHostEdited(false);
    setFormError("");
    setFormOpen(true);
  };

  const handleOpenEdit = (rule) => {
    setTargetHostEdited(true);
    setForm({
      id: rule.id,
      name: rule.name || "",
      type: rule.type,
      listenHost: rule.listenHost || "127.0.0.1",
      listenPort: String(rule.listenPort ?? ""),
      remoteHost: rule.remoteHost || "127.0.0.1",
      remotePort: String(rule.remotePort ?? ""),
      autoStart: rule.autoStart === true,
    });
    setFormError("");
    setFormOpen(true);
  };

  const handleFormChange = (field) => (event) => {
    const value =
      event.target.type === "checkbox"
        ? event.target.checked
        : event.target.value;
    if (field === "remoteHost") setTargetHostEdited(true);
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveRule = async () => {
    setSaving(true);
    setFormError("");
    try {
      const result = await window.terminalAPI.savePortForwardRule({
        id: form.id || undefined,
        name: form.name,
        type: form.type,
        listenHost: form.listenHost,
        listenPort: Number(form.listenPort),
        remoteHost: targetHost,
        remotePort: Number(form.remotePort),
        autoStart: form.autoStart,
      });
      requireResult(result, t("portForwarding.saveFailed"));
      setFormOpen(false);
      await refresh();
    } catch (error) {
      setFormError(error?.message || t("portForwarding.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const clearRuleBusy = (ruleId) => {
    setBusyRules((previous) => {
      const next = { ...previous };
      delete next[ruleId];
      return next;
    });
  };

  const handleDeleteRule = async (rule) => {
    if (busyRules[rule.id]) return;
    setBusyRules((previous) => ({ ...previous, [rule.id]: "delete" }));
    setActionError("");
    try {
      requireResult(
        await window.terminalAPI.deletePortForwardRule(rule.id),
        t("portForwarding.deleteFailed"),
      );
      // Status publication normally removes the row before SSH cleanup ends.
      // Also apply the confirmed result if that event was missed; no extra list
      // or session request is needed, and older refreshes must not restore it.
      rulesVersion.current++;
      setRules((previous) => previous.filter((entry) => entry.id !== rule.id));
      setRuntimeStatus((previous) => {
        const next = { ...previous };
        delete next[rule.id];
        return next;
      });
    } catch (error) {
      setActionError(error?.message || t("portForwarding.deleteFailed"));
    } finally {
      clearRuleBusy(rule.id);
    }
  };

  const handleToggleRule = async (rule) => {
    if (busyRules[rule.id]) return;
    const running = runtimeStatus[rule.id]?.status === "running";
    if (!running && !selectedTabId) {
      setActionError(t("portForwarding.selectSessionFirst"));
      return;
    }
    setBusyRules((previous) => ({ ...previous, [rule.id]: "toggle" }));
    setActionError("");
    try {
      if (running) {
        requireResult(
          await window.terminalAPI.stopPortForwardRule(rule.id),
          t("portForwarding.toggleFailed"),
        );
      } else {
        requireResult(
          await window.terminalAPI.startPortForwardRule(rule.id, selectedTabId),
          t("portForwarding.toggleFailed"),
        );
      }
      await refresh();
    } catch (error) {
      setActionError(error?.message || t("portForwarding.toggleFailed"));
    } finally {
      clearRuleBusy(rule.id);
    }
  };

  const renderStatusChip = (rule) => {
    const runtime = runtimeStatus[rule.id];
    if (!runtime || runtime.status === "stopped") {
      return (
        <Chip
          size="small"
          variant="outlined"
          label={t("portForwarding.status.stopped")}
          sx={{
            minHeight: 22,
            height: "auto",
            flexShrink: 0,
            fontSize: "0.7rem",
          }}
        />
      );
    }
    const running = runtime.status === "running";
    return (
      <Tooltip title={runtime.error || ""}>
        <Chip
          size="small"
          color={running ? "success" : "error"}
          label={
            running
              ? t("portForwarding.status.running")
              : t("portForwarding.status.error")
          }
          sx={{
            minHeight: 22,
            height: "auto",
            flexShrink: 0,
            fontSize: "0.7rem",
          }}
        />
      </Tooltip>
    );
  };

  return (
    <SidebarPanel
      open={open}
      title={t("portForwarding.title")}
      titleSx={{
        whiteSpace: "normal",
        overflowWrap: "anywhere",
        lineHeight: 1.35,
      }}
      onClose={onClose}
      sessionContext={sessionContext}
      actions={
        <>
          <Tooltip title={t("common.refresh")}>
            <IconButton
              size="small"
              onClick={() => void refresh()}
              aria-label={t("common.refresh")}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("portForwarding.addRule")}>
            <IconButton
              size="small"
              onClick={handleOpenCreate}
              aria-label={t("portForwarding.addRule")}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      }
    >
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflowY: "auto",
          p: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {/* 会话选择：用于启动转发 */}
        <FormControl
          size="small"
          fullWidth
          disabled={sessions.length === 0}
          sx={{ flexShrink: 0, minWidth: 0 }}
        >
          <InputLabel id="pf-session-select-label">
            {t("portForwarding.session")}
          </InputLabel>
          <Select
            labelId="pf-session-select-label"
            value={selectedTabId}
            label={t("portForwarding.session")}
            renderValue={(value) => {
              const session = sessions.find((entry) => entry.tabId === value);
              return (
                <Typography
                  component="span"
                  sx={{
                    display: "block",
                    whiteSpace: "normal",
                    overflowWrap: "anywhere",
                    lineHeight: 1.35,
                  }}
                >
                  {session ? `${session.label}:${session.port}` : ""}
                </Typography>
              );
            }}
            onChange={(event) =>
              setSessionSelection({ activeTabId, tabId: event.target.value })
            }
            sx={{
              minWidth: 0,
              "& .MuiSelect-select": {
                whiteSpace: "normal",
                overflowWrap: "anywhere",
                height: "auto",
              },
            }}
          >
            {sessions.map((session) => (
              <MenuItem
                key={session.tabId}
                value={session.tabId}
                sx={{ whiteSpace: "normal", overflowWrap: "anywhere" }}
              >
                {`${session.label}:${session.port}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {actionError ? (
          <Typography
            role="alert"
            variant="caption"
            color="error"
            sx={{ px: 0.5, overflowWrap: "anywhere", flexShrink: 0 }}
          >
            {actionError}
          </Typography>
        ) : null}

        <Divider />

        {loading && rules.length === 0 ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 3 }}>
            <CircularProgress size={22} />
          </Box>
        ) : rules.length === 0 ? (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ textAlign: "center", py: 3 }}
          >
            {t("portForwarding.empty")}
          </Typography>
        ) : (
          rules.map((rule) => {
            const running = runtimeStatus[rule.id]?.status === "running";
            return (
              <Box
                key={rule.id}
                role="group"
                aria-label={rule.name || buildRuleSummary(rule)}
                sx={{
                  minWidth: 0,
                  flexShrink: 0,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                  p: 1,
                  display: "flex",
                  flexDirection: "column",
                  gap: 0.5,
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 0.5,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontWeight: 500,
                      overflowWrap: "anywhere",
                    }}
                    title={rule.name || buildRuleSummary(rule)}
                  >
                    {rule.name || buildRuleSummary(rule)}
                  </Typography>
                  {renderStatusChip(rule)}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: "monospace", overflowWrap: "anywhere" }}
                >
                  {buildRuleSummary(rule)}
                </Typography>
                {runtimeStatus[rule.id]?.error ? (
                  <Typography
                    variant="caption"
                    color="error"
                    sx={{ overflowWrap: "anywhere" }}
                  >
                    {runtimeStatus[rule.id].error}
                  </Typography>
                ) : null}
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: "center" }}
                >
                  <Tooltip
                    title={
                      running
                        ? t("portForwarding.stop")
                        : t("portForwarding.start")
                    }
                  >
                    <span>
                      <IconButton
                        size="small"
                        color={running ? "default" : "primary"}
                        disabled={
                          Boolean(busyRules[rule.id]) ||
                          (!running && !selectedTabId)
                        }
                        onClick={() => handleToggleRule(rule)}
                        aria-label={
                          running
                            ? t("portForwarding.stop")
                            : t("portForwarding.start")
                        }
                      >
                        {busyRules[rule.id] === "toggle" ? (
                          <CircularProgress size={16} />
                        ) : running ? (
                          <StopIcon fontSize="small" />
                        ) : (
                          <PlayArrowIcon fontSize="small" />
                        )}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={t("portForwarding.edit")}>
                    <IconButton
                      size="small"
                      disabled={Boolean(busyRules[rule.id])}
                      onClick={() => handleOpenEdit(rule)}
                      aria-label={t("portForwarding.edit")}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("portForwarding.delete")}>
                    <IconButton
                      size="small"
                      color="error"
                      disabled={Boolean(busyRules[rule.id])}
                      onClick={() => handleDeleteRule(rule)}
                      aria-label={t("portForwarding.delete")}
                    >
                      {busyRules[rule.id] === "delete" ? (
                        <CircularProgress size={16} />
                      ) : (
                        <DeleteIcon fontSize="small" />
                      )}
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            );
          })
        )}

        {sessions.length === 0 ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              textAlign: "center",
              flexShrink: 0,
              overflowWrap: "anywhere",
            }}
          >
            {t("portForwarding.noActiveSessions")}
          </Typography>
        ) : null}
      </Box>

      {/* 新增/编辑规则对话框 */}
      <AccessibleDialog
        open={formOpen}
        onClose={() => {
          if (!saving) setFormOpen(false);
        }}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle>
          {form.id ? t("portForwarding.editRule") : t("portForwarding.addRule")}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <TextField
              size="small"
              label={t("portForwarding.ruleName")}
              value={form.name}
              onChange={handleFormChange("name")}
              placeholder={t("portForwarding.ruleNamePlaceholder")}
              fullWidth
            />
            <FormControl size="small" fullWidth>
              <InputLabel id="pf-type-label">
                {t("portForwarding.type")}
              </InputLabel>
              <Select
                labelId="pf-type-label"
                value={form.type}
                label={t("portForwarding.type")}
                onChange={handleFormChange("type")}
              >
                <MenuItem value="local">
                  {t("portForwarding.typeOptions.local")}
                </MenuItem>
                <MenuItem value="remote">
                  {t("portForwarding.typeOptions.remote")}
                </MenuItem>
                <MenuItem value="dynamic">
                  {t("portForwarding.typeOptions.dynamic")}
                </MenuItem>
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              {form.type === "local"
                ? t("portForwarding.typeHelp.local")
                : form.type === "remote"
                  ? t("portForwarding.typeHelp.remote")
                  : t("portForwarding.typeHelp.dynamic")}
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField
                size="small"
                label={t("portForwarding.listenHost")}
                value={form.listenHost}
                onChange={handleFormChange("listenHost")}
                sx={{ flex: 1, minWidth: 0 }}
              />
              <TextField
                size="small"
                label={t("portForwarding.listenPort")}
                value={form.listenPort}
                onChange={handleFormChange("listenPort")}
                type="number"
                sx={{ flex: 1, minWidth: 0 }}
              />
            </Box>
            {form.type !== "dynamic" ? (
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  size="small"
                  label={t("portForwarding.targetHost")}
                  value={targetHost}
                  onChange={handleFormChange("remoteHost")}
                  sx={{ flex: 1, minWidth: 0 }}
                />
                <TextField
                  size="small"
                  label={t("portForwarding.targetPort")}
                  value={form.remotePort}
                  onChange={handleFormChange("remotePort")}
                  type="number"
                  sx={{ flex: 1, minWidth: 0 }}
                />
              </Box>
            ) : null}
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={form.autoStart}
                  onChange={handleFormChange("autoStart")}
                />
              }
              label={t("portForwarding.autoStart")}
            />
            {formError ? (
              <Typography
                role="alert"
                variant="caption"
                color="error"
                sx={{ overflowWrap: "anywhere" }}
              >
                {formError}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={saving}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleSaveRule}
            variant="contained"
            disabled={saving}
            startIcon={saving ? <CircularProgress size={14} /> : null}
          >
            {t("common.save")}
          </Button>
        </DialogActions>
      </AccessibleDialog>
    </SidebarPanel>
  );
};

export default PortForwardingDialog;
