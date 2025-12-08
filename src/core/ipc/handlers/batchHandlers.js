/**
 * IPC批量消息处理器（主进程）
 * 用于接收和转发批量的IPC消息
 */

const { logToFile } = require('../../utils/logger');

/**
 * 注册批量IPC消息处理器
 * @param {Electron.IpcMain} ipcMain - IPC主进程实例
 */
function registerBatchHandlers(ipcMain) {
  // 处理批量进度更新
  ipcMain.on('transfer-progress:batch', (event, progressDataArray) => {
    if (!Array.isArray(progressDataArray)) {
      logToFile('Invalid batch progress data: not an array', 'WARN');
      return;
    }

    // 转发每个进度消息到前端
    for (const progressData of progressDataArray) {
      try {
        event.sender.send('transfer-progress', progressData);
      } catch (error) {
        logToFile(`Error forwarding progress data: ${error.message}`, 'ERROR');
      }
    }
  });

  // 通用批量消息处理器
  // 支持将任何channel的批量消息转发为单独的消息
  ipcMain.on('ipc:batch-forward', (event, { channel, messages }) => {
    if (!channel || !Array.isArray(messages)) {
      logToFile('Invalid batch forward request', 'WARN');
      return;
    }

    // 转发每条消息
    for (const message of messages) {
      try {
        event.sender.send(channel, message);
      } catch (error) {
        logToFile(`Error forwarding batch message to ${channel}: ${error.message}`, 'ERROR');
      }
    }
  });

  // 监听所有 :batch 后缀的channel，自动解包并转发
  const batchChannelPattern = /^(.+):batch$/;

  // 使用通配符监听所有批量消息
  // 注意：Electron的ipcMain不支持通配符，所以我们需要显式注册常见的批量channel
  const commonBatchChannels = [
    'transfer-progress:batch',
    'terminal-output:batch',
    'file-change:batch',
    'log-message:batch'
  ];

  commonBatchChannels.forEach(batchChannel => {
    const match = batchChannel.match(batchChannelPattern);
    if (!match) return;

    const baseChannel = match[1];

    // 如果已经注册过了，跳过
    if (batchChannel === 'transfer-progress:batch') return;

    ipcMain.on(batchChannel, (event, messages) => {
      if (!Array.isArray(messages)) {
        logToFile(`Invalid batch messages for ${batchChannel}: not an array`, 'WARN');
        return;
      }

      // 转发每条消息到基础channel
      for (const message of messages) {
        try {
          event.sender.send(baseChannel, message);
        } catch (error) {
          logToFile(`Error forwarding message from ${batchChannel} to ${baseChannel}: ${error.message}`, 'ERROR');
        }
      }
    });
  });

  logToFile('IPC batch handlers registered', 'INFO');
}

module.exports = {
  registerBatchHandlers
};
