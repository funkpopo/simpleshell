const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  buildInnoSetupArgs,
  compileInnoSetup,
  findIsccPath,
  formatInstallerFilename,
  formatOutputBaseFilename,
} = require("../lib/inno-setup");

const DEFAULT_SCRIPT_RELATIVE_PATH = path.join("installer", "simpleshell.iss");
const DEFAULT_OUTPUT_RELATIVE_DIR = "installer";
const DEFAULT_ICON_RELATIVE_PATH = path.join(
  "src",
  "renderer",
  "assets",
  "logo.ico",
);
const DEFAULT_LICENSE_RELATIVE_PATH = "LICENSE";

class MakerInnoSetup {
  constructor(configOrConfigFetcher = {}, platformsToMakeOn) {
    this.name = "inno-setup";
    this.defaultPlatforms = ["win32"];
    this.requiredExternalBinaries = [];
    this.configOrConfigFetcher = configOrConfigFetcher;
    this.platformsToMakeOn = platformsToMakeOn;
    this.config = {};
    Object.defineProperty(this, "__isElectronForgeMaker", {
      value: true,
      enumerable: false,
      configurable: false,
    });
  }

  get platforms() {
    if (this.platformsToMakeOn) {
      return this.platformsToMakeOn;
    }
    return this.defaultPlatforms;
  }

  async prepareConfig(targetArch) {
    if (typeof this.configOrConfigFetcher === "function") {
      this.config = await Promise.resolve(
        this.configOrConfigFetcher(targetArch),
      );
    } else {
      this.config = this.configOrConfigFetcher || {};
    }
  }

  isSupportedOnCurrentPlatform() {
    return process.platform === "win32";
  }

  externalBinariesExist() {
    return true;
  }

  ensureExternalBinariesExist() {}

  clone() {
    const MakerClass = this.constructor;
    return new MakerClass(this.configOrConfigFetcher, this.platformsToMakeOn);
  }

  async ensureDirectory(dirPath) {
    await fsp.rm(dirPath, { recursive: true, force: true });
    await fsp.mkdir(dirPath, { recursive: true });
  }

  async ensureFile(filePath) {
    await fsp.rm(filePath, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
  }

  async make({
    dir,
    appName,
    targetPlatform,
    targetArch,
    forgeConfig,
    packageJSON,
  }) {
    if (targetPlatform && targetPlatform !== "win32") {
      throw new Error(
        `MakerInnoSetup only supports win32 targets, received "${targetPlatform}"`,
      );
    }

    const config = this.config || {};
    const projectRoot = config.projectRoot
      ? path.resolve(config.projectRoot)
      : process.cwd();

    const resolvedAppName =
      config.appName ||
      appName ||
      packageJSON?.productName ||
      packageJSON?.name ||
      "SimpleShell";
    const resolvedVersion = config.appVersion || packageJSON?.version;
    const resolvedArch = config.appArch || targetArch || process.arch;

    const scriptPath = path.resolve(
      projectRoot,
      config.scriptPath || DEFAULT_SCRIPT_RELATIVE_PATH,
    );
    const outputDir = path.resolve(
      projectRoot,
      config.outputDir || DEFAULT_OUTPUT_RELATIVE_DIR,
    );
    const appIcon = path.resolve(
      projectRoot,
      config.appIcon || DEFAULT_ICON_RELATIVE_PATH,
    );
    const licenseFile = path.resolve(
      projectRoot,
      config.licenseFile || DEFAULT_LICENSE_RELATIVE_PATH,
    );
    const appCopyright =
      config.appCopyright ||
      forgeConfig?.packagerConfig?.appCopyright ||
      `Copyright (C) ${new Date().getFullYear()} funkpopo`;

    if (!dir || !fs.existsSync(dir)) {
      throw new Error(`Packaged application directory not found: ${dir}`);
    }
    if (!fs.existsSync(scriptPath)) {
      throw new Error(`Inno Setup script not found: ${scriptPath}`);
    }
    if (!fs.existsSync(appIcon)) {
      throw new Error(`Windows installer icon not found: ${appIcon}`);
    }
    if (!fs.existsSync(licenseFile)) {
      throw new Error(`License file not found: ${licenseFile}`);
    }

    const outputBaseFilename = formatOutputBaseFilename({
      appName: resolvedAppName,
      version: resolvedVersion,
      arch: resolvedArch,
    });
    const installerFilename = formatInstallerFilename({
      appName: resolvedAppName,
      version: resolvedVersion,
      arch: resolvedArch,
    });
    const outputExePath = path.join(outputDir, installerFilename);

    const isccPath = config.isccPath
      ? findIsccPath({
          env: { ...process.env, ISCC_PATH: config.isccPath },
        })
      : findIsccPath();

    await this.ensureFile(outputExePath);

    const args = buildInnoSetupArgs({
      scriptPath,
      quiet: config.quiet ?? true,
      appName: resolvedAppName,
      appVersion: resolvedVersion,
      appArch: resolvedArch,
      sourceDir: path.resolve(dir),
      outputDir,
      outputBaseFilename,
      appIcon,
      licenseFile,
      appCopyright,
      extraDefines: config.defines || {},
    });

    await compileInnoSetup({
      isccPath,
      args,
      cwd: path.dirname(scriptPath),
    });

    const stats = await fsp.stat(outputExePath).catch(() => null);
    if (!stats || !stats.isFile() || stats.size === 0) {
      throw new Error(
        `Inno Setup finished but did not produce expected installer: ${outputExePath}`,
      );
    }

    return [outputExePath];
  }
}

module.exports = MakerInnoSetup;
module.exports.MakerInnoSetup = MakerInnoSetup;
module.exports.default = MakerInnoSetup;
