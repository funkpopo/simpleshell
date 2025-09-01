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
    console.log(
      "Window embedding functionality is disabled (requires PowerShell)",
    );
    return false;
  }

  /**
   * 移除嵌入的窗口 - DISABLED
   */
  async unembed(tabId) {
    console.log(
      "Window unembedding functionality is disabled (requires PowerShell)",
    );
    return false;
  }

  /**
   * 更新嵌入窗口的边界 - DISABLED
   */
  async updateBounds(tabId, bounds) {
    console.log(
      "Window bounds update functionality is disabled (requires PowerShell)",
    );
    return false;
  }

  /**
   * 获取窗口信息 - DISABLED
   */
  async getWindowInfo(hwnd) {
    console.log(
      "Window info retrieval functionality is disabled (requires PowerShell)",
    );
    return null;
  }

  /**
   * 隐藏窗口 - DISABLED
   */
  async hideWindow(hwnd) {
    console.log(
      "Window hiding functionality is disabled (requires PowerShell)",
    );
    return false;
  }

  /**
   * 显示窗口 - DISABLED
   */
  async showWindow(hwnd) {
    console.log(
      "Window showing functionality is disabled (requires PowerShell)",
    );
    return false;
  }

  /**
   * 清理所有嵌入的窗口
   */
  cleanup() {
    console.log("Window embedder cleanup - functionality is disabled");
    this.embeddedWindows.clear();
  }
}

module.exports = WindowEmbedder;
