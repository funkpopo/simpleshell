const SftpClient = require("ssh2-sftp-client");
const { logToFile } = require("../../core/utils/logger");

// SFTP会话池配置
const SFTP_SESSION_IDLE_TIMEOUT = 120000; // 空闲超时时间（毫秒）
const MAX_SFTP_SESSIONS_PER_TAB = 1; // 每个标签页的最大会话数量
const MAX_TOTAL_SFTP_SESSIONS = 50; // 总的最大会话数量
const SFTP_HEALTH_CHECK_INTERVAL = 90000; // 健康检查间隔（毫秒）
const SFTP_OPERATION_TIMEOUT = 20000; // 操作超时时间（毫秒）

class SftpManager {
  constructor() {
    // 用于SSH连接的SFTP会话管理
    this.sftpSessions = new Map();
    this.sftpSessionLocks = new Map();
    this.pendingOperations = new Map();

    // 添加 SFTP 会话池健康检查定时器
    this.sftpHealthCheckTimer = null;
  }

  initialize() {
    this.startSftpHealthCheck();
    logToFile("SFTP Manager initialized", "INFO");
  }

  cleanup() {
    this.stopSftpHealthCheck();
    // 关闭所有SFTP会话
    for (const [tabId] of this.sftpSessions) {
      this.closeSftpSession(tabId);
    }
    logToFile("SFTP Manager cleanup completed", "INFO");
  }

  startSftpHealthCheck() {
    // 如果已经有定时器在运行，先清除
    if (this.sftpHealthCheckTimer) {
      clearInterval(this.sftpHealthCheckTimer);
    }

    // 设置定时器，定期检查SFTP会话健康状况
    this.sftpHealthCheckTimer = setInterval(() => {
      this.checkSftpSessionsHealth();
    }, SFTP_HEALTH_CHECK_INTERVAL);

    logToFile("Started SFTP session health check", "INFO");
  }

  stopSftpHealthCheck() {
    if (this.sftpHealthCheckTimer) {
      clearInterval(this.sftpHealthCheckTimer);
      this.sftpHealthCheckTimer = null;
      logToFile("Stopped SFTP session health check", "INFO");
    }
  }

  checkSftpSessionsHealth() {
    try {
      logToFile(
        `Running SFTP health check, active sessions: ${this.sftpSessions.size}`,
        "INFO",
      );

      // 如果会话总数超过限制，关闭最老的会话
      if (this.sftpSessions.size > MAX_TOTAL_SFTP_SESSIONS) {
        logToFile(
          `Too many SFTP sessions (${this.sftpSessions.size}), cleaning up oldest sessions`,
          "WARN",
        );
        let sessionsToClose = this.sftpSessions.size - MAX_TOTAL_SFTP_SESSIONS;

        // 按会话创建时间排序
        const sessionEntries = Array.from(this.sftpSessions.entries());
        sessionEntries.sort((a, b) => a[1].createdAt - b[1].createdAt);

        // 关闭最老的会话
        for (let i = 0; i < sessionsToClose; i++) {
          if (i < sessionEntries.length) {
            const [tabId, _] = sessionEntries[i];
            logToFile(`Closing old SFTP session for tab ${tabId}`, "INFO");
            this.closeSftpSession(tabId);
          }
        }
      }

      // 检查每个会话的健康状况
      for (const [tabId, session] of this.sftpSessions.entries()) {
        // 检查会话是否已存在超过最大空闲时间
        const idleTime = Date.now() - session.lastUsed;
        if (idleTime > SFTP_SESSION_IDLE_TIMEOUT) {
          logToFile(
            `SFTP session ${tabId} idle for ${idleTime}ms, closing`,
            "INFO",
          );
          this.closeSftpSession(tabId);
          continue;
        }

        // 对每个会话进行健康检查 - 尝试执行一个简单的readdir操作
        this.checkSessionAlive(tabId, session);
      }
    } catch (error) {
      logToFile(`Error in SFTP health check: ${error.message}`, "ERROR");
    }
  }

  async checkSessionAlive(tabId, session) {
    try {
      // 创建一个Promise，添加超时处理
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("SFTP health check timeout")), 5000);
      });

      // 创建一个执行基本SFTP操作的Promise
      const checkPromise = new Promise((resolve, reject) => {
        session.sftp.readdir("/", (err, _) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      // 使用Promise.race竞争，哪个先完成就用哪个结果
      await Promise.race([checkPromise, timeoutPromise]);
      // 如果执行到这里，说明会话是健康的
      session.lastChecked = Date.now();
    } catch (error) {
      // 会话检查失败，认为会话已死亡
      logToFile(
        `SFTP session ${tabId} health check failed: ${error.message}, closing session`,
        "ERROR",
      );
      this.closeSftpSession(tabId);
    }
  }

  async getSftpSession(tabId) {
    try {
      // 检查是否已有锁定的会话获取过程
      const checkLock = () => {
        return new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (!this.sftpSessionLocks.has(tabId)) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });
      };

      // 等待锁释放
      if (this.sftpSessionLocks.has(tabId)) {
        logToFile(`Waiting for SFTP session lock for tab ${tabId}`, "INFO");
        await checkLock();
      }

      // 检查是否已有可用会话
      if (this.sftpSessions.has(tabId)) {
        const session = this.sftpSessions.get(tabId);
        session.lastUsed = Date.now();
        logToFile(`Reusing existing SFTP session for tab ${tabId}`, "INFO");
        return session;
      }

      // 获取新会话
      return await this.acquireSftpSession(tabId);
    } catch (error) {
      logToFile(
        `Error getting SFTP session for tab ${tabId}: ${error.message}`,
        "ERROR",
      );
      throw error;
    }
  }

  async acquireSftpSession(tabId) {
    // 设置锁
    this.sftpSessionLocks.set(tabId, true);

    try {
      logToFile(`Acquiring new SFTP session for tab ${tabId}`, "INFO");

      // 从childProcesses获取SSH连接信息
      const { childProcesses } = require("../terminal/process-manager");
      const processInfo = childProcesses.get(tabId);

      if (!processInfo || !processInfo.process || processInfo.type !== "ssh2") {
        throw new Error(`No SSH connection found for tab ${tabId}`);
      }

      const sshClient = processInfo.process;

      // 创建SFTP客户端
      const sftp = new SftpClient();

      // 等待SSH连接就绪
      const checkReady = () => {
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("SSH connection not ready within timeout"));
          }, 10000);

          const checkInterval = setInterval(() => {
            if (processInfo.ready) {
              clearTimeout(timeout);
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });
      };

      await checkReady();

      // 使用现有SSH连接创建SFTP会话
      await new Promise((resolve, reject) => {
        sshClient.sftp((err, sftpStream) => {
          if (err) {
            logToFile(
              `Failed to create SFTP session for tab ${tabId}: ${err.message}`,
              "ERROR",
            );
            reject(err);
            return;
          }

          // 创建会话对象
          const session = {
            sftp: sftpStream,
            tabId: tabId,
            createdAt: Date.now(),
            lastUsed: Date.now(),
            lastChecked: Date.now(),
          };

          // 存储会话
          this.sftpSessions.set(tabId, session);

          logToFile(
            `SFTP session created successfully for tab ${tabId}`,
            "INFO",
          );
          resolve(session);
        });
      });

      const session = this.sftpSessions.get(tabId);
      return session;
    } catch (error) {
      logToFile(
        `Error acquiring SFTP session for tab ${tabId}: ${error.message}`,
        "ERROR",
      );
      throw error;
    } finally {
      // 释放锁
      this.sftpSessionLocks.delete(tabId);
    }
  }

  closeSftpSession(tabId) {
    try {
      const session = this.sftpSessions.get(tabId);
      if (session) {
        // 关闭SFTP连接
        if (session.sftp && typeof session.sftp.end === "function") {
          session.sftp.end();
        }

        // 从会话池中移除
        this.sftpSessions.delete(tabId);

        // 清理待处理的操作
        if (this.pendingOperations.has(tabId)) {
          this.pendingOperations.delete(tabId);
        }

        logToFile(`SFTP session closed for tab ${tabId}`, "INFO");
      }
    } catch (error) {
      logToFile(
        `Error closing SFTP session for tab ${tabId}: ${error.message}`,
        "ERROR",
      );
    }
  }

  enqueueSftpOperation(tabId, operation, options = {}) {
    return new Promise((resolve, reject) => {
      const operationWrapper = {
        operation,
        resolve,
        reject,
        timeout: options.timeout || SFTP_OPERATION_TIMEOUT,
        createdAt: Date.now(),
      };

      // 如果队列不存在，创建队列
      if (!this.pendingOperations.has(tabId)) {
        this.pendingOperations.set(tabId, []);
      }

      // 添加到队列
      const queue = this.pendingOperations.get(tabId);
      queue.push(operationWrapper);

      logToFile(
        `SFTP operation enqueued for tab ${tabId}, queue length: ${queue.length}`,
        "INFO",
      );

      // 处理队列
      this.processSftpQueue(tabId);
    });
  }

  async processSftpQueue(tabId) {
    const queue = this.pendingOperations.get(tabId);
    if (!queue || queue.length === 0) {
      return;
    }

    // 如果已经在处理队列，直接返回
    if (queue.processing) {
      return;
    }

    queue.processing = true;

    try {
      while (queue.length > 0) {
        const operationWrapper = queue.shift();
        const { operation, resolve, reject, timeout } = operationWrapper;

        try {
          // 获取SFTP会话
          const session = await this.getSftpSession(tabId);

          // 设置操作超时
          const timeoutPromise = new Promise((_, timeoutReject) => {
            setTimeout(() => {
              timeoutReject(
                new Error(`SFTP operation timeout after ${timeout}ms`),
              );
            }, timeout);
          });

          // 执行操作
          const result = await Promise.race([
            operation(session.sftp),
            timeoutPromise,
          ]);

          resolve(result);
        } catch (error) {
          logToFile(
            `SFTP operation failed for tab ${tabId}: ${error.message}`,
            "ERROR",
          );
          reject(error);
        }
      }
    } finally {
      queue.processing = false;
    }
  }
}

// 创建单例实例
const sftpManager = new SftpManager();

module.exports = sftpManager;
