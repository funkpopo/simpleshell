const { app, BrowserWindow, shell, dialog } = require("electron");
const { execFile } = require("child_process");
const { logToFile } = require("../../utils/logger");
const updateService = require("../../update/updateService");

const DEFAULT_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const CONFIRMABLE_EXTERNAL_PROTOCOLS = new Set(["mailto:"]);
const MAX_EXTERNAL_URL_LENGTH = 2048;

/**
 * 应用级别的IPC处理器
 */
class AppHandlers {
  /**
   * 获取所有应用处理器
   */
  getHandlers() {
    return [
      {
        channel: "app:getVersion",
        category: "app",
        handler: this.getVersion.bind(this),
      },
      {
        channel: "app:close",
        category: "app",
        handler: this.closeApp.bind(this),
      },
      {
        channel: "app:reloadWindow",
        category: "app",
        handler: this.reloadWindow.bind(this),
      },
      {
        channel: "app:openExternal",
        category: "app",
        handler: this.openExternal.bind(this),
      },
      {
        channel: "app:checkForUpdate",
        category: "app",
        handler: this.checkForUpdate.bind(this),
      },
      {
        channel: "app:downloadUpdate",
        category: "app",
        handler: this.downloadUpdate.bind(this),
      },
      {
        channel: "app:installUpdate",
        category: "app",
        handler: this.installUpdate.bind(this),
      },
      {
        channel: "app:getDownloadProgress",
        category: "app",
        handler: this.getDownloadProgress.bind(this),
      },
      {
        channel: "app:cancelDownload",
        category: "app",
        handler: this.cancelDownload.bind(this),
      },
    ];
  }

  // 实现各个处理器方法
  async getVersion() {
    try {
      return {
        success: true,
        version: app.getVersion(),
      };
    } catch (error) {
      logToFile(`Error getting app version: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async closeApp() {
    try {
      logToFile("Application closing via IPC", "INFO");
      app.quit();
      return { success: true };
    } catch (error) {
      logToFile(`Error closing app: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async reloadWindow() {
    try {
      const mainWindow = BrowserWindow.getAllWindows()[0];
      if (mainWindow) {
        mainWindow.reload();
        logToFile("Window reloaded", "INFO");
        return { success: true };
      }
      return { success: false, error: "No window found" };
    } catch (error) {
      logToFile(`Error reloading window: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  normalizeExternalOpenRequest(rawInput) {
    if (typeof rawInput === "string") {
      return {
        url: rawInput,
        source: "renderer",
        allowRestrictedProtocols: false,
      };
    }

    if (rawInput && typeof rawInput === "object") {
      const source =
        typeof rawInput.source === "string" && rawInput.source.trim()
          ? rawInput.source.trim().slice(0, 64)
          : "renderer";

      return {
        url: rawInput.url,
        source,
        allowRestrictedProtocols: rawInput.allowRestrictedProtocols === true,
      };
    }

    return {
      url: null,
      source: "renderer",
      allowRestrictedProtocols: false,
    };
  }

  validateExternalUrl(url) {
    if (!url || typeof url !== "string") {
      throw new Error("Invalid URL");
    }

    const trimmed = url.trim();
    if (!trimmed || trimmed.length > MAX_EXTERNAL_URL_LENGTH) {
      throw new Error("Invalid URL length");
    }

    let urlObj;
    try {
      urlObj = new URL(trimmed);
    } catch {
      throw new Error("Invalid URL format");
    }

    return {
      normalizedUrl: urlObj.toString(),
      protocol: urlObj.protocol.toLowerCase(),
    };
  }

  async confirmRestrictedExternalOpen(event, source, normalizedUrl) {
    const targetWindow = event?.sender
      ? BrowserWindow.fromWebContents(event.sender)
      : null;
    const messageBoxOptions = {
      type: "warning",
      title: "Restricted External Link",
      message: "This link uses a restricted protocol.",
      detail: `Source: ${source}\nURL: ${normalizedUrl}\n\nOpen anyway?`,
      buttons: ["Deny (Recommended)", "Open Anyway"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const messageBoxResult = targetWindow
      ? await dialog.showMessageBox(targetWindow, messageBoxOptions)
      : await dialog.showMessageBox(messageBoxOptions);
    return messageBoxResult.response === 1;
  }

  async openExternal(event, rawInput) {
    try {
      const request = this.normalizeExternalOpenRequest(rawInput);
      const { normalizedUrl, protocol } = this.validateExternalUrl(request.url);

      const isDefaultProtocol = DEFAULT_EXTERNAL_PROTOCOLS.has(protocol);
      const isConfirmableProtocol =
        CONFIRMABLE_EXTERNAL_PROTOCOLS.has(protocol);

      if (!isDefaultProtocol) {
        if (!isConfirmableProtocol || !request.allowRestrictedProtocols) {
          logToFile(
            `Blocked external URL protocol: ${protocol} (source: ${request.source})`,
            "WARN",
          );
          return { success: false, error: "Unsupported protocol" };
        }

        const confirmed = await this.confirmRestrictedExternalOpen(
          event,
          request.source,
          normalizedUrl,
        );
        if (!confirmed) {
          logToFile(
            `User denied restricted external URL: ${normalizedUrl}`,
            "WARN",
          );
          return { success: false, error: "Opening restricted URL was denied" };
        }
      }

      logToFile(`Attempting to open external URL: ${normalizedUrl}`, "INFO");

      // shell.openExternal 在生产环境可能挂起，添加超时和回退机制
      const TIMEOUT_MS = 5000;
      let opened = false;

      try {
        await Promise.race([
          shell.openExternal(normalizedUrl).then(() => {
            opened = true;
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("shell.openExternal timed out")),
              TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (shellError) {
        logToFile(
          `shell.openExternal failed: ${shellError.message}, trying fallback`,
          "WARN",
        );
      }

      if (!opened) {
        await this._openExternalFallback(normalizedUrl);
      }

      logToFile(`Opened external URL: ${normalizedUrl}`, "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error opening external URL: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  /**
   * 使用系统命令打开外部链接（回退方案）
   */
  _openExternalFallback(url) {
    return new Promise((resolve, reject) => {
      let cmd;
      let args;

      if (process.platform === "win32") {
        // explorer.exe 可安全打开 URL，不会像 cmd.exe /c start 那样误解析 & 等特殊字符
        cmd = "explorer.exe";
        args = [url];
      } else if (process.platform === "darwin") {
        cmd = "open";
        args = [url];
      } else {
        cmd = "xdg-open";
        args = [url];
      }

      execFile(cmd, args, { timeout: 5000 }, (error) => {
        if (error && process.platform === "win32") {
          // explorer.exe 委托给已有进程时返回退出码 1，属于正常行为
          logToFile(
            `Opened external URL via fallback (explorer exit code: ${error.code}): ${url}`,
            "INFO",
          );
          resolve();
        } else if (error) {
          logToFile(`Fallback open failed: ${error.message}`, "ERROR");
          reject(error);
        } else {
          logToFile(`Opened external URL via fallback: ${url}`, "INFO");
          resolve();
        }
      });
    });
  }

  async checkForUpdate() {
    try {
      return await updateService.checkForUpdate();
    } catch (error) {
      logToFile(`Error checking for updates: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async downloadUpdate(event) {
    try {
      // 设置进度回调
      const onProgress = (progressData) => {
        if (event?.sender) {
          // 发送进度事件到渲染进程
          event.sender.send("update:downloadProgress", progressData);
        }
      };

      const filePath = await updateService.downloadUpdate(onProgress);

      return {
        success: true,
        filePath,
        message: "Download completed successfully",
      };
    } catch (error) {
      logToFile(`Error downloading update: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async installUpdate(event) {
    try {
      void event;

      const result = await updateService.installUpdate();

      if (result.success) {
        logToFile("Update installation initiated", "INFO");
      }

      return result;
    } catch (error) {
      logToFile(`Error installing update: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async getDownloadProgress() {
    try {
      const progress = updateService.getDownloadProgress();
      return { success: true, progress };
    } catch (error) {
      logToFile(`Error getting download progress: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async cancelDownload() {
    try {
      updateService.cancelDownload();
      return { success: true, message: "Download cancelled" };
    } catch (error) {
      logToFile(`Error cancelling download: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = AppHandlers;
