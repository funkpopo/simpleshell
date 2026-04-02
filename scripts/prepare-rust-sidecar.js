const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const packageManifestPath = path.join(projectRoot, "package.json");
const manifestPath = path.join(
  projectRoot,
  "transfernative",
  "transfer-sidecar",
  "Cargo.toml",
);
const platformArchDir = `${process.platform}-${process.arch}`;
const executableName =
  process.platform === "win32" ? "transfer-sidecar.exe" : "transfer-sidecar";
const buildOutputPath = path.join(
  projectRoot,
  "transfernative",
  "transfer-sidecar",
  "target",
  "release",
  executableName,
);
const stagedDir = path.join(
  projectRoot,
  "transfernative",
  "bin",
  platformArchDir,
);
const stagedPath = path.join(stagedDir, executableName);
const sourceRoot = path.join(projectRoot, "transfernative", "transfer-sidecar");

function log(message) {
  process.stdout.write(`[prepare-rust-sidecar] ${message}\n`);
}

function readJsonFile(jsonPath) {
  return JSON.parse(fs.readFileSync(jsonPath, "utf8"));
}

function getAppVersion() {
  if (!fs.existsSync(packageManifestPath)) {
    throw new Error(`package manifest not found: ${packageManifestPath}`);
  }

  const packageManifest = readJsonFile(packageManifestPath);
  const version = packageManifest?.version;
  if (typeof version !== "string" || !version.trim()) {
    throw new Error(`invalid application version in ${packageManifestPath}`);
  }

  return version.trim();
}

function syncSidecarManifestVersion(appVersion) {
  const manifestContent = fs.readFileSync(manifestPath, "utf8");
  const packageSectionPattern =
    /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/;
  const match = manifestContent.match(packageSectionPattern);

  if (!match) {
    throw new Error(
      `unable to locate package.version in native sidecar manifest: ${manifestPath}`,
    );
  }

  const currentVersion = match[2];
  if (currentVersion === appVersion) {
    return false;
  }

  const updatedContent = manifestContent.replace(
    packageSectionPattern,
    `$1${appVersion}$3`,
  );
  fs.writeFileSync(manifestPath, updatedContent, "utf8");
  log(`synced sidecar version ${currentVersion} -> ${appVersion}`);
  return true;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyIfPresent() {
  if (!fs.existsSync(buildOutputPath)) {
    return false;
  }

  ensureDir(stagedDir);
  fs.copyFileSync(buildOutputPath, stagedPath);
  log(`staged native sidecar at ${path.relative(projectRoot, stagedPath)}`);
  return true;
}

function hasStagedBinary() {
  return fs.existsSync(stagedPath);
}

function getNewestMtimeMs(targetPath) {
  if (!fs.existsSync(targetPath)) {
    return 0;
  }

  const stats = fs.statSync(targetPath);
  if (!stats.isDirectory()) {
    return stats.mtimeMs;
  }

  let newest = stats.mtimeMs;
  for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
    if (entry.name === "target") {
      continue;
    }
    const childPath = path.join(targetPath, entry.name);
    newest = Math.max(newest, getNewestMtimeMs(childPath));
  }
  return newest;
}

function isStagedBinaryOutdated() {
  if (!hasStagedBinary()) {
    return true;
  }

  const stagedMtime = fs.statSync(stagedPath).mtimeMs;
  const buildMtime = fs.existsSync(buildOutputPath)
    ? fs.statSync(buildOutputPath).mtimeMs
    : 0;
  const sourceMtime = getNewestMtimeMs(sourceRoot);

  return buildMtime > stagedMtime || sourceMtime > stagedMtime;
}

function isCargoAvailable() {
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const lookup = spawnSync(lookupCommand, ["cargo"], {
    cwd: projectRoot,
    stdio: "pipe",
    shell: process.platform === "win32",
  });

  return lookup.status === 0;
}

function tryBuildWithCargo() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`native sidecar manifest not found: ${manifestPath}`);
  }

  if (!isCargoAvailable()) {
    throw new Error(
      "cargo is required to build the Rust transfer sidecar, or provide a prebuilt binary under transfernative/bin",
    );
  }

  const result = spawnSync(
    "cargo",
    ["build", "--release", "--manifest-path", manifestPath],
    {
      cwd: projectRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
    },
  );

  if (result.error) {
    log(
      `cargo unavailable, skipping native sidecar build: ${result.error.message}`,
    );
    return false;
  }

  if (result.status !== 0) {
    throw new Error(`cargo build failed with exit code ${result.status}`);
  }

  return true;
}

function main() {
  ensureDir(path.join(projectRoot, "transfernative", "bin"));
  const appVersion = getAppVersion();

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`native sidecar manifest not found: ${manifestPath}`);
  }

  syncSidecarManifestVersion(appVersion);

  if (hasStagedBinary() && !isStagedBinaryOutdated()) {
    log(
      `using staged native sidecar at ${path.relative(projectRoot, stagedPath)}`,
    );
    return;
  }

  if (copyIfPresent() && !isStagedBinaryOutdated()) {
    return;
  }

  tryBuildWithCargo();

  if (!copyIfPresent()) {
    throw new Error(
      `native sidecar build completed but executable was not found at ${buildOutputPath}`,
    );
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `[prepare-rust-sidecar] ${error.message || String(error)}\n`,
  );
  process.exit(1);
}
