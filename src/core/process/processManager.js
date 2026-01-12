/**
 * 进程管理模块
 * 管理SSH/Telnet连接的子进程和终端进程
 */

const { logToFile } = require("../utils/logger");

// 子进程映射表
const childProcesses = new Map();

// 终端进程ID映射
const terminalProcesses = new Map();

// 进程ID计数器
let nextProcessId = 1;

/**
 * 获取下一个进程ID
 */
function getNextProcessId() {
  return nextProcessId++;
}

/**
 * 获取进程信息
 * @param {string|number} processId 进程ID
 * @returns {Object|undefined} 进程信息对象
 */
function getProcess(processId) {
  return childProcesses.get(processId);
}

/**
 * 检查进程是否存在
 * @param {string|number} processId 进程ID
 * @returns {boolean}
 */
function hasProcess(processId) {
  return childProcesses.has(processId);
}

/**
 * 设置进程信息
 * @param {string|number} processId 进程ID
 * @param {Object} processInfo 进程信息对象
 */
function setProcess(processId, processInfo) {
  childProcesses.set(processId, processInfo);
}

/**
 * 删除进程
 * @param {string|number} processId 进程ID
 */
function deleteProcess(processId) {
  childProcesses.delete(processId);
}

/**
 * 获取所有进程的迭代器
 * @returns {IterableIterator<[any, any]>}
 */
function getAllProcesses() {
  return childProcesses.entries();
}

/**
 * 获取进程映射表
 * @returns {Map}
 */
function getProcessMap() {
  return childProcesses;
}

/**
 * 清空所有进程
 */
function clearAllProcesses() {
  childProcesses.clear();
}

/**
 * 获取进程数量
 * @returns {number}
 */
function getProcessCount() {
  return childProcesses.size;
}

/**
 * 获取终端进程
 * @param {string|number} terminalId 终端ID
 * @returns {Object|undefined}
 */
function getTerminalProcess(terminalId) {
  return terminalProcesses.get(terminalId);
}

/**
 * 设置终端进程
 * @param {string|number} terminalId 终端ID
 * @param {Object} processInfo 进程信息
 */
function setTerminalProcess(terminalId, processInfo) {
  terminalProcesses.set(terminalId, processInfo);
}

/**
 * 删除终端进程
 * @param {string|number} terminalId 终端ID
 */
function deleteTerminalProcess(terminalId) {
  terminalProcesses.delete(terminalId);
}

/**
 * 检查终端进程是否存在
 * @param {string|number} terminalId 终端ID
 * @returns {boolean}
 */
function hasTerminalProcess(terminalId) {
  return terminalProcesses.has(terminalId);
}

/**
 * 清理单个进程
 * @param {string|number} processId 进程ID
 * @param {Object} options 清理选项
 * @param {Function} options.onSftpCleanup SFTP清理回调
 * @param {Function} options.onConnectionRelease 连接释放回调
 */
function cleanupProcess(processId, options = {}) {
  const proc = childProcesses.get(processId);
  if (!proc) return;

  const { onSftpCleanup, onConnectionRelease } = options;

  try {
    // 调用SFTP清理回调
    if (onSftpCleanup) {
      onSftpCleanup(processId, proc);
    }

    // 调用连接释放回调
    if (onConnectionRelease && proc.type === "ssh2" && proc.connectionInfo) {
      onConnectionRelease(proc);
    }

    // 移除事件监听器
    if (proc.process) {
      if (proc.process.stdout) {
        proc.process.stdout.removeAllListeners();
      }
      if (proc.process.stderr) {
        proc.process.stderr.removeAllListeners();
      }

      // 对于SSH连接，关闭stream
      if (proc.type === "ssh2" && proc.stream) {
        try {
          proc.stream.close();
          logToFile(`关闭SSH stream: ${processId}`, "INFO");
        } catch (error) {
          logToFile(`Error closing SSH stream ${processId}: ${error.message}`, "ERROR");
        }
      } else {
        // 终止其他类型的进程
        try {
          if (typeof proc.process.kill === "function") {
            proc.process.kill();
          }
        } catch (error) {
          logToFile(`Error killing process ${processId}: ${error.message}`, "ERROR");
        }
      }
    }

    // 删除进程映射
    childProcesses.delete(processId);
    if (proc.config?.tabId && proc.config.tabId !== processId) {
      childProcesses.delete(proc.config.tabId);
    }
  } catch (error) {
    logToFile(`Error cleaning up process ${processId}: ${error.message}`, "ERROR");
  }
}

/**
 * 清理所有进程
 * @param {Object} options 清理选项
 * @param {Function} options.onSftpCleanup SFTP清理回调
 * @param {Function} options.onTransferCleanup 传输清理回调
 * @param {Function} options.onConnectionRelease 连接释放回调
 */
function cleanupAllProcesses(options = {}) {
  const { onSftpCleanup, onTransferCleanup, onConnectionRelease } = options;

  for (const [id, proc] of childProcesses.entries()) {
    try {
      // 调用SFTP清理回调
      if (onSftpCleanup) {
        onSftpCleanup(id, proc);
      }

      // 调用传输清理回调
      if (onTransferCleanup) {
        onTransferCleanup(id, proc);
      }

      // 调用连接释放回调
      if (onConnectionRelease && proc.type === "ssh2" && proc.connectionInfo) {
        onConnectionRelease(proc);
      }

      // 清理进程
      if (proc.process) {
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        if (proc.type === "ssh2" && proc.stream) {
          try {
            proc.stream.close();
            logToFile(`关闭SSH stream (cleanup all): ${id}`, "INFO");
          } catch (error) {
            logToFile(`Error closing SSH stream during cleanup ${id}: ${error.message}`, "ERROR");
          }
        } else {
          try {
            if (typeof proc.process.kill === "function") {
              proc.process.kill();
            }
          } catch (error) {
            logToFile(`Error killing process ${id}: ${error.message}`, "ERROR");
          }
        }
      }
    } catch (error) {
      logToFile(`Error cleaning up process ${id}: ${error.message}`, "ERROR");
    }
  }

  childProcesses.clear();
}

module.exports = {
  // 进程ID管理
  getNextProcessId,

  // 子进程管理
  getProcess,
  hasProcess,
  setProcess,
  deleteProcess,
  getAllProcesses,
  getProcessMap,
  clearAllProcesses,
  getProcessCount,

  // 终端进程管理
  getTerminalProcess,
  setTerminalProcess,
  deleteTerminalProcess,
  hasTerminalProcess,

  // 清理函数
  cleanupProcess,
  cleanupAllProcesses,
};
