// SFTP适配器 - 将原生ssh2 SFTP包装成类似ssh2-sftp-client的接口
// 用于在不改变现有传输代码的情况下实现会话重用

const fs = require("fs");
const path = require("path");

let logToFile = null;

function init(logger) {
  if (logger && logger.logToFile) {
    logToFile = logger.logToFile;
  } else {
    logToFile = (message, type = "INFO") => {
      // Fallback logging
      console.log(`[${type}] ${message}`);
    };
  }
}

// 将原生ssh2 SFTP会话包装成类似ssh2-sftp-client的接口
class SftpAdapter {
  constructor(sftpSession, tabId, sftpCore) {
    this.sftpSession = sftpSession; // 原生ssh2 SFTP对象
    this.tabId = tabId;
    this.sftpCore = sftpCore;
    this.isConnected = true;
  }

  // 模拟ssh2-sftp-client的connect方法（实际上已经连接）
  async connect(config) {
    // 由于我们使用的是已连接的会话，这里只需要返回成功
    logToFile(`SftpAdapter: 复用现有SFTP会话 (tab: ${this.tabId})`, "INFO");
    return Promise.resolve();
  }

  // 实现fastGet方法
  async fastGet(remotePath, localPath, options = {}) {
    return new Promise((resolve, reject) => {
      const { concurrency = 16, chunkSize = 32768, step = null } = options;

      logToFile(`SftpAdapter: 开始下载 ${remotePath} -> ${localPath}`, "DEBUG");

      // 创建本地文件写入流
      const writeStream = fs.createWriteStream(localPath);
      let totalTransferred = 0;

      writeStream.on("error", (error) => {
        logToFile(`SftpAdapter: 写入流错误: ${error.message}`, "ERROR");
        reject(error);
      });

      // 使用原生ssh2 SFTP的createReadStream
      const readStream = this.sftpSession.createReadStream(remotePath, {
        highWaterMark: chunkSize,
      });

      readStream.on("error", (error) => {
        logToFile(`SftpAdapter: 读取流错误: ${error.message}`, "ERROR");
        writeStream.destroy();
        reject(error);
      });

      readStream.on("data", (chunk) => {
        totalTransferred += chunk.length;

        // 调用进度回调
        if (step && typeof step === "function") {
          step(chunk.length, chunk, totalTransferred);
        }
      });

      readStream.on("end", () => {
        logToFile(
          `SftpAdapter: 下载完成 ${remotePath}, 传输 ${totalTransferred} 字节`,
          "DEBUG",
        );
        resolve();
      });

      // 通过管道连接流
      readStream.pipe(writeStream);
    });
  }

  // 实现fastPut方法
  async fastPut(localPath, remotePath, options = {}) {
    return new Promise((resolve, reject) => {
      const { concurrency = 16, chunkSize = 32768, step = null } = options;

      logToFile(`SftpAdapter: 开始上传 ${localPath} -> ${remotePath}`, "DEBUG");

      // 创建本地文件读取流
      const readStream = fs.createReadStream(localPath, {
        highWaterMark: chunkSize,
      });
      let totalTransferred = 0;

      readStream.on("error", (error) => {
        logToFile(`SftpAdapter: 读取流错误: ${error.message}`, "ERROR");
        reject(error);
      });

      // 使用原生ssh2 SFTP的createWriteStream
      const writeStream = this.sftpSession.createWriteStream(remotePath);

      writeStream.on("error", (error) => {
        logToFile(`SftpAdapter: 写入流错误: ${error.message}`, "ERROR");
        readStream.destroy();
        reject(error);
      });

      writeStream.on("close", () => {
        logToFile(
          `SftpAdapter: 上传完成 ${remotePath}, 传输 ${totalTransferred} 字节`,
          "DEBUG",
        );
        resolve();
      });

      readStream.on("data", (chunk) => {
        totalTransferred += chunk.length;

        // 调用进度回调
        if (step && typeof step === "function") {
          step(totalTransferred);
        }
      });

      // 通过管道连接流
      readStream.pipe(writeStream);
    });
  }

  // 实现stat方法
  async stat(remotePath) {
    return new Promise((resolve, reject) => {
      this.sftpSession.stat(remotePath, (err, stats) => {
        if (err) {
          logToFile(
            `SftpAdapter: stat错误 ${remotePath}: ${err.message}`,
            "ERROR",
          );
          reject(err);
        } else {
          resolve(stats);
        }
      });
    });
  }

  // 实现list方法
  async list(remotePath) {
    return new Promise((resolve, reject) => {
      this.sftpSession.readdir(remotePath, (err, list) => {
        if (err) {
          logToFile(
            `SftpAdapter: list错误 ${remotePath}: ${err.message}`,
            "ERROR",
          );
          reject(err);
        } else {
          // 转换为ssh2-sftp-client格式
          const formattedList = list.map((item) => ({
            type: item.attrs.isDirectory() ? "d" : "-",
            name: item.filename,
            size: item.attrs.size,
            modifyTime: item.attrs.mtime * 1000, // 转换为毫秒
            accessTime: item.attrs.atime * 1000,
            rights: {
              user: (item.attrs.mode & parseInt("700", 8)) >> 6,
              group: (item.attrs.mode & parseInt("070", 8)) >> 3,
              other: item.attrs.mode & parseInt("007", 8),
            },
            owner: item.attrs.uid,
            group: item.attrs.gid,
            attrs: item.attrs,
          }));
          resolve(formattedList);
        }
      });
    });
  }

  // 实现mkdir方法
  async mkdir(remotePath, recursive = false) {
    return new Promise((resolve, reject) => {
      if (recursive) {
        // 递归创建目录
        this.mkdirRecursive(remotePath).then(resolve).catch(reject);
      } else {
        this.sftpSession.mkdir(remotePath, (err) => {
          if (err && err.code !== 4) {
            // 4表示目录已存在
            logToFile(
              `SftpAdapter: mkdir错误 ${remotePath}: ${err.message}`,
              "ERROR",
            );
            reject(err);
          } else {
            resolve();
          }
        });
      }
    });
  }

  // 递归创建目录的辅助方法
  async mkdirRecursive(remotePath) {
    const parts = remotePath.split("/").filter(Boolean);
    let currentPath = remotePath.startsWith("/") ? "/" : "";

    for (const part of parts) {
      currentPath = path.posix.join(currentPath, part);

      try {
        await new Promise((resolve, reject) => {
          this.sftpSession.stat(currentPath, (err, stats) => {
            if (err) {
              // 目录不存在，创建它
              this.sftpSession.mkdir(currentPath, (mkdirErr) => {
                if (mkdirErr && mkdirErr.code !== 4) {
                  reject(mkdirErr);
                } else {
                  resolve();
                }
              });
            } else if (stats.isDirectory()) {
              resolve();
            } else {
              reject(new Error(`路径存在但不是目录: ${currentPath}`));
            }
          });
        });
      } catch (error) {
        throw error;
      }
    }
  }

  // 实现end方法（不实际关闭会话，因为它是被管理的）
  async end() {
    logToFile(
      `SftpAdapter: 传输完成，会话返回池中 (tab: ${this.tabId})`,
      "DEBUG",
    );
    // 不关闭会话，让sftpCore管理
    return Promise.resolve();
  }

  // 检查连接状态
  get sftp() {
    return this.sftpSession;
  }
}

// 工厂方法：创建适配器实例
async function createSftpAdapter(tabId, sftpCore) {
  try {
    const sftpSession = await sftpCore.getRawSftpSession(tabId);
    const adapter = new SftpAdapter(sftpSession, tabId, sftpCore);

    logToFile(`SftpAdapter: 创建适配器成功 (tab: ${tabId})`, "DEBUG");
    return adapter;
  } catch (error) {
    logToFile(
      `SftpAdapter: 创建适配器失败 (tab: ${tabId}): ${error.message}`,
      "ERROR",
    );
    throw error;
  }
}

module.exports = {
  init,
  SftpAdapter,
  createSftpAdapter,
};
