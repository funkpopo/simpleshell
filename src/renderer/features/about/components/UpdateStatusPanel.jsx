import React, { memo } from "react";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import LinearProgress from "@mui/material/LinearProgress";
import Alert from "@mui/material/Alert";
import Chip from "@mui/material/Chip";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DownloadIcon from "@mui/icons-material/Download";
import UpdateIcon from "@mui/icons-material/Update";
import CheckIcon from "@mui/icons-material/Check";
import CancelIcon from "@mui/icons-material/Cancel";
import ScheduleIcon from "@mui/icons-material/Schedule";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../../../../shared/common";
import { normalizeSafeMarkdownHref } from "../../../shared/lib/markdownLinks.js";
import {
  formatDateTime,
  RELEASE_NOTE_ALLOWED_ELEMENTS,
  releaseNoteSx,
  updatePanelSx,
} from "../lib/aboutHelpers.js";

const UpdateStatusPanel = memo(function UpdateStatusPanel({
  updateInfo,
  downloadedInstallerInfo,
  updateStatus,
  downloadProgress,
  downloadDetails,
  isDownloading,
  checkingForUpdate,
  error,
  canInstallDownloadedUpdate,
  displayUpdateInfo,
  displayAppVersion,
  onCheckForUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onCancelDownload,
  onRemindLater,
  onOpenExternalLink,
}) {
  const { t, i18n } = useTranslation();

  const downloadSizeText = formatBytes(
    displayUpdateInfo?.size || displayUpdateInfo?.downloadSize,
  );
  const releaseDateText = formatDateTime(
    displayUpdateInfo?.publishedAt,
    i18n.language,
  );
  const downloadedText = formatBytes(downloadDetails.downloaded);
  const totalDownloadText = formatBytes(
    downloadDetails.total || updateInfo?.downloadSize || 0,
  );
  const downloadSpeedText = formatBytes(downloadDetails.speedBytesPerSecond);
  const updateSeverity = displayUpdateInfo?.severity || "normal";
  const shouldShowSecurityChip = displayUpdateInfo?.isSecurityUpdate === true;
  const shouldShowImportantChip =
    !shouldShowSecurityChip &&
    (displayUpdateInfo?.isImportantUpdate === true ||
      updateSeverity === "important");
  const lastUpdateError = downloadedInstallerInfo?.lastError;
  const shouldShowFailureProtectionNotice = Boolean(
    lastUpdateError?.message && downloadedInstallerInfo?.available,
  );

  const renderUpdateMetadata = () => {
    if (!updateInfo?.hasUpdate && !downloadedInstallerInfo?.available) {
      return null;
    }

    const metadataItems = [
      downloadSizeText
        ? {
            label: t("update.downloadSize"),
            value: downloadSizeText,
          }
        : null,
      releaseDateText
        ? {
            label: t("update.releaseDate"),
            value: releaseDateText,
          }
        : null,
    ].filter(Boolean);

    return (
      <Box sx={{ mt: 1.25 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            flexWrap: "wrap",
          }}
        >
          {shouldShowSecurityChip ? (
            <Chip
              label={t("update.securityUpdate")}
              color="error"
              size="small"
            />
          ) : null}
          {shouldShowImportantChip ? (
            <Chip
              label={t("update.importantUpdate")}
              color="warning"
              size="small"
            />
          ) : null}
          {downloadedInstallerInfo?.available ? (
            <Chip
              label={t("update.packageKept")}
              color="success"
              size="small"
              variant="outlined"
            />
          ) : null}
        </Box>

        {metadataItems.length > 0 ? (
          <Box
            sx={{
              mt: 1,
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                sm: "repeat(3, minmax(0, 1fr))",
              },
              gap: 1,
            }}
          >
            {metadataItems.map((item) => (
              <Box key={item.label}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: "block" }}
                >
                  {item.label}
                </Typography>
                <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Box>
        ) : null}
      </Box>
    );
  };

  // 渲染更新状态内容
  const renderUpdateContent = () => {
    let primaryContent = null;

    switch (updateStatus) {
      case "checking":
        primaryContent = (
          <Box sx={updatePanelSx}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t("update.checking")}</Typography>
            </Box>
          </Box>
        );
        break;

      case "upToDate":
        primaryContent = (
          <Box sx={updatePanelSx}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CheckIcon color="success" />
              <Typography variant="body2" color="success.main">
                {t("update.upToDate")}
              </Typography>
            </Box>
          </Box>
        );
        break;

      case "available":
        // 本地已有校验通过的包时，不再展示「去下载」文案
        if (canInstallDownloadedUpdate) {
          primaryContent = (
            <Box sx={updatePanelSx}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CheckIcon color="success" />
                <Typography variant="body2" color="success.main">
                  {t("update.readyToInstall")}
                </Typography>
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                {t("update.currentVersion")}:{" "}
                {downloadedInstallerInfo?.currentVersion ||
                  updateInfo?.currentVersion ||
                  displayAppVersion}{" "}
                →{" "}
                {downloadedInstallerInfo?.installerVersion ||
                  updateInfo?.latestVersion}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 0.75 }}
              >
                {t("update.installRestartHint")}
              </Typography>
              {renderUpdateMetadata()}
            </Box>
          );
        } else {
          primaryContent = (
            <Box sx={updatePanelSx}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <UpdateIcon color="primary" />
                <Typography variant="body2">{t("update.available")}</Typography>
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                {t("update.currentVersion")}: {updateInfo?.currentVersion} →{" "}
                {updateInfo?.latestVersion}
              </Typography>
              {renderUpdateMetadata()}
            </Box>
          );
        }
        break;

      case "downloading":
        primaryContent = (
          <Box sx={updatePanelSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                mb: 1,
              }}
            >
              <Typography variant="body2">{t("update.downloading")}</Typography>
              <Typography
                sx={{ fontWeight: 600 }}
                variant="caption"
                color="primary.main"
              >
                {Math.round(downloadProgress)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={downloadProgress}
              sx={{
                height: 8,
                borderRadius: 999,
                bgcolor: "action.hover",
                "& .MuiLinearProgress-bar": {
                  borderRadius: 999,
                },
              }}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.75 }}
            >
              {downloadedText && totalDownloadText
                ? t("update.downloadBytes", {
                    downloaded: downloadedText,
                    total: totalDownloadText,
                  })
                : t("update.downloadProgress", {
                    percent: Math.round(downloadProgress),
                  })}
              {downloadSpeedText
                ? ` · ${t("update.downloadSpeed", {
                    speed: `${downloadSpeedText}/s`,
                  })}`
                : ""}
            </Typography>
            {renderUpdateMetadata()}
          </Box>
        );
        break;

      case "downloaded":
        primaryContent = (
          <Box sx={updatePanelSx}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CheckIcon color="success" />
              <Typography variant="body2" color="success.main">
                {t("update.downloadComplete")}
              </Typography>
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 1 }}
            >
              {t("update.currentVersion")}:{" "}
              {downloadedInstallerInfo?.currentVersion ||
                updateInfo?.currentVersion ||
                displayAppVersion}{" "}
              →{" "}
              {downloadedInstallerInfo?.installerVersion ||
                updateInfo?.latestVersion}
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.75 }}
            >
              {t("update.installRestartHint")}
            </Typography>
            {renderUpdateMetadata()}
          </Box>
        );
        break;

      case "installing":
        primaryContent = (
          <Box sx={updatePanelSx}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t("update.installing")}</Typography>
            </Box>
          </Box>
        );
        break;

      default:
        // 已有校验通过的安装包时，统一展示「可安装」面板
        if (canInstallDownloadedUpdate) {
          primaryContent = (
            <Box sx={updatePanelSx}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CheckIcon color="success" />
                <Typography variant="body2" color="success.main">
                  {t("update.readyToInstall")}
                </Typography>
              </Box>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mt: 1 }}
              >
                {t("update.currentVersion")}:{" "}
                {downloadedInstallerInfo?.currentVersion || displayAppVersion} →{" "}
                {downloadedInstallerInfo?.installerVersion}
              </Typography>
              {renderUpdateMetadata()}
            </Box>
          );
        } else {
          primaryContent = null;
        }
    }

    return (
      <>
        {error ? (
          <Alert severity="error" variant="outlined" sx={{ mt: 1, mb: 1 }}>
            {error}
          </Alert>
        ) : null}
        {shouldShowFailureProtectionNotice ? (
          <Alert severity="warning" variant="outlined" sx={{ mt: 1, mb: 1 }}>
            {t("update.failureProtection", {
              error: lastUpdateError.message,
              logPath:
                downloadedInstallerInfo?.installerLogPath ||
                lastUpdateError.installerLogPath ||
                t("common.none"),
            })}
          </Alert>
        ) : null}
        {primaryContent}
      </>
    );
  };

  // 渲染更新按钮：校验完成后只保留「安装」主操作，隐藏下载等易误触按钮
  const renderUpdateButtons = () => {
    const installButton = (
      <Button
        variant="contained"
        onClick={onInstallUpdate}
        color="primary"
        disabled={updateStatus === "installing"}
        startIcon={<UpdateIcon />}
      >
        {t("update.installUpdate")}
      </Button>
    );

    const checkUpdateButton = (variant, label) => (
      <Button
        variant={variant}
        onClick={onCheckForUpdate}
        disabled={checkingForUpdate}
      >
        {label ||
          (updateStatus === "error"
            ? t("update.retryCheck")
            : t("about.checkUpdateButton"))}
      </Button>
    );

    if (updateStatus === "checking") {
      return (
        <Button variant="outlined" disabled>
          {t("update.checking")}
        </Button>
      );
    }

    if (updateStatus === "downloading") {
      return (
        <Button
          variant="outlined"
          onClick={onCancelDownload}
          startIcon={<CancelIcon />}
        >
          {t("common.cancel")}
        </Button>
      );
    }

    if (updateStatus === "installing") {
      return (
        <Button variant="outlined" disabled>
          {t("update.installing")}
        </Button>
      );
    }

    // 下载校验完成 / 本地已有安装包：仅显示安装，避免再次下载
    if (canInstallDownloadedUpdate) {
      return installButton;
    }

    if (updateStatus === "available") {
      return (
        <>
          <Button
            variant="contained"
            onClick={onDownloadUpdate}
            disabled={isDownloading}
            startIcon={<DownloadIcon />}
          >
            {t("update.download")}
          </Button>
          {typeof onRemindLater === "function" ? (
            <Button
              variant="text"
              onClick={onRemindLater}
              startIcon={<ScheduleIcon />}
            >
              {t("update.remindLater")}
            </Button>
          ) : null}
        </>
      );
    }

    if (updateStatus === "error") {
      return checkUpdateButton("outlined");
    }

    if (updateStatus === "upToDate") {
      return checkUpdateButton("outlined", t("update.retryCheck"));
    }

    // idle 等默认状态
    return checkUpdateButton("outlined");
  };

  const releaseNoteMarkdownComponents = {
    a: ({ href, children }) => {
      const safeHref = normalizeSafeMarkdownHref(href);

      if (!safeHref) {
        return <Box component="span">{children}</Box>;
      }

      return (
        <Link
          href={safeHref}
          underline="hover"
          onClick={(event) => {
            event.preventDefault();
            void onOpenExternalLink(safeHref);
          }}
        >
          {children}
        </Link>
      );
    },
  };

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 650 }} gutterBottom>
        {t("about.updateCheck")}
      </Typography>

      {renderUpdateContent()}

      {updateInfo?.releaseNotes && updateInfo?.hasUpdate && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="subtitle2" gutterBottom>
            {t("update.releaseNotes")}
          </Typography>
          <Box className="app-scrollbar" sx={releaseNoteSx}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={releaseNoteMarkdownComponents}
              allowedElements={RELEASE_NOTE_ALLOWED_ELEMENTS}
            >
              {updateInfo.releaseNotes}
            </ReactMarkdown>
          </Box>
        </Box>
      )}

      <Box
        sx={{
          mt: 1.5,
          display: "flex",
          alignItems: "center",
          gap: 1,
          flexWrap: "wrap",
        }}
      >
        {renderUpdateButtons()}
      </Box>
    </Box>
  );
});

export default UpdateStatusPanel;
