import React, { memo, useCallback } from "react";
import { GlassDialog } from "../../shared/ui/styledDialogs.jsx";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../shared/notifications/NotificationContext";
import CloseIcon from "@mui/icons-material/Close";
import useAppUpdateController from "./hooks/useAppUpdateController.js";
import UpdateStatusPanel from "./components/UpdateStatusPanel.jsx";

const AboutDialog = memo(function AboutDialog({
  open,
  onClose,
  checkUpdateSignal = 0,
  onRemindLater,
}) {
  const { t } = useTranslation();
  const { showError } = useNotification();
  const controller = useAppUpdateController({ open, checkUpdateSignal });

  // Open external link
  const handleOpenExternalLink = useCallback(
    async (url) => {
      try {
        if (!window.terminalAPI?.openExternal) {
          throw new Error("terminalAPI.openExternal is unavailable");
        }

        const isRestrictedProtocol =
          typeof url === "string" && url.toLowerCase().startsWith("mailto:");
        await window.terminalAPI.openExternal(url, {
          source: "about-dialog",
          allowRestrictedProtocols: isRestrictedProtocol,
        });
      } catch {
        showError(t("app.cannotOpenLinkAlert", { url }));
      }
    },
    [t, showError],
  );

  return (
    <GlassDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 1,
        }}
      >
        <span>{t("about.title")}</span>
        <Tooltip title={t("common.close")}>
          <span>
            <IconButton
              size="small"
              aria-label={t("common.close")}
              onClick={onClose}
              disabled={controller.updateStatus === "installing"}
              sx={{ color: "text.secondary" }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box
            sx={{
              p: 1.5,
              borderRadius: "var(--radius-md, 6px)",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: (theme) =>
                theme.palette.mode === "dark"
                  ? "rgba(255, 255, 255, 0.025)"
                  : "rgba(21, 23, 25, 0.02)",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 1,
                mb: 0.75,
              }}
            >
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                SimpleShell
              </Typography>
              <Chip
                size="small"
                variant="outlined"
                label={`${t("about.version")}: ${controller.displayAppVersion}`}
                sx={{ fontFamily: "monospace", fontSize: "0.72rem" }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {t("about.description")}
            </Typography>
            <Box
              sx={{
                mt: 1.25,
                pt: 1,
                borderTop: "1px solid",
                borderColor: "divider",
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                gap: 1,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {t("about.author")}:{" "}
                <Box
                  component="span"
                  sx={{ color: "text.primary", fontWeight: 500 }}
                >
                  funkpopo
                </Box>
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("about.email")}:{" "}
                <Link
                  href="#"
                  underline="hover"
                  onClick={(e) => {
                    e.preventDefault();
                    handleOpenExternalLink("mailto:funkpopoisme@gmail.com");
                  }}
                >
                  funkpopoisme@gmail.com
                </Link>
              </Typography>
            </Box>
          </Box>

          <Divider />

          <UpdateStatusPanel
            updateInfo={controller.updateInfo}
            downloadedInstallerInfo={controller.downloadedInstallerInfo}
            updateStatus={controller.updateStatus}
            downloadProgress={controller.downloadProgress}
            downloadDetails={controller.downloadDetails}
            isDownloading={controller.isDownloading}
            checkingForUpdate={controller.checkingForUpdate}
            error={controller.error}
            canInstallDownloadedUpdate={controller.canInstallDownloadedUpdate}
            displayUpdateInfo={controller.displayUpdateInfo}
            displayAppVersion={controller.displayAppVersion}
            onCheckForUpdate={controller.handleCheckForUpdate}
            onDownloadUpdate={controller.downloadUpdate}
            onInstallUpdate={controller.installUpdate}
            onCancelDownload={controller.cancelDownload}
            onRemindLater={onRemindLater}
            onOpenExternalLink={handleOpenExternalLink}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button
          variant="outlined"
          size="small"
          onClick={() =>
            handleOpenExternalLink(
              "https://github.com/funkpopo/simpleshell/releases",
            )
          }
        >
          {t("about.visitGithub")}
        </Button>
        <Button
          size="small"
          onClick={onClose}
          disabled={controller.updateStatus === "installing"}
        >
          {t("about.close")}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
});

AboutDialog.displayName = "AboutDialog";
AboutDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  checkUpdateSignal: PropTypes.number,
  onRemindLater: PropTypes.func,
};

export default AboutDialog;
