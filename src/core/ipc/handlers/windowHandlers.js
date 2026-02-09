const { getPrimaryWindow } = require("../../window/windowManager");

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

  async minimize(event) {
    const mainWindow = getPrimaryWindow();
    if (!mainWindow) return false;
    mainWindow.minimize();
    return true;
  }

  async toggleMaximize(event) {
    const mainWindow = getPrimaryWindow();
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
    const mainWindow = getPrimaryWindow();
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  }

  async getState(event) {
    const mainWindow = getPrimaryWindow();
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
