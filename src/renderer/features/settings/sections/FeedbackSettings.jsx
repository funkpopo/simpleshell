import * as React from "react";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import BugReportIcon from "@mui/icons-material/BugReport";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FeedbackIcon from "@mui/icons-material/Feedback";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  exportDiagnostics,
  openFeedbackIssue,
} from "../../../shared/lib/diagnosticsActions.js";
import {
  sectionCardSx,
  SectionCardHeader,
  SettingsToggleRow,
} from "../components/SettingsSection.jsx";

export default function FeedbackSettings({ initialValues, ref }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [errorReportingEnabled, setErrorReportingEnabled] = React.useState(
    initialValues.errorReportingEnabled,
  );
  const [includeDiagnosticsInFeedback, setIncludeDiagnosticsInFeedback] =
    React.useState(initialValues.includeDiagnosticsInFeedback);
  const [crashCaptureEnabled, setCrashCaptureEnabled] = React.useState(
    initialValues.crashCaptureEnabled,
  );
  const [crashReporterStatus, setCrashReporterStatus] = React.useState(
    initialValues.crashReporterStatus,
  );
  const handleExportDiagnostics = () =>
    exportDiagnostics({ t, showSuccess, showError });
  const handleCopyDiagnosticPackage = async () => {
    try {
      const result = await window.terminalAPI?.copyDiagnosticPackage?.({
        source: "settings",
        title: t("settings.feedback.defaultTitle"),
      });
      if (result?.success === false) {
        throw new Error(
          result.error || t("settings.feedback.copyPackageFailed"),
        );
      }
      showSuccess(t("settings.feedback.packageCopied"));
    } catch (error) {
      showError(error?.message || t("settings.feedback.copyPackageFailed"));
    }
  };
  const handleOpenFeedbackIssue = () =>
    openFeedbackIssue({
      t,
      showSuccess,
      showError,
      source: "settings",
      confirmButtonLabel: t("settings.feedback.openIssue"),
    });
  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({}),
    saveFeedback: async () => {
      if (window.terminalAPI?.saveErrorReportingSettings) {
        const response = await window.terminalAPI.saveErrorReportingSettings({
          enabled: errorReportingEnabled,
          prompted: true,
          includeDiagnosticsInFeedback:
            errorReportingEnabled && includeDiagnosticsInFeedback,
          crashCaptureEnabled,
        });
        if (response?.success === false) {
          throw new Error(response.error || t("settings.feedback.saveFailed"));
        }
        setCrashReporterStatus(response?.crashReporter || null);
      }
    },
  }));
  return (
    <Box>
      <Box sx={sectionCardSx}>
        <SectionCardHeader
          icon={BugReportIcon}
          iconColor="error.main"
          title={t("settings.feedback.title")}
          actions={
            <Chip
              size="small"
              color={crashReporterStatus?.started ? "success" : "warning"}
              variant="outlined"
              label={
                crashReporterStatus?.started
                  ? t("settings.feedback.localCrashCaptureOn")
                  : t("settings.feedback.localCrashCaptureOff")
              }
            />
          }
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
          {t("settings.feedback.description")}
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column" }}>
          <SettingsToggleRow
            id="settings-feedback-error-reporting"
            label={t("settings.feedback.enable")}
            description={t("settings.feedback.enableHelper")}
            checked={errorReportingEnabled}
            onChange={(e) => {
              const checked = e.target.checked;
              setErrorReportingEnabled(checked);
              if (!checked) {
                setIncludeDiagnosticsInFeedback(false);
              } else {
                setIncludeDiagnosticsInFeedback(true);
              }
            }}
          />
          <SettingsToggleRow
            id="settings-feedback-include-diagnostics"
            label={t("settings.feedback.includeDiagnostics")}
            description={t("settings.feedback.includeDiagnosticsHelper")}
            checked={errorReportingEnabled && includeDiagnosticsInFeedback}
            disabled={!errorReportingEnabled}
            onChange={(e) => setIncludeDiagnosticsInFeedback(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-feedback-crash-capture"
            label={t("settings.feedback.enableCrashCapture")}
            description={t("settings.feedback.crashCaptureHelper")}
            checked={crashCaptureEnabled}
            onChange={(e) => setCrashCaptureEnabled(e.target.checked)}
          />
        </Box>
        {crashReporterStatus?.crashDirectory ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              display: "block",
              mt: 1.25,
              px: 1,
              py: 0.75,
              borderRadius: "var(--radius-sm, 3px)",
              bgcolor: "background.paper",
              border: "1px solid",
              borderColor: "divider",
              wordBreak: "break-all",
              fontFamily: "monospace",
            }}
          >
            {t("settings.feedback.crashDirectory")}:{" "}
            {crashReporterStatus.crashDirectory}
          </Typography>
        ) : null}
        <Box
          sx={{
            display: "flex",
            gap: 0.75,
            mt: 1.5,
            flexWrap: "wrap",
          }}
        >
          <Button
            variant="outlined"
            size="small"
            startIcon={<ContentCopyIcon />}
            onClick={handleCopyDiagnosticPackage}
          >
            {t("settings.feedback.copyPackage")}
          </Button>
          <Button
            variant="outlined"
            size="small"
            startIcon={<BugReportIcon />}
            onClick={handleExportDiagnostics}
          >
            {t("settings.exportDiagnostics")}
          </Button>
          <Button
            variant="contained"
            size="small"
            startIcon={<FeedbackIcon />}
            onClick={handleOpenFeedbackIssue}
          >
            {t("settings.feedback.openIssue")}
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
