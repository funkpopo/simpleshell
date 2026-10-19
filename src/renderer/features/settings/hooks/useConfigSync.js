import * as React from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";

export default function useConfigSync({ initialValues, open }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [sshImportOpen, setSshImportOpen] = React.useState(false);
  const handleCloseSshImport = React.useCallback(
    () => setSshImportOpen(false),
    [],
  );
  const [exportPassword, setExportPassword] = React.useState(
    initialValues.exportPassword,
  );
  const [exportConfirmPassword, setExportConfirmPassword] = React.useState(
    initialValues.exportConfirmPassword,
  );
  const [importFilePath, setImportFilePath] = React.useState(
    initialValues.importFilePath,
  );
  const [importPassword, setImportPassword] = React.useState(
    initialValues.importPassword,
  );
  const [importMode, setImportMode] = React.useState(initialValues.importMode);
  const [webdavUrl, setWebdavUrl] = React.useState(initialValues.webdavUrl);
  const [webdavUsername, setWebdavUsername] = React.useState(
    initialValues.webdavUsername,
  );
  const [webdavPassword, setWebdavPassword] = React.useState(
    initialValues.webdavPassword,
  );
  const [webdavFileName, setWebdavFileName] = React.useState(
    initialValues.webdavFileName,
  );
  const [configTransferBusy, setConfigTransferBusy] = React.useState(
    initialValues.configTransferBusy,
  );
  const [autoSyncEnabled, setAutoSyncEnabled] = React.useState(
    initialValues.autoSyncEnabled,
  );
  const [autoSyncOnStartup, setAutoSyncOnStartup] = React.useState(
    initialValues.autoSyncOnStartup,
  );
  const [autoSyncIntervalMinutes, setAutoSyncIntervalMinutes] = React.useState(
    initialValues.autoSyncIntervalMinutes,
  );
  const [rememberExportPassword, setRememberExportPassword] = React.useState(
    initialValues.rememberExportPassword,
  );
  const [autoSyncStatus, setAutoSyncStatus] = React.useState(
    initialValues.autoSyncStatus,
  );
  const getConfigTransferErrorMessage = (result, fallbackKey) => {
    const code = result?.errorCode || result?.code;
    switch (code) {
      case "CREDENTIAL_STORE_LOCKED":
        return t("settings.dataSync.errors.CREDENTIAL_STORE_LOCKED");
      case "DECRYPT_FAILED":
        return t("settings.dataSync.errors.DECRYPT_FAILED");
      case "INVALID_PACKAGE":
        return t("settings.dataSync.errors.INVALID_PACKAGE");
      case "PACKAGE_TOO_LARGE":
        return t("settings.dataSync.errors.PACKAGE_TOO_LARGE");
      case "PASSWORD_TOO_WEAK":
        return t("settings.dataSync.errors.PASSWORD_TOO_WEAK");
      case "WEBDAV_AUTH_FAILED":
        return t("settings.dataSync.errors.WEBDAV_AUTH_FAILED");
      case "WEBDAV_CONFLICT":
        return t("settings.dataSync.errors.WEBDAV_CONFLICT");
      case "WEBDAV_REMOTE_NOT_FOUND":
        return t("settings.dataSync.errors.WEBDAV_REMOTE_NOT_FOUND");
      case "WEBDAV_REQUEST_FAILED":
        return t("settings.dataSync.errors.WEBDAV_REQUEST_FAILED");
      case "WEBDAV_URL_INVALID":
        return t("settings.dataSync.errors.WEBDAV_URL_INVALID");
      case "WEBDAV_URL_REQUIRED":
        return t("settings.dataSync.errors.WEBDAV_URL_REQUIRED");
      default:
        break;
    }

    // fallbackKey 同样静态映射（调用点均为固定值）
    switch (fallbackKey) {
      case "settings.dataSync.export.failed":
        return t("settings.dataSync.export.failed");
      case "settings.dataSync.import.failed":
        return t("settings.dataSync.import.failed");
      case "settings.dataSync.webdav.testFailed":
        return t("settings.dataSync.webdav.testFailed");
      case "settings.dataSync.webdav.uploadFailed":
        return t("settings.dataSync.webdav.uploadFailed");
      case "settings.dataSync.webdav.downloadFailed":
        return t("settings.dataSync.webdav.downloadFailed");
      case "settings.dataSync.webdav.saveFailed":
        return t("settings.dataSync.webdav.saveFailed");
      default:
        break;
    }

    return result?.error || result?.message || fallbackKey;
  };
  const getAutoSyncSkippedMessage = (reason) => {
    switch (reason) {
      case "CREDENTIAL_STORE_LOCKED":
        return t("settings.dataSync.autoSync.skipped.CREDENTIAL_STORE_LOCKED");
      case "EXPORT_PASSWORD_NOT_SAVED":
        return t(
          "settings.dataSync.autoSync.skipped.EXPORT_PASSWORD_NOT_SAVED",
        );
      case "NO_URL":
        return t("settings.dataSync.autoSync.skipped.NO_URL");
      case "WEBDAV_AUTH_FAILED":
        return t("settings.dataSync.autoSync.skipped.WEBDAV_AUTH_FAILED");
      case "WEBDAV_REMOTE_NOT_FOUND":
        return t("settings.dataSync.autoSync.skipped.WEBDAV_REMOTE_NOT_FOUND");
      case "WEBDAV_REQUEST_FAILED":
        return t("settings.dataSync.autoSync.skipped.WEBDAV_REQUEST_FAILED");
      default:
        return t("settings.dataSync.autoSync.autoSkipped");
    }
  };
  const getAutoSyncStatusMessage = (status) => {
    switch (status) {
      case "error":
        return t("settings.dataSync.autoSync.status.error");
      case "locked":
        return t("settings.dataSync.autoSync.status.locked");
      case "no-export-password":
        return t("settings.dataSync.autoSync.status.no-export-password");
      case "remote-missing":
        return t("settings.dataSync.autoSync.status.remote-missing");
      case "up-to-date":
        return t("settings.dataSync.autoSync.status.up-to-date");
      case "updated":
        return t("settings.dataSync.autoSync.status.updated");
      default:
        return t("settings.dataSync.autoSync.status.never");
    }
  };
  const buildExportFileName = () => {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `simpleshell-config-${stamp}.ssx`;
  };
  const handleExportConfig = async () => {
    if (exportPassword.length < 4) {
      showError(t("settings.dataSync.export.passwordRequired"));
      return;
    }
    if (exportPassword !== exportConfirmPassword) {
      showError(t("settings.dataSync.export.passwordMismatch"));
      return;
    }
    setConfigTransferBusy("export");
    try {
      const dialogResult = await window.dialogAPI?.showSaveDialog?.({
        title: t("settings.dataSync.export.dialogTitle"),
        defaultPath: buildExportFileName(),
        filters: [{ name: "SimpleShell Config", extensions: ["ssx"] }],
      });
      if (dialogResult?.canceled || !dialogResult?.filePath) {
        return;
      }
      const filePath = dialogResult.filePath;
      const result = await window.terminalAPI.configTransferExport({
        filePath,
        password: exportPassword,
      });
      if (result?.success === false) {
        throw Object.assign(new Error(result.error), {
          code: result.errorCode,
        });
      }
      showSuccess(t("settings.dataSync.export.success"));
      setExportPassword("");
      setExportConfirmPassword("");
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(error, "settings.dataSync.export.failed"),
      );
    } finally {
      setConfigTransferBusy("");
    }
  };
  const handlePickImportFile = async () => {
    try {
      const dialogResult = await window.dialogAPI?.showOpenDialog?.({
        title: t("settings.dataSync.import.dialogTitle"),
        properties: ["openFile"],
        filters: [
          { name: "SimpleShell Config", extensions: ["ssx", "json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });
      const filePath = dialogResult?.filePaths?.[0];
      if (dialogResult?.canceled || !filePath) {
        return;
      }
      setImportFilePath(filePath);
    } catch (error) {
      showError(error?.message || t("settings.dataSync.import.failed"));
    }
  };
  const handleImportConfig = async () => {
    if (!importFilePath) {
      showError(t("settings.dataSync.import.noFile"));
      return;
    }
    setConfigTransferBusy("import");
    try {
      const result = await window.terminalAPI.configTransferImport({
        filePath: importFilePath,
        password: importPassword,
        mode: importMode,
      });
      if (result?.success === false) {
        throw Object.assign(new Error(result.error), {
          code: result.errorCode,
        });
      }
      showSuccess(t("settings.dataSync.import.success"));
      setImportPassword("");
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(error, "settings.dataSync.import.failed"),
      );
    } finally {
      setConfigTransferBusy("");
    }
  };
  const persistWebdavSettings = async () => {
    const saveResult = await window.terminalAPI.configSyncSaveSettings({
      url: webdavUrl,
      username: webdavUsername,
      password: webdavPassword,
      fileName: webdavFileName,
    });
    if (saveResult?.success === false) {
      throw new Error(
        saveResult.error || t("settings.dataSync.webdav.saveFailed"),
      );
    }
  };
  const handleWebdavTest = async () => {
    setConfigTransferBusy("webdav-test");
    try {
      const result = await window.terminalAPI.configSyncTest({
        url: webdavUrl,
        username: webdavUsername,
        password: webdavPassword,
        fileName: webdavFileName,
      });
      if (result?.success === false) {
        throw Object.assign(new Error(result.error), {
          code: result.errorCode,
        });
      }
      showSuccess(
        result?.note === "REMOTE_NOT_FOUND"
          ? t("settings.dataSync.webdav.testSuccessRemoteMissing")
          : t("settings.dataSync.webdav.testSuccess"),
      );
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(
          error,
          "settings.dataSync.webdav.testFailed",
        ),
      );
    } finally {
      setConfigTransferBusy("");
    }
  };
  const handleWebdavUpload = async (force = false) => {
    if (exportPassword.length < 4) {
      showError(t("settings.dataSync.export.passwordRequired"));
      return;
    }
    if (exportPassword !== exportConfirmPassword) {
      showError(t("settings.dataSync.export.passwordMismatch"));
      return;
    }
    setConfigTransferBusy("webdav-upload");
    try {
      await persistWebdavSettings();
      const upload = async (forceOverride) => {
        const result = await window.terminalAPI.configSyncUpload({
          url: webdavUrl,
          username: webdavUsername,
          password: webdavPassword,
          fileName: webdavFileName,
          exportPassword,
          // 确认覆盖后重试时必须以 force=true 重新上传，
          // 否则会捕获外层 force=false 再次冲突造成死循环
          force: forceOverride ?? force,
        });
        if (result?.success === false) {
          throw Object.assign(new Error(result.error), {
            code: result.errorCode,
          });
        }
        return result;
      };
      try {
        await upload();
      } catch (error) {
        if (error?.code !== "WEBDAV_CONFLICT") {
          throw error;
        }
        // 远端配置包与本地不一致：提示用户确认是否覆盖，避免多设备后写者覆盖前写者
        const answer = await window.dialogAPI?.showMessageBox?.({
          type: "warning",
          buttons: [
            t("settings.dataSync.webdav.conflictOverwrite"),
            t("settings.dataSync.webdav.conflictCancel"),
          ],
          defaultId: 1,
          cancelId: 1,
          message: t("settings.dataSync.webdav.conflictMessage"),
          detail: t("settings.dataSync.webdav.conflictDetail"),
        });
        if (!answer || answer.response !== 0) {
          return;
        }
        await upload(true);
      }
      showSuccess(t("settings.dataSync.webdav.uploadSuccess"));
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(
          error,
          "settings.dataSync.webdav.uploadFailed",
        ),
      );
    } finally {
      setConfigTransferBusy("");
    }
  };
  const handleWebdavDownload = async () => {
    if (!importPassword) {
      showError(t("settings.dataSync.import.passwordRequired"));
      return;
    }
    setConfigTransferBusy("webdav-download");
    try {
      await persistWebdavSettings();
      const result = await window.terminalAPI.configSyncDownload({
        url: webdavUrl,
        username: webdavUsername,
        password: webdavPassword,
        fileName: webdavFileName,
        importPassword,
        mode: importMode,
      });
      if (result?.success === false) {
        throw Object.assign(new Error(result.error), {
          code: result.errorCode,
        });
      }
      showSuccess(t("settings.dataSync.webdav.downloadSuccess"));
      setImportPassword("");
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(
          error,
          "settings.dataSync.webdav.downloadFailed",
        ),
      );
    } finally {
      setConfigTransferBusy("");
    }
  };
  const refreshAutoSyncStatus = React.useCallback(async () => {
    try {
      const response = await window.terminalAPI?.configSyncGetStatus?.();
      if (response?.success !== false) {
        setAutoSyncStatus(response?.status || response || null);
      }
    } catch {
      /* intentionally ignored */
    }
  }, []);
  const persistAutoSyncSettings = async (patch) => {
    const saveResult = await window.terminalAPI.configSyncSaveSettings(patch);
    if (saveResult?.success === false) {
      throw new Error(
        saveResult.error || t("settings.dataSync.webdav.saveFailed"),
      );
    }
    await refreshAutoSyncStatus();
  };
  const handleToggleAutoSync = async (checked) => {
    if (checked) {
      if (!webdavUrl.trim()) {
        showError(t("settings.dataSync.errors.WEBDAV_URL_REQUIRED"));
        setAutoSyncEnabled(false);
        return;
      }
      if (!rememberExportPassword && !exportPassword) {
        // 自动拉取需要能解密：要求记住导出密码
        showError(t("settings.dataSync.autoSync.exportPasswordNeeded"));
        setAutoSyncEnabled(false);
        return;
      }
      try {
        setConfigTransferBusy("auto-sync");
        await persistAutoSyncSettings({
          autoSyncEnabled: true,
          rememberExportPassword: true,
          // 当前输入的导出密码非空时更新保存的密码，否则保留已存密码
          exportPassword,
          autoSyncOnStartup,
          autoSyncIntervalMinutes,
        });
        setRememberExportPassword(true);
        setExportPassword("");
        setExportConfirmPassword("");
        showSuccess(t("settings.dataSync.autoSync.enabled"));
      } catch (error) {
        setAutoSyncEnabled(false);
        showError(
          getConfigTransferErrorMessage(
            error,
            "settings.dataSync.webdav.saveFailed",
          ),
        );
      } finally {
        setConfigTransferBusy("");
      }
    } else {
      setAutoSyncEnabled(false);
      try {
        await persistAutoSyncSettings({ autoSyncEnabled: false });
      } catch {
        /* intentionally ignored */
      }
    }
  };
  const handleAutoSyncOptionChange = async (patch) => {
    try {
      await persistAutoSyncSettings(patch);
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(
          error,
          "settings.dataSync.webdav.saveFailed",
        ),
      );
    }
  };
  const handleRememberExportPasswordChange = async (checked) => {
    if (checked && !exportPassword) {
      showError(t("settings.dataSync.autoSync.exportPasswordNeeded"));
      return;
    }
    try {
      await persistAutoSyncSettings({
        rememberExportPassword: checked,
        exportPassword: checked ? exportPassword : "",
      });
      setRememberExportPassword(checked);
      if (checked) {
        setExportPassword("");
        setExportConfirmPassword("");
        showSuccess(t("settings.dataSync.autoSync.exportPasswordSaved"));
      }
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(
          error,
          "settings.dataSync.webdav.saveFailed",
        ),
      );
    }
  };
  const handleSyncPullNow = async () => {
    setConfigTransferBusy("sync-pull");
    try {
      const result = await window.terminalAPI.configSyncPullNow();
      if (result?.skipped) {
        if (result.reason === "UP_TO_DATE") {
          showSuccess(t("settings.dataSync.autoSync.alreadyUpToDate"));
        } else if (result.reason !== "BUSY") {
          showError(getAutoSyncSkippedMessage(result.reason));
        }
      } else if (result?.success === false) {
        throw Object.assign(new Error(result.error), {
          code: result.reason || result.errorCode,
        });
      } else if (result?.status === "updated") {
        showSuccess(t("settings.dataSync.autoSync.pulledNow"));
      }
      await refreshAutoSyncStatus();
    } catch (error) {
      showError(
        getConfigTransferErrorMessage(
          error,
          "settings.dataSync.webdav.downloadFailed",
        ),
      );
    } finally {
      setConfigTransferBusy("");
    }
  };
  React.useEffect(() => {
    if (!open) setSshImportOpen(false);
  }, [open]);
  React.useEffect(() => {
    if (!open) return undefined;
    const offEvent = window.terminalAPI?.onConfigSyncAutoEvent?.((payload) => {
      refreshAutoSyncStatus();
      // manual 触发的结果由 handleSyncPullNow 直接提示，避免重复 toast
      if (payload?.trigger === "manual") {
        return;
      }
      const status = payload?.status;
      if (status === "updated") {
        showSuccess(t("settings.dataSync.autoSync.autoUpdated"));
      } else if (status === "error") {
        showError(
          t("settings.dataSync.autoSync.autoError", {
            error: payload?.error || payload?.reason || "",
          }),
        );
      } else if (
        payload?.trigger === "manual" &&
        payload?.reason === "UP_TO_DATE"
      ) {
        showSuccess(t("settings.dataSync.autoSync.alreadyUpToDate"));
      }
    });
    return () => {
      if (typeof offEvent === "function") {
        offEvent();
      }
    };
  }, [open, refreshAutoSyncStatus, showSuccess, showError, t]);
  return {
    configTransferBusy,
    setSshImportOpen,
    exportPassword,
    setExportPassword,
    exportConfirmPassword,
    setExportConfirmPassword,
    rememberExportPassword,
    handleRememberExportPasswordChange,
    handleExportConfig,
    handlePickImportFile,
    importFilePath,
    importPassword,
    setImportPassword,
    importMode,
    setImportMode,
    handleImportConfig,
    webdavUrl,
    setWebdavUrl,
    webdavUsername,
    setWebdavUsername,
    webdavPassword,
    setWebdavPassword,
    webdavFileName,
    setWebdavFileName,
    handleWebdavTest,
    handleWebdavUpload,
    handleWebdavDownload,
    autoSyncEnabled,
    handleToggleAutoSync,
    autoSyncOnStartup,
    setAutoSyncOnStartup,
    handleAutoSyncOptionChange,
    autoSyncIntervalMinutes,
    setAutoSyncIntervalMinutes,
    handleSyncPullNow,
    autoSyncStatus,
    getAutoSyncStatusMessage,
    handleCloseSshImport,
    sshImportOpen,
  };
}
