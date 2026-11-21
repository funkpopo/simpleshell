/** Sync settings persistence and scheduled background auto-sync helpers. */
function createAutoSyncSchedulerMethods({
  crypto,
  configService,
  DEFAULT_REMOTE_FILE_NAME,
  SYNC_SETTINGS_CONFIG_KEY,
  AUTO_SYNC_STARTUP_DELAY_MS,
  AUTO_SYNC_MIN_INTERVAL_MIN,
  AUTO_SYNC_MAX_INTERVAL_MIN,
  AUTO_SYNC_DEFAULT_INTERVAL_MIN,
}) {
  return {
    _readRawSyncSettings() {
      try {
        const stored = configService.get(SYNC_SETTINGS_CONFIG_KEY);
        return stored && typeof stored === "object" ? { ...stored } : {};
      } catch {
        return {};
      }
    },

    _updateSyncSettingsState(patch) {
      const next = { ...this._readRawSyncSettings(), ...patch };
      if (!configService.set(SYNC_SETTINGS_CONFIG_KEY, next)) {
        this._log(
          "ConfigTransferService: Failed to persist sync settings state.",
          "WARN",
        );
      }
    },

    _getDefaultAutoSyncSettings() {
      return {
        autoSyncEnabled: false,
        autoSyncOnStartup: true,
        autoSyncIntervalMinutes: AUTO_SYNC_DEFAULT_INTERVAL_MIN,
      };
    },

    _decryptStoredValue(value) {
      if (typeof value !== "string" || !value) {
        return "";
      }
      return configService.crypto?.decryptText
        ? configService.crypto.decryptText(value) || ""
        : "";
    },

    loadSyncSettings() {
      const raw = this._readRawSyncSettings();
      const defaults = this._getDefaultAutoSyncSettings();
      const webdavPassword = this._decryptStoredValue(raw.password);
      const storedExportPassword = this._decryptStoredValue(
        raw.storedExportPassword,
      );
      return {
        url: raw.url || "",
        username: raw.username || "",
        password: webdavPassword,
        hasStoredWebdavPassword: Boolean(raw.password),
        fileName: raw.fileName || DEFAULT_REMOTE_FILE_NAME,
        autoSyncEnabled: raw.autoSyncEnabled === true,
        autoSyncOnStartup:
          raw.autoSyncOnStartup === undefined
            ? defaults.autoSyncOnStartup
            : raw.autoSyncOnStartup === true,
        autoSyncIntervalMinutes: this._clampAutoSyncInterval(
          raw.autoSyncIntervalMinutes,
        ),
        rememberExportPassword: Boolean(raw.storedExportPassword),
        storedExportPassword,
        hasStoredExportPassword: Boolean(raw.storedExportPassword),
        lastSyncAt: raw.lastSyncAt || null,
        lastCheckAt: raw.lastCheckAt || null,
        lastSyncStatus: raw.lastSyncStatus || null,
        lastSyncDetail: raw.lastSyncDetail || null,
      };
    },

    _clampAutoSyncInterval(minutes) {
      const value = Number(minutes);
      if (!Number.isFinite(value)) {
        return AUTO_SYNC_DEFAULT_INTERVAL_MIN;
      }
      return Math.min(
        AUTO_SYNC_MAX_INTERVAL_MIN,
        Math.max(AUTO_SYNC_MIN_INTERVAL_MIN, Math.round(value)),
      );
    },

    /**
     * 保存同步设置（字段级合并，未提供的字段保留原值；密码仅提供时更新）
     */
    saveSyncSettings(settings = {}) {
      const next = this._readRawSyncSettings();

      if (settings.url !== undefined) {
        next.url = String(settings.url || "").trim();
      }
      if (settings.username !== undefined) {
        next.username = String(settings.username || "");
      }
      if (settings.fileName !== undefined) {
        next.fileName =
          String(settings.fileName || DEFAULT_REMOTE_FILE_NAME).trim() ||
          DEFAULT_REMOTE_FILE_NAME;
      }
      if (typeof settings.password === "string" && settings.password) {
        const encrypted = configService.crypto?.encryptText
          ? configService.crypto.encryptText(settings.password)
          : "";
        if (encrypted) {
          next.password = encrypted;
        }
      }

      // 自动同步开关
      if (settings.autoSyncEnabled !== undefined) {
        next.autoSyncEnabled = settings.autoSyncEnabled === true;
      }
      if (settings.autoSyncOnStartup !== undefined) {
        next.autoSyncOnStartup = settings.autoSyncOnStartup === true;
      }
      if (settings.autoSyncIntervalMinutes !== undefined) {
        next.autoSyncIntervalMinutes = this._clampAutoSyncInterval(
          settings.autoSyncIntervalMinutes,
        );
      }

      // 导出密码记忆（自动拉取解密需要）
      if (settings.rememberExportPassword !== undefined) {
        if (settings.rememberExportPassword === false) {
          delete next.storedExportPassword;
        }
      }
      if (
        settings.rememberExportPassword === true &&
        typeof settings.exportPassword === "string" &&
        settings.exportPassword
      ) {
        const encryptedExport = configService.crypto?.encryptText
          ? configService.crypto.encryptText(settings.exportPassword)
          : "";
        if (encryptedExport) {
          next.storedExportPassword = encryptedExport;
        }
      }

      if (!configService.set(SYNC_SETTINGS_CONFIG_KEY, next)) {
        throw new Error("Failed to save sync settings");
      }
      this._log("ConfigTransferService: Sync settings saved.", "INFO");
      return { success: true };
    },

    setAutoSyncNotifier(notifier) {
      this._autoSyncNotifier = typeof notifier === "function" ? notifier : null;
    },

    _notifyAutoSync(trigger, result) {
      if (!this._autoSyncNotifier) {
        return;
      }
      try {
        this._autoSyncNotifier({
          trigger,
          timestamp: Date.now(),
          ...result,
        });
      } catch (error) {
        this._log(
          `ConfigTransferService: Auto-sync notifier failed - ${error.message}`,
          "WARN",
        );
      }
    },

    _recordSyncResult(status, detail, remoteHash = null) {
      const patch = {
        lastCheckAt: Date.now(),
        lastSyncStatus: status,
        lastSyncDetail: detail || null,
      };
      if (status === "updated") {
        patch.lastSyncAt = Date.now();
      }
      if (remoteHash) {
        patch.lastRemoteHash = remoteHash;
      }
      this._updateSyncSettingsState(patch);
    },

    getAutoSyncStatus() {
      const settings = this.loadSyncSettings();
      return {
        hasWebdavConfig: Boolean(settings.url),
        hasStoredExportPassword: settings.hasStoredExportPassword,
        autoSyncEnabled: settings.autoSyncEnabled,
        autoSyncOnStartup: settings.autoSyncOnStartup,
        autoSyncIntervalMinutes: settings.autoSyncIntervalMinutes,
        lastSyncAt: settings.lastSyncAt,
        lastCheckAt: settings.lastCheckAt,
        lastSyncStatus: settings.lastSyncStatus,
        lastSyncDetail: settings.lastSyncDetail,
        nextRunAt: this._nextRunAt,
        running: this._autoSyncRunning,
      };
    },

    /**
     * 执行一次自动拉取：远端包哈希与上次同步一致则跳过，
     * 否则解密后按合并模式导入（自动同步永远不用替换模式，避免无人值守时覆盖丢数据）
     * @param {string} trigger - "startup" | "scheduled" | "manual"
     */
    async autoSyncPull(trigger = "manual") {
      if (this._autoSyncRunning) {
        return { success: false, skipped: true, reason: "BUSY" };
      }
      this._autoSyncRunning = true;
      try {
        const result = await this._autoSyncPullInternal(trigger);
        this._notifyAutoSync(trigger, result);
        return result;
      } finally {
        this._autoSyncRunning = false;
      }
    },

    async _autoSyncPullInternal(trigger) {
      const raw = this._readRawSyncSettings();
      if (!raw.url) {
        return { success: false, skipped: true, reason: "NO_URL" };
      }

      const credStatus = configService.getCredentialSecurityStatus();
      if (credStatus?.requiresUnlock) {
        this._recordSyncResult("locked", "credential store locked");
        return {
          success: false,
          skipped: true,
          reason: "CREDENTIAL_STORE_LOCKED",
        };
      }

      const importPassword = this._decryptStoredValue(raw.storedExportPassword);
      if (!importPassword) {
        this._recordSyncResult(
          "no-export-password",
          "export password not saved",
        );
        return {
          success: false,
          skipped: true,
          reason: "EXPORT_PASSWORD_NOT_SAVED",
        };
      }

      const settings = {
        url: raw.url,
        username: raw.username,
        password: this._decryptStoredValue(raw.password),
        fileName: raw.fileName,
      };

      let response;
      try {
        response = await this._webdavRequest({ settings, method: "GET" });
      } catch (error) {
        this._recordSyncResult("error", error.message || "network error");
        return {
          success: false,
          skipped: false,
          status: "error",
          error: error.message,
          errorCode: error.code || "WEBDAV_REQUEST_FAILED",
        };
      }

      if (response.status === 404) {
        this._recordSyncResult("remote-missing", "remote package not found");
        return {
          success: false,
          skipped: true,
          reason: "WEBDAV_REMOTE_NOT_FOUND",
        };
      }
      if (response.status === 401 || response.status === 403) {
        this._recordSyncResult("error", "webdav auth failed");
        return {
          success: false,
          skipped: false,
          status: "error",
          reason: "WEBDAV_AUTH_FAILED",
        };
      }
      if (response.status !== 200) {
        const detail = `webdav download failed (HTTP ${response.status})`;
        this._recordSyncResult("error", detail);
        return {
          success: false,
          skipped: false,
          status: "error",
          reason: "WEBDAV_REQUEST_FAILED",
          error: detail,
        };
      }

      const remoteHash = crypto
        .createHash("sha256")
        .update(response.body)
        .digest("hex");
      if (remoteHash === raw.lastRemoteHash) {
        this._recordSyncResult(
          "up-to-date",
          "remote package unchanged",
          remoteHash,
        );
        return {
          success: true,
          skipped: true,
          status: "up-to-date",
          reason: "UP_TO_DATE",
        };
      }

      let packageObject;
      try {
        packageObject = JSON.parse(response.body.toString("utf8"));
      } catch {
        this._recordSyncResult("error", "invalid package");
        return {
          success: false,
          skipped: false,
          status: "error",
          reason: "INVALID_PACKAGE",
        };
      }

      let payload;
      try {
        payload = await this._decryptPackage(packageObject, importPassword);
      } catch (error) {
        const reason = error.code || "DECRYPT_FAILED";
        this._recordSyncResult("error", reason);
        return {
          success: false,
          skipped: false,
          status: "error",
          reason,
        };
      }

      const applied = this._applyImportedPayload(payload, { mode: "merge" });
      const summary = this._summarizePayload(payload);
      this._recordSyncResult(
        "updated",
        `applied: ${applied.join(",")}`,
        remoteHash,
      );
      this._log(
        `ConfigTransferService: Auto-sync (${trigger}) pulled and imported remote config (applied=${applied.join(",")})`,
        "INFO",
      );
      return {
        success: true,
        skipped: false,
        status: "updated",
        applied,
        summary,
      };
    },

    _getAutoSyncIntervalMs() {
      const raw = this._readRawSyncSettings();
      return (
        this._clampAutoSyncInterval(
          raw.autoSyncIntervalMinutes !== undefined
            ? raw.autoSyncIntervalMinutes
            : AUTO_SYNC_DEFAULT_INTERVAL_MIN,
        ) *
        60 *
        1000
      );
    },

    _clearAutoSyncTimers() {
      if (this._autoSyncTimer) {
        clearTimeout(this._autoSyncTimer);
        this._autoSyncTimer = null;
      }
      this._nextRunAt = null;
    },

    _scheduleNextRun(delayMs, intervalMs) {
      this._clearAutoSyncTimers();
      this._nextRunAt = Date.now() + delayMs;
      this._autoSyncTimer = setTimeout(async () => {
        try {
          await this.autoSyncPull("scheduled");
        } catch (error) {
          this._log(
            `ConfigTransferService: Scheduled auto-sync failed - ${error.message}`,
            "WARN",
          );
        }
        // 仅在仍启用时继续排程
        if (this._readRawSyncSettings().autoSyncEnabled === true) {
          this._scheduleNextRun(intervalMs, intervalMs);
        }
      }, delayMs);
    },

    /**
     * 启动自动同步调度器（按当前设置；未启用则为空操作）
     */
    startAutoSyncScheduler() {
      const raw = this._readRawSyncSettings();
      this._clearAutoSyncTimers();
      if (raw.autoSyncEnabled !== true || !raw.url) {
        return this.getAutoSyncStatus();
      }

      const intervalMs =
        this._clampAutoSyncInterval(raw.autoSyncIntervalMinutes) * 60 * 1000;
      // 启动时拉取：延迟 15s 等待窗口/凭据就绪；否则首个周期后再检查
      const firstDelayMs =
        raw.autoSyncOnStartup === false
          ? intervalMs
          : AUTO_SYNC_STARTUP_DELAY_MS;
      this._scheduleNextRun(firstDelayMs, intervalMs);
      this._log(
        `ConfigTransferService: Auto-sync scheduler started (firstCheckIn=${Math.round(firstDelayMs / 1000)}s, interval=${intervalMs / 60000}min)`,
        "INFO",
      );
      return this.getAutoSyncStatus();
    },

    /** 设置变化后重建调度器 */
    restartAutoSyncScheduler() {
      return this.startAutoSyncScheduler();
    },

    /** 应用退出时清理定时器 */
    stopAutoSyncScheduler() {
      this._clearAutoSyncTimers();
      this._log("ConfigTransferService: Auto-sync scheduler stopped.", "INFO");
    },
  };
}

module.exports = createAutoSyncSchedulerMethods;
