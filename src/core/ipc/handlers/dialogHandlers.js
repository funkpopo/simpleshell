const { dialog, BrowserWindow } = require("electron");
const { IPC_REQUEST_CHANNELS } = require("../schema/channels");

/**
 * 对话框相关的IPC处理器
 * 错误统一由 safeHandle/wrapIpcHandler 捕获并生成标准错误响应,处理器内直接 throw
 */
class DialogHandlers {
  /**
   * 获取所有对话框处理器
   */
  getHandlers() {
    return [
      {
        channel: IPC_REQUEST_CHANNELS.DIALOG_SHOW_OPEN,
        category: "dialog",
        handler: this.showOpenDialog.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.DIALOG_SHOW_SAVE,
        category: "dialog",
        handler: this.showSaveDialog.bind(this),
      },
      {
        channel: IPC_REQUEST_CHANNELS.DIALOG_SHOW_MESSAGE,
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
    void event;
    const mainWindow = this._getMainWindow();
    return dialog.showOpenDialog(mainWindow, options);
  }

  async showSaveDialog(event, options) {
    void event;
    const mainWindow = this._getMainWindow();
    return dialog.showSaveDialog(mainWindow, options);
  }

  async showMessageBox(event, options) {
    void event;
    const mainWindow = this._getMainWindow();
    return dialog.showMessageBox(mainWindow, options);
  }
}

module.exports = DialogHandlers;
