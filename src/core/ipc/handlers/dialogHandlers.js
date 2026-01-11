const { dialog, BrowserWindow } = require("electron");
const { logToFile } = require("../../utils/logger");

/**
 * 对话框相关的IPC处理器
 */
class DialogHandlers {
  /**
   * 获取所有对话框处理器
   */
  getHandlers() {
    return [
      {
        channel: "dialog:showOpenDialog",
        category: "dialog",
        handler: this.showOpenDialog.bind(this),
      },
      {
        channel: "dialog:showSaveDialog",
        category: "dialog",
        handler: this.showSaveDialog.bind(this),
      },
      {
        channel: "dialog:showMessageBox",
        category: "dialog",
        handler: this.showMessageBox.bind(this),
      },
    ];
  }

  _getMainWindow() {
    const windows = BrowserWindow.getAllWindows();
    return windows.length > 0 ? windows[0] : null;
  }

  async showOpenDialog(event, options) {
    try {
      const mainWindow = this._getMainWindow();
      const result = await dialog.showOpenDialog(mainWindow, options);
      return result;
    } catch (error) {
      logToFile(`Error showing open dialog: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async showSaveDialog(event, options) {
    try {
      const mainWindow = this._getMainWindow();
      const result = await dialog.showSaveDialog(mainWindow, options);
      return result;
    } catch (error) {
      logToFile(`Error showing save dialog: ${error.message}`, "ERROR");
      throw error;
    }
  }

  async showMessageBox(event, options) {
    try {
      const mainWindow = this._getMainWindow();
      const result = await dialog.showMessageBox(mainWindow, options);
      return result;
    } catch (error) {
      logToFile(`Error showing message box: ${error.message}`, "ERROR");
      throw error;
    }
  }
}

module.exports = DialogHandlers;
