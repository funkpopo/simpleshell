const path = require("path");

function assertElectronApp(app) {
  if (!app || typeof app.getPath !== "function") {
    throw new Error("Electron app instance is required to resolve app paths");
  }
}

function isDevelopment(app) {
  return process.env.NODE_ENV === "development" || !app?.isPackaged;
}

function getRuntimeBaseDirectory(app) {
  assertElectronApp(app);
  if (isDevelopment(app)) {
    return process.cwd();
  }
  return path.dirname(app.getPath("exe"));
}

function getConfigPath(app) {
  return path.join(getRuntimeBaseDirectory(app), "config.json");
}

function getConfigBackupDirectory(app) {
  return path.join(getRuntimeBaseDirectory(app), "config-backups");
}

function getLogDirectory(app) {
  assertElectronApp(app);
  if (isDevelopment(app)) {
    return path.join(process.cwd(), "log");
  }
  return path.join(path.dirname(process.execPath), "log");
}

function getTempDirectory(app) {
  return path.join(getRuntimeBaseDirectory(app), "temp");
}

function getDiagnosticDirectory(app) {
  return path.join(getRuntimeBaseDirectory(app), "diagnostics");
}

function getCrashReportDirectory(app) {
  return path.join(getDiagnosticDirectory(app), "crashes");
}

module.exports = {
  getConfigBackupDirectory,
  getConfigPath,
  getCrashReportDirectory,
  getDiagnosticDirectory,
  getLogDirectory,
  getTempDirectory,
};
