const { app, dialog, shell } = require("electron");
const fs = require("fs").promises;
const path = require("path");
const { spawn, exec } = require("child_process");
const { logToFile } = require("../utils/logger");
const fetch = require("node-fetch");
const os = require("os");

class UpdateService {
  constructor() {
    this.tempDir = path.join(os.tmpdir(), "simpleshell-updates");
    this.currentVersion = app.getVersion();
    this.updateCheckUrl =
      "https://api.github.com/repos/funkpopo/simpleshell/releases/latest";
    this.isDownloading = false;
    this.downloadProgress = 0;
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
      logToFile("Checking for updates...", "INFO");

      const response = await fetch(this.updateCheckUrl, {
        headers: {
          "User-Agent": "SimpleShell-UpdateChecker",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const releaseData = await response.json();
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
   * 下载更新文件
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

      logToFile(`Starting download: ${downloadUrl}`, "INFO");

      const response = await fetch(downloadUrl, {
        headers: {
          "User-Agent": "SimpleShell-UpdateDownloader",
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const totalSize = parseInt(response.headers.get("content-length"), 10);
      let downloadedSize = 0;

      const fileStream = await fs.open(filePath, "w");
      const writeStream = fileStream.createWriteStream();

      return new Promise((resolve, reject) => {
        response.body.on("data", (chunk) => {
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

        response.body.on("error", (error) => {
          fileStream.close();
          this.isDownloading = false;
          reject(error);
        });

        response.body.on("end", async () => {
          await fileStream.close();
          this.isDownloading = false;
          this.downloadProgress = 100;

          logToFile(`Download completed: ${filePath}`, "INFO");
          resolve(filePath);
        });

        response.body.pipe(writeStream);
      });
    } catch (error) {
      this.isDownloading = false;
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
      // 使用 /S 参数进行静默安装，/D 指定安装目录
      const installer = spawn(filePath, ["/S"], {
        detached: true,
        stdio: "ignore",
      });

      installer.on("error", (error) => {
        logToFile(`Windows installer error: ${error.message}`, "ERROR");
        reject(error);
      });

      installer.on("exit", (code) => {
        if (code === 0) {
          logToFile("Windows installer completed successfully", "INFO");
          // 安装成功后清理临时文件
          this.cleanupInstallerFile(filePath);
          resolve();
          // 延迟退出应用，让安装程序完成
          setTimeout(() => {
            app.quit();
          }, 2000);
        } else {
          const error = new Error(`Installer exited with code ${code}`);
          logToFile(`Windows installer failed: ${error.message}`, "ERROR");
          reject(error);
        }
      });

      // 分离子进程，避免阻塞主进程
      installer.unref();
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
    // 这里可以实现下载取消逻辑
    this.isDownloading = false;
    this.downloadProgress = 0;
    logToFile("Download cancelled", "INFO");
  }
}

module.exports = new UpdateService();
