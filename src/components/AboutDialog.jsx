import React, { memo, useCallback, useEffect, useState } from "react";
import { styled } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import { useTranslation } from "react-i18next";
import { useNotification } from "../contexts/NotificationContext";
import {
  Download as DownloadIcon,
  Update as UpdateIcon,
  Check as CheckIcon,
  Cancel as CancelIcon,
} from "@mui/icons-material";

// 自定义磨砂玻璃效果的Dialog组件
const GlassDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiDialog-paper": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(40, 44, 52, 0.75)"
        : "rgba(255, 255, 255, 0.75)",
    backdropFilter: "blur(10px)",
    boxShadow:
      theme.palette.mode === "dark"
        ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
        : "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
  },
}));

const AboutDialog = memo(function AboutDialog({ open, onClose }) {
  const { t } = useTranslation();
  const { showError } = useNotification();
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [appVersion, setAppVersion] = useState("1.0.0");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateStatus, setUpdateStatus] = useState("idle"); // idle, checking, available, downloading, downloaded, installing, error, upToDate
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadedFilePath, setDownloadedFilePath] = useState("");
  const [error, setError] = useState("");

  // Get app version
  useEffect(() => {
    if (window.terminalAPI?.getAppVersion) {
      const versionPromise = window.terminalAPI.getAppVersion();
      if (versionPromise instanceof Promise) {
        versionPromise.then((result) =>
          setAppVersion(result.version || "1.0.0"),
        );
      } else {
        setAppVersion(versionPromise || "1.0.0");
      }
    }
  }, []);

  // 监听下载进度
  useEffect(() => {
    let progressInterval;
    if (isDownloading) {
      progressInterval = setInterval(async () => {
        try {
          const result = await window.terminalAPI.getDownloadProgress();
          if (result.success) {
            const { progress, isDownloading: downloading } = result.progress;
            setDownloadProgress(progress);
            if (!downloading) {
              setIsDownloading(false);
              if (progress === 100) {
                setUpdateStatus("downloaded");
              }
              clearInterval(progressInterval);
            }
          }
        } catch (error) {
          console.error("Failed to get download progress:", error);
        }
      }, 1000);
    }

    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    };
  }, [isDownloading]);

  // Open external link
  const handleOpenExternalLink = useCallback(
    (url) => {
      if (window.terminalAPI?.openExternal) {
        window.terminalAPI.openExternal(url).catch((error) => {
          showError(t("app.cannotOpenLinkAlert", { url }));
        });
      } else {
        window.open(url, "_blank");
      }
    },
    [t, showError],
  );

  // Check for updates
  const handleCheckForUpdate = useCallback(async () => {
    setCheckingForUpdate(true);
    setError("");
    setUpdateStatus("checking");

    try {
      const result = await window.terminalAPI.checkForUpdate();

      if (result.success) {
        setUpdateInfo(result.updateInfo);
        setUpdateStatus(result.updateInfo.hasUpdate ? "available" : "upToDate");
      } else {
        setError(result.error || t("update.errors.checkFailed"));
        setUpdateStatus("error");
      }
    } catch (err) {
      setError(err.message || t("update.errors.networkError"));
      setUpdateStatus("error");
    } finally {
      setCheckingForUpdate(false);
    }
  }, []);

  // Download update
  const downloadUpdate = useCallback(async () => {
    if (!updateInfo?.downloadUrl) {
      setError(t("update.errors.noDownloadUrl"));
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setError("");
    setUpdateStatus("downloading");

    try {
      const result = await window.terminalAPI.downloadUpdate(
        updateInfo.downloadUrl,
      );

      if (result.success) {
        setDownloadedFilePath(result.filePath);
        setUpdateStatus("downloaded");
      } else {
        setError(result.error || t("update.errors.downloadFailed"));
        setUpdateStatus("error");
      }
    } catch (err) {
      setError(err.message || t("update.errors.downloadFailed"));
      setUpdateStatus("error");
    } finally {
      setIsDownloading(false);
    }
  }, [updateInfo]);

  // Install update
  const installUpdate = useCallback(async () => {
    if (!downloadedFilePath) {
      setError(t("update.errors.noInstallerFile"));
      return;
    }

    setUpdateStatus("installing");
    setError("");

    try {
      const result = await window.terminalAPI.installUpdate(downloadedFilePath);

      if (!result.success) {
        setError(result.error || t("update.errors.installationFailed"));
        setUpdateStatus("error");
      }
      // 成功安装后应用会自动退出并重启
    } catch (err) {
      setError(err.message || t("update.errors.installationFailed"));
      setUpdateStatus("error");
    }
  }, [downloadedFilePath]);

  // Cancel download
  const cancelDownload = useCallback(async () => {
    try {
      await window.terminalAPI.cancelDownload();
      setIsDownloading(false);
      setDownloadProgress(0);
      setUpdateStatus("available");
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  }, []);

  // 渲染更新状态内容
  const renderUpdateContent = () => {
    if (error) {
      return (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      );
    }

    switch (updateStatus) {
      case "checking":
        return (
          <Box display="flex" alignItems="center" mb={2}>
            <CircularProgress size={16} sx={{ mr: 1 }} />
            <Typography variant="body2">{t("update.checking")}</Typography>
          </Box>
        );

      case "upToDate":
        return (
          <Box display="flex" alignItems="center" mb={2}>
            <CheckIcon color="success" sx={{ mr: 1 }} />
            <Typography variant="body2" color="success.main">
              {t("update.upToDate")}
            </Typography>
          </Box>
        );

      case "available":
        return (
          <Box>
            <Box display="flex" alignItems="center" mb={1}>
              <UpdateIcon color="primary" sx={{ mr: 1 }} />
              <Typography variant="body2">{t("update.available")}</Typography>
              <Chip
                label={`v${updateInfo?.latestVersion}`}
                color="primary"
                size="small"
                sx={{ ml: 1 }}
              />
            </Box>
            <Typography variant="caption" color="text.secondary">
              {t("update.currentVersion")}: {updateInfo?.currentVersion} →{" "}
              {updateInfo?.latestVersion}
            </Typography>
          </Box>
        );

      case "downloading":
        return (
          <Box>
            <Box
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              mb={1}
            >
              <Typography variant="body2">{t("update.downloading")}</Typography>
              <Typography variant="caption">
                {Math.round(downloadProgress)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={downloadProgress}
              sx={{ mb: 1 }}
            />
          </Box>
        );

      case "downloaded":
        return (
          <Box display="flex" alignItems="center" mb={2}>
            <CheckIcon color="success" sx={{ mr: 1 }} />
            <Typography variant="body2" color="success.main">
              {t("update.downloadComplete")}
            </Typography>
          </Box>
        );

      case "installing":
        return (
          <Box display="flex" alignItems="center" mb={2}>
            <CircularProgress size={16} sx={{ mr: 1 }} />
            <Typography variant="body2">{t("update.installing")}</Typography>
          </Box>
        );

      default:
        return null;
    }
  };

  // 渲染更新按钮
  const renderUpdateButtons = () => {
    switch (updateStatus) {
      case "idle":
      case "error":
        return (
          <Button
            variant="outlined"
            onClick={handleCheckForUpdate}
            disabled={checkingForUpdate}
            startIcon={
              checkingForUpdate ? <CircularProgress size={16} /> : null
            }
          >
            {t("update.title")}
          </Button>
        );

      case "checking":
        return (
          <Button variant="outlined" disabled>
            {t("update.checking")}
          </Button>
        );

      case "available":
        return (
          <Button
            variant="contained"
            onClick={downloadUpdate}
            disabled={isDownloading}
            startIcon={<DownloadIcon />}
          >
            {t("update.download")}
          </Button>
        );

      case "downloading":
        return (
          <Button
            variant="outlined"
            onClick={cancelDownload}
            startIcon={<CancelIcon />}
          >
            {t("common.cancel")}
          </Button>
        );

      case "downloaded":
        return (
          <Button
            variant="contained"
            onClick={installUpdate}
            color="primary"
            startIcon={<UpdateIcon />}
          >
            {t("update.installNow")}
          </Button>
        );

      case "installing":
        return (
          <Button variant="outlined" disabled>
            {t("update.installing")}
          </Button>
        );

      case "upToDate":
        return (
          <Button
            variant="outlined"
            onClick={handleCheckForUpdate}
            disabled={checkingForUpdate}
          >
            {t("update.retryCheck")}
          </Button>
        );

      default:
        return null;
    }
  };

  return (
    <GlassDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("about.title")}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2 }}>
          <Typography variant="h6" gutterBottom>
            SimpleShell
          </Typography>
          <Typography variant="body1" gutterBottom>
            {t("about.version")}: {appVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t("about.description")}
          </Typography>

          <Typography variant="subtitle1" gutterBottom sx={{ mt: 2 }}>
            {t("about.author")}
          </Typography>
          <Typography variant="body2">{t("about.author")}: funkpopo</Typography>
          <Typography variant="body2">
            {t("about.email")}:{" "}
            <Link
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleOpenExternalLink("mailto:s767609509@gmail.com");
              }}
            >
              s767609509@gmail.com
            </Link>
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {t("about.updateCheck")}
            </Typography>

            {renderUpdateContent()}

            {updateInfo?.releaseNotes && updateStatus === "available" && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t("update.releaseNotes")}
                </Typography>
                <Box
                  sx={{
                    maxHeight: 120,
                    overflow: "auto",
                    bgcolor: "grey.50",
                    p: 1,
                    borderRadius: 1,
                    fontSize: "0.75rem",
                  }}
                >
                  <pre
                    style={{
                      whiteSpace: "pre-wrap",
                      margin: 0,
                      fontSize: "inherit",
                    }}
                  >
                    {updateInfo.releaseNotes.slice(0, 300)}
                    {updateInfo.releaseNotes.length > 300 ? "..." : ""}
                  </pre>
                </Box>
              </Box>
            )}

            <Box sx={{ mt: 2 }}>{renderUpdateButtons()}</Box>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={updateStatus === "installing"}>
          {t("about.close")}
        </Button>
        <Button
          onClick={() =>
            handleOpenExternalLink(
              "https://github.com/funkpopo/simpleshell/releases",
            )
          }
        >
          {t("about.visitGithub")}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
});

AboutDialog.displayName = "AboutDialog";

export default AboutDialog;
