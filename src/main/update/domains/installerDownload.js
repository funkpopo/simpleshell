/** Update installer download, URL/host validation, redirects, and hashing helpers. */
function createInstallerDownloadMethods({
  fs,
  fsp,
  path,
  crypto,
  DOWNLOAD_CONNECTION_TIMEOUT,
  DOWNLOAD_DATA_TIMEOUT,
  MAX_REDIRECTS,
  TRUSTED_DOWNLOAD_HOSTS,
  logToFile,
}) {
  return {
    /**
     * 从 release 资源中提取 sha256 摘要（若存在）
     * @param {object|null} asset
     * @returns {string|null}
     */
    extractExpectedSha256(asset) {
      if (!asset || typeof asset.digest !== "string") {
        return null;
      }

      const match = asset.digest.trim().match(/^sha256:([a-fA-F0-9]{64})$/);
      return match ? match[1].toLowerCase() : null;
    },

    /**
     * 获取当前平台允许的安装包后缀
     * @returns {Set<string>}
     */
    getAllowedInstallerExtensions() {
      if (this.platform === "win32") {
        return new Set([".exe"]);
      }

      if (this.platform === "darwin") {
        return new Set([".dmg", ".zip"]);
      }

      if (this.platform === "linux") {
        return new Set([".appimage", ".deb", ".rpm"]);
      }

      return new Set();
    },

    /**
     * 仅允许官方可信下载域名
     * @param {string} hostname
     * @returns {boolean}
     */
    isTrustedDownloadHost(hostname) {
      const normalized = String(hostname || "").toLowerCase();
      if (TRUSTED_DOWNLOAD_HOSTS.has(normalized)) {
        return true;
      }
      return (
        normalized.endsWith(".github.com") ||
        normalized.endsWith(".githubusercontent.com")
      );
    },

    /**
     * 校验并标准化下载URL
     * @param {string} downloadUrl
     * @returns {string}
     */
    validateAndNormalizeDownloadUrl(downloadUrl) {
      let urlObj;
      try {
        urlObj = new URL(downloadUrl);
      } catch {
        throw new Error("Invalid update download URL");
      }

      if (urlObj.protocol !== "https:") {
        throw new Error(`Unsupported download protocol: ${urlObj.protocol}`);
      }

      if (!this.isTrustedDownloadHost(urlObj.hostname)) {
        throw new Error(`Untrusted update host: ${urlObj.hostname}`);
      }

      const fileName = path.basename(urlObj.pathname || "");
      if (!fileName) {
        throw new Error("Invalid update package file name");
      }

      const fileExt = path.extname(fileName).toLowerCase();
      const allowedExt = this.getAllowedInstallerExtensions();
      if (!allowedExt.has(fileExt)) {
        throw new Error(`Unsupported update package extension: ${fileExt}`);
      }

      return urlObj.toString();
    },

    /**
     * 生成受控目录下的安装包文件路径
     * @param {string} rawFileName
     * @returns {string}
     */
    buildInstallerPath(rawFileName) {
      const originalFileName = path.basename(String(rawFileName || ""));
      const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, "_");

      if (!safeFileName) {
        throw new Error("Invalid installer file name");
      }

      const ext = path.extname(safeFileName).toLowerCase();
      const allowedExt = this.getAllowedInstallerExtensions();
      if (!allowedExt.has(ext)) {
        throw new Error(`Installer extension not allowed: ${ext}`);
      }

      const finalFileName = `${Date.now()}-${safeFileName}`;
      const targetPath = path.resolve(this.tempDir, finalFileName);
      this.assertPathInTempDir(targetPath);
      return targetPath;
    },

    /**
     * 防止路径越界
     * @param {string} filePath
     */
    assertPathInTempDir(filePath) {
      const resolvedBase = path.resolve(this.tempDir);
      const resolvedTarget = path.resolve(filePath);
      if (
        resolvedTarget !== resolvedBase &&
        !resolvedTarget.startsWith(`${resolvedBase}${path.sep}`)
      ) {
        throw new Error("Installer path escaped controlled update directory");
      }
    },

    /**
     * 解析并校验重定向地址
     * @param {string} currentUrl
     * @param {string} locationHeader
     * @returns {string}
     */
    resolveRedirectUrl(currentUrl, locationHeader) {
      const redirectUrl = new URL(locationHeader, currentUrl).toString();
      return this.validateAndNormalizeDownloadUrl(redirectUrl);
    },

    /**
     * 下载更新文件（仅使用主进程内部确认的官方地址）
     * @param {(progressData: {downloaded: number, total: number, progress: number}) => void} onProgress
     * @returns {Promise<string>}
     */
    async downloadUpdate(onProgress) {
      if (this.isDownloading) {
        throw new Error("Download already in progress");
      }

      this.isDownloading = true;
      this.downloadCancelRequested = false;
      this.downloadProgress = 0;
      this.downloadStats = {
        downloaded: 0,
        total: 0,
        progress: 0,
        speedBytesPerSecond: 0,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.currentRequest = null;

      try {
        await this.ensureTempDir();
        const previousInstaller = await this.loadInstallerMeta();

        const asset = await this.getLatestReleaseAsset();
        const downloadUrl = this.validateAndNormalizeDownloadUrl(
          asset.downloadUrl,
        );
        const fileName =
          asset.name ||
          path.basename(new URL(downloadUrl).pathname || "update.bin");
        const filePath = this.buildInstallerPath(fileName);

        const { buffer, finalUrl } = await this.downloadFileWithRedirects(
          downloadUrl,
          onProgress,
          0,
        );
        const actualSha256 = this.calculateBufferSha256(buffer);

        if (asset.expectedSha256 && asset.expectedSha256 !== actualSha256) {
          throw new Error(
            "Downloaded update hash mismatch with release metadata",
          );
        }

        this.assertPathInTempDir(filePath);
        await fsp.writeFile(filePath, buffer);

        const installerMeta = {
          filePath,
          sha256: actualSha256,
          expectedSha256: asset.expectedSha256 || null,
          version: asset.version || null,
          downloadedAt: new Date().toISOString(),
          sourceUrl: finalUrl,
          size: buffer.length,
          assetName: asset.name || null,
          releaseName: asset.releaseName || null,
          publishedAt: asset.publishedAt || null,
          releaseUrl: asset.releaseUrl || null,
          isSecurityUpdate: asset.isSecurityUpdate === true,
          isImportantUpdate: asset.isImportantUpdate === true,
          severity: asset.severity || "normal",
          status: "downloaded",
        };

        this.lastDownloadedInstaller = installerMeta;
        await this.saveInstallerMeta(installerMeta);
        await this.clearUpdateError();
        await this.cleanupReplacedInstaller(previousInstaller, installerMeta);

        this.downloadProgress = 100;
        this.downloadStats = {
          ...this.downloadStats,
          downloaded: buffer.length,
          total: buffer.length,
          progress: 100,
          updatedAt: new Date().toISOString(),
        };
        logToFile(`Download completed: ${filePath}`, "INFO");
        return installerMeta;
      } catch (error) {
        logToFile(`Download error: ${error.message}`, "ERROR");
        await this.recordUpdateError(
          this.downloadCancelRequested ? "download-cancelled" : "download",
          error,
        );
        throw error;
      } finally {
        this.isDownloading = false;
        this.currentRequest = null;
      }
    },

    /**
     * 执行下载请求并处理重定向
     * @param {string} requestUrl
     * @param {(progressData: {downloaded: number, total: number, progress: number}) => void} onProgress
     * @param {number} redirectCount
     * @returns {Promise<{buffer: Buffer, finalUrl: string}>}
     */
    downloadFileWithRedirects(requestUrl, onProgress, redirectCount) {
      if (redirectCount > MAX_REDIRECTS) {
        return Promise.reject(
          new Error("Too many redirects during update download"),
        );
      }

      return new Promise((resolve, reject) => {
        let connectionTimer = null;
        let dataTimer = null;
        let settled = false;

        const cleanup = () => {
          if (connectionTimer) clearTimeout(connectionTimer);
          if (dataTimer) clearTimeout(dataTimer);
        };

        const handleError = (error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (this.downloadCancelRequested) {
            reject(new Error("Download cancelled"));
            return;
          }
          reject(error);
        };

        const resetDataTimer = () => {
          if (dataTimer) clearTimeout(dataTimer);
          dataTimer = setTimeout(() => {
            handleError(
              new Error("Download timeout: no data received for 60 seconds"),
            );
            if (this.currentRequest) {
              try {
                this.currentRequest.abort();
              } catch {
                // intentionally ignored
              }
            }
          }, DOWNLOAD_DATA_TIMEOUT);
        };

        const request = this.net.request({
          url: requestUrl,
          method: "GET",
          session: this.session.defaultSession,
        });
        this.currentRequest = request;
        request.setHeader("User-Agent", "SimpleShell-UpdateDownloader");

        connectionTimer = setTimeout(() => {
          handleError(
            new Error(
              "Connection timeout: unable to connect within 30 seconds",
            ),
          );
          try {
            request.abort();
          } catch {
            // intentionally ignored
          }
        }, DOWNLOAD_CONNECTION_TIMEOUT);

        request.on("response", async (response) => {
          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
          }

          if (response.statusCode >= 300 && response.statusCode < 400) {
            const redirectLocation = response.headers.location;
            if (!redirectLocation) {
              handleError(
                new Error("Redirect response missing location header"),
              );
              return;
            }

            try {
              const redirectUrl = this.resolveRedirectUrl(
                requestUrl,
                redirectLocation,
              );
              cleanup();
              const result = await this.downloadFileWithRedirects(
                redirectUrl,
                onProgress,
                redirectCount + 1,
              );
              if (!settled) {
                settled = true;
                resolve(result);
              }
            } catch (error) {
              handleError(error);
            }
            return;
          }

          if (response.statusCode !== 200) {
            handleError(
              new Error(`HTTP ${response.statusCode}: Download failed`),
            );
            return;
          }

          resetDataTimer();

          const totalSize =
            Number.parseInt(response.headers["content-length"], 10) || 0;
          let downloadedSize = 0;
          const startedAt = Date.now();
          const chunks = [];

          response.on("data", (chunk) => {
            resetDataTimer();
            chunks.push(chunk);
            downloadedSize += chunk.length;
            this.downloadProgress =
              totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;
            const elapsedSeconds = Math.max((Date.now() - startedAt) / 1000, 1);
            const progressData = {
              downloaded: downloadedSize,
              total: totalSize,
              progress: this.downloadProgress,
              speedBytesPerSecond: Math.round(downloadedSize / elapsedSeconds),
            };
            this.downloadStats = {
              ...progressData,
              startedAt:
                this.downloadStats.startedAt ||
                new Date(startedAt).toISOString(),
              updatedAt: new Date().toISOString(),
            };

            if (onProgress) {
              onProgress(progressData);
            }
          });

          response.on("end", () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve({
              buffer: Buffer.concat(chunks),
              finalUrl: requestUrl,
            });
          });

          response.on("error", (error) => {
            logToFile(`Download response error: ${error.message}`, "ERROR");
            handleError(error);
          });
        });

        request.on("error", (error) => {
          logToFile(`Download request error: ${error.message}`, "ERROR");
          handleError(error);
        });

        request.end();
      });
    },

    /**
     * 计算内存数据的 SHA-256
     * @param {Buffer} buffer
     * @returns {string}
     */
    calculateBufferSha256(buffer) {
      return crypto.createHash("sha256").update(buffer).digest("hex");
    },

    /**
     * 计算文件 SHA-256
     * @param {string} filePath
     * @returns {Promise<string>}
     */
    async calculateFileSha256(filePath) {
      return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(filePath);

        stream.on("data", (chunk) => {
          hash.update(chunk);
        });

        stream.on("error", reject);

        stream.on("end", () => {
          resolve(hash.digest("hex"));
        });
      });
    },

    /**
     * 标准化 SHA-256 字符串
     * @param {string} value
     * @returns {string|null}
     */
    normalizeSha256(value) {
      if (typeof value !== "string") {
        return null;
      }

      const normalized = value.trim().toLowerCase();
      return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
    },

    /**
     * 获取下载进度
     */
    getDownloadProgress() {
      return {
        isDownloading: this.isDownloading,
        progress: this.downloadProgress,
        ...this.downloadStats,
      };
    },

    /**
     * 取消下载
     */
    cancelDownload() {
      this.downloadCancelRequested = true;
      if (this.currentRequest) {
        try {
          this.currentRequest.abort();
        } catch (error) {
          logToFile(`Error aborting request: ${error.message}`, "WARN");
        }
        this.currentRequest = null;
      }
      this.isDownloading = false;
      this.downloadProgress = 0;
      this.downloadStats = {
        ...this.downloadStats,
        progress: 0,
        updatedAt: new Date().toISOString(),
      };
      logToFile("Download cancelled", "INFO");
    },
  };
}

module.exports = createInstallerDownloadMethods;
