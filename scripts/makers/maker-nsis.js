const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const {
  buildNsisBuilderConfig,
  buildNsisInstaller,
  formatInstallerFilename,
  normalizeArch,
  prepareStagingLicenseFile,
} = require("../lib/nsis-builder");

const DEFAULT_OUTPUT_RELATIVE_DIR = "installer";
const DEFAULT_ICON_RELATIVE_PATH = path.join(
  "src",
  "renderer",
  "assets",
  "logo.ico",
);
const DEFAULT_LICENSE_RELATIVE_PATH = "LICENSE";

class MakerNsis {
  constructor(configOrConfigFetcher = {}, platformsToMakeOn) {
    this.name = "nsis";
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
    makeDir,
    appName,
    targetPlatform,
    targetArch,
    forgeConfig,
    packageJSON,
  }) {
    if (targetPlatform && targetPlatform !== "win32") {
      throw new Error(
        `MakerNsis only supports win32 targets, received "${targetPlatform}"`,
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
    const resolvedExecutableName =
      config.executableName ||
      forgeConfig?.packagerConfig?.executableName ||
      resolvedAppName;
    const resolvedAppId =
      config.appId ||
      forgeConfig?.packagerConfig?.appBundleId ||
      "com.funkpopo.simpleshell";
    const resolvedVersion = config.appVersion || packageJSON?.version;
    const resolvedArch = normalizeArch(
      config.appArch || targetArch || process.arch,
    );
    const resolvedElectronVersion =
      config.electronVersion ||
      String(packageJSON?.devDependencies?.electron || "").replace(
        /^[^\d]*/,
        "",
      ) ||
      undefined;

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
    if (!fs.existsSync(appIcon)) {
      throw new Error(`Windows installer icon not found: ${appIcon}`);
    }
    if (!fs.existsSync(licenseFile)) {
      throw new Error(`License file not found: ${licenseFile}`);
    }

    const installerFilename = formatInstallerFilename({
      appName: resolvedAppName,
      version: resolvedVersion,
      arch: resolvedArch,
    });
    const outputExePath = path.join(outputDir, installerFilename);
    const stagingBaseDir = makeDir
      ? path.resolve(makeDir)
      : path.join(projectRoot, "out", "make");
    const stagingDir = path.join(stagingBaseDir, "nsis", resolvedArch);

    await this.ensureDirectory(stagingDir);
    await this.ensureFile(outputExePath);

    const stagedLicensePath = await prepareStagingLicenseFile(
      licenseFile,
      stagingDir,
    );

    const builderConfig = buildNsisBuilderConfig({
      appId: resolvedAppId,
      appName: resolvedAppName,
      executableName: resolvedExecutableName,
      appVersion: resolvedVersion,
      appArch: resolvedArch,
      appCopyright,
      outputDir: stagingDir,
      appIcon,
      licenseFile: stagedLicensePath,
      artifactName: installerFilename,
      electronVersion: resolvedElectronVersion,
    });

    const artifacts = await buildNsisInstaller({
      prepackagedDir: path.resolve(dir),
      targetArch: resolvedArch,
      config: builderConfig,
      electronBuilder: config.electronBuilder,
    });

    const expectedStagedExe = path.join(stagingDir, installerFilename);
    const matchedArtifact = Array.isArray(artifacts)
      ? artifacts.find(
          (item) =>
            typeof item === "string" && item.toLowerCase().endsWith(".exe"),
        )
      : null;
    const stagedExePath = fs.existsSync(expectedStagedExe)
      ? expectedStagedExe
      : matchedArtifact;

    if (!stagedExePath || !fs.existsSync(stagedExePath)) {
      throw new Error(
        `NSIS build finished but did not produce expected installer: ${expectedStagedExe}`,
      );
    }

    await fsp.copyFile(stagedExePath, outputExePath);

    const stats = await fsp.stat(outputExePath).catch(() => null);
    if (!stats || !stats.isFile() || stats.size === 0) {
      throw new Error(
        `NSIS installer copy failed or produced an empty file: ${outputExePath}`,
      );
    }

    return [outputExePath];
  }
}

module.exports = MakerNsis;
module.exports.MakerNsis = MakerNsis;
module.exports.default = MakerNsis;
