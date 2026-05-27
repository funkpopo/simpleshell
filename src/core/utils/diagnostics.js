const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const configService = require("../../services/configService");
const { getDiagnosticDirectory, getConfigPath } = require("./appPaths");
const { getLogFilePath } = require("./logger");
const { redactSensitiveText } = require("./log-sanitizer");
const { getTransferNativeScannerPath } = require("./nativeTransferSidecar");

const MAX_LOG_LINES = 400;
const SIDECAR_VERSION_TIMEOUT_MS = 3000;

function safeReadRecentLogLines(logFilePath) {
  if (!logFilePath || !fs.existsSync(logFilePath)) {
    return [];
  }

  const content = fs.readFileSync(logFilePath, "utf8");
  return content
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-MAX_LOG_LINES)
    .map((line) => redactSensitiveText(line));
}

function readCargoSidecarVersion() {
  const cargoPath = path.join(
    process.cwd(),
    "transfernative",
    "transfer-sidecar",
    "Cargo.toml",
  );

  if (!fs.existsSync(cargoPath)) {
    return null;
  }

  const content = fs.readFileSync(cargoPath, "utf8");
  const match = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
  return match ? match[1] : null;
}

function resolveSidecarRuntimeVersion(sidecarPath) {
  if (!sidecarPath) {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    const child = spawn(sidecarPath, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let settled = false;

    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Ignore shutdown failures; diagnostics should still be produced.
      }
      finish(null);
    }, SIDECAR_VERSION_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    child.on("error", () => {
      clearTimeout(timer);
      finish(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      finish(output.trim() || null);
    });
  });
}

function getConfigSummary(app) {
  const configPath = getConfigPath(app);
  const schemaVersion = configService.isInitialized()
    ? configService.get("schemaVersion")
    : null;
  const security = configService.isInitialized()
    ? configService.getCredentialSecurityStatus()
    : null;

  return {
    path: configPath,
    exists: fs.existsSync(configPath),
    schemaVersion: schemaVersion || null,
    security: security
      ? {
          mode: security.mode || null,
          masterPasswordEnabled: security.masterPasswordEnabled === true,
          safeStorageAvailable: security.safeStorageAvailable === true,
          randomKeyConfigured: security.randomKeyConfigured === true,
          requiresUnlock: security.requiresUnlock === true,
        }
      : null,
  };
}

async function buildDiagnosticPayload(app, { updateService = null } = {}) {
  const gpuInfo = await app.getGPUInfo("complete").catch((error) => ({
    error: error.message,
  }));
  const sidecarPath = getTransferNativeScannerPath();
  const sidecarRuntimeVersion = await resolveSidecarRuntimeVersion(sidecarPath);
  const logFilePath = getLogFilePath();

  return {
    generatedAt: new Date().toISOString(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged === true,
    },
    runtime: {
      electron: process.versions.electron || null,
      chrome: process.versions.chrome || null,
      node: process.versions.node || null,
      v8: process.versions.v8 || null,
    },
    platform: {
      os: os.type(),
      release: os.release(),
      arch: process.arch,
      platform: process.platform,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
    },
    gpu: gpuInfo,
    config: getConfigSummary(app),
    update: updateService?.getDiagnosticsSnapshot
      ? updateService.getDiagnosticsSnapshot()
      : null,
    sidecar: {
      path: sidecarPath,
      exists: Boolean(sidecarPath && fs.existsSync(sidecarPath)),
      version: sidecarRuntimeVersion || readCargoSidecarVersion(),
    },
    logs: {
      path: logFilePath,
      recentLines: safeReadRecentLogLines(logFilePath),
    },
  };
}

async function exportDiagnosticPackage(app, options = {}) {
  const diagnosticsDir = getDiagnosticDirectory(app);
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  const payload = await buildDiagnosticPayload(app, options);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(diagnosticsDir, `diagnostics.${stamp}.json`);

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

  return {
    success: true,
    filePath,
    diagnosticsDir,
    generatedAt: payload.generatedAt,
  };
}

module.exports = {
  buildDiagnosticPayload,
  exportDiagnosticPackage,
};
