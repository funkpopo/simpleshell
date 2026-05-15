const { getPrimaryWindow } = require("../../window/windowManager");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

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
        channel: IPC_REQUEST_CHANNELS.WINDOW_MINIMIZE,
        category: "window",
        handler: this.minimize.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.WINDOW_TOGGLE_MAXIMIZE,
        category: "window",
        handler: this.toggleMaximize.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.WINDOW_CLOSE,
        category: "window",
        handler: this.close.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.WINDOW_GET_STATE,
        category: "window",
        handler: this.getState.bind(this),
      },
    ];
  }

  async minimize() {
    const mainWindow = getPrimaryWindow();
    if (!mainWindow) return false;
    mainWindow.minimize();
    return true;
  }

  async toggleMaximize() {
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

  async close() {
    const mainWindow = getPrimaryWindow();
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  }

  async getState() {
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
