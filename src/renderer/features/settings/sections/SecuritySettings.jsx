import * as React from "react";
import Button from "@mui/material/Button";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import HistoryIcon from "@mui/icons-material/History";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  sectionCardSx,
  SectionCardHeader,
  SettingsToggleRow,
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
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={sectionCardSx}>
        <SectionCardHeader
          icon={HistoryIcon}
          title={t("settings.historyPrivacy.title")}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.25 }}>
          {t("settings.historyPrivacy.description")}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          color="error"
          startIcon={<DeleteOutlineIcon />}
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
        <SectionCardHeader
          icon={LockOutlinedIcon}
          title={t("settings.security.title")}
        />
        <SettingsToggleRow
          id="settings-master-password"
          label={t("settings.security.enable")}
          description={t("settings.security.description")}
          checked={masterPasswordEnabled}
          onChange={(e) => setMasterPasswordEnabled(e.target.checked)}
        />

        <Collapse in={masterPasswordEnabled} timeout={200} unmountOnExit>
          <Box sx={{ mt: 1.25 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 1 }}
            >
              {initialMasterPasswordEnabled
                ? t("settings.security.changeHint")
                : t("settings.security.createHint")}
            </Typography>
            <Box
              sx={{
                display: "grid",
                gap: 1,
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
              }}
            >
              <TextField
                fullWidth
                size="small"
                type="password"
                label={t("settings.security.password")}
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
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
          </Box>
        </Collapse>
        {!masterPasswordEnabled ? (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.75 }}
          >
            {t("settings.security.disableHint")}
          </Typography>
        ) : null}
      </Box>
    </Box>
  );
}
