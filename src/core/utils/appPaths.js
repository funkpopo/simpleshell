const fs = require("fs");
const path = require("path");

function assertElectronApp(app) {
  if (!app || typeof app.getPath !== "function") {
    throw new Error("Electron app instance is required to resolve app paths");
  }
}

function isDevelopment(app) {
  return process.env.NODE_ENV === "development" || !app?.isPackaged;
}

/**
 * 开发环境：项目根目录（process.cwd）。
 * 打包环境：userData（跨版本稳定、可写；避免 Squirrel 升级丢配置、Linux 系统目录无写权限）。
 */
function getRuntimeBaseDirectory(app) {
  assertElectronApp(app);
  if (isDevelopment(app)) {
    return process.cwd();
  }
  return app.getPath("userData");
}

/**
 * 旧版打包路径：config 放在可执行文件旁。
 * Squirrel 每次升级换 app-x.y.z 目录，会导致“启动读不到配置”。
 */
function getLegacyPackagedRuntimeDirectory(app) {
  assertElectronApp(app);
  if (isDevelopment(app)) {
    return null;
  }
  try {
    return path.dirname(app.getPath("exe"));
  } catch {
    return null;
  }
}

function getConfigPath(app) {
  return path.join(getRuntimeBaseDirectory(app), "config.json");
}

function getLegacyConfigPath(app) {
  const legacyDir = getLegacyPackagedRuntimeDirectory(app);
  return legacyDir ? path.join(legacyDir, "config.json") : null;
}

/**
 * 将旧版 exe 旁的 config.json（及 backups）迁移到 userData。
 * 仅在目标不存在且源存在时执行；失败时静默，由调用方走默认创建逻辑。
 * @returns {{ migrated: boolean, from?: string, to?: string, error?: string }}
 */
function migrateLegacyConfigIfNeeded(app) {
  assertElectronApp(app);
  if (isDevelopment(app)) {
    return { migrated: false };
  }

  const targetPath = getConfigPath(app);
  if (fs.existsSync(targetPath)) {
    return { migrated: false };
  }

  const sourcePath = getLegacyConfigPath(app);
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    return { migrated: false };
  }

  // 避免把 userData 自身误当 legacy 源（理论上 exe 不在 userData 内）
  if (path.resolve(sourcePath) === path.resolve(targetPath)) {
    return { migrated: false };
  }

  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.copyFileSync(sourcePath, targetPath);

    const legacyBackupDir = path.join(path.dirname(sourcePath), "config-backups");
    const targetBackupDir = getConfigBackupDirectory(app);
    if (fs.existsSync(legacyBackupDir)) {
      fs.mkdirSync(targetBackupDir, { recursive: true });
      for (const name of fs.readdirSync(legacyBackupDir)) {
        if (!/^config\..+\.json$/.test(name)) {
          continue;
        }
        const from = path.join(legacyBackupDir, name);
        const to = path.join(targetBackupDir, name);
        if (!fs.existsSync(to) && fs.statSync(from).isFile()) {
          try {
            fs.copyFileSync(from, to);
          } catch {
            /* best-effort backup migration */
          }
        }
      }
    }

    return { migrated: true, from: sourcePath, to: targetPath };
  } catch (error) {
    return {
      migrated: false,
      from: sourcePath,
      to: targetPath,
      error: error?.message || String(error),
    };
  }
}

function getConfigBackupDirectory(app) {
  return path.join(getRuntimeBaseDirectory(app), "config-backups");
}

function getLogDirectory(app) {
  assertElectronApp(app);
  if (isDevelopment(app)) {
    return path.join(process.cwd(), "log");
  }
  return path.join(getRuntimeBaseDirectory(app), "log");
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
  getLegacyConfigPath,
  getLogDirectory,
  getTempDirectory,
  migrateLegacyConfigIfNeeded,
};
