const { exec } = require("child_process");
const { promisify } = require("util");
const EventEmitter = require("events");

const execAsync = promisify(exec);

/**
 * Window embedding functionality disabled - requires PowerShell
 * This is a simplified version that disables all window embedding features
 */
class WindowEmbedder extends EventEmitter {
  constructor(mainWindow) {
    super();
    this.mainWindow = mainWindow;
    this.embeddedWindows = new Map();
    this.isWindows = process.platform === "win32";
  }

  /**
   * 嵌入外部窗口到应用内 - DISABLED
   */
  async embedWindow(tabId, hwnd, bounds) {
    return false;
  }

  /**
   * 移除嵌入的窗口 - DISABLED
   */
  async unembed(tabId) {
    return false;
  }

  /**
   * 更新嵌入窗口的边界 - DISABLED
   */
  async updateBounds(tabId, bounds) {
    return false;
  }

  /**
   * 获取窗口信息 - DISABLED
   */
  async getWindowInfo(hwnd) {
    return null;
  }

  /**
   * 隐藏窗口 - DISABLED
   */
  async hideWindow(hwnd) {
    return false;
  }

  /**
   * 显示窗口 - DISABLED
   */
  async showWindow(hwnd) {
    return false;
  }

  /**
   * 清理所有嵌入的窗口
   */
  cleanup() {
    this.embeddedWindows.clear();
  }
}

module.exports = WindowEmbedder;
