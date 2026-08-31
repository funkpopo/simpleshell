import React, { useCallback, useEffect, useState } from "react";
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
import AccessibleDialog from "./AccessibleDialog.jsx";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import EditIcon from "@mui/icons-material/EditOutlined";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import StopIcon from "@mui/icons-material/Stop";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import SidebarPanel from "./SidebarPanel.jsx";

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

/**
 * 端口转发（SSH隧道）管理侧边栏
 * 支持 L/R/D 三类转发规则的图形化管理和状态指示
 */
const PortForwardingDialog = ({ open, onClose, sessionContext = null }) => {
  const { t } = useTranslation();

  const [rules, setRules] = useState([]);
  const [runtimeStatus, setRuntimeStatus] = useState({});
  const [sessions, setSessions] = useState([]);
  const [selectedTabId, setSelectedTabId] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionError, setActionError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyRuleId, setBusyRuleId] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesResult, sessionsResult] = await Promise.all([
        window.terminalAPI.getPortForwardRules(),
        window.terminalAPI.getPortForwardActiveSessions(),
      ]);
      setRules(rulesResult?.rules || []);
      setRuntimeStatus(rulesResult?.runtimeStatus || {});
      setSessions(sessionsResult || []);
      setSelectedTabId((prev) => {
        if (prev && (sessionsResult || []).some((s) => s.tabId === prev)) {
          return prev;
        }
        return (sessionsResult || [])[0]?.tabId || "";
      });
      setActionError("");
    } catch (error) {
      setActionError(error?.message || t("portForwarding.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();

    const unsubscribe =
      window.terminalAPI.onPortForwardStatusUpdated?.((payload) => {
        if (!payload) return;
        setRules(payload.rules || []);
        setRuntimeStatus(payload.runtimeStatus || {});
      }) || null;

    return () => {
      if (typeof unsubscribe === "function") unsubscribe();
    };
  }, [open, refresh]);

  const handleOpenCreate = () => {
    setForm({ ...EMPTY_FORM });
    setFormError("");
    setFormOpen(true);
  };

  const handleOpenEdit = (rule) => {
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
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveRule = async () => {
    setSaving(true);
    setFormError("");
    try {
      await window.terminalAPI.savePortForwardRule({
        id: form.id || undefined,
        name: form.name,
        type: form.type,
        listenHost: form.listenHost,
        listenPort: Number(form.listenPort),
        remoteHost: form.remoteHost,
        remotePort: Number(form.remotePort),
        autoStart: form.autoStart,
      });
      setFormOpen(false);
      await refresh();
    } catch (error) {
      setFormError(error?.message || t("portForwarding.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRule = async (rule) => {
    setBusyRuleId(rule.id);
    try {
      await window.terminalAPI.deletePortForwardRule(rule.id);
      await refresh();
    } catch (error) {
      setActionError(error?.message || t("portForwarding.deleteFailed"));
    } finally {
      setBusyRuleId(null);
    }
  };

  const handleToggleRule = async (rule) => {
    if (!selectedTabId) {
      setActionError(t("portForwarding.selectSessionFirst"));
      return;
    }
    const running = !!runtimeStatus[rule.id];
    setBusyRuleId(rule.id);
    setActionError("");
    try {
      if (running) {
        await window.terminalAPI.stopPortForwardRule(rule.id);
      } else {
        await window.terminalAPI.startPortForwardRule(rule.id, selectedTabId);
      }
      await refresh();
    } catch (error) {
      setActionError(error?.message || t("portForwarding.toggleFailed"));
    } finally {
      setBusyRuleId(null);
    }
  };

  const renderStatusChip = (rule) => {
    const runtime = runtimeStatus[rule.id];
    if (!runtime) {
      return (
        <Chip
          size="small"
          variant="outlined"
          label={t("portForwarding.status.stopped")}
          sx={{ height: 20, fontSize: "0.7rem" }}
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
          sx={{ height: 20, fontSize: "0.7rem" }}
        />
      </Tooltip>
    );
  };

  return (
    <SidebarPanel
      open={open}
      title={t("portForwarding.title")}
      onClose={onClose}
      sessionContext={sessionContext}
      actions={
        <Tooltip title={t("portForwarding.addRule")}>
          <IconButton
            size="small"
            onClick={handleOpenCreate}
            aria-label={t("portForwarding.addRule")}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    >
      <Box
        sx={{
          flex: 1,
          overflowY: "auto",
          px: 1.5,
          pb: 1.5,
          display: "flex",
          flexDirection: "column",
          gap: 1,
        }}
      >
        {/* 会话选择：用于启动转发 */}
        <FormControl size="small" fullWidth disabled={sessions.length === 0}>
          <InputLabel id="pf-session-select-label">
            {t("portForwarding.session")}
          </InputLabel>
          <Select
            labelId="pf-session-select-label"
            value={selectedTabId}
            label={t("portForwarding.session")}
            onChange={(event) => setSelectedTabId(event.target.value)}
          >
            {sessions.map((session) => (
              <MenuItem key={session.tabId} value={session.tabId}>
                {`${session.label}:${session.port}`}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {actionError ? (
          <Typography variant="caption" color="error" sx={{ px: 0.5 }}>
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
            const running = !!runtimeStatus[rule.id];
            return (
              <Box
                key={rule.id}
                sx={{
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
                    alignItems: "center",
                    gap: 0.5,
                  }}
                >
                  <Typography
                    variant="body2"
                    sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}
                    noWrap
                    title={rule.name || buildRuleSummary(rule)}
                  >
                    {rule.name || buildRuleSummary(rule)}
                  </Typography>
                  {renderStatusChip(rule)}
                </Box>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontFamily: "monospace" }}
                  noWrap
                >
                  {buildRuleSummary(rule)}
                </Typography>
                {runtimeStatus[rule.id]?.error ? (
                  <Typography variant="caption" color="error" noWrap>
                    {runtimeStatus[rule.id].error}
                  </Typography>
                ) : null}
                <Stack direction="row" spacing={0.5} alignItems="center">
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
                        disabled={busyRuleId === rule.id || (!running && !selectedTabId)}
                        onClick={() => handleToggleRule(rule)}
                        aria-label={
                          running
                            ? t("portForwarding.stop")
                            : t("portForwarding.start")
                        }
                      >
                        {busyRuleId === rule.id ? (
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
                      disabled={busyRuleId === rule.id}
                      onClick={() => handleDeleteRule(rule)}
                      aria-label={t("portForwarding.delete")}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Box sx={{ flex: 1 }} />
                  <Tooltip title={t("common.refresh")}>
                    <IconButton
                      size="small"
                      onClick={() => void refresh()}
                      aria-label={t("common.refresh")}
                    >
                      <RefreshIcon fontSize="small" />
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
            sx={{ textAlign: "center" }}
          >
            {t("portForwarding.noActiveSessions")}
          </Typography>
        ) : null}
      </Box>

      {/* 新增/编辑规则对话框 */}
      <AccessibleDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle>
          {form.id
            ? t("portForwarding.editRule")
            : t("portForwarding.addRule")}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
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
                sx={{ flex: 1 }}
              />
              <TextField
                size="small"
                label={t("portForwarding.listenPort")}
                value={form.listenPort}
                onChange={handleFormChange("listenPort")}
                type="number"
                sx={{ flex: 1 }}
              />
            </Box>
            {form.type !== "dynamic" ? (
              <Box sx={{ display: "flex", gap: 1 }}>
                <TextField
                  size="small"
                  label={t("portForwarding.targetHost")}
                  value={form.remoteHost}
                  onChange={handleFormChange("remoteHost")}
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  label={t("portForwarding.targetPort")}
                  value={form.remotePort}
                  onChange={handleFormChange("remotePort")}
                  type="number"
                  sx={{ flex: 1 }}
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
              <Typography variant="caption" color="error">
                {formError}
              </Typography>
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)}>
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
