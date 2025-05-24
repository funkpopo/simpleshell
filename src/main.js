const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const Client = require("ssh2").Client;
const os = require("os");
const { Worker } = require("worker_threads");
const { logToFile, initLogger } = require("./core/utils/logger");
const configManager = require("./core/ConfigManager");
const sftpCore = require("./modules/sftp/sftpCore");
const sftpTransfer = require("./modules/sftp/sftpTransfer");
const systemInfo = require("./modules/system-info");
const terminalManager = require("./modules/terminal");

// 应用设置和状态管理
const childProcesses = new Map();
let nextProcessId = 1;

// 跟踪编辑器会话状态的正则表达式
const editorCommandRegex = /\b(vi|vim|nano|emacs|pico|ed|less|more|cat|man)\b/;
const editorExitCommands = [
  "q",
  "quit",
  "exit",
  "wq",
  "ZZ",
  "x",
  ":q",
  ":wq",
  ":x",
  "Ctrl+X",
];
const editorExitRegex = new RegExp(
  `^(${editorExitCommands.join("|").replace(/\+/g, "\\+")}|:\\w+)$`,
  "i",
);

// 全局变量用于存储AI worker实例
let aiWorker = null;
let aiRequestMap = new Map();
let nextRequestId = 1;

// 全局变量
const terminalProcesses = new Map(); // 存储终端进程ID映射

// 保存全局事件对象，用于流式响应
let globalEvent = null;

// 用于保存流式请求的引用，以便取消
let activeAPIRequest = null;

// 获取worker文件路径
function getWorkerPath() {
  // 先尝试相对于__dirname的路径
  let workerPath = path.join(__dirname, "workers", "ai-worker.js");

  // 检查文件是否存在
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  // 如果文件不存在，可能是在开发环境，尝试使用源代码路径
  workerPath = path.join(__dirname, "..", "src", "workers", "ai-worker.js");
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }

  // 如果都找不到，记录错误并返回null
  console.error("无法找到AI worker文件。已尝试以下路径:");
  console.error(path.join(__dirname, "workers", "ai-worker.js"));
  console.error(path.join(__dirname, "..", "src", "workers", "ai-worker.js"));
  throw new Error("找不到AI worker文件");
}

// 创建AI Worker线程
function createAIWorker() {
  if (aiWorker) {
    try {
      aiWorker.terminate();
    } catch (error) {
      console.error("Error terminating existing AI worker:", error);
    }
  }

  try {
    const workerPath = getWorkerPath();
    // 创建worker实例
    aiWorker = new Worker(workerPath);

    // 监听worker线程的消息
    aiWorker.on("message", (message) => {
      const { id, result, error } = message;
      // 查找对应的请求处理函数
      const callback = aiRequestMap.get(id);
      if (callback) {
        if (error) {
          callback.reject(error);
        } else {
          callback.resolve(result);
        }
        // 处理完成后从Map中移除
        aiRequestMap.delete(id);
      }
    });

    // 处理worker错误
    aiWorker.on("error", (error) => {
      console.error("AI Worker error:", error);
      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(
          new Error("AI Worker encountered an error: " + error.message),
        );
        aiRequestMap.delete(id);
      }
    });

    // 处理worker退出
    aiWorker.on("exit", (code) => {
      // 如果退出码不是正常退出(0)，尝试重启worker
      if (code !== 0) {
        setTimeout(() => {
          createAIWorker();
        }, 1000);
      }

      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(
          new Error(`AI Worker stopped unexpectedly with code ${code}`),
        );
        aiRequestMap.delete(id);
      }
    });

    return aiWorker;
  } catch (error) {
    console.error(`无法创建AI worker:`, error);
    return null;
  }
}

// 处理生产和开发环境中的路径差异
if (require("electron-squirrel-startup")) {
  app.quit();
}

// 选择密钥文件
const selectKeyFile = async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [
      { name: "私钥文件", extensions: ["pem", "ppk", "key"] },
      { name: "所有文件", extensions: ["*"] },
    ],
    title: "选择SSH私钥文件",
  });

  if (result.canceled) {
    return null;
  }

  return result.filePaths[0];
};

const createWindow = () => {
  // 根据环境确定图标路径
  let iconPath;
  if (process.env.NODE_ENV === "development") {
    // 开发环境使用绝对路径
    iconPath = path.join(process.cwd(), "src", "assets", "logo.ico");
  } else {
    // 生产环境使用相对于__dirname的路径
    iconPath = path.join(__dirname, "assets", "logo.ico");
  }

  // 创建浏览器窗口
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: iconPath, // 使用环境相关的图标路径
  });

  // 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 加载应用 URL
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // 开发工具自动打开
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  // 注册IPC通信
  setupIPC(mainWindow);
};

// 在应用准备好时创建窗口并初始化配置
app.whenReady().then(() => {
  initLogger(app); // 初始化日志模块
  // Inject dependencies into configManager
  configManager.init(app, { logToFile }, require("./core/utils/crypto"));
  configManager.initializeMainConfig(); // 初始化主配置文件

  // Initialize sftpCore module
  sftpCore.init({ logToFile }, (tabId) => childProcesses.get(tabId)); // Pass logger and childProcesses getter
  sftpCore.startSftpHealthCheck(); // Start health check after core init

  // Initialize sftpTransfer module
  sftpTransfer.init(
    { logToFile },
    sftpCore,
    dialog,
    shell,
    (tabId) => childProcesses.get(tabId),
    (channel, ...args) => {
      // sendToRendererFunction
      const mainWindow = BrowserWindow.getAllWindows()[0]; // Assuming single main window
      if (
        mainWindow &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        // ... existing code ...
      }
    },
  );

  // ... existing code ...

  createWindow();
  createAIWorker();
  logToFile("Application ready and window created", "INFO");
});

// 在应用退出前清理资源
app.on("before-quit", () => {
  // 移除所有事件监听器和子进程
  for (const [id, proc] of childProcesses.entries()) {
    try {
      if (proc.process) {
        // 移除所有事件监听器
        if (proc.process.stdout) {
          proc.process.stdout.removeAllListeners();
        }
        if (proc.process.stderr) {
          proc.process.stderr.removeAllListeners();
        }

        // 终止进程
        try {
          if (typeof proc.process.kill === "function") {
            // 正常终止进程
            proc.process.kill();
          }
        } catch (error) {
          console.error(`Error killing process ${id}:`, error);
        }
      }
    } catch (error) {
      console.error(`Error cleaning up process ${id}:`, error);
    }
  }
  // 清空进程映射
  childProcesses.clear();
});

// 关闭所有窗口时退出应用（macOS除外）
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    // 关闭应用前终止worker线程
    if (aiWorker) {
      aiWorker
        .terminate()
        .catch((err) => console.error("Error terminating AI worker:", err));
    }
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 设置IPC通信
function setupIPC(mainWindow) {
  // 启动PowerShell进程
  ipcMain.handle("terminal:startPowerShell", async () => {
    const processId = nextProcessId++;

    // 获取PowerShell路径
    const powershellPath =
      process.platform === "win32" ? "powershell.exe" : "pwsh";

    try {
      // 启动PowerShell进程
      const ps = spawn(powershellPath, ["-NoLogo"], {
        env: process.env,
        cwd: process.env.USERPROFILE || process.env.HOME,
      });

      // 存储进程信息
      childProcesses.set(processId, {
        process: ps,
        listeners: new Set(),
        editorMode: false, // 初始化编辑器模式为false
        commandBuffer: "", // 初始化命令缓冲区
      });

      // 处理PowerShell输出
      ps.stdout.on("data", (data) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            const output = data.toString();
            // 处理输出以检测编辑器退出
            const processedOutput = terminalManager.processOutput(processId, output);
            mainWindow.webContents.send(
              `process:output:${processId}`,
              processedOutput,
            );
          }
        } catch (error) {
          console.error("Error handling stdout data:", error);
        }
      });

      ps.stderr.on("data", (data) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            const output = data.toString();
            // 处理输出以检测编辑器退出
            const processedOutput = terminalManager.processOutput(processId, output);
            mainWindow.webContents.send(
              `process:output:${processId}`,
              processedOutput,
            );
          }
        } catch (error) {
          console.error("Error handling stderr data:", error);
        }
      });

      // 处理进程退出
      ps.on("exit", (code) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\nProcess exited with code ${code || 0}\r\n`,
            );
          }
          childProcesses.delete(processId);
        } catch (error) {
          console.error("Error handling process exit:", error);
        }
      });

      // 处理进程错误
      ps.on("error", (err) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\nProcess error: ${err.message}\r\n`,
            );
          }
          childProcesses.delete(processId);
        } catch (error) {
          console.error("Error handling process error:", error);
        }
      });

      return processId;
    } catch (error) {
      console.error("Failed to start PowerShell:", error);
      throw error;
    }
  });

  // 启动SSH连接
  ipcMain.handle("terminal:startSSH", async (event, sshConfig) => {
    const processId = nextProcessId++;

    if (!sshConfig || !sshConfig.host) {
      console.error("Invalid SSH configuration");
      throw new Error("Invalid SSH configuration");
    }

    return new Promise((resolve, reject) => {
      try {
        // 创建SSH2客户端连接
        const ssh = new Client();

        // 存储进程信息 - 这里保存ssh客户端实例
        childProcesses.set(processId, {
          process: ssh,
          listeners: new Set(),
          config: sshConfig,
          type: "ssh2",
          ready: false, // 标记SSH连接状态，默认为未就绪
          editorMode: false, // 初始化编辑器模式为false
          commandBuffer: "", // 初始化命令缓冲区
          lastOutputLines: [], // 存储最近的终端输出行，用于提取远程命令
          outputBuffer: "", // 用于存储当前未处理完的输出
          isRemote: true, // 标记为远程SSH会话
        });

        // 存储相同的SSH客户端，使用tabId（通常是形如'ssh-timestamp'的标识符）
        if (sshConfig.tabId) {
          childProcesses.set(sshConfig.tabId, {
            process: ssh,
            listeners: new Set(),
            config: sshConfig,
            type: "ssh2",
            ready: false, // 标记SSH连接状态，默认为未就绪
            editorMode: false, // 初始化编辑器模式为false
            commandBuffer: "", // 初始化命令缓冲区
            lastOutputLines: [], // 存储最近的终端输出行，用于提取远程命令
            outputBuffer: "", // 用于存储当前未处理完的输出
            isRemote: true, // 标记为远程SSH会话
          });
        }

        // 设置连接超时定时器
        const connectionTimeout = setTimeout(() => {
          console.error("SSH connection timed out after 15 seconds");
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n连接超时，请检查网络和服务器状态\r\n`,
            );
          }
          // 不主动断开连接，让用户决定是否关闭
        }, 15000);

        // 监听就绪事件
        ssh.on("ready", () => {
          // 清除超时定时器
          clearTimeout(connectionTimeout);

          // 标记SSH连接为就绪状态
          const procInfo = childProcesses.get(processId);
          if (procInfo) {
            procInfo.ready = true;
          }

          // 同时更新tabId对应的连接状态
          if (sshConfig.tabId) {
            const tabProcInfo = childProcesses.get(sshConfig.tabId);
            if (tabProcInfo) {
              tabProcInfo.ready = true;
            }
          }

          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n*** ${sshConfig.host} SSH连接已建立 ***\r\n`,
            );
          }

          // 创建Shell会话
          ssh.shell(
            {
              term: "xterm-256color", // 使用更高级的终端类型
              cols: 120, // 设置更宽的初始终端列数
              rows: 30, // 设置初始终端行数
            },
            (err, stream) => {
              if (err) {
                console.error("Failed to create shell:", err);
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send(
                    `process:output:${processId}`,
                    `\r\n*** 创建Shell会话失败: ${err.message} ***\r\n`,
                  );
                }
                ssh.end();
                return;
              }

              // 存储流对象到进程信息中，用于后续写入数据
              const procInfo = childProcesses.get(processId);
              if (procInfo) {
                procInfo.stream = stream;
              }

              // 监听数据事件 - 使用Buffer拼接确保UTF-8字符完整
              let buffer = Buffer.from([]);

              stream.on("data", (data) => {
                try {
                  // 拼接数据到缓冲区
                  buffer = Buffer.concat([buffer, data]);

                  // 尝试将缓冲区转换为UTF-8字符串
                  try {
                    const output = buffer.toString("utf8");

                    // 处理输出以检测编辑器退出
                    const processedOutput = terminalManager.processOutput(
                      processId,
                      output,
                    );

                    // 发送到前端
                    if (mainWindow && !mainWindow.isDestroyed()) {
                      mainWindow.webContents.send(
                        `process:output:${processId}`,
                        processedOutput,
                      );
                    }

                    // 重置缓冲区
                    buffer = Buffer.from([]);
                  } catch (error) {
                    // 如果转换失败，说明可能是不完整的UTF-8序列，保留缓冲区继续等待
                    console.error("Failed to convert buffer to string:", error);
                  }
                } catch (error) {
                  console.error("Error handling stream data:", error);
                }
              });

              // 监听扩展数据（通常是错误消息）
              stream.on("extended data", (data, type) => {
                try {
                  // type为1时表示stderr数据
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(
                      `process:output:${processId}`,
                      `\x1b[31m${data.toString("utf8")}\x1b[0m`,
                    );
                  }
                } catch (error) {
                  console.error("Error handling extended data:", error);
                }
              });

              // 监听关闭事件
              stream.on("close", () => {
                try {
                  if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send(
                      `process:output:${processId}`,
                      `\r\n*** SSH会话已关闭 ***\r\n`,
                    );
                  }
                  ssh.end();
                } catch (error) {
                  console.error("Error handling stream close:", error);
                }
              });
            },
          );
        });

        // 监听错误事件
        ssh.on("error", (err) => {
          clearTimeout(connectionTimeout);

          console.error("SSH connection error:", err);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n\x1b[31m*** SSH连接错误: ${err.message} ***\x1b[0m\r\n`,
            );
          }

          childProcesses.delete(processId);
          reject(err);
        });

        // 监听关闭事件
        ssh.on("close", () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n*** SSH连接已关闭 ***\r\n`,
            );
          }

          childProcesses.delete(processId);
        });

        // 监听键盘交互事件（用于处理密码认证）
        ssh.on(
          "keyboard-interactive",
          (name, instructions, lang, prompts, finish) => {
            if (
              prompts.length > 0 &&
              prompts[0].prompt.toLowerCase().includes("password")
            ) {
              finish([sshConfig.password || ""]);
            } else {
              finish([]);
            }
          },
        );

        // 开始连接
        const connectConfig = {
          host: sshConfig.host,
          port: sshConfig.port || 22,
          username: sshConfig.username,
          readyTimeout: 10000, // 10秒连接超时
          keepaliveInterval: 30000, // 30秒发送一次心跳保持连接
        };

        // 根据是否有密码和私钥设置不同的认证方式
        if (sshConfig.privateKeyPath) {
          try {
            // 读取私钥文件
            const privateKey = fs.readFileSync(
              sshConfig.privateKeyPath,
              "utf8",
            );
            connectConfig.privateKey = privateKey;

            // 如果私钥有密码保护
            if (sshConfig.password) {
              connectConfig.passphrase = sshConfig.password;
            }
          } catch (error) {
            console.error("Error reading private key file:", error);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                `process:output:${processId}`,
                `\r\n\x1b[31m*** 读取私钥文件错误: ${error.message} ***\x1b[0m\r\n`,
              );
            }
            reject(error);
            return;
          }
        } else if (sshConfig.password) {
          // 使用密码认证
          connectConfig.password = sshConfig.password;
          // 同时启用键盘交互认证，某些服务器可能需要
          connectConfig.tryKeyboard = true;
        }

        // 连接到SSH服务器
        ssh.connect(connectConfig);

        // 返回进程ID
        resolve(processId);
      } catch (error) {
        console.error("Failed to start SSH connection:", error);
        reject(error);
      }
    });
  });

  // 发送数据到进程
  ipcMain.handle("terminal:sendToProcess", async (event, processId, data) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo || !procInfo.process) {
      console.error(`Process ${processId} not found or invalid`);
      return false;
    }

    try {
      // 确保退格键字符正确转换
      let processedData = data;
      // 对特殊情况的处理（如果需要）

      // 检测Tab键 (ASCII 9, \t, \x09)
      if (data === "\t" || data === "\x09") {
        // 直接发送到进程
        if (procInfo.type === "ssh2") {
          if (procInfo.stream) {
            procInfo.stream.write(processedData);
            return true;
          } else {
            console.error("SSH2 stream not available");
            return false;
          }
        } else if (typeof procInfo.process.write === "function") {
          procInfo.process.write(processedData);
          return true;
        } else if (procInfo.process.stdin) {
          procInfo.process.stdin.write(processedData);
          return true;
        } else {
          console.error("Process has no valid write method");
          return false;
        }
      }

      // 检测回车键并提取可能的命令
      if (data === "\r" || data === "\n") {
        // 可能是一个命令的结束，尝试从缓冲区获取命令
        if (procInfo.commandBuffer && procInfo.commandBuffer.trim()) {
          const command = procInfo.commandBuffer.trim();

          // 检测是否启动了编辑器（作为备用机制，现在优先使用buffer类型检测）
          if (!procInfo.editorMode && editorCommandRegex.test(command)) {
            procInfo.editorMode = true;
            procInfo.lastEditorCommand = command;
          }
          // 检测是否可能退出了编辑器（作为备用机制，现在优先使用buffer类型检测）
          else if (procInfo.editorMode) {
            // 检查是否是退出命令
            if (editorExitRegex.test(command)) {
              // 为某些编辑器，我们可以立即确认退出（但如果前端使用buffer类型检测，这段代码会被前端通知覆盖）
              if (/^(q|quit|exit|:q|:quit|:wq)$/i.test(command)) {
                procInfo.editorMode = false;
              } else {
                // 对于其他情况，设置一个退出检测标志，下一个命令会确认是否真的退出
                procInfo.possibleEditorExit = true;
              }
            }
            // 如果上一个命令可能是退出，且这个命令不是编辑器命令，则确认已退出
            else if (
              procInfo.possibleEditorExit &&
              !editorCommandRegex.test(command)
            ) {
              procInfo.editorMode = false;
              procInfo.possibleEditorExit = false;
            }
            // 如果收到普通shell命令且不在编辑器命令中，则退出编辑器模式
            else if (
              command.startsWith("$") ||
              command.startsWith(">") ||
              (command.includes(" ") &&
                !/^\s*(w|write|q|quit|exit|ZZ|x|c|change|d|delete|y|yank|p|put|u|undo|r|redo|i|insert|a|append)\s*/.test(
                  command,
                ))
            ) {
              procInfo.editorMode = false;
            }
          }
          // 只有不在编辑器模式下才添加到历史记录
          else if (!procInfo.editorMode) {
            // 修改命令记录逻辑，只记录远程命令
            // 对于SSH会话，先标记这个命令，稍后会通过输出提取确认的远程命令
            if (procInfo.isRemote) {
              // 只存储到lastLocalCommand，但不添加到历史记录
              procInfo.lastLocalCommand = command;
            }
            // 移除本地命令记录，不再记录非SSH会话的命令
          }

          // 清空命令缓冲区
          procInfo.commandBuffer = "";
        }
      } else if (data === "\u0003") {
        // Ctrl+C
        // 清空命令缓冲区
        procInfo.commandBuffer = "";

        // 如果在编辑器模式，可能是用户中断了编辑
        if (procInfo.editorMode) {
          // 为部分编辑器，Ctrl+C会导致退出
          setTimeout(() => {
            procInfo.possibleEditorExit = true;
            // 设置一个较长的检测时间，在下一个提示符出现时确认退出
            setTimeout(() => {
              if (procInfo.possibleEditorExit) {
                procInfo.editorMode = false;
                procInfo.possibleEditorExit = false;
              }
            }, 1000);
          }, 200);
        }
      } else if (data === "\u007F" || data === "\b") {
        // 退格键
        // 从缓冲区中删除最后一个字符
        if (procInfo.commandBuffer && procInfo.commandBuffer.length > 0) {
          procInfo.commandBuffer = procInfo.commandBuffer.slice(0, -1);
        }
      } else if (data === "\u001B" && procInfo.editorMode) {
        // ESC键，在编辑器模式下可能表示模式切换
        // 在vi/vim中，ESC会从插入模式返回到命令模式，但不退出编辑器
        // 仅记录这个键，不做特殊处理
        if (!procInfo.commandBuffer) procInfo.commandBuffer = "";
        procInfo.commandBuffer += data;
      } else {
        // 将字符添加到命令缓冲区
        if (!procInfo.commandBuffer) procInfo.commandBuffer = "";
        procInfo.commandBuffer += data;
      }

      // 根据进程类型选择不同的写入方式
      if (procInfo.type === "ssh2") {
        // SSH2连接使用保存的流对象写入数据
        if (procInfo.stream) {
          procInfo.stream.write(processedData);
          return true;
        } else {
          console.error("SSH2 stream not available");
          return false;
        }
      } else if (typeof procInfo.process.write === "function") {
        // node-pty进程直接调用write方法
        procInfo.process.write(processedData);
        return true;
      } else if (procInfo.process.stdin) {
        // 标准子进程使用stdin
        procInfo.process.stdin.write(processedData);
        return true;
      } else {
        console.error("Process has no valid write method");
        return false;
      }
    } catch (error) {
      console.error("Failed to send data to process:", error);
      return false;
    }
  });

  // 终止进程
  ipcMain.handle("terminal:killProcess", async (event, processId) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo || !procInfo.process) {
      return false;
    }

    try {
      if (procInfo.type === "ssh2") {
        // SSH2连接使用end方法关闭
        procInfo.process.end();
      } else if (typeof procInfo.process.kill === "function") {
        // 直接用kill方法（适用于node-pty和child_process）
        procInfo.process.kill();
      } else {
        console.error("Process has no valid kill method");
      }

      childProcesses.delete(processId);
      return true;
    } catch (error) {
      console.error("Failed to kill process:", error);
      return false;
    }
  });

  // 接收编辑器模式状态变更通知
  ipcMain.handle(
    "terminal:notifyEditorModeChange",
    async (event, processId, isEditorMode) => {
      const procInfo = childProcesses.get(processId);
      if (!procInfo) {
        return false;
      }

      // 记录状态变更前的值，用于调试
      const previousState = procInfo.editorMode;

      // 更新进程信息中的编辑器模式状态
      procInfo.editorMode = isEditorMode;

      // 仅当状态实际变化时记录详细日志
      if (previousState !== isEditorMode) {
        // 记录更多调试信息
        if (isEditorMode) {
          logToFile(
            `[EDITOR] 进程 ${processId} 进入编辑器模式（通过buffer类型检测）`,
            "DEBUG",
          );
        } else {
          logToFile(
            `[EDITOR] 进程 ${processId} 退出编辑器模式（通过buffer类型检测）`,
            "DEBUG",
          );
        }
      }

      // 如果退出编辑器模式，清除相关标志
      if (!isEditorMode) {
        procInfo.possibleEditorExit = false;
      }

      return true;
    },
  );

  // 加载连接配置
  ipcMain.handle("terminal:loadConnections", async () => {
    return configManager.loadConnections();
  });

  // 保存连接配置
  ipcMain.handle("terminal:saveConnections", async (event, connections) => {
    return configManager.saveConnections(connections);
  });

  // 选择密钥文件
  ipcMain.handle("terminal:selectKeyFile", async () => {
    return selectKeyFile();
  });

  // 获取应用版本号
  ipcMain.handle("app:getVersion", async () => {
    return app.getVersion();
  });

  // 关闭应用
  ipcMain.handle("app:close", async () => {
    app.quit();
    return true;
  });

  // 重新加载窗口
  ipcMain.handle("app:reloadWindow", async () => {
    mainWindow.reload();
    return true;
  });

  // 在外部浏览器打开链接
  ipcMain.handle("app:openExternal", async (event, url) => {
    try {
      await shell.openExternal(url);
      return { success: true };
    } catch (error) {
      console.error("Failed to open external link:", error);
      return { success: false, error: error.message };
    }
  });

  // 检查更新
  ipcMain.handle("app:checkForUpdate", async () => {
    try {
      const https = require("https");

      // 创建一个Promise来处理HTTPS请求
      const fetchGitHubRelease = () => {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: "api.github.com",
            path: "/repos/funkpopo/simpleshell/releases/latest",
            method: "GET",
            headers: {
              "User-Agent": "SimpleShell-App",
            },
          };

          const req = https.request(options, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API返回错误状态码: ${res.statusCode}`));
              return;
            }

            let data = "";
            res.on("data", (chunk) => {
              data += chunk;
            });

            res.on("end", () => {
              try {
                const releaseData = JSON.parse(data);
                resolve(releaseData);
              } catch (error) {
                reject(new Error(`解析GitHub API响应失败: ${error.message}`));
              }
            });
          });

          req.on("error", (error) => {
            reject(new Error(`请求GitHub API失败: ${error.message}`));
          });

          req.end();
        });
      };

      const releaseData = await fetchGitHubRelease();
      return {
        success: true,
        data: releaseData,
      };
    } catch (error) {
      console.error("检查更新失败:", error);
      return {
        success: false,
        error: error.message,
      };
    }
  });

  // 处理简单的命令
  ipcMain.handle("terminal:command", async (event, command) => {
    try {
      // 简单内部命令处理
      if (command === "date") {
        return { output: new Date().toString() };
      } else if (command.startsWith("echo ")) {
        return { output: command.substring(5) };
      } else {
        return { output: `Command not recognized: ${command}` };
      }
    } catch (error) {
      console.error("Command error:", error);
      return { error: error.message };
    }
  });

  // 添加调整终端大小的处理
  ipcMain.handle("terminal:resize", async (event, processId, cols, rows) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo) {
      console.error(`Process ${processId} not found`);
      return false;
    }

    try {
      // 针对不同类型的进程进行不同的处理
      if (procInfo.type === "ssh2" && procInfo.stream) {
        // SSH2连接使用stream.setWindow方法调整大小
        if (typeof procInfo.stream.setWindow === "function") {
          procInfo.stream.setWindow(rows, cols);
          return true;
        }
      } else if (typeof procInfo.process.resize === "function") {
        // node-pty进程使用resize方法
        procInfo.process.resize(cols, rows);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Failed to resize terminal:", error);
      return false;
    }
  });

  // 获取系统资源信息
  ipcMain.handle("terminal:getSystemInfo", async (event, processId) => {
    try {
      // 只有当提供了有效的进程ID且该进程存在于childProcesses映射中时才获取远程系统信息
      if (!processId || !childProcesses.has(processId)) {
        return systemInfo.getLocalSystemInfo();
      } else {
        // SSH远程系统信息
        const processObj = childProcesses.get(processId);

        // 支持多种SSH客户端类型
        if (
          (processObj.type === "ssh2" || processObj.type === "ssh") &&
          (processObj.process || processObj.client || processObj.channel)
        ) {
          const sshClient =
            processObj.client || processObj.process || processObj.channel;
          return systemInfo.getRemoteSystemInfo(sshClient); // This might be another issue for later
        } else {
          return systemInfo.getLocalSystemInfo();
        }
      }
    } catch (error) {
      console.error("Failed to get system info:", error);
      return {
        error: "获取系统信息失败",
        message: error.message,
      };
    }
  });

  // AI设置相关IPC处理
  ipcMain.handle("ai:loadSettings", async () => {
    return configManager.loadAISettings();
  });

  ipcMain.handle("ai:saveSettings", async (event, settings) => {
    return configManager.saveAISettings(settings);
  });

  // 新增: 处理API配置的IPC方法
  ipcMain.handle("ai:saveApiConfig", async (event, config) => {
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
      const settings = configManager.loadAISettings();
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
      return configManager.saveAISettings(settings);
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to save API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      console.error("Failed to save API config (IPC):", error);
      return false;
    }
  });

  ipcMain.handle("ai:deleteApiConfig", async (event, configId) => {
    try {
      const settings = configManager.loadAISettings();
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
        return configManager.saveAISettings(settings);
      }
      return true;
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to delete API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      console.error("Failed to delete API config (IPC):", error);
      return false;
    }
  });

  ipcMain.handle("ai:setCurrentApiConfig", async (event, configId) => {
    try {
      if (logToFile)
        logToFile(
          `Setting current API config with ID (via main.js IPC): ${configId}`,
          "INFO",
        );
      const settings = configManager.loadAISettings();
      if (!settings.configs) settings.configs = [];
      const selectedConfig = settings.configs.find((c) => c.id === configId);
      if (selectedConfig) {
        settings.current = { ...selectedConfig };
        return configManager.saveAISettings(settings);
      }
      return false;
    } catch (error) {
      if (logToFile)
        logToFile(
          `Failed to set current API config (via main.js IPC): ${error.message}`,
          "ERROR",
        );
      console.error("Failed to set current API config (IPC):", error);
      return false;
    }
  });

  ipcMain.handle("ai:sendPrompt", async (event, prompt, settings) => {
    try {
      return await configManager.sendAIPrompt(prompt, settings);
    } catch (error) {
      console.error("Error sending AI prompt:", error);
      return { error: error.message || "发送请求时出错" };
    }
  });

  // 直接处理API请求，绕过CORS限制
  ipcMain.handle("ai:sendAPIRequest", async (event, requestData, isStream) => {
    try {
      // 保存事件对象，用于后续消息发送
      globalEvent = event;

      // 验证请求数据
      if (
        !requestData.url ||
        !requestData.apiKey ||
        !requestData.model ||
        !requestData.messages
      ) {
        throw new Error("请求数据无效，缺少必要参数");
      }

      if (isStream) {
        // 处理流式请求
        const https = require("https");
        const http = require("http");
        const url = new URL(requestData.url);

        const requestModule = url.protocol === "https:" ? https : http;

        const options = {
          method: "POST",
          hostname: url.hostname,
          path: url.pathname + url.search,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${requestData.apiKey}`,
          },
        };

        const req = requestModule.request(options, (res) => {
          if (res.statusCode !== 200) {
            event.sender.send("stream-error", {
              tabId: "ai",
              error: {
                message: `API请求失败: ${res.statusCode} ${res.statusMessage}`,
              },
            });
            return;
          }

          res.on("data", (chunk) => {
            try {
              const data = chunk.toString("utf-8");
              const lines = data.split("\n");

              for (const line of lines) {
                if (line.startsWith("data: ") && line !== "data: [DONE]") {
                  try {
                    const jsonData = JSON.parse(line.substring(6));
                    if (
                      jsonData.choices &&
                      jsonData.choices[0] &&
                      jsonData.choices[0].delta &&
                      jsonData.choices[0].delta.content
                    ) {
                      event.sender.send("stream-chunk", {
                        tabId: "ai",
                        chunk: jsonData.choices[0].delta.content,
                      });
                    }
                  } catch (e) {}
                }
              }
            } catch (error) {
              console.error("处理流数据时出错:", error);
            }
          });

          res.on("end", () => {
            event.sender.send("stream-end", { tabId: "ai" });
            // 清理请求引用
            activeAPIRequest = null;
          });
        });

        req.on("error", (error) => {
          console.error("请求出错:", error);
          event.sender.send("stream-error", {
            tabId: "ai",
            error: { message: error.message },
          });
          // 清理请求引用
          activeAPIRequest = null;
        });

        // 保存请求引用以便后续中断
        activeAPIRequest = req;

        // 发送请求数据
        req.write(
          JSON.stringify({
            model: requestData.model,
            messages: requestData.messages,
            stream: true,
          }),
        );

        req.end();

        return { success: true, message: "流式请求已开始" };
      } else {
        // 处理标准请求
        return new Promise((resolve, reject) => {
          try {
            const https = require("https");
            const http = require("http");
            const url = new URL(requestData.url);

            const requestModule = url.protocol === "https:" ? https : http;

            const options = {
              method: "POST",
              hostname: url.hostname,
              path: url.pathname + url.search,
              port: url.port || (url.protocol === "https:" ? 443 : 80),
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${requestData.apiKey}`,
              },
            };

            const req = requestModule.request(options, (res) => {
              let responseData = "";

              // 处理状态码非200的情况
              if (res.statusCode !== 200) {
                resolve({
                  success: false,
                  error: `API请求失败: ${res.statusCode} ${res.statusMessage}`,
                });
                return;
              }

              res.on("data", (chunk) => {
                responseData += chunk.toString("utf-8");
              });

              res.on("end", () => {
                try {
                  // 解析JSON响应
                  const data = JSON.parse(responseData);
                  if (
                    data.choices &&
                    data.choices[0] &&
                    data.choices[0].message &&
                    data.choices[0].message.content
                  ) {
                    resolve({
                      success: true,
                      content: data.choices[0].message.content,
                    });
                  } else {
                    resolve({
                      success: false,
                      error: "无法解析API响应",
                      rawResponse: responseData,
                    });
                  }
                } catch (error) {
                  console.error("解析API响应时出错:", error);
                  resolve({
                    success: false,
                    error: `解析响应失败: ${error.message}`,
                    rawResponse: responseData.substring(0, 200) + "...",
                  });
                }
              });
            });

            req.on("error", (error) => {
              console.error("请求出错:", error);
              resolve({
                success: false,
                error: `请求失败: ${error.message}`,
              });
            });

            // 发送请求数据
            req.write(
              JSON.stringify({
                model: requestData.model,
                messages: requestData.messages,
                stream: false,
              }),
            );

            req.end();
          } catch (error) {
            console.error("创建请求时出错:", error);
            resolve({
              success: false,
              error: `创建请求失败: ${error.message}`,
            });
          }
        });
      }
    } catch (error) {
      console.error("发送API请求时出错:", error);
      return { success: false, error: error.message };
    }
  });

  // 处理中断API请求
  ipcMain.handle("ai:abortAPIRequest", async (event) => {
    try {
      if (activeAPIRequest) {
        // 中断请求
        activeAPIRequest.abort();

        // 发送中断消息给渲染进程
        if (globalEvent) {
          globalEvent.sender.send("stream-end", {
            tabId: "ai",
            aborted: true,
          });
        }

        // 清理请求引用
        activeAPIRequest = null;

        return { success: true, message: "请求已中断" };
      } else {
        return { success: false, message: "没有活跃的请求" };
      }
    } catch (error) {
      console.error("中断API请求时出错:", error);
      return { success: false, error: error.message };
    }
  });

  // 文件管理相关API
  ipcMain.handle("listFiles", async (event, tabId, path, options = {}) => {
    try {
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
                  permissions: item.attrs.mode,
                }));

                resolve({ success: true, data: files });
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

  ipcMain.handle("copyFile", async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
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

  ipcMain.handle("moveFile", async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
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

  ipcMain.handle("deleteFile", async (event, tabId, filePath, isDirectory) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
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
  ipcMain.handle("createFolder", async (event, tabId, folderPath) => {
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
  ipcMain.handle("createFile", async (event, tabId, filePath) => {
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

  ipcMain.handle("downloadFile", async (event, tabId, remotePath) => {
    if (!sftpTransfer || typeof sftpTransfer.handleDownloadFile !== 'function') {
      logToFile("sftpTransfer.handleDownloadFile is not available or not a function.", "ERROR");
      return { success: false, error: "SFTP Download feature not properly initialized." };
    }
    // sftpTransfer.handleDownloadFile signature is: async function handleDownloadFile(event, tabId, remotePath)
    return sftpTransfer.handleDownloadFile(event, tabId, remotePath);
  });

  ipcMain.handle("uploadFile", async (event, tabId, targetFolder) => {
    // Ensure sftpTransfer module and its handleUploadFile function are available
    if (!sftpTransfer || typeof sftpTransfer.handleUploadFile !== 'function') {
      logToFile("sftpTransfer.handleUploadFile is not available or not a function.", "ERROR");
      return { success: false, error: "SFTP Upload feature not properly initialized." };
    }
    
    // Directly call the enhanced sftpTransfer.handleUploadFile function
    // The sftpTransfer.handleUploadFile function now handles dialog, multi-file logic, and progress reporting via sendToRenderer.
    // The 'event' is passed so that sftpTransfer can use event.sender.send if needed, though it primarily uses the initialized sendToRenderer.
    return sftpTransfer.handleUploadFile(event, tabId, targetFolder);
  });

  ipcMain.handle("renameFile", async (event, tabId, oldPath, newName) => {
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

  ipcMain.handle("getAbsolutePath", async (event, tabId, relativePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
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
  ipcMain.handle("cancelTransfer", async (event, tabId, type) => {
    try {
      const transferKey = `${tabId}-${type}`;
      const transfer = activeTransfers.get(transferKey);

      if (!transfer) {
        return { success: false, error: "没有找到活动的传输任务" };
      }

      // 中断传输
      if (transfer.sftp) {
        try {
          // 如果有resolve方法（表示有未完成的IPC请求），尝试调用它
          if (transfer.resolve) {
            try {
              transfer.resolve({
                success: false,
                cancelled: true,
                error: "传输已取消",
              });
            } catch (resolveError) {
              console.error(
                `Error resolving pending request: ${resolveError.message}`,
              );
            }
          }

          // 尝试中断操作并关闭连接
          await transfer.sftp.end();
          logToFile(`Transfer cancelled for session ${tabId}`, "INFO");

          // 如果有临时文件需要删除
          if (transfer.tempFilePath && fs.existsSync(transfer.tempFilePath)) {
            fs.unlinkSync(transfer.tempFilePath);
          }

          // 从活动传输中移除
          activeTransfers.delete(transferKey);

          return { success: true };
        } catch (error) {
          logToFile(
            `Error cancelling transfer for session ${tabId}: ${error.message}`,
            "ERROR",
          );
          return { success: false, error: `取消传输失败: ${error.message}` };
        }
      } else {
        return { success: false, error: "传输任务无法取消" };
      }
    } catch (error) {
      logToFile(
        `Cancel transfer error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `取消传输失败: ${error.message}` };
    }
  });

  // 获取或创建 SFTP 会话
  ipcMain.handle("getSftpSession", async (event, tabId) => {
    try {
      return sftpCore.getSftpSession(tabId);
    } catch (error) {
      console.error("Error getting SFTP session:", error);
      return { success: false, error: error.message };
    }
  });

  // 处理 SFTP 操作队列
  ipcMain.handle("enqueueSftpOperation", async (event, tabId, operation) => {
    try {
      return sftpCore.enqueueSftpOperation(tabId, operation);
    } catch (error) {
      console.error("Error enqueuing SFTP operation:", error);
      return { success: false, error: error.message };
    }
  });

  // 处理队列中的 SFTP 操作
  ipcMain.handle("processSftpQueue", async (event, tabId) => {
    try {
      return sftpCore.processSftpQueue(tabId);
    } catch (error) {
      console.error("Error processing SFTP queue:", error);
      return { success: false, error: error.message };
    }
  });

  // 读取文件内容，返回文本
  ipcMain.handle("readFileContent", async (event, tabId, filePath) => {
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
  ipcMain.handle("readFileAsBase64", async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await sftpCore.getSftpSession(tabId);

          return new Promise((resolve, reject) => {
            sftp.readFile(filePath, (err, data) => {
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

              // 转换为base64
              const base64Data = data.toString("base64");

              resolve({
                success: true,
                content: base64Data,
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
        `Read file as base64 error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `读取文件内容失败: ${error.message}` };
    }
  });

  // 新增：保存文件内容
  ipcMain.handle("saveFileContent", async (event, tabId, filePath, content) => {
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
  ipcMain.handle("upload-folder", async (event, tabId, targetFolder) => {
    // Ensure sftpTransfer module is available
    if (!sftpTransfer || typeof sftpTransfer.handleUploadFolder !== 'function') {
      logToFile("sftpTransfer.handleUploadFolder is not available or not a function.", "ERROR");
      return { success: false, error: "SFTP Upload feature not properly initialized." };
    }
  
    const processInfo = childProcesses.get(tabId);
    if (!processInfo || !processInfo.config || !processInfo.process || processInfo.type !== "ssh2" ) {
      logToFile(`Invalid or not ready SSH connection for tabId: \${tabId}`, "ERROR");
      return { success: false, error: "无效或未就绪的SSH连接" };
    }
    
    const mainWindow = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      logToFile("No main window available for dialog.", "ERROR");
      return { success: false, error: "无法显示对话框" };
    }
  
    // Open folder selection dialog
    const { canceled, filePaths } = await dialog.showOpenDialog(
      mainWindow,
      {
        title: "选择要上传的文件夹",
        properties: ["openDirectory"],
        buttonLabel: "上传文件夹",
      }
    );
  
    if (canceled || !filePaths || filePaths.length === 0) {
      return { success: false, cancelled: true, error: "用户取消上传" };
    }
  
    const localFolderPath = filePaths[0];
  
    // Call the refactored sftpTransfer function
    return sftpTransfer.handleUploadFolder(tabId, localFolderPath, targetFolder);
  });

  // Handle SFTP Download Folder
  ipcMain.handle("download-folder", async (event, tabId, remotePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return sftpCore.enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (
            !processInfo ||
            !processInfo.process ||
            processInfo.type !== "ssh2"
          ) {
            return { success: false, error: "无效的SSH连接" };
          }

          const sshClient = processInfo.process;
          const sshConfig = processInfo.config; // 获取SSH配置

          // 获取文件夹名，处理特殊情况
          let folderName;
          if (remotePath === "/" || remotePath === "~") {
            // 如果是根目录或家目录，使用安全的名称
            folderName = "root_folder";
            logToFile(
              `检测到特殊目录 ${remotePath}，使用安全名称: ${folderName}`,
              "INFO",
            );
          } else if (remotePath.endsWith("/")) {
            // 如果路径以斜杠结尾，需要特殊处理
            const parts = remotePath.split("/").filter((p) => p);
            folderName = parts[parts.length - 1] || "folder";
            logToFile(
              `解析带斜杠结尾的路径 ${remotePath}，提取文件夹名: ${folderName}`,
              "INFO",
            );
          } else {
            // 正常情况
            folderName = path.basename(remotePath);
            logToFile(
              `从路径 ${remotePath} 提取的文件夹名称: ${folderName}`,
              "INFO",
            );
          }

          // 打开保存对话框 - 设置默认下载位置
          logToFile(
            `开始打开下载位置选择对话框, 默认路径: ${app.getPath("downloads")}`,
            "INFO",
          );

          const result = await dialog.showOpenDialog(mainWindow, {
            title: "选择下载位置",
            defaultPath: app.getPath("downloads"), // 使用系统下载文件夹作为默认位置
            properties: ["openDirectory"],
            buttonLabel: "下载到此文件夹",
          });

          logToFile(`对话框结果: ${JSON.stringify(result)}`, "INFO");

          // 检查对话框结果是否正确
          if (
            !result ||
            result.canceled ||
            !result.filePaths ||
            result.filePaths.length === 0
          ) {
            logToFile(
              `用户取消了选择或返回空路径: ${JSON.stringify(result)}`,
              "INFO",
            );
            return { success: false, error: "用户取消下载" };
          }

          // 获取用户选择的路径
          const userSelectedPath = result.filePaths[0];
          logToFile(`用户选择的下载路径: ${userSelectedPath}`, "INFO");

          if (!userSelectedPath || userSelectedPath.trim() === "") {
            logToFile(`用户选择的路径无效: ${userSelectedPath}`, "ERROR");
            return { success: false, error: "选择的下载路径无效" };
          }

          // 计算本地保存路径 - 使用正确的用户所选路径
          const localFolderPath = path.join(userSelectedPath, folderName);
          logToFile(`计算得到的本地文件夹路径: ${localFolderPath}`, "INFO");

          // 规范化路径格式，确保Windows下路径正确
          const normalizedLocalPath = path.normalize(localFolderPath);
          logToFile(`规范化后的本地路径: ${normalizedLocalPath}`, "INFO");

          // 确保本地文件夹存在 - 添加更强的错误处理
          try {
            // 检查父文件夹是否存在并可写
            const parentDir = path.dirname(normalizedLocalPath);
            logToFile(`检查父文件夹: ${parentDir}`, "INFO");

            if (!fs.existsSync(parentDir)) {
              logToFile(`父文件夹不存在，尝试创建: ${parentDir}`, "INFO");
              fs.mkdirSync(parentDir, { recursive: true });
            }

            // 检查目标文件夹
            if (!fs.existsSync(normalizedLocalPath)) {
              logToFile(
                `目标文件夹不存在，尝试创建: ${normalizedLocalPath}`,
                "INFO",
              );
              fs.mkdirSync(normalizedLocalPath, { recursive: true });
            } else {
              logToFile(`目标文件夹已存在: ${normalizedLocalPath}`, "INFO");
            }

            // 验证文件夹是否可写
            const testFilePath = path.join(normalizedLocalPath, ".write_test");
            logToFile(`创建测试文件验证权限: ${testFilePath}`, "INFO");
            fs.writeFileSync(testFilePath, "test");
            fs.unlinkSync(testFilePath);
            logToFile(`文件夹权限检查通过: ${normalizedLocalPath}`, "INFO");
          } catch (fsError) {
            logToFile(
              `Error creating or writing to folder "${normalizedLocalPath}": ${fsError.message}`,
              "ERROR",
            );
            return {
              success: false,
              error: `无法创建或写入下载文件夹: ${fsError.message}。请检查路径权限或选择其他位置。`,
            };
          }

          logToFile(
            `Downloading folder "${remotePath}" to "${normalizedLocalPath}" for session ${tabId}`,
            "INFO",
          );

          // 创建SFTP客户端
          const sftp = new SftpClient();

          // 创建传输对象并存储到活动传输中
          const transferKey = `${tabId}-download-folder`;

          return new Promise(async (resolve, reject) => {
            try {
              // 存储resolve和reject函数，以便在取消时调用
              activeTransfers.set(transferKey, {
                sftp,
                resolve,
                reject,
              });

              // 使用SSH2客户端的连接配置
              await sftp.connect({
                host: sshConfig.host,
                port: sshConfig.port || 22,
                username: sshConfig.username,
                password: sshConfig.password,
                privateKey: sshConfig.privateKeyPath
                  ? fs.readFileSync(sshConfig.privateKeyPath, "utf8")
                  : undefined,
                passphrase:
                  sshConfig.privateKeyPath && sshConfig.password
                    ? sshConfig.password
                    : undefined,
              });

              // 递归扫描远程文件夹
              const scanRemoteFolder = async (folderPath, basePath = "") => {
                let items = [];

                try {
                  // 记录扫描操作的开始
                  logToFile(
                    `开始扫描远程文件夹: ${folderPath}, 基础路径: ${basePath}`,
                    "INFO",
                  );

                  // 获取文件夹内容
                  const entries = await sftp.list(folderPath);
                  logToFile(
                    `文件夹 ${folderPath} 包含 ${entries.length} 个项目`,
                    "INFO",
                  );

                  for (const entry of entries) {
                    // 跳过"."和".."目录
                    if (entry.name === "." || entry.name === "..") continue;

                    // 确保使用正斜杠处理SFTP远程路径
                    const entryPath =
                      folderPath === "/"
                        ? `/${entry.name}`
                        : `${folderPath}/${entry.name}`;

                    // 本地相对路径使用系统相关路径分隔符，最后统一转换为SFTP格式
                    const relativePath = basePath
                      ? path.join(basePath, entry.name).replace(/\\/g, "/")
                      : entry.name;

                    if (entry.type === "d") {
                      // 目录
                      // 递归扫描子文件夹
                      const subItems = await scanRemoteFolder(
                        entryPath,
                        relativePath,
                      );
                      items.push({
                        path: relativePath,
                        remotePath: entryPath,
                        name: entry.name,
                        isDirectory: true,
                        children: subItems,
                      });
                    } else {
                      // 文件
                      items.push({
                        path: relativePath,
                        remotePath: entryPath,
                        name: entry.name,
                        isDirectory: false,
                        size: entry.size,
                      });
                    }
                  }
                } catch (error) {
                  logToFile(
                    `Error scanning remote folder ${folderPath}: ${error.message}`,
                    "ERROR",
                  );
                  // 如果出错，返回空列表
                  return [];
                }

                return items;
              };

              // 扫描远程文件夹结构
              logToFile(`开始扫描远程文件夹: ${remotePath}`, "INFO");
              event.sender.send("download-folder-progress", {
                tabId,
                progress: 0,
                currentFile: "正在扫描远程文件夹...",
                transferredBytes: 0,
                totalBytes: 0,
                processedFiles: 0,
                totalFiles: 0,
              });

              let folderStructure;
              try {
                folderStructure = await scanRemoteFolder(remotePath);
                if (!folderStructure || folderStructure.length === 0) {
                  logToFile(
                    `警告: 远程文件夹 ${remotePath} 返回了空结构`,
                    "WARNING",
                  );
                } else {
                  logToFile(
                    `成功扫描远程文件夹，获取到 ${folderStructure.length} 个顶级项目`,
                    "INFO",
                  );
                }
              } catch (scanError) {
                logToFile(`扫描远程文件夹出错: ${scanError.message}`, "ERROR");
                throw scanError;
              }

              // 计算下载总大小和文件数
              let totalBytes = 0;
              let totalFiles = 0;
              const getAllFiles = (items) => {
                for (const item of items) {
                  if (item.isDirectory && item.children) {
                    getAllFiles(item.children);
                  } else if (!item.isDirectory) {
                    totalBytes += item.size || 0;
                    totalFiles++;
                  }
                }
              };
              getAllFiles(folderStructure);

              // 如果没有文件，直接返回成功
              if (totalFiles === 0) {
                await sftp.end();
                activeTransfers.delete(transferKey);
                return resolve({ success: true, message: "文件夹为空" });
              }

              // 递归创建本地文件夹结构
              const createLocalFolders = (items, parentPath) => {
                logToFile(`准备在 ${parentPath} 创建本地文件夹结构`, "INFO");

                for (const item of items) {
                  if (item.isDirectory) {
                    const localPath = path.join(parentPath, item.name);
                    logToFile(`尝试创建本地文件夹: ${localPath}`, "INFO");

                    try {
                      // 检查本地文件夹是否存在
                      if (!fs.existsSync(localPath)) {
                        fs.mkdirSync(localPath, { recursive: true });
                        logToFile(`成功创建本地文件夹: ${localPath}`, "INFO");
                      } else {
                        logToFile(`本地文件夹已存在: ${localPath}`, "INFO");
                      }

                      // 确认文件夹创建成功并有写入权限
                      if (!fs.existsSync(localPath)) {
                        throw new Error(`创建文件夹失败: ${localPath}`);
                      }

                      // 创建测试文件以验证权限
                      const testFile = path.join(localPath, ".write_test");
                      fs.writeFileSync(testFile, "test");
                      fs.unlinkSync(testFile);
                      logToFile(`文件夹权限验证成功: ${localPath}`, "INFO");

                      // 递归处理子文件夹
                      if (item.children && item.children.length > 0) {
                        createLocalFolders(item.children, localPath);
                      }
                    } catch (folderError) {
                      logToFile(
                        `创建或验证本地文件夹失败: ${localPath}, 错误: ${folderError.message}`,
                        "ERROR",
                      );
                      throw folderError; // 重新抛出错误，中断整个过程
                    }
                  }
                }
              };

              // 在本地创建文件夹结构
              try {
                // 确保根文件夹存在
                if (!fs.existsSync(normalizedLocalPath)) {
                  logToFile(`创建根下载文件夹: ${normalizedLocalPath}`, "INFO");
                  fs.mkdirSync(normalizedLocalPath, { recursive: true });
                } else {
                  logToFile(
                    `根下载文件夹已存在: ${normalizedLocalPath}`,
                    "INFO",
                  );
                }

                // 创建内部文件夹结构
                logToFile(
                  `开始创建内部文件夹结构，共 ${folderStructure.length} 个顶级项目`,
                  "INFO",
                );
                createLocalFolders(folderStructure, normalizedLocalPath);
                logToFile(
                  `本地文件夹结构创建成功: ${normalizedLocalPath}`,
                  "INFO",
                );

                // 最后再次验证根文件夹是否存在
                if (!fs.existsSync(normalizedLocalPath)) {
                  throw new Error(
                    `根文件夹不存在，可能创建失败: ${normalizedLocalPath}`,
                  );
                }
              } catch (folderStructureError) {
                logToFile(
                  `创建本地文件夹结构失败: ${folderStructureError.message}`,
                  "ERROR",
                );
                throw new Error(
                  `无法创建本地文件夹结构: ${folderStructureError.message}`,
                );
              }

              // 收集所有文件以便下载
              const allFiles = [];
              const collectFiles = (items, parentPath) => {
                logToFile(
                  `收集文件: 处理 ${items.length} 个项目，父路径: ${parentPath}`,
                  "INFO",
                );
                for (const item of items) {
                  if (item.isDirectory && item.children) {
                    // 处理子文件夹
                    const subFolderPath = path.join(parentPath, item.name);
                    logToFile(
                      `处理子文件夹: ${item.name}, 完整路径: ${subFolderPath}`,
                      "INFO",
                    );
                    collectFiles(item.children, subFolderPath);
                  } else if (!item.isDirectory) {
                    // 处理文件
                    const localFilePath = path.join(parentPath, item.name);
                    logToFile(
                      `收集文件: ${item.name}, 完整路径: ${localFilePath}, 大小: ${item.size || 0} 字节`,
                      "INFO",
                    );
                    allFiles.push({
                      ...item,
                      localPath: localFilePath,
                    });
                  }
                }
              };
              collectFiles(folderStructure, normalizedLocalPath);
              logToFile(`共收集到 ${allFiles.length} 个需要下载的文件`, "INFO");

              // 开始下载文件
              let transferredBytes = 0;
              let processedFiles = 0;
              let lastProgressUpdate = 0;
              let lastTransferredBytes = 0;
              let lastUpdateTime = Date.now();
              let transferSpeed = 0;
              const progressReportInterval = 100;

              // 逐个下载文件
              for (const file of allFiles) {
                // 检查是否传输被取消
                const activeTransfer = activeTransfers.get(transferKey);
                if (!activeTransfer) {
                  throw new Error("传输已取消");
                }

                // 当前处理的文件相对路径（用于显示）
                const currentFile = file.path;

                // 更新进度信息
                event.sender.send("download-folder-progress", {
                  tabId,
                  progress: Math.floor((transferredBytes / totalBytes) * 100),
                  currentFile,
                  transferredBytes,
                  totalBytes,
                  transferSpeed,
                  remainingTime:
                    transferSpeed > 0
                      ? (totalBytes - transferredBytes) / transferSpeed
                      : 0,
                  processedFiles,
                  totalFiles,
                });

                try {
                  // 创建临时文件路径
                  const tempFilePath = file.localPath + ".part";

                  // 记录文件下载开始
                  logToFile(
                    `开始下载文件: ${file.remotePath} 到临时文件 ${tempFilePath}, 文件大小: ${file.size} 字节`,
                    "INFO",
                  );

                  // 下载文件
                  await sftp.fastGet(file.remotePath, tempFilePath, {
                    step: (transferred, chunk, total) => {
                      // 计算总体进度百分比
                      const fileProgress = transferred;
                      const overallTransferred =
                        transferredBytes + fileProgress;
                      const overallProgress = Math.floor(
                        (overallTransferred / totalBytes) * 100,
                      );

                      // 限制进度更新频率
                      const now = Date.now();
                      if (now - lastProgressUpdate >= progressReportInterval) {
                        // 计算传输速度 (字节/秒)
                        const elapsedSinceLastUpdate =
                          (now - lastUpdateTime) / 1000; // 时间间隔(秒)

                        if (elapsedSinceLastUpdate > 0) {
                          const bytesTransferredSinceLastUpdate =
                            overallTransferred - lastTransferredBytes;
                          if (bytesTransferredSinceLastUpdate > 0) {
                            transferSpeed =
                              bytesTransferredSinceLastUpdate /
                              elapsedSinceLastUpdate;
                          }
                        }

                        // 存储当前值供下次计算
                        lastTransferredBytes = overallTransferred;
                        lastUpdateTime = now;

                        // 发送进度更新到渲染进程
                        event.sender.send("download-folder-progress", {
                          tabId,
                          progress: overallProgress,
                          currentFile,
                          transferredBytes: overallTransferred,
                          totalBytes,
                          transferSpeed,
                          remainingTime:
                            transferSpeed > 0
                              ? (totalBytes - overallTransferred) /
                                transferSpeed
                              : 0,
                          processedFiles,
                          totalFiles,
                        });

                        lastProgressUpdate = now;
                      }
                    },
                    concurrency: 16, // 同时传输16个数据块
                    chunkSize: 32768, // 32KB的块大小，提高传输效率
                    debug: false, // 不输出调试信息
                  });

                  // 下载完成后，将临时文件重命名为最终文件
                  logToFile(
                    `文件下载完成，准备重命名: ${tempFilePath} -> ${file.localPath}`,
                    "INFO",
                  );

                  try {
                    fs.renameSync(tempFilePath, file.localPath);
                    logToFile(`文件重命名成功: ${file.localPath}`, "INFO");
                  } catch (renameError) {
                    logToFile(
                      `文件重命名失败: ${renameError.message}`,
                      "ERROR",
                    );
                    // 尝试替代方法: 复制后删除
                    logToFile(`尝试使用复制方法替代重命名`, "INFO");
                    fs.copyFileSync(tempFilePath, file.localPath);
                    fs.unlinkSync(tempFilePath);
                    logToFile(
                      `使用复制方法成功完成文件写入: ${file.localPath}`,
                      "INFO",
                    );
                  }

                  // 更新已传输字节数和处理文件数
                  transferredBytes += file.size;
                  processedFiles++;
                } catch (fileError) {
                  // 详细记录错误
                  logToFile(
                    `下载文件失败 ${file.remotePath} 到 ${file.localPath}, 会话 ${tabId}: ${fileError.message}`,
                    "ERROR",
                  );

                  // 检查错误类型，判断是否需要重试或处理特殊情况
                  if (fileError.code === "ENOENT") {
                    logToFile(`远程文件不存在: ${file.remotePath}`, "ERROR");
                  } else if (fileError.code === "EACCES") {
                    logToFile(
                      `权限不足，无法创建本地文件: ${file.localPath}`,
                      "ERROR",
                    );
                  } else if (fileError.message.includes("timeout")) {
                    logToFile(`下载超时，可能是网络问题`, "ERROR");
                  }

                  // 尝试清理临时文件
                  try {
                    if (fs.existsSync(tempFilePath)) {
                      fs.unlinkSync(tempFilePath);
                      logToFile(`已清理临时文件: ${tempFilePath}`, "INFO");
                    }
                  } catch (cleanupError) {
                    logToFile(
                      `清理临时文件失败: ${cleanupError.message}`,
                      "ERROR",
                    );
                  }

                  // 继续处理下一个文件，不中断整个过程
                  continue;
                }
              }

              // 确保发送100%进度
              event.sender.send("download-folder-progress", {
                tabId,
                progress: 100,
                currentFile: "",
                transferredBytes: totalBytes,
                totalBytes,
                transferSpeed,
                remainingTime: 0,
                processedFiles: totalFiles,
                totalFiles,
              });

              // 成功下载
              await sftp.end();

              // 从活动传输列表中移除
              activeTransfers.delete(transferKey);

              // 最终确认下载的文件夹是否存在
              let finalSuccess = true;
              if (!fs.existsSync(normalizedLocalPath)) {
                logToFile(
                  `警告: 下载完成后无法找到目标文件夹: ${normalizedLocalPath}`,
                  "WARNING",
                );
                finalSuccess = false;
              } else {
                // 检查是否有文件下载成功
                const downloadedFiles = fs.readdirSync(normalizedLocalPath);
                logToFile(
                  `下载文件夹中的文件数量: ${downloadedFiles.length}`,
                  "INFO",
                );

                if (downloadedFiles.length === 0 && totalFiles > 0) {
                  logToFile(
                    `警告: 文件夹存在但为空，原始文件数: ${totalFiles}`,
                    "WARNING",
                  );
                  finalSuccess = false;
                }
              }

              logToFile(
                `Successfully downloaded folder "${remotePath}" to "${normalizedLocalPath}" for session ${tabId}, Final status: ${finalSuccess ? "SUCCESS" : "PARTIAL_FAILURE"}`,
                finalSuccess ? "INFO" : "WARNING",
              );

              // 在资源管理器中显示下载的文件夹
              if (finalSuccess) {
                try {
                  logToFile(
                    `尝试在文件资源管理器中显示文件夹: ${normalizedLocalPath}`,
                    "INFO",
                  );
                  shell.showItemInFolder(normalizedLocalPath);
                } catch (showError) {
                  logToFile(
                    `Error showing folder in explorer: ${showError.message}`,
                    "ERROR",
                  );
                  // 即使无法显示文件夹，也不影响下载成功状态
                }
              }

              resolve({
                success: finalSuccess,
                folderName,
                downloadPath: normalizedLocalPath, // 返回完整下载路径
                // 提供更详细的状态信息
                fileCount: allFiles.length,
                totalSize: totalBytes,
                message: finalSuccess
                  ? `成功下载${allFiles.length}个文件`
                  : "下载可能不完整，请检查文件夹内容",
              });
            } catch (error) {
              logToFile(
                `Download folder error for session ${tabId}: ${error.message}`,
                "ERROR",
              );
              await sftp.end().catch(() => {}); // 忽略关闭连接可能的错误

              // 从活动传输列表中移除
              activeTransfers.delete(transferKey);

              // 如果是用户取消导致的错误，提供友好的消息
              if (
                error.message.includes("aborted") ||
                error.message.includes("cancel") ||
                error.message.includes("传输已取消")
              ) {
                resolve({
                  success: false,
                  cancelled: true,
                  error: "下载已取消",
                });
              } else {
                resolve({
                  success: false,
                  error: `下载文件夹失败: ${error.message}`,
                });
              }
            }
          });
        } catch (error) {
          logToFile(
            `Download folder error for session ${tabId}: ${error.message}`,
            "ERROR",
          );
          return { success: false, error: `下载文件夹失败: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(
        `Download folder error for session ${tabId}: ${error.message}`,
        "ERROR",
      );
      return { success: false, error: `下载文件夹失败: ${error.message}` };
    }
  });

  // 添加检查路径是否存在的API
  ipcMain.handle("checkPathExists", async (event, checkPath) => {
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
  ipcMain.handle("showItemInFolder", async (event, itemPath) => {
    try {
      logToFile(`尝试在文件管理器中显示: ${itemPath}`, "INFO");
      shell.showItemInFolder(itemPath);
      return true;
    } catch (error) {
      logToFile(`显示文件或文件夹失败: ${error.message}`, "ERROR");
      return false;
    }
  });

  // UI设置相关API
  ipcMain.handle("settings:loadUISettings", async () => {
    return await configManager.loadUISettings(); // loadUISettings in configManager is not async, but IPC handler can be
  });

  ipcMain.handle("settings:saveUISettings", async (event, settings) => {
    return await configManager.saveUISettings(settings); // saveUISettings in configManager is not async
  });

  // 获取快捷命令
  ipcMain.handle("get-shortcut-commands", async () => {
    try {
      const data = configManager.loadShortcutCommands();
      return { success: true, data };
    } catch (error) {
      if (logToFile)
        logToFile(
          `Error in get-shortcut-commands (IPC): ${error.message}`,
          "ERROR",
        );
      return { success: false, error: error.message };
    }
  });

  // 保存快捷命令
  ipcMain.handle("save-shortcut-commands", async (_, data) => {
    try {
      const result = configManager.saveShortcutCommands(data);
      return {
        success: result,
        error: result ? null : "Failed to save shortcut commands (IPC)",
      };
    } catch (error) {
      if (logToFile)
        logToFile(
          `Error in save-shortcut-commands (IPC): ${error.message}`,
          "ERROR",
        );
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle("downloadFolder", async (event, tabId, remotePath) => {
    if (!sftpTransfer || typeof sftpTransfer.handleDownloadFolder !== 'function') {
      logToFile("sftpTransfer.handleDownloadFolder is not available or not a function.", "ERROR");
      return { success: false, error: "SFTP Download feature not properly initialized." };
    }
    // sftpTransfer.handleDownloadFolder signature is: async function handleDownloadFolder(tabId, remoteFolderPath)
    return sftpTransfer.handleDownloadFolder(tabId, remotePath);
  });
} // Closing brace for setupIPC function
