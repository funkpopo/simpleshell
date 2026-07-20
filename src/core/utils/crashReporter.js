const fs = require("fs");
const os = require("os");
const path = require("path");
const { crashReporter } = require("electron");

const configService = require("../../services/configService");
const { getConfigPath, getCrashReportDirectory } = require("./appPaths");
const { redactSensitiveText } = require("./log-sanitizer");
const { buildErrorResponse } = require("./errorResponse");

const ERROR_REPORTING_CONFIG_KEY = "errorReporting";
const MAX_RECENT_CRASH_RECORDS = 12;

const DEFAULT_ERROR_REPORTING_SETTINGS = Object.freeze({
  enabled: false,
  prompted: false,
  includeDiagnosticsInFeedback: false,
});

let crashReporterStarted = false;
let crashReporterApp = null;

function normalizeErrorReportingSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  return {
    ...DEFAULT_ERROR_REPORTING_SETTINGS,
    enabled: source.enabled === true,
    prompted: source.prompted === true,
    includeDiagnosticsInFeedback:
      source.includeDiagnosticsInFeedback === true || source.enabled === true,
  };
}

function readErrorReportingSettingsFromDisk(app) {
  try {
    const configPath = getConfigPath(app);
    if (!fs.existsSync(configPath)) {
      return normalizeErrorReportingSettings();
    }

    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return normalizeErrorReportingSettings(
      config?.[ERROR_REPORTING_CONFIG_KEY],
    );
  } catch {
    return normalizeErrorReportingSettings();
  }
}

function loadErrorReportingSettings(app = crashReporterApp) {
  if (configService.isInitialized()) {
    return normalizeErrorReportingSettings(
      configService.get(ERROR_REPORTING_CONFIG_KEY),
    );
  }

  return app
    ? readErrorReportingSettingsFromDisk(app)
    : normalizeErrorReportingSettings();
}

function saveErrorReportingSettings(settings) {
  if (!configService.isInitialized()) {
    throw new Error("Config service is not initialized");
  }

  const normalized = normalizeErrorReportingSettings(settings);
  normalized.prompted = true;
  const saved = configService.set(ERROR_REPORTING_CONFIG_KEY, normalized);
  if (!saved) {
    throw new Error("Failed to save error reporting settings");
  }

  return getErrorReportingStatus(crashReporterApp);
}

function ensureCrashReportDirectory(app) {
  const crashDir = getCrashReportDirectory(app);
  fs.mkdirSync(crashDir, { recursive: true });
  process.env.SIMPLESHELL_SIDECAR_CRASH_DIR = crashDir;
  return crashDir;
}

function getRuntimeExtra(app) {
  return {
    appVersion: app.getVersion(),
    electron: process.versions.electron || "",
    node: process.versions.node || "",
    chrome: process.versions.chrome || "",
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
  };
}

function initializeCrashReporter(app) {
  crashReporterApp = app;
  const crashDir = ensureCrashReportDirectory(app);

  if (!crashReporterStarted) {
    try {
      app.setPath("crashDumps", crashDir);
    } catch {
      // Keep going; Electron will fall back to its default crash dump path.
    }

    const options = {
      productName: app.getName(),
      uploadToServer: false,
      ignoreSystemCrashHandler: false,
      rateLimit: true,
      compress: true,
      globalExtra: {
        ...getRuntimeExtra(app),
        module: "electron",
      },
      extra: {
        processType: "main",
        module: "main",
      },
    };

    crashReporter.start(options);
    crashReporterStarted = true;
  }

  return getErrorReportingStatus(app);
}

function formatTimestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function normalizeSerializableError(error) {
  if (!error) {
    return {
      name: "Error",
      message: "Unknown error",
      stack: "",
    };
  }

  if (typeof error === "string") {
    return {
      name: "Error",
      message: redactSensitiveText(error),
      stack: "",
    };
  }

  return {
    name: error.name || "Error",
    message: redactSensitiveText(error.message || String(error)),
    stack: redactSensitiveText(error.stack || ""),
    code: error.code || error.errorCode || null,
  };
}

function recordCrashMarker(app, details = {}) {
  try {
    const crashDir = ensureCrashReportDirectory(app || crashReporterApp);
    const now = new Date();
    const classified = buildErrorResponse(details.error || details.message, {
      module: details.module || "unknown",
      operation: details.operation || null,
      type: details.type || "runtime-error",
    });
    const marker = {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      app: app
        ? {
            name: app.getName(),
            version: app.getVersion(),
            packaged: app.isPackaged === true,
          }
        : null,
      runtime: getRuntimeExtra(app || crashReporterApp),
      platform: {
        os: os.type(),
        release: os.release(),
        platform: process.platform,
        arch: process.arch,
      },
      module: details.module || "unknown",
      processType: details.processType || details.module || "unknown",
      type: details.type || "runtime-error",
      reason: details.reason || null,
      exitCode: details.exitCode ?? null,
      signal: details.signal || null,
      operation: details.operation || null,
      error: normalizeSerializableError(details.error || details.message),
      errorCategory: classified.errorCategory,
      errorAction: classified.errorAction,
      errorSeverity: classified.errorSeverity,
      errorClassification: classified.errorClassification,
      retryable: classified.retryable,
      reportable: classified.reportable,
      userRecoverable: classified.userRecoverable,
      fatal: classified.fatal,
      extra: details.extra || null,
    };
    const fileName = `crash-marker.${formatTimestampForFile(now)}.${process.pid}.json`;
    const filePath = path.join(crashDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify(marker, null, 2), "utf8");
    return filePath;
  } catch {
    return null;
  }
}

function readCrashMarker(filePath) {
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return {
      path: filePath,
      generatedAt: payload.generatedAt || null,
      module: payload.module || null,
      processType: payload.processType || null,
      type: payload.type || null,
      reason: payload.reason || payload.error?.message || null,
      operation: payload.operation || null,
      exitCode: payload.exitCode ?? null,
      signal: payload.signal || null,
      error: payload.error || null,
      errorCategory: payload.errorCategory || null,
      errorAction: payload.errorAction || null,
      errorSeverity: payload.errorSeverity || null,
      errorClassification: payload.errorClassification || null,
      retryable: payload.retryable === true,
      reportable: payload.reportable === true,
      userRecoverable: payload.userRecoverable === true,
      fatal: payload.fatal === true,
    };
  } catch {
    return null;
  }
}

function listRecentCrashRecords(app, limit = MAX_RECENT_CRASH_RECORDS) {
  try {
    const crashDir = ensureCrashReportDirectory(app || crashReporterApp);
    const entries = fs
      .readdirSync(crashDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const filePath = path.join(crashDir, entry.name);
        const stat = fs.statSync(filePath);
        return {
          name: entry.name,
          path: filePath,
          mtimeMs: stat.mtimeMs,
          size: stat.size,
        };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, Math.max(1, limit));

    return entries.map((entry) => {
      const marker = entry.name.endsWith(".json")
        ? readCrashMarker(entry.path)
        : null;
      return {
        ...entry,
        kind: marker ? "marker" : "dump",
        marker,
      };
    });
  } catch {
    return [];
  }
}

function getErrorReportingStatus(app = crashReporterApp) {
  const settings = loadErrorReportingSettings(app);

  return {
    success: true,
    settings,
    crashReporter: {
      started: crashReporterStarted,
      crashDirectory: app ? ensureCrashReportDirectory(app) : null,
      localOnly: true,
    },
  };
}

function getCrashReporterDiagnostics(app = crashReporterApp) {
  const status = getErrorReportingStatus(app);
  return {
    ...status.crashReporter,
    settings: status.settings,
    recentRecords: listRecentCrashRecords(app),
  };
}

module.exports = {
  getCrashReporterDiagnostics,
  getErrorReportingStatus,
  initializeCrashReporter,
  recordCrashMarker,
  saveErrorReportingSettings,
};
