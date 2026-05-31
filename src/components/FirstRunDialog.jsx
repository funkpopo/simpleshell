import * as React from "react";
import Dialog from "./AccessibleDialog.jsx";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "../i18n/i18n";

const ONBOARDING_VERSION = 1;

const normalizeInitialLanguage = (settings, fallbackLanguage) =>
  settings?.language || fallbackLanguage || "zh-CN";

const FirstRunDialog = ({
  open,
  initialSettings = null,
  credentialSecurityStatus = null,
  onComplete,
}) => {
  const { t, i18n } = useTranslation();
  const [language, setLanguage] = React.useState(() =>
    normalizeInitialLanguage(initialSettings, i18n.language),
  );
  const [errorReportingEnabled, setErrorReportingEnabled] =
    React.useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = React.useState(false);
  const [credentialMode, setCredentialMode] = React.useState("system");
  const [masterPassword, setMasterPassword] = React.useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] =
    React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState("");

  const masterPasswordAlreadyEnabled =
    credentialSecurityStatus?.masterPasswordEnabled === true;

  React.useEffect(() => {
    if (!open) {
      return;
    }

    setLanguage(normalizeInitialLanguage(initialSettings, i18n.language));
    setCredentialMode(masterPasswordAlreadyEnabled ? "master" : "system");
    setMasterPassword("");
    setConfirmMasterPassword("");
    setError("");
  }, [i18n.language, initialSettings, masterPasswordAlreadyEnabled, open]);

  const handleFinish = React.useCallback(async () => {
    if (saving) {
      return;
    }

    const wantsMasterPassword = credentialMode === "master";
    const changingMasterPassword = masterPassword.trim() !== "";

    if (
      wantsMasterPassword &&
      !masterPasswordAlreadyEnabled &&
      !masterPassword.trim()
    ) {
      setError(t("firstRun.errors.masterPasswordRequired"));
      return;
    }

    if (wantsMasterPassword && changingMasterPassword) {
      if (masterPassword !== confirmMasterPassword) {
        setError(t("firstRun.errors.masterPasswordMismatch"));
        return;
      }
    }

    setSaving(true);
    setError("");

    try {
      if (window.terminalAPI?.saveErrorReportingSettings) {
        const errorReportingResponse =
          await window.terminalAPI.saveErrorReportingSettings({
            enabled: errorReportingEnabled,
            prompted: true,
            includeDiagnosticsInFeedback:
              errorReportingEnabled && includeDiagnostics,
          });

        if (errorReportingResponse?.success === false) {
          throw new Error(
            errorReportingResponse.error || t("firstRun.errors.saveFailed"),
          );
        }
      }

      const shouldUpdateCredentialSecurity =
        credentialMode === "system"
          ? masterPasswordAlreadyEnabled
          : !masterPasswordAlreadyEnabled || changingMasterPassword;

      if (
        shouldUpdateCredentialSecurity &&
        window.terminalAPI?.updateCredentialSecurity
      ) {
        const credentialResponse =
          await window.terminalAPI.updateCredentialSecurity({
            masterPasswordEnabled: wantsMasterPassword,
            masterPassword: wantsMasterPassword ? masterPassword : "",
          });

        if (credentialResponse?.success === false) {
          throw new Error(
            credentialResponse.error || t("firstRun.errors.securityFailed"),
          );
        }

        const securityStatus = credentialResponse?.status ||
          credentialResponse?.data || {
            masterPasswordEnabled: wantsMasterPassword,
            unlocked: true,
            requiresUnlock: false,
          };

        window.dispatchEvent(
          new CustomEvent("credentialSecurityChanged", {
            detail: { status: securityStatus },
          }),
        );
      }

      const nextSettings = {
        ...(initialSettings || {}),
        language,
        onboarding: {
          ...(initialSettings?.onboarding || {}),
          completed: true,
          completedAt: new Date().toISOString(),
          version: ONBOARDING_VERSION,
        },
      };

      if (window.terminalAPI?.saveUISettings) {
        const uiResponse = await window.terminalAPI.saveUISettings(nextSettings);
        if (uiResponse?.success === false) {
          throw new Error(
            uiResponse.error || t("firstRun.errors.saveFailed"),
          );
        }
      }

      if (language && i18n.language !== language) {
        changeLanguage(language);
        document.documentElement.lang = language;
      }

      window.dispatchEvent(
        new CustomEvent("settingsChanged", {
          detail: {
            language,
            darkMode: nextSettings.darkMode,
            fontSize: nextSettings.fontSize,
            sidebarPosition: nextSettings.sidebarPosition,
            performance: nextSettings.performance,
          },
        }),
      );

      onComplete?.(nextSettings);
    } catch (submitError) {
      setError(submitError?.message || t("firstRun.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  }, [
    confirmMasterPassword,
    credentialMode,
    errorReportingEnabled,
    i18n.language,
    includeDiagnostics,
    initialSettings,
    language,
    masterPassword,
    masterPasswordAlreadyEnabled,
    onComplete,
    saving,
    t,
  ]);

  return (
    <Dialog
      open={open}
      onClose={() => {}}
      maxWidth="sm"
      fullWidth
      onDefaultAction={handleFinish}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 1.5,
          },
        },
      }}
    >
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700 }}>
          {t("firstRun.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
          {t("firstRun.subtitle")}
        </Typography>
      </DialogTitle>
      <DialogContent dividers sx={{ py: 2.25 }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2.25 }}>
          {error ? (
            <Alert severity="error" variant="outlined">
              {error}
            </Alert>
          ) : null}

          <FormControl fullWidth size="small">
            <InputLabel>{t("firstRun.language")}</InputLabel>
            <Select
              value={language}
              label={t("firstRun.language")}
              onChange={(event) => setLanguage(event.target.value)}
            >
              <MenuItem value="zh-CN">{t("languages.zh-CN")}</MenuItem>
              <MenuItem value="en-US">{t("languages.en-US")}</MenuItem>
            </Select>
          </FormControl>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              {t("firstRun.privacyTitle")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t("firstRun.privacyDescription")}
            </Typography>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={errorReportingEnabled}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setErrorReportingEnabled(checked);
                    setIncludeDiagnostics(checked);
                  }}
                />
              }
              label={
                <Typography variant="body2">
                  {t("firstRun.errorReporting")}
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={errorReportingEnabled && includeDiagnostics}
                  disabled={!errorReportingEnabled}
                  onChange={(event) =>
                    setIncludeDiagnostics(event.target.checked)
                  }
                />
              }
              label={
                <Typography variant="body2">
                  {t("firstRun.includeDiagnostics")}
                </Typography>
              }
            />
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
              {t("firstRun.credentialTitle")}
            </Typography>
            <RadioGroup
              value={credentialMode}
              onChange={(event) => setCredentialMode(event.target.value)}
            >
              <FormControlLabel
                value="system"
                control={<Radio size="small" />}
                label={
                  <Box>
                    <Typography variant="body2">
                      {t("firstRun.systemCredentialMode")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("firstRun.systemCredentialModeHelp")}
                    </Typography>
                  </Box>
                }
              />
              <FormControlLabel
                value="master"
                control={<Radio size="small" />}
                label={
                  <Box>
                    <Typography variant="body2">
                      {t("firstRun.masterCredentialMode")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("firstRun.masterCredentialModeHelp")}
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>

            {credentialMode === "master" ? (
              <Box
                sx={{
                  mt: 1,
                  display: "grid",
                  gap: 1.25,
                  gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                }}
              >
                <TextField
                  size="small"
                  type="password"
                  label={t("firstRun.masterPassword")}
                  value={masterPassword}
                  onChange={(event) => setMasterPassword(event.target.value)}
                  helperText={
                    masterPasswordAlreadyEnabled
                      ? t("firstRun.masterPasswordOptional")
                      : ""
                  }
                />
                <TextField
                  size="small"
                  type="password"
                  label={t("firstRun.confirmMasterPassword")}
                  value={confirmMasterPassword}
                  onChange={(event) =>
                    setConfirmMasterPassword(event.target.value)
                  }
                />
              </Box>
            ) : null}
          </Box>

          <Alert severity="info" variant="outlined">
            {t("firstRun.backupHint")}
          </Alert>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5 }}>
        <Button
          onClick={handleFinish}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {t("firstRun.finish")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default React.memo(FirstRunDialog);
