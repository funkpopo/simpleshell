import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  normalizeDownloadedInstallerInfo,
  UPDATE_BUSY_STATUSES,
} from "../lib/aboutHelpers.js";

export default function useAppUpdateController({
  open,
  checkUpdateSignal = 0,
}) {
  const { t } = useTranslation();
  const [checkingForUpdate, setCheckingForUpdate] = useState(false);
  // 真实版本由主进程提供；读取完成前保持 null，避免把占位值当作当前版本
  const [appVersion, setAppVersion] = useState(null);
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
  const displayAppVersion = appVersion || "—";

  // Get app version
  useEffect(() => {
    if (!window.terminalAPI?.getAppVersion) return undefined;
    let cancelled = false;
    // 主进程返回 { success, version }；失败时保留当前显示值
    window.terminalAPI
      .getAppVersion()
      .then((result) => {
        if (!cancelled && result?.version) setAppVersion(result.version);
      })
      .catch((readError) =>
        console.warn("Failed to read app version:", readError),
      );
    return () => {
      cancelled = true;
    };
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
        } catch (progressError) {
          console.error("Failed to get download progress:", progressError);
        }
      }, 1000);
    }

    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    };
  }, [isDownloading]);

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
        // 主进程返回的 currentVersion 是权威值，可补上尚未读取到的版本号
        if (result.updateInfo?.currentVersion) {
          setAppVersion(result.updateInfo.currentVersion);
        }
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

  return {
    checkingForUpdate,
    updateInfo,
    downloadedInstallerInfo,
    updateStatus,
    downloadProgress,
    downloadDetails,
    isDownloading,
    error,
    displayUpdateInfo,
    canInstallDownloadedUpdate,
    displayAppVersion,
    handleCheckForUpdate,
    downloadUpdate,
    installUpdate,
    cancelDownload,
  };
}
