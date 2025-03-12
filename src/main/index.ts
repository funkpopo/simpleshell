import { app, shell, BrowserWindow, ipcMain} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../renderer/src/assets/SimpleShell-icon.png?asset'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { Client } from 'ssh2'
import * as pty from 'node-pty'
import SftpClient from 'ssh2-sftp-client'
import { encryptConnection, decryptConnection, decryptString } from './crypto-utils'

// 主窗口实例
let mainWindow: BrowserWindow | null = null

// 定义连接配置的数据类型
interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  description?: string
}

interface Organization {
  id: string
  name: string
  connections: Connection[]
}

// 连接配置文件路径
const connectionsFilePath = is.dev
  ? path.join(process.cwd(), 'connections.json')
  : path.join(getAppPath(), 'connections.json')

// 设置文件路径
const settingsPath = is.dev 
  ? path.join(process.cwd(), 'config.json')
  : path.join(getAppPath(), 'config.json')

// 聊天历史记录文件路径
const chatHistoryPath = is.dev
  ? path.join(process.cwd(), 'chathistory.json')
  : path.join(getAppPath(), 'chathistory.json')

// 输出环境信息
console.log('应用环境:', is.dev ? '开发环境' : '生产环境')
console.log('应用路径:', getAppPath())
console.log('连接配置文件路径:', connectionsFilePath)
console.log('设置文件路径:', settingsPath)
console.log('聊天历史记录文件路径:', chatHistoryPath)

// 加载连接配置
function loadConnections(): Organization[] {
  try {
    if (fs.existsSync(connectionsFilePath)) {
      const fileContent = fs.readFileSync(connectionsFilePath, 'utf-8')
      // 如果文件存在但为空或内容无效，返回空数组
      if (!fileContent.trim()) {
        // console.log('配置文件存在但为空，返回空数组')
        return []
      }
      
      try {
        const parsed = JSON.parse(fileContent)
        // 确认解析出的内容是数组
        if (Array.isArray(parsed)) {
          // 解密敏感数据
          return parsed.map(org => ({
            ...org,
            connections: Array.isArray(org.connections) 
              ? org.connections.map(conn => decryptConnection(conn))
              : []
          }))
        } else {
          // console.warn('配置文件内容不是有效数组，返回空数组')
          return []
        }
      } catch (parseError) {
        // console.error('解析配置文件失败:', parseError)
        return []
      }
    }
  } catch (error) {
    // console.error('加载连接配置失败:', error)
  }
  
  // 如果文件不存在，返回空数组
  // console.log('配置文件不存在，返回空数组')
  return []
}

// 保存连接配置
function saveConnections(organizations: Organization[]): boolean {
  try {
    const dirPath = path.dirname(connectionsFilePath)
    
    // 确保目录存在
    if (!fs.existsSync(dirPath)) {
      console.log('创建目录:', dirPath)
      fs.mkdirSync(dirPath, { recursive: true })
    }
    
    // 在开发环境中，额外打印路径信息
    console.log('保存连接配置到:', connectionsFilePath)
    // 数据可能很大，只打印长度信息
    console.log('保存数据:', Array.isArray(organizations) ? `${organizations.length}个组织` : '非数组')
    
    // 加密敏感数据
    const encryptedOrganizations = organizations.map(org => ({
      ...org,
      connections: Array.isArray(org.connections) 
        ? org.connections.map(conn => encryptConnection(conn))
        : []
    }))
    
    // 以同步方式写入文件
    const jsonContent = JSON.stringify(encryptedOrganizations, null, 2)
    fs.writeFileSync(connectionsFilePath, jsonContent, { encoding: 'utf-8', flag: 'w' })
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
    
    return true
  } catch (error) {
    console.error('保存连接配置失败，错误详情:', error)
    return false
  }
}

// 加载聊天历史记录
function loadChatHistory() {
  try {
    if (fs.existsSync(chatHistoryPath)) {
      const data = fs.readFileSync(chatHistoryPath, 'utf-8')
      return JSON.parse(data)
    } else {
      // 如果文件不存在，创建一个空的历史记录
      const emptyHistory = { sessions: [] }
      
      // 确保目录存在
      const dirPath = path.dirname(chatHistoryPath)
      if (!fs.existsSync(dirPath)) {
        console.log('创建聊天历史目录:', dirPath)
        fs.mkdirSync(dirPath, { recursive: true })
      }
      
      console.log('创建空聊天历史文件:', chatHistoryPath)
      fs.writeFileSync(chatHistoryPath, JSON.stringify(emptyHistory, null, 2), 'utf-8')
      return emptyHistory
    }
  } catch (error) {
    console.error('加载聊天历史失败:', error)
    return { sessions: [] }
  }
}

// 保存聊天会话
function saveChatSession(session: any) {
  try {
    const history = loadChatHistory()
    
    // 找到现有会话的索引
    const existingIndex = history.sessions.findIndex((s: any) => s.id === session.id)
    
    if (existingIndex !== -1) {
      // 更新现有会话
      history.sessions[existingIndex] = session
    } else {
      // 添加新会话
      history.sessions.push(session)
    }
    
    // 确保目录存在
    const dirPath = path.dirname(chatHistoryPath)
    if (!fs.existsSync(dirPath)) {
      console.log('创建聊天历史目录:', dirPath)
      fs.mkdirSync(dirPath, { recursive: true })
    }
    
    console.log('保存聊天会话到:', chatHistoryPath)
    // 保存回文件
    fs.writeFileSync(chatHistoryPath, JSON.stringify(history, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('保存聊天会话失败:', error)
    return { success: false, error: (error as Error).message }
  }
}

// 删除聊天会话
function deleteHistorySession(sessionId: string) {
  try {
    const history = loadChatHistory()
    
    // 过滤掉要删除的会话
    history.sessions = history.sessions.filter((s: any) => s.id !== sessionId)
    
    // 确保目录存在
    const dirPath = path.dirname(chatHistoryPath)
    if (!fs.existsSync(dirPath)) {
      console.log('创建聊天历史目录:', dirPath)
      fs.mkdirSync(dirPath, { recursive: true })
    }
    
    console.log('删除聊天会话，保存到:', chatHistoryPath)
    // 保存回文件
    fs.writeFileSync(chatHistoryPath, JSON.stringify(history, null, 2), 'utf-8')
    return { success: true }
  } catch (error) {
    console.error('删除聊天会话失败:', error)
    return { success: false, error: (error as Error).message }
  }
}

// 获取CPU使用率
async function getCpuUsage(): Promise<number> {
  const startMeasure = os.cpus().map(cpu => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0)
  }))

  await new Promise(resolve => setTimeout(resolve, 1000))

  const endMeasure = os.cpus().map(cpu => ({
    idle: cpu.times.idle,
    total: Object.values(cpu.times).reduce((acc, tv) => acc + tv, 0)
  }))

  const idleDifference = endMeasure[0].idle - startMeasure[0].idle
  const totalDifference = endMeasure[0].total - startMeasure[0].total
  return 100 - (idleDifference / totalDifference) * 100
}

// 获取系统信息
async function getSystemInfo() {
  const cpuUsage = await getCpuUsage()
  
  const os = require('os')
  const cpus = os.cpus()
  
  // 获取总内存和可用内存
  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = totalMem - freeMem
  const usedMemPercentage = Math.round((usedMem / totalMem) * 100)
  
  return {
    osInfo: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch()
    },
    cpuInfo: {
      usage: cpuUsage,
      model: cpus[0].model,
      cores: cpus.length
    },
    memoryInfo: {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      usedPercentage: usedMemPercentage
    }
  }
}

// 记录所有活动的SSH连接
const activeConnections = new Map()

// 记录所有活动的SFTP连接
const activeSftpConnections = new Map<string, any>()

// 存储活跃的传输任务
const activeTransfers = new Map<string, { 
  readStream?: any, 
  writeStream?: any, 
  connectionId: string 
}>();

// SSH会话管理
ipcMain.handle('ssh:connect', async (_, connectionInfo: any) => {
  let originalInfo: any = null;
  try {
    // 输出连接信息，但排除可能的敏感信息
    console.log('收到SSH连接请求:', 
      connectionInfo ? 
      `${connectionInfo.name || 'unnamed'}@${connectionInfo.host || 'unknown'}:${connectionInfo.port || 'unknown'}` : 
      '无效连接信息');
    
    // 首先对整个对象进行序列化和反序列化，确保没有非JSON类型数据
    // 这可以排除所有无法序列化的数据类型
    let safeConnectionInfo: any;
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
        name: (connectionInfo?.name as string) || '未命名连接',
        host: (connectionInfo?.host as string) || '',
        port: (connectionInfo?.port as number) || 22,
        username: (connectionInfo?.username as string) || '',
        password: (connectionInfo?.password as string) || '',
        privateKey: (connectionInfo?.privateKey as string) || ''
      });
      safeConnectionInfo = JSON.parse(connectionStr);
      
      console.log('连接信息预处理成功');
    } catch (e: unknown) {
      const serializeError = e as Error;
      console.error('连接信息序列化失败:', serializeError);
      console.log('原始连接信息:', originalInfo ? 
        `${originalInfo.name || 'unnamed'}@${originalInfo.host || 'unknown'}:${originalInfo.port || 'unknown'}` : 
        '无效连接信息');
      return { success: false, error: '连接信息处理失败: ' + serializeError.message };
    }
    
    // 安全地提取必要属性，使用空字符串或默认值防止undefined
    const id = safeConnectionInfo.id || `conn_${Date.now()}`;
    const host = safeConnectionInfo.host || '';
    const port = safeConnectionInfo.port || 22;
    const username = safeConnectionInfo.username || '';
    const password = safeConnectionInfo.password || '';
    const privateKey = safeConnectionInfo.privateKey || '';
    
    // 验证必要属性
    if (!host) {
      return { success: false, error: '连接信息不完整: 缺少主机地址' };
    }
    
    if (!username) {
      return { success: false, error: '连接信息不完整: 缺少用户名' };
    }
    
    if (!password && !privateKey) {
      return { success: false, error: '连接信息不完整: 需要密码或私钥' };
    }
    
    // 检查是否已经有活动连接
    if (activeConnections.has(id)) {
      console.log('连接已存在，复用现有连接:', id);
      return { success: true, id };
    }
    
    // 创建新的SSH连接
    const conn = new Client();
    
    // 返回一个Promise，等待连接完成或失败
    return new Promise(async (resolve, reject) => {
      try {
        // 准备连接配置
        const connectConfig: any = {
          host,
          port,
          username,
          readyTimeout: 10000, // 10秒超时
        };
        
        // 添加认证方式
        if (privateKey) {
          console.log('使用私钥认证');
          connectConfig.privateKey = privateKey;
        } else if (password) {
          console.log('使用密码认证');
          connectConfig.password = password;
        }
        
        // 设置事件处理器
        conn.on('ready', async () => {
          console.log(`SSH连接 ${id} 已就绪`);
          
          try {
            // 创建SFTP连接
            const sftp = new SftpClient()
            
            // 设置更长的超时时间
            const sftpConfig = {
              host: connectionInfo.host,
              port: connectionInfo.port,
              username: connectionInfo.username,
              password: connectionInfo.password,
              privateKey: connectionInfo.privateKey,
              readyTimeout: 20000,
              retries: 3,
              retry_factor: 2,
              retry_minTimeout: 2000
            }
            
            console.log('开始SFTP连接...')
            await sftp.connect(sftpConfig)
            console.log('SFTP连接成功')

            // 存储连接对象
            activeConnections.set(id, {
              connection: conn,
              shells: new Map()
            });
            
            // 存储SFTP连接
            activeSftpConnections.set(id, sftp)
            console.log('已存储SFTP连接，ID:', id)
            console.log('当前活动SFTP连接数:', activeSftpConnections.size)

            // 验证SFTP连接是否可用
            try {
              console.log('测试SFTP连接...')
              // 直接调用list方法但不存储结果到未使用变量
              await sftp.list('/')
              console.log('SFTP连接测试成功，可以列出根目录')
              
              // 只有在SFTP连接测试成功后才返回成功
              resolve({ success: true, id });
            } catch (testError: any) {
              console.error('SFTP连接测试失败:', testError)
              // 清理SFTP连接
              try {
                await sftp.end()
                activeSftpConnections.delete(id)
              } catch (cleanupError) {
                console.error('清理SFTP连接失败:', cleanupError)
              }
              resolve({ 
                success: true, 
                id,
                warning: `SFTP连接失败: ${testError.message || '未知错误'}`
              });
            }
          } catch (error: any) {
            console.error('SFTP连接失败:', error);
            // 即使SFTP连接失败，我们仍然保持SSH连接
            activeConnections.set(id, {
              connection: conn,
              shells: new Map()
            });
            resolve({ 
              success: true, 
              id,
              warning: `SFTP连接失败: ${error.message || '未知错误'}`
            });
          }
        });
        
        conn.on('error', (err) => {
          console.error(`SSH连接 ${id} 错误:`, err);
          reject({ success: false, error: err.message || '连接错误' });
        });
        
        conn.on('timeout', () => {
          console.error(`SSH连接 ${id} 超时`);
          reject({ success: false, error: '连接超时' });
        });
        
        conn.on('close', (hadError) => {
          console.log(`SSH连接 ${id} 关闭${hadError ? '(有错误)' : ''}`);
          if (hadError) {
            reject({ success: false, error: '连接被关闭(有错误)' });
          }
        });
        
        // 开始连接
        console.log(`开始连接到 ${host}:${port}`);
        conn.connect(connectConfig);
      } catch (e: unknown) {
        const connError = e as Error;
        console.error('启动SSH连接过程时出错:', connError);
        reject({ success: false, error: '启动连接失败: ' + connError.message });
      }
    }).catch(error => {
      console.error('SSH连接Promise处理失败:', error);
      return { success: false, error: error.error || error.message || '未知连接错误' };
    });
  } catch (error: any) {
    console.error('SSH/SFTP连接失败:', error);
    return { success: false, error: error.message };
  }
})

// 创建Shell会话
ipcMain.handle('ssh:shell', async (_, { connectionId, cols, rows }) => {
  try {
    const connInfo = activeConnections.get(connectionId)
    if (!connInfo) {
      return { success: false, error: '连接不存在' }
    }
    
    const shellId = Date.now().toString()
    
    return new Promise((resolve, reject) => {
      connInfo.connection.shell({ term: 'xterm-256color', cols, rows }, (err, stream) => {
        if (err) {
          console.error('创建Shell失败:', err)
          reject({ success: false, error: err.message })
          return
        }
        
        // 存储Shell流
        connInfo.shells.set(shellId, stream)
        
        // 设置数据接收事件
        stream.on('data', (data) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ssh:data', { connectionId, shellId, data: data.toString() })
          }
        })
        
        stream.on('close', () => {
          console.log(`Shell ${shellId} 关闭`)
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('ssh:close', { connectionId, shellId })
          }
          connInfo.shells.delete(shellId)
        })
        
        resolve({ success: true, shellId })
      })
    })
  } catch (error: any) {
    console.error('创建Shell失败:', error)
    return { success: false, error: error.message || '创建Shell失败' }
  }
})

// SSH输入数据处理
ipcMain.on('ssh:input', (_, { connectionId, shellId, data }) => {
  try {
    const connInfo = activeConnections.get(connectionId)
    if (!connInfo) {
      console.error('连接不存在:', connectionId)
      return
    }
    
    const stream = connInfo.shells.get(shellId)
    if (!stream) {
      console.error('Shell不存在:', shellId)
      return
    }
    
    // 向SSH流写入数据
    stream.write(data)
  } catch (error) {
    console.error('发送数据失败:', error)
  }
})

// SSH调整窗口大小
ipcMain.on('ssh:resize', (_, { connectionId, shellId, cols, rows }) => {
  try {
    const connInfo = activeConnections.get(connectionId)
    if (!connInfo) return
    
    const stream = connInfo.shells.get(shellId)
    if (!stream) return
    
    // 调整终端大小
    stream.setWindow(rows, cols)
  } catch (error) {
    console.error('调整终端大小失败:', error)
  }
})

// 关闭Shell
ipcMain.on('ssh:close-shell', (_, { connectionId, shellId }) => {
  try {
    const connInfo = activeConnections.get(connectionId)
    if (!connInfo) return
    
    const stream = connInfo.shells.get(shellId)
    if (stream) {
      // 关闭流
      stream.end()
      connInfo.shells.delete(shellId)
    }
  } catch (error) {
    console.error('关闭Shell失败:', error)
  }
})

// 关闭连接
ipcMain.on('ssh:disconnect', (_, { connectionId }) => {
  (async () => {
    try {
      // 断开SFTP连接
      const sftp = activeSftpConnections.get(connectionId)
      if (sftp) {
        await sftp.end()
        activeSftpConnections.delete(connectionId)
      }

      const connInfo = activeConnections.get(connectionId)
      if (!connInfo) return
      
      // 关闭所有Shell
      for (const stream of connInfo.shells.values()) {
        stream.end()
      }
      
      // 关闭连接
      connInfo.connection.end()
      activeConnections.delete(connectionId)
      console.log(`SSH连接 ${connectionId} 已关闭`)
    } catch (error) {
      console.error('断开连接失败:', error)
    }
  })()
})

//==============================
// 终端相关函数
//==============================

// 启动Windows Terminal（作为独立进程）
function launchWindowsTerminal() {
  if (process.platform === 'win32') {
    try {
      const { spawn } = require('child_process')
      // 尝试启动Windows Terminal
      spawn('wt.exe', [], {
        detached: true,
        stdio: 'ignore',
        shell: true
      }).unref()
      console.log('已启动Windows Terminal')
      return true
    } catch (error) {
      console.error('启动Windows Terminal失败:', error)
      return false
    }
  }
  return false
}

// 为存储本地终端进程添加映射
const localTerminals = new Map<string, {
  pty: any,
  dataCallback?: (data: { id: string; data: string }) => void
}>()

// 创建本地终端（集成到应用程序内）
async function createLocalTerminal(options: { cols: number; rows: number }): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const { cols, rows } = options
    // 使用更独特的ID，确保每次创建都是唯一的
    const id = `term_${Date.now()}_${Math.floor(Math.random() * 10000)}`
    
    console.log(`创建新本地终端会话，ID: ${id}, 列: ${cols}, 行: ${rows}`)
    console.log(`当前活跃终端数量: ${localTerminals.size}`)
    
    // 确定要使用的Shell
    let shell: string
    let args: string[] = []
    
    // Windows特殊处理
    if (process.platform === 'win32') {
      shell = 'powershell.exe'
      // 检查用户是否想使用Windows Terminal而不是集成终端
      if (process.env.USE_EXTERNAL_TERMINAL === 'true') {
        if (launchWindowsTerminal()) {
          return { success: false, error: '已启动外部Windows Terminal' }
        }
      }
    } else {
      // Linux/Mac使用标准shell
      shell = process.env.SHELL || '/bin/bash'
      args = ['-l'] // 作为登录shell启动
    }
    
    console.log(`启动本地终端[${id}]: ${shell}`)
    
    // 创建伪终端
    const terminalProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: process.env.HOME || process.env.USERPROFILE,
      env: { ...process.env, TERM: 'xterm-256color' }
    })
    
    // 存储终端实例
    localTerminals.set(id, {
      pty: terminalProcess
    })
    
    console.log(`本地终端 ${id} 已创建，当前活跃终端数量: ${localTerminals.size}`)
    console.log(`当前所有终端ID: ${Array.from(localTerminals.keys()).join(', ')}`)
    
    return { success: true, id }
  } catch (error: any) {
    console.error('创建本地终端失败:', error)
    return { success: false, error: error.message || '创建终端失败' }
  }
}

// 向终端发送输入
function sendTerminalInput(options: { id: string; data: string }): void {
  const { id, data } = options
  
  if (localTerminals.has(id)) {
    const terminal = localTerminals.get(id)
    if (terminal && terminal.pty) {
      terminal.pty.write(data)
    }
  }
}

// 调整终端大小
function resizeTerminal(options: { id: string; cols: number; rows: number }): void {
  const { id, cols, rows } = options
  
  if (localTerminals.has(id)) {
    const terminal = localTerminals.get(id)
    if (terminal && terminal.pty) {
      try {
        terminal.pty.resize(cols, rows)
      } catch (error) {
        console.error('调整终端大小失败:', error)
      }
    }
  }
}

// 关闭终端
function closeTerminal(options: { id: string }): void {
  const { id } = options
  
  console.log(`准备关闭本地终端，ID: ${id}`)
  
  if (localTerminals.has(id)) {
    const terminal = localTerminals.get(id)
    if (terminal && terminal.pty) {
      try {
        terminal.pty.kill()
        console.log(`本地终端 ${id} 已关闭`)
      } catch (error) {
        console.error('关闭终端失败:', error)
      } finally {
        localTerminals.delete(id)
        console.log(`终端 ${id} 已从列表中移除，剩余终端数量: ${localTerminals.size}`)
      }
    }
  } else {
    console.log(`找不到终端 ${id}，可能已被关闭`)
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
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      nodeIntegration: true,
      contextIsolation: true,
      backgroundThrottling: false // 禁用后台节流，使应用在后台也能正常运行
    }
  })

  if (mainWindow) {
    mainWindow.on('ready-to-show', () => {
      mainWindow?.show()
    })

    // 处理窗口失焦和获得焦点事件
    mainWindow.on('blur', () => {
      console.log('窗口失去焦点，但应用继续在后台运行')
      // 通知渲染进程窗口状态变化
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:state-change', { isFocused: false })
      }
    })

    mainWindow.on('focus', () => {
      console.log('窗口获得焦点')
      // 通知渲染进程窗口状态变化
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('window:state-change', { isFocused: true })
      }
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })
  }

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow?.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow?.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 确保连接配置文件已初始化并有效
  console.log('应用启动，初始化连接配置文件')
  
  // 检查文件是否存在
  if (fs.existsSync(connectionsFilePath)) {
    console.log('配置文件已存在:', connectionsFilePath)
  } else {
    console.log('配置文件不存在，将创建空配置')
    // 创建空的配置文件
    saveConnections([])
  }
  
  // 设置IPC处理程序
  function setupIPCHandlers() {
    // 系统信息
    ipcMain.handle('get-system-info', async () => {
      return await getSystemInfo()
    })
    
    // 加载连接
    ipcMain.handle('load-connections', async () => {
      return loadConnections()
    })
    
    // 保存连接
    ipcMain.handle('save-connections', async (_event, organizations) => {
      try {
        saveConnections(organizations)
        return { success: true }
      } catch (error: any) {
        console.error('保存连接失败:', error)
        return { success: false, error: error.message || '保存失败' }
      }
    })
    
    // 启动Windows Terminal
    ipcMain.handle('launch-windows-terminal', async () => {
      return { success: launchWindowsTerminal() }
    })
    
    // 打开文件选择对话框
    ipcMain.handle('open-file-dialog', async (_event, options) => {
      try {
        const { dialog } = require('electron')
        const result = await dialog.showOpenDialog({
          properties: options?.properties || ['openFile'],
          filters: options?.filters || [
            { name: '所有文件', extensions: ['*'] }
          ],
          title: options?.title || '选择文件',
          buttonLabel: options?.buttonLabel || '选择',
          defaultPath: options?.defaultPath || app.getPath('home')
        })
        
        if (result.canceled || result.filePaths.length === 0) {
          return { canceled: true }
        }
        
        // 如果是选择私钥文件，则需要读取文件内容
        if (!options?.properties?.includes('multiSelections')) {
          const filePath = result.filePaths[0]
          try {
            const fileContent = fs.readFileSync(filePath, 'utf-8')
            return {
              canceled: false,
              filePath,
              fileContent
            }
          } catch (readError: any) {
            return {
              canceled: false,
              filePath,
              error: `无法读取文件内容: ${readError.message}`
            }
          }
        }
        
        // 对于多选或普通文件，只返回文件路径
        return {
          canceled: false,
          filePath: result.filePaths[0],
          filePaths: result.filePaths
        }
      } catch (error: any) {
        console.error('打开文件对话框失败:', error)
        return { canceled: true, error: error.message }
      }
    })

    // SFTP相关处理程序
    ipcMain.handle('sftp:readDir', async (_, { connectionId, path }) => {
      try {
        console.log('尝试读取目录，连接ID:', connectionId)
        console.log('当前活动SFTP连接:', Array.from(activeSftpConnections.keys()))
        
        const sftp = activeSftpConnections.get(connectionId)
        if (!sftp) {
          console.error('SFTP连接不存在，ID:', connectionId)
          return { success: false, error: 'SFTP连接不存在' }
        }

        console.log('开始读取目录:', path)
        const list = await sftp.list(path)
        console.log('目录读取成功，文件数量:', list.length)

        const files = list.map(item => ({
          name: item.name,
          type: item.type === 'd' ? 'directory' : 'file',
          size: item.size,
          modifyTime: item.modifyTime,
          permissions: item.rights.user + item.rights.group + item.rights.other,
          owner: item.owner,
          group: item.group
        }))

        return { success: true, files }
      } catch (error: any) {
        console.error('读取目录失败:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sftp:downloadFile', async (_, { connectionId, remotePath }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId)
        if (!sftp) {
          return { success: false, error: 'SFTP连接不存在' }
        }

        // 打开保存文件对话框
        const { dialog } = require('electron')
        const result = await dialog.showSaveDialog({
          defaultPath: path.basename(remotePath)
        })

        if (result.canceled || !result.filePath) {
          return { success: false, error: '用户取消下载' }
        }

        // 创建唯一的传输ID
        const downloadId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        
        // 获取文件信息以获取大小
        const stats = await sftp.stat(remotePath);
        const fileSize = stats.size;
        
        // 发送开始传输事件
        if (mainWindow) {
          mainWindow.webContents.send('sftp:transferStart', {
            id: downloadId,
            type: 'download',
            filename: path.basename(remotePath),
            path: remotePath,
            size: fileSize,
            connectionId
          });
        }

        // 使用stream进行传输并跟踪进度
        const readStream = await sftp.createReadStream(remotePath);
        const writeStream = fs.createWriteStream(result.filePath);
        
        let transferred = 0;
        
        readStream.on('data', (chunk) => {
          transferred += chunk.length;
          
          // 发送进度更新
          if (mainWindow && fileSize > 0) {
            mainWindow.webContents.send('file-download-progress', {
              id: downloadId,
              transferred,
              progress: Math.min(100, Math.round((transferred / fileSize) * 100))
            });
          }
        });
        
        // 存储传输任务信息
        activeTransfers.set(downloadId, { 
          readStream, 
          writeStream, 
          connectionId 
        });

        // 返回Promise，在stream结束或出错时解析
        return new Promise((resolve, reject) => {
          writeStream.on('finish', () => {
            // 发送完成事件
            if (mainWindow) {
              mainWindow.webContents.send('sftp:transferComplete', {
                id: downloadId,
                success: true
              });
            }
            
            // 移除传输任务
            activeTransfers.delete(downloadId);
            
            resolve({ success: true, transferId: downloadId });
          });
          
          writeStream.on('error', (err) => {
            // 发送错误事件
            if (mainWindow) {
              mainWindow.webContents.send('sftp:transferError', {
                id: downloadId,
                error: err.message
              });
            }
            
            reject(err);
          });
          
          readStream.pipe(writeStream);
        });
      } catch (error: any) {
        console.error('下载文件失败:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sftp:uploadFile', async (_, { connectionId, localPath, remotePath }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId)
        if (!sftp) {
          return { success: false, error: 'SFTP连接不存在' }
        }

        const fileName = path.basename(localPath)
        const remoteFilePath = remotePath === '/' ? `/${fileName}` : `${remotePath}/${fileName}`
        
        // 创建唯一的传输ID
        const uploadId = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        
        // 获取文件信息以获取大小
        const stats = fs.statSync(localPath);
        const fileSize = stats.size;
        
        // 发送开始传输事件
        if (mainWindow) {
          mainWindow.webContents.send('sftp:transferStart', {
            id: uploadId,
            type: 'upload',
            filename: fileName,
            path: localPath,
            size: fileSize,
            connectionId
          });
        }

        // 使用stream进行传输并跟踪进度
        const readStream = fs.createReadStream(localPath);
        const writeStream = await sftp.createWriteStream(remoteFilePath);
        
        let transferred = 0;
        
        readStream.on('data', (chunk) => {
          transferred += chunk.length;
          
          // 发送进度更新
          if (mainWindow) {
            mainWindow.webContents.send('sftp:transferProgress', {
              id: uploadId,
              transferred,
              progress: Math.min(100, Math.round((transferred / fileSize) * 100))
            });
          }
        });
        
        // 存储传输任务信息
        activeTransfers.set(uploadId, { 
          readStream, 
          writeStream, 
          connectionId 
        });

        // 返回Promise，在stream结束或出错时解析
        return new Promise((resolve, reject) => {
          writeStream.on('finish', () => {
            // 发送完成事件
            if (mainWindow) {
              mainWindow.webContents.send('sftp:transferComplete', {
                id: uploadId,
                success: true
              });
            }
            
            // 移除传输任务
            activeTransfers.delete(uploadId);
            
            resolve({ success: true, transferId: uploadId });
          });
          
          writeStream.on('error', (err) => {
            // 发送错误事件
            if (mainWindow) {
              mainWindow.webContents.send('sftp:transferError', {
                id: uploadId,
                error: err.message
              });
            }
            
            reject(err);
          });
          
          readStream.pipe(writeStream);
        });
      } catch (error: any) {
        console.error('上传文件失败:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sftp:mkdir', async (_, { connectionId, path }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId)
        if (!sftp) {
          return { success: false, error: 'SFTP连接不存在' }
        }

        await sftp.mkdir(path)
        return { success: true }
      } catch (error: any) {
        console.error('创建目录失败:', error)
        return { success: false, error: error.message }
      }
    })

    ipcMain.handle('sftp:delete', async (_, { connectionId, path }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId)
        if (!sftp) {
          return { success: false, error: 'SFTP连接不存在' }
        }

        // 先检查是文件还是目录
        const stat = await sftp.stat(path)
        if (stat.isDirectory) {
          await sftp.rmdir(path, true) // true表示递归删除
        } else {
          await sftp.delete(path)
        }
        return { success: true }
      } catch (error: any) {
        console.error('删除失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取文件或文件夹的详细信息
    ipcMain.handle('sftp:getFileInfo', async (_, { connectionId, path }) => {
      try {
        const sftp = activeSftpConnections.get(connectionId)
        if (!sftp) {
          return { success: false, error: 'SFTP连接不存在' }
        }

        // 获取文件/文件夹的基本信息
        const stat = await sftp.stat(path)
        
        // 构建详细信息对象
        const fileInfo: {
          name: string;
          path: string;
          type: string;
          size: number;
          modifyTime: Date;
          accessTime: Date;
          rights: any;
          owner: string | number;
          group: string | number;
          isSymbolicLink: boolean;
          items?: number;
        } = {
          name: path.split('/').pop() || path,
          path: path,
          type: stat.isDirectory ? 'directory' : 'file',
          size: stat.size,
          modifyTime: stat.modifyTime,
          accessTime: stat.accessTime,
          rights: stat.rights,
          owner: stat.uid,
          group: stat.gid,
          isSymbolicLink: stat.isSymbolicLink
        }
        
        // 如果是文件夹，尝试获取子项数量
        if (stat.isDirectory) {
          try {
            const list = await sftp.list(path)
            fileInfo.items = list.length
          } catch (err) {
            fileInfo.items = 0
          }
        }
        
        return { success: true, fileInfo }
      } catch (error: any) {
        console.error('获取文件信息失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 添加取消传输的IPC处理函数
    ipcMain.handle('sftp:cancelTransfer', async (_, { transferId }) => {
      try {
        const transfer = activeTransfers.get(transferId);
        if (!transfer) {
          return { success: false, error: '传输任务不存在或已完成' };
        }

        // 关闭流
        if (transfer.readStream) {
          transfer.readStream.destroy();
        }
        if (transfer.writeStream) {
          transfer.writeStream.destroy();
        }

        // 从活跃传输列表中移除
        activeTransfers.delete(transferId);

        // 发送取消事件
        if (mainWindow) {
          mainWindow.webContents.send('sftp:transferCancelled', {
            id: transferId
          });
        }

        return { success: true };
      } catch (error: any) {
        console.error('取消传输失败:', error);
        return { success: false, error: error.message };
      }
    });

    // AI聊天历史记录处理
    ipcMain.handle('chat:load-history', async () => {
      return loadChatHistory()
    })
    
    ipcMain.handle('chat:save-session', async (_event, session) => {
      return saveChatSession(session)
    })
    
    ipcMain.handle('chat:delete-session', async (_event, sessionId) => {
      return deleteHistorySession(sessionId)
    })

    // 获取lexer规则文件内容
    ipcMain.handle('get-lexer-file', async (_, lexerName) => {
      try {
        const filePath = getLexerFilePath(lexerName);
        
        // 检查文件是否存在
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf8');
          return { success: true, content };
        } else {
          console.warn(`Lexer文件不存在: ${filePath}`);
          return { success: false, error: 'Lexer文件不存在' };
        }
      } catch (error: any) {
        console.error('获取Lexer文件失败:', error);
        return { success: false, error: error.message || '未知错误' };
      }
    });

    // 执行SSH命令
    ipcMain.handle('ssh:exec', async (_, { connectionId, command }) => {
      try {
        const connInfo = activeConnections.get(connectionId)
        if (!connInfo) {
          return { success: false, error: '连接不存在' }
        }

        return new Promise((resolve, reject) => {
          connInfo.connection.exec(command, (err, stream) => {
            if (err) {
              console.error('执行SSH命令失败:', err)
              reject({ success: false, error: err.message })
              return
            }

            let output = ''
            let errorOutput = ''

            stream.on('data', (data) => {
              output += data.toString()
            })

            stream.stderr.on('data', (data) => {
              errorOutput += data.toString()
            })

            stream.on('close', () => {
              if (errorOutput) {
                resolve({ success: false, error: errorOutput })
              } else {
                resolve({ success: true, output })
              }
            })
          })
        })
      } catch (error: any) {
        console.error('执行SSH命令失败:', error)
        return { success: false, error: error.message || '执行命令失败' }
      }
    })
  }
  
  setupIPCHandlers()

  // 本地终端IPC处理
  ipcMain.handle('terminal:create', async (_, options) => {
    console.log('收到创建本地终端请求，参数:', options)
    const result = await createLocalTerminal(options)
    
    if (result.success && result.id) {
      // 设置数据接收回调
      console.log(`为终端 ${result.id} 设置数据回调...`)
      const terminalInfo = localTerminals.get(result.id)
      if (terminalInfo && terminalInfo.pty) {
        terminalInfo.pty.onData((data: string) => {
          // 使用主窗口实例而不是获取当前焦点窗口
          if (mainWindow && !mainWindow.isDestroyed()) {
            // 发送数据到渲染进程
            mainWindow.webContents.send('terminal:data', { 
              id: result.id, 
              data 
            })
            // 调试输出数据流向
            if (process.env.NODE_ENV === 'development') {
              const shortData = data.length > 20 ? data.substring(0, 20) + '...' : data
              console.log(`终端[${result.id}]发送数据: ${shortData.replace(/\n/g, '\\n')}`)
            }
          } else {
            console.log(`终端[${result.id}]数据无法发送：主窗口不可用`)
          }
        })
        
        console.log(`为终端 ${result.id} 设置了数据回调，准备返回结果`)
      } else {
        console.error(`无法为终端 ${result.id} 设置数据回调：找不到终端信息`)
      }
    } else {
      console.error('创建终端失败:', result.error)
    }
    
    return result
  })
  
  ipcMain.on('terminal:input', (_, options) => {
    const { id } = options; // 只解构我们实际使用的id变量
    console.log(`接收到终端[${id}]输入请求`);
    sendTerminalInput(options);
  })
  
  ipcMain.on('terminal:resize', (_, options) => {
    const { id, cols, rows } = options
    console.log(`接收到终端[${id}]调整大小请求: ${cols}x${rows}`)
    resizeTerminal(options)
  })
  
  ipcMain.on('terminal:close', (_, options) => {
    const { id } = options
    console.log(`接收到终端[${id}]关闭请求`)
    closeTerminal(options)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// 加载全局设置
function loadSettings(): any {
  try {
    // 首先检查文件是否存在
    if (fs.existsSync(settingsPath)) {
      const fileContent = fs.readFileSync(settingsPath, 'utf-8')
      // 如果文件存在但为空或内容无效，返回默认设置
      if (!fileContent.trim()) {
        console.log('设置文件存在但为空，返回默认设置')
        return getDefaultSettings()
      }
      
      try {
        const parsed = JSON.parse(fileContent)
        console.log('成功加载设置文件')
        
        // 处理数组格式的配置文件
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log('检测到数组格式的设置文件，使用第一个元素')
          return parsed[0]
        }
        
        return parsed
      } catch (parseError) {
        console.error('解析设置文件失败:', parseError)
        return getDefaultSettings()
      }
    } else {
      // 文件不存在的情况，创建一个包含默认设置的新文件
      console.log('设置文件不存在，创建默认设置文件')
      const defaultSettings = getDefaultSettings()
      
      try {
        // 确保目录存在
        const dirPath = path.dirname(settingsPath)
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true })
        }
        
        // 写入默认设置 - 保持数组格式与现有config.json一致
        fs.writeFileSync(settingsPath, JSON.stringify([defaultSettings], null, 2), 'utf-8')
        console.log('已创建默认设置文件:', settingsPath)
      } catch (writeError) {
        console.error('创建默认设置文件失败:', writeError)
      }
      
      return defaultSettings
    }
  } catch (error) {
    console.error('加载设置时发生错误:', error)
    return getDefaultSettings()
  }
}

// 保存全局设置
function saveSettings(settings: any): boolean {
  try {
    // 确保设置对象格式正确
    if (!settings || typeof settings !== 'object') {
      console.error('保存设置失败: 无效的设置对象', settings)
      return false
    }
    
    // 提取仅需的属性，避免序列化复杂对象可能引起的问题
    const cleanSettings = {
      language: settings.language || 'zh-CN',
      fontSize: settings.fontSize || 14,
      fontFamily: settings.fontFamily || 'system-ui',
      terminalFontFamily: settings.terminalFontFamily || 'Consolas, "Courier New", monospace',
      terminalFontSize: settings.terminalFontSize || 14
    }
    
    const dirPath = path.dirname(settingsPath)
    
    // 确保目录存在
    if (!fs.existsSync(dirPath)) {
      console.log('创建设置目录:', dirPath)
      fs.mkdirSync(dirPath, { recursive: true })
    }
    
    // 在开发环境中，额外打印路径信息
    console.log('保存设置到:', settingsPath)
    console.log('设置内容:', JSON.stringify(cleanSettings))
    
    // 始终使用数组格式保存，以保持与config.json格式一致
    const jsonContent = JSON.stringify([cleanSettings], null, 2)
    
    // 以同步方式写入文件
    fs.writeFileSync(settingsPath, jsonContent, { encoding: 'utf-8', flag: 'w' })
    
    console.log('设置保存成功')
    
    // 通知所有窗口设置已更改
    if (mainWindow) {
      mainWindow.webContents.send('settings-saved', cleanSettings)
    }
    
    return true
  } catch (error) {
    console.error('保存设置失败:', error)
    return false
  }
}

// 获取默认设置
function getDefaultSettings(): any {
  return {
    language: 'zh-CN',
    fontSize: 14,
    fontFamily: 'system-ui',
    terminalFontFamily: 'Consolas, "Courier New", monospace',
    terminalFontSize: 14
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.

// 加载设置
ipcMain.handle('load-settings', async () => {
  try {
    return loadSettings()
  } catch (error) {
    console.error('通过IPC加载设置失败:', error)
    throw error
  }
})

// 保存设置
ipcMain.handle('save-settings', async (_event, settings) => {
  try {
    console.log('收到保存设置请求:', settings)
    
    // 确保settings对象只包含需要的属性
    const cleanSettings = {
      language: settings.language || 'zh-CN',
      fontSize: settings.fontSize || 14,
      fontFamily: settings.fontFamily || 'system-ui',
      terminalFontFamily: settings.terminalFontFamily || 'Consolas, "Courier New", monospace',
      terminalFontSize: settings.terminalFontSize || 14
    }
    
    const success = saveSettings(cleanSettings)
    
    if (success) {
      console.log('保存成功，准备通知所有窗口')
      // 通知所有窗口更新设置
      const windows = BrowserWindow.getAllWindows()
      console.log(`正在向 ${windows.length} 个窗口广播设置更新`)
      
      windows.forEach(win => {
        if (!win.isDestroyed()) {
          console.log(`向窗口 ${win.id} 发送设置更新通知`)
          win.webContents.send('settings-saved', cleanSettings)
        }
      })
      
      console.log('设置更新通知已发送')
    } else {
      console.error('保存设置失败')
    }
    
    return success
  } catch (error) {
    console.error('通过IPC保存设置失败:', error)
    throw error
  }
})

// 获取应用程序的根目录
function getAppPath() {
  // 开发环境下，使用当前目录
  if (is.dev) {
    return process.cwd();
  }
  
  // 生产环境下，使用应用程序目录
  return path.dirname(app.getPath('exe'));
}

// 获取lexer规则文件路径
function getLexerFilePath(lexerName: string) {
  // 构建文件路径
  const rootPath = getAppPath();
  const devPath = path.join(rootPath, 'src', 'renderer', 'src', 'rules', `${lexerName}.lexer`);
  const prodPath = path.join(rootPath, 'resources', 'rules', `${lexerName}.lexer`);
  
  // 开发环境和生产环境使用不同路径
  return is.dev ? devPath : prodPath;
}
