import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import { generateId } from "../../../../shared/common";
import { mapHostsToConnections } from "../../../../shared/domain/openssh-config-parser";

const isSshHostImportable = (entry) =>
  Boolean(entry) && !entry.proxyJump && !entry.proxyCommand;

function collectConnectionNames(items, names = new Set()) {
  for (const item of items || []) {
    if (item.type === "connection" && item.name) {
      names.add(String(item.name).toLowerCase());
    } else if (item.type === "group") {
      collectConnectionNames(item.items, names);
    }
  }
  return names;
}

export default function OpenSSHImportDialog({ onClose }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [sshImportLoading, setSshImportLoading] = useState(true);
  const [sshImportResult, setSshImportResult] = useState(null);
  const [sshImportSelected, setSshImportSelected] = useState(() => new Set());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    activeRef.current = true;
    setSshImportLoading(true);
    setSshImportResult(null);
    setSshImportSelected(new Set());
    const parseConfig = async () => {
      try {
        const result = await window.terminalAPI?.parseOpenSSHConfig?.();
        if (cancelled) return;
        if (result?.success !== true) {
          showError(t("connectionManager.sshConfigReadFailed"));
          onClose();
          return;
        }
        setSshImportResult(result);
        setSshImportSelected(
          new Set(
            (result.hosts || [])
              .map((entry, index) =>
                isSshHostImportable(entry) ? index : null,
              )
              .filter((index) => index !== null),
          ),
        );
      } catch {
        if (!cancelled) {
          showError(t("connectionManager.sshConfigReadFailed"));
          onClose();
        }
      } finally {
        if (!cancelled) setSshImportLoading(false);
      }
    };
    void parseConfig();
    return () => {
      cancelled = true;
      activeRef.current = false;
    };
  }, [onClose, showError, t]);

  const handleClose = () => {
    if (!savingRef.current) onClose();
  };

  const handleToggleSshImportHost = (index) => {
    setSshImportSelected((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleConfirmSshImport = async () => {
    if (savingRef.current || sshImportLoading || sshImportSelected.size === 0)
      return;
    savingRef.current = true;
    setSaving(true);
    try {
      // Read at confirmation time: the connection sidebar need not be mounted,
      // and changes made since opening this dialog must survive the import.
      const connections = await window.terminalAPI?.loadConnections?.();
      if (!activeRef.current) return;
      if (!Array.isArray(connections)) {
        showError(t("connectionManager.loadFailed"));
        return;
      }
      const hosts = (sshImportResult?.hosts || []).filter(
        (entry, index) =>
          sshImportSelected.has(index) && isSshHostImportable(entry),
      );
      const { connections: importedConnections, skipped } =
        mapHostsToConnections(hosts, {
          generateId,
          existingNames: collectConnectionNames(connections),
        });
      if (importedConnections.length === 0) {
        showError(t("connectionManager.sshImportNoImportable"));
        return;
      }
      if (!window.terminalAPI?.saveConnections) {
        showError(t("connectionManager.saveFailed"));
        return;
      }
      const result = await window.terminalAPI.saveConnections([
        ...connections,
        ...importedConnections,
      ]);
      if (!activeRef.current) return;
      if (result === false || result?.success === false) {
        showError(t("connectionManager.saveFailed"));
        return;
      }
      const duplicateCount = skipped.filter(
        (item) => item.reason === "duplicate",
      ).length;
      showSuccess(
        duplicateCount > 0
          ? t("connectionManager.sshImportSuccessWithSkipped", {
              count: importedConnections.length,
              skipped: duplicateCount,
            })
          : t("connectionManager.sshImportSuccess", {
              count: importedConnections.length,
            }),
      );
      onClose();
    } catch {
      if (activeRef.current) showError(t("connectionManager.saveFailed"));
    } finally {
      savingRef.current = false;
      if (activeRef.current) setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={handleClose}
      aria-labelledby="openssh-import-dialog-title"
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle id="openssh-import-dialog-title">
        {t("connectionManager.sshImportTitle")}
      </DialogTitle>
      <DialogContent>
        {sshImportLoading ? (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              py: 4,
              gap: 1,
            }}
          >
            <CircularProgress size={20} />
            <Typography variant="body2" color="text.secondary">
              {t("connectionManager.sshImportParsing")}
            </Typography>
          </Box>
        ) : sshImportResult && !sshImportResult.exists ? (
          <Alert severity="info" sx={{ mt: 1 }}>
            {t("connectionManager.sshConfigNotFound", {
              path: sshImportResult.path,
            })}
          </Alert>
        ) : (
          <>
            {sshImportResult?.path && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.5, wordBreak: "break-all" }}
              >
                {t("connectionManager.sshImportSourcePath", {
                  path: sshImportResult.path,
                })}
              </Typography>
            )}
            {(sshImportResult?.hosts || []).length === 0 ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                {t("connectionManager.sshImportEmpty")}
              </Alert>
            ) : (
              <>
                {(sshImportResult?.warnings || []).length > 0 && (
                  <Alert severity="warning" sx={{ mt: 1 }}>
                    {sshImportResult.warnings.map((warning, index) => (
                      <Typography
                        key={index}
                        variant="caption"
                        sx={{ display: "block" }}
                      >
                        {warning}
                      </Typography>
                    ))}
                  </Alert>
                )}
                <List dense sx={{ mt: 1 }}>
                  {sshImportResult.hosts.map((entry, index) => {
                    const importable = isSshHostImportable(entry);
                    const authHint = entry.privateKeyPath
                      ? t("connectionManager.sshImportAuthKey", {
                          path: entry.privateKeyPath,
                        })
                      : t("connectionManager.sshImportAuthPassword");
                    return (
                      <ListItem
                        key={`${entry.alias}-${index}`}
                        dense
                        disablePadding
                      >
                        <ListItemButton
                          role={undefined}
                          onClick={() => {
                            if (importable && !saving) {
                              handleToggleSshImportHost(index);
                            }
                          }}
                          dense
                        >
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Checkbox
                              edge="start"
                              checked={sshImportSelected.has(index)}
                              disabled={!importable || saving}
                              tabIndex={-1}
                              disableRipple
                            />
                          </ListItemIcon>
                          <ListItemText
                            primary={entry.alias}
                            secondary={
                              importable
                                ? `${
                                    entry.username ? `${entry.username}@` : ""
                                  }${entry.host}:${entry.port || 22} · ${authHint}${
                                    entry.agentForward
                                      ? ` · ${t("connectionManager.agentForward")}`
                                      : ""
                                  }`
                                : t("connectionManager.sshImportProxyHint")
                            }
                            slotProps={{
                              primary: {
                                variant: "body2",
                                sx: { fontWeight: 600 },
                              },
                              secondary: {
                                variant: "caption",
                                sx: {
                                  wordBreak: "break-all",
                                  fontStyle: importable ? "normal" : "italic",
                                },
                              },
                            }}
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              </>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={saving}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={handleConfirmSshImport}
          variant="contained"
          disabled={sshImportLoading || saving || sshImportSelected.size === 0}
        >
          {t("connectionManager.sshImportConfirm", {
            count: sshImportSelected.size,
          })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
