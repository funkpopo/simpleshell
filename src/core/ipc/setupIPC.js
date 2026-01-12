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
 * - terminalHandlers.js - 终端处理器
 * - proxyHandlers.js - 代理处理器
 * - settingsHandlers.js - 设置处理器
 * - appHandlers.js - 应用处理器
 * - latencyHandlers.js - 延迟检测处理器
 * - localTerminalHandlers.js - 本地终端处理器
 * - reconnectHandlers.js - 重连处理器
 * - batchHandlers.js - 批量处理器
 */
const { ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { logToFile } = require("../utils/logger");
const { safeHandle } = require("./ipcResponse");
const processManager = require("../process/processManager");
const externalEditorManager = require("../../modules/sftp/externalEditorManager");
const ipQuery = require("../../modules/system-info/ip-query");
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

  // 获取标签页连接状态
  safeHandle(ipcMain, "connection:getTabStatus", async (event, tabId) => {
    try {
      if (!tabId || tabId === "welcome") {
        return { success: true, data: null };
      }

      const processInfo = processManager.getProcess(tabId);

      if (!processInfo) {
        return { success: true, data: null };
      }

      if (processInfo.type === "ssh2") {
        const connectionState = {
          isConnected: processInfo.ready && !!processInfo.stream,
          isConnecting: !processInfo.ready,
          quality: processInfo.ready ? "excellent" : "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: processInfo.config?.host,
          port: processInfo.config?.port,
          username: processInfo.config?.username,
        };
        return { success: true, data: connectionState };
      } else if (processInfo.type === "powershell") {
        const connectionState = {
          isConnected: true,
          isConnecting: false,
          quality: "excellent",
          lastUpdate: Date.now(),
          connectionType: "Local",
          host: "localhost",
        };
        return { success: true, data: connectionState };
      } else if (processInfo.type === "telnet") {
        const connectionState = {
          isConnected: processInfo.ready && !!processInfo.process,
          isConnecting: !processInfo.ready,
          quality: processInfo.ready ? "good" : "offline",
          lastUpdate: Date.now(),
          connectionType: "Telnet",
          host: processInfo.config?.host,
          port: processInfo.config?.port,
        };
        return { success: true, data: connectionState };
      }

      return { success: true, data: null };
    } catch (error) {
      logToFile(`获取标签页连接状态失败: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // IP地址查询API
  safeHandle(ipcMain, "ip:query", async (event, ip = "") => {
    try {
      const proxyManager = require("../proxy/proxy-manager");
      const proxyConfig = proxyManager.getDefaultProxyConfig();
      return await ipQuery.queryIpAddress(ip, logToFile, proxyConfig);
    } catch (error) {
      logToFile(`IP地址查询失败: ${error.message}`, "ERROR");
      return {
        ret: "failed",
        msg: error.message,
      };
    }
  });

  // SSH密钥生成器处理
  safeHandle(ipcMain, "generateSSHKeyPair", async (event, options) => {
    try {
      const crypto = require("crypto");
      const { generateKeyPair } = crypto;
      const util = require("util");
      const generateKeyPairAsync = util.promisify(generateKeyPair);

      const {
        type = "ed25519",
        bits = 256,
        comment = "",
        passphrase = "",
      } = options;

      let keyGenOptions = {};

      if (type === "rsa") {
        keyGenOptions = {
          modulusLength: bits,
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: passphrase ? "aes-256-cbc" : undefined,
            passphrase: passphrase || undefined,
          },
        };
      } else if (type === "ed25519") {
        keyGenOptions = {
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: passphrase ? "aes-256-cbc" : undefined,
            passphrase: passphrase || undefined,
          },
        };
      } else if (type === "ecdsa") {
        const namedCurve =
          bits === 256
            ? "prime256v1"
            : bits === 384
              ? "secp384r1"
              : "secp521r1";
        keyGenOptions = {
          namedCurve: namedCurve,
          publicKeyEncoding: {
            type: "spki",
            format: "pem",
          },
          privateKeyEncoding: {
            type: "pkcs8",
            format: "pem",
            cipher: passphrase ? "aes-256-cbc" : undefined,
            passphrase: passphrase || undefined,
          },
        };
      }

      const { publicKey, privateKey } = await generateKeyPairAsync(
        type,
        keyGenOptions,
      );

      // 格式化公钥为SSH格式
      let sshPublicKey;
      if (type === "rsa") {
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        sshPublicKey = `ssh-rsa ${keyData} ${comment}`;
      } else if (type === "ed25519") {
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        sshPublicKey = `ssh-ed25519 ${keyData} ${comment}`;
      } else {
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        const curveType =
          bits === 256
            ? "ecdsa-sha2-nistp256"
            : bits === 384
              ? "ecdsa-sha2-nistp384"
              : "ecdsa-sha2-nistp521";
        sshPublicKey = `${curveType} ${keyData} ${comment}`;
      }

      return {
        success: true,
        publicKey: sshPublicKey.trim(),
        privateKey: privateKey,
      };
    } catch (error) {
      logToFile(`SSH key generation failed: ${error.message}`, "ERROR");
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 保存SSH密钥到文件
  safeHandle(ipcMain, "saveSSHKey", async (event, options) => {
    try {
      const { dialog } = require("electron");
      const { content, filename } = options;

      const result = await dialog.showSaveDialog({
        defaultPath: filename,
        filters: [
          { name: "SSH Key Files", extensions: ["pub", "pem", "key"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (!result.canceled && result.filePath) {
        await fs.promises.writeFile(result.filePath, content, "utf8");
        return { success: true };
      }

      return { success: false, error: "User cancelled" };
    } catch (error) {
      logToFile(`Save SSH key failed: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

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
