const { BrowserWindow } = require("electron");
const { logToFile } = require("../../utils/logger");
const terminalManager = require("../../../modules/terminal");
const crypto = require("crypto");
const configService = require("../../../services/configService");

/**
 * SSH/Telnet连接相关的IPC处理器
 * 这是一个高风险模块，涉及多个全局状态的管理
 */
class SSHHandlers {
  /**
   * @param {Object} dependencies - 依赖注入
   * @param {Map} dependencies.childProcesses - 子进程映射
   * @param {Object} dependencies.connectionManager - 连接管理器
   * @param {Object} dependencies.sftpCore - SFTP核心模块
   * @param {Object} dependencies.sftpTransfer - SFTP传输模块
   * @param {Function} dependencies.getNextProcessId - 获取下一个进程ID的函数
   * @param {Function} dependencies.getLatencyHandlers - 获取延迟处理器的函数
   */
  constructor(dependencies) {
    this.childProcesses = dependencies.childProcesses;
    this.connectionManager = dependencies.connectionManager;
    this.sftpCore = dependencies.sftpCore;
    this.sftpTransfer = dependencies.sftpTransfer;
    this.getNextProcessId = dependencies.getNextProcessId;
    this.getLatencyHandlers = dependencies.getLatencyHandlers;
    
    // 待处理的认证请求
    this.pendingAuthRequests = new Map();
    
    // 已知主机指纹缓存 (host:port -> fingerprint)
    this.knownHostsCache = new Map();
  }

  getHandlers() {
    return [
      {
        channel: "terminal:startSSH",
        category: "terminal",
        handler: this.startSSH.bind(this),
      },
      {
        channel: "terminal:startTelnet",
        category: "terminal",
        handler: this.startTelnet.bind(this),
      },
      {
        channel: "ssh:auth-response",
        category: "terminal",
        handler: this.handleAuthResponse.bind(this),
      },
      {
        channel: "terminal:updateConnectionCredentials",
        category: "terminal",
        handler: this.updateConnectionCredentials.bind(this),
      },
    ];
  }

  /**
   * 处理认证响应
   */
  async handleAuthResponse(event, response) {
    const { requestId, ...authData } = response;
    
    if (!requestId || !this.pendingAuthRequests.has(requestId)) {
      logToFile(`Invalid auth response: requestId=${requestId}`, "WARN");
      return { success: false, error: "Invalid request ID" };
    }
    
    const pendingRequest = this.pendingAuthRequests.get(requestId);
    this.pendingAuthRequests.delete(requestId);
    
    if (authData.cancelled) {
      pendingRequest.reject(new Error("Authentication cancelled by user"));
      return { success: false, cancelled: true };
    }
    
    pendingRequest.resolve(authData);
    return { success: true };
  }

  /**
   * 更新连接凭据（用于保存自动登录信息）
   */
  async updateConnectionCredentials(event, connectionId, credentials) {
    try {
      if (!connectionId || !credentials) {
        return { success: false, error: "Invalid parameters" };
      }
      
      // 加载现有连接配置
      const connections = configService.loadConnections();
      
      // 递归查找并更新连接
      const updateConnection = (items) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type === "connection" && item.id === connectionId) {
            // 更新凭据
            if (credentials.username) {
              items[i].username = credentials.username;
            }
            if (credentials.password !== undefined) {
              items[i].password = credentials.password;
            }
            if (credentials.privateKeyPath !== undefined) {
              items[i].privateKeyPath = credentials.privateKeyPath;
            }
            if (credentials.authType) {
              items[i].authType = credentials.authType;
            }
            return true;
          }
          if (item.type === "group" && Array.isArray(item.items)) {
            if (updateConnection(item.items)) {
              return true;
            }
          }
        }
        return false;
      };
      
      const updated = updateConnection(connections);
      
      if (updated) {
        configService.saveConnections(connections);
        logToFile(`Updated credentials for connection: ${connectionId}`, "INFO");
        
        // 通知前端连接配置已更改
        const windows = BrowserWindow.getAllWindows();
        for (const win of windows) {
          if (win && !win.isDestroyed() && win.webContents) {
            win.webContents.send("connections-changed");
          }
        }
        
        return { success: true };
      } else {
        return { success: false, error: "Connection not found" };
      }
    } catch (error) {
      logToFile(`Failed to update connection credentials: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  }

  /**
   * 计算主机密钥指纹
   */
  _computeFingerprint(key) {
    try {
      const hash = crypto.createHash("sha1");
      hash.update(key);
      const fingerprint = hash.digest("hex");
      // 格式化为 xx:xx:xx:xx... 形式
      return fingerprint.match(/.{2}/g).join(":");
    } catch (error) {
      logToFile(`Failed to compute fingerprint: ${error.message}`, "ERROR");
      return null;
    }
  }

  /**
   * 检查主机密钥是否已知且匹配
   */
  _checkHostKey(host, port, fingerprint) {
    const hostKey = `${host}:${port || 22}`;
    const knownFingerprint = this.knownHostsCache.get(hostKey);
    
    if (!knownFingerprint) {
      return { known: false, changed: false };
    }
    
    if (knownFingerprint !== fingerprint) {
      return { known: true, changed: true, previousFingerprint: knownFingerprint };
    }
    
    return { known: true, changed: false };
  }

  /**
   * 保存主机密钥
   */
  _saveHostKey(host, port, fingerprint) {
    const hostKey = `${host}:${port || 22}`;
    this.knownHostsCache.set(hostKey, fingerprint);
  }

  /**
   * 请求用户认证（发送请求到渲染进程并等待响应）
   */
  async _requestUserAuth(tabId, authData) {
    const mainWindow = this._getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      throw new Error("No main window available for authentication");
    }
    
    const requestId = `auth_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return new Promise((resolve, reject) => {
      // 设置超时（5分钟）
      const timeout = setTimeout(() => {
        if (this.pendingAuthRequests.has(requestId)) {
          this.pendingAuthRequests.delete(requestId);
          reject(new Error("Authentication timeout"));
        }
      }, 5 * 60 * 1000);
      
      // 存储待处理请求
      this.pendingAuthRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeout);
          resolve(data);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        tabId,
        authData,
      });
      
      // 发送认证请求到渲染进程
      mainWindow.webContents.send("ssh:auth-request", {
        requestId,
        tabId,
        ...authData,
      });
      
      logToFile(`Sent auth request: ${requestId} for tab ${tabId}`, "INFO");
    });
  }

  _getMainWindow() {
    const windows = BrowserWindow.getAllWindows();
    if (!windows || windows.length === 0) return null;
    const mainWindow = windows[0];
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    return mainWindow;
  }

  _broadcastTopConnections() {
    try {
      const lastConnections = this.connectionManager.getLastConnections(5);
      const windows = BrowserWindow.getAllWindows();
      for (const win of windows) {
        if (win && !win.isDestroyed() && win.webContents) {
          win.webContents.send("top-connections-changed", lastConnections);
        }
      }
    } catch {
      // ignore broadcast errors
    }
  }

  _setupStreamEventListeners(stream, processId, sshConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();
    let buffer = Buffer.from([]);
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024; // 10MB 缓冲区上限
    let isPaused = false;

    const dataHandler = (data) => {
      try {
        // 检查缓冲区大小，防止无限增长
        if (buffer.length + data.length > MAX_BUFFER_SIZE) {
          logToFile(`Buffer overflow prevented for processId ${processId}, discarding old data`, "WARN");
          buffer = data; // 丢弃旧数据，只保留新数据
        } else {
          buffer = Buffer.concat([buffer, data]);
        }

        try {
          const bufferStr = buffer.toString();
          const containsChinese = /[\u4e00-\u9fa5]/.test(bufferStr);
          let output = containsChinese
            ? Buffer.from(buffer).toString("utf8")
            : buffer.toString("utf8");

          const processedOutput = terminalManager.processOutput(processId, output);

          if (mainWindow && !mainWindow.isDestroyed()) {
            // 背压处理：检查渲染进程是否能跟上
            mainWindow.webContents.send(`process:output:${processId}`, processedOutput);
            // 如果IPC队列过长，暂停流
            if (!isPaused && mainWindow.webContents.getProcessId && buffer.length > 1024 * 1024) {
              stream.pause();
              isPaused = true;
              setTimeout(() => {
                if (!stream.destroyed) {
                  stream.resume();
                  isPaused = false;
                }
              }, 100);
            }
          }
          buffer = Buffer.from([]);
        } catch (error) {
          logToFile(`Failed to convert buffer to string: ${error.message}`, "ERROR");
          buffer = Buffer.from([]); // 错误时也清理缓冲区
        }
      } catch (error) {
        logToFile(`Error handling stream data: ${error.message}`, "ERROR");
        buffer = Buffer.from([]); // 错误时清理缓冲区
      }
    };

    const extendedDataHandler = (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\x1b[31m${data.toString("utf8")}\x1b[0m`
          );
        }
      } catch (error) {
        logToFile(`Error handling extended data: ${error.message}`, "ERROR");
      }
    };

    const closeHandler = () => {
      logToFile(`SSH stream closed for processId: ${processId}`, "INFO");

      // 清理事件监听器，防止内存泄漏
      stream.removeListener("data", dataHandler);
      stream.removeListener("extended data", extendedDataHandler);
      stream.removeListener("close", closeHandler);

      if (sshConfig.tabId && mainWindow && !mainWindow.isDestroyed()) {
        const connectionStatus = {
          isConnected: false,
          isConnecting: false,
          quality: "offline",
          lastUpdate: Date.now(),
          connectionType: "SSH",
          host: sshConfig.host,
          port: sshConfig.port,
          username: sshConfig.username,
        };
        mainWindow.webContents.send("tab-connection-status", {
          tabId: sshConfig.tabId,
          connectionStatus,
        });
      }

      const procInfo = this.childProcesses.get(processId);
      if (procInfo && procInfo.ready && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n\x1b[33m*** SSH连接已断开 ***\x1b[0m\r\n`
        );
      }

      // 清理SFTP传输
      if (this.sftpTransfer?.cleanupActiveTransfersForTab) {
        this.sftpTransfer.cleanupActiveTransfersForTab(processId).catch((err) => {
          logToFile(`Error cleaning up SFTP transfers: ${err.message}`, "ERROR");
        });
        if (sshConfig.tabId && sshConfig.tabId !== processId) {
          this.sftpTransfer.cleanupActiveTransfersForTab(sshConfig.tabId).catch((err) => {
            logToFile(`Error cleaning up SFTP transfers for tabId: ${err.message}`, "ERROR");
          });
        }
      }

      // 清理SFTP操作
      if (this.sftpCore?.clearPendingOperationsForTab) {
        this.sftpCore.clearPendingOperationsForTab(processId);
        if (sshConfig.tabId) this.sftpCore.clearPendingOperationsForTab(sshConfig.tabId);
      }

      // 清理SFTP会话池
      try {
        if (this.sftpCore?.closeAllSftpSessionsForTab) {
          this.sftpCore.closeAllSftpSessionsForTab(processId);
          if (sshConfig.tabId) this.sftpCore.closeAllSftpSessionsForTab(sshConfig.tabId);
        }
      } catch (err) {
        logToFile(`Error closing SFTP sessions on SSH close: ${err.message}`, "ERROR");
      }

      const shouldReleaseConnection = Boolean(connectionInfo?.intentionalClose);
      if (shouldReleaseConnection) {
        // 仅在用户主动关闭时释放连接引用，避免阻断自动重连
        this.connectionManager.releaseSSHConnection(
          connectionInfo.key,
          sshConfig.tabId,
        );
      } else {
        logToFile(
          `SSH stream closed without intentional flag, keeping connection for auto-reconnect: ${connectionInfo.key}`,
          "DEBUG",
        );
      }

      // 清理进程信息
      this.childProcesses.delete(processId);
      if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
    };

    // 注册事件监听器
    stream.on("data", dataHandler);
    stream.on("extended data", extendedDataHandler);
    stream.on("close", closeHandler);
  }

  _setupTelnetEventListeners(telnet, processId, telnetConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();

    telnet.on("data", (data) => {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(`process:output:${processId}`, data.toString());
        }
      } catch (error) {
        logToFile(`Error handling Telnet data: ${error.message}`, "ERROR");
      }
    });

    telnet.on("error", (err) => {
      logToFile(`Telnet error for processId ${processId}: ${err.message}`, "ERROR");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接错误: ${err.message} ***\r\n`
        );
        mainWindow.webContents.send(`process:exit:${processId}`, { code: 1, signal: null });
      }

      this.connectionManager.releaseTelnetConnection(connectionInfo.key, telnetConfig.tabId);
    });

    telnet.on("end", () => {
      logToFile(`Telnet connection ended for processId ${processId}`, "INFO");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接已关闭 ***\r\n`
        );
        mainWindow.webContents.send(`process:exit:${processId}`, { code: 0, signal: null });
      }

      this.connectionManager.releaseTelnetConnection(connectionInfo.key, telnetConfig.tabId);
    });

    telnet.on("timeout", () => {
      logToFile(`Telnet connection timeout for processId ${processId}`, "WARN");

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(
          `process:output:${processId}`,
          `\r\n*** Telnet连接超时 ***\r\n`
        );
      }
    });
  }

  _createProcessInfo(client, connectionInfo, config, type) {
    return {
      process: client,
      connectionInfo,
      listeners: new Set(),
      config,
      type,
      ready: connectionInfo.ready,
      editorMode: false,
      commandBuffer: "",
      lastOutputLines: [],
      outputBuffer: "",
      isRemote: true,
    };
  }

  /**
   * 检查错误是否为认证失败
   */
  _isAuthenticationError(error) {
    if (this._isAuthCancelledError(error)) {
      return false;
    }

    const msg = String(error?.message || "").toLowerCase();
    return (
      msg.includes("authentication") ||
      msg.includes("auth fail") ||
      msg.includes("all configured authentication methods failed") ||
      msg.includes("permission denied") ||
      msg.includes("publickey") ||
      msg.includes("password") ||
      msg.includes("keyboard-interactive")
    );
  }

  /**
   * 检查错误是否为用户取消认证
   */
  _isAuthCancelledError(error) {
    const rawMessage = String(error?.message || "");
    const lowerMessage = rawMessage.toLowerCase();
    return (
      lowerMessage.includes("cancelled") ||
      lowerMessage.includes("canceled") ||
      rawMessage.includes("取消")
    );
  }

  async startSSH(event, sshConfig) {
    const processId = this.getNextProcessId();
    const mainWindow = this._getMainWindow();

    if (!sshConfig || !sshConfig.host) {
      logToFile("Invalid SSH configuration", "ERROR");
      throw new Error("Invalid SSH configuration");
    }

    // 最大重试次数（用于认证失败后重试）
    const maxAuthRetries = 3;
    let authRetryCount = 0;
    let finalConfig = { ...sshConfig };
    let lastAuthResult = null;

    // 检查是否需要预先认证（没有用户名或密码/密钥）
    const needsPreAuth = !sshConfig.username || 
      (!sshConfig.password && !sshConfig.privateKeyPath && sshConfig.authType !== "privateKey");

    while (authRetryCount <= maxAuthRetries) {
      try {
        // 如果需要预先认证（第一次）或者上次认证失败需要重试
        if (needsPreAuth && authRetryCount === 0) {
          logToFile(`SSH connection requires authentication for ${sshConfig.host}`, "INFO");
          
          const authResult = await this._requestUserAuth(sshConfig.tabId, {
            step: "hostVerify",
            host: sshConfig.host,
            port: sshConfig.port || 22,
            serverVersion: null,
            fingerprint: null,
            fingerprintChanged: false,
            requireCredentials: true,
            connectionId: sshConfig.id,
            existingUsername: sshConfig.username || "",
            isRetry: false,
          });
          
          if (authResult.cancelled) {
            throw new Error("Authentication cancelled by user");
          }
          
          lastAuthResult = authResult;
          finalConfig = {
            ...sshConfig,
            username: authResult.username || sshConfig.username,
            password: authResult.password || sshConfig.password,
            privateKeyPath: authResult.privateKeyPath || sshConfig.privateKeyPath,
            authType: authResult.authType || sshConfig.authType || "password",
          };
        }

        // 尝试建立SSH连接
        const connectionInfo = await this.connectionManager.getSSHConnection(finalConfig);
        this._broadcastTopConnections();
        const ssh = connectionInfo.client;

        if (finalConfig.tabId) {
          this.connectionManager.addTabReference(finalConfig.tabId, connectionInfo.key);
        }

        // 存储进程信息
        const procInfo = this._createProcessInfo(ssh, connectionInfo, finalConfig, "ssh2");
        this.childProcesses.set(processId, procInfo);
        if (finalConfig.tabId) {
          this.childProcesses.set(finalConfig.tabId, { ...procInfo });
        }

        let result;
        if (connectionInfo.ready) {
          logToFile(`复用现有SSH连接: ${connectionInfo.key}`, "INFO");

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n*** ${finalConfig.host} SSH连接已建立（复用现有连接） ***\r\n`
            );
          }

          result = await this._createSSHShell(ssh, processId, finalConfig, connectionInfo);
        } else {
          result = await this._waitForSSHReady(ssh, processId, finalConfig, connectionInfo);
        }

        // 连接成功，如果用户选择了"下次自动登录"，保存凭据
        if (lastAuthResult?.autoLogin && sshConfig.id) {
          await this.updateConnectionCredentials(event, sshConfig.id, {
            username: finalConfig.username,
            password: finalConfig.password,
            privateKeyPath: finalConfig.privateKeyPath,
            authType: finalConfig.authType,
          });
        }

        return result;

      } catch (error) {
        logToFile(`SSH connection attempt ${authRetryCount + 1} failed: ${error.message}`, "ERROR");

        // 检查是否为认证错误
        if (this._isAuthenticationError(error) && authRetryCount < maxAuthRetries) {
          authRetryCount++;
          logToFile(`Authentication failed, prompting user for credentials (attempt ${authRetryCount}/${maxAuthRetries})`, "INFO");

          // 清理之前的连接尝试
          this.childProcesses.delete(processId);
          if (finalConfig.tabId) this.childProcesses.delete(finalConfig.tabId);

          // 显示认证对话框让用户重新输入凭据
          try {
            const authResult = await this._requestUserAuth(sshConfig.tabId, {
              step: "hostVerify",
              host: sshConfig.host,
              port: sshConfig.port || 22,
              serverVersion: null,
              fingerprint: null,
              fingerprintChanged: false,
              requireCredentials: true,
              connectionId: sshConfig.id,
              existingUsername: finalConfig.username || sshConfig.username || "",
              isRetry: true,
              errorMessage: error.message,
            });

            if (authResult.cancelled) {
              throw new Error("Authentication cancelled by user");
            }

            lastAuthResult = authResult;
            finalConfig = {
              ...sshConfig,
              username: authResult.username || finalConfig.username,
              password: authResult.password,  // 使用新密码
              privateKeyPath: authResult.privateKeyPath || finalConfig.privateKeyPath,
              authType: authResult.authType || finalConfig.authType || "password",
            };

            // 继续循环重试
            continue;

          } catch (authError) {
            logToFile(`User cancelled authentication: ${authError.message}`, "INFO");
            throw authError;
          }
        }

        // 非认证错误或已达到最大重试次数
        throw error;
      }
    }

    throw new Error("Max authentication retries exceeded");
  }

  _createSSHShell(ssh, processId, sshConfig, connectionInfo) {
    return new Promise((resolve, reject) => {
      ssh.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (err, stream) => {
        if (err) {
          logToFile(`SSH shell error for processId ${processId}: ${err.message}`, "ERROR");
          this.connectionManager.releaseSSHConnection(connectionInfo.key, sshConfig.tabId);
          this.childProcesses.delete(processId);
          if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
          return reject(err);
        }

        // 更新进程信息中的stream
        const procToUpdate = this.childProcesses.get(processId);
        if (procToUpdate) procToUpdate.stream = stream;
        const tabProcToUpdate = this.childProcesses.get(sshConfig.tabId);
        if (tabProcToUpdate) tabProcToUpdate.stream = stream;

        this._setupStreamEventListeners(stream, processId, sshConfig, connectionInfo);

        // 注册延迟检测
        const latencyHandlers = this.getLatencyHandlers();
        if (latencyHandlers && sshConfig.tabId) {
          try {
            latencyHandlers.latencyService.registerSSHConnection(
              sshConfig.tabId,
              ssh,
              sshConfig.host,
              sshConfig.port || 22,
              sshConfig.proxy || null
            );
            logToFile(`已为SSH连接注册延迟检测: ${sshConfig.tabId}`, "DEBUG");
          } catch (latencyError) {
            logToFile(`延迟检测注册失败: ${latencyError.message}`, "WARN");
          }
        }

        resolve(processId);
      });
    });
  }

  _waitForSSHReady(ssh, processId, sshConfig, connectionInfo) {
    const mainWindow = this._getMainWindow();

    return new Promise((resolve, reject) => {
      let settled = false;
      let reconnectWaitStarted = false;
      let reconnectTimeoutId = null;

      const connectionKey = connectionInfo?.key;
      const sshPool = this.connectionManager?.sshConnectionPool;
      const reconnectManager = sshPool?.reconnectionManager;

      const getLatestClient = () => {
        const latest = sshPool?.connections?.get(connectionKey);
        return latest?.client || ssh;
      };

      const startWaitForReconnect = () => {
        if (reconnectWaitStarted || !reconnectManager || !connectionKey) return;
        reconnectWaitStarted = true;

        // 给用户一次性提示：正在等待代理/VPN/网络恢复并自动重试
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n连接未就绪，正在等待代理/VPN/网络恢复并自动重试（最多1分钟）...\r\n`,
            );
          }
        } catch {}

        reconnectManager
          .waitForReconnect(connectionKey, 60_000)
          .then(() => {
            // 走统一成功路径
            readyHandler(true);
          })
          .catch((e) => {
            errorHandler(e);
          });
      };

      const cleanup = () => {
        ssh.removeListener("ready", readyHandler);
        ssh.removeListener("error", errorHandler);
        if (reconnectTimeoutId) {
          clearTimeout(reconnectTimeoutId);
          reconnectTimeoutId = null;
        }
      };

      const connectionTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        logToFile("SSH connection timed out after 60 seconds", "ERROR");
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n自动重连超时（1分钟），请检查代理/VPN/网络后手动重连\r\n`
          );
        }
        this.connectionManager.releaseSSHConnection(connectionInfo.key, sshConfig.tabId);
        reject(new Error("SSH connection timeout"));
      }, 60_000);

      const readyHandler = (fromReconnectManager = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);
        cleanup();

        // 更新进程状态
        const procInfo = this.childProcesses.get(processId);
        if (procInfo) procInfo.ready = true;
        if (sshConfig.tabId) {
          const tabProcInfo = this.childProcesses.get(sshConfig.tabId);
          if (tabProcInfo) tabProcInfo.ready = true;

          if (mainWindow && !mainWindow.isDestroyed()) {
            const connectionStatus = {
              isConnected: true,
              isConnecting: false,
              quality: "excellent",
              lastUpdate: Date.now(),
              connectionType: "SSH",
              host: sshConfig.host,
              port: sshConfig.port,
              username: sshConfig.username,
            };
            mainWindow.webContents.send("tab-connection-status", {
              tabId: sshConfig.tabId,
              connectionStatus,
            });
          }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${sshConfig.host} SSH连接已建立 ***\r\n`
          );
        }

        const clientToUse = fromReconnectManager ? getLatestClient() : ssh;
        this._createSSHShell(clientToUse, processId, sshConfig, connectionInfo)
          .then(resolve)
          .catch(reject);
      };

      const errorHandler = (err) => {
        if (settled) return;
        // 若已进入重连状态机，则不要立刻失败，改为等待重连结果
        if (!reconnectWaitStarted && reconnectManager && connectionKey) {
          const st = reconnectManager.getSessionStatus(connectionKey);
          if (st && (st.state === "pending" || st.state === "reconnecting")) {
            startWaitForReconnect();
            return;
          }
        }

        settled = true;
        clearTimeout(connectionTimeout);
        cleanup();
        logToFile(
          `SSH connection error for processId ${processId}: ${err?.message || err}`,
          "ERROR",
        );

        if (sshConfig.tabId && mainWindow && !mainWindow.isDestroyed()) {
          const connectionStatus = {
            isConnected: false,
            isConnecting: false,
            quality: "offline",
            lastUpdate: Date.now(),
            connectionType: "SSH",
            host: sshConfig.host,
            port: sshConfig.port,
            username: sshConfig.username,
            error: err?.message || String(err),
          };
          mainWindow.webContents.send("tab-connection-status", {
            tabId: sshConfig.tabId,
            connectionStatus,
          });
        }

        this.connectionManager.releaseSSHConnection(connectionInfo.key, sshConfig.tabId);
        this.childProcesses.delete(processId);
        if (sshConfig.tabId) this.childProcesses.delete(sshConfig.tabId);
        reject(err);
      };

      // 注册事件监听器
      ssh.on("ready", readyHandler);
      ssh.on("error", errorHandler);

      // 若创建连接时已经进入重连状态机（比如代理端口 ECONNREFUSED），主动等待
      if (reconnectManager && connectionKey) {
        const st = reconnectManager.getSessionStatus(connectionKey);
        if (st && (st.state === "pending" || st.state === "reconnecting")) {
          startWaitForReconnect();
        }
      }
    });
  }

  async startTelnet(event, telnetConfig) {
    const processId = this.getNextProcessId();
    const mainWindow = this._getMainWindow();

    if (!telnetConfig || !telnetConfig.host) {
      logToFile("Invalid Telnet configuration", "ERROR");
      throw new Error("Invalid Telnet configuration");
    }

    try {
      const connectionInfo = await this.connectionManager.getTelnetConnection(telnetConfig);
      this._broadcastTopConnections();
      const telnet = connectionInfo.client;

      if (telnetConfig.tabId) {
        this.connectionManager.addTabReference(telnetConfig.tabId, connectionInfo.key);
      }

      // 存储进程信息
      const procInfo = this._createProcessInfo(telnet, connectionInfo, telnetConfig, "telnet");
      this.childProcesses.set(processId, procInfo);
      if (telnetConfig.tabId) {
        this.childProcesses.set(telnetConfig.tabId, { ...procInfo });
      }

      if (connectionInfo.ready) {
        logToFile(`复用现有Telnet连接: ${connectionInfo.key}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${telnetConfig.host} Telnet连接已建立（复用现有连接） ***\r\n`
          );
        }

        this._setupTelnetEventListeners(telnet, processId, telnetConfig, connectionInfo);
        return processId;
      } else {
        logToFile(`Telnet连接未就绪`, "ERROR");
        throw new Error("Telnet connection not ready");
      }
    } catch (error) {
      logToFile(`Failed to start Telnet connection: ${error.message}`, "ERROR");
      throw error;
    }
  }
}

module.exports = SSHHandlers;
