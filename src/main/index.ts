const { app, shell, BrowserWindow, ipcMain, dialog } = require("electron");
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../renderer/src/assets/SimpleShell-icon.png?asset";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { Client } from "ssh2";
import * as pty from "node-pty";
import SftpClient from "ssh2-sftp-client";
import {
  encryptConnection,
  decryptConnection,
  decryptString,
  encryptApiConfig,
  decryptApiConfig,
  encryptApiConfigs,
  decryptApiConfigs,
} from "./crypto-utils";
import { spawn } from "child_process";
import OpenAI from "openai";

// 主窗口实例
let mainWindow: typeof BrowserWindow | null = null;

// 定义连接配置的数据类型
interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  useProxy?: boolean;
  proxyHost?: string;
  proxyPort?: number;
  username: string;
  password?: string;
  privateKey?: string;
  description?: string;
}

interface Organization {
  id: string;
  name: string;
  connections: Connection[];
}

// 定义设置接口
interface AppSettings {
  language: string;
  fontSize: number;
  fontFamily: string;
  terminalFontFamily: string;
  terminalFontSize: number;
  aiSettings?: {
    apiUrl?: string;
    apiKey?: string;
    modelName?: string;
  };
  aiApis?: Array<{
    id: string;
    name: string;
    apiUrl: string;
    apiKey: string;
    modelName: string;
  }>;
  sshKeepAlive?: {
    enabled: boolean;
    interval: number;
  };
}

// 连接配置文件路径
const connectionsFilePath = is.dev
  ? path.join(process.cwd(), "connections.json")
  : path.join(getAppPath(), "connections.json");

// 设置文件路径
const settingsPath = is.dev
  ? path.join(process.cwd(), "config.json")
  : path.join(getAppPath(), "config.json");

// 临时文件路径
let tempDir = is.dev
  ? path.join(process.cwd(), "temp")
  : path.join(getAppPath(), "temp");

// 确保临时目录存在
if (!fs.existsSync(tempDir)) {
  try {
    fs.mkdirSync(tempDir, { recursive: true });
  } catch (error) {
    console.error("创建临时目录失败:", error);
    // 如果创建失败，使用系统临时目录
    tempDir = app.getPath("temp");
  }
}

// 输出环境信息
console.log("应用环境:", is.dev ? "开发环境" : "生产环境");
console.log("应用路径:", getAppPath());
console.log("连接配置文件路径:", connectionsFilePath);
console.log("设置文件路径:", settingsPath);
console.log("临时文件路径:", tempDir);

// 加载连接配置
function loadConnections(): Organization[] {
  try {
    if (fs.existsSync(connectionsFilePath)) {
      const fileContent = fs.readFileSync(connectionsFilePath, "utf-8");
      // 如果文件存在但为空或内容无效，返回空数组
      if (!fileContent.trim()) {
        // console.log('配置文件存在但为空，返回空数组')
        return [];
      }

      try {
        const parsed = JSON.parse(fileContent);
        // 确认解析出的内容是数组
        if (Array.isArray(parsed)) {
          // 解密敏感数据
          return parsed.map((org) => ({
            ...org,
            connections: Array.isArray(org.connections)
              ? org.connections.map((conn) => decryptConnection(conn))
              : [],
          }));
        } else {
          // console.warn('配置文件内容不是有效数组，返回空数组')
          return [];
        }
      } catch (parseError) {
        // console.error('解析配置文件失败:', parseError)
        return [];
      }
    }
  } catch (error) {
    // console.error('加载连接配置失败:', error)
  }

  // 如果文件不存在，返回空数组
  // console.log('配置文件不存在，返回空数组')
  return [];
}

// 保存连接配置
function saveConnections(organizations: Organization[]): boolean {
  try {
    const dirPath = path.dirname(connectionsFilePath);

    // 确保目录存在
    if (!fs.existsSync(dirPath)) {
      console.log("创建目录:", dirPath);
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // 在开发环境中，额外打印路径信息
    console.log("保存连接配置到:", connectionsFilePath);
    // 数据可能很大，只打印长度信息
    console.log(
      "保存数据:",
      Array.isArray(organizations) ? `${organizations.length}个组织` : "非数组",
    );

    // 加密敏感数据
    const encryptedOrganizations = organizations.map((org) => ({
      ...org,
      connections: Array.isArray(org.connections)
        ? org.connections.map((conn) => encryptConnection(conn as Connection))
        : [],
    }));

    // 以同步方式写入文件
    const jsonContent = JSON.stringify(encryptedOrganizations, null, 2);
    fs.writeFileSync(connectionsFilePath, jsonContent, {
      encoding: "utf-8",
      flag: "w",
    });
    // console.log('文件写入完成，内容长度:', jsonContent.length, '字节')

    // 验证写入是否成功
    // if (fs.existsSync(connectionsFilePath)) {
    // 检查文件大小 - 仅用于调试
    // const fileSize = fs.statSync(connectionsFilePath).size
    // console.log('文件大小:', fileSize, '字节')

    // 验证内容是否正确写入 - 仅用于调试
    // const readContent = fs.readFileSync(connectionsFilePath, 'utf-8')
    // const isValid = readContent.length > 0 && readContent === jsonContent
    // console.log('内容验证:', isValid ? '成功' : '失败')

    // 内容验证不再做额外处理，避免无限循环
    //  }

    return true;
  } catch (error) {
    console.error("保存连接配置失败，错误详情:", error);
    return false;
  }
}

// 获取CPU使用率
async function getCpuUsage(): Promise<number> {
  const startMeasure = os.cpus().map((cpu) => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0),
  }));

  await new Promise((resolve) => setTimeout(resolve, 1000));

  const endMeasure = os.cpus().map((cpu) => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0),
  }));

  const idleDifference = endMeasure[0].idle - startMeasure[0].idle;
  const totalDifference = endMeasure[0].total - startMeasure[0].total;
  return 100 - (idleDifference / totalDifference) * 100;
}

// 获取系统信息
async function getSystemInfo() {
  const cpuUsage = await getCpuUsage();

  const cpus = os.cpus();

  // 获取总内存和可用内存
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const usedMemPercentage = Math.round((usedMem / totalMem) * 100);

  return {
    osInfo: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    },
    cpuInfo: {
      usage: cpuUsage,
      model: cpus[0].model,
      cores: cpus.length,
    },
    memoryInfo: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usedPercentage: usedMemPercentage,
    },
  };
}

// 记录所有活动的SSH连接
const activeConnections = new Map();

// 记录所有活动的SFTP连接
const activeSftpConnections = new Map<string, SftpClient>();

// 存储活跃的传输任务
const activeTransfers = new Map<
  string,
  {
    readStream?: fs.ReadStream | NodeJS.ReadStream;
    writeStream?: fs.WriteStream | NodeJS.WritableStream;
    connectionId: string;
  }
>();

// 全局变量，用于存储当前的流式请求控制器
let currentStreamController: AbortController | null = null;

// 保持连接活跃的时间间隔 (毫秒) - 默认2分钟
const DEFAULT_KEEP_ALIVE_INTERVAL = 120000;

// 存储每个连接的keep-alive定时器
const keepAliveTimers = new Map<string, NodeJS.Timeout>();

// 获取保持连接活跃的时间间隔 (毫秒)
function getKeepAliveInterval(): number {
  try {
    const settings = loadSettings();
    // 从设置中获取interval值，如果启用并设置了有效值则使用，否则使用默认值
    if (
      settings.sshKeepAlive?.enabled !== false &&
      settings.sshKeepAlive?.interval &&
      settings.sshKeepAlive.interval >= 30000
    ) {
      return settings.sshKeepAlive.interval;
    }
    return DEFAULT_KEEP_ALIVE_INTERVAL;
  } catch (error) {
    console.error("获取保持活跃间隔设置失败，使用默认值:", error);
    return DEFAULT_KEEP_ALIVE_INTERVAL;
  }
}

// SSH会话管理
ipcMain.handle("ssh:connect", async (_, connectionInfo: Connection) => {
  let originalInfo: Partial<Connection> = {};
  try {
    // 输出连接信息，但排除可能的敏感信息
    console.log(
      "收到SSH连接请求:",
      connectionInfo
        ? `${connectionInfo.name || "unnamed"}@${connectionInfo.host || "unknown"}:${connectionInfo.port || "unknown"}`
        : "无效连接信息",
    );

    // 首先对整个对象进行序列化和反序列化，确保没有非JSON类型数据
    // 这可以排除所有无法序列化的数据类型
    let safeConnectionInfo: Partial<Connection>;
    try {
      // 保存原始数据用于调试
      originalInfo = { ...connectionInfo };

      // 解密可能加密过的密码和私钥
      if (connectionInfo?.password) {
        connectionInfo.password = decryptString(connectionInfo.password);
      }

      if (connectionInfo?.privateKey) {
        connectionInfo.privateKey = decryptString(connectionInfo.privateKey);
      }

      // 创建只有基本数据类型的安全连接对象
      const connectionStr = JSON.stringify({
        id: (connectionInfo?.id as string) || `conn_${Date.now()}`,
        name: (connectionInfo?.name as string) || "未命名连接",
        host: (connectionInfo?.host as string) || "",
        port: (connectionInfo?.port as number) || 22,
        username: (connectionInfo?.username as string) || "",
        password: (connectionInfo?.password as string) || "",
        privateKey: (connectionInfo?.privateKey as string) || "",
        useProxy: connectionInfo?.useProxy || false,
        proxyHost: connectionInfo?.proxyHost || "",
        proxyPort: connectionInfo?.proxyPort || 1080,
      });
      safeConnectionInfo = JSON.parse(connectionStr);

      console.log("连接信息预处理成功");
    } catch (e: unknown) {
      const serializeError = e as Error;
      console.error("连接信息序列化失败:", serializeError);
      console.log(
        "原始连接信息:",
        originalInfo
          ? `${originalInfo.name || "unnamed"}@${originalInfo.host || "unknown"}:${originalInfo.port || "unknown"}`
          : "无效连接信息",
      );
      return {
        success: false,
        error: "连接信息处理失败: " + serializeError.message,
      };
    }

    // 安全地提取必要属性，使用空字符串或默认值防止undefined
    const id = safeConnectionInfo.id || `conn_${Date.now()}`;
    const host = safeConnectionInfo.host || "";
    const port = safeConnectionInfo.port || 22;
    const username = safeConnectionInfo.username || "";
    const password = safeConnectionInfo.password || "";
    const privateKey = safeConnectionInfo.privateKey || "";

    // 验证必要属性
    if (!host) {
      return { success: false, error: "连接信息不完整: 缺少主机地址" };
    }

    if (!username) {
      return { success: false, error: "连接信息不完整: 缺少用户名" };
    }

    if (!password && !privateKey) {
      return { success: false, error: "连接信息不完整: 需要密码或私钥" };
    }

    // 检查是否已经有活动连接
    if (activeConnections.has(id)) {
      console.log("连接已存在，复用现有连接:", id);
      return { success: true, id };
    }

    // 创建新的SSH连接
    const conn = new Client();

    // 返回一个Promise，等待连接完成或失败
    return new Promise((resolve, reject) => {
      try {
        // 准备连接配置
        const connectConfig: {
          host: string;
          port: number;
          username: string;
          password?: string;
          privateKey?: string;
          readyTimeout: number;
          proxy?: {
            host: string;
            port: number;
            command?: string;
          };
        } = {
          host,
          port,
          username,
          readyTimeout: 30000, // 30秒超时
        };

        // 添加认证方式
        if (privateKey) {
          console.log("使用私钥认证");
          connectConfig.privateKey = privateKey;
        } else if (password) {
          console.log("使用密码认证");
          connectConfig.password = password;
        }

        // 添加代理配置
        if (
          safeConnectionInfo.useProxy &&
          safeConnectionInfo.proxyHost &&
          safeConnectionInfo.proxyPort
        ) {
          console.log(
            `使用代理: ${safeConnectionInfo.proxyHost}:${safeConnectionInfo.proxyPort}`,
          );
          connectConfig.proxy = {
            host: safeConnectionInfo.proxyHost,
            port: safeConnectionInfo.proxyPort,
          };
        }

        // 设置事件处理器
        conn.on("ready", async () => {
          console.log(`SSH连接 ${id} 已就绪`);

          try {
            // 获取保持连接活跃设置
            const settings = loadSettings();
            const enableKeepAlive = settings.sshKeepAlive?.enabled !== false;

            // 设置保持连接活跃的定时器
            if (enableKeepAlive) {
              const keepAliveTimer = setInterval(() => {
                try {
                  // 发送SSH保持活跃包
                  if (conn && conn.exec) {
                    conn.exec("echo keepalive", (err, stream) => {
                      if (err) {
                        console.error(`保持活跃命令失败 (${id}):`, err);
                        return;
                      }

                      // 处理响应但不进行任何操作
                      stream.on("close", () => {
                        // Keep-alive命令已执行完毕
                      });
                    });
                    console.log(`发送保持活跃请求 (${id})`);
                  }
                } catch (keepAliveError) {
                  console.error(`保持活跃请求失败 (${id}):`, keepAliveError);
                }
              }, getKeepAliveInterval());

              // 存储定时器以便以后清理
              keepAliveTimers.set(id, keepAliveTimer);
              console.log(
                `已为连接 ${id} 设置保持活跃定时器，间隔: ${getKeepAliveInterval()}毫秒`,
              );
            } else {
              console.log(`连接 ${id} 未启用保持活跃功能`);
            }

            // 创建SFTP连接
            const sftp = new SftpClient();

            // 设置更长的超时时间
            const sftpConfig: any = {
              host: connectionInfo.host,
              port: connectionInfo.port,
              username: connectionInfo.username,
              password: connectionInfo.password,
              privateKey: connectionInfo.privateKey,
              readyTimeout: 30000,
              retries: 3,
              retry_factor: 2,
              retry_minTimeout: 5000,
            };

            // 添加SFTP代理配置
            if (
              connectionInfo.useProxy &&
              connectionInfo.proxyHost &&
              connectionInfo.proxyPort
            ) {
              console.log(
                `SFTP使用代理: ${connectionInfo.proxyHost}:${connectionInfo.proxyPort}`,
              );
              sftpConfig.proxy = {
                host: connectionInfo.proxyHost,
                port: connectionInfo.proxyPort,
              };
            }

            console.log("开始SFTP连接...");
            await sftp.connect(sftpConfig);
            console.log("SFTP连接成功");

            // 存储连接对象
            activeConnections.set(id, {
              connection: conn,
              shells: new Map(),
            });

            // 存储SFTP连接
            activeSftpConnections.set(id, sftp);
            console.log("已存储SFTP连接，ID:", id);
            console.log("当前活动SFTP连接数:", activeSftpConnections.size);

            // 验证SFTP连接是否可用
            try {
              console.log("测试SFTP连接...");
              // 直接调用list方法但不存储结果到未使用变量
              await sftp.list("/");
              console.log("SFTP连接测试成功，可以列出根目录");

              // 发送SFTP就绪事件到渲染进程
              if (mainWindow) {
                mainWindow.webContents.send("sftp:ready", { connectionId: id });
              }

              // 只有在SFTP连接测试成功后才返回成功
              resolve({ success: true, id });
            } catch (testError) {
              console.error("SFTP连接测试失败:", testError);
              // 清理SFTP连接
              try {
                await sftp.end();
                activeSftpConnections.delete(id);
              } catch (cleanupError) {
                console.error("清理SFTP连接失败:", cleanupError);
              }
              resolve({
                success: true,
                id,
                warning: `SFTP连接失败: ${testError instanceof Error ? testError.message : "未知错误"}`,
              });
            }
          } catch (error) {
            console.error("SFTP连接失败:", error);
            // 即使SFTP连接失败，我们仍然保持SSH连接
            activeConnections.set(id, {
              connection: conn,
              shells: new Map(),
            });
            resolve({
              success: true,
              id,
              warning: `SFTP连接失败: ${error instanceof Error ? error.message : "未知错误"}`,
            });
          }
        });

        conn.on("error", (err) => {
          console.error(`SSH连接 ${id} 错误:`, err);
          reject({ success: false, error: err.message || "连接错误" });
        });

        conn.on("timeout", () => {
          console.error(`SSH连接 ${id} 超时`);
          reject({ success: false, error: "连接超时" });
        });

        conn.on("close", (hadError) => {
          console.log(`SSH连接 ${id} 关闭${hadError ? "(有错误)" : ""}`);
          if (hadError) {
            reject({ success: false, error: "连接被关闭(有错误)" });
          }
        });

        // 开始连接
        console.log(`开始连接到 ${host}:${port}`);
        conn.connect(connectConfig);
      } catch (e: unknown) {
        const connError = e as Error;
        console.error("启动SSH连接过程时出错:", connError);
        reject({ success: false, error: "启动连接失败: " + connError.message });
      }
    }).catch((error) => {
      console.error("SSH连接Promise处理失败:", error);
      return {
        success: false,
        error: error.error || error.message || "未知连接错误",
      };
    });
  } catch (error) {
    console.error("SSH/SFTP连接失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
});

// 创建Shell会话
ipcMain.handle("ssh:shell", async (_, { connectionId, cols, rows }) => {
  try {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) {
      return { success: false, error: "连接不存在" };
    }

    const shellId = Date.now().toString();

    return new Promise((resolve, reject) => {
      connInfo.connection.shell(
        { term: "xterm-256color", cols, rows },
        (err, stream) => {
          if (err) {
            console.error("创建Shell失败:", err);
            reject({ success: false, error: err.message });
            return;
          }

          // 存储Shell流
          connInfo.shells.set(shellId, stream);

          // 设置数据接收事件
          stream.on("data", (data) => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("ssh:data", {
                connectionId,
                shellId,
                data: data.toString(),
              });
            }
          });

          stream.on("close", () => {
            console.log(`Shell ${shellId} 关闭`);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send("ssh:close", {
                connectionId,
                shellId,
              });
            }
            connInfo.shells.delete(shellId);
          });

          resolve({ success: true, shellId });
        },
      );
    });
  } catch (error) {
    console.error("创建Shell失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "创建Shell失败",
    };
  }
});

// SSH输入数据处理
ipcMain.on("ssh:input", (_, { connectionId, shellId, data }) => {
  try {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) {
      console.error("连接不存在:", connectionId);
      return;
    }

    const stream = connInfo.shells.get(shellId);
    if (!stream) {
      console.error("Shell不存在:", shellId);
      return;
    }

    // 向SSH流写入数据
    stream.write(data);
  } catch (error) {
    console.error("发送数据失败:", error);
  }
});

// SSH调整窗口大小
ipcMain.on("ssh:resize", (_, { connectionId, shellId, cols, rows }) => {
  try {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const stream = connInfo.shells.get(shellId);
    if (!stream) return;

    // 调整终端大小
    stream.setWindow(rows, cols);
  } catch (error) {
    console.error("调整终端大小失败:", error);
  }
});

// 关闭Shell
ipcMain.on("ssh:close-shell", (_, { connectionId, shellId }) => {
  try {
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo) return;

    const stream = connInfo.shells.get(shellId);
    if (stream) {
      // 关闭流
      stream.end();
      connInfo.shells.delete(shellId);
    }
  } catch (error) {
    console.error("关闭Shell失败:", error);
  }
});

// 关闭连接
ipcMain.on("ssh:disconnect", (_, { connectionId }) => {
  (async () => {
    try {
      // 清除keep-alive定时器
      const timer = keepAliveTimers.get(connectionId);
      if (timer) {
        clearInterval(timer);
        keepAliveTimers.delete(connectionId);
        console.log(`已清除 ${connectionId} 的保持活跃定时器`);
      }

      // 断开SFTP连接
      const sftp = activeSftpConnections.get(connectionId);
      if (sftp) {
        await sftp.end();
        activeSftpConnections.delete(connectionId);
      }

      const connInfo = activeConnections.get(connectionId);
      if (!connInfo) return;

      // 关闭所有Shell
      for (const stream of connInfo.shells.values()) {
        stream.end();
      }

      // 关闭连接
      connInfo.connection.end();
      activeConnections.delete(connectionId);
      console.log(`SSH连接 ${connectionId} 已关闭`);
    } catch (error) {
      console.error("断开连接失败:", error);
    }
  })();
});

//==============================
// 终端相关函数
//==============================

// 启动Windows Terminal（作为独立进程）
function launchWindowsTerminal() {
  if (process.platform === "win32") {
    try {
      // 尝试启动Windows Terminal
      spawn("wt.exe", [], {
        detached: true,
        stdio: "ignore",
        shell: true,
      }).unref();
      console.log("已启动Windows Terminal");
      return true;
    } catch (error) {
      console.error("启动Windows Terminal失败:", error);
      return false;
    }
  }
  return false;
}

// 为存储本地终端进程添加映射
const localTerminals = new Map<
  string,
  {
    pty: pty.IPty;
    dataCallback?: (data: { id: string; data: string }) => void;
  }
>();

// 创建本地终端（集成到应用程序内）
async function createLocalTerminal(options: {
  cols: number;
  rows: number;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { cols, rows } = options;
    // 使用更独特的ID，确保每次创建都是唯一的
    const id = `term_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

    console.log(`创建新本地终端会话，ID: ${id}, 列: ${cols}, 行: ${rows}`);
    console.log(`当前活跃终端数量: ${localTerminals.size}`);

    // 确定要使用的Shell
    let shell: string;
    let args: string[] = [];

    // Windows特殊处理
    if (process.platform === "win32") {
      shell = "powershell.exe";
      // 检查用户是否想使用Windows Terminal而不是集成终端
      if (process.env.USE_EXTERNAL_TERMINAL === "true") {
        if (launchWindowsTerminal()) {
          return { success: false, error: "已启动外部Windows Terminal" };
        }
      }
    } else {
      // Linux/Mac使用标准shell
      shell = process.env.SHELL || "/bin/bash";
      args = ["-l"]; // 作为登录shell启动
    }

    console.log(`启动本地终端[${id}]: ${shell}`);

    // 创建伪终端
    const terminalProcess = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: cols || 80,
      rows: rows || 24,
      cwd: process.env.HOME || process.env.USERPROFILE,
      env: { ...process.env, TERM: "xterm-256color" },
    });

    // 存储终端实例
    localTerminals.set(id, {
      pty: terminalProcess,
    });

    console.log(
      `本地终端 ${id} 已创建，当前活跃终端数量: ${localTerminals.size}`,
    );
    console.log(
      `当前所有终端ID: ${Array.from(localTerminals.keys()).join(", ")}`,
    );

    return { success: true, id };
  } catch (error: unknown) {
    const err = error as Error;
    console.error("创建本地终端失败:", err);
    return { success: false, error: err.message || "创建终端失败" };
  }
}

// 向终端发送输入
function sendTerminalInput(options: { id: string; data: string }): void {
  const { id, data } = options;

  if (localTerminals.has(id)) {
    const terminal = localTerminals.get(id);
    if (terminal && terminal.pty) {
      terminal.pty.write(data);
    }
  }
}

// 调整终端大小
function resizeTerminal(options: {
  id: string;
  cols: number;
  rows: number;
}): void {
  const { id, cols, rows } = options;

  if (localTerminals.has(id)) {
    const terminal = localTerminals.get(id);
    if (terminal && terminal.pty) {
      try {
        terminal.pty.resize(cols, rows);
      } catch (error) {
        console.error("调整终端大小失败:", error);
      }
    }
  }
}

// 关闭终端
function closeTerminal(options: { id: string }): void {
  const { id } = options;

  console.log(`准备关闭本地终端，ID: ${id}`);

  if (localTerminals.has(id)) {
    const terminal = localTerminals.get(id);
    if (terminal && terminal.pty) {
      try {
        terminal.pty.kill();
        console.log(`本地终端 ${id} 已关闭`);
      } catch (error) {
        console.error("关闭终端失败:", error);
      } finally {
        localTerminals.delete(id);
        console.log(
          `终端 ${id} 已从列表中移除，剩余终端数量: ${localTerminals.size}`,
        );
      }
    }
  } else {
    console.log(`找不到终端 ${id}，可能已被关闭`);
  }
}

function createWindow(): void {
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    icon: icon,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: true,
      backgroundThrottling: false, // 禁用后台节流，使应用在后台也能正常运行
    },
  });

  if (mainWindow) {
    mainWindow.on("ready-to-show", () => {
      mainWindow?.show();
    });

    // 处理窗口失焦和获得焦点事件
    mainWindow.on("blur", () => {
      console.log("窗口失去焦点，但应用继续在后台运行");
      // 通知渲染进程窗口状态变化
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("window:state-change", {
          isFocused: false,
        });
      }
    });

    mainWindow.on("focus", () => {
      console.log("窗口获得焦点");
      // 通知渲染进程窗口状态变化
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("window:state-change", { isFocused: true });
      }
    });

    // 处理窗口关闭事件
    mainWindow.on("close", (e) => {
      console.log("窗口关闭事件触发");

      // 阻止窗口立即关闭
      e.preventDefault();

      // 通知渲染进程窗口即将关闭
      if (mainWindow && !mainWindow.isDestroyed()) {
        console.log("发送应用关闭通知到渲染进程");
        mainWindow.webContents.send("app:before-close");

        // 清理临时文件夹
        clearTempDirectory();

        // 清理所有keep-alive定时器
        cleanupKeepAliveTimers();

        // 给渲染进程一些时间来保存数据
        setTimeout(() => {
          console.log("延时结束，允许应用关闭");
          if (mainWindow) {
            mainWindow.destroy();
          }
        }, 500); // 给500毫秒的时间保存数据
      } else {
        // 如果窗口已经销毁，直接关闭
        app.quit();
      }
    });

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url);
      return { action: "deny" };
    });
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow?.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow?.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // 确保连接配置文件已初始化并有效
  console.log("应用启动，初始化连接配置文件");

  // 检查文件是否存在
  if (fs.existsSync(connectionsFilePath)) {
    console.log("配置文件已存在:", connectionsFilePath);
  } else {
    console.log("配置文件不存在，将创建空配置");
    // 创建空的配置文件
    saveConnections([]);
  }

  // 设置IPC处理程序
  function setupIPCHandlers() {
    // 系统信息
    ipcMain.handle("get-system-info", async () => {
      return await getSystemInfo();
    });

    // 加载连接
    ipcMain.handle("load-connections", async () => {
      return loadConnections();
    });

    // 保存连接
    ipcMain.handle("save-connections", async (_event, organizations) => {
      try {
        saveConnections(organizations);
        return { success: true };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("保存连接失败:", err);
        return { success: false, error: err.message || "保存失败" };
      }
    });

    // 启动Windows Terminal
    ipcMain.handle("launch-windows-terminal", async () => {
      return { success: launchWindowsTerminal() };
    });

    // 打开文件选择对话框
    ipcMain.handle("open-file-dialog", async (_event, options) => {
      try {
        const result = await dialog.showOpenDialog({
          properties: options?.properties || ["openFile"],
          filters: options?.filters || [
            { name: "所有文件", extensions: ["*"] },
          ],
          title: options?.title || "选择文件",
          buttonLabel: options?.buttonLabel || "选择",
          defaultPath: options?.defaultPath || app.getPath("home"),
        });

        if (result.canceled || result.filePaths.length === 0) {
          return { canceled: true };
        }

        // 如果是选择私钥文件，则需要读取文件内容
        if (!options?.properties?.includes("multiSelections")) {
          const filePath = result.filePaths[0];
          try {
            const fileContent = fs.readFileSync(filePath, "utf-8");
            return {
              canceled: false,
              filePath,
              fileContent,
            };
          } catch (readError: unknown) {
            const err = readError as Error;
            return {
              canceled: false,
              filePath,
              error: `无法读取文件内容: ${err.message}`,
            };
          }
        }

        // 对于多选或普通文件，只返回文件路径
        return {
          canceled: false,
          filePath: result.filePaths[0],
          filePaths: result.filePaths,
        };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("打开文件对话框失败:", err);
        return { canceled: true, error: err.message };
      }
    });

    // 获取临时文件夹路径
    ipcMain.handle("get-temp-dir", () => {
      return tempDir;
    });

    // 处理拖拽文件
    ipcMain.handle(
      "save-drag-file",
      async (_event, fileInfo: { name: string; path: string }) => {
        try {
          console.log("处理拖拽文件:", fileInfo.name, fileInfo.path);

          // 检查文件是否存在
          if (!fs.existsSync(fileInfo.path)) {
            console.error("拖拽的文件不存在:", fileInfo.path);
            return null;
          }

          // 提取原始文件名（不包含路径）
          const originalFileName = path.basename(fileInfo.name);

          // 对于大多数情况，我们可以直接使用原始文件路径
          // 但为了安全起见，我们可以选择复制到临时目录

          // 检查是否需要复制文件（例如，如果文件在网络驱动器上或是特殊格式）
          const needsCopy = false; // 这里可以添加逻辑来决定是否需要复制

          if (needsCopy) {
            // 创建临时文件路径，使用原始文件名
            const tempFilePath = path.join(tempDir, originalFileName);

            // 复制文件
            fs.copyFileSync(fileInfo.path, tempFilePath);
            console.log("文件已复制到临时位置:", tempFilePath);

            // 记录临时文件，以便后续删除
            tempFiles.set(tempFilePath, originalFileName);

            return { path: tempFilePath, originalName: originalFileName };
          }

          // 直接返回原始路径和文件名
          return { path: fileInfo.path, originalName: originalFileName };
        } catch (error) {
          console.error("处理拖拽文件失败:", error);
          return null;
        }
      },
    );

    // 保存文件内容到临时文件
    ipcMain.handle(
      "save-file-content",
      async (_event, fileInfo: { name: string; content: ArrayBuffer }) => {
        try {
          console.log("保存文件内容到临时文件:", fileInfo.name);

          // 提取原始文件名（不包含路径）
          const originalFileName = path.basename(fileInfo.name);

          // 创建临时文件路径，使用原始文件名
          const tempFilePath = path.join(tempDir, originalFileName);

          // 将ArrayBuffer转换为Buffer
          const buffer = Buffer.from(fileInfo.content);

          // 写入文件
          fs.writeFileSync(tempFilePath, buffer);
          console.log("文件内容已保存到临时位置:", tempFilePath);

          // 记录临时文件，以便后续删除
          tempFiles.set(tempFilePath, originalFileName);

          return { path: tempFilePath, originalName: originalFileName };
        } catch (error) {
          console.error("保存文件内容失败:", error);
          return null;
        }
      },
    );

    // 准备文件用于拖拽（从SFTP下载到临时位置）
    ipcMain.handle(
      "prepare-file-for-drag",
      async (
        _event,
        params: { connectionId: string; remotePath: string; fileName: string },
      ) => {
        try {
          console.log("准备文件用于拖拽:", params.fileName);

          const sftp = activeSftpConnections.get(params.connectionId);
          if (!sftp) {
            console.error("SFTP连接不存在，ID:", params.connectionId);
            return null;
          }

          // 提取原始文件名（不包含路径）
          const originalFileName = path.basename(params.fileName);

          // 创建临时文件路径，使用原始文件名
          const tempFilePath = path.join(tempDir, originalFileName);

          // 下载文件到临时位置
          await sftp.fastGet(params.remotePath, tempFilePath);
          console.log("文件已下载到临时位置:", tempFilePath);

          // 记录临时文件，以便后续删除
          tempFiles.set(tempFilePath, originalFileName);

          return tempFilePath;
        } catch (error) {
          console.error("准备拖拽文件失败:", error);
          return null;
        }
      },
    );

    // 启动拖拽操作
    ipcMain.handle(
      "start-drag",
      (
        _event,
        params: { filePath: string; fileName: string; isDarkTheme: boolean },
      ) => {
        try {
          console.log("启动拖拽操作:", params.fileName);

          // 确保文件存在
          if (!fs.existsSync(params.filePath)) {
            console.error("拖拽的文件不存在:", params.filePath);
            return { success: false, error: "文件不存在" };
          }

          // 获取发送事件的窗口
          const webContents = _event.sender;

          // 根据主题选择图标
          const iconName = params.isDarkTheme
            ? "file-night.svg"
            : "file-day.svg";

          // 创建拖拽项
          const dragItem = {
            file: params.filePath,
            icon: path.join(__dirname, "../renderer/assets", iconName), // 根据主题选择图标
          };

          // 根据文件扩展名选择合适的图标
          const ext = path.extname(params.fileName).toLowerCase();
          if ([".jpg", ".jpeg", ".png", ".gif", ".bmp"].includes(ext)) {
            // 对于图片文件，可以使用文件本身作为图标
            dragItem.icon = params.filePath;
          }

          // 启动拖拽操作
          webContents.startDrag(dragItem);

          return { success: true };
        } catch (error) {
          console.error("启动拖拽操作失败:", error);
          return { success: false, error: "启动拖拽失败" };
        }
      },
    );

    // SFTP相关处理程序
    ipcMain.handle("sftp:readDir", async (_, { connectionId, path }) => {
      try {
        console.log("尝试读取目录，连接ID:", connectionId);
        console.log(
          "当前活动SFTP连接:",
          Array.from(activeSftpConnections.keys()),
        );

        const sftp = activeSftpConnections.get(connectionId);
        if (!sftp) {
          console.error("SFTP连接不存在，ID:", connectionId);
          return { success: false, error: "SFTP连接不存在" };
        }

        console.log("开始读取目录:", path);
        const list = await sftp.list(path);
        console.log("目录读取成功，文件数量:", list.length);

        const files = list.map((item) => {
          // 确保modifyTime是有效的Date对象
          let modifyTime = item.modifyTime;

          // 检查是否为有效Date对象，如不是则尝试转换
          if (!(modifyTime instanceof Date) || isNaN(modifyTime.getTime())) {
            try {
              // 如果是时间戳（数字）
              if (typeof modifyTime === "number") {
                modifyTime = new Date(modifyTime);
              }
              // 如果是字符串
              else if (typeof modifyTime === "string") {
                modifyTime = new Date(modifyTime);
              }
              // 其他情况，使用当前时间
              else {
                console.warn("无法识别的modifyTime格式:", modifyTime);
                modifyTime = new Date(); // 使用当前时间作为后备
              }
            } catch (error) {
              console.error("转换modifyTime失败:", error);
              modifyTime = new Date(); // 使用当前时间作为后备
            }
          }

          return {
            name: item.name,
            type: item.type === "d" ? "directory" : "file",
            size: item.size,
            modifyTime: modifyTime, // 使用处理后的时间
            permissions:
              item.rights.user + item.rights.group + item.rights.other,
            owner: item.owner,
            group: item.group,
          };
        });

        return { success: true, files };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("读取目录失败:", err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle(
      "sftp:downloadFile",
      async (_, { connectionId, remotePath }) => {
        try {
          const sftp = activeSftpConnections.get(connectionId);
          if (!sftp) {
            return { success: false, error: "SFTP连接不存在" };
          }

          // 打开保存文件对话框
          const result = await dialog.showSaveDialog({
            defaultPath: path.basename(remotePath),
          });

          if (result.canceled || !result.filePath) {
            return { success: false, error: "用户取消下载" };
          }

          // 创建唯一的传输ID
          const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // 获取文件信息以获取大小
          const stats = await sftp.stat(remotePath);
          const fileSize = stats.size;

          // 发送开始传输事件
          if (mainWindow) {
            mainWindow.webContents.send("sftp:transferStart", {
              id: downloadId,
              type: "download",
              filename: path.basename(remotePath),
              path: remotePath,
              size: fileSize,
              connectionId,
            });
          }

          // 使用stream进行传输并跟踪进度
          const readStream = await sftp.createReadStream(remotePath);
          const writeStream = fs.createWriteStream(result.filePath);

          let transferred = 0;

          readStream.on("data", (chunk) => {
            transferred += chunk.length;

            // 发送进度更新
            if (mainWindow && fileSize > 0) {
              mainWindow.webContents.send("file-download-progress", {
                id: downloadId,
                transferred,
                progress: Math.min(
                  100,
                  Math.round((transferred / fileSize) * 100),
                ),
              });
            }
          });

          // 存储传输任务信息
          activeTransfers.set(downloadId, {
            readStream,
            writeStream,
            connectionId,
          });

          // 返回Promise，在stream结束或出错时解析
          return new Promise((resolve, reject) => {
            writeStream.on("finish", () => {
              // 发送完成事件
              if (mainWindow) {
                mainWindow.webContents.send("sftp:transferComplete", {
                  id: downloadId,
                  success: true,
                });
              }

              // 移除传输任务
              activeTransfers.delete(downloadId);

              resolve({ success: true, transferId: downloadId });
            });

            writeStream.on("error", (err) => {
              // 发送错误事件
              if (mainWindow) {
                mainWindow.webContents.send("sftp:transferError", {
                  id: downloadId,
                  error: err.message,
                });
              }

              reject(err);
            });

            readStream.pipe(writeStream);
          });
        } catch (error: unknown) {
          const err = error as Error;
          console.error("下载文件失败:", err);
          return { success: false, error: err.message };
        }
      },
    );

    ipcMain.handle(
      "sftp:uploadFile",
      async (_, { connectionId, localPath, remotePath }) => {
        try {
          const sftp = activeSftpConnections.get(connectionId);
          if (!sftp) {
            return { success: false, error: "SFTP连接不存在" };
          }

          const fileName = path.basename(localPath);
          const remoteFilePath =
            remotePath === "/" ? `/${fileName}` : `${remotePath}/${fileName}`;

          // 创建唯一的传输ID
          const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          // 获取文件信息以获取大小
          const stats = fs.statSync(localPath);
          const fileSize = stats.size;

          // 发送开始传输事件
          if (mainWindow) {
            mainWindow.webContents.send("sftp:transferStart", {
              id: uploadId,
              type: "upload",
              filename: fileName,
              path: localPath,
              size: fileSize,
              connectionId,
            });
          }

          // 使用stream进行传输并跟踪进度
          const readStream = fs.createReadStream(localPath);
          const writeStream = await sftp.createWriteStream(remoteFilePath);

          let transferred = 0;

          readStream.on("data", (chunk) => {
            transferred += chunk.length;

            // 发送进度更新
            if (mainWindow && fileSize > 0) {
              mainWindow.webContents.send("sftp:transferProgress", {
                id: uploadId,
                transferred,
                progress: Math.min(
                  100,
                  Math.round((transferred / fileSize) * 100),
                ),
              });
            }
          });

          // 存储传输任务信息
          activeTransfers.set(uploadId, {
            readStream,
            writeStream,
            connectionId,
          });

          // 返回Promise，在stream结束或出错时解析
          return new Promise((resolve, reject) => {
            writeStream.on("finish", () => {
              // 发送完成事件
              if (mainWindow) {
                mainWindow.webContents.send("sftp:transferComplete", {
                  id: uploadId,
                  success: true,
                });
              }

              // 移除传输任务
              activeTransfers.delete(uploadId);

              // 如果是临时文件，上传完成后删除
              if (tempFiles.has(localPath)) {
                try {
                  fs.unlinkSync(localPath);
                  tempFiles.delete(localPath);
                  console.log("上传完成后删除临时文件:", localPath);
                } catch (deleteError) {
                  console.error("删除临时文件失败:", deleteError);
                }
              }

              resolve({ success: true, transferId: uploadId });
            });

            writeStream.on("error", (err) => {
              // 发送错误事件
              if (mainWindow) {
                mainWindow.webContents.send("sftp:transferError", {
                  id: uploadId,
                  error: err.message,
                });
              }

              reject(err);
            });

            readStream.pipe(writeStream);
          });
        } catch (error: unknown) {
          const err = error as Error;
          console.error("上传文件失败:", err);
          return { success: false, error: err.message };
        }
      },
    );

    ipcMain.handle(
      "sftp:uploadFiles",
      async (_, { connectionId, localPaths, remotePath }) => {
        try {
          const sftp = activeSftpConnections.get(connectionId);
          if (!sftp) {
            console.error("SFTP连接不存在，ID:", connectionId);
            return { success: false, error: "SFTP连接不存在" };
          }

          // 记录失败的文件和成功的文件
          const failedFiles: string[] = [];
          const successFiles: string[] = [];

          // 创建上传队列
          const uploadQueue = localPaths.map((localPath) => ({
            localPath,
            fileName: path.basename(localPath),
            retryCount: 0,
            maxRetries: 3,
          }));

          // 处理单个文件上传
          const processUpload = async (
            queueItem: (typeof uploadQueue)[0],
          ): Promise<boolean> => {
            const { localPath, fileName } = queueItem;
            const remoteFilePath =
              remotePath === "/" ? `/${fileName}` : `${remotePath}/${fileName}`;

            try {
              // 创建唯一的传输ID
              const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

              // 获取文件信息以获取大小
              const stats = fs.statSync(localPath);
              const fileSize = stats.size;

              // 发送开始传输事件
              if (mainWindow) {
                mainWindow.webContents.send("sftp:transferStart", {
                  id: uploadId,
                  type: "upload",
                  filename: fileName,
                  path: localPath,
                  size: fileSize,
                  connectionId,
                });
              }

              // 创建读写流
              const readStream = fs.createReadStream(localPath);
              const writeStream = await sftp.createWriteStream(remoteFilePath);

              let transferred = 0;
              let lastProgressUpdate = Date.now();

              // 监听数据传输进度
              readStream.on("data", (chunk) => {
                transferred += chunk.length;

                // 控制进度更新频率，避免过多事件
                const now = Date.now();
                if (
                  now - lastProgressUpdate > 100 ||
                  transferred === fileSize
                ) {
                  lastProgressUpdate = now;

                  if (mainWindow && fileSize > 0) {
                    const progress = Math.min(
                      100,
                      Math.round((transferred / fileSize) * 100),
                    );
                    mainWindow.webContents.send("sftp:transferProgress", {
                      id: uploadId,
                      transferred,
                      progress,
                    });
                  }
                }
              });

              // 存储传输任务信息
              activeTransfers.set(uploadId, {
                readStream,
                writeStream,
                connectionId,
              });

              // 等待上传完成
              await new Promise((resolve, reject) => {
                let isCompleted = false;

                const cleanup = () => {
                  if (!isCompleted) {
                    isCompleted = true;
                    activeTransfers.delete(uploadId);
                    readStream.removeAllListeners();
                    writeStream.removeAllListeners();
                    readStream.destroy();
                    writeStream.end();
                  }
                };

                writeStream.on("finish", () => {
                  if (!isCompleted) {
                    if (mainWindow) {
                      mainWindow.webContents.send("sftp:transferComplete", {
                        id: uploadId,
                        success: true,
                      });
                    }
                    cleanup();
                    resolve(true);
                  }
                });

                writeStream.on("error", (err) => {
                  if (!isCompleted) {
                    if (mainWindow) {
                      mainWindow.webContents.send("sftp:transferError", {
                        id: uploadId,
                        error: err.message,
                      });
                    }
                    cleanup();
                    reject(err);
                  }
                });

                readStream.on("error", (err) => {
                  if (!isCompleted) {
                    if (mainWindow) {
                      mainWindow.webContents.send("sftp:transferError", {
                        id: uploadId,
                        error: err.message,
                      });
                    }
                    cleanup();
                    reject(err);
                  }
                });

                readStream.pipe(writeStream);
              });

              return true;
            } catch (error) {
              console.error(`上传文件失败: ${fileName}`, error);
              if (mainWindow) {
                mainWindow.webContents.send("sftp:transferError", {
                  id: `upload-${Date.now()}`,
                  error: error instanceof Error ? error.message : "未知错误",
                });
              }
              return false;
            }
          };

          // 并发处理上传队列，最多同时处理3个文件
          const concurrentLimit = 3;
          const chunks: (typeof uploadQueue)[] = [];
          for (let i = 0; i < uploadQueue.length; i += concurrentLimit) {
            chunks.push(uploadQueue.slice(i, i + concurrentLimit));
          }

          for (const chunk of chunks) {
            const results = await Promise.all(
              chunk.map(async (item) => {
                const success = await processUpload(item);
                if (!success) {
                  failedFiles.push(item.localPath);
                } else {
                  successFiles.push(item.localPath);
                }
                return success;
              }),
            );

            // 检查结果
            console.log(
              `当前批次上传结果: 成功=${results.filter((r) => r).length}, 失败=${results.filter((r) => !r).length}`,
            );
          }

          // 返回最终结果
          return {
            success: failedFiles.length === 0,
            failedFiles: failedFiles.length > 0 ? failedFiles : undefined,
            successFiles: successFiles.length > 0 ? successFiles : undefined,
          };
        } catch (error: unknown) {
          const err = error as Error;
          console.error("批量上传文件失败:", err);
          return { success: false, error: err.message };
        }
      },
    );

    ipcMain.handle("sftp:mkdir", async (_, { connectionId, path }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId);
        if (!sftp) {
          return { success: false, error: "SFTP连接不存在" };
        }

        await sftp.mkdir(path);
        return { success: true };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("创建目录失败:", err);
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle("sftp:delete", async (_, { connectionId, path }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId);
        if (!sftp) {
          return { success: false, error: "SFTP连接不存在" };
        }

        // 先检查是文件还是目录
        const stat = await sftp.stat(path);
        if (stat.isDirectory) {
          await sftp.rmdir(path, true); // true表示递归删除
        } else {
          await sftp.delete(path);
        }
        return { success: true };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("删除失败:", err);
        return { success: false, error: err.message };
      }
    });

    // 获取文件或文件夹的详细信息
    ipcMain.handle("sftp:getFileInfo", async (_, { connectionId, path }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId);
        if (!sftp) {
          return { success: false, error: "SFTP连接不存在" };
        }

        // 获取文件/文件夹的基本信息
        const stat = await sftp.stat(path);

        // 确保时间字段是有效的Date对象
        let modifyTime = stat.modifyTime;
        let accessTime = stat.accessTime;

        // 处理modifyTime
        if (!(modifyTime instanceof Date) || isNaN(modifyTime.getTime())) {
          try {
            if (typeof modifyTime === "number") {
              modifyTime = new Date(modifyTime);
            } else if (typeof modifyTime === "string") {
              modifyTime = new Date(modifyTime);
            } else {
              console.warn("无法识别的modifyTime格式:", modifyTime);
              modifyTime = new Date();
            }
          } catch (error) {
            console.error("转换modifyTime失败:", error);
            modifyTime = new Date();
          }
        }

        // 处理accessTime
        if (!(accessTime instanceof Date) || isNaN(accessTime.getTime())) {
          try {
            if (typeof accessTime === "number") {
              accessTime = new Date(accessTime);
            } else if (typeof accessTime === "string") {
              accessTime = new Date(accessTime);
            } else {
              console.warn("无法识别的accessTime格式:", accessTime);
              accessTime = new Date();
            }
          } catch (error) {
            console.error("转换accessTime失败:", error);
            accessTime = new Date();
          }
        }

        // 构建详细信息对象
        const fileInfo: {
          name: string;
          path: string;
          type: string;
          size: number;
          modifyTime: Date;
          accessTime: Date;
          rights: {
            user: string;
            group: string;
            other: string;
          };
          owner: string | number;
          group: string | number;
          isSymbolicLink: boolean;
          items?: number;
        } = {
          name: path.split("/").pop() || path,
          path: path,
          type: stat.isDirectory ? "directory" : "file",
          size: stat.size,
          modifyTime: modifyTime,
          accessTime: accessTime,
          rights: stat.rights,
          owner: stat.uid,
          group: stat.gid,
          isSymbolicLink: stat.isSymbolicLink,
        };

        // 如果是文件夹，尝试获取子项数量
        if (stat.isDirectory) {
          try {
            const list = await sftp.list(path);
            fileInfo.items = list.length;
          } catch (err) {
            fileInfo.items = 0;
          }
        }

        return { success: true, fileInfo };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("获取文件信息失败:", err);
        return { success: false, error: err.message };
      }
    });

    // 添加取消传输的IPC处理函数
    ipcMain.handle("sftp:cancelTransfer", async (_, { transferId }) => {
      try {
        const transfer = activeTransfers.get(transferId);
        if (!transfer) {
          return { success: false, error: "传输任务不存在或已完成" };
        }

        // 关闭流
        if (transfer.readStream) {
          if ("destroy" in transfer.readStream) {
            transfer.readStream.destroy();
          } else if ("close" in transfer.readStream) {
            (transfer.readStream as { close: () => void }).close();
          }
        }
        if (transfer.writeStream) {
          if ("destroy" in transfer.writeStream) {
            transfer.writeStream.destroy();
          } else if ("close" in transfer.writeStream) {
            (transfer.writeStream as { close: () => void }).close();
          }
        }

        // 从活跃传输列表中移除
        activeTransfers.delete(transferId);

        // 发送取消事件
        if (mainWindow) {
          mainWindow.webContents.send("sftp:transferCancelled", {
            id: transferId,
          });
        }

        return { success: true };
      } catch (error: unknown) {
        const err = error as Error;
        console.error("取消传输失败:", err);
        return { success: false, error: err.message };
      }
    });

    // 获取lexer规则文件内容
    ipcMain.handle("get-lexer-file", async (_, lexerName) => {
      try {
        const filePath = getLexerFilePath(lexerName);

        // 检查文件是否存在
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf8");
          return { success: true, content };
        } else {
          console.warn(`Lexer文件不存在: ${filePath}`);
          return { success: false, error: "Lexer文件不存在" };
        }
      } catch (error: unknown) {
        const err = error as Error;
        console.error("获取Lexer文件失败:", err);
        return { success: false, error: err.message || "未知错误" };
      }
    });

    // 执行SSH命令
    ipcMain.handle("ssh:exec", async (_, { connectionId, command }) => {
      try {
        const connInfo = activeConnections.get(connectionId);
        if (!connInfo) {
          return { success: false, error: "连接不存在" };
        }

        return new Promise((resolve, reject) => {
          connInfo.connection.exec(command, (err, stream) => {
            if (err) {
              console.error("执行SSH命令失败:", err);
              reject({ success: false, error: err.message });
              return;
            }

            let output = "";
            let errorOutput = "";

            stream.on("data", (data) => {
              output += data.toString();
            });

            stream.stderr.on("data", (data) => {
              errorOutput += data.toString();
            });

            stream.on("close", () => {
              if (errorOutput) {
                resolve({ success: false, error: errorOutput });
              } else {
                resolve({ success: true, output });
              }
            });
          });
        });
      } catch (error: unknown) {
        const err = error as Error;
        console.error("执行SSH命令失败:", err);
        return { success: false, error: err.message || "执行命令失败" };
      }
    });

    // 处理AI请求
    ipcMain.handle("ai:request", async (_, params) => {
      return handleAIRequest(params);
    });

    // 停止AI请求
    ipcMain.handle("ai:stop-request", () => {
      return stopAIRequest();
    });
  }

  setupIPCHandlers();

  // 本地终端IPC处理
  ipcMain.handle("terminal:create", async (_, options) => {
    console.log("收到创建本地终端请求，参数:", options);
    const result = await createLocalTerminal(options);

    if (result.success && result.id) {
      // 设置数据接收回调
      console.log(`为终端 ${result.id} 设置数据回调...`);
      const terminalInfo = localTerminals.get(result.id);
      if (terminalInfo && terminalInfo.pty) {
        terminalInfo.pty.onData((data: string) => {
          // 使用主窗口实例而不是获取当前焦点窗口
          if (mainWindow && !mainWindow.isDestroyed()) {
            // 发送数据到渲染进程
            mainWindow.webContents.send("terminal:data", {
              id: result.id,
              data,
            });
            // 调试输出数据流向
            if (process.env.NODE_ENV === "development") {
              const shortData =
                data.length > 20 ? data.substring(0, 20) + "..." : data;
              console.log(
                `终端[${result.id}]发送数据: ${shortData.replace(/\n/g, "\\n")}`,
              );
            }
          } else {
            console.log(`终端[${result.id}]数据无法发送：主窗口不可用`);
          }
        });

        console.log(`为终端 ${result.id} 设置了数据回调，准备返回结果`);
      } else {
        console.error(`无法为终端 ${result.id} 设置数据回调：找不到终端信息`);
      }
    } else {
      console.error("创建终端失败:", result.error);
    }

    return result;
  });

  ipcMain.on("terminal:input", (_, options) => {
    const { id } = options; // 只解构我们实际使用的id变量
    console.log(`接收到终端[${id}]输入请求`);
    sendTerminalInput(options);
  });

  ipcMain.on("terminal:resize", (_, options) => {
    const { id, cols, rows } = options;
    console.log(`接收到终端[${id}]调整大小请求: ${cols}x${rows}`);
    resizeTerminal(options);
  });

  ipcMain.on("terminal:close", (_, options) => {
    const { id } = options;
    console.log(`接收到终端[${id}]关闭请求`);
    closeTerminal(options);
  });

  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // 清空临时文件夹
  clearTempDirectory();

  // 设置定期清理临时文件夹的定时器（每小时清理一次）
  setInterval(
    () => {
      console.log("定期清理临时文件夹...");
      clearTempDirectory();
    },
    60 * 60 * 1000,
  ); // 60分钟 * 60秒 * 1000毫秒
});

// 加载全局设置
function loadSettings(): AppSettings {
  try {
    // 获取设置文件路径
    const configPath = settingsPath;

    if (fs.existsSync(configPath)) {
      // 读取配置文件
      const data = fs.readFileSync(configPath, "utf8");
      const parsedData = JSON.parse(data);

      // 提取设置对象
      const settings = Array.isArray(parsedData) ? parsedData[0] : parsedData;

      if (!settings) {
        console.warn("配置文件解析失败，使用默认设置");
        return getDefaultSettings();
      }

      // 解密API密钥
      if (Array.isArray(settings.aiApis)) {
        settings.aiApis = decryptApiConfigs(settings.aiApis);
      }

      if (settings.aiSettings) {
        const decryptedSettings = decryptApiConfig({
          id: "legacy",
          name: "Legacy Settings",
          apiUrl: settings.aiSettings.apiUrl || "",
          apiKey: settings.aiSettings.apiKey || "",
          modelName: settings.aiSettings.modelName || "",
        });

        settings.aiSettings = {
          apiUrl: decryptedSettings.apiUrl,
          apiKey: decryptedSettings.apiKey,
          modelName: decryptedSettings.modelName,
        };
      }

      // 增加默认值
      if (!settings.fontSize) settings.fontSize = 14;
      if (!settings.fontFamily) settings.fontFamily = "system-ui";
      if (!settings.language) settings.language = "zh-CN";
      if (!settings.terminalFontFamily)
        settings.terminalFontFamily = 'Consolas, "Courier New", monospace';
      if (!settings.terminalFontSize) settings.terminalFontSize = 14;

      // 确保 sshKeepAlive 设置存在
      if (!settings.sshKeepAlive) {
        settings.sshKeepAlive = {
          enabled: true,
          interval: 120000, // 默认2分钟
        };
      }

      return settings;
    } else {
      console.warn("配置文件不存在，使用默认设置");
      return getDefaultSettings();
    }
  } catch (error) {
    console.error("加载设置失败:", error);
    return getDefaultSettings();
  }
}

// 保存全局设置
function saveSettings(settings: AppSettings): boolean {
  try {
    // 创建一个干净的对象副本，避免循环引用
    const cleanSettings: any = {
      language: settings.language,
      fontSize: settings.fontSize,
      fontFamily: settings.fontFamily,
      terminalFontFamily: settings.terminalFontFamily,
      terminalFontSize: settings.terminalFontSize,
    };

    // 处理 aiApis 数组，加密API密钥
    if (Array.isArray(settings.aiApis)) {
      cleanSettings.aiApis = encryptApiConfigs(
        settings.aiApis.map((api) => ({
          id: api.id,
          name: api.name,
          apiUrl: api.apiUrl,
          apiKey: api.apiKey,
          modelName: api.modelName,
        })),
      );
    }

    // 处理旧版 aiSettings
    if (settings.aiSettings) {
      const encryptedSettings = encryptApiConfig({
        id: "legacy",
        name: "Legacy Settings",
        apiUrl: settings.aiSettings.apiUrl || "",
        apiKey: settings.aiSettings.apiKey || "",
        modelName: settings.aiSettings.modelName || "",
      });

      cleanSettings.aiSettings = {
        apiUrl: encryptedSettings.apiUrl,
        apiKey: encryptedSettings.apiKey,
        modelName: encryptedSettings.modelName,
      };
    }

    // 处理 SSH 保持连接设置
    if (settings.sshKeepAlive) {
      cleanSettings.sshKeepAlive = {
        enabled: settings.sshKeepAlive.enabled,
        interval: settings.sshKeepAlive.interval,
      };
    }

    // 获取配置文件路径
    const configPath = settingsPath;

    // 确保目录存在
    const dirPath = path.dirname(configPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    // 将设置写入文件
    fs.writeFileSync(configPath, JSON.stringify([cleanSettings], null, 2));

    // 通知渲染进程设置已更新 - 发送到渲染进程前解密API密钥
    if (mainWindow) {
      // 创建一个用于显示的设置副本，解密API密钥
      const displaySettings = JSON.parse(JSON.stringify(cleanSettings));

      if (Array.isArray(displaySettings.aiApis)) {
        displaySettings.aiApis = decryptApiConfigs(displaySettings.aiApis);
      }

      if (displaySettings.aiSettings) {
        const decryptedSettings = decryptApiConfig({
          id: "legacy",
          name: "Legacy Settings",
          apiUrl: displaySettings.aiSettings.apiUrl || "",
          apiKey: displaySettings.aiSettings.apiKey || "",
          modelName: displaySettings.aiSettings.modelName || "",
        });

        displaySettings.aiSettings = {
          apiUrl: decryptedSettings.apiUrl,
          apiKey: decryptedSettings.apiKey,
          modelName: decryptedSettings.modelName,
        };
      }

      mainWindow.webContents.send("settings-saved", displaySettings);
    }

    return true;
  } catch (error) {
    console.error("保存设置失败:", error);
    return false;
  }
}

// 获取默认设置
function getDefaultSettings(): AppSettings {
  return {
    language: "zh-CN",
    fontSize: 14,
    fontFamily: "system-ui",
    terminalFontFamily: 'Consolas, "Courier New", monospace',
    terminalFontSize: 14,
    aiSettings: {
      apiUrl: "",
      apiKey: "",
      modelName: "",
    },
    aiApis: [],
    sshKeepAlive: {
      enabled: true,
      interval: 120000, // 默认2分钟
    },
  };
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  // 确保清理所有keep-alive定时器
  cleanupKeepAliveTimers();

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

// 加载设置
ipcMain.handle("load-settings", async () => {
  try {
    return loadSettings();
  } catch (error) {
    console.error("通过IPC加载设置失败:", error);
    throw error;
  }
});

// 保存设置
ipcMain.handle("save-settings", async (_event, settings) => {
  try {
    console.log("收到保存设置请求:", {
      ...settings,
      aiSettings: settings.aiSettings
        ? {
            ...settings.aiSettings,
            apiKey: settings.aiSettings.apiKey ? "***" : undefined,
          }
        : undefined,
      aiApis: Array.isArray(settings.aiApis)
        ? settings.aiApis.map((api) => ({
            ...api,
            apiKey: api.apiKey ? "***" : undefined,
          }))
        : [],
    });

    // 确保settings对象只包含需要的属性
    const cleanSettings = {
      language: settings.language || "zh-CN",
      fontSize: settings.fontSize || 14,
      fontFamily: settings.fontFamily || "system-ui",
      terminalFontFamily:
        settings.terminalFontFamily || 'Consolas, "Courier New", monospace',
      terminalFontSize: settings.terminalFontSize || 14,
      aiSettings: settings.aiSettings
        ? {
            apiUrl: settings.aiSettings.apiUrl || "",
            apiKey: settings.aiSettings.apiKey || "",
            modelName: settings.aiSettings.modelName || "",
          }
        : undefined,
      aiApis: Array.isArray(settings.aiApis)
        ? settings.aiApis.map((api) => ({
            id: api.id || Date.now().toString(),
            name: api.name || "",
            apiUrl: api.apiUrl || "",
            apiKey: api.apiKey || "",
            modelName: api.modelName || "",
          }))
        : [],
      sshKeepAlive: settings.sshKeepAlive
        ? {
            enabled: settings.sshKeepAlive.enabled !== false,
            interval: settings.sshKeepAlive.interval || 120000,
          }
        : { enabled: true, interval: 120000 },
    };

    const success = saveSettings(cleanSettings);

    if (success) {
      console.log("保存成功，准备通知所有窗口");
      // 通知所有窗口更新设置 - 注意saveSettings函数内部已处理加密/解密逻辑
      const windows = BrowserWindow.getAllWindows();
      console.log(`正在向 ${windows.length} 个窗口广播设置更新`);

      windows.forEach((win) => {
        if (!win.isDestroyed()) {
          console.log(`向窗口 ${win.id} 发送设置更新通知`);
          // settingsUpdate事件将通过saveSettings直接处理
        }
      });

      console.log("设置更新通知已发送");

      // 更新保持连接活跃的定时器
      if (settings.sshKeepAlive) {
        updateKeepAliveTimers();
      }
    } else {
      console.error("保存设置失败");
    }

    return success;
  } catch (error) {
    console.error("通过IPC保存设置失败:", error);
    throw error;
  }
});

// 获取应用程序的根目录
function getAppPath() {
  // 开发环境下，使用当前目录
  if (is.dev) {
    return process.cwd();
  }

  // 生产环境下，使用应用程序目录
  return path.dirname(app.getPath("exe"));
}

// 获取lexer规则文件路径
function getLexerFilePath(lexerName: string) {
  // 构建文件路径
  const rootPath = getAppPath();
  const devPath = path.join(
    rootPath,
    "src",
    "renderer",
    "src",
    "rules",
    `${lexerName}.lexer`,
  );
  const prodPath = path.join(
    rootPath,
    "resources",
    "rules",
    `${lexerName}.lexer`,
  );

  // 开发环境和生产环境使用不同路径
  return is.dev ? devPath : prodPath;
}

// 临时文件映射表，用于跟踪需要删除的文件
const tempFiles = new Map<string, string>(); // key: 临时文件路径, value: 原始文件名

// 处理AI请求
async function handleAIRequest(params: {
  prompt: string;
  messages: Array<{ role: string; content: string }>;
  apiKey?: string;
  apiUrl?: string;
  modelName?: string;
  stream?: boolean;
}) {
  try {
    console.log("收到AI请求:", {
      ...params,
      apiKey: params.apiKey ? "***" : undefined,
      stream: params.stream,
    });

    // 获取设置
    const settings = loadSettings();

    // 注意：loadSettings已经处理了解密，此处使用的是解密后的值

    // 使用传入的参数或从设置中获取
    const apiKey = params.apiKey || settings.aiSettings?.apiKey;
    const apiUrl = params.apiUrl || settings.aiSettings?.apiUrl;
    const modelName = params.modelName || settings.aiSettings?.modelName;
    const useStream = params.stream === true;

    // 验证必要参数
    if (!apiKey) {
      console.error("AI请求失败: 未提供API密钥");
      return { success: false, error: "未提供API密钥" };
    }

    if (!modelName) {
      console.error("AI请求失败: 未提供模型名称");
      return { success: false, error: "未提供模型名称" };
    }

    // 创建OpenAI客户端
    interface OpenAIConfig {
      apiKey: string;
      baseURL?: string;
      maxRetries?: number;
      timeout?: number;
    }

    const configuration: OpenAIConfig = {
      apiKey: apiKey,
      maxRetries: 2,
      timeout: 60000, // 60秒超时
    };

    // 如果设置了自定义API URL，则使用它
    if (apiUrl) {
      configuration.baseURL = apiUrl;
    }

    // 创建OpenAI实例，不使用自定义HTTP代理
    const openai = new OpenAI(configuration);

    console.log(`使用模型 ${modelName} 发送请求${useStream ? "(流式)" : ""}`);

    // 转换消息格式以符合OpenAI API要求
    // 优化：预分配数组大小以减少内存重分配
    const apiMessages: {
      role: "system" | "user" | "assistant";
      content: string;
    }[] = new Array(params.messages.length);

    // 优化：减少字符串处理和内存使用
    let msgIndex = 0;
    for (const msg of params.messages) {
      const role = msg.role.toLowerCase();

      if (role === "system" || role === "user" || role === "assistant") {
        apiMessages[msgIndex++] = {
          role: role as "system" | "user" | "assistant",
          content: msg.content,
        };
      }
    }

    // 如果有空位，裁剪数组
    if (msgIndex < params.messages.length) {
      apiMessages.length = msgIndex;
    }

    try {
      // 流式输出模式
      if (useStream && mainWindow && !mainWindow.isDestroyed()) {
        // 创建中断控制器
        const controller = new AbortController();
        currentStreamController = controller;

        // 创建流式请求
        const stream = await openai.chat.completions.create(
          {
            model: modelName,
            messages: apiMessages,
            temperature: 0.7,
            max_tokens: 16384, // 减小token数量以降低内存使用
            stream: true,
          },
          { signal: controller.signal },
        );

        // 优化：使用字符串块而不是完整内容，减少内存使用
        let contentChunks: string[] = [];
        let totalLength = 0;
        const MAX_BUFFER_SIZE = 1024 * 50; // 50KB 缓冲区限制

        try {
          // 处理流式响应
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || "";
            if (content) {
              contentChunks.push(content);
              totalLength += content.length;

              // 发送块到渲染进程
              mainWindow.webContents.send("ai:stream-update", {
                chunk: content,
              });

              // 当缓冲区达到一定大小时，合并并清空以节省内存
              if (totalLength > MAX_BUFFER_SIZE) {
                contentChunks = [contentChunks.join("")];
                totalLength = contentChunks[0].length;
              }
            }
          }

          console.log("流式AI回答完成");
        } catch (streamError) {
          // 检查是否是因为中断导致的错误
          if (
            streamError instanceof Error &&
            streamError.name === "AbortError"
          ) {
            console.log("流式AI回答已被用户中断");
            // 清除当前控制器
            currentStreamController = null;
            return {
              success: true,
              content: contentChunks.join(""),
              interrupted: true,
            };
          }
          // 其他错误则抛出
          throw streamError;
        }

        // 清除当前控制器
        currentStreamController = null;

        // 只在最后合并一次，减少字符串连接操作
        const fullContent = contentChunks.join("");

        return {
          success: true,
          content: fullContent,
        };
      } else {
        // 非流式模式
        const response = await openai.chat.completions.create({
          model: modelName,
          messages: apiMessages,
          temperature: 0.7,
          max_tokens: 16384, // 减小token数量以降低内存使用
        });

        // 提取回答
        const aiResponse =
          response.choices[0]?.message?.content || "抱歉，我无法生成回答。";
        console.log("收到AI回答");

        return {
          success: true,
          content: aiResponse,
        };
      }
    } catch (apiError: unknown) {
      // 处理API错误
      console.error("API调用失败:", apiError);

      // 获取错误消息
      const errorMessage =
        apiError instanceof Error ? apiError.message : "未知错误";

      // 尝试获取状态码（如果存在）
      const statusCode =
        typeof apiError === "object" &&
        apiError !== null &&
        "status" in apiError
          ? (
              apiError as {
                status?: string | number;
              }
            ).status
          : "N/A";

      // 其他API错误
      return {
        success: false,
        error: `API调用失败: ${errorMessage} (状态码: ${statusCode})`,
      };
    }
  } catch (error) {
    console.error("AI请求失败:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "未知错误",
    };
  }
}

// 处理停止AI请求
function stopAIRequest() {
  if (currentStreamController) {
    console.log("中断AI流式请求");
    currentStreamController.abort();
    return { success: true };
  }
  return { success: false, error: "没有正在进行的AI请求" };
}

// 删除临时文件
ipcMain.handle("delete-temp-file", async (_event, filePath: string) => {
  try {
    if (fs.existsSync(filePath) && tempFiles.has(filePath)) {
      fs.unlinkSync(filePath);
      tempFiles.delete(filePath);
      console.log("临时文件已删除:", filePath);
      return { success: true };
    }
    return { success: false, error: "文件不存在或不是临时文件" };
  } catch (error) {
    console.error("删除临时文件失败:", error);
    return { success: false, error: "删除临时文件失败" };
  }
});

// 清空临时文件夹
function clearTempDirectory() {
  try {
    console.log("清空临时文件夹:", tempDir);

    // 确保临时目录存在
    if (!fs.existsSync(tempDir)) {
      console.log("临时目录不存在，无需清空");
      return;
    }

    // 读取目录中的所有文件
    const files = fs.readdirSync(tempDir);

    // 删除每个文件
    for (const file of files) {
      const filePath = path.join(tempDir, file);

      // 检查是否是文件
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
        console.log("删除临时文件:", filePath);
      }
    }

    console.log("临时文件夹清空完成");
  } catch (error) {
    console.error("清空临时文件夹失败:", error);
  }
}

// 清空临时文件夹
ipcMain.handle("clear-temp-directory", async () => {
  try {
    clearTempDirectory();
    return { success: true };
  } catch (error) {
    console.error("清空临时文件夹失败:", error);
    return { success: false, error: "清空临时文件夹失败" };
  }
});

// 清理所有keep-alive定时器
function cleanupKeepAliveTimers() {
  console.log(`清理 ${keepAliveTimers.size} 个保持活跃定时器`);
  for (const [connectionId, timer] of keepAliveTimers.entries()) {
    clearInterval(timer);
    console.log(`已清除 ${connectionId} 的保持活跃定时器`);
  }
  keepAliveTimers.clear();
}

// 处理保持连接活跃的设置变化
function updateKeepAliveTimers() {
  const interval = getKeepAliveInterval();
  console.log(`更新所有保持活跃定时器，新间隔: ${interval}毫秒`);

  // 遍历所有活跃连接
  for (const [connectionId, timer] of keepAliveTimers.entries()) {
    // 清除旧定时器
    clearInterval(timer);

    // 获取连接信息
    const connInfo = activeConnections.get(connectionId);
    if (!connInfo || !connInfo.connection) {
      // 如果连接不存在，则删除定时器记录
      keepAliveTimers.delete(connectionId);
      continue;
    }

    // 创建新定时器
    const newTimer = setInterval(() => {
      try {
        // 发送SSH保持活跃包
        if (connInfo.connection && connInfo.connection.exec) {
          connInfo.connection.exec("echo keepalive", (err, stream) => {
            if (err) {
              console.error(`保持活跃命令失败 (${connectionId}):`, err);
              return;
            }

            // 处理响应但不进行任何操作
            stream.on("close", () => {
              // Keep-alive命令已执行完毕
            });
          });
          console.log(`发送保持活跃请求 (${connectionId})`);
        }
      } catch (keepAliveError) {
        console.error(`保持活跃请求失败 (${connectionId}):`, keepAliveError);
      }
    }, interval);

    // 更新定时器记录
    keepAliveTimers.set(connectionId, newTimer);
  }
}

// 读取文件内容用于预览
ipcMain.handle(
  "sftp:readFileContent",
  async (
    _,
    { connectionId, remotePath, fileName, maxSize = 1024 * 1024 * 5 },
  ) => {
    try {
      console.log("读取文件内容用于预览:", fileName);

      const sftp = activeSftpConnections.get(connectionId);
      if (!sftp) {
        return { success: false, error: "SFTP连接不存在" };
      }

      // 获取文件信息以获取大小
      const stats = await sftp.stat(remotePath);

      // 检查文件大小，对于过大的文件，仅返回前5MB内容
      const fileSize = stats.size;
      if (fileSize > maxSize) {
        console.log(
          `文件太大(${fileSize} 字节)，将只读取前 ${maxSize} 字节用于预览`,
        );
      }

      // 创建临时文件路径，使用原始文件名
      const tempFilePath = path.join(tempDir, fileName);

      // 对于小文件，直接下载
      if (fileSize <= maxSize) {
        await sftp.fastGet(remotePath, tempFilePath);

        // 读取文件内容
        const content = fs.readFileSync(tempFilePath, "utf8");

        // 记录临时文件，以便后续删除
        tempFiles.set(tempFilePath, fileName);

        // 尝试检测文件类型
        const fileExt = path.extname(fileName).toLowerCase();
        const isText = isTextFile(fileExt);
        const isImage = isImageFile(fileExt);

        return {
          success: true,
          tempFilePath,
          content: isText ? content : null, // 仅对文本文件返回内容
          isText,
          isImage,
          fileSize,
          fileType: fileExt.slice(1) || "unknown",
          isTruncated: false,
        };
      } else {
        // 对于大文件，仅下载部分内容
        // 创建部分读取流
        const readStream = await sftp.createReadStream(remotePath, {
          start: 0,
          end: maxSize - 1,
        });
        const writeStream = fs.createWriteStream(tempFilePath);

        // 等待下载完成
        await new Promise<void>((resolve, reject) => {
          writeStream.on("finish", () => resolve());
          writeStream.on("error", reject);
          readStream.pipe(writeStream);
        });

        // 读取部分文件内容
        const content = fs.readFileSync(tempFilePath, "utf8");

        // 记录临时文件，以便后续删除
        tempFiles.set(tempFilePath, fileName);

        // 尝试检测文件类型
        const fileExt = path.extname(fileName).toLowerCase();
        const isText = isTextFile(fileExt);
        const isImage = isImageFile(fileExt);

        return {
          success: true,
          tempFilePath,
          content: isText ? content : null, // 仅对文本文件返回内容
          isText,
          isImage,
          fileSize,
          fileType: fileExt.slice(1) || "unknown",
          isTruncated: true,
        };
      }
    } catch (error: unknown) {
      const err = error as Error;
      console.error("读取文件内容失败:", err);
      return { success: false, error: err.message };
    }
  },
);

// 检查是否是文本文件
function isTextFile(fileExt: string): boolean {
  const textExtensions = [
    ".txt",
    ".log",
    ".ini",
    ".conf",
    ".cfg",
    ".config",
    ".json",
    ".xml",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
    ".markdown",
    ".rst",
    ".html",
    ".htm",
    ".css",
    ".scss",
    ".less",
    ".js",
    ".ts",
    ".jsx",
    ".tsx",
    ".vue",
    ".c",
    ".cpp",
    ".h",
    ".hpp",
    ".cs",
    ".java",
    ".py",
    ".rb",
    ".php",
    ".sh",
    ".bash",
    ".ps1",
    ".bat",
    ".cmd",
    ".properties",
    ".env",
  ];
  return textExtensions.includes(fileExt.toLowerCase());
}

// 检查是否是图片文件
function isImageFile(fileExt: string): boolean {
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".svg",
    ".ico",
  ];
  return imageExtensions.includes(fileExt.toLowerCase());
}
