const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const SUPPORTED_WINDOWS_ARCHES = new Set(["x64", "arm64", "ia32"]);
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

function normalizeArch(arch = process.arch) {
  const value = String(arch || "")
    .trim()
    .toLowerCase();
  if (!SUPPORTED_WINDOWS_ARCHES.has(value)) {
    throw new Error(
      `Unsupported Windows NSIS architecture "${arch}" (expected one of: x64, arm64, ia32)`,
    );
  }
  return value;
}

function normalizeAppVersion(version) {
  const trimmed = String(version ?? "").trim();
  if (!trimmed) {
    throw new Error("Application version is required for NSIS packaging");
  }
  return trimmed;
}

function formatInstallerFilename({
  appName = "SimpleShell",
  version,
  arch = "x64",
}) {
  const safeName = String(appName || "SimpleShell").trim() || "SimpleShell";
  const normalizedVersion = normalizeAppVersion(version);
  const normalizedArch = normalizeArch(arch);
  return `${safeName}-v${normalizedVersion}-Setup-${normalizedArch}.exe`;
}

async function prepareStagingLicenseFile(licenseFile, stagingDir) {
  if (!licenseFile) {
    return null;
  }

  const resolvedLicense = path.resolve(licenseFile);
  if (!fs.existsSync(resolvedLicense)) {
    throw new Error(`License file not found: ${resolvedLicense}`);
  }

  await fsp.mkdir(stagingDir, { recursive: true });
  const targetPath = path.join(stagingDir, "LICENSE.txt");
  const rawContent = await fsp.readFile(resolvedLicense);
  const hasBom =
    rawContent.length >= UTF8_BOM.length &&
    rawContent.subarray(0, UTF8_BOM.length).equals(UTF8_BOM);
  const contentWithBom = hasBom
    ? rawContent
    : Buffer.concat([UTF8_BOM, rawContent]);

  await fsp.writeFile(targetPath, contentWithBom);
  return targetPath;
}

function buildNsisBuilderConfig({
  appId = "com.funkpopo.simpleshell",
  appName = "SimpleShell",
  executableName,
  appVersion,
  appArch = "x64",
  appCopyright,
  outputDir,
  appIcon,
  licenseFile,
  artifactName,
  electronVersion,
}) {
  const safeName = String(appName || "SimpleShell").trim() || "SimpleShell";
  const safeExecutable = String(executableName || safeName).trim() || safeName;
  const normalizedVersion = normalizeAppVersion(appVersion);
  const normalizedArch = normalizeArch(appArch);
  const resolvedArtifactName =
    artifactName ||
    formatInstallerFilename({
      appName: safeName,
      version: normalizedVersion,
      arch: normalizedArch,
    });

  return {
    appId,
    productName: safeName,
    ...(appCopyright ? { copyright: appCopyright } : {}),
    publish: null,
    extraMetadata: {
      version: normalizedVersion,
    },
    ...(electronVersion ? { electronVersion } : {}),
    directories: {
      output: outputDir,
    },
    win: {
      executableName: safeExecutable,
      ...(appIcon ? { icon: appIcon } : {}),
      // Keep Forge's packaged executable and Fuses untouched.
      signAndEditExecutable: false,
      target: [
        {
          target: "nsis",
          arch: [normalizedArch],
        },
      ],
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: safeName,
      ...(appIcon
        ? {
            installerIcon: appIcon,
            uninstallerIcon: appIcon,
            installerHeaderIcon: appIcon,
          }
        : {}),
      ...(licenseFile ? { license: licenseFile } : {}),
      deleteAppDataOnUninstall: false,
      runAfterFinish: true,
      unicode: true,
      multiLanguageInstaller: true,
      installerLanguages: ["zh_CN", "en_US"],
      displayLanguageSelector: true,
      differentialPackage: false,
      artifactName: resolvedArtifactName,
    },
  };
}

async function buildNsisInstaller({
  prepackagedDir,
  targetArch = "x64",
  config,
  electronBuilder,
}) {
  if (!prepackagedDir || !fs.existsSync(prepackagedDir)) {
    throw new Error(
      `Packaged application directory not found: ${prepackagedDir}`,
    );
  }

  const normalizedArch = normalizeArch(targetArch);
  const builder = electronBuilder || require("electron-builder");
  const archEnum =
    builder.Arch && builder.Arch[normalizedArch] !== undefined
      ? builder.Arch[normalizedArch]
      : normalizedArch;
  const targets = builder.Platform.WINDOWS.createTarget("nsis", archEnum);

  return builder.build({
    targets,
    prepackaged: path.resolve(prepackagedDir),
    config,
  });
}

module.exports = {
  buildNsisBuilderConfig,
  buildNsisInstaller,
  formatInstallerFilename,
  normalizeAppVersion,
  normalizeArch,
  prepareStagingLicenseFile,
};
