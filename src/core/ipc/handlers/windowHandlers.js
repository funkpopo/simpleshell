const { BrowserWindow } = require("electron");
const { logToFile } = require("../../utils/logger");

/**
 * 窗口控制相关的IPC处理器
 */
class WindowHandlers {
  /**
   * 获取所有窗口处理器
   */
  getHandlers() {
    return [
      {
        channel: "window:minimize",
        category: "window",
        handler: this.minimize.bind(this),
      },
      {
        channel: "window:toggleMaximize",
        category: "window",
        handler: this.toggleMaximize.bind(this),
      },
      {
        channel: "window:close",
        category: "window",
        handler: this.close.bind(this),
      },
      {
        channel: "window:getState",
        category: "window",
        handler: this.getState.bind(this),
      },
    ];
  }

  _getMainWindow() {
    const windows = BrowserWindow.getAllWindows();
    if (!windows || windows.length === 0) return null;
    const mainWindow = windows[0];
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    return mainWindow;
  }

  async minimize(event) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow) return false;
    mainWindow.minimize();
    return true;
  }

  async toggleMaximize(event) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow) return false;

    if (mainWindow.isFullScreen()) {
      mainWindow.setFullScreen(false);
    } else if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }

    return {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  }

  async close(event) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  }

  async getState(event) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow) {
      return { isMaximized: false, isFullScreen: false };
    }

    return {
      isMaximized: mainWindow.isMaximized(),
      isFullScreen: mainWindow.isFullScreen(),
    };
  }
}

module.exports = WindowHandlers;
