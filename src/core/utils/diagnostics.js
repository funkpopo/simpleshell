const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const configService = require("../../services/configService");
const { getDiagnosticDirectory, getConfigPath } = require("./appPaths");
const { getLogFilePath } = require("./logger");
const { redactSensitiveText } = require("./log-sanitizer");
const { getTransferNativeScannerPath } = require("./nativeTransferSidecar");
const { getCrashReporterDiagnostics } = require("./crashReporter");

const MAX_LOG_LINES = 400;
const SIDECAR_VERSION_TIMEOUT_MS = 3000;
const FEEDBACK_ISSUE_URL = "https://github.com/funkpopo/simpleshell/issues/new";

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

function pickRecentErrorLines(lines, maxLines = 12) {
  if (!Array.isArray(lines)) {
    return [];
  }

  return lines
    .filter(
      (line) => /\[(ERROR|WARN)\]/i.test(line) || /error|failed/i.test(line),
    )
    .slice(-maxLines);
}

function summarizeGpu(gpuInfo) {
  const devices = Array.isArray(gpuInfo?.gpuDevice) ? gpuInfo.gpuDevice : [];
  const activeDevice = devices.find((device) => device?.active) || devices[0];
  const aux = gpuInfo?.auxAttributes || {};
  return (
    activeDevice?.deviceString ||
    aux.glRenderer ||
    gpuInfo?.displayRenderer ||
    "unknown"
  );
}

function buildDiagnosticSummary(payload) {
  const recentLines = payload?.logs?.recentLines || [];
  const recentErrors = pickRecentErrorLines(recentLines);
  const crashRecords = Array.isArray(payload?.crashReporter?.recentRecords)
    ? payload.crashReporter.recentRecords.slice(0, 5)
    : [];
  const lines = [
    "## SimpleShell diagnostics",
    "",
    `Generated: ${payload?.generatedAt || "unknown"}`,
    `App: ${payload?.app?.name || "SimpleShell"} ${payload?.app?.version || "unknown"} (${payload?.app?.packaged ? "packaged" : "development"})`,
    `Runtime: Electron ${payload?.runtime?.electron || "unknown"}, Chrome ${payload?.runtime?.chrome || "unknown"}, Node ${payload?.runtime?.node || "unknown"}`,
    `Platform: ${payload?.platform?.os || process.platform} ${payload?.platform?.release || ""} ${payload?.platform?.arch || process.arch}`,
    `GPU: ${summarizeGpu(payload?.gpu)}`,
    `Config schemaVersion: ${payload?.config?.schemaVersion || "unknown"}`,
    `Update status: ${payload?.update?.status || payload?.update?.state || "unknown"}`,
    `Sidecar: ${payload?.sidecar?.version || "unknown"} (${payload?.sidecar?.exists ? "found" : "missing"})`,
    `Crash reporter: ${payload?.crashReporter?.started ? "started" : "not started"}, local only`,
  ];

  if (payload?.context && typeof payload.context === "object") {
    lines.push("", "## User context");
    if (payload.context.title) lines.push(`Title: ${payload.context.title}`);
    if (payload.context.description) {
      lines.push(`Description: ${payload.context.description}`);
    }
    if (payload.context.source) lines.push(`Source: ${payload.context.source}`);
    if (payload.context.errorCategory) {
      lines.push(`Error category: ${payload.context.errorCategory}`);
    }
    if (payload.context.errorAction) {
      lines.push(`Error action: ${payload.context.errorAction}`);
    }
    if (payload.context.errorCode) {
      lines.push(`Error code: ${payload.context.errorCode}`);
    }
    if (payload.context.classificationReason) {
      lines.push(
        `Classification reason: ${payload.context.classificationReason}`,
      );
    }
  }

  if (payload?.update?.lastUpdateError) {
    const lastUpdateError = payload.update.lastUpdateError;
    lines.push("", "## Last update error");
    lines.push(
      `Stage: ${lastUpdateError.stage || "unknown"}, category: ${lastUpdateError.errorCategory || "unknown"}, action: ${lastUpdateError.errorAction || "unknown"}`,
    );
    if (lastUpdateError.message) {
      lines.push(`Message: ${lastUpdateError.message}`);
    }
  }

  if (crashRecords.length > 0) {
    lines.push("", "## Recent crash records");
    crashRecords.forEach((record) => {
      const marker = record.marker || {};
      const category = marker.errorCategory ? ` [${marker.errorCategory}]` : "";
      lines.push(
        `- ${marker.generatedAt || new Date(record.mtimeMs).toISOString()}${category} ${marker.module || record.kind}: ${marker.reason || marker.error?.message || record.name}`,
      );
    });
  }

  if (recentErrors.length > 0) {
    lines.push("", "## Recent error log lines");
    recentErrors.forEach((line) => {
      lines.push(`- ${line}`);
    });
  }

  lines.push(
    "",
    "Note: The full diagnostic package is a local JSON file. Review it before attaching it to a public issue.",
  );

  return lines.join("\n");
}

function buildFeedbackIssueUrl(
  payload,
  summary = buildDiagnosticSummary(payload),
) {
  const titleBase = payload?.context?.title || "Problem report";
  const title = `[Bug] ${titleBase}`.slice(0, 180);
  const body = [
    "### What happened?",
    "",
    payload?.context?.description || "Describe the issue here.",
    "",
    "### Diagnostics summary",
    "",
    summary,
  ].join("\n");

  const params = new URLSearchParams({
    title,
    body,
  });
  return `${FEEDBACK_ISSUE_URL}?${params.toString()}`;
}

async function buildDiagnosticPayload(
  app,
  { updateService = null, context = null } = {},
) {
  const gpuInfo = await app.getGPUInfo("complete").catch((error) => ({
    error: error.message,
  }));
  const sidecarPath = getTransferNativeScannerPath();
  const sidecarRuntimeVersion = await resolveSidecarRuntimeVersion(sidecarPath);
  const logFilePath = getLogFilePath();
  const recentLines = safeReadRecentLogLines(logFilePath);

  return {
    generatedAt: new Date().toISOString(),
    context:
      context && typeof context === "object"
        ? {
            title:
              typeof context.title === "string"
                ? redactSensitiveText(context.title).slice(0, 180)
                : "",
            description:
              typeof context.description === "string"
                ? redactSensitiveText(context.description).slice(0, 1000)
                : "",
            source:
              typeof context.source === "string"
                ? redactSensitiveText(context.source).slice(0, 80)
                : "",
            errorCategory:
              typeof context.errorCategory === "string"
                ? redactSensitiveText(context.errorCategory).slice(0, 40)
                : "",
            errorAction:
              typeof context.errorAction === "string"
                ? redactSensitiveText(context.errorAction).slice(0, 40)
                : "",
            errorCode:
              typeof context.errorCode === "string"
                ? redactSensitiveText(context.errorCode).slice(0, 80)
                : "",
            classificationReason:
              typeof context.classificationReason === "string"
                ? redactSensitiveText(context.classificationReason).slice(0, 80)
                : "",
          }
        : null,
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
    crashReporter: getCrashReporterDiagnostics(app),
    logs: {
      path: logFilePath,
      recentLines,
    },
  };
}

async function exportDiagnosticPackage(app, options = {}) {
  const diagnosticsDir = getDiagnosticDirectory(app);
  fs.mkdirSync(diagnosticsDir, { recursive: true });

  const payload = await buildDiagnosticPayload(app, options);
  const summary = buildDiagnosticSummary(payload);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(diagnosticsDir, `diagnostics.${stamp}.json`);

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");

  return {
    success: true,
    filePath,
    diagnosticsDir,
    generatedAt: payload.generatedAt,
    summary,
  };
}

module.exports = {
  buildDiagnosticSummary,
  buildFeedbackIssueUrl,
  buildDiagnosticPayload,
  exportDiagnosticPackage,
};
