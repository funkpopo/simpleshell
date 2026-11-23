import React, { useCallback, useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
import { useNotification } from "../../shared/notifications/NotificationContext";
import { generateId } from "../../../shared/common";
import { dismissTransientQuickConnect } from "../../shared/lib/quickConnectSession.js";

export default function QuickConnectSaveDialog({
  open,
  preset,
  connections = [],
  onClose,
  onConnectionsUpdate,
  onSaved,
}) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [saveName, setSaveName] = useState(
    () => preset?.name || preset?.host || "",
  );
  const [saveGroupId, setSaveGroupId] = useState("");

  useEffect(() => {
    if (open && preset) {
      setSaveName(preset.name || preset.host || "");
      setSaveGroupId("");
    }
  }, [open, preset]);

  const availableGroups = Array.isArray(connections)
    ? connections.filter((item) => item?.type === "group")
    : [];

  const handleConfirmSavePreset = useCallback(
    async (event) => {
      event?.preventDefault?.();
      if (!preset) return;
      const trimmedName = saveName.trim();
      if (!trimmedName) {
        showError(t("connectionManager.nameRequired"));
        return;
      }
      const newConnection = {
        id: generateId("conn"),
        type: "connection",
        name: trimmedName,
        host: preset.host,
        port: preset.port || (preset.protocol === "telnet" ? 23 : 22),
        username: preset.username || "",
        password: "",
        authType: "password",
        privateKeyPath: "",
        agentPath: "",
        agentForward: false,
        enableCompression: false,
        os: "",
        connectionType: "",
        protocol: preset.protocol || "ssh",
        pinned: false,
        tags: [],
        colorTag: "",
        proxy: null,
      };
      const baseList = Array.isArray(connections) ? connections : [];
      const nextConnections = saveGroupId
        ? baseList.map((item) =>
            item.id === saveGroupId && item.type === "group"
              ? { ...item, items: [...(item.items || []), newConnection] }
              : item,
          )
        : [...baseList, newConnection];

      try {
        if (typeof onConnectionsUpdate === "function") {
          onConnectionsUpdate(nextConnections);
        } else if (window.terminalAPI?.saveConnections) {
          await window.terminalAPI.saveConnections(nextConnections);
        }
        dismissTransientQuickConnect(preset);
        onSaved?.(nextConnections);
        showSuccess(t("connectionManager.createSuccess"));
      } catch {
        showError(t("connectionManager.saveFailed"));
      }
    },
    [
      connections,
      onConnectionsUpdate,
      onSaved,
      preset,
      saveGroupId,
      saveName,
      showError,
      showSuccess,
      t,
    ],
  );

  return (
    <Dialog open={Boolean(open)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>
        {t("connections.quickConnect.saveAsConnection")}
      </DialogTitle>
      <Box component="form" onSubmit={handleConfirmSavePreset}>
        <DialogContent
          sx={{ display: "flex", flexDirection: "column", gap: 1.5, pt: 1 }}
        >
          <TextField
            label={t("common.name")}
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            size="small"
            fullWidth
            required
            autoFocus
          />
          {availableGroups.length > 0 && (
            <FormControl size="small" fullWidth>
              <InputLabel>{t("connectionManager.group")}</InputLabel>
              <Select
                value={saveGroupId}
                label={t("connectionManager.group")}
                onChange={(e) => setSaveGroupId(e.target.value)}
              >
                <MenuItem value="">
                  <em>{t("connectionManager.noGroup")}</em>
                </MenuItem>
                {availableGroups.map((group) => (
                  <MenuItem key={group.id} value={group.id}>
                    {group.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" variant="contained">
            {t("common.save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
