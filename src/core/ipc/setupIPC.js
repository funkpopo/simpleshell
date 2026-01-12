/**
 * IPC设置模块
 * 包含所有IPC处理器的注册逻辑
 * 从main.js中提取出来以保持入口文件简洁
 *
 * 注意：大部分处理器已迁移到 handlers/ 目录下的独立类中：
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
 */
const { ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { logToFile } = require("../utils/logger");
const { safeHandle } = require("./ipcResponse");
const processManager = require("../process/processManager");
const externalEditorManager = require("../../modules/sftp/externalEditorManager");
const ipcSetup = require("../app/ipcSetup");

function setupIPC(mainWindow) {
  logToFile("setupIPC started", "INFO");

  // 初始化本地终端处理器（通过ipcSetup模块）
  ipcSetup.initializeLocalTerminalHandlers(mainWindow);

  // 以下处理器已迁移到独立的handler类中：
  // - dialog:* → dialogHandlers.js
  // - window:* → windowHandlers.js
  // - terminal:startSSH/startTelnet → sshHandlers.js
  // - terminal:* → terminalHandlers.js
  // - ai:* → aiHandlers.js
  // - 文件管理相关API → fileHandlers.js
  // - proxy:* → proxyHandlers.js
  // - settings:* → settingsHandlers.js

  // 外部编辑器处理器
  safeHandle(
    ipcMain,
    "external-editor:open",
    async (event, tabId, remotePath) => {
      if (
        !externalEditorManager ||
        typeof externalEditorManager.openFileInExternalEditor !== "function"
      ) {
        return {
          success: false,
          error: "External editor feature not available.",
        };
      }

      if (!tabId || !remotePath) {
        return { success: false, error: "Missing parameters." };
      }

      try {
        return await externalEditorManager.openFileInExternalEditor(
          tabId,
          remotePath,
        );
      } catch (error) {
        logToFile(
          `External editor open failed for ${remotePath}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: error.message };
      }
    },
  );

  // SSH密钥处理器已迁移到 sshKeyHandlers.js
  // - generateSSHKeyPair
  // - saveSSHKey

  // 获取temp目录路径
  const getTempDir = () => {
    const { app } = require("electron");
    if (app.isPackaged) {
      return path.join(path.dirname(app.getPath('exe')), 'temp');
    } else {
      return path.join(app.getAppPath(), 'temp');
    }
  };

  // 保存记忆文件
  safeHandle(ipcMain, "memory:save", async (event, memory) => {
    try {
      const tempDir = getTempDir();
      await fs.promises.mkdir(tempDir, { recursive: true });
      const filepath = path.join(tempDir, 'mem.json');
      await fs.promises.writeFile(filepath, JSON.stringify(memory, null, 2), 'utf-8');
      return { success: true, filepath };
    } catch (error) {
      logToFile(`Save memory failed: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 加载记忆文件
  safeHandle(ipcMain, "memory:load", async () => {
    try {
      const tempDir = getTempDir();
      const filepath = path.join(tempDir, 'mem.json');
      const content = await fs.promises.readFile(filepath, 'utf-8');
      return JSON.parse(content);
    } catch (err) {
      return null;
    }
  });

  // 删除记忆文件
  safeHandle(ipcMain, "memory:delete", async () => {
    try {
      const tempDir = getTempDir();
      const filepath = path.join(tempDir, 'mem.json');
      await fs.promises.unlink(filepath);
      return true;
    } catch (err) {
      return false;
    }
  });

  // 发送输入到进程
  ipcMain.on("terminal:sendInput", (event, { processId, input }) => {
    const processInfo = processManager.getProcess(processId);
    if (!processInfo) {
      logToFile(`Process not found: ${processId}`, "ERROR");
      return;
    }

    try {
      if (processInfo.type === "node-pty") {
        processInfo.process.write(input);
      } else if (processInfo.type === "ssh2" && processInfo.stream) {
        processInfo.stream.write(input);
      } else if (processInfo.type === "telnet" && processInfo.process) {
        processInfo.process.shell((err, stream) => {
          if (err) {
            logToFile(`Error getting telnet shell: ${err.message}`, "ERROR");
            return;
          }
          stream.write(input);
        });
      } else {
        logToFile(
          `Invalid process type or stream for input: ${processId}`,
          "ERROR",
        );
      }
    } catch (error) {
      logToFile(
        `Error sending input to process ${processId}: ${error.message}`,
        "ERROR",
      );
    }
  });

  logToFile("setupIPC completed successfully", "INFO");
}

module.exports = setupIPC;
