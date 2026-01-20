const { BrowserWindow } = require("electron");
const { logToFile } = require("../../utils/logger");
const terminalManager = require("../../../modules/terminal");

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
    ];
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
    } catch (err) {
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
            const sendResult = mainWindow.webContents.send(`process:output:${processId}`, processedOutput);
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

    const extendedDataHandler = (data, type) => {
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

      // 释放连接引用
      this.connectionManager.releaseSSHConnection(connectionInfo.key, sshConfig.tabId);

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

  async startSSH(event, sshConfig) {
    const processId = this.getNextProcessId();
    const mainWindow = this._getMainWindow();

    if (!sshConfig || !sshConfig.host) {
      logToFile("Invalid SSH configuration", "ERROR");
      throw new Error("Invalid SSH configuration");
    }

    try {
      const connectionInfo = await this.connectionManager.getSSHConnection(sshConfig);
      this._broadcastTopConnections();
      const ssh = connectionInfo.client;

      if (sshConfig.tabId) {
        this.connectionManager.addTabReference(sshConfig.tabId, connectionInfo.key);
      }

      // 存储进程信息
      const procInfo = this._createProcessInfo(ssh, connectionInfo, sshConfig, "ssh2");
      this.childProcesses.set(processId, procInfo);
      if (sshConfig.tabId) {
        this.childProcesses.set(sshConfig.tabId, { ...procInfo });
      }

      if (connectionInfo.ready) {
        logToFile(`复用现有SSH连接: ${connectionInfo.key}`, "INFO");

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n*** ${sshConfig.host} SSH连接已建立（复用现有连接） ***\r\n`
          );
        }

        return this._createSSHShell(ssh, processId, sshConfig, connectionInfo);
      } else {
        return this._waitForSSHReady(ssh, processId, sshConfig, connectionInfo);
      }
    } catch (error) {
      logToFile(`Failed to start SSH connection: ${error.message}`, "ERROR");
      throw error;
    }
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

      const cleanup = () => {
        ssh.removeListener("ready", readyHandler);
        ssh.removeListener("error", errorHandler);
      };

      const connectionTimeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        logToFile("SSH connection timed out after 15 seconds", "ERROR");
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(
            `process:output:${processId}`,
            `\r\n连接超时，请检查网络和服务器状态\r\n`
          );
        }
        this.connectionManager.releaseSSHConnection(connectionInfo.key, sshConfig.tabId);
        reject(new Error("SSH connection timeout"));
      }, 15000);

      const readyHandler = () => {
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

        this._createSSHShell(ssh, processId, sshConfig, connectionInfo)
          .then(resolve)
          .catch(reject);
      };

      const errorHandler = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimeout);
        cleanup();
        logToFile(`SSH connection error for processId ${processId}: ${err.message}`, "ERROR");

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
            error: err.message,
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
