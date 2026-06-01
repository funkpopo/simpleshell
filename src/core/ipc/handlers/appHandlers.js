const { app, BrowserWindow, shell, dialog, clipboard } = require("electron");
const { logToFile } = require("../../utils/logger");
const { getLogDirectory } = require("../../utils/appPaths");
const {
  buildDiagnosticPayload,
  buildDiagnosticSummary,
  buildFeedbackIssueUrl,
  exportDiagnosticPackage,
} = require("../../utils/diagnostics");
const updateService = require("../../update/updateService");
const {
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
} = require("../schema/channels");

const DEFAULT_EXTERNAL_PROTOCOLS = new Set(["http:", "https:"]);
const CONFIRMABLE_EXTERNAL_PROTOCOLS = new Set(["mailto:"]);
const MAX_EXTERNAL_URL_LENGTH = 2048;

const toHexId = (n) =>
  typeof n === "number" && Number.isFinite(n)
    ? `0x${n.toString(16).padStart(4, "0")}`
    : null;

const normalizeGpuText = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

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
        channel: IPC_REQUEST_CHANNELS.APP_GET_VERSION,
        category: "app",
        handler: this.getVersion.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_CLOSE,
        category: "app",
        handler: this.closeApp.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_RELOAD_WINDOW,
        category: "app",
        handler: this.reloadWindow.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CLIPBOARD_READ_TEXT,
        category: "clipboard",
        handler: this.readClipboardText.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.CLIPBOARD_WRITE_TEXT,
        category: "clipboard",
        handler: this.writeClipboardText.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_OPEN_EXTERNAL,
        category: "app",
        handler: this.openExternal.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_CHECK_FOR_UPDATE,
        category: "app",
        handler: this.checkForUpdate.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_DOWNLOAD_UPDATE,
        category: "app",
        handler: this.downloadUpdate.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_INSTALL_UPDATE,
        category: "app",
        handler: this.installUpdate.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_GET_DOWNLOAD_PROGRESS,
        category: "app",
        handler: this.getDownloadProgress.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_CANCEL_DOWNLOAD,
        category: "app",
        handler: this.cancelDownload.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_HAS_DOWNLOADED_INSTALLER,
        category: "app",
        handler: this.hasDownloadedInstaller.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_GET_GPU_INFO,
        category: "app",
        handler: this.getGpuInfo.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_OPEN_LOG_DIRECTORY,
        category: "app",
        handler: this.openLogDirectory.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_EXPORT_DIAGNOSTICS,
        category: "app",
        handler: this.exportDiagnostics.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_SUMMARY,
        category: "app",
        handler: this.copyDiagnosticSummary.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_COPY_DIAGNOSTIC_PACKAGE,
        category: "app",
        handler: this.copyDiagnosticPackage.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.APP_OPEN_FEEDBACK_ISSUE,
        category: "app",
        handler: this.openFeedbackIssue.bind(this),
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

  async getGpuInfo() {
    try {
      const hardwareAccelerationEnabled =
        global.__hardwareAccelerationEnabled !== false;
      const info = await app.getGPUInfo("complete");
      const aux = info && info.auxAttributes ? info.auxAttributes : {};
      const devices = Array.isArray(info && info.gpuDevice)
        ? info.gpuDevice
        : [];
      const activeDevice =
        devices.find((d) => d && d.active) || devices[0] || {};
      const vendorId = toHexId(activeDevice.vendorId);
      const deviceId = toHexId(activeDevice.deviceId);

      return {
        success: true,
        hardwareAccelerationEnabled,
        displayRenderer: normalizeGpuText(activeDevice.deviceString),
        displayVendor: normalizeGpuText(activeDevice.vendorString),
        glRenderer: aux.glRenderer || null,
        glVendor: aux.glVendor || null,
        glVersion: aux.glVersion || null,
        softwareRendering:
          aux.softwareRendering === true || aux.glRenderer === "SwiftShader",
        gpuCompositing: aux.gpuCompositing !== false,
        activeGpu: {
          vendorId,
          deviceId,
          vendorString: normalizeGpuText(activeDevice.vendorString),
          deviceString: normalizeGpuText(activeDevice.deviceString),
          driverVendor: activeDevice.driverVendor || null,
          driverVersion: activeDevice.driverVersion || null,
        },
      };
    } catch (error) {
      logToFile(`Error getting GPU info: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
        hardwareAccelerationEnabled:
          global.__hardwareAccelerationEnabled !== false,
      };
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

  async readClipboardText() {
    try {
      return {
        success: true,
        text: clipboard.readText(),
      };
    } catch (error) {
      logToFile(`Error reading clipboard text: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async writeClipboardText(event, text) {
    try {
      void event;
      clipboard.writeText(String(text ?? ""));
      return { success: true };
    } catch (error) {
      logToFile(`Error writing clipboard text: ${error.message}`, "ERROR");
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

      const TIMEOUT_MS = 5000;
      await Promise.race([
        shell.openExternal(normalizedUrl),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error("shell.openExternal timed out")),
            TIMEOUT_MS,
          ),
        ),
      ]);

      logToFile(`Opened external URL: ${normalizedUrl}`, "INFO");
      return { success: true };
    } catch (error) {
      logToFile(`Error opening external URL: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
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
          event.sender.send(
            IPC_EVENT_CHANNELS.UPDATE_DOWNLOAD_PROGRESS,
            progressData,
          );
        }
      };

      const installer = await updateService.downloadUpdate(onProgress);

      return {
        success: true,
        filePath: installer?.filePath || "",
        installer,
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

  async hasDownloadedInstaller() {
    try {
      return await updateService.hasDownloadedInstaller();
    } catch (error) {
      logToFile(
        `Error checking downloaded installer: ${error.message}`,
        "ERROR",
      );
      return { available: false };
    }
  }

  async openLogDirectory() {
    try {
      const logDir = getLogDirectory(app);
      const errorMessage = await shell.openPath(logDir);
      if (errorMessage) {
        throw new Error(errorMessage);
      }
      return { success: true, path: logDir };
    } catch (error) {
      logToFile(`Error opening log directory: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async exportDiagnostics() {
    try {
      const result = await exportDiagnosticPackage(app, { updateService });
      logToFile(`Diagnostics exported: ${result.filePath}`, "INFO");
      return result;
    } catch (error) {
      logToFile(`Error exporting diagnostics: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async copyDiagnosticSummary(event, context = null) {
    try {
      void event;
      const payload = await buildDiagnosticPayload(app, {
        updateService,
        context,
      });
      const summary = buildDiagnosticSummary(payload);
      clipboard.writeText(summary);
      logToFile("Diagnostic summary copied to clipboard", "INFO");
      return {
        success: true,
        summary,
        generatedAt: payload.generatedAt,
      };
    } catch (error) {
      logToFile(`Error copying diagnostic summary: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async copyDiagnosticPackage(event, context = null) {
    try {
      void event;
      const payload = await buildDiagnosticPayload(app, {
        updateService,
        context,
      });
      const serialized = JSON.stringify(payload, null, 2);
      clipboard.writeText(serialized);
      logToFile("Diagnostic package copied to clipboard", "INFO");
      return {
        success: true,
        generatedAt: payload.generatedAt,
        bytes: Buffer.byteLength(serialized, "utf8"),
      };
    } catch (error) {
      logToFile(`Error copying diagnostic package: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  async openFeedbackIssue(event, context = null) {
    try {
      void event;
      const payload = await buildDiagnosticPayload(app, {
        updateService,
        context,
      });
      const summary = buildDiagnosticSummary(payload);
      const issueUrl = buildFeedbackIssueUrl(payload, summary);
      await shell.openExternal(issueUrl);
      logToFile("Feedback issue URL opened", "INFO");
      return {
        success: true,
        url: issueUrl,
        summary,
        generatedAt: payload.generatedAt,
      };
    } catch (error) {
      logToFile(`Error opening feedback issue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }
}

module.exports = AppHandlers;
