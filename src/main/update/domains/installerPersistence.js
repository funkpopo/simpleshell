/** Update installer artifact metadata, temp directory lifecycle, and verification helpers. */
function createInstallerPersistenceMethods({
  fsp,
  path,
  extractVersionFromText,
  buildErrorResponse,
  logToFile,
}) {
  return {
    /**
     * 确保临时目录存在
     */
    async ensureTempDir() {
      try {
        await fsp.access(this.tempDir);
      } catch {
        await fsp.mkdir(this.tempDir, { recursive: true });
        logToFile(`Created update directory: ${this.tempDir}`, "INFO");
      }
    },

    /**
     * 判断文件是否为更新安装包工件
     * @param {string} fileName
     * @returns {boolean}
     */
    isInstallerArtifactFile(fileName) {
      const normalizedFileName = path.basename(String(fileName || ""));
      if (!normalizedFileName) {
        return false;
      }

      const controlledFiles = new Set([
        path.basename(this.installerMetaPath),
        path.basename(this.updateErrorPath),
        path.basename(this.installerLogPath),
        path.basename(this.legacyInstallerScriptPath),
      ]);

      if (controlledFiles.has(normalizedFileName)) {
        return true;
      }

      const fileExt = path.extname(normalizedFileName).toLowerCase();
      return this.getAllowedInstallerExtensions().has(fileExt);
    },

    /**
     * 清空更新目录中的安装包与元数据
     */
    async clearInstallerTempDir() {
      try {
        await this.ensureTempDir();
        this.lastDownloadedInstaller = null;

        const entries = await fsp.readdir(this.tempDir, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (!entry.isFile()) {
            continue;
          }

          if (!this.isInstallerArtifactFile(entry.name)) {
            continue;
          }

          const filePath = path.join(this.tempDir, entry.name);
          this.assertPathInTempDir(filePath);
          await fsp.unlink(filePath);
          logToFile(`Cleared update artifact: ${entry.name}`, "INFO");
        }
      } catch (error) {
        logToFile(`Error cleaning update directory: ${error.message}`, "WARN");
      }
    },

    /**
     * 持久化下载后的安装包元数据
     * @param {object} meta
     */
    async saveInstallerMeta(meta) {
      await this.ensureTempDir();
      await fsp.writeFile(
        this.installerMetaPath,
        JSON.stringify(meta, null, 2),
        "utf8",
      );
    },

    async saveInstallerStatus(status, extra = {}) {
      const meta = await this.loadInstallerMeta();
      if (!meta) {
        return null;
      }

      const nextMeta = {
        ...meta,
        ...extra,
        status,
        updatedAt: new Date().toISOString(),
      };
      this.lastDownloadedInstaller = nextMeta;
      await this.saveInstallerMeta(nextMeta);
      return nextMeta;
    },

    async cleanupReplacedInstaller(previousMeta, nextMeta) {
      if (!previousMeta?.filePath || !nextMeta?.filePath) {
        return;
      }

      const previousPath = path.resolve(previousMeta.filePath);
      const nextPath = path.resolve(nextMeta.filePath);
      if (previousPath === nextPath) {
        return;
      }

      try {
        this.assertPathInTempDir(previousPath);
        await this.cleanupInstallerFile(previousPath);
      } catch (error) {
        logToFile(
          `Failed to cleanup replaced update package: ${error.message}`,
          "WARN",
        );
      }
    },

    async recordUpdateError(stage, error, extra = {}) {
      const message = error?.message || String(error || "Unknown update error");
      const classified = buildErrorResponse(error, {
        module: "update",
        operation: stage,
        retryable:
          stage === "download" ||
          stage === "download-cancelled" ||
          stage === "install",
      });
      const payload = {
        stage,
        message,
        technicalMessage: classified.technicalMessage || message,
        errorCode: classified.errorCode,
        code: classified.code,
        errorKind: classified.errorKind,
        errorCategory: classified.errorCategory,
        errorAction: classified.errorAction,
        errorSeverity: classified.errorSeverity,
        errorClassification: classified.errorClassification,
        retryable: classified.retryable,
        reportable: classified.reportable,
        userRecoverable: classified.userRecoverable,
        fatal: classified.fatal,
        stack: error?.stack || null,
        currentVersion: this.currentVersion,
        timestamp: new Date().toISOString(),
        installerLogPath: this.installerLogPath,
        ...extra,
      };

      this.lastUpdateError = payload;

      try {
        await this.ensureTempDir();
        await fsp.writeFile(
          this.updateErrorPath,
          `${JSON.stringify(payload, null, 2)}\n`,
          "utf8",
        );
      } catch (writeError) {
        logToFile(
          `Failed to persist update error metadata: ${writeError.message}`,
          "WARN",
        );
      }

      return payload;
    },

    async clearUpdateError() {
      this.lastUpdateError = null;

      try {
        await fsp.unlink(this.updateErrorPath);
      } catch (error) {
        if (error?.code !== "ENOENT") {
          logToFile(`Failed to clear update error: ${error.message}`, "WARN");
        }
      }
    },

    async loadUpdateError() {
      if (this.lastUpdateError) {
        return this.lastUpdateError;
      }

      try {
        const raw = await fsp.readFile(this.updateErrorPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.message !== "string") {
          return null;
        }
        this.lastUpdateError = parsed;
        return parsed;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          logToFile(
            `Failed to load installer metadata: ${error.message}`,
            "WARN",
          );
        }
        return null;
      }
    },

    async appendInstallerLog(message) {
      try {
        await this.ensureTempDir();
        const timestamp = new Date().toISOString();
        await fsp.appendFile(
          this.installerLogPath,
          `[${timestamp}] ${message}\n`,
          "utf8",
        );
      } catch (error) {
        logToFile(`Failed to append installer log: ${error.message}`, "WARN");
      }
    },

    /**
     * 读取最近一次下载的安装包元数据
     * @returns {Promise<object|null>}
     */
    async loadInstallerMeta() {
      if (this.lastDownloadedInstaller) {
        return this.lastDownloadedInstaller;
      }

      try {
        const raw = await fsp.readFile(this.installerMetaPath, "utf8");
        const meta = JSON.parse(raw);

        if (
          !meta ||
          typeof meta.filePath !== "string" ||
          typeof meta.sha256 !== "string"
        ) {
          return null;
        }

        const normalizedSha256 = this.normalizeSha256(meta.sha256);
        if (!normalizedSha256) {
          return null;
        }

        meta.sha256 = normalizedSha256;
        if (typeof meta.expectedSha256 === "string") {
          const normalizedExpectedSha256 = this.normalizeSha256(
            meta.expectedSha256,
          );
          if (!normalizedExpectedSha256) {
            return null;
          }
          meta.expectedSha256 = normalizedExpectedSha256;
        }

        this.assertPathInTempDir(meta.filePath);
        this.lastDownloadedInstaller = meta;
        return meta;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          logToFile(
            `Failed to load installer metadata: ${error.message}`,
            "WARN",
          );
        }
        return null;
      }
    },

    /**
     * 从文本中提取语义化版本号
     * @param {string} value
     * @returns {string|null}
     */
    extractVersionFromText(value) {
      return extractVersionFromText(value);
    },

    /**
     * 解析安装包目标版本（优先元数据）
     * @param {object|null} meta
     * @param {string} filePath
     * @returns {string|null}
     */
    resolveInstallerVersion(meta, filePath = "") {
      const candidates = [];

      if (meta?.version) {
        candidates.push(meta.version);
      }

      if (meta?.sourceUrl) {
        try {
          const sourceFileName = path.basename(
            new URL(meta.sourceUrl).pathname,
          );
          candidates.push(sourceFileName);
        } catch {
          // ignore invalid URL
        }
      }

      if (meta?.filePath) {
        candidates.push(path.basename(meta.filePath));
      }

      if (filePath) {
        candidates.push(path.basename(filePath));
      }

      for (const candidate of candidates) {
        const version = this.extractVersionFromText(candidate);
        if (version) {
          return version;
        }
      }

      return null;
    },

    /**
     * 删除安装包元数据
     */
    async cleanupInstallerMetaFile() {
      this.lastDownloadedInstaller = null;

      try {
        await fsp.unlink(this.installerMetaPath);
        logToFile(
          `Cleaned up installer meta: ${this.installerMetaPath}`,
          "INFO",
        );
      } catch (error) {
        if (error?.code !== "ENOENT") {
          logToFile(
            `Failed to cleanup installer meta: ${error.message}`,
            "WARN",
          );
        }
      }
    },

    /**
     * 删除安装包及其元数据
     * @param {string} filePath
     */
    async cleanupInstallerArtifacts(filePath) {
      await this.cleanupInstallerFile(filePath);
      await this.cleanupInstallerMetaFile();
      await this.clearUpdateError();
      await this.cleanupInstallerRuntimeFiles();
    },

    async cleanupInstallerRuntimeFiles() {
      const runtimeFiles = [
        this.legacyInstallerScriptPath,
        this.installerLogPath,
      ];

      for (const runtimeFile of runtimeFiles) {
        try {
          this.assertPathInTempDir(runtimeFile);
          await fsp.unlink(runtimeFile);
          logToFile(`Cleaned up update runtime file: ${runtimeFile}`, "INFO");
        } catch (error) {
          if (error?.code !== "ENOENT") {
            logToFile(
              `Failed to cleanup update runtime file: ${error.message}`,
              "WARN",
            );
          }
        }
      }
    },

    /**
     * 校验已下载的安装包是否仍然可安装
     * @param {{cleanupInvalidArtifacts?: boolean, requireNewerThanCurrent?: boolean}} options
     * @returns {Promise<{meta: object, filePath: string, fileExt: string, installerVersion: string, actualSha256: string}>}
     */
    async assertDownloadedInstallerReady(options = {}) {
      const {
        cleanupInvalidArtifacts = false,
        requireNewerThanCurrent = true,
      } = options;
      const meta = await this.loadInstallerMeta();
      if (!meta) {
        throw new Error("No downloaded update package available");
      }

      let filePath = "";
      const cleanupInvalid = async (message, cleanupFile = true) => {
        if (cleanupInvalidArtifacts) {
          if (cleanupFile && filePath) {
            await this.cleanupInstallerArtifacts(filePath);
          } else {
            await this.cleanupInstallerMetaFile();
          }
        }

        throw new Error(message);
      };

      try {
        filePath = path.resolve(meta.filePath);
        this.assertPathInTempDir(filePath);
      } catch {
        await cleanupInvalid("Installer metadata path is invalid", false);
      }

      try {
        await fsp.access(filePath);
      } catch {
        await cleanupInvalid("Downloaded installer file is missing", false);
      }

      const fileExt = path.extname(filePath).toLowerCase();
      const allowedExt = this.getAllowedInstallerExtensions();
      if (!allowedExt.has(fileExt)) {
        await cleanupInvalid(`Unsupported installer format: ${fileExt}`);
      }

      const metaSha256 = this.normalizeSha256(meta.sha256);
      if (!metaSha256) {
        await cleanupInvalid("Installer hash metadata is invalid");
      }

      let actualSha256;
      try {
        actualSha256 = await this.calculateFileSha256(filePath);
      } catch (error) {
        await cleanupInvalid(
          `Unable to read downloaded installer: ${error.message}`,
          false,
        );
      }

      if (metaSha256 !== actualSha256) {
        await cleanupInvalid("Installer hash verification failed");
      }

      if (meta.expectedSha256 && meta.expectedSha256 !== actualSha256) {
        await cleanupInvalid(
          "Installer hash does not match expected release hash",
        );
      }

      const installerVersion = this.resolveInstallerVersion(meta, filePath);
      if (!installerVersion) {
        await cleanupInvalid("Installer version metadata is missing");
      }

      if (
        requireNewerThanCurrent &&
        this.compareVersions(installerVersion, this.currentVersion) <= 0
      ) {
        await cleanupInvalid(
          `Installer version ${installerVersion} is not newer than current version ${this.currentVersion}`,
        );
      }

      return { meta, filePath, fileExt, installerVersion, actualSha256 };
    },

    /**
     * 若当前版本已不低于安装包目标版本，自动清理遗留安装包
     */
    async cleanupConsumedInstaller() {
      try {
        const { filePath, installerVersion } =
          await this.assertDownloadedInstallerReady({
            cleanupInvalidArtifacts: true,
            requireNewerThanCurrent: false,
          });

        if (this.compareVersions(installerVersion, this.currentVersion) <= 0) {
          logToFile(
            `Current version (${this.currentVersion}) already reached installer version (${installerVersion}), cleaning installer`,
            "INFO",
          );
          await this.cleanupInstallerArtifacts(filePath);
        }
      } catch (error) {
        if (error?.message === "No downloaded update package available") {
          return;
        }

        logToFile(
          `Failed to cleanup consumed installer: ${error.message}`,
          "WARN",
        );
      }
    },

    /**
     * 检查是否有已下载的安装包可供安装
     * @returns {Promise<{available: boolean}>}
     */
    async hasDownloadedInstaller() {
      const lastError = await this.loadUpdateError();

      try {
        const { meta, installerVersion, filePath, actualSha256 } =
          await this.assertDownloadedInstallerReady({
            cleanupInvalidArtifacts: true,
          });

        return {
          available: true,
          installerVersion,
          currentVersion: this.currentVersion,
          fileName: path.basename(filePath),
          size: meta.size || 0,
          sha256: actualSha256,
          expectedSha256: meta.expectedSha256 || null,
          downloadedAt: meta.downloadedAt || null,
          publishedAt: meta.publishedAt || null,
          releaseName: meta.releaseName || null,
          assetName: meta.assetName || null,
          isSecurityUpdate: meta.isSecurityUpdate === true,
          isImportantUpdate: meta.isImportantUpdate === true,
          severity: meta.severity || "normal",
          status: meta.status || "downloaded",
          installerLogPath: meta.installerLogPath || this.installerLogPath,
          lastError,
        };
      } catch (error) {
        const classified = buildErrorResponse(error, {
          module: "update",
          operation: "hasDownloadedInstaller",
        });
        return {
          available: false,
          currentVersion: this.currentVersion,
          lastError,
          error: classified.error,
          message: classified.message,
          technicalMessage: classified.technicalMessage,
          errorCode: classified.errorCode,
          code: classified.code,
          errorKind: classified.errorKind,
          errorCategory: classified.errorCategory,
          errorAction: classified.errorAction,
          errorSeverity: classified.errorSeverity,
          errorClassification: classified.errorClassification,
          retryable: classified.retryable,
          reportable: classified.reportable,
          userRecoverable: classified.userRecoverable,
          fatal: classified.fatal,
        };
      }
    },

    getDiagnosticsSnapshot() {
      return {
        tempDir: this.tempDir,
        currentVersion: this.currentVersion,
        updateCheckUrl: this.updateCheckUrl,
        isDownloading: this.isDownloading,
        downloadProgress: this.downloadProgress,
        downloadStats: this.downloadStats,
        lastUpdateError: this.lastUpdateError,
        updateErrorPath: this.updateErrorPath,
        installerLogPath: this.installerLogPath,
        latestReleaseAsset: this.latestReleaseAsset
          ? {
              name: this.latestReleaseAsset.name,
              expectedSha256: this.latestReleaseAsset.expectedSha256,
              version: this.latestReleaseAsset.version,
              size: this.latestReleaseAsset.size,
              publishedAt: this.latestReleaseAsset.publishedAt,
              releaseName: this.latestReleaseAsset.releaseName,
              severity: this.latestReleaseAsset.severity,
              host: this.latestReleaseAsset.downloadUrl
                ? new URL(this.latestReleaseAsset.downloadUrl).hostname
                : null,
            }
          : null,
        lastDownloadedInstaller: this.lastDownloadedInstaller
          ? {
              sha256: this.lastDownloadedInstaller.sha256,
              expectedSha256: this.lastDownloadedInstaller.expectedSha256,
              version: this.lastDownloadedInstaller.version,
              downloadedAt: this.lastDownloadedInstaller.downloadedAt,
              status: this.lastDownloadedInstaller.status,
              installerLogPath: this.lastDownloadedInstaller.installerLogPath,
            }
          : null,
      };
    },
  };
}

module.exports = createInstallerPersistenceMethods;
