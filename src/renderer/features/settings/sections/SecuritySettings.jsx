import * as React from "react";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  sectionCardSx,
  SectionCardHeader,
} from "../components/SettingsSection.jsx";

export default function SecuritySettings({ initialValues, ref }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [masterPasswordEnabled, setMasterPasswordEnabled] = React.useState(
    initialValues.masterPasswordEnabled,
  );
  const [initialMasterPasswordEnabled, setInitialMasterPasswordEnabled] =
    React.useState(initialValues.initialMasterPasswordEnabled);
  const [masterPassword, setMasterPassword] = React.useState(
    initialValues.masterPassword,
  );
  const [confirmMasterPassword, setConfirmMasterPassword] = React.useState(
    initialValues.confirmMasterPassword,
  );
  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({}),
    save: async () => {
      const shouldUpdateCredentialSecurity =
        masterPasswordEnabled !== initialMasterPasswordEnabled ||
        (masterPasswordEnabled && masterPassword.trim() !== "");
      if (shouldUpdateCredentialSecurity) {
        if (
          masterPasswordEnabled &&
          !initialMasterPasswordEnabled &&
          !masterPassword.trim()
        ) {
          showError(t("settings.security.passwordRequired"));
          return false;
        }

        if (masterPasswordEnabled && masterPassword.trim()) {
          if (masterPassword !== confirmMasterPassword) {
            showError(t("settings.security.passwordMismatch"));
            return false;
          }
        }

        if (window.terminalAPI?.updateCredentialSecurity) {
          const securityResponse =
            await window.terminalAPI.updateCredentialSecurity({
              masterPasswordEnabled,
              masterPassword: masterPasswordEnabled ? masterPassword : "",
            });

          if (securityResponse?.success === false) {
            throw new Error(
              securityResponse.error || t("settings.security.updateFailed"),
            );
          }

          const securityStatus = securityResponse?.status ||
            securityResponse?.data || {
              masterPasswordEnabled,
              unlocked: true,
              requiresUnlock: false,
            };

          window.dispatchEvent(
            new CustomEvent("credentialSecurityChanged", {
              detail: { status: securityStatus },
            }),
          );

          setInitialMasterPasswordEnabled(masterPasswordEnabled);
          setMasterPassword("");
          setConfirmMasterPassword("");
        }
      }
      return true;
    },
  }));
  return (
    <Box>
      <Box sx={{ ...sectionCardSx, mb: 1.5 }}>
        <SectionCardHeader title={t("settings.historyPrivacy.title")} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t("settings.historyPrivacy.description")}
        </Typography>
        <Button
          variant="outlined"
          onClick={async () => {
            try {
              const result = await window.terminalAPI.clearCommandHistory();
              if (!result?.success) throw new Error();
              showSuccess(t("commandHistory.clearAllSuccess"));
            } catch {
              showError(t("commandHistory.clearAllFailed"));
            }
          }}
        >
          {t("settings.historyPrivacy.clearCommands")}
        </Button>
      </Box>
      <Box sx={sectionCardSx}>
        <SectionCardHeader title={t("settings.security.title")} />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
          {t("settings.security.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={masterPasswordEnabled}
              onChange={(e) => setMasterPasswordEnabled(e.target.checked)}
              size="small"
            />
          }
          label={
            <Typography variant="body2">
              {t("settings.security.enable")}
            </Typography>
          }
        />

        {masterPasswordEnabled ? (
          <Box sx={{ mt: 0.75 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.75 }}
            >
              {initialMasterPasswordEnabled
                ? t("settings.security.changeHint")
                : t("settings.security.createHint")}
            </Typography>
            <TextField
              fullWidth
              size="small"
              type="password"
              label={t("settings.security.password")}
              value={masterPassword}
              onChange={(e) => setMasterPassword(e.target.value)}
              sx={{ mb: 0.75 }}
            />
            <TextField
              fullWidth
              size="small"
              type="password"
              label={t("settings.security.confirmPassword")}
              value={confirmMasterPassword}
              onChange={(e) => setConfirmMasterPassword(e.target.value)}
            />
          </Box>
        ) : (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.5 }}
          >
            {t("settings.security.disableHint")}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
