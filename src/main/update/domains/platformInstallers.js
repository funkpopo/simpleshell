/** Update installer verification and Windows/macOS/Linux platform launch helpers. */
function createPlatformInstallerMethods({
  fsp,
  path,
  WINDOWS_INSTALLER_ARGS,
  buildErrorResponse,
  mainT,
  getUiLanguage,
  configService,
  logToFile,
}) {
  return {
    /**
     * 安装前执行路径与哈希校验
     * @returns {Promise<{meta: object, filePath: string, fileExt: string, installerVersion: string}>}
     */
    async verifyInstallerBeforeInstall() {
      const { meta, filePath, fileExt, installerVersion } =
        await this.assertDownloadedInstallerReady();
      return { meta, filePath, fileExt, installerVersion };
    },

    /**
     * 安装更新
     */
    async installUpdate() {
      try {
        const { meta, filePath, fileExt, installerVersion } =
          await this.verifyInstallerBeforeInstall();
        logToFile(`Installing update from trusted file: ${filePath}`, "INFO");
        await this.appendInstallerLog(
          `Starting installation for ${this.productName} ${installerVersion}: ${filePath}`,
        );
        await this.saveInstallerStatus("installing", {
          installStartedAt: new Date().toISOString(),
          installerLogPath: this.installerLogPath,
        });

        const platform = this.platform;
        if (platform === "win32" && fileExt === ".exe") {
          await this.installWindowsUpdate(filePath, meta);
        } else if (
          platform === "darwin" &&
          (fileExt === ".dmg" || fileExt === ".zip")
        ) {
          await this.installMacUpdate(filePath);
        } else if (
          platform === "linux" &&
          (fileExt === ".appimage" || fileExt === ".deb" || fileExt === ".rpm")
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
        await this.saveInstallerStatus("install-launched", {
          installLaunchedAt: new Date().toISOString(),
          installerLogPath: this.installerLogPath,
        });
        await this.clearUpdateError();

        return {
          success: true,
          installerVersion,
          installerLogPath: this.installerLogPath,
          restartRequired:
            platform !== "linux" || fileExt === ".deb" || fileExt === ".rpm",
        };
      } catch (error) {
        logToFile(`Installation error: ${error.message}`, "ERROR");
        await this.appendInstallerLog(`Installation failed: ${error.message}`);
        const errorInfo = await this.recordUpdateError("install", error, {
          installerLogPath: this.installerLogPath,
        });
        await this.saveInstallerStatus("install-failed", {
          installFailedAt: new Date().toISOString(),
          installerLogPath: this.installerLogPath,
          lastError: errorInfo,
        }).catch(() => null);
        return {
          ...buildErrorResponse(error, {
            module: "update",
            operation: "installUpdate",
            retryable: true,
          }),
          installerLogPath: this.installerLogPath,
          canRetry: true,
        };
      }
    },

    /**
     * Windows更新安装
     */
    async installWindowsUpdate(filePath) {
      logToFile(`Scheduling Windows installer: ${filePath}`, "INFO");
      await this.appendInstallerLog(
        `Scheduling Windows installer: ${filePath}`,
      );

      if (typeof this.app.relaunch === "function") {
        this.app.relaunch({
          execPath: filePath,
          args: WINDOWS_INSTALLER_ARGS,
        });
        await this.appendInstallerLog(
          "Windows installer scheduled with Electron relaunch",
        );
        logToFile(
          "Windows installer scheduled to run after application exit",
          "INFO",
        );
        this.scheduleQuitForUpdateInstallation();
        return;
      }

      await this.spawnWindowsInstaller(filePath);
      this.scheduleQuitForUpdateInstallation();
    },

    spawnWindowsInstaller(filePath) {
      return new Promise((resolve, reject) => {
        let installer;
        try {
          installer = this.spawn(filePath, WINDOWS_INSTALLER_ARGS, {
            detached: true,
            stdio: "ignore",
            windowsHide: true,
          });
        } catch (error) {
          logToFile(`Windows installer spawn error: ${error.message}`, "ERROR");
          reject(error);
          return;
        }

        installer.on("error", (error) => {
          logToFile(`Windows installer spawn error: ${error.message}`, "ERROR");
          reject(error);
        });

        if (typeof installer.unref === "function") {
          installer.unref();
        }

        logToFile(
          "Windows installer process started, preparing to quit application",
          "INFO",
        );
        resolve();
      });
    },

    scheduleQuitForUpdateInstallation() {
      setTimeout(() => {
        logToFile("Exiting application for update installation", "INFO");
        if (typeof this.app.exit === "function") {
          this.app.exit(0);
        } else if (typeof this.app.quit === "function") {
          this.app.quit();
        }
      }, 500);
    },

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
          logToFile(
            `Failed to cleanup installer file: ${error.message}`,
            "WARN",
          );
        }
      }
    },

    /**
     * macOS更新安装
     */
    async installMacUpdate(filePath) {
      return new Promise((resolve, reject) => {
        this.execFile("open", [filePath], (error) => {
          if (error) {
            logToFile(`macOS installer error: ${error.message}`, "ERROR");
            reject(error);
          } else {
            logToFile("macOS DMG opened successfully", "INFO");
            resolve();
            const lng = getUiLanguage(configService);
            this.dialog.showMessageBox({
              type: "info",
              title: mainT("mainProcess.update.readyTitle", { lng }),
              message: mainT("mainProcess.update.macMessage", { lng }),
              buttons: [mainT("mainProcess.update.ok", { lng })],
            });
          }
        });
      });
    },

    /**
     * Linux更新安装
     */
    async installLinuxUpdate(filePath) {
      const fileExt = path.extname(filePath).toLowerCase();

      if (fileExt === ".appimage") {
        this.shell.showItemInFolder(filePath);
        const lng = getUiLanguage(configService);
        this.dialog.showMessageBox({
          type: "info",
          title: mainT("mainProcess.update.readyTitle", { lng }),
          message: mainT("mainProcess.update.linuxAppImageMessage", { lng }),
          buttons: [mainT("mainProcess.update.ok", { lng })],
        });
        return;
      }

      if (fileExt === ".deb") {
        await this._installLinuxPackage(["dpkg", "-i", filePath], "DEB");
        return;
      }

      if (fileExt === ".rpm") {
        await this._installLinuxPackage(["rpm", "-U", filePath], "RPM");
      }
    },

    /**
     * 通过 pkexec 安装 Linux 软件包（DEB/RPM 公共实现）
     * @param {string[]} args - 传给 pkexec 的安装命令及参数
     * @param {string} label - 日志中使用的包类型名称（DEB/RPM）
     */
    _installLinuxPackage(args, label) {
      return new Promise((resolve, reject) => {
        const installer = this.spawn("pkexec", args, {
          stdio: "ignore",
        });

        installer.on("error", (error) => {
          logToFile(`${label} installer error: ${error.message}`, "ERROR");
          reject(error);
        });

        installer.on("close", (code) => {
          if (code === 0) {
            logToFile(`${label} package installed successfully`, "INFO");
            resolve();
          } else {
            reject(new Error(`${label} installer exited with code ${code}`));
          }
        });
      });
    },
  };
}

module.exports = createPlatformInstallerMethods;
