/**
 * X11转发辅助模块
 * 处理SSH连接的X11转发功能
 */

const net = require('net');
const xserverManager = require('./xserver-manager');
const { logInfo, logError } = require('../utils/logger');

/**
 * 为SSH连接设置X11转发
 * @param {Object} ssh - SSH客户端实例
 * @param {Object} sshConfig - SSH配置
 * @returns {Promise<void>}
 */
async function setupX11Forwarding(ssh, sshConfig) {
  if (!sshConfig.enableX11) return;

  const status = xserverManager.getStatus();
  if (!status.running) {
    logInfo('X11转发已启用但X Server未运行，尝试启动...');
    const result = await xserverManager.start();
    if (!result.success) {
      logError(`无法启动X Server: ${result.error}`);
      return;
    }
  }

  const displayNum = xserverManager.getStatus().display;

  // 监听X11通道请求
  ssh.on('x11', (info, accept, reject) => {
    logInfo(`收到X11连接请求: ${JSON.stringify(info)}`);

    const xserverPort = 6000 + displayNum;
    const xserverSocket = net.connect(xserverPort, '127.0.0.1', () => {
      const xclientSocket = accept();
      xclientSocket.pipe(xserverSocket).pipe(xclientSocket);

      xclientSocket.on('error', (err) => {
        logError(`X11客户端socket错误: ${err.message}`);
        xserverSocket.destroy();
      });

      xserverSocket.on('error', (err) => {
        logError(`X Server socket错误: ${err.message}`);
        xclientSocket.destroy();
      });
    });

    xserverSocket.on('error', (err) => {
      logError(`无法连接到X Server: ${err.message}`);
      reject();
    });
  });

  logInfo(`X11转发已设置，DISPLAY=:${displayNum}`);
}

/**
 * 获取SSH shell选项（包含X11配置）
 * @param {Object} sshConfig - SSH配置
 * @returns {Object} shell选项
 */
function getShellOptions(sshConfig) {
  const options = {
    term: 'xterm-256color',
    cols: 120,
    rows: 30,
  };

  if (sshConfig.enableX11) {
    const status = xserverManager.getStatus();
    if (status.running) {
      // SSH服务器会自动设置DISPLAY环境变量（如localhost:10.0）
      // 我们只需要启用X11转发，服务器端会处理DISPLAY
      options.x11 = {
        single: false,
        screen: 0,
      };
      logInfo(`Shell启用X11转发，本地X Server DISPLAY=${xserverManager.getDisplay()}`);
    }
  }

  return options;
}

module.exports = {
  setupX11Forwarding,
  getShellOptions,
};
