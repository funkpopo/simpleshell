const fs = require("fs");
const path = require("path");

/**
 * 启动期硬件加速引导：必须在 app.whenReady() 之前调用，
 * 以便决定是否调用 app.disableHardwareAcceleration()。
 *
 * 因为 configService 在 whenReady 内部初始化（太晚），这里同步读取
 * config.json 的 uiSettings.performance.hardwareAcceleration 字段。
 * 路径解析与 configService._getMainConfigPath() 保持一致。
 *
 * @param {import('electron').App} app
 * @returns {boolean} 实际生效的 hardwareAccelerationEnabled
 */
function bootstrapHardwareAcceleration(app) {
  let enabled = true;
  try {
    const isDev = process.env.NODE_ENV === "development" || !app.isPackaged;
    const configPath = isDev
      ? path.join(process.cwd(), "config.json")
      : path.join(path.dirname(app.getPath("exe")), "config.json");

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const value = parsed?.uiSettings?.performance?.hardwareAcceleration;
      if (value === false) {
        enabled = false;
      }
    }
  } catch {
    enabled = true;
  }

  if (!enabled) {
    try {
      app.disableHardwareAcceleration();
      app.commandLine.appendSwitch("disable-gpu");
      app.commandLine.appendSwitch("disable-gpu-compositing");
    } catch {
      /* intentionally ignored — best-effort */
    }
  }

  global.__hardwareAccelerationEnabled = enabled;
  return enabled;
}

module.exports = {
  bootstrapHardwareAcceleration,
};
