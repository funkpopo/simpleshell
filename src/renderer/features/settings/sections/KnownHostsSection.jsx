import * as React from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import VerifiedUserOutlinedIcon from "@mui/icons-material/VerifiedUserOutlined";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useTranslation } from "react-i18next";
import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  sectionCardSx,
  SectionCardHeader,
} from "../components/SettingsSection.jsx";

export function formatKnownHostEndpoint(entry) {
  const host = String(entry?.host || entry?.hostKey || "").trim();
  if (!host) {
    return "";
  }
  if (host.startsWith("|")) {
    return host;
  }
  const port = Number(entry?.port) || 22;
  if (host.includes(":") && !host.startsWith("[")) {
    return `[${host}]:${port}`;
  }
  return `${host}:${port}`;
}

function formatTrustedTimestamp(updatedAt) {
  if (!updatedAt) {
    return "—";
  }
  const parsed = new Date(updatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return String(updatedAt);
  }
  return parsed.toLocaleString();
}

export default function KnownHostsSection({ open = true }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [hosts, setHosts] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [mutating, setMutating] = React.useState(false);
  const [revokeTarget, setRevokeTarget] = React.useState(null);
  const [clearConfirmOpen, setClearConfirmOpen] = React.useState(false);
  const mountedRef = React.useRef(true);
  const loadSeqRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadKnownHosts = React.useCallback(async () => {
    if (!window.terminalAPI?.listKnownHosts) {
      if (mountedRef.current) {
        setHosts([]);
        setLoadError("");
        setLoading(false);
      }
      return;
    }

    const requestSeq = ++loadSeqRef.current;
    if (mountedRef.current) {
      setLoading(true);
      setLoadError("");
    }

    try {
      const result = await window.terminalAPI.listKnownHosts();
      if (!mountedRef.current || requestSeq !== loadSeqRef.current) {
        return;
      }
      if (result?.success === false) {
        throw new Error(
          result.error || t("settings.security.knownHosts.loadFailed"),
        );
      }
      setHosts(Array.isArray(result?.hosts) ? result.hosts : []);
    } catch (error) {
      if (!mountedRef.current || requestSeq !== loadSeqRef.current) {
        return;
      }
      setLoadError(
        error?.message || t("settings.security.knownHosts.loadFailed"),
      );
    } finally {
      if (mountedRef.current && requestSeq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [t]);

  React.useEffect(() => {
    if (open) {
      void loadKnownHosts();
    }
  }, [open, loadKnownHosts]);

  const appTrustedCount = React.useMemo(
    () =>
      hosts.filter((entry) => entry?.editable && entry?.source !== "system")
        .length,
    [hosts],
  );

  const filteredHosts = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return hosts;
    }
    return hosts.filter((entry) => {
      const endpoint = formatKnownHostEndpoint(entry).toLowerCase();
      const sourceText =
        entry?.source === "system"
          ? `system ${t("settings.security.knownHosts.sourceSystem")}`
          : `simpleshell ${t("settings.security.knownHosts.sourceApp")}`;
      const fields = [
        endpoint,
        entry?.hostKey,
        entry?.host,
        String(entry?.port || ""),
        entry?.fingerprint,
        entry?.keyType,
        sourceText,
      ];
      return fields.some(
        (field) =>
          typeof field === "string" && field.toLowerCase().includes(query),
      );
    });
  }, [hosts, searchQuery, t]);

  const handleCopyFingerprint = React.useCallback(
    async (fingerprint) => {
      if (!fingerprint) {
        return;
      }
      try {
        if (window.clipboardAPI?.writeText) {
          await window.clipboardAPI.writeText(fingerprint);
        } else if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(fingerprint);
        } else {
          showError(t("settings.security.knownHosts.copyFailed"));
          return;
        }
        showSuccess(t("settings.security.knownHosts.copySuccess"));
      } catch {
        showError(t("settings.security.knownHosts.copyFailed"));
      }
    },
    [showError, showSuccess, t],
  );

  const handleConfirmRevoke = React.useCallback(async () => {
    if (!revokeTarget || mutating || !window.terminalAPI?.removeKnownHost) {
      return;
    }
    const targetHostKey = revokeTarget.hostKey;
    const targetEndpoint = formatKnownHostEndpoint(revokeTarget);
    setMutating(true);
    try {
      const result = await window.terminalAPI.removeKnownHost(targetHostKey);
      if (result?.success === false) {
        throw new Error(
          result.error || t("settings.security.knownHosts.revokeFailed"),
        );
      }
      if (!mountedRef.current) {
        return;
      }
      setRevokeTarget(null);
      await loadKnownHosts();
      showSuccess(
        t("settings.security.knownHosts.revokeSuccess", {
          host: targetEndpoint,
        }),
      );
    } catch (error) {
      if (mountedRef.current) {
        showError(
          error?.message || t("settings.security.knownHosts.revokeFailed"),
        );
      }
    } finally {
      if (mountedRef.current) {
        setMutating(false);
      }
    }
  }, [loadKnownHosts, mutating, revokeTarget, showError, showSuccess, t]);

  const handleConfirmClearAll = React.useCallback(async () => {
    if (mutating || !window.terminalAPI?.clearKnownHosts) {
      return;
    }
    setMutating(true);
    try {
      const result = await window.terminalAPI.clearKnownHosts();
      if (result?.success === false) {
        throw new Error(
          result.error || t("settings.security.knownHosts.clearFailed"),
        );
      }
      if (!mountedRef.current) {
        return;
      }
      setClearConfirmOpen(false);
      await loadKnownHosts();
      showSuccess(t("settings.security.knownHosts.clearSuccess"));
    } catch (error) {
      if (mountedRef.current) {
        showError(
          error?.message || t("settings.security.knownHosts.clearFailed"),
        );
      }
    } finally {
      if (mountedRef.current) {
        setMutating(false);
      }
    }
  }, [loadKnownHosts, mutating, showError, showSuccess, t]);

  return (
    <Box sx={sectionCardSx}>
      <SectionCardHeader
        icon={VerifiedUserOutlinedIcon}
        title={t("settings.security.knownHosts.title")}
        actions={
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <Tooltip title={t("settings.security.knownHosts.refresh")}>
              <span>
                <IconButton
                  size="small"
                  aria-label={t("settings.security.knownHosts.refresh")}
                  onClick={() => void loadKnownHosts()}
                  disabled={loading || mutating}
                >
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Button
              variant="outlined"
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              disabled={loading || mutating || appTrustedCount === 0}
              onClick={() => setClearConfirmOpen(true)}
            >
              {t("settings.security.knownHosts.clearAll")}
            </Button>
          </Box>
        }
      />

      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
        {t("settings.security.knownHosts.description")}
      </Typography>

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 1.25,
          flexWrap: "wrap",
        }}
      >
        <TextField
          size="small"
          fullWidth
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t("settings.security.knownHosts.searchPlaceholder")}
          sx={{ flex: 1, minWidth: 200 }}
          slotProps={{
            htmlInput: {
              "aria-label": t("settings.security.knownHosts.searchPlaceholder"),
            },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" color="action" />
                </InputAdornment>
              ),
              endAdornment: searchQuery ? (
                <InputAdornment position="end">
                  <Tooltip title={t("common.clearSearch")}>
                    <IconButton
                      size="small"
                      aria-label={t("common.clearSearch")}
                      onClick={() => setSearchQuery("")}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ) : undefined,
            },
          }}
        />
      </Box>

      {loadError ? (
        <Alert severity="error" sx={{ mb: 1 }}>
          {loadError}
        </Alert>
      ) : null}

      {loading && hosts.length === 0 ? (
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 1,
            py: 3,
          }}
        >
          <CircularProgress size={18} />
          <Typography variant="body2" color="text.secondary">
            {t("settings.security.knownHosts.loading")}
          </Typography>
        </Box>
      ) : filteredHosts.length === 0 ? (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            py: 2.5,
            textAlign: "center",
            border: "1px dashed",
            borderColor: "divider",
            borderRadius: 1,
          }}
        >
          {hosts.length === 0
            ? t("settings.security.knownHosts.empty")
            : t("settings.security.knownHosts.noMatches")}
        </Typography>
      ) : (
        <TableContainer
          sx={{
            maxHeight: 280,
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 1,
            overflowX: "auto",
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>
                  {t("settings.security.knownHosts.colHost")}
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>
                  {t("settings.security.knownHosts.colFingerprint")}
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>
                  {t("settings.security.knownHosts.colTrustedAt")}
                </TableCell>
                <TableCell sx={{ fontWeight: 600 }}>
                  {t("settings.security.knownHosts.colSource")}
                </TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>
                  {t("settings.security.knownHosts.colActions")}
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredHosts.map((entry) => {
                const endpoint = formatKnownHostEndpoint(entry);
                const isSystem = entry.source === "system" || !entry.editable;
                return (
                  <TableRow key={entry.id} hover>
                    <TableCell
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.78rem",
                        maxWidth: 180,
                        wordBreak: "break-all",
                      }}
                    >
                      <Box sx={{ display: "flex", flexDirection: "column" }}>
                        <Box component="span">{endpoint}</Box>
                        {entry.keyType ? (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontSize: "0.68rem" }}
                          >
                            {entry.keyType}
                          </Typography>
                        ) : null}
                      </Box>
                    </TableCell>
                    <TableCell sx={{ maxWidth: 230 }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                          minWidth: 0,
                        }}
                      >
                        <Tooltip title={entry.fingerprint}>
                          <Typography
                            variant="caption"
                            sx={{
                              fontFamily: "monospace",
                              fontSize: "0.74rem",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              display: "block",
                              minWidth: 0,
                              flex: 1,
                            }}
                          >
                            {entry.fingerprint}
                          </Typography>
                        </Tooltip>
                        <Tooltip
                          title={t(
                            "settings.security.knownHosts.copyFingerprint",
                          )}
                        >
                          <IconButton
                            size="small"
                            aria-label={t(
                              "settings.security.knownHosts.copyFingerprint",
                            )}
                            onClick={() =>
                              void handleCopyFingerprint(entry.fingerprint)
                            }
                            sx={{ p: 0.25, flexShrink: 0 }}
                          >
                            <ContentCopyIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell
                      sx={{
                        fontSize: "0.75rem",
                        color: "text.secondary",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {formatTrustedTimestamp(entry.updatedAt)}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        variant={isSystem ? "outlined" : "filled"}
                        color={isSystem ? "default" : "primary"}
                        label={
                          isSystem
                            ? t("settings.security.knownHosts.sourceSystem")
                            : t("settings.security.knownHosts.sourceApp")
                        }
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                      {isSystem ? (
                        <Tooltip
                          title={t(
                            "settings.security.knownHosts.systemReadOnlyHint",
                          )}
                        >
                          <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{ fontSize: "0.72rem" }}
                          >
                            {t("settings.security.knownHosts.readOnly")}
                          </Typography>
                        </Tooltip>
                      ) : (
                        <Button
                          size="small"
                          color="error"
                          variant="text"
                          disabled={mutating}
                          onClick={() => setRevokeTarget(entry)}
                          sx={{ minWidth: 0, px: 1, fontSize: "0.75rem" }}
                        >
                          {t("settings.security.knownHosts.revoke")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog
        open={Boolean(revokeTarget)}
        onClose={() => !mutating && setRevokeTarget(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t("settings.security.knownHosts.revokeConfirmTitle")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {t("settings.security.knownHosts.revokeConfirmMessage", {
              host: revokeTarget ? formatKnownHostEndpoint(revokeTarget) : "",
            })}
          </Typography>
          {revokeTarget?.fingerprint ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: "block",
                fontFamily: "monospace",
                wordBreak: "break-all",
              }}
            >
              {revokeTarget.fingerprint}
            </Typography>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeTarget(null)} disabled={mutating}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={mutating}
            onClick={() => void handleConfirmRevoke()}
          >
            {t("settings.security.knownHosts.revoke")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={clearConfirmOpen}
        onClose={() => !mutating && setClearConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {t("settings.security.knownHosts.clearConfirmTitle")}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {t("settings.security.knownHosts.clearConfirmMessage", {
              count: appTrustedCount,
            })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setClearConfirmOpen(false)}
            disabled={mutating}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant="contained"
            color="error"
            disabled={mutating}
            onClick={() => void handleConfirmClearAll()}
          >
            {t("settings.security.knownHosts.clearAll")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
