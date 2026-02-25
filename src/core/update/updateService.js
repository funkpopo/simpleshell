const { app, dialog, shell, net, session } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { logToFile } = require("../utils/logger");

const UPDATE_TEMP_RETENTION_MS = 24 * 60 * 60 * 1000;
const DOWNLOAD_CONNECTION_TIMEOUT = 30000;
const DOWNLOAD_DATA_TIMEOUT = 60000;
const MAX_REDIRECTS = 5;
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const VERSION_TOKEN_REGEX = /v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/i;

class UpdateService {
  constructor() {
    this.tempDir = path.join(app.getPath("userData"), "updates");
    this.installerMetaPath = path.join(
      this.tempDir,
      "latest-installer-meta.json",
    );
    this.currentVersion = app.getVersion();
    this.updateCheckUrl =
      "https://api.github.com/repos/funkpopo/simpleshell/releases/latest";
    this.isDownloading = false;
    this.downloadProgress = 0;
    this.currentRequest = null;
    this.latestReleaseAsset = null;
    this.lastDownloadedInstaller = null;

    // 启动时清理“已安装版本”的遗留安装包，避免关于页反复显示“立即安装”
    void this.cleanupConsumedInstaller();
  }

  /**
   * 解析系统代理设置
   * @param {string} url - 目标URL
   * @returns {Promise<string|null>} 代理URL或null
   */
  async resolveSystemProxy(url) {
    try {
      const proxyUrl = await session.defaultSession.resolveProxy(url);
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
  }

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
        requestOptions.session = session.defaultSession;
      }

      const request = net.request(requestOptions);

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
  }

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
  }

  /**
   * 清理临时目录中的旧文件
   */
  async cleanupTempDir() {
    try {
      const entries = await fsp.readdir(this.tempDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        if (entry.name === path.basename(this.installerMetaPath)) {
          continue;
        }

        const filePath = path.join(this.tempDir, entry.name);
        const stats = await fsp.stat(filePath);
        if (Date.now() - stats.mtime.getTime() > UPDATE_TEMP_RETENTION_MS) {
          await fsp.unlink(filePath);
          logToFile(`Cleaned up old update file: ${entry.name}`, "INFO");
        }
      }
    } catch (error) {
      logToFile(`Error cleaning update directory: ${error.message}`, "WARN");
    }
  }

  /**
   * 检查更新
   */
  async checkForUpdate() {
    try {
      logToFile("Checking for updates (using system proxy)...", "INFO");

      const { response, body } = await this.electronFetch(this.updateCheckUrl, {
        headers: {
          "User-Agent": "SimpleShell-UpdateChecker",
        },
      });

      if (response.statusCode !== 200) {
        throw new Error(
          `HTTP ${response.statusCode}: ${response.statusMessage}`,
        );
      }

      const releaseData = JSON.parse(body.toString());
      const latestVersion = releaseData.tag_name.replace(/^v/, "");
      const hasUpdate =
        this.compareVersions(latestVersion, this.currentVersion) > 0;
      const targetAsset = this.getDownloadAsset(releaseData.assets);
      const downloadUrl = targetAsset ? targetAsset.browser_download_url : null;
      const expectedSha256 = this.extractExpectedSha256(targetAsset);

      this.latestReleaseAsset = targetAsset
        ? {
            name: targetAsset.name,
            downloadUrl,
            expectedSha256,
            version: latestVersion,
          }
        : null;

      const updateInfo = {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion,
        releaseNotes: releaseData.body || "",
        downloadUrl,
        publishedAt: releaseData.published_at,
        releaseName: releaseData.name || `Version ${latestVersion}`,
      };

      logToFile(
        `Update check result: ${hasUpdate ? "Update available" : "No update"} (Current: ${this.currentVersion}, Latest: ${latestVersion})`,
        "INFO",
      );

      return { success: true, updateInfo };
    } catch (error) {
      logToFile(`Error checking for updates: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  /**
   * 获取平台对应的安装包资源
   * @param {Array<{name: string, browser_download_url: string, digest?: string}>} assets
   * @returns {object|null}
   */
  getDownloadAsset(assets) {
    if (!Array.isArray(assets)) return null;

    const platform = process.platform;

    if (platform === "win32") {
      return (
        assets.find((asset) => asset.name.toLowerCase().endsWith(".exe")) ||
        null
      );
    }

    if (platform === "darwin") {
      return (
        assets.find((asset) => asset.name.toLowerCase().endsWith(".dmg")) ||
        null
      );
    }

    if (platform === "linux") {
      return (
        assets.find((asset) =>
          asset.name.toLowerCase().endsWith(".appimage"),
        ) ||
        assets.find((asset) => asset.name.toLowerCase().endsWith(".deb")) ||
        null
      );
    }

    return null;
  }

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
  }

  /**
   * 获取当前平台允许的安装包后缀
   * @returns {Set<string>}
   */
  getAllowedInstallerExtensions() {
    if (process.platform === "win32") {
      return new Set([".exe"]);
    }

    if (process.platform === "darwin") {
      return new Set([".dmg"]);
    }

    if (process.platform === "linux") {
      return new Set([".appimage", ".deb"]);
    }

    return new Set();
  }

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
  }

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
  }

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
  }

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
  }

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
      throw new Error(checkResult.error || "Failed to refresh update metadata");
    }

    if (!this.latestReleaseAsset?.downloadUrl) {
      throw new Error("No update package found for current platform");
    }

    return this.latestReleaseAsset;
  }

  /**
   * 解析并校验重定向地址
   * @param {string} currentUrl
   * @param {string} locationHeader
   * @returns {string}
   */
  resolveRedirectUrl(currentUrl, locationHeader) {
    const redirectUrl = new URL(locationHeader, currentUrl).toString();
    return this.validateAndNormalizeDownloadUrl(redirectUrl);
  }

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
    this.downloadProgress = 0;
    this.currentRequest = null;

    try {
      await this.ensureTempDir();
      await this.cleanupTempDir();

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
      };

      this.lastDownloadedInstaller = installerMeta;
      await this.saveInstallerMeta(installerMeta);

      this.downloadProgress = 100;
      logToFile(`Download completed: ${filePath}`, "INFO");
      return filePath;
    } catch (error) {
      logToFile(`Download error: ${error.message}`, "ERROR");
      throw error;
    } finally {
      this.isDownloading = false;
      this.currentRequest = null;
    }
  }

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

      const request = net.request({
        url: requestUrl,
        method: "GET",
        session: session.defaultSession,
      });
      this.currentRequest = request;
      request.setHeader("User-Agent", "SimpleShell-UpdateDownloader");

      connectionTimer = setTimeout(() => {
        handleError(
          new Error("Connection timeout: unable to connect within 30 seconds"),
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
            handleError(new Error("Redirect response missing location header"));
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
        const chunks = [];

        response.on("data", (chunk) => {
          resetDataTimer();
          chunks.push(chunk);
          downloadedSize += chunk.length;
          this.downloadProgress =
            totalSize > 0 ? (downloadedSize / totalSize) * 100 : 0;

          if (onProgress) {
            onProgress({
              downloaded: downloadedSize,
              total: totalSize,
              progress: this.downloadProgress,
            });
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
  }

  /**
   * 计算内存数据的 SHA-256
   * @param {Buffer} buffer
   * @returns {string}
   */
  calculateBufferSha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
  }

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
  }

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
  }

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

      this.assertPathInTempDir(meta.filePath);
      this.lastDownloadedInstaller = meta;
      return meta;
    } catch {
      return null;
    }
  }

  /**
   * 从文本中提取语义化版本号
   * @param {string} value
   * @returns {string|null}
   */
  extractVersionFromText(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const match = value.trim().match(VERSION_TOKEN_REGEX);
    return match ? match[1] : null;
  }

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
        const sourceFileName = path.basename(new URL(meta.sourceUrl).pathname);
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
  }

  /**
   * 删除安装包元数据
   */
  async cleanupInstallerMetaFile() {
    this.lastDownloadedInstaller = null;

    try {
      await fsp.unlink(this.installerMetaPath);
      logToFile(`Cleaned up installer meta: ${this.installerMetaPath}`, "INFO");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logToFile(`Failed to cleanup installer meta: ${error.message}`, "WARN");
      }
    }
  }

  /**
   * 删除安装包及其元数据
   * @param {string} filePath
   */
  async cleanupInstallerArtifacts(filePath) {
    await this.cleanupInstallerFile(filePath);
    await this.cleanupInstallerMetaFile();
  }

  /**
   * 若当前版本已不低于安装包目标版本，自动清理遗留安装包
   */
  async cleanupConsumedInstaller() {
    try {
      const meta = await this.loadInstallerMeta();
      if (!meta) {
        return;
      }

      const filePath = path.resolve(meta.filePath);
      this.assertPathInTempDir(filePath);
      try {
        await fsp.access(filePath);
      } catch {
        await this.cleanupInstallerMetaFile();
        return;
      }

      const installerVersion = this.resolveInstallerVersion(meta, filePath);
      if (!installerVersion) {
        logToFile(
          "Installer version metadata missing, cleaning stale installer artifact",
          "WARN",
        );
        await this.cleanupInstallerArtifacts(filePath);
        return;
      }

      if (this.compareVersions(installerVersion, this.currentVersion) <= 0) {
        logToFile(
          `Current version (${this.currentVersion}) already reached installer version (${installerVersion}), cleaning installer`,
          "INFO",
        );
        await this.cleanupInstallerArtifacts(filePath);
      }
    } catch (error) {
      logToFile(`Failed to cleanup consumed installer: ${error.message}`, "WARN");
    }
  }

  /**
   * 安装前执行路径与哈希校验
   * @returns {Promise<{filePath: string, fileExt: string, installerVersion: string}>}
   */
  async verifyInstallerBeforeInstall() {
    const meta = await this.loadInstallerMeta();
    if (!meta) {
      throw new Error("No downloaded update package available");
    }

    const filePath = path.resolve(meta.filePath);
    this.assertPathInTempDir(filePath);
    await fsp.access(filePath);

    const fileExt = path.extname(filePath).toLowerCase();
    const allowedExt = this.getAllowedInstallerExtensions();
    if (!allowedExt.has(fileExt)) {
      throw new Error(`Unsupported installer format: ${fileExt}`);
    }

    const actualSha256 = await this.calculateFileSha256(filePath);
    if (meta.sha256 !== actualSha256) {
      throw new Error("Installer hash verification failed before execution");
    }

    if (meta.expectedSha256 && meta.expectedSha256 !== actualSha256) {
      throw new Error("Installer hash does not match expected release hash");
    }

    const installerVersion = this.resolveInstallerVersion(meta, filePath);
    if (!installerVersion) {
      throw new Error("Installer version metadata is missing");
    }

    if (this.compareVersions(installerVersion, this.currentVersion) <= 0) {
      throw new Error(
        `Installer version ${installerVersion} is not newer than current version ${this.currentVersion}`,
      );
    }

    return { filePath, fileExt, installerVersion };
  }

  /**
   * 安装更新
   */
  async installUpdate() {
    try {
      const { filePath, fileExt, installerVersion } =
        await this.verifyInstallerBeforeInstall();
      logToFile(`Installing update from trusted file: ${filePath}`, "INFO");

      const platform = process.platform;
      if (platform === "win32" && fileExt === ".exe") {
        await this.installWindowsUpdate(filePath);
      } else if (platform === "darwin" && fileExt === ".dmg") {
        await this.installMacUpdate(filePath);
      } else if (
        platform === "linux" &&
        (fileExt === ".appimage" || fileExt === ".deb")
      ) {
        await this.installLinuxUpdate(filePath);
      } else {
        throw new Error(
          `Unsupported installer format: ${fileExt} on ${platform}`,
        );
      }

      logToFile(
        `Update installer launched for version ${installerVersion}`,
        "INFO",
      );

      return { success: true };
    } catch (error) {
      logToFile(`Installation error: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  /**
   * Windows更新安装
   */
  async installWindowsUpdate(filePath) {
    return new Promise((resolve, reject) => {
      logToFile(`Starting Windows installer: ${filePath}`, "INFO");

      const installer = spawn(filePath, ["/S"], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });

      installer.on("error", (error) => {
        logToFile(`Windows installer spawn error: ${error.message}`, "ERROR");
        reject(error);
      });

      installer.unref();
      logToFile(
        "Windows installer started, preparing to quit application",
        "INFO",
      );
      resolve();

      setTimeout(() => {
        logToFile("Force exiting application for update installation", "INFO");
        app.exit(0);
      }, 500);
    });
  }

  /**
   * 清理安装包文件
   */
  async cleanupInstallerFile(filePath) {
    try {
      this.assertPathInTempDir(filePath);
      await fsp.unlink(filePath);
      logToFile(`Cleaned up installer file: ${filePath}`, "INFO");
    } catch (error) {
      if (error?.code !== "ENOENT") {
        logToFile(`Failed to cleanup installer file: ${error.message}`, "WARN");
      }
    }
  }

  /**
   * macOS更新安装
   */
  async installMacUpdate(filePath) {
    return new Promise((resolve, reject) => {
      execFile("open", [filePath], (error) => {
        if (error) {
          logToFile(`macOS installer error: ${error.message}`, "ERROR");
          reject(error);
        } else {
          logToFile("macOS DMG opened successfully", "INFO");
          resolve();
          dialog.showMessageBox({
            type: "info",
            title: "Update Ready",
            message:
              "The update package has been opened. Please drag the app to Applications folder to complete the update.",
            buttons: ["OK"],
          });
        }
      });
    });
  }

  /**
   * Linux更新安装
   */
  async installLinuxUpdate(filePath) {
    const fileExt = path.extname(filePath).toLowerCase();

    if (fileExt === ".appimage") {
      shell.showItemInFolder(filePath);
      dialog.showMessageBox({
        type: "info",
        title: "Update Ready",
        message:
          "The update has been downloaded. Please replace your current application with the new AppImage file.",
        buttons: ["OK"],
      });
      return;
    }

    if (fileExt === ".deb") {
      await new Promise((resolve, reject) => {
        const installer = spawn("pkexec", ["dpkg", "-i", filePath], {
          stdio: "ignore",
        });

        installer.on("error", (error) => {
          logToFile(`DEB installer error: ${error.message}`, "ERROR");
          reject(error);
        });

        installer.on("close", (code) => {
          if (code === 0) {
            logToFile("DEB package installed successfully", "INFO");
            resolve();
          } else {
            reject(new Error(`DEB installer exited with code ${code}`));
          }
        });
      });
    }
  }

  /**
   * 版本比较
   */
  compareVersions(version1, version2) {
    const v1Parts = version1.split(".").map((n) => Number.parseInt(n, 10));
    const v2Parts = version2.split(".").map((n) => Number.parseInt(n, 10));

    const maxLength = Math.max(v1Parts.length, v2Parts.length);
    for (let i = 0; i < maxLength; i += 1) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part > v2Part) return 1;
      if (v1Part < v2Part) return -1;
    }

    return 0;
  }

  /**
   * 检查是否有已下载的安装包可供安装
   * @returns {Promise<{available: boolean}>}
   */
  async hasDownloadedInstaller() {
    try {
      const meta = await this.loadInstallerMeta();
      if (!meta) {
        return { available: false };
      }

      const filePath = path.resolve(meta.filePath);
      this.assertPathInTempDir(filePath);

      try {
        await fsp.access(filePath);
      } catch {
        await this.cleanupInstallerMetaFile();
        return { available: false };
      }

      const installerVersion = this.resolveInstallerVersion(meta, filePath);
      if (!installerVersion) {
        await this.cleanupInstallerArtifacts(filePath);
        return { available: false };
      }

      if (this.compareVersions(installerVersion, this.currentVersion) <= 0) {
        await this.cleanupInstallerArtifacts(filePath);
        return { available: false };
      }

      return {
        available: true,
        installerVersion,
        currentVersion: this.currentVersion,
      };
    } catch {
      return { available: false };
    }
  }

  /**
   * 获取下载进度
   */
  getDownloadProgress() {
    return {
      isDownloading: this.isDownloading,
      progress: this.downloadProgress,
    };
  }

  /**
   * 取消下载
   */
  cancelDownload() {
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
    logToFile("Download cancelled", "INFO");
  }
}

module.exports = new UpdateService();
