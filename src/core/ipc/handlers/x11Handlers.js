/**
 * X11相关的IPC处理器
 */

const xserverManager = require('../../x11/xserver-manager');
const { logToFile } = require('../../utils/logger');

class X11Handlers {
  getHandlers() {
    return [
      {
        channel: 'x11:start',
        category: 'x11',
        handler: this.startXServer.bind(this),
      },
      {
        channel: 'x11:stop',
        category: 'x11',
        handler: this.stopXServer.bind(this),
      },
      {
        channel: 'x11:status',
        category: 'x11',
        handler: this.getXServerStatus.bind(this),
      },
    ];
  }

  async startXServer(event, options = {}) {
    try {
      const result = await xserverManager.start(options);
      logToFile(`X Server启动结果: ${JSON.stringify(result)}`, 'INFO');
      return result;
    } catch (error) {
      logToFile(`X Server启动失败: ${error.message}`, 'ERROR');
      return { success: false, error: error.message };
    }
  }

  stopXServer() {
    try {
      xserverManager.stop();
      logToFile('X Server已停止', 'INFO');
      return { success: true };
    } catch (error) {
      logToFile(`X Server停止失败: ${error.message}`, 'ERROR');
      return { success: false, error: error.message };
    }
  }

  getXServerStatus() {
    return { success: true, status: xserverManager.getStatus() };
  }
}

module.exports = X11Handlers;
