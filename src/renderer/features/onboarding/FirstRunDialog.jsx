import * as React from "react";
import { GlassDialog } from "../../shared/ui/styledDialogs.jsx";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
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
import { changeLanguage } from "../../i18n/i18n";

const onboardingCardSx = {
  p: 1.5,
  borderRadius: "var(--radius-md, 6px)",
  border: "1px solid",
  borderColor: "divider",
  bgcolor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.025)"
      : "rgba(21, 23, 25, 0.02)",
};

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
  const [confirmMasterPassword, setConfirmMasterPassword] = React.useState("");
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
        const uiResponse =
          await window.terminalAPI.saveUISettings(nextSettings);
        if (uiResponse?.success === false) {
          throw new Error(uiResponse.error || t("firstRun.errors.saveFailed"));
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
    <GlassDialog
      open={open}
      onClose={() => {}}
      maxWidth="sm"
      fullWidth
      onDefaultAction={handleFinish}
    >
      <DialogTitle sx={{ pb: 1.25 }}>
        <Typography variant="h6" component="div" sx={{ fontWeight: 700 }}>
          {t("firstRun.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t("firstRun.subtitle")}
        </Typography>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
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

          <Box sx={onboardingCardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 650 }}>
              {t("firstRun.privacyTitle")}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1, lineHeight: 1.5 }}
            >
              {t("firstRun.privacyDescription")}
            </Typography>
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                borderTop: "1px solid",
                borderColor: "divider",
                pt: 0.75,
                gap: 0.5,
              }}
            >
              <FormControlLabel
                labelPlacement="start"
                sx={{
                  m: 0,
                  width: "100%",
                  justifyContent: "space-between",
                  cursor: "pointer",
                }}
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
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t("firstRun.errorReporting")}
                  </Typography>
                }
              />
              <FormControlLabel
                labelPlacement="start"
                disabled={!errorReportingEnabled}
                sx={{
                  m: 0,
                  width: "100%",
                  justifyContent: "space-between",
                  opacity: errorReportingEnabled ? 1 : 0.55,
                  cursor: errorReportingEnabled ? "pointer" : "default",
                }}
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
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>
                    {t("firstRun.includeDiagnostics")}
                  </Typography>
                }
              />
            </Box>
          </Box>

          <Box sx={onboardingCardSx}>
            <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 650 }}>
              {t("firstRun.credentialTitle")}
            </Typography>
            <RadioGroup
              value={credentialMode}
              onChange={(event) => setCredentialMode(event.target.value)}
              sx={{ gap: 0.75 }}
            >
              <FormControlLabel
                value="system"
                sx={{
                  m: 0,
                  p: 1,
                  borderRadius: "var(--radius-sm, 3px)",
                  border: "1px solid",
                  borderColor:
                    credentialMode === "system" ? "primary.main" : "divider",
                  bgcolor:
                    credentialMode === "system"
                      ? "action.selected"
                      : "transparent",
                  transition:
                    "background-color 140ms ease, border-color 140ms ease",
                  alignItems: "flex-start",
                }}
                control={<Radio size="small" sx={{ pt: 0.25 }} />}
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
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
                sx={{
                  m: 0,
                  p: 1,
                  borderRadius: "var(--radius-sm, 3px)",
                  border: "1px solid",
                  borderColor:
                    credentialMode === "master" ? "primary.main" : "divider",
                  bgcolor:
                    credentialMode === "master"
                      ? "action.selected"
                      : "transparent",
                  transition:
                    "background-color 140ms ease, border-color 140ms ease",
                  alignItems: "flex-start",
                }}
                control={<Radio size="small" sx={{ pt: 0.25 }} />}
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {t("firstRun.masterCredentialMode")}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t("firstRun.masterCredentialModeHelp")}
                    </Typography>
                  </Box>
                }
              />
            </RadioGroup>

            <Collapse
              in={credentialMode === "master"}
              timeout={200}
              unmountOnExit
            >
              <Box
                sx={{
                  mt: 1.25,
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
            </Collapse>
          </Box>

          <Alert severity="info" variant="outlined">
            {t("firstRun.backupHint")}
          </Alert>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={handleFinish}
          variant="contained"
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : null}
        >
          {t("firstRun.finish")}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
};

export default React.memo(FirstRunDialog);
