import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { GlassDialog } from "./styledDialogs.jsx";
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
import PropTypes from "prop-types";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNotification } from "../contexts/NotificationContext";
import {
  Download as DownloadIcon,
  Update as UpdateIcon,
  Check as CheckIcon,
  Cancel as CancelIcon,
  Schedule as ScheduleIcon,
} from "@mui/icons-material";

const updatePanelSx = {
  mt: 1,
  p: 1.5,
  borderRadius: 2,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.04)"
      : "rgba(17, 24, 39, 0.03)",
};

const releaseNoteSx = {
  mt: 2,
  maxHeight: 220,
  overflow: "auto",
  borderRadius: 1.5,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(0, 0, 0, 0.2)"
      : "rgba(17, 24, 39, 0.04)",
  p: 1.25,
  fontSize: "0.75rem",
  lineHeight: 1.6,
  "& > :first-of-type": {
    mt: 0,
  },
  "& > :last-child": {
    mb: 0,
  },
  "& h1, & h2, & h3, & h4": {
    mt: 0,
    mb: 1,
    fontWeight: 700,
    lineHeight: 1.35,
  },
  "& h1": {
    fontSize: "1rem",
  },
  "& h2": {
    fontSize: "0.95rem",
  },
  "& h3, & h4": {
    fontSize: "0.875rem",
  },
  "& p": {
    my: 0,
    mb: 1,
  },
  "& ul, & ol": {
    mt: 0,
    mb: 1,
    pl: 2.5,
  },
  "& li + li": {
    mt: 0.5,
  },
  "& blockquote": {
    m: 0,
    mb: 1,
    py: 0.75,
    px: 1.25,
    borderLeft: "3px solid",
    borderColor: "primary.main",
    bgcolor: (theme) =>
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.04)"
        : "rgba(25, 118, 210, 0.06)",
    color: "text.secondary",
  },
  "& hr": {
    border: 0,
    borderTop: "1px solid",
    borderColor: "divider",
    my: 1.25,
  },
  "& code": {
    fontFamily:
      '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: "0.85em",
    px: 0.5,
    py: 0.125,
    borderRadius: 0.75,
    bgcolor: (theme) =>
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.08)"
        : "rgba(17, 24, 39, 0.08)",
  },
  "& pre": {
    mt: 0,
    mb: 1,
    p: 1,
    overflowX: "auto",
    borderRadius: 1,
    border: "1px solid",
    borderColor: "divider",
    bgcolor: (theme) =>
      theme.palette.mode === "dark"
        ? "rgba(0, 0, 0, 0.28)"
        : "rgba(17, 24, 39, 0.06)",
  },
  "& pre code": {
    display: "block",
    p: 0,
    bgcolor: "transparent",
    fontSize: "0.75rem",
  },
  "& table": {
    width: "100%",
    mb: 1,
    borderCollapse: "collapse",
  },
  "& th, & td": {
    border: "1px solid",
    borderColor: "divider",
    p: 0.75,
    textAlign: "left",
    verticalAlign: "top",
  },
  "& th": {
    fontWeight: 600,
    bgcolor: (theme) =>
      theme.palette.mode === "dark"
        ? "rgba(255, 255, 255, 0.04)"
        : "rgba(17, 24, 39, 0.05)",
  },
  "& input[type='checkbox']": {
    pointerEvents: "none",
    mr: 0.75,
  },
};

const MAX_MARKDOWN_LINK_LENGTH = 2048;
const ALLOWED_MARKDOWN_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);
const RELEASE_NOTE_ALLOWED_ELEMENTS = [
  "h1",
  "h2",
  "h3",
  "h4",
  "p",
  "a",
  "code",
  "pre",
  "strong",
  "em",
  "del",
  "ul",
  "ol",
  "li",
  "blockquote",
  "hr",
  "br",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "input",
];

const formatBytes = (value) => {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const formatDateTime = (value, locale) => {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(locale || undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const normalizeSafeMarkdownHref = (href) => {
  if (typeof href !== "string") {
    return null;
  }

  const trimmedHref = href.trim();
  if (!trimmedHref || trimmedHref.length > MAX_MARKDOWN_LINK_LENGTH) {
    return null;
  }

  let urlObj;
  try {
    urlObj = new URL(trimmedHref);
  } catch {
    return null;
  }

  const protocol = urlObj.protocol.toLowerCase();
  if (!ALLOWED_MARKDOWN_LINK_PROTOCOLS.has(protocol)) {
    return null;
  }

  return urlObj.toString();
};

const UPDATE_BUSY_STATUSES = new Set(["checking", "downloading", "installing"]);

/**
 * 将下载结果或 hasDownloadedInstaller 返回值统一为界面可用的安装包信息。
 * 下载阶段已完成哈希校验时，可直接用 result.installer 立即展示安装按钮。
 */
const normalizeDownloadedInstallerInfo = (source, options = {}) => {
  if (!source || source.available === false) {
    return null;
  }

  const installerVersion = source.installerVersion || source.version || null;
  const filePath =
    typeof source.filePath === "string" && source.filePath
      ? source.filePath
      : "";
  const fileName =
    source.fileName ||
    source.assetName ||
    (filePath ? filePath.split(/[\\/]/).pop() : null) ||
    null;

  // hasDownloadedInstaller 成功结果；或下载返回的 installer 元数据
  const looksReady =
    source.available === true ||
    Boolean(installerVersion) ||
    Boolean(filePath) ||
    Boolean(fileName) ||
    Boolean(source.sha256);

  if (!looksReady) {
    return null;
  }

  return {
    available: true,
    installerVersion,
    currentVersion:
      source.currentVersion || options.currentVersion || null,
    fileName,
    size: source.size || 0,
    sha256: source.sha256 || null,
    expectedSha256: source.expectedSha256 || null,
    downloadedAt: source.downloadedAt || null,
    publishedAt: source.publishedAt || null,
    releaseName: source.releaseName || null,
    assetName: source.assetName || null,
    isSecurityUpdate: source.isSecurityUpdate === true,
    isImportantUpdate: source.isImportantUpdate === true,
    severity: source.severity || "normal",
    status: source.status || "downloaded",
    installerLogPath: source.installerLogPath || null,
    lastError: source.lastError || null,
  };
};

const AboutDialog = memo(function AboutDialog({
  open,
  onClose,
  checkUpdateSignal = 0,
  onRemindLater,
}) {
  const { t, i18n } = useTranslation();
  const { showError } = useNotification();
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  const [appVersion, setAppVersion] = useState("1.0.0");
  const [updateInfo, setUpdateInfo] = useState(null);
  const [downloadedInstallerInfo, setDownloadedInstallerInfo] = useState(null);
  const [updateStatus, setUpdateStatus] = useState("idle"); // idle, checking, available, downloading, downloaded, installing, error, upToDate
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [downloadDetails, setDownloadDetails] = useState({
    downloaded: 0,
    total: 0,
    speedBytesPerSecond: 0,
  });
  const [isDownloading, setIsDownloading] = useState(false);
  const [error, setError] = useState("");
  const lastHandledCheckUpdateSignalRef = useRef(0);

  const hasDownloadedInstaller = downloadedInstallerInfo?.available === true;
  const updateIsBusy = UPDATE_BUSY_STATUSES.has(updateStatus);
  const displayUpdateInfo = hasDownloadedInstaller
    ? downloadedInstallerInfo
    : updateInfo;
  // 校验通过后的安装包：非忙碌状态一律可安装，并作为主操作
  const canInstallDownloadedUpdate = hasDownloadedInstaller && !updateIsBusy;
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

  // 对话框打开时检测是否有已下载且校验通过的安装包，有则直接进入可安装状态
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await window.terminalAPI.hasDownloadedInstaller?.();
        if (cancelled) {
          return;
        }

        const nextInstallerInfo = normalizeDownloadedInstallerInfo(result, {
          currentVersion: result?.currentVersion || appVersion,
        });
        setDownloadedInstallerInfo(nextInstallerInfo);

        if (nextInstallerInfo) {
          setUpdateStatus((currentStatus) =>
            UPDATE_BUSY_STATUSES.has(currentStatus)
              ? currentStatus
              : "downloaded",
          );
          return;
        }

        // 本地安装包不可用时，仅在仍停留在 downloaded 时回退，避免打断检查/下载流程
        setUpdateStatus((currentStatus) =>
          currentStatus === "downloaded" ? "idle" : currentStatus,
        );
      } catch {
        if (cancelled) {
          return;
        }

        setDownloadedInstallerInfo(null);
        setUpdateStatus((currentStatus) =>
          currentStatus === "downloaded" ? "idle" : currentStatus,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
    // 仅在打开对话框时探测；appVersion 用于展示当前版本号
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-driven probe
  }, [open, appVersion]);

  // 监听下载进度（仅更新进度条；状态切换由 downloadUpdate 完成校验后负责）
  useEffect(() => {
    let progressInterval;
    if (isDownloading) {
      progressInterval = setInterval(async () => {
        try {
          const result = await window.terminalAPI.getDownloadProgress();
          if (result.success) {
            const {
              progress,
              isDownloading: downloading,
              downloaded,
              total,
              speedBytesPerSecond,
            } = result.progress;
            setDownloadProgress(progress);
            setDownloadDetails({
              downloaded: downloaded || 0,
              total: total || 0,
              speedBytesPerSecond: speedBytesPerSecond || 0,
            });
            if (!downloading) {
              setIsDownloading(false);
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

  const refreshDownloadedInstallerInfo = useCallback(
    async (preferredSource = null) => {
      const fromPreferred = normalizeDownloadedInstallerInfo(preferredSource, {
        currentVersion:
          preferredSource?.currentVersion ||
          updateInfo?.currentVersion ||
          appVersion,
      });
      if (fromPreferred) {
        setDownloadedInstallerInfo(fromPreferred);
        return fromPreferred;
      }

      try {
        const result = await window.terminalAPI.hasDownloadedInstaller?.();
        const nextInfo = normalizeDownloadedInstallerInfo(result, {
          currentVersion: result?.currentVersion || appVersion,
        });
        setDownloadedInstallerInfo(nextInfo);
        return nextInfo;
      } catch {
        setDownloadedInstallerInfo(null);
        return null;
      }
    },
    [appVersion, updateInfo?.currentVersion],
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
        // 检查更新后若本地已有校验通过的安装包，直接进入可安装状态
        const installerInfo = await refreshDownloadedInstallerInfo();
        setUpdateStatus(
          installerInfo
            ? "downloaded"
            : result.updateInfo.hasUpdate
              ? "available"
              : "upToDate",
        );
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
  }, [refreshDownloadedInstallerInfo, t]);

  useEffect(() => {
    if (!open || !checkUpdateSignal) {
      return;
    }

    if (lastHandledCheckUpdateSignalRef.current === checkUpdateSignal) {
      return;
    }

    lastHandledCheckUpdateSignalRef.current = checkUpdateSignal;
    void handleCheckForUpdate();
  }, [checkUpdateSignal, handleCheckForUpdate, open]);

  // Download update：下载并完成哈希校验后立即切换到可安装状态
  const downloadUpdate = useCallback(async () => {
    if (!updateInfo?.downloadUrl) {
      setError(t("update.errors.noDownloadUrl"));
      return;
    }

    // 已有校验通过的安装包时不再重复下载
    if (hasDownloadedInstaller) {
      setUpdateStatus("downloaded");
      return;
    }

    setIsDownloading(true);
    setDownloadProgress(0);
    setDownloadDetails({
      downloaded: 0,
      total: updateInfo?.downloadSize || 0,
      speedBytesPerSecond: 0,
    });
    setError("");
    setUpdateStatus("downloading");

    try {
      const result = await window.terminalAPI.downloadUpdate();

      if (result.success) {
        // 优先使用下载返回的已校验 installer，立即显示安装按钮，避免二次全量哈希等待
        const installerInfo = await refreshDownloadedInstallerInfo({
          ...(result.installer || {}),
          filePath: result.filePath || result.installer?.filePath,
          currentVersion: updateInfo?.currentVersion || appVersion,
          available: true,
        });

        if (installerInfo) {
          setUpdateStatus("downloaded");
        } else {
          setError(t("update.errors.downloadFailed"));
          setUpdateStatus("error");
        }
      } else {
        const message = result.error || t("update.errors.downloadFailed");
        if (/cancelled/i.test(message)) {
          setUpdateStatus("available");
        } else {
          setError(message);
          setUpdateStatus("error");
        }
      }
    } catch (err) {
      const message = err.message || t("update.errors.downloadFailed");
      if (/cancelled/i.test(message)) {
        setUpdateStatus("available");
      } else {
        setError(message);
        setUpdateStatus("error");
      }
    } finally {
      setIsDownloading(false);
    }
  }, [
    appVersion,
    hasDownloadedInstaller,
    refreshDownloadedInstallerInfo,
    t,
    updateInfo,
  ]);

  // Install update
  const installUpdate = useCallback(async () => {
    if (!canInstallDownloadedUpdate) {
      setError(t("update.errors.noInstallerFile"));
      return;
    }

    setUpdateStatus("installing");
    setError("");

    try {
      const result = await window.terminalAPI.installUpdate();

      if (!result.success) {
        setError(result.error || t("update.errors.installationFailed"));
        const installerInfo = await refreshDownloadedInstallerInfo();
        // 安装失败但包仍可用时回到可安装状态，便于立即重试安装而非重新下载
        setUpdateStatus(installerInfo ? "downloaded" : "error");
      }
      // 成功安装后应用会自动退出并重启
    } catch (err) {
      setError(err.message || t("update.errors.installationFailed"));
      const installerInfo = await refreshDownloadedInstallerInfo();
      setUpdateStatus(installerInfo ? "downloaded" : "error");
    }
  }, [canInstallDownloadedUpdate, refreshDownloadedInstallerInfo, t]);

  // Cancel download
  const cancelDownload = useCallback(async () => {
    try {
      await window.terminalAPI.cancelDownload();
      setIsDownloading(false);
      setDownloadProgress(0);
      setDownloadDetails({
        downloaded: 0,
        total: updateInfo?.downloadSize || 0,
        speedBytesPerSecond: 0,
      });
      setUpdateStatus("available");
    } catch (err) {
      console.error("Failed to cancel download:", err);
    }
  }, [updateInfo]);

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
        <Box display="flex" alignItems="center" gap={0.75} flexWrap="wrap">
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
            <Box display="flex" alignItems="center" gap={1}>
              <CircularProgress size={16} />
              <Typography variant="body2">{t("update.checking")}</Typography>
            </Box>
          </Box>
        );
        break;

      case "upToDate":
        primaryContent = (
          <Box sx={updatePanelSx}>
            <Box display="flex" alignItems="center" gap={1}>
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
              <Box display="flex" alignItems="center" gap={1}>
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
                  appVersion}{" "}
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
              <Box display="flex" alignItems="center" gap={1}>
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
              display="flex"
              alignItems="center"
              justifyContent="space-between"
              mb={1}
            >
              <Typography variant="body2">{t("update.downloading")}</Typography>
              <Typography
                variant="caption"
                color="primary.main"
                fontWeight={600}
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
            <Box display="flex" alignItems="center" gap={1}>
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
                appVersion}{" "}
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
            <Box display="flex" alignItems="center" gap={1}>
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
              <Box display="flex" alignItems="center" gap={1}>
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
                {downloadedInstallerInfo?.currentVersion || appVersion} →{" "}
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
        onClick={installUpdate}
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
        onClick={handleCheckForUpdate}
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
          onClick={cancelDownload}
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
            onClick={downloadUpdate}
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
            void handleOpenExternalLink(safeHref);
          }}
        >
          {children}
        </Link>
      );
    },
  };

  return (
    <GlassDialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("about.title")}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 2 }}>
          <Typography variant="body1" gutterBottom>
            {t("about.version")}: {appVersion}
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t("about.description")}
          </Typography>

          <Typography variant="body2" sx={{ mt: 2 }}>
            {t("about.author")}: funkpopo
          </Typography>
          <Typography variant="body2">
            {t("about.email")}:{" "}
            <Link
              href="#"
              onClick={(e) => {
                e.preventDefault();
                handleOpenExternalLink("mailto:funkpopoisme@gmail.com");
              }}
            >
              funkpopoisme@gmail.com
            </Link>
          </Typography>

          <Divider sx={{ my: 2 }} />

          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle1" gutterBottom>
              {t("about.updateCheck")}
            </Typography>

            {renderUpdateContent()}

            {updateInfo?.releaseNotes && updateInfo?.hasUpdate && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  {t("update.releaseNotes")}
                </Typography>
                <Box sx={releaseNoteSx}>
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

            <Box sx={{ mt: 2, display: "flex", alignItems: "center", gap: 1 }}>
              {renderUpdateButtons()}
            </Box>
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
AboutDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  checkUpdateSignal: PropTypes.number,
  onRemindLater: PropTypes.func,
};

export default AboutDialog;
