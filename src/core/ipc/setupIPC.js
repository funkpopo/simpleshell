/**
 * IPC设置模块
 * 统一的处理器注册入口
 *
 * 所有处理器已迁移到 handlers/ 目录下的独立类中：
 * - dialogHandlers.js - 对话框处理器
 * - windowHandlers.js - 窗口处理器
 * - sshHandlers.js - SSH/Telnet处理器
 * - aiHandlers.js - AI处理器
 * - fileHandlers.js - 文件操作处理器
 * - sftpHandlers.js - SFTP会话和缓存处理器
 * - terminalHandlers.js - 终端处理器
 * - proxyHandlers.js - 代理处理器
 * - settingsHandlers.js - 设置处理器
 * - appHandlers.js - 应用处理器
 * - latencyHandlers.js - 延迟检测处理器
 * - localTerminalHandlers.js - 本地终端处理器
 * - reconnectHandlers.js - 重连处理器
 * - batchHandlers.js - 批量处理器
 * - utilityHandlers.js - 实用工具处理器
 * - connectionHandlers.js - 连接状态处理器
 * - sshKeyHandlers.js - SSH密钥处理器
 * - memoryHandlers.js - 记忆文件处理器
 * - externalEditorHandlers.js - 外部编辑器处理器
 *
 * 处理器注册由 src/core/app/ipcSetup.js 统一管理
 */
const { logToFile } = require("../utils/logger");
const ipcSetup = require("../app/ipcSetup");

function setupIPC(mainWindow) {
  logToFile("setupIPC started", "INFO");

  // 初始化本地终端处理器（需要mainWindow引用）
  ipcSetup.initializeLocalTerminalHandlers(mainWindow);

  logToFile("setupIPC completed successfully", "INFO");
}

module.exports = setupIPC;
