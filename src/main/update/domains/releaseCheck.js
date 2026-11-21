/** Update release metadata discovery and version comparison helpers. */
function createReleaseCheckMethods({
  SECURITY_UPDATE_REGEX,
  IMPORTANT_UPDATE_REGEX,
  normalizeVersionInput,
  compareVersions,
  buildErrorResponse,
  logToFile,
}) {
  return {
    /**
     * 解析系统代理设置
     * @param {string} url - 目标URL
     * @returns {Promise<string|null>} 代理URL或null
     */
    async resolveSystemProxy(url) {
      try {
        const proxyUrl = await this.session.defaultSession.resolveProxy(url);
        logToFile(`Resolved proxy for ${url}: ${proxyUrl}`, "INFO");
        if (proxyUrl === "DIRECT") {
          return null;
        }
        const match = proxyUrl.match(/^(PROXY|SOCKS5?)\s+(.+)$/i);
        if (match) {
          const [, type, hostPort] = match;
          const protocol = type.toLowerCase().startsWith("socks")
            ? "socks5"
            : "http";
          return `${protocol}://${hostPort}`;
        }
        return null;
      } catch (error) {
        logToFile(`Failed to resolve proxy: ${error.message}`, "WARN");
        return null;
      }
    },

    /**
     * 使用 Electron net 模块发起请求（显式使用系统代理）
     * @param {string} url - 请求URL
     * @param {object} options - 请求选项
     * @returns {Promise<{response: Electron.IncomingMessage, body: Buffer}>}
     */
    async electronFetch(url, options = {}) {
      const proxyUrl = await this.resolveSystemProxy(url);

      return new Promise((resolve, reject) => {
        const requestOptions = {
          url,
          method: options.method || "GET",
          useSessionCookies: false,
        };

        if (proxyUrl) {
          requestOptions.session = this.session.defaultSession;
        }

        const request = this.net.request(requestOptions);

        if (options.headers) {
          for (const [key, value] of Object.entries(options.headers)) {
            request.setHeader(key, value);
          }
        }

        const responseData = [];

        request.on("response", (res) => {
          res.on("data", (chunk) => {
            responseData.push(chunk);
          });

          res.on("end", () => {
            const body = Buffer.concat(responseData);
            resolve({ response: res, body });
          });

          res.on("error", (error) => {
            reject(error);
          });
        });

        request.on("error", (error) => {
          logToFile(`Network request error: ${error.message}`, "ERROR");
          reject(error);
        });

        request.end();
      });
    },

    normalizeAssetSize(asset) {
      const size = Number(asset?.size);
      return Number.isFinite(size) && size > 0 ? size : 0;
    },

    getReleaseText(releaseData, asset = null) {
      return [
        releaseData?.name,
        releaseData?.tag_name,
        releaseData?.body,
        asset?.name,
      ]
        .filter((value) => typeof value === "string" && value.trim())
        .join("\n");
    },

    classifyRelease(releaseData, asset = null) {
      const text = this.getReleaseText(releaseData, asset);
      const isSecurityUpdate = SECURITY_UPDATE_REGEX.test(text);
      const isImportantUpdate =
        isSecurityUpdate || IMPORTANT_UPDATE_REGEX.test(text);

      return {
        isSecurityUpdate,
        isImportantUpdate,
        severity: isSecurityUpdate
          ? "security"
          : isImportantUpdate
            ? "important"
            : "normal",
      };
    },

    buildLatestReleaseAsset(releaseData, latestVersion, targetAsset) {
      if (!targetAsset) {
        return null;
      }

      const downloadUrl = targetAsset.browser_download_url || "";
      const expectedSha256 = this.extractExpectedSha256(targetAsset);
      const classification = this.classifyRelease(releaseData, targetAsset);

      return {
        name: targetAsset.name,
        downloadUrl,
        expectedSha256,
        version: latestVersion,
        size: this.normalizeAssetSize(targetAsset),
        publishedAt: releaseData.published_at || null,
        releaseName:
          releaseData.name || `${this.productName} v${latestVersion}`,
        releaseUrl: releaseData.html_url || null,
        ...classification,
      };
    },

    /**
     * 检查更新
     */
    async checkForUpdate() {
      try {
        logToFile("Checking for updates (using system proxy)...", "INFO");

        const { response, body } = await this.electronFetch(
          this.updateCheckUrl,
          {
            headers: {
              "User-Agent": "SimpleShell-UpdateChecker",
            },
          },
        );

        if (response.statusCode !== 200) {
          throw new Error(
            `HTTP ${response.statusCode}: ${response.statusMessage}`,
          );
        }

        const releaseData = JSON.parse(body.toString());
        const latestVersion = normalizeVersionInput(releaseData.tag_name);
        if (!latestVersion) {
          throw new Error("Release metadata is missing tag_name");
        }
        const hasUpdate =
          this.compareVersions(latestVersion, this.currentVersion) > 0;
        const targetAsset = this.getDownloadAsset(releaseData.assets);
        const latestReleaseAsset = this.buildLatestReleaseAsset(
          releaseData,
          latestVersion,
          targetAsset,
        );

        this.latestReleaseAsset =
          hasUpdate && latestReleaseAsset ? latestReleaseAsset : null;

        const updateInfo = {
          hasUpdate,
          currentVersion: this.currentVersion,
          latestVersion,
          releaseNotes: releaseData.body || "",
          downloadUrl: latestReleaseAsset?.downloadUrl || null,
          downloadSize: latestReleaseAsset?.size || 0,
          assetName: latestReleaseAsset?.name || null,
          expectedSha256: latestReleaseAsset?.expectedSha256 || null,
          publishedAt: releaseData.published_at,
          releaseName:
            releaseData.name || `${this.productName} v${latestVersion}`,
          releaseUrl: releaseData.html_url || null,
          isSecurityUpdate: latestReleaseAsset?.isSecurityUpdate === true,
          isImportantUpdate: latestReleaseAsset?.isImportantUpdate === true,
          severity: latestReleaseAsset?.severity || "normal",
        };

        logToFile(
          `Update check result: ${hasUpdate ? "Update available" : "No update"} (Current: ${this.currentVersion}, Latest: ${latestVersion})`,
          "INFO",
        );

        return { success: true, updateInfo };
      } catch (error) {
        logToFile(`Error checking for updates: ${error.message}`, "ERROR");
        return buildErrorResponse(error, {
          module: "update",
          operation: "checkForUpdate",
        });
      }
    },

    /**
     * 获取平台对应的安装包资源
     * @param {Array<{name: string, browser_download_url: string, digest?: string}>} assets
     * @returns {object|null}
     */
    getDownloadAsset(assets) {
      if (!Array.isArray(assets)) return null;

      const normalizedAssets = assets.filter(
        (asset) =>
          asset &&
          typeof asset.name === "string" &&
          typeof asset.browser_download_url === "string",
      );
      const findByExtension = (...extensions) =>
        normalizedAssets.find((asset) => {
          const name = asset.name.toLowerCase();
          return extensions.some((extension) => name.endsWith(extension));
        }) || null;

      const platform = this.platform;

      if (platform === "win32") {
        return (
          normalizedAssets.find((asset) => /setup.*\.exe$/i.test(asset.name)) ||
          findByExtension(".exe")
        );
      }

      if (platform === "darwin") {
        return findByExtension(".dmg", ".zip");
      }

      if (platform === "linux") {
        return findByExtension(".appimage", ".deb", ".rpm");
      }

      return null;
    },

    /**
     * 获取当前可下载的 release asset
     * @returns {Promise<{name: string, downloadUrl: string, expectedSha256: string|null}>}
     */
    async getLatestReleaseAsset() {
      if (this.latestReleaseAsset?.downloadUrl) {
        return this.latestReleaseAsset;
      }

      const checkResult = await this.checkForUpdate();
      if (!checkResult.success) {
        throw new Error(
          checkResult.error || "Failed to refresh update metadata",
        );
      }

      if (!checkResult.updateInfo?.hasUpdate) {
        throw new Error("Application is already up to date");
      }

      if (!this.latestReleaseAsset?.downloadUrl) {
        throw new Error("No update package found for current platform");
      }

      return this.latestReleaseAsset;
    },

    /**
     * 版本比较
     */
    compareVersions(version1, version2) {
      return compareVersions(version1, version2);
    },
  };
}

module.exports = createReleaseCheckMethods;
