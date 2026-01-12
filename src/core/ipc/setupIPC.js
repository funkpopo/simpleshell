/**
 * IPC设置模块
 * 包含所有IPC处理器的注册逻辑
 * 从main.js中提取出来以保持入口文件简洁
 */
const { dialog, ipcMain, shell, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { logToFile } = require("../utils/logger");
const configService = require("../../services/configService");
const sftpCore = require("../transfer/sftp-engine");
const sftpTransfer = require("../../modules/sftp/sftpTransfer");
const externalEditorManager = require("../../modules/sftp/externalEditorManager");
const terminalManager = require("../../modules/terminal");
const commandHistoryService = require("../../modules/terminal/command-history");
const fileCache = require("../utils/fileCache");
const { safeHandle, wrapIpcHandler } = require("./ipcResponse");
const processManager = require("../process/processManager");
const { getPrimaryWindow, safeSendToRenderer } = require("../window/windowManager");
const ipQuery = require("../../modules/system-info/ip-query");
const ipcSetup = require("../app/ipcSetup");
const aiWorkerManager = require("../workers/aiWorkerManager");

function setupIPC(mainWindow) {
  logToFile("setupIPC started", "INFO");

  // 初始化本地终端处理器（通过ipcSetup模块）
  ipcSetup.initializeLocalTerminalHandlers(mainWindow);

  // dialog:* 和 window:* 处理器已迁移到 ipcSetup.js 中的 registerCriticalHandlers()
  // terminal:startSSH 和 terminal:startTelnet 已迁移到 sshHandlers.js
  // terminal:* 处理器已迁移到 terminalHandlers.js

  // AI设置相关IPC处理
  safeHandle(ipcMain, "ai:loadSettings", async () => {
    return configService.loadAISettings();
  });

  safeHandle(ipcMain, "ai:saveSettings", async (event, settings) => {
    return configService.saveAISettings(settings);
  });

  // 新增: 处理API配置的IPC方法
  safeHandle(ipcMain, "ai:saveApiConfig", async (event, config) => {
    try {
      if (logToFile) {
        logToFile(
          `Saving API config (via main.js IPC): ${JSON.stringify({
            id: config.id,
            name: config.name,
            model: config.model,
          })}`,
          "INFO",
        );
      }
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      if (!config.id) config.id = Date.now().toString();
      const existingIndex = settings.configs.findIndex(
        (c) => c.id === config.id,
      );
      if (existingIndex >= 0) {
        settings.configs[existingIndex] = config;
      } else {
        settings.configs.push(config);
      }
      return configService.saveAISettings(settings);
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to save API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  safeHandle(ipcMain, "ai:deleteApiConfig", async (event, configId) => {
    try {
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const originalLength = settings.configs.length;
      settings.configs = settings.configs.filter((c) => c.id !== configId);
      if (settings.current && settings.current.id === configId) {
        if (settings.configs.length > 0) {
          settings.current = { ...settings.configs[0] };
        } else {
          settings.current = {
            apiUrl: "",
            apiKey: "",
            model: "",
            streamEnabled: true,
          };
        }
      }
      if (settings.configs.length !== originalLength) {
        return configService.saveAISettings(settings);
      }
      return true;
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to delete API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  safeHandle(ipcMain, "ai:setCurrentApiConfig", async (event, configId) => {
    try {
      if (logToFile)
        logToFile(
          `Setting current API config with ID (via main.js IPC): ${configId}`,
          "INFO",
        );
      const settings = configService.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const selectedConfig = settings.configs.find((c) => c.id === configId);
      if (selectedConfig) {
        settings.current = { ...selectedConfig };
        return configService.saveAISettings(settings);
      }
      return false;
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to set current API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      return false;
    }
  });

  safeHandle(ipcMain, "ai:sendPrompt", async (event, prompt, settings) => {
    try {
      return await configService.sendAIPrompt(prompt, settings);
    } catch (error) {
      logToFile(`Error sending AI prompt: ${error.message}`, "ERROR");
      return { error: error.message || "发送请求时出错" };
    }
  });

  // 通过Worker线程处理API请求，绕过CORS限制
  safeHandle(ipcMain, "ai:sendAPIRequest", async (event, requestData, isStream) => {
    try {
      // 验证请求数据
      if (!requestData || !requestData.url || !requestData.apiKey || !requestData.model) {
        throw new Error("请先配置 AI API，包括 API 地址、密钥和模型");
      }

      if (!requestData.messages) {
        throw new Error("请求数据无效，缺少消息内容");
      }

      // 确保Worker已创建
      const aiWorker = aiWorkerManager.ensureAIWorker();
      if (!aiWorker) {
        throw new Error("无法创建AI Worker");
      }

      // 生成请求ID
      const requestId = aiWorkerManager.getNextRequestId();

      // 如果是流式请求，保存会话ID
      if (isStream) {
        aiWorkerManager.setCurrentSessionId(requestData.sessionId);
      }

      // 准备发送到Worker的数据
      const workerData = {
        ...requestData,
        isStream,
      };

      // 发送请求到Worker
      return new Promise((resolve, reject) => {
        // 设置请求超时
        const timeoutId = setTimeout(() => {
          aiWorkerManager.deleteRequestCallback(requestId);
          reject(new Error("请求超时"));
        }, 60000); // 60秒超时

        // 存储回调函数
        aiWorkerManager.setRequestCallback(requestId, {
          resolve: (result) => {
            clearTimeout(timeoutId);
            resolve(result);
          },
          reject: (error) => {
            clearTimeout(timeoutId);
            reject(error);
          },
          timestamp: Date.now(),
        });

        // 发送消息到Worker
        aiWorker.postMessage({
          type: "api_request",
          id: requestId,
          data: workerData,
        });

        // 如果是流式请求，立即返回成功
        if (isStream) {
          resolve({ success: true, message: "流式请求已开始" });
        }
      });
    } catch (error) {
      logToFile(`处理AI请求时出错: ${error.message}`, "ERROR");
      return { error: error.message || "处理请求时出错" };
    }
  });

  // 处理中断API请求
  safeHandle(ipcMain, "ai:abortAPIRequest", async (event) => {
    try {
      const currentSessionId = aiWorkerManager.getCurrentSessionId();
      const aiWorker = aiWorkerManager.getAIWorker();
      // 检查是否有当前会话ID
      if (currentSessionId && aiWorker) {
        // 生成取消请求ID
        const cancelRequestId = `cancel_${Date.now()}`;

        // 尝试通过Worker取消请求
        aiWorker.postMessage({
          type: "cancel_request",
          id: cancelRequestId,
          data: {
            sessionId: currentSessionId,
          },
        });

        // 获取主窗口
        const mainWindow = BrowserWindow.getAllWindows()[0];
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
          // 发送中断消息给渲染进程
          mainWindow.webContents.send("stream-end", {
            tabId: "ai",
            aborted: true,
            sessionId: currentSessionId,
          });
        }

        // 清理会话ID和映射
        aiWorkerManager.deleteStreamSession(currentSessionId);
        aiWorkerManager.clearCurrentSessionId();

        return { success: true, message: "请求已中断" };
      } else {
        return { success: false, message: "没有活跃的请求" };
      }
    } catch (error) {
      logToFile(`中断API请求时出错: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 获取可用模型列表
  safeHandle(ipcMain, "ai:fetchModels", async (event, requestData) => {
    try {
      // 确保Worker已创建
      const aiWorker = aiWorkerManager.ensureAIWorker();
      if (!aiWorker) {
        throw new Error("无法创建AI Worker");
      }

      const requestId = aiWorkerManager.getNextRequestId();
      const timeout = 30000; // 30秒超时

      return new Promise((resolve, reject) => {
        // 存储回调
        aiWorkerManager.setRequestCallback(requestId, { resolve, reject });

        // 发送消息到worker
        aiWorker.postMessage({
          id: requestId,
          type: "api_request",
          data: {
            ...requestData,
            type: "models",
          },
        });

        // 设置超时
        setTimeout(() => {
          if (aiWorkerManager.hasRequest(requestId)) {
            aiWorkerManager.deleteRequestCallback(requestId);
            reject(new Error("获取模型列表请求超时"));
          }
        }, timeout);
      });
    } catch (error) {
      logToFile(`获取模型列表失败: ${error.message}`, "ERROR");
      throw error;
    }
  });

  // 文件管理相关API
  safeHandle(ipcMain, "listFiles", async (event, tabId, path, options = {}) => {
    try {
      // 先确保SFTP会话有效
      if (sftpCore && typeof sftpCore.ensureSftpSession === "function") {
        try {
          await sftpCore.ensureSftpSession(tabId);
          logToFile(
            `Successfully ensured SFTP session for tab ${tabId} before listing files`,
            "INFO",
          );
        } catch (sessionError) {
          logToFile(
            `Failed to ensure SFTP session for tab ${tabId}: ${sessionError.message}`,
            "ERROR",
          );
          // 继续处理，让enqueueSftpOperation中的错误处理机制处理潜在问题
        }
      }

      // 使用 SFTP 会话池获取会话，而不是每次都创建新会话
      return sftpCore.enqueueSftpOperation(
        tabId,
        async () => {
          try {
            const sftp = await sftpCore.getSftpSession(tabId);

            return new Promise((resolve, reject) => {
              sftp.readdir(path || ".", (err, list) => {
                if (err) {
                  logToFile(
                    `Failed to list directory for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `无法列出目录: ${err.message}`,
                  });
                }

                const files = list.map((item) => ({
                  name: item.filename,
                  size: item.attrs.size,
                  isDirectory: item.attrs.isDirectory(),
                  modifyTime: new Date(item.attrs.mtime * 1000).toISOString(),
                  mtimeMs: item.attrs.mtime * 1000,
                  permissions: item.attrs.mode,
                }));

                // 非阻塞模式：分批发送，避免一次性大目录阻塞渲染
                const nonBlocking = Boolean(options.nonBlocking);
                const chunkSize = Math.max(
                  50,
                  Math.min(Number(options.chunkSize) || 200, 1000),
                );

                if (nonBlocking && files.length > chunkSize) {
                  const token = `${tabId}:${Date.now()}:${Math.random()
                    .toString(36)
                    .slice(2, 8)}`;
                  const firstChunk = files.slice(0, chunkSize);
                  // 立即返回首批，提升首屏响应
                  resolve({
                    success: true,
                    data: firstChunk,
                    token,
                    total: files.length,
                    chunked: true,
                    path,
                  });

                  // 异步分批推送剩余数据
                  const sender = event?.sender;
                  if (sender) {
                    let index = chunkSize;
                    let chunkIndex = 1;
                    const pushNext = () => {
                      if (index >= files.length) {
                        sender.send("listFiles:chunk", {
                          tabId,
                          path,
                          token,
                          chunkIndex,
                          items: [],
                          done: true,
                          total: files.length,
                        });
                        return;
                      }
                      const end = Math.min(index + chunkSize, files.length);
                      const items = files.slice(index, end);
                      sender.send("listFiles:chunk", {
                        tabId,
                        path,
                        token,
                        chunkIndex,
                        items,
                        done: end >= files.length,
                        total: files.length,
                      });
                      index = end;
                      chunkIndex += 1;
                      // 让出事件循环，避免长任务阻塞
                      setTimeout(pushNext, 0);
                    };
                    setTimeout(pushNext, 0);
                  }
                } else {
                  resolve({ success: true, data: files, path, chunked: false });
                }
              });
            });
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        },
        {
          type: options.type || "readdir",
          path,
          canMerge: options.canMerge || false,
          priority: options.priority || "normal",
        },
      );
    } catch (error) {
      logToFile(
        `List files error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `列出文件失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "copyFile", async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = processManager.getProcess(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 在远程服务器上执行复制命令
            sshClient.exec(
              `cp -r "${sourcePath}" "${targetPath}"`,
              (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to copy file for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `复制文件失败: ${err.message}`,
                  });
                }

                let errorOutput = "";

                stream.on("data", (data) => {
                  // 通常cp命令执行成功不会有输出
                });

                stream.stderr.on("data", (data) => {
                  errorOutput += data.toString();
                });

                stream.on("close", (code) => {
                  if (code === 0) {
                    resolve({ success: true });
                  } else {
                    logToFile(
                      `File copy failed with code ${code} for session ${tabId}: ${errorOutput}`,
                      "ERROR",
                    );
                    resolve({
                      success: false,
                      error: errorOutput || `复制文件失败，错误代码: ${code}`,
                    });
                  }
                });
              },
            );
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Copy file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `复制文件失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "moveFile", async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = processManager.getProcess(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 在远程服务器上执行移动命令
            sshClient.exec(
              `mv "${sourcePath}" "${targetPath}"`,
              (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to move file for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `移动文件失败: ${err.message}`,
                  });
                }

                let errorOutput = "";

                stream.on("data", (data) => {
                  // 通常mv命令执行成功不会有输出
                });

                stream.stderr.on("data", (data) => {
                  errorOutput += data.toString();
                });

                stream.on("close", (code) => {
                  if (code === 0) {
                    resolve({ success: true });
                  } else {
                    logToFile(
                      `File move failed with code ${code} for session ${tabId}: ${errorOutput}`,
                      "ERROR",
                    );
                    resolve({
                      success: false,
                      error: errorOutput || `移动文件失败，错误代码: ${code}`,
                    });
                  }
                });
              },
            );
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Move file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `移动文件失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "deleteFile", async (event, tabId, filePath, isDirectory) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = processManager.getProcess(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 根据是否为目录选择不同的删除命令
            const command = isDirectory
              ? `rm -rf "${filePath}"`
              : `rm "${filePath}"`;

            sshClient.exec(command, (err, stream) => {
              if (err) {
                logToFile(
                  `Failed to delete file for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `删除文件失败: ${err.message}`,
                });
              }

              let errorOutput = "";

              stream.on("data", (data) => {
                // 通常rm命令执行成功不会有输出
              });

              stream.stderr.on("data", (data) => {
                errorOutput += data.toString();
              });

              stream.on("close", (code) => {
                if (code === 0) {
                  resolve({ success: true });
                } else {
                  logToFile(
                    `File deletion failed with code ${code} for session ${tabId}: ${errorOutput}`,
                    "ERROR",
                  );
                  resolve({
                    success: false,
                    error: errorOutput || `删除文件失败，错误代码: ${code}`,
                  });
                }
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Delete file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `删除文件失败: ${error.message}` };
    }
  });

  // 创建文件夹
  safeHandle(ipcMain, "createFolder", async (event, tabId, folderPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            // 创建文件夹
            sftp.mkdir(folderPath, (err) => {
              if (err) {
                logToFile(
                  `Failed to create folder for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `创建文件夹失败: ${err.message}`,
                });
              }

              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Create folder error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `创建文件夹失败: ${error.message}` };
    }
  });

  // 创建文件
  safeHandle(ipcMain, "createFile", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            // 使用writeFile创建一个空文件
            const emptyBuffer = Buffer.from("");
            sftp.writeFile(filePath, emptyBuffer, (err) => {
              if (err) {
                logToFile(
                  `Failed to create file for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `创建文件失败: ${err.message}`,
                });
              }

              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Create file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `创建文件失败: ${error.message}` };
    }
  });

  // 设置文件权限
  safeHandle(
    "setFilePermissions",
    async (event, tabId, filePath, permissions) => {
      try {
        // 使用 SFTP 会话池获取会话
        return sftpCore.enqueueSftpOperation(tabId, async () => {
          try {
            // 查找对应的SSH客户端
            const processInfo = processManager.getProcess(tabId);
            if (
              !processInfo ||
              !processInfo.process ||
              processInfo.type !== "ssh2"
            ) {
              return { success: false, error: "无效的SSH连接" };
            }
            const sshClient = processInfo.process;
            return new Promise((resolve, reject) => {
              // 使用SSH执行chmod命令设置权限
              const command = `chmod ${permissions} "${filePath}"`;
              sshClient.exec(command, (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to set file permissions for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `设置权限失败: ${err.message}`,
                  });
                }

                let stderr = "";
                stream
                  .on("close", (code, signal) => {
                    if (code === 0) {
                      logToFile(
                        `Successfully set permissions ${permissions} for file ${filePath} in session ${tabId}`,
                        "INFO",
                      );
                      resolve({ success: true });
                    } else {
                      const errorMsg =
                        stderr || `chmod命令执行失败，退出码: ${code}`;
                      logToFile(
                        `Failed to set permissions for session ${tabId}: ${errorMsg}`,
                        "ERROR",
                      );
                      resolve({
                        success: false,
                        error: `设置权限失败: ${errorMsg}`,
                      });
                    }
                  })
                  .on("data", (data) => {
                    // 标准输出通常没有内容
                  })
                  .stderr.on("data", (data) => {
                    stderr += data.toString();
                  });
              });
            });
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        });
      } catch (error) {
        logToFile(
          `Set file permissions error for session ${tabId}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: `设置权限失败: ${error.message}` };
      }
    },
  );

  // 获取文件权限
  safeHandle(ipcMain, "getFilePermissions", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);
          return new Promise((resolve, reject) => {
            // 使用SFTP的stat方法获取文件信息
            sftp.stat(filePath, (err, stats) => {
              if (err) {
                logToFile(
                  `Failed to get file permissions for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `获取权限失败: ${err.message}`,
                });
              }

              // 从stats中提取权限信息
              const mode = stats.mode;
              // 提取权限位（去掉文件类型位）
              const permissions = (mode & parseInt("777", 8)).toString(8);

              resolve({
                success: true,
                permissions: permissions.padStart(3, "0"),
                mode: mode,
                stats: stats,
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Get file permissions error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `获取权限失败: ${error.message}` };
    }
  });

  // 批量获取文件权限 - 优化版本，减少 IPC 调用开销
  safeHandle(
    ipcMain,
    "getFilePermissionsBatch",
    async (event, tabId, filePaths) => {
      try {
        if (!Array.isArray(filePaths) || filePaths.length === 0) {
          return { success: true, results: [] };
        }

        // 使用 SFTP 会话池获取会话，所有文件共用一个 SFTP 会话
        return sftpCore.enqueueSftpOperation(tabId, async () => {
          try {
            const sftp = await sftpCore.getSftpSession(tabId);
            const results = [];

            // 使用并发控制，避免同时发起过多请求
            const BATCH_CONCURRENCY = 10;
            const chunks = [];
            for (let i = 0; i < filePaths.length; i += BATCH_CONCURRENCY) {
              chunks.push(filePaths.slice(i, i + BATCH_CONCURRENCY));
            }

            for (const chunk of chunks) {
              const chunkPromises = chunk.map(
                (filePath) =>
                  new Promise((resolve) => {
                    sftp.stat(filePath, (err, stats) => {
                      if (err) {
                        resolve({
                          path: filePath,
                          success: false,
                          error: err.message,
                        });
                      } else {
                        const mode = stats.mode;
                        const permissions = (mode & parseInt("777", 8)).toString(
                          8,
                        );
                        resolve({
                          path: filePath,
                          success: true,
                          permissions: permissions.padStart(3, "0"),
                          mode: mode,
                          stats: stats,
                        });
                      }
                    });
                  }),
              );

              const chunkResults = await Promise.all(chunkPromises);
              results.push(...chunkResults);
            }

            return { success: true, results };
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        });
      } catch (error) {
        logToFile(
          `Batch get file permissions error for session ${tabId}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: `批量获取权限失败: ${error.message}` };
      }
    },
  );

  // 通用批量 IPC 调用处理器
  // 允许渲染进程在一次 IPC 调用中执行多个操作
  safeHandle(ipcMain, "ipc:batchInvoke", async (event, calls) => {
    try {
      if (!Array.isArray(calls) || calls.length === 0) {
        return { success: true, results: [] };
      }

      // 限制单次批量调用的数量，防止滥用
      const MAX_BATCH_SIZE = 100;
      if (calls.length > MAX_BATCH_SIZE) {
        return {
          success: false,
          error: `批量调用数量超过限制 (${MAX_BATCH_SIZE})`,
        };
      }

      // 白名单：只允许批量调用特定的安全操作
      const ALLOWED_BATCH_CHANNELS = new Set([
        "getFilePermissions",
        "getFilePermissionsBatch",
        "listFiles",
        "readFileContent",
        "getAbsolutePath",
        "checkPathExists",
      ]);

      const results = [];

      // 并发执行所有调用
      const promises = calls.map(async (call, index) => {
        try {
          if (!Array.isArray(call) || call.length === 0) {
            return {
              index,
              success: false,
              error: "无效的调用格式",
            };
          }

          const [channel, ...args] = call;

          // 检查白名单
          if (!ALLOWED_BATCH_CHANNELS.has(channel)) {
            return {
              index,
              success: false,
              error: `通道 "${channel}" 不允许批量调用`,
            };
          }

          // 查找处理器并执行
          // 注意: 这里我们需要直接调用对应的处理器逻辑
          // 由于 ipcMain.handle 注册的处理器无法直接调用，我们需要手动路由
          let result;
          switch (channel) {
            case "getFilePermissions": {
              const [tabId, filePath] = args;
              result = await getFilePermissionsInternal(tabId, filePath);
              break;
            }
            case "checkPathExists": {
              const [checkPath] = args;
              const exists = fs.existsSync(checkPath);
              result = { success: true, exists };
              break;
            }
            default:
              result = { success: false, error: `未实现的批量处理器: ${channel}` };
          }

          return { index, ...result };
        } catch (err) {
          return {
            index,
            success: false,
            error: err.message || "执行失败",
          };
        }
      });

      const rawResults = await Promise.all(promises);

      // 按原始顺序排序结果
      rawResults.sort((a, b) => a.index - b.index);
      for (const r of rawResults) {
        const { index, ...rest } = r;
        results.push(rest);
      }

      return { success: true, results };
    } catch (error) {
      logToFile(`Batch invoke error: ${error.message}`, "ERROR");
      return { success: false, error: `批量调用失败: ${error.message}` };
    }
  });

  // 内部函数: 获取单个文件权限（供批量调用使用）
  async function getFilePermissionsInternal(tabId, filePath) {
    try {
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);
          return new Promise((resolve) => {
            sftp.stat(filePath, (err, stats) => {
              if (err) {
                resolve({
                  success: false,
                  error: `获取权限失败: ${err.message}`,
                });
              } else {
                const mode = stats.mode;
                const permissions = (mode & parseInt("777", 8)).toString(8);
                resolve({
                  success: true,
                  permissions: permissions.padStart(3, "0"),
                  mode: mode,
                  stats: stats,
                });
              }
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      return { success: false, error: `获取权限失败: ${error.message}` };
    }
  }

  safeHandle(ipcMain, "downloadFile", async (event, tabId, remotePath) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleDownloadFile !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleDownloadFile is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Download feature not properly initialized.",
      };
    }
    // sftpTransfer.handleDownloadFile signature is: async function handleDownloadFile(event, tabId, remotePath)
    return sftpTransfer.handleDownloadFile(event, tabId, remotePath);
  });

  // 批量下载多个文件
  safeHandle(ipcMain, "downloadFiles", async (event, tabId, files) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleDownloadFiles !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleDownloadFiles is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Batch Download feature not properly initialized.",
      };
    }
    return sftpTransfer.handleDownloadFiles(event, tabId, files);
  });

  // 设置文件所有者/组
  safeHandle(
    "setFileOwnership",
    async (event, tabId, filePath, owner, group) => {
      try {
        // 使用 SFTP 会话池串行化该类操作
        return sftpCore.enqueueSftpOperation(tabId, async () => {
          try {
            // 查找对应的SSH客户端
            const processInfo = processManager.getProcess(tabId);
            if (
              !processInfo ||
              !processInfo.process ||
              processInfo.type !== "ssh2"
            ) {
              return { success: false, error: "无效的SSH连接" };
            }

            // 构建 chown 参数
            const ownerSpec =
              owner && group
                ? `${owner}:${group}`
                : owner && !group
                  ? `${owner}`
                  : !owner && group
                    ? `:${group}`
                    : null;

            if (!ownerSpec) {
              // 没有需要变更的内容
              return { success: true };
            }

            const sshClient = processInfo.process;
            return new Promise((resolve) => {
              const command = `chown ${ownerSpec} "${filePath}"`;
              sshClient.exec(command, (err, stream) => {
                if (err) {
                  logToFile(
                    `Failed to set file ownership for session ${tabId}: ${err.message}`,
                    "ERROR",
                  );
                  return resolve({
                    success: false,
                    error: `设置所有者/组失败: ${err.message}`,
                  });
                }

                let stderr = "";
                stream
                  .on("close", (code) => {
                    if (code === 0) {
                      logToFile(
                        `Successfully set ownership ${ownerSpec} for ${filePath} in session ${tabId}`,
                        "INFO",
                      );
                      resolve({ success: true });
                    } else {
                      const errorMsg =
                        stderr || `chown命令执行失败，退出码: ${code}`;
                      logToFile(
                        `Failed to set ownership for session ${tabId}: ${errorMsg}`,
                        "ERROR",
                      );
                      resolve({
                        success: false,
                        error: `设置所有者/组失败: ${errorMsg}`,
                      });
                    }
                  })
                  .on("data", () => {})
                  .stderr.on("data", (data) => {
                    stderr += data.toString();
                  });
              });
            });
          } catch (error) {
            return { success: false, error: `SFTP会话错误: ${error.message}` };
          }
        });
      } catch (error) {
        logToFile(
          `Set file ownership error for session ${tabId}: ${error.message}`,
          "ERROR",
        );
        return { success: false, error: `设置所有者/组失败: ${error.message}` };
      }
    },
  );

  safeHandle(
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
  // Handle creating remote folder structure
  safeHandle(ipcMain, "createRemoteFolders", async (event, tabId, folderPath) => {
    try {
      const processInfo = processManager.getProcess(tabId);
      if (!processInfo || !processInfo.config || processInfo.type !== "ssh2") {
        return { success: false, error: "Invalid SSH connection" };
      }

      // 使用sftpCore获取SFTP会话
      const sftp = await sftpCore.getSftpSession(tabId);

      // 递归创建目录
      const createDirRecursive = async (dirPath) => {
        const parts = dirPath.split("/").filter(Boolean);
        let currentPath = dirPath.startsWith("/") ? "/" : "";

        for (const part of parts) {
          currentPath = path.posix.join(currentPath, part);

          try {
            await new Promise((resolve, reject) => {
              sftp.stat(currentPath, (err, stats) => {
                if (err) {
                  if (err.code === 2) {
                    // No such file
                    sftp.mkdir(currentPath, (mkdirErr) => {
                      if (mkdirErr && mkdirErr.code !== 4) {
                        // 4 = already exists
                        reject(mkdirErr);
                      } else {
                        resolve();
                      }
                    });
                  } else {
                    reject(err);
                  }
                } else if (stats.isDirectory()) {
                  resolve();
                } else {
                  reject(
                    new Error(
                      `Path exists but is not a directory: ${currentPath}`,
                    ),
                  );
                }
              });
            });
          } catch (error) {
            // 继续处理，目录可能已存在
            logToFile(
              `Warning creating folder ${currentPath}: ${error.message}`,
              "WARN",
            );
          }
        }
      };

      await createDirRecursive(folderPath);
      return { success: true };
    } catch (error) {
      logToFile(`Error creating remote folders: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // Handle SFTP Upload File
  safeHandle(
    "uploadFile",
    async (event, tabId, targetFolder, progressChannel) => {
      // Ensure sftpTransfer module is available
      if (
        !sftpTransfer ||
        typeof sftpTransfer.handleUploadFile !== "function"
      ) {
        logToFile(
          "sftpTransfer.handleUploadFile is not available or not a function.",
          "ERROR",
        );
        return {
          success: false,
          error: "SFTP Upload feature not properly initialized.",
        };
      }

      const processInfo = processManager.getProcess(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh2"
      ) {
        logToFile(
          `Invalid or not ready SSH connection for tabId: ${tabId}`,
          "ERROR",
        );
        return { success: false, error: "无效或未就绪的SSH连接" };
      }

      const mainWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!mainWindow) {
        logToFile("No main window available for dialog.", "ERROR");
        return { success: false, error: "无法显示对话框" };
      }

      // Open file selection dialog
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "选择要上传的文件",
        properties: ["openFile", "multiSelections"],
        buttonLabel: "上传文件",
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }

      try {
        // Call the refactored sftpTransfer function, now passing progressChannel
        return await sftpTransfer.handleUploadFile(
          event,
          tabId,
          targetFolder,
          filePaths,
          progressChannel,
        );
      } catch (error) {
        logToFile(`Error in uploadFile IPC handler: ${error.message}`, "ERROR");

        // 检查是否是由用户取消操作引起的错误
        const isCancelError =
          error.message?.includes("cancel") ||
          error.message?.includes("abort") ||
          error.message?.includes("用户取消") ||
          error.message?.includes("user cancelled");

        // 如果是取消操作，返回成功状态而非错误
        if (isCancelError) {
          logToFile(
            `Upload cancelled by user for tab ${tabId}, suppressing error display`,
            "INFO",
          );

          // 触发目录刷新
          if (sftpCore && typeof sftpCore.enqueueSftpOperation === "function") {
            try {
              // 异步刷新目录，不等待结果
              setTimeout(() => {
                sftpCore
                  .enqueueSftpOperation(
                    tabId,
                    async () => {
                      try {
                        logToFile(
                          `Refreshing directory listing for tab ${tabId} after cancel at path: ${targetFolder}`,
                          "INFO",
                        );
                        return { success: true, refreshed: true };
                      } catch (refreshError) {
                        logToFile(
                          `Error refreshing directory after cancel: ${refreshError.message}`,
                          "WARN",
                        );
                        return { success: false, error: refreshError.message };
                      }
                    },
                    {
                      type: "readdir",
                      path: targetFolder || ".",
                      priority: "high",
                      canMerge: true,
                    },
                  )
                  .catch((err) => {
                    logToFile(
                      `Failed to enqueue refresh operation: ${err.message}`,
                      "WARN",
                    );
                  });
              }, 500); // 延迟500ms执行刷新
            } catch (refreshError) {
              logToFile(
                `Error triggering directory refresh: ${refreshError.message}`,
                "WARN",
              );
            }
          }

          // 返回成功状态，表明这是用户取消操作
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: "用户已取消操作",
          };
        }

        // 其他类型的错误，正常返回错误信息
        return {
          success: false,
          error: `上传文件失败: ${error.message}`,
        };
      }
    },
  );

  // Handle SFTP Upload Dropped Files (from drag-and-drop)
  safeHandle(
    "uploadDroppedFiles",
    async (event, tabId, targetFolder, uploadData, progressChannel) => {
      // Ensure sftpTransfer module is available
      if (
        !sftpTransfer ||
        typeof sftpTransfer.handleUploadFile !== "function"
      ) {
        logToFile(
          "sftpTransfer.handleUploadFile is not available or not a function.",
          "ERROR",
        );
        return {
          success: false,
          error: "SFTP Upload feature not properly initialized.",
        };
      }

      const processInfo = processManager.getProcess(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh2"
      ) {
        logToFile(
          `Invalid or not ready SSH connection for tabId: ${tabId}`,
          "ERROR",
        );
        return { success: false, error: "无效或未就绪的SSH连接" };
      }

      try {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        const tempDir = os.tmpdir();

        // 首先创建远程文件夹结构
        if (uploadData.folders && uploadData.folders.length > 0) {
          const sftp = await sftpCore.getSftpSession(tabId);

          for (const folderPath of uploadData.folders) {
            const remoteFolderPath = path.posix
              .join(targetFolder, folderPath)
              .replace(/\\/g, "/");

            try {
              await new Promise((resolve, reject) => {
                sftp.mkdir(remoteFolderPath, (err) => {
                  if (err) {
                    // 忽略文件夹已存在的错误
                    if (err.code === 4 || err.message.includes("File exists")) {
                      resolve();
                    } else {
                      logToFile(
                        `Error creating folder ${remoteFolderPath}: ${err.message}`,
                        "WARN",
                      );
                      resolve(); // 继续处理，不中断整个上传
                    }
                  } else {
                    logToFile(`Created folder: ${remoteFolderPath}`, "INFO");
                    resolve();
                  }
                });
              });
            } catch (folderError) {
              logToFile(
                `Error creating folder ${remoteFolderPath}: ${folderError.message}`,
                "WARN",
              );
            }
          }
        }

        // 将拖拽的文件数据转换为文件路径数组
        const filePaths = [];
        const filesData = uploadData.files || uploadData; // 兼容旧格式

        // 为每个文件创建临时文件
        for (const fileData of filesData) {
          if (fileData) {
            // 创建临时文件路径，保持相对路径结构
            const relativePath = fileData.relativePath || fileData.name;
            const tempFilePath = path.join(
              tempDir,
              "simpleshell-upload",
              relativePath,
            );
            const tempFileDir = path.dirname(tempFilePath);

            // 确保目录存在
            if (!fs.existsSync(tempFileDir)) {
              fs.mkdirSync(tempFileDir, { recursive: true });
            }

            // 处理分块数据
            let buffer;
            if (fileData.chunks && fileData.isChunked) {
              // 合并分块
              const totalLength = fileData.chunks.reduce(
                (sum, chunk) => sum + chunk.length,
                0,
              );
              buffer = Buffer.alloc(totalLength);
              let offset = 0;
              for (const chunk of fileData.chunks) {
                const chunkBuffer = Buffer.from(chunk);
                chunkBuffer.copy(buffer, offset);
                offset += chunkBuffer.length;
              }
            } else if (fileData.chunks && fileData.chunks.length === 1) {
              // 单块数据
              buffer = Buffer.from(fileData.chunks[0]);
            } else if (fileData.data) {
              // 兼容旧格式
              buffer = Buffer.from(fileData.data);
            } else {
              continue;
            }

            // 将文件内容写入临时文件
            fs.writeFileSync(tempFilePath, buffer);

            // 如果有相对路径，需要保持文件夹结构
            if (fileData.relativePath && fileData.relativePath.includes("/")) {
              // 文件在子文件夹中，需要调整目标路径
              const remoteFilePath = path.posix
                .join(targetFolder, fileData.relativePath)
                .replace(/\\/g, "/");
              filePaths.push({
                localPath: tempFilePath,
                remotePath: remoteFilePath,
              });
            } else {
              filePaths.push(tempFilePath);
            }
          }
        }

        if (filePaths.length === 0) {
          return { success: false, error: "没有有效的文件可上传" };
        }

        // 调用现有的上传处理函数
        // 如果有自定义路径映射，需要特殊处理
        const hasCustomPaths = filePaths.some((f) => typeof f === "object");

        if (hasCustomPaths) {
          // 需要逐个上传文件到指定路径
          let uploadedCount = 0;
          let failedCount = 0;
          const totalFiles = filePaths.length;
          let totalBytesUploaded = 0;
          let totalBytesToUpload = 0;

          // 计算总文件大小
          for (const fileInfo of filePaths) {
            const localPath =
              typeof fileInfo === "string" ? fileInfo : fileInfo.localPath;
            try {
              const stats = fs.statSync(localPath);
              totalBytesToUpload += stats.size;
            } catch (e) {
              // 忽略无法读取的文件
            }
          }

          // 发送初始进度
          if (progressChannel) {
            event.sender.send(progressChannel, {
              tabId,
              progress: 0,
              fileName: "准备上传文件...",
              currentFileIndex: 0,
              totalFiles: totalFiles,
              transferredBytes: 0,
              totalBytes: totalBytesToUpload,
              transferSpeed: 0,
              remainingTime: 0,
            });
          }

          const startTime = Date.now();
          let lastProgressTime = Date.now();
          let lastBytesTransferred = 0;

          for (let i = 0; i < filePaths.length; i++) {
            const fileInfo = filePaths[i];
            const localPath =
              typeof fileInfo === "string" ? fileInfo : fileInfo.localPath;
            const remotePath =
              typeof fileInfo === "string"
                ? path.posix
                    .join(targetFolder, path.basename(fileInfo))
                    .replace(/\\/g, "/")
                : fileInfo.remotePath;

            // 获取远程目录路径
            const remoteDir = path.posix.dirname(remotePath);
            const fileName = path.basename(localPath);

            // 获取当前文件大小
            let currentFileSize = 0;
            try {
              const stats = fs.statSync(localPath);
              currentFileSize = stats.size;
            } catch (e) {
              // 忽略
            }

            // 发送当前文件进度
            if (progressChannel) {
              const now = Date.now();
              const timeDiff = (now - lastProgressTime) / 1000;
              const bytesDiff = totalBytesUploaded - lastBytesTransferred;
              const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
              const remainingBytes = totalBytesToUpload - totalBytesUploaded;
              const remainingTime = speed > 0 ? remainingBytes / speed : 0;

              event.sender.send(progressChannel, {
                tabId,
                fileName: fileName,
                currentFileIndex: i,
                totalFiles: totalFiles,
                progress: Math.floor(
                  (totalBytesUploaded / totalBytesToUpload) * 100,
                ),
                transferredBytes: totalBytesUploaded,
                totalBytes: totalBytesToUpload,
                transferSpeed: speed,
                remainingTime: remainingTime,
              });

              lastProgressTime = now;
              lastBytesTransferred = totalBytesUploaded;
            }

            // 创建单个文件的进度通道
            const singleFileProgressChannel = `${progressChannel}-file-${i}`;
            let currentFileBytesTransferred = 0;

            // 转发单个文件的进度
            const progressHandler = (evt, data) => {
              if (progressChannel) {
                // 更新当前文件的传输字节数
                if (data.transferredBytes !== undefined) {
                  const newBytes =
                    data.transferredBytes - currentFileBytesTransferred;
                  currentFileBytesTransferred = data.transferredBytes;
                  totalBytesUploaded += newBytes;
                }

                const now = Date.now();
                const timeDiff = (now - lastProgressTime) / 1000;
                const bytesDiff = totalBytesUploaded - lastBytesTransferred;
                const speed = timeDiff > 0 ? bytesDiff / timeDiff : 0;
                const remainingBytes = totalBytesToUpload - totalBytesUploaded;
                const remainingTime = speed > 0 ? remainingBytes / speed : 0;
                const overallProgress = Math.floor(
                  (totalBytesUploaded / totalBytesToUpload) * 100,
                );

                event.sender.send(progressChannel, {
                  tabId,
                  currentFileIndex: i,
                  totalFiles: totalFiles,
                  fileName: fileName,
                  progress: overallProgress,
                  transferredBytes: totalBytesUploaded,
                  totalBytes: totalBytesToUpload,
                  transferSpeed: speed,
                  remainingTime: remainingTime,
                });

                if (timeDiff > 0.5) {
                  // 每0.5秒更新速度
                  lastProgressTime = now;
                  lastBytesTransferred = totalBytesUploaded;
                }
              }
            };

            event.sender.on(singleFileProgressChannel, progressHandler);

            // 上传单个文件
            const singleResult = await sftpTransfer.handleUploadFile(
              event,
              tabId,
              remoteDir,
              [localPath],
              singleFileProgressChannel,
            );

            // 清理监听器
            event.sender.removeListener(
              singleFileProgressChannel,
              progressHandler,
            );

            if (singleResult.success) {
              uploadedCount++;
              // 确保在成功后总字节数是正确的
              if (currentFileBytesTransferred < currentFileSize) {
                totalBytesUploaded +=
                  currentFileSize - currentFileBytesTransferred;
              }
            } else {
              failedCount++;
            }
          }

          // 发送完成状态
          if (progressChannel) {
            event.sender.send(progressChannel, {
              tabId,
              progress: 100,
              operationComplete: true,
              fileName: "所有文件上传完成",
              currentFileIndex: totalFiles,
              totalFiles: totalFiles,
              transferredBytes: totalBytesUploaded,
              totalBytes: totalBytesToUpload,
              transferSpeed: 0,
              remainingTime: 0,
              successfulFiles: uploadedCount,
              failedFiles: failedCount,
            });
          }

          // 清理临时文件
          try {
            const tempUploadDir = path.join(tempDir, "simpleshell-upload");
            if (fs.existsSync(tempUploadDir)) {
              fs.rmSync(tempUploadDir, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            logToFile(
              `Error cleaning up temp files: ${cleanupError.message}`,
              "WARN",
            );
          }

          return {
            success: failedCount === 0,
            uploadedCount,
            totalFiles,
            failedCount,
          };
        } else {
          // 所有文件上传到同一目录
          const uploadPaths = filePaths.map((f) =>
            typeof f === "string" ? f : f.localPath,
          );
          const result = await sftpTransfer.handleUploadFile(
            event,
            tabId,
            targetFolder,
            uploadPaths,
            progressChannel,
          );

          // 清理临时文件
          try {
            const tempUploadDir = path.join(tempDir, "simpleshell-upload");
            if (fs.existsSync(tempUploadDir)) {
              fs.rmSync(tempUploadDir, { recursive: true, force: true });
            }
          } catch (cleanupError) {
            logToFile(
              `Error cleaning up temp files: ${cleanupError.message}`,
              "WARN",
            );
          }

          return result;
        }
      } catch (error) {
        logToFile(
          `Error in uploadDroppedFiles IPC handler: ${error.message}`,
          "ERROR",
        );
        // 检查是否是由用户取消操作引起的错误
        const isCancelError =
          error.message?.includes("cancel") ||
          error.message?.includes("abort") ||
          error.message?.includes("用户取消") ||
          error.message?.includes("user cancelled");

        // 如果是取消操作，返回成功状态而非错误
        if (isCancelError) {
          logToFile(
            `Upload cancelled by user for tab ${tabId}, suppressing error display`,
            "INFO",
          );

          // 触发目录刷新
          if (sftpCore && typeof sftpCore.enqueueSftpOperation === "function") {
            try {
              // 异步刷新目录，不等待结果
              setTimeout(() => {
                sftpCore
                  .enqueueSftpOperation(
                    tabId,
                    async () => {
                      try {
                        logToFile(
                          `Refreshing directory listing for tab ${tabId} after cancel at path: ${targetFolder}`,
                          "INFO",
                        );
                        return { success: true, refreshed: true };
                      } catch (refreshError) {
                        logToFile(
                          `Error refreshing directory after cancel: ${refreshError.message}`,
                          "WARN",
                        );
                        return { success: false, error: refreshError.message };
                      }
                    },
                    {
                      type: "readdir",
                      path: targetFolder || ".",
                      priority: "high",
                    },
                  )
                  .catch((err) => {
                    logToFile(
                      `Error triggering directory refresh after cancel: ${err.message}`,
                      "WARN",
                    );
                  });
              }, 100);
            } catch (refreshErr) {
              logToFile(
                `Error setting up directory refresh after cancel: ${refreshErr.message}`,
                "WARN",
              );
            }
          }

          // 返回成功状态，表明这是用户取消操作
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: "用户已取消操作",
          };
        }

        // 其他类型的错误，正常返回错误信息
        return {
          success: false,
          error: `上传文件失败: ${error.message}`,
        };
      }
    },
  );

  safeHandle(ipcMain, "renameFile", async (event, tabId, oldPath, newName) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          // 从原路径中提取目录部分
          const lastSlashIndex = oldPath.lastIndexOf("/");
          const dirPath =
            lastSlashIndex > 0 ? oldPath.substring(0, lastSlashIndex) : "/";

          // 构建新路径
          const newPath =
            dirPath === "/" ? `/${newName}` : `${dirPath}/${newName}`;

          return new Promise((resolve, reject) => {
            // 使用SFTP重命名文件/文件夹
            sftp.rename(oldPath, newPath, (err) => {
              if (err) {
                logToFile(
                  `Failed to rename file for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `重命名失败: ${err.message}`,
                });
              }

              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Rename file error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `重命名失败: ${error.message}` };
    }
  });

  safeHandle(ipcMain, "getAbsolutePath", async (event, tabId, relativePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = processManager.getProcess(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;

          return new Promise((resolve, reject) => {
            // 使用SSH执行pwd命令获取当前目录（用作基准目录）
            sshClient.exec("pwd", (err, stream) => {
              if (err) {
                return resolve({
                  success: false,
                  error: `无法获取绝对路径: ${err.message}`,
                });
              }

              let pwdOutput = "";

              stream.on("data", (data) => {
                pwdOutput += data.toString().trim();
              });

              stream.on("close", () => {
                let absolutePath;

                if (relativePath.startsWith("/")) {
                  // 如果是绝对路径，则直接使用
                  absolutePath = relativePath;
                } else if (relativePath.startsWith("~")) {
                  // 如果以~开头，替换为home目录
                  absolutePath = relativePath.replace(
                    "~",
                    sshClient._sock._handle.remoteAddress,
                  );
                } else {
                  // 相对路径，基于pwd结果计算
                  absolutePath = pwdOutput + "/" + relativePath;
                }

                resolve({ success: true, path: absolutePath });
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Get absolute path error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `获取绝对路径失败: ${error.message}` };
    }
  });

  // 取消所有类型的文件传输（单文件传输、文件夹上传、文件夹下载等）
  safeHandle(ipcMain, "cancelTransfer", async (event, tabId, transferKey) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleCancelTransfer !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleCancelTransfer is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Cancel Transfer feature not properly initialized.",
      };
    }

    try {
      // 调用取消传输处理函数
      const result = await sftpTransfer.handleCancelTransfer(
        event,
        tabId,
        transferKey,
      );

      // 如果结果表明这是用户主动取消，不作为错误处理
      if (result.userCancelled) {
        logToFile(
          `User cancelled transfer ${transferKey} for tab ${tabId}, suppressing error display`,
          "INFO",
        );
        // 确保success为true，确保前端不会显示错误
        return {
          ...result,
          success: true,
          suppressError: true,
          message: result.message || "传输已取消",
        };
      }

      return result;
    } catch (error) {
      logToFile(
        `Error in cancelTransfer IPC handler: ${error.message}`,
        "ERROR",
      );
      return {
        success: false,
        error: `处理传输取消请求时出错: ${error.message}`,
      };
    }
  });

  // 获取或创建 SFTP 会话
  safeHandle(ipcMain, "getSftpSession", async (event, tabId) => {
    try {
      return sftpCore.getSftpSession(tabId);
    } catch (error) {
      logToFile(`Error getting SFTP session: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理 SFTP 操作队列
  safeHandle(ipcMain, "enqueueSftpOperation", async (event, tabId, operation) => {
    try {
      return sftpCore.enqueueSftpOperation(tabId, operation);
    } catch (error) {
      logToFile(`Error enqueuing SFTP operation: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 处理队列中的 SFTP 操作
  safeHandle(ipcMain, "processSftpQueue", async (event, tabId) => {
    try {
      return sftpCore.processSftpQueue(tabId);
    } catch (error) {
      logToFile(`Error processing SFTP queue: ${error.message}`, "ERROR");
      return { success: false, error: error.message };
    }
  });

  // 读取文件内容，返回文本
  safeHandle(ipcMain, "readFileContent", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            sftp.readFile(filePath, (err, data) => {
              if (err) {
                logToFile(
                  `Failed to read file content for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `读取文件内容失败: ${err.message}`,
                });
              }

              resolve({
                success: true,
                content: data.toString("utf8"),
                filePath,
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Read file content error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `读取文件内容失败: ${error.message}` };
    }
  });

  // 读取文件内容，返回base64编码的数据（适用于图片等二进制文件）
  safeHandle(ipcMain, "readFileAsBase64", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise(async (resolve, reject) => {
            sftp.readFile(filePath, async (err, data) => {
              if (err) {
                logToFile(
                  `Failed to read file as base64 for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `读取文件内容失败: ${err.message}`,
                });
              }

              try {
                // 缓存文件到本地
                const fileName = path.basename(filePath);
                const cacheFilePath = await fileCache.cacheFile(
                  fileName,
                  data,
                  tabId,
                );

                // 转换为base64
                const base64Data = data.toString("base64");

                resolve({
                  success: true,
                  content: base64Data,
                  filePath,
                  cacheFilePath, // 返回缓存文件路径
                });
              } catch (cacheError) {
                logToFile(
                  `Failed to cache file ${filePath}: ${cacheError.message}`,
                  "WARN",
                );

                // 即使缓存失败，仍然返回base64数据
                const base64Data = data.toString("base64");
                resolve({
                  success: true,
                  content: base64Data,
                  filePath,
                });
              }
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Read file as base64 error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `读取文件内容失败: ${error.message}` };
    }
  });

  // 清理文件缓存
  safeHandle(ipcMain, "cleanupFileCache", async (event, cacheFilePath) => {
    try {
      if (cacheFilePath) {
        const success = await fileCache.cleanupCacheFile(cacheFilePath);
        return { success };
      } else {
        return { success: false, error: "缓存文件路径不能为空" };
      }
    } catch (error) {
      logToFile(
        `Failed to cleanup cache file ${cacheFilePath}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  });

  // 清理标签页缓存
  safeHandle(ipcMain, "cleanupTabCache", async (event, tabId) => {
    try {
      const cleanedCount = await fileCache.cleanupTabCaches(tabId);
      return { success: true, cleanedCount };
    } catch (error) {
      logToFile(
        `Failed to cleanup tab cache for ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: error.message };
    }
  });

  // 新增：保存文件内容
  safeHandle(ipcMain, "saveFileContent", async (event, tabId, filePath, content) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            // 将内容转换为Buffer
            const buffer = Buffer.from(content, "utf8");

            sftp.writeFile(filePath, buffer, (err) => {
              if (err) {
                logToFile(
                  `Failed to save file content for session ${tabId}: ${err.message}`,
                  "ERROR",
                );
                return resolve({
                  success: false,
                  error: `保存文件内容失败: ${err.message}`,
                });
              }

              resolve({
                success: true,
                filePath,
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Save file content error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `保存文件内容失败: ${error.message}` };
    }
  });

  // 新增：上传文件夹处理函数
  safeHandle(
    "upload-folder",
    async (event, tabId, targetFolder, progressChannel) => {
      // Ensure sftpTransfer module is available
      if (
        !sftpTransfer ||
        typeof sftpTransfer.handleUploadFolder !== "function"
      ) {
        logToFile(
          "sftpTransfer.handleUploadFolder is not available or not a function.",
          "ERROR",
        );
        return {
          success: false,
          error: "SFTP Upload feature not properly initialized.",
        };
      }

      const processInfo = processManager.getProcess(tabId);
      if (
        !processInfo ||
        !processInfo.config ||
        !processInfo.process ||
        processInfo.type !== "ssh2"
      ) {
        logToFile(
          `Invalid or not ready SSH connection for tabId: ${tabId}`,
          "ERROR",
        );
        return { success: false, error: "无效或未就绪的SSH连接" };
      }

      const mainWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
      if (!mainWindow) {
        logToFile("No main window available for dialog.", "ERROR");
        return { success: false, error: "无法显示对话框" };
      }

      // Open folder selection dialog
      const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        title: "选择要上传的文件夹",
        properties: ["openDirectory"],
        buttonLabel: "上传文件夹",
      });

      if (canceled || !filePaths || filePaths.length === 0) {
        return { success: false, cancelled: true, error: "用户取消上传" };
      }

      const localFolderPath = filePaths[0];

      try {
        // Call the refactored sftpTransfer function, now passing progressChannel
        return await sftpTransfer.handleUploadFolder(
          tabId,
          localFolderPath,
          targetFolder,
          progressChannel,
        );
      } catch (error) {
        logToFile(
          `Error in upload-folder IPC handler: ${error.message}`,
          "ERROR",
        );

        // 检查是否是由用户取消操作引起的错误
        const isCancelError =
          error.message?.includes("cancel") ||
          error.message?.includes("abort") ||
          error.message?.includes("用户取消") ||
          error.message?.includes("user cancelled");

        // 如果是取消操作，返回成功状态而非错误
        if (isCancelError) {
          logToFile(
            `Folder upload cancelled by user for tab ${tabId}, suppressing error display`,
            "INFO",
          );

          // 触发目录刷新
          if (sftpCore && typeof sftpCore.enqueueSftpOperation === "function") {
            try {
              // 异步刷新目录，不等待结果
              setTimeout(() => {
                sftpCore
                  .enqueueSftpOperation(
                    tabId,
                    async () => {
                      try {
                        logToFile(
                          `Refreshing directory listing for tab ${tabId} after cancel at path: ${targetFolder}`,
                          "INFO",
                        );
                        return { success: true, refreshed: true };
                      } catch (refreshError) {
                        logToFile(
                          `Error refreshing directory after cancel: ${refreshError.message}`,
                          "WARN",
                        );
                        return { success: false, error: refreshError.message };
                      }
                    },
                    {
                      type: "readdir",
                      path: targetFolder || ".",
                      priority: "high",
                      canMerge: true,
                    },
                  )
                  .catch((err) => {
                    logToFile(
                      `Failed to enqueue refresh operation: ${err.message}`,
                      "WARN",
                    );
                  });
              }, 500); // 延迟500ms执行刷新
            } catch (refreshError) {
              logToFile(
                `Error triggering directory refresh: ${refreshError.message}`,
                "WARN",
              );
            }
          }

          // 返回成功状态，表明这是用户取消操作
          return {
            success: true,
            cancelled: true,
            userCancelled: true,
            message: "用户已取消操作",
          };
        }

        // 其他类型的错误，正常返回错误信息
        return {
          success: false,
          error: `上传文件夹失败: ${error.message}`,
        };
      }
    },
  );

  // 添加检查路径是否存在的API
  safeHandle(ipcMain, "checkPathExists", async (event, checkPath) => {
    try {
      logToFile(`检查路径是否存在: ${checkPath}`, "INFO");
      const exists = fs.existsSync(checkPath);
      logToFile(`路径 ${checkPath} ${exists ? "存在" : "不存在"}`, "INFO");
      return exists;
    } catch (error) {
      logToFile(`检查路径出错: ${error.message}`, "ERROR");
      return false;
    }
  });

  // 添加在文件管理器中显示文件/文件夹的API
  safeHandle(ipcMain, "showItemInFolder", async (event, itemPath) => {
    try {
      logToFile(`尝试在文件管理器中显示: ${itemPath}`, "INFO");
      shell.showItemInFolder(itemPath);
      return true;
    } catch (error) {
      logToFile(`显示文件或文件夹失败: ${error.message}`, "ERROR");
      return false;
    }
  });

  // Note: Settings handlers (settings:loadUISettings, settings:saveUISettings, etc.)
  // are registered before window creation via SettingsHandlers

  // 获取标签页连接状态
  safeHandle(ipcMain, "connection:getTabStatus", async (event, tabId) => {
    try {
      if (!tabId || tabId === "welcome") {
        return { success: true, data: null };
      }

      // 检查是否有对应的进程信息
      const processInfo = processManager.getProcess(tabId);

      if (!processInfo) {
        return { success: true, data: null };
      }

      // 根据进程类型返回连接状态
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

  // Note: Shortcut command handlers (get-shortcut-commands, save-shortcut-commands)
  // are registered before window creation via SettingsHandlers

  safeHandle(ipcMain, "downloadFolder", async (event, tabId, remotePath) => {
    if (
      !sftpTransfer ||
      typeof sftpTransfer.handleDownloadFolder !== "function"
    ) {
      logToFile(
        "sftpTransfer.handleDownloadFolder is not available or not a function.",
        "ERROR",
      );
      return {
        success: false,
        error: "SFTP Download feature not properly initialized.",
      };
    }
    // sftpTransfer.handleDownloadFolder signature is: async function handleDownloadFolder(tabId, remoteFolderPath)
    return sftpTransfer.handleDownloadFolder(tabId, remotePath);
  });

  // Note: Command history handlers (command-history:*) are registered
  // before window creation via SettingsHandlers

  // 添加IP地址查询API处理函数
  safeHandle(ipcMain, "ip:query", async (event, ip = "") => {
    try {
      // 获取默认代理配置以用于IP查询
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

  // terminal:getProcessInfo 已迁移到 terminalHandlers.js

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
        // 简化的SSH RSA公钥格式（实际应用中需要更复杂的转换）
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        sshPublicKey = `ssh-rsa ${keyData} ${comment}`;
      } else if (type === "ed25519") {
        // 简化的SSH ED25519公钥格式
        const keyData = publicKey
          .replace(/-----BEGIN PUBLIC KEY-----\n?/, "")
          .replace(/\n?-----END PUBLIC KEY-----/, "")
          .replace(/\n/g, "");
        sshPublicKey = `ssh-ed25519 ${keyData} ${comment}`;
      } else {
        // ECDSA格式
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
        // 对于Telnet连接，使用shell方法发送数据
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
} // Closing brace for setupIPC function

module.exports = setupIPC;
