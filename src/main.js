const { app, BrowserWindow, ipcMain, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');
const os = require('os');
const pty = require('node-pty');
const { Client } = require('ssh2');
const SftpClient = require('ssh2-sftp-client');
const { Worker } = require('worker_threads');

// 日志记录功能
const logFile = path.join(__dirname, '..', 'logs', 'app.log');
const logToFile = (message, type = 'INFO') => {
  try {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [${type}] ${message}\n`;
    fs.appendFileSync(logFile, logEntry);
  } catch (error) {
    console.error('Failed to write to log file:', error);
  }
};

// 确保日志目录存在
try {
  const logDir = path.join(__dirname, '..', 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create log directory:', error);
}

// 加密配置
const ENCRYPTION_KEY = 'simple-shell-encryption-key-12345'; // 在生产环境中应该更安全地存储
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16; // 对于 aes-256-cbc，IV长度是16字节

// 全局变量用于存储AI worker实例
let aiWorker = null;
let aiRequestMap = new Map();
let nextRequestId = 1;

// 全局变量
const childProcesses = new Map(); // 存储所有子进程
const sshClients = new Map(); // 存储SSH客户端
const terminalProcesses = new Map(); // 存储终端进程ID映射
let nextProcessId = 1;

// 存储活动的文件传输
const activeTransfers = new Map();

// 添加 SFTP 会话池
const sftpSessions = new Map();  // 用于缓存 SFTP 会话，按 tabId 存储
const sftpSessionLocks = new Map();  // 用于防止并发创建同一个会话
const pendingOperations = new Map();  // 按 tabId 存储待处理的操作队列

// SFTP会话池配置
const SFTP_SESSION_IDLE_TIMEOUT = 20000;  // 空闲超时时间（毫秒），从60秒减少到20秒
const MAX_SFTP_SESSIONS_PER_TAB = 1;      // 每个标签页的最大会话数量
const MAX_TOTAL_SFTP_SESSIONS = 10;       // 总的最大会话数量
const SFTP_HEALTH_CHECK_INTERVAL = 30000; // 健康检查间隔（毫秒）
const SFTP_OPERATION_TIMEOUT = 20000;     // 操作超时时间（毫秒）

// 添加 SFTP 会话池健康检查定时器
let sftpHealthCheckTimer = null;

// 启动SFTP会话池健康检查
function startSftpHealthCheck() {
  // 如果已经有定时器在运行，先清除
  if (sftpHealthCheckTimer) {
    clearInterval(sftpHealthCheckTimer);
  }
  
  // 设置定时器，定期检查SFTP会话健康状况
  sftpHealthCheckTimer = setInterval(() => {
    checkSftpSessionsHealth();
  }, SFTP_HEALTH_CHECK_INTERVAL);
  
  logToFile('Started SFTP session health check', 'INFO');
}

// 停止SFTP会话池健康检查
function stopSftpHealthCheck() {
  if (sftpHealthCheckTimer) {
    clearInterval(sftpHealthCheckTimer);
    sftpHealthCheckTimer = null;
    logToFile('Stopped SFTP session health check', 'INFO');
  }
}

// 检查SFTP会话健康状况
function checkSftpSessionsHealth() {
  try {
    logToFile(`Running SFTP health check, active sessions: ${sftpSessions.size}`, 'INFO');
    
    // 如果会话总数超过限制，关闭最老的会话
    if (sftpSessions.size > MAX_TOTAL_SFTP_SESSIONS) {
      logToFile(`Too many SFTP sessions (${sftpSessions.size}), cleaning up oldest sessions`, 'WARN');
      let sessionsToClose = sftpSessions.size - MAX_TOTAL_SFTP_SESSIONS;
      
      // 按会话创建时间排序
      const sessionEntries = Array.from(sftpSessions.entries());
      sessionEntries.sort((a, b) => a[1].createdAt - b[1].createdAt);
      
      // 关闭最老的会话
      for (let i = 0; i < sessionsToClose; i++) {
        if (i < sessionEntries.length) {
          const [tabId, _] = sessionEntries[i];
          logToFile(`Closing old SFTP session for tab ${tabId}`, 'INFO');
          closeSftpSession(tabId);
        }
      }
    }
    
    // 检查每个会话的健康状况
    for (const [tabId, session] of sftpSessions.entries()) {
      // 检查会话是否已存在超过最大空闲时间
      const idleTime = Date.now() - session.lastUsed;
      if (idleTime > SFTP_SESSION_IDLE_TIMEOUT) {
        logToFile(`SFTP session ${tabId} idle for ${idleTime}ms, closing`, 'INFO');
        closeSftpSession(tabId);
        continue;
      }
      
      // 对每个会话进行健康检查 - 尝试执行一个简单的readdir操作
      checkSessionAlive(tabId, session);
    }
  } catch (error) {
    logToFile(`Error in SFTP health check: ${error.message}`, 'ERROR');
  }
}

// 检查会话是否存活
async function checkSessionAlive(tabId, session) {
  try {
    // 创建一个Promise，添加超时处理
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('SFTP health check timeout')), 5000);
    });
    
    // 创建一个执行基本SFTP操作的Promise
    const checkPromise = new Promise((resolve, reject) => {
      session.sftp.readdir('/', (err, _) => {
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
    logToFile(`SFTP session ${tabId} health check failed: ${error.message}, closing session`, 'ERROR');
    closeSftpSession(tabId);
  }
}

// 获取或创建 SFTP 会话
async function getSftpSession(tabId) {
  // 检查是否已有处于获取中的会话
  if (sftpSessionLocks.has(tabId)) {
    // 等待已有的获取操作完成
    return new Promise((resolve, reject) => {
      const checkLock = () => {
        if (!sftpSessionLocks.has(tabId)) {
          // 锁已解除，尝试获取会话
          if (sftpSessions.has(tabId)) {
            const session = sftpSessions.get(tabId);
            // 更新最后使用时间
            session.lastUsed = Date.now();
            resolve(session.sftp);
          } else {
            // 创建新会话
            acquireSftpSession(tabId).then(resolve).catch(reject);
          }
        } else {
          // 锁仍然存在，继续等待
          setTimeout(checkLock, 100);
        }
      };
      checkLock();
    });
  }

  // 检查缓存中是否有可用会话
  if (sftpSessions.has(tabId)) {
    const session = sftpSessions.get(tabId);
    
    // 更新最后使用时间
    session.lastUsed = Date.now();
    
    // 重置会话超时计时器
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    session.timeoutId = setTimeout(() => {
      closeSftpSession(tabId);
    }, SFTP_SESSION_IDLE_TIMEOUT);
    
    return session.sftp;
  }
  
  // 检查是否超过了总会话数量限制
  if (sftpSessions.size >= MAX_TOTAL_SFTP_SESSIONS) {
    logToFile(`Maximum SFTP sessions limit reached (${MAX_TOTAL_SFTP_SESSIONS}), closing oldest session`, 'WARN');
    
    // 查找最老的会话进行关闭
    let oldestTabId = null;
    let oldestTime = Date.now();
    
    for (const [id, session] of sftpSessions.entries()) {
      if (session.createdAt < oldestTime) {
        oldestTime = session.createdAt;
        oldestTabId = id;
      }
    }
    
    // 关闭最老的会话
    if (oldestTabId) {
      closeSftpSession(oldestTabId);
    }
  }
  
  // 创建新会话
  return acquireSftpSession(tabId);
}

// 创建新的 SFTP 会话
async function acquireSftpSession(tabId) {
  // 设置锁以防止并发创建
  sftpSessionLocks.set(tabId, true);
  
  try {
    // 检查该标签页的会话数量是否已达到上限
    let sessionCount = 0;
    for (const [id, _] of sftpSessions.entries()) {
      if (id === tabId) {
        sessionCount++;
      }
    }
    
    if (sessionCount >= MAX_SFTP_SESSIONS_PER_TAB) {
      logToFile(`Maximum SFTP sessions per tab reached (${MAX_SFTP_SESSIONS_PER_TAB}) for tab ${tabId}`, 'WARN');
      throw new Error(`已达到每个标签页的最大SFTP会话数限制(${MAX_SFTP_SESSIONS_PER_TAB})`);
    }
    
    // 查找对应的SSH客户端
    const processInfo = childProcesses.get(tabId);
    if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
      sftpSessionLocks.delete(tabId);
      throw new Error('无效的SSH连接');
    }
    
    const sshClient = processInfo.process;
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        sftpSessionLocks.delete(tabId);
        reject(new Error('SFTP会话创建超时'));
      }, SFTP_OPERATION_TIMEOUT);
      
      sshClient.sftp((err, sftp) => {
        clearTimeout(timeoutId);
        
        if (err) {
          sftpSessionLocks.delete(tabId);
          logToFile(`SFTP session creation error for session ${tabId}: ${err.message}`, 'ERROR');
          reject(new Error(`SFTP错误: ${err.message}`));
          return;
        }
        
        // 创建会话对象
        const now = Date.now();
        const session = {
          sftp,
          timeoutId: setTimeout(() => {
            closeSftpSession(tabId);
          }, SFTP_SESSION_IDLE_TIMEOUT),
          active: true,
          createdAt: now,
          lastUsed: now,
          lastChecked: now
        };
        
        // 存储会话
        sftpSessions.set(tabId, session);
        sftpSessionLocks.delete(tabId);
        
        // 设置错误处理
        sftp.on('error', (err) => {
          logToFile(`SFTP session error for ${tabId}: ${err.message}`, 'ERROR');
          closeSftpSession(tabId);
        });
        
        // 设置关闭处理
        sftp.on('close', () => {
          closeSftpSession(tabId);
        });
        
        // 启动健康检查（如果还没启动）
        if (!sftpHealthCheckTimer) {
          startSftpHealthCheck();
        }
        
        resolve(sftp);
      });
    });
  } catch (error) {
    sftpSessionLocks.delete(tabId);
    throw error;
  }
}

// 关闭SFTP会话
function closeSftpSession(tabId) {
  if (sftpSessions.has(tabId)) {
    const session = sftpSessions.get(tabId);
    
    // 清除超时计时器
    if (session.timeoutId) {
      clearTimeout(session.timeoutId);
    }
    
    // 标记会话为不活跃
    session.active = false;
    
    // 尝试关闭SFTP会话
    try {
      session.sftp.end();
    } catch (error) {
      logToFile(`Error closing SFTP session for ${tabId}: ${error.message}`, 'ERROR');
    }
    
    // 移除会话
    sftpSessions.delete(tabId);
    
    logToFile(`Closed SFTP session for ${tabId}`, 'INFO');
    
    // 如果没有更多会话，停止健康检查
    if (sftpSessions.size === 0 && sftpHealthCheckTimer) {
      stopSftpHealthCheck();
    }
  }
}

// 处理 SFTP 操作队列
function enqueueSftpOperation(tabId, operation, options = {}) {
  // 初始化操作队列
  if (!pendingOperations.has(tabId)) {
    pendingOperations.set(tabId, []);
  }
  
  const queue = pendingOperations.get(tabId);
  const { priority = 'normal', type = 'other', path = null, canMerge = false } = options;
  
  // 如果操作是可合并的（如读取目录），检查是否有相同路径的相同类型操作已经在队列中
  if (canMerge && path && type === 'readdir') {
    // 寻找相同类型和路径的操作
    const existingOpIndex = queue.findIndex(item => 
      item.type === 'readdir' && item.path === path);
    
    if (existingOpIndex !== -1) {
      // 找到可合并的操作，将其promise的resolve和reject添加到现有操作中
      return new Promise((resolve, reject) => {
        const existingOp = queue[existingOpIndex];
        existingOp.subscribers = existingOp.subscribers || [];
        existingOp.subscribers.push({ resolve, reject });
        
        logToFile(`Merged SFTP ${type} operation for path ${path} on tab ${tabId}`, 'INFO');
      });
    }
  }
  
  // 根据优先级确定操作在队列中的位置
  // 返回promise
  return new Promise((resolve, reject) => {
    // 创建操作对象
    const operationObj = { 
      operation, 
      resolve, 
      reject, 
      priority, 
      type, 
      path,
      canMerge,
      enqueuedAt: Date.now(),
      subscribers: [] // 用于存储合并操作的订阅者
    };
    
    // 根据优先级插入队列
    if (priority === 'high') {
      // 高优先级操作插入到队列前面（但在当前执行的操作之后）
      if (queue.length > 0) {
        queue.splice(1, 0, operationObj);
      } else {
        queue.push(operationObj);
      }
    } else {
      // 普通优先级操作添加到队列末尾
      queue.push(operationObj);
    }
    
    // 记录操作类型和路径
    if (path) {
      logToFile(`Enqueued SFTP ${type} operation for path ${path} on tab ${tabId} with priority ${priority}`, 'INFO');
    } else {
      logToFile(`Enqueued SFTP ${type} operation on tab ${tabId} with priority ${priority}`, 'INFO');
    }
    
    // 如果队列中只有这一个操作，立即执行
    if (queue.length === 1) {
      processSftpQueue(tabId);
    }
  });
}

// 处理队列中的 SFTP 操作
async function processSftpQueue(tabId) {
  // 获取队列
  const queue = pendingOperations.get(tabId);
  if (!queue || queue.length === 0) {
    return;
  }
  
  // 获取第一个操作
  const op = queue[0];
  
  try {
    // 执行操作
    const result = await op.operation();
    
    // 解析主Promise
    op.resolve(result);
    
    // 解析所有合并操作的订阅者的Promise
    if (op.subscribers && op.subscribers.length > 0) {
      for (const subscriber of op.subscribers) {
        subscriber.resolve(result);
      }
      logToFile(`Resolved ${op.subscribers.length} merged subscribers for SFTP ${op.type} operation on tab ${tabId}`, 'INFO');
    }
  } catch (error) {
    // 操作失败，拒绝主Promise
    op.reject(error);
    
    // 拒绝所有合并操作的订阅者的Promise
    if (op.subscribers && op.subscribers.length > 0) {
      for (const subscriber of op.subscribers) {
        subscriber.reject(error);
      }
      logToFile(`Rejected ${op.subscribers.length} merged subscribers for SFTP ${op.type} operation on tab ${tabId}: ${error.message}`, 'ERROR');
    }
  } finally {
    // 移除已完成的操作
    queue.shift();
    
    // 处理队列中的下一个操作
    if (queue.length > 0) {
      // 根据操作类型决定延迟时间
      // 对于操作类型为readdir的操作，使用较短的延迟
      const nextOp = queue[0];
      const delay = nextOp.type === 'readdir' ? 50 : 100;
      
      setTimeout(() => {
        processSftpQueue(tabId);
      }, delay);
    }
  }
}

// 获取worker文件路径
function getWorkerPath() {
  // 先尝试相对于__dirname的路径
  let workerPath = path.join(__dirname, 'workers', 'ai-worker.js');
  
  // 检查文件是否存在
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }
  
  // 如果文件不存在，可能是在开发环境，尝试使用源代码路径
  workerPath = path.join(__dirname, '..', 'src', 'workers', 'ai-worker.js');
  if (fs.existsSync(workerPath)) {
    return workerPath;
  }
  
  // 如果都找不到，记录错误并返回null
  console.error('无法找到AI worker文件。已尝试以下路径:');
  console.error(path.join(__dirname, 'workers', 'ai-worker.js'));
  console.error(path.join(__dirname, '..', 'src', 'workers', 'ai-worker.js'));
  throw new Error('找不到AI worker文件');
}

// 创建AI Worker线程
function createAIWorker() {
  if (aiWorker) {
    try {
      aiWorker.terminate();
    } catch (error) {
      console.error('Error terminating existing AI worker:', error);
    }
  }

  try {
    const workerPath = getWorkerPath();
    console.log(`创建AI worker，使用路径: ${workerPath}`);
    
    // 创建worker实例
    aiWorker = new Worker(workerPath);
    
    // 监听worker线程的消息
    aiWorker.on('message', (message) => {
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
    aiWorker.on('error', (error) => {
      console.error('AI Worker error:', error);
      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(new Error('AI Worker encountered an error: ' + error.message));
        aiRequestMap.delete(id);
      }
    });
    
    // 处理worker退出
    aiWorker.on('exit', (code) => {
      console.log(`AI Worker exited with code ${code}`);
      // 如果退出码不是正常退出(0)，尝试重启worker
      if (code !== 0) {
        console.log('Attempting to restart AI worker...');
        setTimeout(() => {
          createAIWorker();
        }, 1000);
      }
      
      // 向所有待处理的请求返回错误
      for (const [id, callback] of aiRequestMap.entries()) {
        callback.reject(new Error(`AI Worker stopped unexpectedly with code ${code}`));
        aiRequestMap.delete(id);
      }
    });
    
    return aiWorker;
  } catch (error) {
    console.error(`无法创建AI worker:`, error);
    return null;
  }
}

// 加密函数
function encryptText(text) {
  if (!text) return text;
  try {
    // 创建随机的初始化向量
    const iv = crypto.randomBytes(IV_LENGTH);
    // 从加密密钥创建密钥（使用SHA-256哈希以得到正确长度的密钥）
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    // 创建加密器
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);
    // 加密文本
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    // 返回IV和加密文本的组合（使用冒号分隔）
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error);
    return text;
  }
}

// 解密函数
function decryptText(text) {
  if (!text || !text.includes(':')) return text;
  try {
    // 分离IV和加密文本
    const [ivHex, encryptedText] = text.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    // 从加密密钥创建密钥
    const key = crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
    // 创建解密器
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
    // 解密文本
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    return text;
  }
}

// 递归处理连接项，加密敏感字段
function processConnectionsForSave(items) {
  return items.map(item => {
    const result = { ...item };
    
    if (item.type === 'connection') {
      // 加密敏感信息
      if (item.password) {
        result.password = encryptText(item.password);
      }
      if (item.privateKeyPath) {
        result.privateKeyPath = encryptText(item.privateKeyPath);
      }
    } else if (item.type === 'group' && Array.isArray(item.items)) {
      // 递归处理组内的项
      result.items = processConnectionsForSave(item.items);
    }
    
    return result;
  });
}

// 递归处理连接项，解密敏感字段
function processConnectionsForLoad(items) {
  return items.map(item => {
    const result = { ...item };
    
    if (item.type === 'connection') {
      // 解密敏感信息
      if (item.password) {
        result.password = decryptText(item.password);
      }
      if (item.privateKeyPath) {
        result.privateKeyPath = decryptText(item.privateKeyPath);
      }
    } else if (item.type === 'group' && Array.isArray(item.items)) {
      // 递归处理组内的项
      result.items = processConnectionsForLoad(item.items);
    }
    
    return result;
  });
}

// 存储进程和对应的处理函数
// 已在文件顶部声明 childProcesses 和 nextProcessId

// 处理生产和开发环境中的路径差异
if (require('electron-squirrel-startup')) {
  app.quit();
}

// 获取配置文件路径
const getConfigPath = () => {
  // 判断是开发环境还是生产环境
  const isDev = process.env.NODE_ENV === 'development';
  
  if (isDev) {
    // 开发环境：保存到项目根目录
    return path.join(process.cwd(), 'config.json');
  } else {
    // 生产环境：保存到exe同级目录
    return path.join(path.dirname(app.getPath('exe')), 'config.json');
  }
};

// 加载连接配置
const loadConnectionsConfig = () => {
  const configPath = getConfigPath();
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      
      // 检查是否有connections字段
      if (config.connections && Array.isArray(config.connections)) {
        return processConnectionsForLoad(config.connections);
      }
    }
  } catch (error) {
    console.error('Failed to load connections config:', error);
  }
  
  return [];
};

// 保存连接配置
const saveConnectionsConfig = (connections) => {
  const configPath = getConfigPath();
  
  try {
    // 加载当前配置，以保留其他设置（如AI设置）
    let config = {};
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(data);
    }
    
    // 处理连接项以加密敏感信息
    const processedConnections = processConnectionsForSave(connections);
    
    // 更新connections部分而不影响其他设置
    config.connections = processedConnections;
    
    // 写回配置文件
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save connections config:', error);
    return false;
  }
};

// 选择密钥文件
const selectKeyFile = async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '私钥文件', extensions: ['pem', 'ppk', 'key'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    title: '选择SSH私钥文件'
  });
  
  if (result.canceled) {
    return null;
  }
  
  return result.filePaths[0];
};

const createWindow = () => {
  // 根据环境确定图标路径
  let iconPath;
  if (process.env.NODE_ENV === 'development') {
    // 开发环境使用绝对路径
    iconPath = path.join(process.cwd(), 'src', 'assets', 'logo.ico');
  } else {
    // 生产环境使用相对于__dirname的路径
    iconPath = path.join(__dirname, 'assets', 'logo.ico');
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
    icon: iconPath // 使用环境相关的图标路径
  });

  // 隐藏菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 加载应用 URL
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // 开发工具自动打开
  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools();
  }

  // 注册IPC通信
  setupIPC(mainWindow);
};

// 初始化应用配置
const initializeConfig = () => {
  const configPath = getConfigPath();
  
  // 检查配置文件是否存在
  if (!fs.existsSync(configPath)) {
    // 创建初始配置
    const initialConfig = {
      connections: [],
      aiSettings: {
        configs: [],
        current: {
          apiUrl: '',
          apiKey: '',
          model: '',
          streamEnabled: true
        }
      }
    };
    
    try {
      // 写入初始配置
      fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');
      console.log('Created initial config file:', configPath);
    } catch (error) {
      console.error('Failed to create initial config file:', error);
    }
  } else {
    try {
      // 检查现有配置，确保结构完整
      const data = fs.readFileSync(configPath, 'utf8');
      let config = JSON.parse(data);
      let configUpdated = false;
      
      // 确保connections存在
      if (!config.connections) {
        config.connections = [];
        configUpdated = true;
      }
      
      // 确保aiSettings存在并具有正确的结构
      if (!config.aiSettings) {
        config.aiSettings = {
          configs: [],
          current: {
            apiUrl: '',
            apiKey: '',
            model: '',
            streamEnabled: true
          }
        };
        configUpdated = true;
      } else {
        // 检查并更新旧版本的AI设置
        const aiSettings = config.aiSettings;
        
        // 兼容旧版配置格式，将单一配置迁移到多配置结构
        if (!aiSettings.configs) {
          aiSettings.configs = [];
          
          // 如果旧版本有配置数据，将其作为当前配置添加到configs中
          if (aiSettings.apiUrl || aiSettings.apiKey || aiSettings.model) {
            const oldConfig = {
              id: Date.now().toString(),
              name: "默认配置",
              apiUrl: aiSettings.apiUrl || '',
              apiKey: aiSettings.apiKey || '',
              model: aiSettings.model || '',
              streamEnabled: aiSettings.streamEnabled !== undefined ? aiSettings.streamEnabled : true
            };
            
            aiSettings.configs.push(oldConfig);
            
            // 保留当前配置
            aiSettings.current = { ...oldConfig };
          }
          
          // 删除旧的顶层属性
          ['apiUrl', 'apiKey', 'model', 'streamEnabled'].forEach(key => {
            if (key in aiSettings && key !== 'configs' && key !== 'current') {
              delete aiSettings[key];
            }
          });
          
          configUpdated = true;
        }
        
        // 确保current存在
        if (!aiSettings.current) {
          aiSettings.current = {
            apiUrl: '',
            apiKey: '',
            model: '',
            streamEnabled: true
          };
          configUpdated = true;
        }
        
        // 确保current中的所有必要字段都存在
        const currentFields = ['apiUrl', 'apiKey', 'model', 'streamEnabled'];
        currentFields.forEach(field => {
          if (aiSettings.current[field] === undefined) {
            if (field === 'streamEnabled') {
              aiSettings.current[field] = true;
            } else {
              aiSettings.current[field] = '';
            }
            configUpdated = true;
          }
        });
      }
      
      // 如果需要，更新配置文件
      if (configUpdated) {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
        console.log('Updated config file structure:', configPath);
      }
    } catch (error) {
      console.error('Error checking config file structure:', error);
      
      // 如果解析失败（例如文件为空或格式错误），创建新的配置文件
      try {
        const initialConfig = {
          connections: [],
          aiSettings: {
            configs: [],
            current: {
              apiUrl: '',
              apiKey: '',
              model: '',
              streamEnabled: true
            }
          }
        };
        
        fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf8');
        console.log('Recreated config file due to parsing error:', configPath);
      } catch (writeError) {
        console.error('Failed to recreate config file:', writeError);
      }
    }
  }
};

// 在应用准备好时创建窗口并初始化配置
app.on('ready', () => {
  // 初始化配置
  initializeConfig();
  
  // 创建窗口
  createWindow();
  
  // 创建AI Worker
  createAIWorker();
});

// 在应用退出前清理资源
app.on('before-quit', () => {
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
          if (typeof proc.process.kill === 'function') {
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
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // 关闭应用前终止worker线程
    if (aiWorker) {
      aiWorker.terminate().catch(err => console.error('Error terminating AI worker:', err));
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// 设置IPC通信
function setupIPC(mainWindow) {
  // 启动PowerShell进程
  ipcMain.handle('terminal:startPowerShell', async () => {
    const processId = nextProcessId++;
    
    // 获取PowerShell路径
    const powershellPath = process.platform === 'win32' 
      ? 'powershell.exe' 
      : 'pwsh';
    
    try {
      // 启动PowerShell进程
      const ps = spawn(powershellPath, ['-NoLogo'], {
        env: process.env,
        cwd: process.env.USERPROFILE || process.env.HOME
      });
      
      // 存储进程信息
      childProcesses.set(processId, {
        process: ps,
        listeners: new Set()
      });
      
      // 处理PowerShell输出
      ps.stdout.on('data', (data) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            const output = data.toString();
            mainWindow.webContents.send(`process:output:${processId}`, output);
          }
        } catch (error) {
          console.error('Error handling stdout data:', error);
        }
      });
      
      ps.stderr.on('data', (data) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            const output = data.toString();
            mainWindow.webContents.send(`process:output:${processId}`, output);
          }
        } catch (error) {
          console.error('Error handling stderr data:', error);
        }
      });
      
      // 处理进程退出
      ps.on('exit', (code) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(`process:output:${processId}`, `\r\nProcess exited with code ${code || 0}\r\n`);
          }
          childProcesses.delete(processId);
        } catch (error) {
          console.error('Error handling process exit:', error);
        }
      });
      
      // 处理进程错误
      ps.on('error', (err) => {
        try {
          // 检查主窗口是否还存在且未被销毁
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\nProcess error: ${err.message}\r\n`
            );
          }
          childProcesses.delete(processId);
        } catch (error) {
          console.error('Error handling process error:', error);
        }
      });
      
      return processId;
    } catch (error) {
      console.error('Failed to start PowerShell:', error);
      throw error;
    }
  });
  
  // 启动SSH连接
  ipcMain.handle('terminal:startSSH', async (event, sshConfig) => {
    const processId = nextProcessId++;
    
    if (!sshConfig || !sshConfig.host) {
      console.error('Invalid SSH configuration');
      throw new Error('Invalid SSH configuration');
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
          type: 'ssh2'
        });
        
        // 存储相同的SSH客户端，使用tabId（通常是形如'ssh-timestamp'的标识符）
        if (sshConfig.tabId) {
          console.log(`Setting up SSH client for tabId: ${sshConfig.tabId}`);
          childProcesses.set(sshConfig.tabId, {
            process: ssh,
            listeners: new Set(),
            config: sshConfig,
            type: 'ssh2'
          });
        }
        
        // 设置连接超时定时器
        const connectionTimeout = setTimeout(() => {
          console.error('SSH connection timed out after 15 seconds');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n连接超时，请检查网络和服务器状态\r\n`
            );
          }
          // 不主动断开连接，让用户决定是否关闭
        }, 15000);
        
        // 监听就绪事件
        ssh.on('ready', () => {
          // 清除超时定时器
          clearTimeout(connectionTimeout);
          
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n*** ${sshConfig.host} SSH连接已建立 ***\r\n`
            );
          }
          
          // 创建Shell会话
          ssh.shell({ 
            term: 'xterm-256color',  // 使用更高级的终端类型
            cols: 120,               // 设置更宽的初始终端列数
            rows: 30                 // 设置初始终端行数
          }, (err, stream) => {
            if (err) {
              console.error('Failed to create shell:', err);
              if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send(
                  `process:output:${processId}`,
                  `\r\n*** 创建Shell会话失败: ${err.message} ***\r\n`
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
            
            stream.on('data', (data) => {
              try {
                // 拼接数据到缓冲区
                buffer = Buffer.concat([buffer, data]);
                
                // 尝试将缓冲区转换为UTF-8字符串
                let output;
                try {
                  output = buffer.toString('utf8');
                  // 转换成功，清空缓冲区
                  buffer = Buffer.from([]);
                } catch (e) {
                  // 如果转换失败（可能是UTF-8字符不完整），等待下一个数据包
                  return;
                }
                
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send(`process:output:${processId}`, output);
                }
              } catch (error) {
                console.error('Error handling stream data:', error);
              }
            });
            
            // 监听扩展数据（通常是错误消息）
            stream.on('extended data', (data, type) => {
              try {
                // type为1时表示stderr数据
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send(
                    `process:output:${processId}`,
                    `\x1b[31m${data.toString('utf8')}\x1b[0m`
                  );
                }
              } catch (error) {
                console.error('Error handling extended data:', error);
              }
            });
            
            // 监听关闭事件
            stream.on('close', () => {
              try {
                console.log('SSH stream closed');
                if (mainWindow && !mainWindow.isDestroyed()) {
                  mainWindow.webContents.send(
                    `process:output:${processId}`,
                    `\r\n*** SSH会话已关闭 ***\r\n`
                  );
                }
                ssh.end();
              } catch (error) {
                console.error('Error handling stream close:', error);
              }
            });
          });
        });
        
        // 监听错误事件
        ssh.on('error', (err) => {
          clearTimeout(connectionTimeout);
          
          console.error('SSH connection error:', err);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n\x1b[31m*** SSH连接错误: ${err.message} ***\x1b[0m\r\n`
            );
          }
          
          childProcesses.delete(processId);
          reject(err);
        });
        
        // 监听关闭事件
        ssh.on('close', () => {
          console.log('SSH connection closed');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send(
              `process:output:${processId}`,
              `\r\n*** SSH连接已关闭 ***\r\n`
            );
          }
          
          childProcesses.delete(processId);
        });
        
        // 监听键盘交互事件（用于处理密码认证）
        ssh.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
          if (prompts.length > 0 && prompts[0].prompt.toLowerCase().includes('password')) {
            finish([sshConfig.password || '']);
          } else {
            finish([]);
          }
        });
        
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
            const privateKey = fs.readFileSync(sshConfig.privateKeyPath, 'utf8');
            connectConfig.privateKey = privateKey;
            
            // 如果私钥有密码保护
            if (sshConfig.password) {
              connectConfig.passphrase = sshConfig.password;
            }
          } catch (error) {
            console.error('Error reading private key file:', error);
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send(
                `process:output:${processId}`,
                `\r\n\x1b[31m*** 读取私钥文件错误: ${error.message} ***\x1b[0m\r\n`
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
        console.error('Failed to start SSH connection:', error);
        reject(error);
      }
    });
  });
  
  // 发送数据到进程
  ipcMain.handle('terminal:sendToProcess', async (event, processId, data) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo || !procInfo.process) {
      console.error(`Process ${processId} not found or invalid`);
      return false;
    }
    
    try {
      // 确保退格键字符正确转换
      let processedData = data;
      // 对特殊情况的处理（如果需要）
      
      // 根据进程类型选择不同的写入方式
      if (procInfo.type === 'ssh2') {
        // SSH2连接使用保存的流对象写入数据
        if (procInfo.stream) {
          procInfo.stream.write(processedData);
          return true;
        } else {
          console.error('SSH2 stream not available');
          return false;
        }
      } else if (typeof procInfo.process.write === 'function') {
        // node-pty进程直接调用write方法
        procInfo.process.write(processedData);
        return true;
      } else if (procInfo.process.stdin) {
        // 标准子进程使用stdin
        procInfo.process.stdin.write(processedData);
        return true;
      } else {
        console.error('Process has no valid write method');
        return false;
      }
    } catch (error) {
      console.error('Failed to send data to process:', error);
      return false;
    }
  });
  
  // 终止进程
  ipcMain.handle('terminal:killProcess', async (event, processId) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo || !procInfo.process) {
      return false;
    }
    
    try {
      if (procInfo.type === 'ssh2') {
        // SSH2连接使用end方法关闭
        procInfo.process.end();
      } else if (typeof procInfo.process.kill === 'function') {
        // 直接用kill方法（适用于node-pty和child_process）
        procInfo.process.kill();
      } else {
        console.error('Process has no valid kill method');
      }
      
      childProcesses.delete(processId);
      return true;
    } catch (error) {
      console.error('Failed to kill process:', error);
      return false;
    }
  });
  
  // 加载连接配置
  ipcMain.handle('terminal:loadConnections', async () => {
    return loadConnectionsConfig();
  });
  
  // 保存连接配置
  ipcMain.handle('terminal:saveConnections', async (event, connections) => {
    return saveConnectionsConfig(connections);
  });
  
  // 选择密钥文件
  ipcMain.handle('terminal:selectKeyFile', async () => {
    return selectKeyFile();
  });
  
  // 获取应用版本号
  ipcMain.handle('app:getVersion', () => {
    return app.getVersion();
  });
  
  // 关闭应用
  ipcMain.handle('app:close', () => {
    app.quit();
  });
  
  // 检查更新
  ipcMain.handle('app:checkForUpdate', async () => {
    try {
      const https = require('https');
      
      // 创建一个Promise来处理HTTPS请求
      const fetchGitHubRelease = () => {
        return new Promise((resolve, reject) => {
          const options = {
            hostname: 'api.github.com',
            path: '/repos/funkpopo/simpleshell/releases/latest',
            method: 'GET',
            headers: {
              'User-Agent': 'SimpleShell-App'
            }
          };
          
          const req = https.request(options, (res) => {
            if (res.statusCode !== 200) {
              reject(new Error(`GitHub API返回错误状态码: ${res.statusCode}`));
              return;
            }
            
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            
            res.on('end', () => {
              try {
                const releaseData = JSON.parse(data);
                resolve(releaseData);
              } catch (error) {
                reject(new Error(`解析GitHub API响应失败: ${error.message}`));
              }
            });
          });
          
          req.on('error', (error) => {
            reject(new Error(`请求GitHub API失败: ${error.message}`));
          });
          
          req.end();
        });
      };
      
      const releaseData = await fetchGitHubRelease();
      return {
        success: true,
        data: releaseData
      };
    } catch (error) {
      console.error('检查更新失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });
  
  // 在外部浏览器中打开URL
  ipcMain.handle('app:openExternal', async (event, url) => {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
      console.error('打开外部链接失败:', error);
      return false;
    }
  });
  
  // 处理简单的命令
  ipcMain.handle('terminal:command', async (event, command) => {
    try {
      // 简单内部命令处理
      if (command === 'date') {
        return { output: new Date().toString() };
      } else if (command.startsWith('echo ')) {
        return { output: command.substring(5) };
      } else {
        return { output: `Command not recognized: ${command}` };
      }
    } catch (error) {
      console.error('Command error:', error);
      return { error: error.message };
    }
  });
  
  // 添加调整终端大小的处理
  ipcMain.handle('terminal:resize', async (event, processId, cols, rows) => {
    const procInfo = childProcesses.get(processId);
    if (!procInfo) {
      console.error(`Process ${processId} not found`);
      return false;
    }
    
    try {
      // 针对不同类型的进程进行不同的处理
      if (procInfo.type === 'ssh2' && procInfo.stream) {
        // SSH2连接使用stream.setWindow方法调整大小
        if (typeof procInfo.stream.setWindow === 'function') {
          procInfo.stream.setWindow(rows, cols);
          return true;
        }
      } else if (typeof procInfo.process.resize === 'function') {
        // node-pty进程使用resize方法
        procInfo.process.resize(cols, rows);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Failed to resize terminal:', error);
      return false;
    }
  });
  
  // 获取系统资源信息
  ipcMain.handle('terminal:getSystemInfo', async (event, processId) => {
    try {
      if (!processId || !childProcesses.has(processId)) {
        return getLocalSystemInfo();
      } else {
        // SSH远程系统信息
        const processObj = childProcesses.get(processId);
        
        // 支持多种SSH客户端类型
        if ((processObj.type === 'ssh2' || processObj.type === 'ssh') && 
            (processObj.process || processObj.client || processObj.channel)) {
          const sshClient = processObj.client || processObj.process || processObj.channel;
          return getRemoteSystemInfo(sshClient);
        } else {
          return getLocalSystemInfo();
        }
      }
    } catch (error) {
      console.error('Failed to get system info:', error);
      return {
        error: '获取系统信息失败',
        message: error.message
      };
    }
  });

  // AI设置相关IPC处理
  ipcMain.handle('ai:loadSettings', async () => {
    return loadAISettings();
  });
  
  ipcMain.handle('ai:saveSettings', async (event, settings) => {
    return saveAISettings(settings);
  });
  
  // 新增: 处理API配置的IPC方法
  ipcMain.handle('ai:saveApiConfig', async (event, config) => {
    try {
      logToFile(`Saving API config: ${JSON.stringify({
        id: config.id,
        name: config.name,
        model: config.model
      })}`);
      
      // 加载当前设置
      const settings = loadAISettings();
      
      // 确保configs存在
      if (!settings.configs) {
        settings.configs = [];
        logToFile('No configs array in loaded settings, initializing empty array', 'WARN');
      }
      
      // 为新配置生成ID (如果没有)
      if (!config.id) {
        config.id = Date.now().toString();
        logToFile(`Generated new ID for config: ${config.id}`);
      }
      
      // 查找是否存在相同ID的配置
      const existingIndex = settings.configs.findIndex(c => c.id === config.id);
      logToFile(`Existing config index: ${existingIndex}`);
      
      if (existingIndex >= 0) {
        // 更新现有配置
        logToFile(`Updating existing config at index ${existingIndex}`);
        settings.configs[existingIndex] = config;
      } else {
        // 添加新配置
        logToFile(`Adding new config with ID ${config.id}`);
        settings.configs.push(config);
      }
      
      logToFile(`Total configs after update: ${settings.configs.length}`);
      
      // 保存设置
      const result = await saveAISettings(settings);
      logToFile(`Save result: ${result}`);
      return result;
    } catch (error) {
      logToFile(`Failed to save API config: ${error.message}`, 'ERROR');
      console.error('Failed to save API config:', error);
      return false;
    }
  });
  
  ipcMain.handle('ai:deleteApiConfig', async (event, configId) => {
    try {
      // 加载当前设置
      const settings = loadAISettings();
      
      // 确保configs存在
      if (!settings.configs) {
        settings.configs = [];
        return saveAISettings(settings);
      }
      
      // 查找配置并删除
      const originalLength = settings.configs.length;
      settings.configs = settings.configs.filter(c => c.id !== configId);
      
      // 如果当前选中的配置被删除，重置current
      if (settings.current && settings.current.id === configId) {
        if (settings.configs.length > 0) {
          // 如果还有其他配置，选择第一个
          settings.current = { ...settings.configs[0] };
        } else {
          // 如果没有配置了，重置为空配置
          settings.current = {
            apiUrl: '',
            apiKey: '',
            model: '',
            streamEnabled: true
          };
        }
      }
      
      // 如果确实删除了配置，保存设置
      if (settings.configs.length !== originalLength) {
        return saveAISettings(settings);
      }
      
      return true;
    } catch (error) {
      console.error('Failed to delete API config:', error);
      return false;
    }
  });
  
  ipcMain.handle('ai:setCurrentApiConfig', async (event, configId) => {
    try {
      logToFile(`Setting current API config with ID: ${configId}`);
      
      // 加载当前设置
      const settings = loadAISettings();
      
      // 确保configs存在
      if (!settings.configs) {
        settings.configs = [];
        logToFile('No configs array in loaded settings, initializing empty array', 'WARN');
      }
      
      logToFile(`Found ${settings.configs.length} configs in settings`);
      
      // 查找指定ID的配置
      const selectedConfig = settings.configs.find(c => c.id === configId);
      
      if (selectedConfig) {
        logToFile(`Found config with ID ${configId}, updating current config`);
        // 更新当前配置
        settings.current = { ...selectedConfig };
        
        // 保存设置
        const saveResult = saveAISettings(settings);
        logToFile(`Save result: ${saveResult}`);
        return saveResult;
      } else {
        logToFile(`No config found with ID ${configId}`, 'ERROR');
        return false;
      }
    } catch (error) {
      logToFile(`Failed to set current API config: ${error.message}`, 'ERROR');
      console.error('Failed to set current API config:', error);
      return false;
    }
  });
  
  ipcMain.handle('ai:sendPrompt', async (event, prompt, settings) => {
    try {
      return await sendAIPrompt(prompt, settings);
    } catch (error) {
      console.error('Error sending AI prompt:', error);
      return { error: error.message || '发送请求时出错' };
    }
  });

  // 直接处理API请求，绕过CORS限制
  ipcMain.handle('ai:sendAPIRequest', async (event, requestData, isStream) => {
    try {
      // 验证请求数据
      if (!requestData.url || !requestData.apiKey || !requestData.model || !requestData.messages) {
        throw new Error('请求数据无效，缺少必要参数');
      }

      console.log(`发送${isStream ? '流式' : '标准'}API请求到: ${requestData.url}`);

      if (isStream) {
        // 处理流式请求
        const https = require('https');
        const http = require('http');
        const url = new URL(requestData.url);
        
        const requestModule = url.protocol === 'https:' ? https : http;
        
        const options = {
          method: 'POST',
          hostname: url.hostname,
          path: url.pathname + url.search,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${requestData.apiKey}`
          }
        };
        
        const req = requestModule.request(options, (res) => {
          if (res.statusCode !== 200) {
            event.sender.send('stream-error', `API请求失败: ${res.statusCode} ${res.statusMessage}`);
            return;
          }
          
          res.on('data', (chunk) => {
            try {
              const data = chunk.toString('utf-8');
              const lines = data.split('\n');
              
              for (const line of lines) {
                if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                  try {
                    const jsonData = JSON.parse(line.substring(6));
                    if (jsonData.choices && jsonData.choices[0] && jsonData.choices[0].delta && jsonData.choices[0].delta.content) {
                      event.sender.send('stream-chunk', jsonData.choices[0].delta.content);
                    }
                  } catch (e) {
                    // 这可能只是部分数据，不是完整的JSON
                    console.log('非JSON数据片段:', line);
                  }
                }
              }
            } catch (error) {
              console.error('处理流数据时出错:', error);
            }
          });
          
          res.on('end', () => {
            event.sender.send('stream-end', '');
          });
        });
        
        req.on('error', (error) => {
          console.error('请求出错:', error);
          event.sender.send('stream-error', error.message);
        });
        
        // 发送请求数据
        req.write(JSON.stringify({
          model: requestData.model,
          messages: requestData.messages,
          stream: true
        }));
        
        req.end();
        
        return { success: true, message: '流式请求已开始' };
      } else {
        // 处理标准请求
        return new Promise((resolve, reject) => {
          try {
            const https = require('https');
            const http = require('http');
            const url = new URL(requestData.url);
            
            const requestModule = url.protocol === 'https:' ? https : http;
            
            const options = {
              method: 'POST',
              hostname: url.hostname,
              path: url.pathname + url.search,
              port: url.port || (url.protocol === 'https:' ? 443 : 80),
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${requestData.apiKey}`
              }
            };
            
            const req = requestModule.request(options, (res) => {
              let responseData = '';
              
              // 处理状态码非200的情况
              if (res.statusCode !== 200) {
                resolve({ 
                  success: false, 
                  error: `API请求失败: ${res.statusCode} ${res.statusMessage}`
                });
                return;
              }
              
              res.on('data', (chunk) => {
                responseData += chunk.toString('utf-8');
              });
              
              res.on('end', () => {
                try {
                  // 解析JSON响应
                  const data = JSON.parse(responseData);
                  if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
                    resolve({ 
                      success: true, 
                      content: data.choices[0].message.content 
                    });
                  } else {
                    resolve({
                      success: false,
                      error: '无法解析API响应',
                      rawResponse: responseData
                    });
                  }
                } catch (error) {
                  console.error('解析API响应时出错:', error);
                  resolve({ 
                    success: false, 
                    error: `解析响应失败: ${error.message}`,
                    rawResponse: responseData.substring(0, 200) + '...'
                  });
                }
              });
            });
            
            req.on('error', (error) => {
              console.error('请求出错:', error);
              resolve({ 
                success: false, 
                error: `请求失败: ${error.message}` 
              });
            });
            
            // 发送请求数据
            req.write(JSON.stringify({
              model: requestData.model,
              messages: requestData.messages,
              stream: false
            }));
            
            req.end();
          } catch (error) {
            console.error('创建请求时出错:', error);
            resolve({ 
              success: false, 
              error: `创建请求失败: ${error.message}` 
            });
          }
        });
      }
    } catch (error) {
      console.error('发送API请求时出错:', error);
      return { 
        success: false, 
        error: error.message 
      };
    }
  });

  // 文件管理相关API
  ipcMain.handle('listFiles', async (event, tabId, path, options = {}) => {
    try {
      // 使用 SFTP 会话池获取会话，而不是每次都创建新会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await getSftpSession(tabId);
          
          return new Promise((resolve, reject) => {
            sftp.readdir(path || '.', (err, list) => {
              if (err) {
                logToFile(`Failed to list directory for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `无法列出目录: ${err.message}` });
              }
              
              const files = list.map(item => ({
                name: item.filename,
                size: item.attrs.size,
                isDirectory: item.attrs.isDirectory(),
                modifyTime: new Date(item.attrs.mtime * 1000).toISOString(),
                permissions: item.attrs.mode
              }));
              
              resolve({ success: true, data: files });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      }, { 
        type: options.type || 'readdir', 
        path, 
        canMerge: options.canMerge || false,
        priority: options.priority || 'normal'
      });
    } catch (error) {
      logToFile(`List files error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `列出文件失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('copyFile', async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
            return { success: false, error: '无效的SSH连接' };
          }
          
          const sshClient = processInfo.process;
          
          return new Promise((resolve, reject) => {
            // 在远程服务器上执行复制命令
            sshClient.exec(`cp -r "${sourcePath}" "${targetPath}"`, (err, stream) => {
              if (err) {
                logToFile(`Failed to copy file for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `复制文件失败: ${err.message}` });
              }
              
              let errorOutput = '';
              
              stream.on('data', (data) => {
                // 通常cp命令执行成功不会有输出
              });
              
              stream.stderr.on('data', (data) => {
                errorOutput += data.toString();
              });
              
              stream.on('close', (code) => {
                if (code === 0) {
                  resolve({ success: true });
                } else {
                  logToFile(`File copy failed with code ${code} for session ${tabId}: ${errorOutput}`, 'ERROR');
                  resolve({ success: false, error: errorOutput || `复制文件失败，错误代码: ${code}` });
                }
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Copy file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `复制文件失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('moveFile', async (event, tabId, sourcePath, targetPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
            return { success: false, error: '无效的SSH连接' };
          }
          
          const sshClient = processInfo.process;
          
          return new Promise((resolve, reject) => {
            // 在远程服务器上执行移动命令
            sshClient.exec(`mv "${sourcePath}" "${targetPath}"`, (err, stream) => {
              if (err) {
                logToFile(`Failed to move file for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `移动文件失败: ${err.message}` });
              }
              
              let errorOutput = '';
              
              stream.on('data', (data) => {
                // 通常mv命令执行成功不会有输出
              });
              
              stream.stderr.on('data', (data) => {
                errorOutput += data.toString();
              });
              
              stream.on('close', (code) => {
                if (code === 0) {
                  resolve({ success: true });
                } else {
                  logToFile(`File move failed with code ${code} for session ${tabId}: ${errorOutput}`, 'ERROR');
                  resolve({ success: false, error: errorOutput || `移动文件失败，错误代码: ${code}` });
                }
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Move file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `移动文件失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('deleteFile', async (event, tabId, filePath, isDirectory) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
            return { success: false, error: '无效的SSH连接' };
          }
          
          const sshClient = processInfo.process;
          
          return new Promise((resolve, reject) => {
            // 根据是否为目录选择不同的删除命令
            const command = isDirectory ? `rm -rf "${filePath}"` : `rm "${filePath}"`;
            
            sshClient.exec(command, (err, stream) => {
              if (err) {
                logToFile(`Failed to delete file for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `删除文件失败: ${err.message}` });
              }
              
              let errorOutput = '';
              
              stream.on('data', (data) => {
                // 通常rm命令执行成功不会有输出
              });
              
              stream.stderr.on('data', (data) => {
                errorOutput += data.toString();
              });
              
              stream.on('close', (code) => {
                if (code === 0) {
                  resolve({ success: true });
                } else {
                  logToFile(`File deletion failed with code ${code} for session ${tabId}: ${errorOutput}`, 'ERROR');
                  resolve({ success: false, error: errorOutput || `删除文件失败，错误代码: ${code}` });
                }
              });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Delete file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `删除文件失败: ${error.message}` };
    }
  });
  
  // 创建文件夹
  ipcMain.handle('createFolder', async (event, tabId, folderPath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await getSftpSession(tabId);
          
          return new Promise((resolve, reject) => {
            // 创建文件夹
            sftp.mkdir(folderPath, (err) => {
              if (err) {
                logToFile(`Failed to create folder for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `创建文件夹失败: ${err.message}` });
              }
              
              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Create folder error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `创建文件夹失败: ${error.message}` };
    }
  });
  
  // 创建文件
  ipcMain.handle('createFile', async (event, tabId, filePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await getSftpSession(tabId);
          
          return new Promise((resolve, reject) => {
            // 使用writeFile创建一个空文件
            const emptyBuffer = Buffer.from('');
            sftp.writeFile(filePath, emptyBuffer, (err) => {
              if (err) {
                logToFile(`Failed to create file for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `创建文件失败: ${err.message}` });
              }
              
              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Create file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `创建文件失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('downloadFile', async (event, tabId, remotePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
            return { success: false, error: '无效的SSH连接' };
          }
          
          const sshClient = processInfo.process;
          const sshConfig = processInfo.config; // 获取SSH配置
          
          // 获取文件名
          const fileName = path.basename(remotePath);
          
          // 打开保存对话框
          const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: '保存文件',
            defaultPath: path.join(app.getPath('downloads'), fileName),
            buttonLabel: '下载'
          });
          
          if (canceled || !filePath) {
            return { success: false, error: '用户取消下载' };
          }
          
          // 创建SFTP客户端
          const sftp = new SftpClient();
          
          // 创建传输对象并存储到活动传输中
          const transferKey = `${tabId}-download`;
          
          return new Promise(async (resolve, reject) => {
            try {
              // 存储resolve和reject函数，以便在取消时调用
              activeTransfers.set(transferKey, { 
                sftp,
                tempFilePath: filePath + '.part',
                resolve,
                reject
              });
              
              // 使用SSH2客户端的连接配置
              await sftp.connect({
                host: sshConfig.host,
                port: sshConfig.port || 22,
                username: sshConfig.username,
                password: sshConfig.password,
                privateKey: sshConfig.privateKeyPath ? fs.readFileSync(sshConfig.privateKeyPath, 'utf8') : undefined,
                passphrase: sshConfig.privateKeyPath && sshConfig.password ? sshConfig.password : undefined
              });
              
              // 获取文件状态以获取文件大小
              const stats = await sftp.stat(remotePath);
              const totalBytes = stats.size;
              
              // 设置进度监控
              let transferredBytes = 0;
              let lastProgressUpdate = 0;
              let lastTransferredBytes = 0;
              let lastUpdateTime = Date.now();
              let transferSpeed = 0;
              const progressReportInterval = 100;
              
              // 定义进度回调函数
              const progressCallback = (transferred) => {
                transferredBytes = transferred;
                
                // 计算进度百分比
                const progress = Math.floor((transferredBytes / totalBytes) * 100);
                
                // 限制进度更新频率，避免频繁通知导致UI卡顿
                const now = Date.now();
                if (now - lastProgressUpdate >= progressReportInterval) {
                  // 计算传输速度 (字节/秒)
                  const elapsedSinceLastUpdate = (now - lastUpdateTime) / 1000; // 时间间隔(秒)
                  
                  if (elapsedSinceLastUpdate > 0) {
                    const bytesTransferredSinceLastUpdate = transferredBytes - lastTransferredBytes;
                    if (bytesTransferredSinceLastUpdate > 0) {
                      transferSpeed = bytesTransferredSinceLastUpdate / elapsedSinceLastUpdate;
                    }
                  }
                  
                  // 存储当前值供下次计算
                  lastTransferredBytes = transferredBytes;
                  lastUpdateTime = now;
                  
                  // 发送进度更新到渲染进程
                  event.sender.send('download-progress', {
                    tabId,
                    progress,
                    fileName,
                    transferredBytes,
                    totalBytes,
                    transferSpeed,
                    remainingTime: transferSpeed > 0 ? (totalBytes - transferredBytes) / transferSpeed : 0
                  });
                  
                  lastProgressUpdate = now;
                }
              };
              
              // 使用临时文件下载
              const tempFilePath = filePath + '.part';
              
              // 使用fastGet下载文件，并监控进度
              await sftp.fastGet(remotePath, tempFilePath, {
                step: (transferred, chunk, total) => {
                  progressCallback(transferred);
                }
              });
              
              // 重命名临时文件为最终文件
              fs.renameSync(tempFilePath, filePath);
              
              // 确保发送100%进度
              event.sender.send('download-progress', {
                tabId,
                progress: 100,
                fileName,
                transferredBytes: totalBytes,
                totalBytes,
                transferSpeed,
                remainingTime: 0
              });
              
              // 成功下载
              await sftp.end();
              
              // 从活动传输列表中移除
              activeTransfers.delete(transferKey);
              
              resolve({ success: true, filePath });
              
              // 在资源管理器中显示文件（可选）
              shell.showItemInFolder(filePath);
            } catch (error) {
              logToFile(`Download file error for session ${tabId}: ${error.message}`, 'ERROR');
              await sftp.end().catch(() => {}); // 忽略关闭连接可能的错误
              
              // 从活动传输列表中移除
              activeTransfers.delete(transferKey);
              
              // 如果是用户取消导致的错误，提供友好的消息
              if (error.message.includes('aborted') || error.message.includes('cancel')) {
                resolve({ success: false, cancelled: true, error: '下载已取消' });
              } else {
                resolve({ success: false, error: `下载文件失败: ${error.message}` });
              }
              
              // 清理临时文件
              try {
                if (fs.existsSync(tempFilePath)) {
                  fs.unlinkSync(tempFilePath);
                }
              } catch (e) {
                logToFile(`Failed to delete temp file: ${e.message}`, 'ERROR');
              }
            }
          });
        } catch (error) {
          logToFile(`Download file error for session ${tabId}: ${error.message}`, 'ERROR');
          return { success: false, error: `下载文件失败: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Download file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `下载文件失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('uploadFile', async (event, tabId, targetFolder) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
            return { success: false, error: '无效的SSH连接' };
          }
          
          const sshClient = processInfo.process;
          const sshConfig = processInfo.config; // 获取SSH配置
          
          // 打开文件选择对话框
          const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: '选择要上传的文件',
            properties: ['openFile'],
            buttonLabel: '上传'
          });
          
          if (canceled || filePaths.length === 0) {
            return { success: false, error: '用户取消上传' };
          }
          
          const localFilePath = filePaths[0];
          const fileName = path.basename(localFilePath);
          
          // 获取本地文件大小
          const stats = fs.statSync(localFilePath);
          const totalBytes = stats.size;
          
          // 确保路径格式正确（使用posix风格的路径）
          // 处理空路径和特殊路径
          let normalizedTargetFolder = targetFolder;
          if (targetFolder === '~') {
            normalizedTargetFolder = '.'; // 在SFTP中~不会自动扩展为主目录
          }
          // 确保路径格式正确
          const remoteFilePath = normalizedTargetFolder ? 
            path.posix.join(normalizedTargetFolder, fileName).replace(/\\/g, '/') : 
            fileName;
          
          logToFile(`Uploading file "${localFilePath}" to "${remoteFilePath}" for session ${tabId}`, 'INFO');
          
          // 创建SFTP客户端
          const sftp = new SftpClient();
          
          // 创建传输对象并存储到活动传输中
          const transferKey = `${tabId}-upload`;
          
          return new Promise(async (resolve, reject) => {
            try {
              // 存储resolve和reject函数，以便在取消时调用
              activeTransfers.set(transferKey, { 
                sftp,
                resolve,
                reject
              });
              
              // 使用SSH2客户端的连接配置
              await sftp.connect({
                host: sshConfig.host,
                port: sshConfig.port || 22,
                username: sshConfig.username,
                password: sshConfig.password,
                privateKey: sshConfig.privateKeyPath ? fs.readFileSync(sshConfig.privateKeyPath, 'utf8') : undefined,
                passphrase: sshConfig.privateKeyPath && sshConfig.password ? sshConfig.password : undefined
              });
              
              // 先检查目标文件夹是否存在
              try {
                const folderStat = await sftp.stat(normalizedTargetFolder);
                if (!folderStat.isDirectory) {
                  await sftp.end();
                  activeTransfers.delete(transferKey);
                  return resolve({ success: false, error: `目标${normalizedTargetFolder}不是文件夹` });
                }
              } catch (statErr) {
                logToFile(`Target folder check failed for session ${tabId}: ${statErr.message}`, 'ERROR');
                await sftp.end();
                activeTransfers.delete(transferKey);
                return resolve({ success: false, error: `目标文件夹不可访问: ${statErr.message}` });
              }
              
              // 设置进度监控
              let lastProgressUpdate = 0;
              let lastTransferredBytes = 0;
              let lastUpdateTime = Date.now();
              let transferSpeed = 0;
              const progressReportInterval = 100; // 每隔100ms报告进度
              
              // 使用fastPut上传文件，并监控进度
              await sftp.fastPut(localFilePath, remoteFilePath, {
                step: (transferred, chunk, total) => {
                  // 计算进度百分比
                  const progress = Math.floor((transferred / totalBytes) * 100);
                  
                  // 限制进度更新频率，避免频繁通知导致UI卡顿
                  const now = Date.now();
                  if (now - lastProgressUpdate >= progressReportInterval) {
                    // 计算传输速度 (字节/秒)
                    const elapsedSinceLastUpdate = (now - lastUpdateTime) / 1000; // 时间间隔(秒)
                    
                    if (elapsedSinceLastUpdate > 0) {
                      const bytesTransferredSinceLastUpdate = transferred - lastTransferredBytes;
                      if (bytesTransferredSinceLastUpdate > 0) {
                        transferSpeed = bytesTransferredSinceLastUpdate / elapsedSinceLastUpdate;
                      }
                    }
                    
                    // 存储当前值供下次计算
                    lastTransferredBytes = transferred;
                    lastUpdateTime = now;
                    
                    // 发送进度更新到渲染进程
                    event.sender.send('upload-progress', {
                      tabId,
                      progress,
                      fileName,
                      transferredBytes: transferred,
                      totalBytes,
                      transferSpeed,
                      remainingTime: transferSpeed > 0 ? (totalBytes - transferred) / transferSpeed : 0
                    });
                    
                    lastProgressUpdate = now;
                  }
                }
              });
              
              // 确保发送100%进度
              event.sender.send('upload-progress', {
                tabId,
                progress: 100,
                fileName,
                transferredBytes: totalBytes,
                totalBytes,
                transferSpeed,
                remainingTime: 0
              });
              
              // 成功上传
              await sftp.end();
              
              // 从活动传输列表中移除
              activeTransfers.delete(transferKey);
              
              logToFile(`Successfully uploaded file "${localFilePath}" to "${remoteFilePath}" for session ${tabId}`, 'INFO');
              resolve({ success: true, fileName });
              
            } catch (error) {
              logToFile(`Upload file error for session ${tabId}: ${error.message}`, 'ERROR');
              await sftp.end().catch(() => {}); // 忽略关闭连接可能的错误
              
              // 从活动传输列表中移除
              activeTransfers.delete(transferKey);
              
              // 如果是用户取消导致的错误，提供友好的消息
              if (error.message.includes('aborted') || error.message.includes('cancel')) {
                resolve({ success: false, cancelled: true, error: '上传已取消' });
              } else {
                resolve({ success: false, error: `上传文件失败: ${error.message}` });
              }
            }
          });
        } catch (error) {
          logToFile(`Upload file error for session ${tabId}: ${error.message}`, 'ERROR');
          return { success: false, error: `上传文件失败: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Upload file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `上传文件失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('renameFile', async (event, tabId, oldPath, newName) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          const sftp = await getSftpSession(tabId);
          
          // 从原路径中提取目录部分
          const lastSlashIndex = oldPath.lastIndexOf('/');
          const dirPath = lastSlashIndex > 0 ? oldPath.substring(0, lastSlashIndex) : '/';
          
          // 构建新路径
          const newPath = dirPath === '/' ? `/${newName}` : `${dirPath}/${newName}`;
          
          return new Promise((resolve, reject) => {
            // 使用SFTP重命名文件/文件夹
            sftp.rename(oldPath, newPath, (err) => {
              if (err) {
                logToFile(`Failed to rename file for session ${tabId}: ${err.message}`, 'ERROR');
                return resolve({ success: false, error: `重命名失败: ${err.message}` });
              }
              
              resolve({ success: true });
            });
          });
        } catch (error) {
          return { success: false, error: `SFTP会话错误: ${error.message}` };
        }
      });
    } catch (error) {
      logToFile(`Rename file error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `重命名失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('getAbsolutePath', async (event, tabId, relativePath) => {
    try {
      // 使用 SFTP 会话池获取会话
      return enqueueSftpOperation(tabId, async () => {
        try {
          // 查找对应的SSH客户端
          const processInfo = childProcesses.get(tabId);
          if (!processInfo || !processInfo.process || processInfo.type !== 'ssh2') {
            return { success: false, error: '无效的SSH连接' };
          }
          
          const sshClient = processInfo.process;
          
          return new Promise((resolve, reject) => {
            // 使用SSH执行pwd命令获取当前目录（用作基准目录）
            sshClient.exec('pwd', (err, stream) => {
              if (err) {
                return resolve({ success: false, error: `无法获取绝对路径: ${err.message}` });
              }
              
              let pwdOutput = '';
              
              stream.on('data', (data) => {
                pwdOutput += data.toString().trim();
              });
              
              stream.on('close', () => {
                let absolutePath;
                
                if (relativePath.startsWith('/')) {
                  // 如果是绝对路径，则直接使用
                  absolutePath = relativePath;
                } else if (relativePath.startsWith('~')) {
                  // 如果以~开头，替换为home目录
                  absolutePath = relativePath.replace('~', sshClient._sock._handle.remoteAddress);
                } else {
                  // 相对路径，基于pwd结果计算
                  absolutePath = pwdOutput + '/' + relativePath;
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
      logToFile(`Get absolute path error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `获取绝对路径失败: ${error.message}` };
    }
  });
  
  ipcMain.handle('cancelTransfer', async (event, tabId, type) => {
    try {
      const transferKey = `${tabId}-${type}`;
      const transfer = activeTransfers.get(transferKey);
      
      if (!transfer) {
        console.log(`No active transfer found for ${transferKey}`);
        return { success: false, error: '没有找到活动的传输任务' };
      }
      
      console.log(`Cancelling transfer for ${transferKey}`);
      
      // 中断传输
      if (transfer.sftp) {
        try {
          // 如果有resolve方法（表示有未完成的IPC请求），尝试调用它
          if (transfer.resolve) {
            try {
              console.log(`Resolving pending ${type} request for ${tabId}`);
              transfer.resolve({ success: false, cancelled: true, error: '用户取消了传输' });
            } catch (resolveError) {
              console.error(`Error resolving pending request: ${resolveError.message}`);
            }
          }
          
          // 尝试中断操作并关闭连接
          await transfer.sftp.end();
          logToFile(`Transfer cancelled for session ${tabId}`, 'INFO');
          
          // 如果有临时文件需要删除
          if (transfer.tempFilePath && fs.existsSync(transfer.tempFilePath)) {
            fs.unlinkSync(transfer.tempFilePath);
          }
          
          // 从活动传输中移除
          activeTransfers.delete(transferKey);
          
          return { success: true };
        } catch (error) {
          logToFile(`Error cancelling transfer for session ${tabId}: ${error.message}`, 'ERROR');
          return { success: false, error: `取消传输失败: ${error.message}` };
        }
      } else {
        return { success: false, error: '传输任务无法取消' };
      }
    } catch (error) {
      logToFile(`Cancel transfer error for session ${tabId}: ${error.message}`, 'ERROR');
      return { success: false, error: `取消传输失败: ${error.message}` };
    }
  });

  // 获取或创建 SFTP 会话
  ipcMain.handle('getSftpSession', async (event, tabId) => {
    try {
      return getSftpSession(tabId);
    } catch (error) {
      console.error('Error getting SFTP session:', error);
      return { success: false, error: error.message };
    }
  });

  // 处理 SFTP 操作队列
  ipcMain.handle('enqueueSftpOperation', async (event, tabId, operation) => {
    try {
      return enqueueSftpOperation(tabId, operation);
    } catch (error) {
      console.error('Error enqueuing SFTP operation:', error);
      return { success: false, error: error.message };
    }
  });

  // 处理队列中的 SFTP 操作
  ipcMain.handle('processSftpQueue', async (event, tabId) => {
    try {
      return processSftpQueue(tabId);
    } catch (error) {
      console.error('Error processing SFTP queue:', error);
      return { success: false, error: error.message };
    }
  });
}

// 获取本地系统信息
function getLocalSystemInfo() {
  const osInfo = {
    type: os.type(),
    platform: os.platform(),
    release: os.release(),
    hostname: os.hostname(),
    distro: '未知',
    version: '未知'
  };

  // 根据平台添加额外信息
  if (osInfo.platform === 'win32') {
    // Windows平台
    const windowsVersions = {
      '10.0': 'Windows 10/11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
      '6.0': 'Windows Vista',
      '5.2': 'Windows XP 64-Bit Edition/Windows Server 2003',
      '5.1': 'Windows XP',
      '5.0': 'Windows 2000'
    };

    // 尝试获取Windows版本
    const releaseVersion = osInfo.release.split('.');
    if (releaseVersion.length >= 2) {
      const majorMinor = `${releaseVersion[0]}.${releaseVersion[1]}`;
      osInfo.distro = windowsVersions[majorMinor] || 'Windows';
    } else {
      osInfo.distro = 'Windows';
    }
    
    // 获取更具体的Windows版本信息
    try {
      if (osInfo.release.startsWith('10.0')) {
        // 获取Windows 10/11的具体版本号(如20H2, 21H1等)
        const buildNumber = parseInt(osInfo.release.split('.')[2], 10);
        
        // 根据构建号识别主要Windows版本
        if (buildNumber >= 22000) {
          osInfo.distro = 'Windows 11';
          if (buildNumber >= 22621) {
            osInfo.version = '23H2';
          } else if (buildNumber >= 22000) {
            osInfo.version = '21H2';
          }
        } else {
          osInfo.distro = 'Windows 10';
          if (buildNumber >= 19045) {
            osInfo.version = '22H2';
          } else if (buildNumber >= 19044) {
            osInfo.version = '21H2';
          } else if (buildNumber >= 19043) {
            osInfo.version = '21H1';
          } else if (buildNumber >= 19042) {
            osInfo.version = '20H2';
          } else if (buildNumber >= 19041) {
            osInfo.version = '2004';
          } else if (buildNumber >= 18363) {
            osInfo.version = '1909';
          } else if (buildNumber >= 18362) {
            osInfo.version = '1903';
          }
        }
      }
    } catch (e) {
      console.error('Error determining Windows version:', e);
    }
    
    // 添加架构信息
    try {
      const arch = os.arch();
      osInfo.release = `${osInfo.distro} ${osInfo.release} (${arch})`;
    } catch (e) {
      console.error('Error getting architecture info:', e);
    }
  } else if (osInfo.platform === 'darwin') {
    // macOS平台
    const macVersions = {
      '22': 'Ventura',
      '21': 'Monterey',
      '20': 'Big Sur',
      '19': 'Catalina',
      '18': 'Mojave',
      '17': 'High Sierra',
      '16': 'Sierra',
      '15': 'El Capitan',
      '14': 'Yosemite',
      '13': 'Mavericks',
      '12': 'Mountain Lion',
      '11': 'Lion',
      '10': 'Snow Leopard'
    };

    // 尝试获取macOS版本
    osInfo.distro = 'macOS';
    const darwinVersion = osInfo.release.split('.')[0];
    if (macVersions[darwinVersion]) {
      osInfo.version = macVersions[darwinVersion];
      osInfo.release = `macOS ${osInfo.version} (${osInfo.release})`;
    } else {
      // 尝试通过Darwin版本推断macOS版本
      if (parseInt(darwinVersion, 10) >= 23) {
        osInfo.version = 'Sonoma+';
      }
      osInfo.release = `macOS ${osInfo.version || osInfo.release}`;
    }
  } else if (osInfo.platform === 'linux') {
    // Linux平台，但Electron环境中能获取的信息有限
    osInfo.distro = 'Linux';
    // 在Electron中我们无法轻松运行命令获取发行版信息
    // 所以这里只提供基本信息
    osInfo.release = `Linux ${osInfo.release}`;
  }

  return {
    isLocal: true,
    os: osInfo,
    cpu: {
      model: os.cpus()[0].model,
      cores: os.cpus().length,
      speed: os.cpus()[0].speed,
      usage: getCpuUsage()
    },
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
      used: os.totalmem() - os.freemem(),
      usagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100)
    }
  };
}

// 计算CPU使用率
function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  
  const usage = 100 - Math.round((totalIdle / totalTick) * 100);
  return usage;
}

// 获取远程系统信息
async function getRemoteSystemInfo(sshClient) {
  return new Promise((resolve, reject) => {
    const result = {
      isLocal: false,
      os: { type: '未知', platform: '未知', release: '未知', hostname: '未知', distro: '未知', version: '未知' },
      cpu: { model: '未知', cores: 0, usage: 0 },
      memory: { total: 0, free: 0, used: 0, usagePercent: 0 }
    };
    
    // 获取基本操作系统信息
    sshClient.exec('uname -a', (err, stream) => {
      if (err) {
        console.error('SSH exec error (uname):', err);
        resolve(result);
        return;
      }
      
      let output = '';
      stream.on('data', (data) => {
        output += data.toString();
      });
      
      stream.on('close', () => {
        // 解析基本操作系统信息
        const osInfo = output.trim();
        
        // 检测操作系统类型
        if (osInfo.includes('Linux')) {
          result.os.type = 'Linux';
          result.os.platform = 'linux';
          
          // 获取详细的Linux发行版信息
          getLinuxDistro();
        } else if (osInfo.includes('Darwin')) {
          result.os.type = 'macOS';
          result.os.platform = 'darwin';
          
          // 获取macOS版本
          getMacOSVersion();
        } else if (osInfo.includes('FreeBSD')) {
          result.os.type = 'FreeBSD';
          result.os.platform = 'freebsd';
          getHostname();
        } else if (osInfo.includes('Windows')) {
          result.os.type = 'Windows';
          result.os.platform = 'win32';
          getWindowsVersion();
        } else {
          // 未识别的系统，直接保存uname信息
          result.os.release = osInfo;
          getHostname();
        }
        
        // 获取Linux发行版信息
        function getLinuxDistro() {
          // 尝试多种方法获取Linux发行版信息
          const distroCommands = [
            'cat /etc/os-release | grep -E "^(NAME|VERSION)="',
            'lsb_release -a 2>/dev/null',
            'cat /etc/redhat-release 2>/dev/null',
            'cat /etc/debian_version 2>/dev/null'
          ];
          
          let commandIndex = 0;
          tryNextCommand();
          
          function tryNextCommand() {
            if (commandIndex >= distroCommands.length) {
              // 所有命令都尝试过了，保存现有信息然后继续
              result.os.release = osInfo;
              getHostname();
              return;
            }
            
            const command = distroCommands[commandIndex++];
            sshClient.exec(command, (err, stream) => {
              if (err) {
                console.error(`SSH exec error (distro command ${commandIndex}):`, err);
                tryNextCommand();
                return;
              }
              
              let distroOutput = '';
              stream.on('data', (data) => {
                distroOutput += data.toString();
              });
              
              stream.on('close', () => {
                const output = distroOutput.trim();
                if (output) {                  
                  // 解析不同格式的输出
                  if (command.includes('/etc/os-release')) {
                    // 解析os-release格式
                    const nameMatch = output.match(/NAME="([^"]+)"/);
                    const versionMatch = output.match(/VERSION="([^"]+)"/);
                    
                    if (nameMatch) {
                      result.os.distro = nameMatch[1];
                    }
                    if (versionMatch) {
                      result.os.version = versionMatch[1];
                    }
                    
                    result.os.release = `${result.os.distro || 'Linux'} ${result.os.version || ''}`.trim();
                    getHostname();
                  } else if (command.includes('lsb_release')) {
                    // 解析lsb_release格式
                    const distroMatch = output.match(/Distributor ID:\s+(.+)/);
                    const versionMatch = output.match(/Release:\s+(.+)/);
                    
                    if (distroMatch) {
                      result.os.distro = distroMatch[1].trim();
                    }
                    if (versionMatch) {
                      result.os.version = versionMatch[1].trim();
                    }
                    
                    result.os.release = `${result.os.distro || 'Linux'} ${result.os.version || ''}`.trim();
                    getHostname();
                  } else if (command.includes('/etc/redhat-release') || command.includes('/etc/debian_version')) {
                    // 直接使用文件内容
                    result.os.release = output;
                    result.os.distro = output.split(' ')[0] || 'Linux';
                    
                    // 尝试提取版本号
                    const versionMatch = output.match(/(\d+(\.\d+)+)/);
                    if (versionMatch) {
                      result.os.version = versionMatch[1];
                    }
                    
                    getHostname();
                  } else {
                    tryNextCommand();
                  }
                } else {
                  tryNextCommand();
                }
              });
            });
          }
        }
        
        // 获取macOS版本
        function getMacOSVersion() {
          sshClient.exec('sw_vers', (err, stream) => {
            if (err) {
              console.error('SSH exec error (sw_vers):', err);
              getHostname();
              return;
            }
            
            let macOutput = '';
            stream.on('data', (data) => {
              macOutput += data.toString();
            });
            
            stream.on('close', () => {
              const productMatch = macOutput.match(/ProductName:\s+(.+)/);
              const versionMatch = macOutput.match(/ProductVersion:\s+(.+)/);
              
              if (productMatch) {
                result.os.distro = productMatch[1].trim();
              }
              if (versionMatch) {
                result.os.version = versionMatch[1].trim();
              }
              
              result.os.release = `${result.os.distro || 'macOS'} ${result.os.version || ''}`.trim();
              getHostname();
            });
          });
        }
        
        // 获取Windows版本
        function getWindowsVersion() {
          sshClient.exec('wmic os get Caption,Version,OSArchitecture /value', (err, stream) => {
            if (err) {
              console.error('SSH exec error (wmic os):', err);
              getHostname();
              return;
            }
            
            let winOutput = '';
            stream.on('data', (data) => {
              winOutput += data.toString();
            });
            
            stream.on('close', () => {
              const captionMatch = winOutput.match(/Caption=(.+)/);
              const versionMatch = winOutput.match(/Version=(.+)/);
              const archMatch = winOutput.match(/OSArchitecture=(.+)/);
              
              if (captionMatch) {
                result.os.distro = captionMatch[1].trim();
              }
              if (versionMatch) {
                result.os.version = versionMatch[1].trim();
              }
              
              let archInfo = '';
              if (archMatch) {
                archInfo = ` (${archMatch[1].trim()})`;
              }
              
              result.os.release = `${result.os.distro || 'Windows'} ${result.os.version || ''}${archInfo}`.trim();
              getHostname();
            });
          });
        }
        
        // 获取主机名
        function getHostname() {
          sshClient.exec('hostname', (err, stream) => {
            if (err) {
              console.error('SSH exec error (hostname):', err);
              getMemoryInfo();
              return;
            }
            
            let hostnameOutput = '';
            stream.on('data', (data) => {
              hostnameOutput += data.toString();
            });
            
            stream.on('close', () => {
              result.os.hostname = hostnameOutput.trim();
              getMemoryInfo();
            });
          });
        }
        
        function getMemoryInfo() {
          // 根据平台决定获取内存命令
          const memCommand = result.os.platform === 'win32' 
            ? 'wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value' 
            : 'free -b';
          
          sshClient.exec(memCommand, (err, stream) => {
            if (err) {
              console.error('SSH exec error (memory):', err);
              getCpuInfo();
              return;
            }
            
            let memOutput = '';
            stream.on('data', (data) => {
              memOutput += data.toString();
            });
            
            stream.on('close', () => {
              try {
                if (result.os.platform === 'win32') {
                  // 解析Windows内存信息
                  const freeMatch = memOutput.match(/FreePhysicalMemory=(\d+)/);
                  const totalMatch = memOutput.match(/TotalVisibleMemorySize=(\d+)/);
                  
                  if (freeMatch && totalMatch) {
                    // Windows返回的是KB，需要转换为字节
                    const free = parseInt(freeMatch[1], 10) * 1024;
                    const total = parseInt(totalMatch[1], 10) * 1024;
                    const used = total - free;
                    
                    result.memory.total = total;
                    result.memory.free = free;
                    result.memory.used = used;
                    result.memory.usagePercent = Math.round((used / total) * 100);
                  }
                } else {
                  // 解析Linux内存信息
                  const memLines = memOutput.split('\n');
                  if (memLines.length > 1) {
                    const memInfo = memLines[1].split(/\s+/);
                    if (memInfo.length >= 4) {
                      result.memory.total = parseInt(memInfo[1], 10);
                      result.memory.used = parseInt(memInfo[2], 10);
                      result.memory.free = parseInt(memInfo[3], 10);
                      result.memory.usagePercent = Math.round((result.memory.used / result.memory.total) * 100);
                    }
                  }
                }
              } catch (error) {
                console.error('Error parsing memory info:', error);
              }
              
              getCpuInfo();
            });
          });
        }
        
        function getCpuInfo() {
          // 根据平台选择不同命令
          const cpuCommand = result.os.platform === 'win32'
            ? 'wmic cpu get NumberOfCores,Name'
            : 'cat /proc/cpuinfo | grep -E "model name|processor" | wc -l';
          
          sshClient.exec(cpuCommand, (err, stream) => {
            if (err) {
              console.error('SSH exec error (cpuinfo):', err);
              getCpuModel();
              return;
            }
            
            let cpuOutput = '';
            stream.on('data', (data) => {
              cpuOutput += data.toString();
            });
            
            stream.on('close', () => {
              try {
                if (result.os.platform === 'win32') {
                  // 解析Windows CPU核心数
                  const lines = cpuOutput.trim().split('\n');
                  if (lines.length >= 2) {
                    const coresLine = lines[1].trim();
                    result.cpu.cores = parseInt(coresLine, 10) || 1;
                  }
                } else {
                  // 解析Linux CPU核心数
                  result.cpu.cores = parseInt(cpuOutput.trim(), 10) / 2; // 除以2因为每个处理器有两行信息
                }
              } catch (error) {
                console.error('Error parsing CPU count:', error);
              }
              
              getCpuModel();
            });
          });
        }
        
        function getCpuModel() {
          const modelCommand = result.os.platform === 'win32'
            ? 'wmic cpu get Name'
            : 'cat /proc/cpuinfo | grep "model name" | head -1';
          
          sshClient.exec(modelCommand, (err, stream) => {
            if (err) {
              console.error('SSH exec error (cpuinfo model):', err);
              getCpuUsage();
              return;
            }
            
            let modelOutput = '';
            stream.on('data', (data) => {
              modelOutput += data.toString();
            });
            
            stream.on('close', () => {
              try {
                if (result.os.platform === 'win32') {
                  // 解析Windows CPU型号
                  const lines = modelOutput.trim().split('\n');
                  if (lines.length >= 2) {
                    result.cpu.model = lines[1].trim();
                  }
                } else {
                  // 解析Linux CPU型号
                  const match = modelOutput.match(/model name\s*:\s*(.*)/);
                  if (match && match[1]) {
                    result.cpu.model = match[1].trim();
                  }
                }
              } catch (error) {
                console.error('Error parsing CPU model:', error);
              }
              
              getCpuUsage();
            });
          });
        }
        
        function getCpuUsage() {
          const usageCommand = result.os.platform === 'win32'
            ? 'wmic cpu get LoadPercentage'
            : 'top -bn1 | grep "Cpu(s)" | sed "s/.*, *\\([0-9.]*\\)%* id.*/\\1/" | awk \'{print 100 - $1}\'';
          
          sshClient.exec(usageCommand, (err, stream) => {
            if (err) {
              console.error('SSH exec error (cpu usage):', err);
              finalize();
              return;
            }
            
            let usageOutput = '';
            stream.on('data', (data) => {
              usageOutput += data.toString();
            });
            
            stream.on('close', () => {
              try {
                if (result.os.platform === 'win32') {
                  // 解析Windows CPU使用率
                  const lines = usageOutput.trim().split('\n');
                  if (lines.length >= 2) {
                    result.cpu.usage = parseInt(lines[1].trim(), 10);
                  }
                } else {
                  // 解析Linux CPU使用率
                  result.cpu.usage = parseFloat(usageOutput.trim());
                }
              } catch (error) {
                console.error('Error parsing CPU usage:', error);
              }
              
              finalize();
            });
          });
        }
        
        function finalize() {
          resolve(result);
        }
      });
    });
  });
}

// 加载AI设置，使用统一的config.json
const loadAISettings = () => {
  const configPath = getConfigPath();
  logToFile(`Loading AI settings from ${configPath}`);
  
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(data);
      
      // 从config对象中读取AI设置
      if (config.aiSettings) {
        const settings = { ...config.aiSettings };
        logToFile(`Loaded settings: ${JSON.stringify({
          hasConfigs: Array.isArray(settings.configs),
          configsCount: Array.isArray(settings.configs) ? settings.configs.length : 0,
          hasCurrent: !!settings.current
        })}`);
        
        // 确保必要的属性存在
        if (!settings.configs) {
          settings.configs = [];
          logToFile('No configs array found, initializing empty array', 'WARN');
        }
        
        // 解密所有配置中的API密钥
        if (settings.configs && Array.isArray(settings.configs)) {
          settings.configs = settings.configs.map(cfg => {
            if (cfg.apiKey) {
              try {
                return { ...cfg, apiKey: decrypt(cfg.apiKey) };
              } catch (err) {
                logToFile(`Failed to decrypt API key for config ${cfg.id}: ${err.message}`, 'ERROR');
                return cfg;
              }
            }
            return cfg;
          });
        }
        
        // 解密当前设置的API密钥
        if (settings.current && settings.current.apiKey) {
          try {
            settings.current.apiKey = decrypt(settings.current.apiKey);
          } catch (err) {
            logToFile(`Failed to decrypt current API key: ${err.message}`, 'ERROR');
          }
        }
        
        // 确保当前设置存在所有字段
        if (!settings.current) {
          settings.current = {
            apiUrl: '',
            apiKey: '',
            model: '',
            streamEnabled: true
          };
          logToFile('No current settings found, initializing with defaults', 'WARN');
        }
        
        return settings;
      } else {
        logToFile('No aiSettings found in config', 'WARN');
      }
    } else {
      logToFile(`Config file does not exist: ${configPath}`, 'WARN');
    }
  } catch (error) {
    logToFile(`Failed to load AI settings: ${error.message}`, 'ERROR');
    console.error('Failed to load AI settings:', error);
  }
  
  // 默认设置
  logToFile('Returning default settings');
  return {
    configs: [],
    current: {
      apiUrl: '',
      apiKey: '',
      model: '',
      streamEnabled: true
    }
  };
};

// 保存AI设置，使用统一的config.json
const saveAISettings = (settings) => {
  const configPath = getConfigPath();
  logToFile(`Saving AI settings to ${configPath}`);
  logToFile(`Settings to save: ${JSON.stringify({
    hasConfigs: Array.isArray(settings.configs),
    configsCount: Array.isArray(settings.configs) ? settings.configs.length : 0,
    hasCurrent: !!settings.current
  })}`);
  
  try {
    // 加载当前配置
    let config = {};
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      config = JSON.parse(data);
      logToFile('Loaded existing config');
    } else {
      logToFile('No existing config, creating new one');
    }
    
    // 创建设置副本以避免修改原始对象
    const settingsToSave = JSON.parse(JSON.stringify(settings));
    
    // 确保configs是数组
    if (!settingsToSave.configs) {
      settingsToSave.configs = [];
      logToFile('No configs array in settings to save, initializing empty array', 'WARN');
    }
    
    // 加密所有配置的API密钥
    if (settingsToSave.configs && Array.isArray(settingsToSave.configs)) {
      logToFile(`Encrypting ${settingsToSave.configs.length} configs`);
      settingsToSave.configs = settingsToSave.configs.map(cfg => {
        const configCopy = { ...cfg };
        if (configCopy.apiKey) {
          try {
            configCopy.apiKey = encrypt(configCopy.apiKey);
          } catch (err) {
            logToFile(`Failed to encrypt API key for config ${cfg.id}: ${err.message}`, 'ERROR');
          }
        }
        return configCopy;
      });
    }
    
    // 加密当前设置的API密钥
    if (settingsToSave.current && settingsToSave.current.apiKey) {
      try {
        settingsToSave.current.apiKey = encrypt(settingsToSave.current.apiKey);
        logToFile('Encrypted current API key');
      } catch (err) {
        logToFile(`Failed to encrypt current API key: ${err.message}`, 'ERROR');
      }
    }
    
    // 更新AI设置部分
    config.aiSettings = settingsToSave;
    
    // 写回配置文件
    const configJson = JSON.stringify(config, null, 2);
    logToFile(`Config to write: ${configJson.substring(0, 100)}...`);
    fs.writeFileSync(configPath, configJson, 'utf8');
    logToFile('Successfully saved AI settings');
    return true;
  } catch (error) {
    logToFile(`Failed to save AI settings: ${error.message}`, 'ERROR');
    console.error('Failed to save AI settings:', error);
    return false;
  }
};

// 向Worker线程发送AI请求
const sendAIPrompt = async (prompt, settings) => {
  try {
    // 确保worker线程已经创建
    if (!aiWorker) {
      aiWorker = createAIWorker();
    }
    
    // 如果worker创建失败，则使用内联处理
    if (!aiWorker) {
      console.log('Worker not available, using inline processing');
      return processAIPromptInline(prompt, settings);
    }
    
    // 生成唯一请求ID
    const requestId = nextRequestId++;
    
    // 创建Promise，将其解析函数存储在Map中
    const responsePromise = new Promise((resolve, reject) => {
      // 设置5秒超时，避免永久阻塞
      const timeoutId = setTimeout(() => {
        aiRequestMap.delete(requestId);
        reject(new Error('请求超时，AI处理时间过长'));
      }, 5000);
      
      aiRequestMap.set(requestId, { 
        resolve: (result) => {
          clearTimeout(timeoutId);
          resolve(result);
        }, 
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        } 
      });
    });
    
    // 向worker发送请求
    aiWorker.postMessage({
      id: requestId,
      type: 'prompt',
      prompt,
      settings
    });
    
    // 等待结果
    return await responsePromise;
  } catch (error) {
    console.error('Error sending AI prompt to worker:', error);
    // 如果与worker通信失败，回退到内联处理
    return processAIPromptInline(prompt, settings);
  }
};

// 内联处理AI请求（作为worker不可用时的备选）
const processAIPromptInline = async (prompt, settings) => {
  try {
    // 检查设置是否有效
    if (!settings || !settings.apiKey) {
      return { error: 'API设置不完整，请在设置中配置API密钥' };
    }
    
    if (!settings.apiUrl) {
      return { error: 'API URL不可用，请在设置中配置API URL' };
    }
    
    if (!settings.model) {
      return { error: '模型名称未指定，请在设置中配置模型名称' };
    }
    
    console.log('Processing AI prompt inline:', prompt.substring(0, 30) + '...');
    
    // 使用简单的响应模拟
    return { 
      response: `这是对"${prompt}"的模拟响应(内联处理)。在实际应用中，这里将连接到AI API。您当前的设置是使用模型: ${settings.model}`, 
    };
  } catch (error) {
    console.error('Error processing AI prompt inline:', error);
    return { error: `处理请求时出错: ${error.message}` };
  }
};

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
