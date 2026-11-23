const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const INNO_UNINSTALL_REG_KEYS = [
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 6_is1",
  "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 5_is1",
  "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 5_is1",
  "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Inno Setup 5_is1",
];

const STATIC_COMMON_ISCC_PATHS = [
  "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
  "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  "D:\\Inno Setup 6\\ISCC.exe",
  "D:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
  "D:\\Program Files\\Inno Setup 6\\ISCC.exe",
  "E:\\Inno Setup 6\\ISCC.exe",
];

function stripSurroundingQuotes(value) {
  const trimmed = String(value || "").trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function joinExecutable(dirPath, exeName = "ISCC.exe") {
  if (dirPath.includes("\\") || /^[A-Za-z]:/.test(dirPath)) {
    return path.win32.join(dirPath, exeName);
  }
  return path.join(dirPath, exeName);
}

function dirnameForCandidate(filePath) {
  if (filePath.includes("\\") || /^[A-Za-z]:/.test(filePath)) {
    return path.win32.dirname(filePath);
  }
  return path.dirname(filePath);
}

function resolveCandidateFile(
  rawCandidate,
  { existsSync = fs.existsSync, statSync = fs.statSync } = {},
) {
  const candidate = stripSurroundingQuotes(rawCandidate);
  if (!candidate) {
    return null;
  }

  const isDirectory = (targetPath) => {
    try {
      return Boolean(statSync?.(targetPath)?.isDirectory?.());
    } catch {
      return false;
    }
  };

  if (/\.exe$/i.test(candidate)) {
    return existsSync(candidate) && !isDirectory(candidate) ? candidate : null;
  }

  const exeInDir = joinExecutable(candidate, "ISCC.exe");
  if (existsSync(exeInDir) && !isDirectory(exeInDir)) {
    return exeInDir;
  }

  return existsSync(candidate) && !isDirectory(candidate) ? candidate : null;
}

function getCommonIsccPaths(env = process.env, extraCommonPaths = []) {
  const candidates = [];
  const envRoots = [
    env["ProgramFiles(x86)"],
    env.ProgramFiles,
    env.LOCALAPPDATA ? joinExecutable(env.LOCALAPPDATA, "Programs") : null,
  ].filter(Boolean);

  for (const root of envRoots) {
    candidates.push(
      joinExecutable(joinExecutable(root, "Inno Setup 6"), "ISCC.exe"),
    );
  }

  candidates.push(...STATIC_COMMON_ISCC_PATHS, ...extraCommonPaths);

  const deduped = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const normalized = stripSurroundingQuotes(candidate);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(normalized);
  }
  return deduped;
}

function runSyncCommand(command, args, spawnSyncImpl = spawnSync) {
  try {
    const result = spawnSyncImpl(command, args, {
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (!result || result.error || result.status !== 0) {
      return "";
    }
    return String(result.stdout || "");
  } catch {
    return "";
  }
}

function findIsccViaWhere({
  spawnSyncImpl = spawnSync,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
} = {}) {
  const stdout = runSyncCommand("where.exe", ["iscc"], spawnSyncImpl);
  if (!stdout) {
    return null;
  }

  const lines = stdout
    .split(/\r?\n/)
    .map((line) => stripSurroundingQuotes(line))
    .filter(Boolean);

  // Prefer explicit .exe entries before extensionless shims on PATH.
  lines.sort((a, b) => {
    const aExe = /\.exe$/i.test(a) ? 0 : 1;
    const bExe = /\.exe$/i.test(b) ? 0 : 1;
    return aExe - bExe;
  });

  for (const line of lines) {
    const resolved = resolveCandidateFile(line, { existsSync, statSync });
    if (resolved) {
      return resolved;
    }
  }
  return null;
}

function extractRegistryInstallCandidates(regOutput) {
  const candidates = [];
  if (!regOutput) {
    return candidates;
  }

  for (const line of String(regOutput).split(/\r?\n/)) {
    const locationMatch = line.match(
      /^\s*(?:InstallLocation|Inno Setup: App Path)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i,
    );
    if (locationMatch?.[1]) {
      candidates.push(locationMatch[1].trim());
      continue;
    }

    const iconMatch = line.match(
      /^\s*DisplayIcon\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)$/i,
    );
    if (iconMatch?.[1]) {
      const iconPath = stripSurroundingQuotes(
        iconMatch[1].replace(/,\s*-?\d+\s*$/, ""),
      );
      if (iconPath) {
        candidates.push(dirnameForCandidate(iconPath));
      }
    }
  }

  return candidates;
}

function findIsccViaRegistry({
  spawnSyncImpl = spawnSync,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  registryKeys = INNO_UNINSTALL_REG_KEYS,
} = {}) {
  for (const key of registryKeys) {
    const stdout = runSyncCommand("reg.exe", ["query", key], spawnSyncImpl);
    const candidates = extractRegistryInstallCandidates(stdout);
    for (const candidate of candidates) {
      const resolved = resolveCandidateFile(candidate, {
        existsSync,
        statSync,
      });
      if (resolved) {
        return resolved;
      }
    }
  }
  return null;
}

function findIsccPath({
  env = process.env,
  platform = process.platform,
  existsSync = fs.existsSync,
  statSync = fs.statSync,
  spawnSyncImpl = spawnSync,
  commonPaths = [],
} = {}) {
  const envPath = stripSurroundingQuotes(env?.ISCC_PATH);
  if (envPath) {
    const resolvedEnv = resolveCandidateFile(envPath, {
      existsSync,
      statSync,
    });
    if (resolvedEnv) {
      return resolvedEnv;
    }
    throw new Error(
      `ISCC_PATH is set to "${envPath}", but ISCC.exe was not found at that location. Verify Inno Setup 6 is installed and ISCC_PATH points to ISCC.exe.`,
    );
  }

  if (platform !== "win32") {
    throw new Error(
      `Inno Setup installer builds require Windows (win32), current platform is "${platform}".`,
    );
  }

  const fromWhere = findIsccViaWhere({ spawnSyncImpl, existsSync, statSync });
  if (fromWhere) {
    return fromWhere;
  }

  const fromRegistry = findIsccViaRegistry({
    spawnSyncImpl,
    existsSync,
    statSync,
  });
  if (fromRegistry) {
    return fromRegistry;
  }

  for (const candidate of getCommonIsccPaths(env, commonPaths)) {
    const resolved = resolveCandidateFile(candidate, { existsSync, statSync });
    if (resolved) {
      return resolved;
    }
  }

  throw new Error(
    "Inno Setup 6 compiler (ISCC.exe) was not found. Checked ISCC_PATH, PATH ('where iscc'), Windows Registry (Inno Setup Uninstall keys), and standard installation folders (e.g. C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe, D:\\Inno Setup 6\\ISCC.exe). Install Inno Setup 6 from https://jrsoftware.org/isinfo.php or set ISCC_PATH to ISCC.exe.",
  );
}

function normalizeAppVersion(version) {
  const normalized = String(version || "")
    .trim()
    .replace(/^v/i, "");
  if (!normalized) {
    throw new Error("Application version is required for Inno Setup build");
  }
  return normalized;
}

function normalizeWindowsNumericVersion(version) {
  const core = normalizeAppVersion(version).replace(/[-+].*$/, "");
  const parts = core
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter((num) => Number.isInteger(num) && num >= 0);

  while (parts.length < 4) {
    parts.push(0);
  }
  return parts.slice(0, 4).join(".");
}

function formatOutputBaseFilename({
  appName = "SimpleShell",
  version,
  arch = "x64",
}) {
  const normalizedAppName = String(appName || "").trim();
  const normalizedVersion = normalizeAppVersion(version);
  const normalizedArch = String(arch || "").trim();

  if (!normalizedAppName) {
    throw new Error("Application name is required for Inno Setup output name");
  }
  if (!normalizedArch) {
    throw new Error(
      "Target architecture is required for Inno Setup output name",
    );
  }

  return `${normalizedAppName}-v${normalizedVersion}-Setup-${normalizedArch}`;
}

function formatInstallerFilename(options) {
  return `${formatOutputBaseFilename(options)}.exe`;
}

function buildInnoSetupDefines({
  appName = "SimpleShell",
  appVersion,
  appArch = "x64",
  sourceDir,
  outputDir,
  outputBaseFilename,
  appIcon,
  licenseFile,
  appCopyright = "Copyright (C) 2026 funkpopo",
  extraDefines = {},
}) {
  const normalizedVersion = normalizeAppVersion(appVersion);
  const resolvedBaseFilename =
    outputBaseFilename ||
    formatOutputBaseFilename({
      appName,
      version: normalizedVersion,
      arch: appArch,
    });

  const defines = {
    AppName: appName,
    AppVersion: normalizedVersion,
    AppNumericVersion: normalizeWindowsNumericVersion(normalizedVersion),
    AppArch: appArch,
    SourceDir: sourceDir,
    OutputDir: outputDir,
    OutputBaseFilename: resolvedBaseFilename,
    AppIcon: appIcon,
    LicenseFile: licenseFile,
    AppCopyright: appCopyright,
    ...extraDefines,
  };

  for (const [key, value] of Object.entries(defines)) {
    if (value === undefined || value === null || String(value).trim() === "") {
      throw new Error(`Missing required Inno Setup define: ${key}`);
    }
  }

  return defines;
}

function buildInnoSetupArgs({ scriptPath, quiet = false, ...defineOptions }) {
  if (!scriptPath || !String(scriptPath).trim()) {
    throw new Error("Inno Setup scriptPath is required");
  }

  const defines = buildInnoSetupDefines(defineOptions);
  const args = [];

  if (quiet) {
    args.push("/Qp");
  }

  for (const [key, value] of Object.entries(defines)) {
    args.push(`/D${key}=${String(value)}`);
  }

  args.push(scriptPath);
  return args;
}

function compileInnoSetup({
  isccPath,
  args,
  cwd,
  spawnImpl = spawn,
  onStdout = (chunk) => process.stdout.write(chunk),
  onStderr = (chunk) => process.stderr.write(chunk),
}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(isccPath, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const outputChunks = [];

    child.stdout?.on("data", (chunk) => {
      outputChunks.push(chunk);
      onStdout?.(chunk);
    });

    child.stderr?.on("data", (chunk) => {
      outputChunks.push(chunk);
      onStderr?.(chunk);
    });

    child.on("error", (error) => {
      reject(
        new Error(`Failed to start ISCC.exe (${isccPath}): ${error.message}`),
      );
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({
          exitCode: 0,
          output: Buffer.concat(outputChunks).toString("utf8"),
        });
        return;
      }

      const combinedOutput = Buffer.concat(outputChunks)
        .toString("utf8")
        .trim();
      const tail = combinedOutput
        ? `\n${combinedOutput.split(/\r?\n/).slice(-20).join("\n")}`
        : "";
      reject(
        new Error(
          `Inno Setup compilation failed with exit code ${code} (${isccPath})${tail}`,
        ),
      );
    });
  });
}

module.exports = {
  INNO_UNINSTALL_REG_KEYS,
  STATIC_COMMON_ISCC_PATHS,
  buildInnoSetupArgs,
  buildInnoSetupDefines,
  compileInnoSetup,
  extractRegistryInstallCandidates,
  findIsccPath,
  findIsccViaRegistry,
  findIsccViaWhere,
  formatInstallerFilename,
  formatOutputBaseFilename,
  getCommonIsccPaths,
  normalizeAppVersion,
  normalizeWindowsNumericVersion,
  resolveCandidateFile,
};
