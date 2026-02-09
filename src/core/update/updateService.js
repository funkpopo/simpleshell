const { app, dialog, shell, net, session } = require("electron");
const fs = require("fs").promises;
const path = require("path");
const { spawn, exec } = require("child_process");
const { logToFile } = require("../utils/logger");

class UpdateService {
  constructor() {
    // 使用程序运行目录下的 temp 文件夹
    const appPath = app.isPackaged
      ? path.dirname(app.getPath("exe"))
      : app.getAppPath();
    this.tempDir = path.join(appPath, "temp");
    this.currentVersion = app.getVersion();
    this.updateCheckUrl =
      "https://api.github.com/repos/funkpopo/simpleshell/releases/latest";
    this.isDownloading = false;
    this.downloadProgress = 0;
    this.abortController = null;
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
      // proxyUrl格式: "DIRECT" 或 "PROXY host:port" 或 "SOCKS5 host:port"
      if (proxyUrl === "DIRECT") {
        return null;
      }
      const match = proxyUrl.match(/^(PROXY|SOCKS5?)\s+(.+)$/i);
      if (match) {
        const [, type, hostPort] = match;
        const protocol = type.toLowerCase().startsWith("socks") ? "socks5" : "http";
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
    // 先解析系统代理
    const proxyUrl = await this.resolveSystemProxy(url);

    return new Promise((resolve, reject) => {
      const requestOptions = {
        url,
        method: options.method || "GET",
        useSessionCookies: false,
      };

      // 如果有代理，使用partition来设置代理
      if (proxyUrl) {
        requestOptions.session = session.defaultSession;
      }

      const request = net.request(requestOptions);

      // 设置请求头
      if (options.headers) {
        for (const [key, value] of Object.entries(options.headers)) {
          request.setHeader(key, value);
        }
      }

      let responseData = [];

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
      await fs.access(this.tempDir);
    } catch {
      await fs.mkdir(this.tempDir, { recursive: true });
      logToFile(`Created temp directory: ${this.tempDir}`, "INFO");
    }
  }

  /**
   * 清理临时目录中的旧文件
   */
  async cleanupTempDir() {
    try {
      const files = await fs.readdir(this.tempDir);
      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stats = await fs.stat(filePath);
        // 删除超过24小时的文件
        if (Date.now() - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
          await fs.unlink(filePath);
          logToFile(`Cleaned up old update file: ${file}`, "INFO");
        }
      }
    } catch (error) {
      logToFile(`Error cleaning temp directory: ${error.message}`, "WARN");
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
        throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
      }

      const releaseData = JSON.parse(body.toString());
      const latestVersion = releaseData.tag_name.replace(/^v/, "");

      const hasUpdate =
        this.compareVersions(latestVersion, this.currentVersion) > 0;

      const updateInfo = {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion,
        releaseNotes: releaseData.body || "",
        downloadUrl: this.getDownloadUrl(releaseData.assets),
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
   * 获取下载URL
   */
  getDownloadUrl(assets) {
    if (!Array.isArray(assets)) return null;

    const platform = process.platform;
    let targetAsset = null;

    if (platform === "win32") {
      targetAsset = assets.find(
        (asset) =>
          asset.name.endsWith(".exe") ||
          asset.name.includes("win") ||
          asset.name.includes("windows"),
      );
    } else if (platform === "darwin") {
      targetAsset = assets.find(
        (asset) =>
          asset.name.endsWith(".dmg") ||
          asset.name.includes("mac") ||
          asset.name.includes("darwin"),
      );
    } else if (platform === "linux") {
      targetAsset = assets.find(
        (asset) =>
          asset.name.endsWith(".AppImage") ||
          asset.name.endsWith(".deb") ||
          asset.name.includes("linux"),
      );
    }

    return targetAsset ? targetAsset.browser_download_url : null;
  }

  /**
   * 下载更新文件（使用系统代理）
   */
  async downloadUpdate(downloadUrl, onProgress) {
    if (this.isDownloading) {
      throw new Error("Download already in progress");
    }

    try {
      this.isDownloading = true;
      this.downloadProgress = 0;

      await this.ensureTempDir();
      await this.cleanupTempDir();

      const fileName = path.basename(new URL(downloadUrl).pathname);
      const filePath = path.join(this.tempDir, fileName);

      // 解析系统代理
      const proxyUrl = await this.resolveSystemProxy(downloadUrl);
      logToFile(`Starting download: ${downloadUrl}, proxy: ${proxyUrl || "DIRECT"}`, "INFO");

      // 连接超时时间（30秒）
      const CONNECTION_TIMEOUT = 30000;
      // 数据接收超时时间（60秒无数据则超时）
      const DATA_TIMEOUT = 60000;

      return new Promise((resolve, reject) => {
        let connectionTimer = null;
        let dataTimer = null;
        let isResolved = false;

        const cleanup = () => {
          if (connectionTimer) clearTimeout(connectionTimer);
          if (dataTimer) clearTimeout(dataTimer);
        };

        const handleError = (error) => {
          if (isResolved) return;
          isResolved = true;
          cleanup();
          this.isDownloading = false;
          this.currentRequest = null;
          reject(error);
        };

        const resetDataTimer = () => {
          if (dataTimer) clearTimeout(dataTimer);
          dataTimer = setTimeout(() => {
            handleError(new Error("Download timeout: no data received for 60 seconds"));
            if (this.currentRequest) {
              try { this.currentRequest.abort(); } catch (e) {}
            }
          }, DATA_TIMEOUT);
        };

        // 使用session确保代理设置生效
        const request = net.request({
          url: downloadUrl,
          method: "GET",
          session: session.defaultSession,
        });

        request.setHeader("User-Agent", "SimpleShell-UpdateDownloader");

        // 保存请求引用以便取消
        this.currentRequest = request;

        // 连接超时
        connectionTimer = setTimeout(() => {
          handleError(new Error("Connection timeout: unable to connect within 30 seconds"));
          try { request.abort(); } catch (e) {}
        }, CONNECTION_TIMEOUT);

        request.on("response", async (response) => {
          // 收到响应，清除连接超时
          if (connectionTimer) {
            clearTimeout(connectionTimer);
            connectionTimer = null;
          }

          // 处理重定向
          if (response.statusCode >= 300 && response.statusCode < 400) {
            const redirectUrl = response.headers.location;
            if (redirectUrl) {
              logToFile(`Following redirect to: ${redirectUrl}`, "INFO");
              cleanup();
              this.isDownloading = false;
              try {
                const result = await this.downloadUpdate(redirectUrl, onProgress);
                if (!isResolved) {
                  isResolved = true;
                  resolve(result);
                }
              } catch (error) {
                handleError(error);
              }
              return;
            }
          }

          if (response.statusCode !== 200) {
            handleError(new Error(`HTTP ${response.statusCode}: Download failed`));
            return;
          }

          // 开始数据超时计时
          resetDataTimer();

          const totalSize = parseInt(response.headers["content-length"], 10) || 0;
          let downloadedSize = 0;
          const chunks = [];

          response.on("data", (chunk) => {
            // 收到数据，重置数据超时
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

          response.on("end", async () => {
            if (isResolved) return;
            isResolved = true;
            cleanup();

            try {
              const buffer = Buffer.concat(chunks);
              await fs.writeFile(filePath, buffer);

              this.isDownloading = false;
              this.downloadProgress = 100;
              this.currentRequest = null;

              logToFile(`Download completed: ${filePath}`, "INFO");
              resolve(filePath);
            } catch (error) {
              this.isDownloading = false;
              this.currentRequest = null;
              reject(error);
            }
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
    } catch (error) {
      this.isDownloading = false;
      this.currentRequest = null;
      logToFile(`Download error: ${error.message}`, "ERROR");
      throw error;
    }
  }

  /**
   * 安装更新
   */
  async installUpdate(filePath) {
    try {
      logToFile(`Installing update: ${filePath}`, "INFO");

      // 验证文件存在
      await fs.access(filePath);

      const platform = process.platform;
      const fileExt = path.extname(filePath).toLowerCase();

      if (platform === "win32" && fileExt === ".exe") {
        // Windows installer
        await this.installWindowsUpdate(filePath);
      } else if (platform === "darwin" && fileExt === ".dmg") {
        // macOS DMG
        await this.installMacUpdate(filePath);
      } else if (
        platform === "linux" &&
        (fileExt === ".appimage" || fileExt === ".deb")
      ) {
        // Linux package
        await this.installLinuxUpdate(filePath);
      } else {
        throw new Error(
          `Unsupported installer format: ${fileExt} on ${platform}`,
        );
      }

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

      // 使用 /S 参数进行静默安装
      // detached: true 确保安装程序独立于当前进程运行
      const installer = spawn(filePath, ["/S"], {
        detached: true,
        stdio: "ignore",
        windowsHide: false, // 显示安装程序窗口（如果有）
      });

      installer.on("error", (error) => {
        logToFile(`Windows installer spawn error: ${error.message}`, "ERROR");
        reject(error);
      });

      // 分离子进程，确保安装程序独立运行
      installer.unref();

      // 安装程序已启动，立即返回成功
      logToFile(
        "Windows installer started, preparing to quit application",
        "INFO",
      );
      resolve();

      // 短暂延迟后强制退出应用，避免安装冲突
      // 使用 app.exit() 而非 app.quit() 确保立即退出，不会被 beforeunload 事件阻止
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
      await fs.unlink(filePath);
      logToFile(`Cleaned up installer file: ${filePath}`, "INFO");
    } catch (error) {
      logToFile(`Failed to cleanup installer file: ${error.message}`, "WARN");
    }
  }

  /**
   * macOS更新安装
   */
  async installMacUpdate(filePath) {
    return new Promise((resolve, reject) => {
      // 打开DMG文件
      exec(`open "${filePath}"`, (error) => {
        if (error) {
          logToFile(`macOS installer error: ${error.message}`, "ERROR");
          reject(error);
        } else {
          logToFile("macOS DMG opened successfully", "INFO");
          resolve();
          // 提示用户手动安装
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
      // AppImage - 让用户手动替换
      shell.showItemInFolder(filePath);
      dialog.showMessageBox({
        type: "info",
        title: "Update Ready",
        message:
          "The update has been downloaded. Please replace your current application with the new AppImage file.",
        buttons: ["OK"],
      });
    } else if (fileExt === ".deb") {
      // DEB package
      return new Promise((resolve, reject) => {
        exec(`pkexec dpkg -i "${filePath}"`, (error, stdout, stderr) => {
          if (error) {
            logToFile(`DEB installer error: ${error.message}`, "ERROR");
            reject(error);
          } else {
            logToFile("DEB package installed successfully", "INFO");
            resolve();
          }
        });
      });
    }
  }

  /**
   * 版本比较
   */
  compareVersions(version1, version2) {
    const v1Parts = version1.split(".").map((n) => parseInt(n, 10));
    const v2Parts = version2.split(".").map((n) => parseInt(n, 10));

    const maxLength = Math.max(v1Parts.length, v2Parts.length);

    for (let i = 0; i < maxLength; i++) {
      const v1Part = v1Parts[i] || 0;
      const v2Part = v2Parts[i] || 0;

      if (v1Part > v2Part) return 1;
      if (v1Part < v2Part) return -1;
    }

    return 0;
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
