const { app, dialog, shell, net, session } = require("electron");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");
const { logToFile } = require("../utils/logger");
const { getTempDirectory } = require("../utils/appPaths");
const { buildErrorResponse } = require("../utils/errorResponse");
const { t: mainT, getUiLanguage } = require("../../shared/mainI18n");
const configService = require("../settings/configService");
const {
  compareVersions,
  extractVersionFromText,
  normalizeVersionInput,
} = require("./semver");
const createReleaseCheckMethods = require("./domains/releaseCheck");
const createInstallerDownloadMethods = require("./domains/installerDownload");
const createInstallerPersistenceMethods = require("./domains/installerPersistence");
const createPlatformInstallerMethods = require("./domains/platformInstallers");

const DOWNLOAD_CONNECTION_TIMEOUT = 30000;
const DOWNLOAD_DATA_TIMEOUT = 60000;
const MAX_REDIRECTS = 5;
const PRODUCT_NAME = "SimpleShell";
const UPDATE_TEMP_DIR_NAME = "updates";
const UPDATE_CHECK_URL =
  "https://api.github.com/repos/funkpopo/simpleshell/releases/latest";
const INSTALLER_META_FILE = "latest-installer-meta.json";
const UPDATE_ERROR_FILE = "latest-update-error.json";
const INSTALLER_LOG_FILE = "latest-install.log";
const LEGACY_INSTALLER_SCRIPT_FILE = "install-and-restart.ps1";
const WINDOWS_INSTALLER_ARGS = ["/S"];
const TRUSTED_DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const SECURITY_UPDATE_REGEX =
  /\b(security|secure|cve-\d{4}-\d+|vulnerability|漏洞|安全|修复安全)\b/i;
const IMPORTANT_UPDATE_REGEX =
  /\b(critical|important|breaking|urgent|high priority|重要|紧急|关键|破坏性)\b/i;

function resolveDefaultUpdateTempDir(appInstance) {
  if (appInstance?.isPackaged) {
    try {
      const userDataPath = appInstance.getPath?.("userData");
      if (userDataPath) {
        return path.join(userDataPath, UPDATE_TEMP_DIR_NAME);
      }
    } catch (error) {
      logToFile(
        `Failed to resolve packaged update directory: ${error.message}`,
        "WARN",
      );
    }
  }

  return path.join(getTempDirectory(appInstance), UPDATE_TEMP_DIR_NAME);
}

class UpdateService {
  constructor(options = {}) {
    this.app = options.app || app;
    this.dialog = options.dialog || dialog;
    this.shell = options.shell || shell;
    this.net = options.net || net;
    this.session = options.session || session;
    this.spawn = options.spawn || spawn;
    this.execFile = options.execFile || execFile;
    this.platform = options.platform || process.platform;
    this.productName = options.productName || PRODUCT_NAME;
    this.tempDir = options.tempDir || resolveDefaultUpdateTempDir(this.app);
    this.installerMetaPath = path.join(this.tempDir, INSTALLER_META_FILE);
    this.updateErrorPath = path.join(this.tempDir, UPDATE_ERROR_FILE);
    this.installerLogPath = path.join(this.tempDir, INSTALLER_LOG_FILE);
    this.legacyInstallerScriptPath = path.join(
      this.tempDir,
      LEGACY_INSTALLER_SCRIPT_FILE,
    );
    this.currentVersion =
      options.currentVersion ||
      (typeof this.app.getVersion === "function"
        ? this.app.getVersion()
        : "0.0.0");
    this.updateCheckUrl = options.updateCheckUrl || UPDATE_CHECK_URL;
    this.isDownloading = false;
    this.downloadProgress = 0;
    this.downloadStats = {
      downloaded: 0,
      total: 0,
      progress: 0,
      speedBytesPerSecond: 0,
      startedAt: null,
      updatedAt: null,
    };
    this.currentRequest = null;
    this.downloadCancelRequested = false;
    this.latestReleaseAsset = null;
    this.lastDownloadedInstaller = null;
    this.lastUpdateError = null;
  }
}

Object.assign(
  UpdateService.prototype,
  createReleaseCheckMethods({
    SECURITY_UPDATE_REGEX,
    IMPORTANT_UPDATE_REGEX,
    normalizeVersionInput,
    compareVersions,
    buildErrorResponse,
    logToFile,
  }),
  createInstallerDownloadMethods({
    fs,
    fsp,
    path,
    crypto,
    DOWNLOAD_CONNECTION_TIMEOUT,
    DOWNLOAD_DATA_TIMEOUT,
    MAX_REDIRECTS,
    TRUSTED_DOWNLOAD_HOSTS,
    logToFile,
  }),
  createInstallerPersistenceMethods({
    fsp,
    path,
    extractVersionFromText,
    buildErrorResponse,
    logToFile,
  }),
  createPlatformInstallerMethods({
    fsp,
    path,
    WINDOWS_INSTALLER_ARGS,
    buildErrorResponse,
    mainT,
    getUiLanguage,
    configService,
    logToFile,
  }),
);

const updateService = new UpdateService();

module.exports = updateService;
module.exports.UpdateService = UpdateService;
