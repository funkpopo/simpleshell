'use strict'

import { app, protocol, BrowserWindow, dialog, Menu, ipcMain } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import { initialize, enable } from '@electron/remote/main'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

initialize()

// 禁用菜单栏
Menu.setApplicationMenu(null)

const isDevelopment = process.env.NODE_ENV !== 'production'

// 禁用硬件加速
app.disableHardwareAcceleration()

let backendProcess = null
let mainWindow = null

// 修改配置文件路径，使用应用程序目录而不是用户数据目录
function getAppDataPath() {
  if (isDevelopment) {
    return path.join(__dirname, '..')
  } else {
    // 使用应用程序所在目录
    return path.dirname(app.getPath('exe'))
  }
}

// 定义配置文件和日志路径
const CONFIG_PATH = path.join(getAppDataPath(), 'config.json')
const LOG_PATH = path.join(getAppDataPath(), 'sftp_log.log')

// 修改临时目录路径
function createTempDir() {
  const tempPath = path.join(getAppDataPath(), 'temp')
  if (!fs.existsSync(tempPath)) {
    fs.mkdirSync(tempPath, { recursive: true })
  }
  return tempPath
}

// 获取后端可执行文件路径
function getBackendPath() {
  if (isDevelopment) {
    return {
      executable: 'python',
      args: [path.join(__dirname, '..', 'backend', 'service.py')],
      cwd: path.join(__dirname, '..')
    }
  } else {
    return {
      executable: path.join(app.getPath('exe'), '..', 'resources', 'service', 'service.exe'),
      args: [],
      cwd: path.join(app.getPath('exe'), '..', 'resources', 'service')
    }
  }
}

// 启动后端服务
function startBackend() {
  try {
    const { executable, args, cwd } = getBackendPath()
    const rootDir = getAppDataPath()
    
    console.log('Starting backend process:', executable)
    console.log('Backend args:', args)
    console.log('Working directory:', cwd)
    console.log('Root directory:', rootDir)

    if (!isDevelopment && !fs.existsSync(executable)) {
      throw new Error(`Backend executable not found at: ${executable}`)
    }

    // 终止已存在的后端进程
    if (backendProcess) {
      try {
        backendProcess.kill()
      } catch (e) {
        console.log('Error killing existing backend process:', e)
      }
    }

    // 创建临时目录
    const tempDir = createTempDir()

    // 确保配置文件存在
    const configPath = path.join(rootDir, 'config.json')
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, '[]', 'utf8')
    }

    // 启动后端进程
    backendProcess = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      cwd: cwd,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        TEMP: tempDir,
        TMP: tempDir,
        CONFIG_PATH: CONFIG_PATH,
        LOG_PATH: LOG_PATH
      }
    })

    // 日志处理
    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend stdout: ${data.toString()}`)
    })

    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend stderr: ${data.toString()}`)
    })

    backendProcess.on('error', (err) => {
      console.error('Failed to start backend process:', err)
    })

    backendProcess.on('close', (code, signal) => {
      console.log(`Backend process exited with code ${code} (signal: ${signal})`)
      
      if (code !== 0 && code !== null) {
        setTimeout(() => {
          console.log('Attempting to restart backend...')
          startBackend()
        }, 1000)
      }
    })

    if (!backendProcess.pid) {
      throw new Error('Failed to get backend process PID')
    }

    return true
  } catch (error) {
    console.error('Error in startBackend:', error)
    return false
  }
}

// 等待后端服务就绪
async function waitForBackend() {
  const maxAttempts = 30
  let attempts = 0

  while (attempts < maxAttempts) {
    try {
      const response = await fetch('http://localhost:5000/health')
      if (response.ok) {
        console.log('Backend is ready')
        return true
      }
    } catch (error) {
      console.log('Waiting for backend...', attempts)
    }
    await new Promise(resolve => setTimeout(resolve, 1000))
    attempts++
  }

  throw new Error('Backend failed to start within 30 seconds')
}

// 清理后端进程
function cleanupBackend() {
  if (backendProcess) {
    try {
      if (process.platform === 'win32') {
        const { execSync } = require('child_process')
        try {
          backendProcess.kill()
          execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { 
            windowsHide: true,
            stdio: 'ignore' 
          })
          execSync('taskkill /F /IM service.exe', { 
            windowsHide: true,
            stdio: 'ignore' 
          })
        } catch (e) {
          console.log('Error during process cleanup:', e)
        }
      } else {
        process.kill(-backendProcess.pid, 'SIGKILL')
      }
    } catch (error) {
      console.error('Error killing backend process:', error)
    } finally {
      backendProcess = null
    }
  }
}

// 监听配置文件变化
let configWatcher = null

function setupConfigWatcher(win) {
  // 确保配置文件存在
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.writeFileSync(CONFIG_PATH, '[]', 'utf8')
  }

  // 设置文件监听
  configWatcher = fs.watch(CONFIG_PATH, (eventType) => {
    if (eventType === 'change') {
      try {
        const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))
        win.webContents.send('config-updated', config)
      } catch (error) {
        console.error('Error reading config file:', error)
      }
    }
  })
}

// 创建主窗
async function createWindow() {
  try {
    const backendStarted = startBackend()
    if (!backendStarted) {
      throw new Error('Failed to start backend service')
    }

    try {
      await waitForBackend()
    } catch (error) {
      console.error('Backend startup timeout:', error)
      dialog.showErrorBox('Backend Error', 'Backend service failed to start in time')
      app.quit()
      return
    }

    mainWindow = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
        contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
        enableRemoteModule: true
      }
    })

    require("@electron/remote/main").enable(mainWindow.webContents)

    if (process.env.WEBPACK_DEV_SERVER_URL) {
      await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
      if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
    } else {
      createProtocol('app')
      mainWindow.loadURL('app://./index.html')
    }

    mainWindow.on('close', (e) => {
      e.preventDefault()
      cleanupBackend()
      mainWindow.destroy()
    })

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    setupConfigWatcher(mainWindow)
  } catch (error) {
    console.error('Error in createWindow:', error)
    dialog.showErrorBox('Application Error', `Failed to start application: ${error.message}`)
    app.quit()
  }
}

// 在文件顶部定义 USER_DATA_PATH
const USER_DATA_PATH = path.join(getAppDataPath(), 'userdata')

// 在 app.requestSingleInstanceLock() 之前添加
// 设置单实例锁文件路径
app.setPath('userData', USER_DATA_PATH)

// 修改获取锁的代码
const gotTheLock = app.requestSingleInstanceLock({
  // 指定锁文件路径
  lockFilePath: path.join(getAppDataPath(), '.lock')
})

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.on('window-all-closed', () => {
    cleanupBackend()
    if (configWatcher) {
      configWatcher.close()
    }
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    cleanupBackend()
    cleanupUserData()
    // 清理锁文件
    const lockFile = path.join(getAppDataPath(), '.lock')
    if (fs.existsSync(lockFile)) {
      try {
        fs.unlinkSync(lockFile)
      } catch (error) {
        console.error('Error cleaning up lock file:', error)
      }
    }
  })

  app.on('before-quit', () => {
    cleanupBackend()
  })

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
  })

  app.on('ready', async () => {
    try {
      // 确保所需目录存在
      ensureDirectories()
      
      // 重定向用户数据目录到应用程序目录
      app.setPath('userData', USER_DATA_PATH)
      app.setPath('sessionData', path.join(USER_DATA_PATH, 'session'))
      app.setPath('temp', path.join(USER_DATA_PATH, 'temp'))
      app.setPath('cache', path.join(USER_DATA_PATH, 'cache'))
      app.setPath('logs', path.join(USER_DATA_PATH, 'logs'))
      
      if (isDevelopment && !process.env.IS_TEST) {
        try {
          await installExtension(VUEJS3_DEVTOOLS)
        } catch (e) {
          console.error('Vue Devtools failed to install:', e.toString())
        }
      }
      
      await createWindow()
    } catch (error) {
      console.error('Error in app ready handler:', error)
      dialog.showErrorBox('Initialization Error', 
        `Failed to initialize application: ${error.message}\n\nPlease ensure the application has write permissions to its directory.`)
      app.quit()
    }
  })
}

// 开发模式下的进程清理
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      app.quit()
    })
  }
}

// 添加更多的进程清理点
process.on('exit', () => {
  cleanupBackend()
})

process.on('SIGINT', () => {
  cleanupBackend()
  process.exit()
})

process.on('SIGTERM', () => {
  cleanupBackend()
  process.exit()
})

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  try {
    cleanupBackend()
    cleanupUserData()
  } catch (cleanupError) {
    console.error('Error during cleanup:', cleanupError)
  }
  dialog.showErrorBox('Unexpected Error', 
    `An unexpected error occurred: ${error.message}\n\nThe application will now close.`)
  process.exit(1)
})

// 处理 IPC 消息
ipcMain.handle('read-config', async () => {
  try {
    const config = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(config)
  } catch (error) {
    console.error('Error reading config:', error)
    return []
  }
})

ipcMain.handle('save-config', async (event, config) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    return true
  } catch (error) {
    console.error('Error saving config:', error)
    return false
  }
})

// 在清理函数中添加用户数据目录的清理
function cleanupUserData() {
  try {
    const tempDir = path.join(USER_DATA_PATH, 'temp')
    if (fs.existsSync(tempDir)) {
      console.log('Cleaning up temp directory:', tempDir)
      fs.rmSync(tempDir, { recursive: true, force: true })
      fs.mkdirSync(tempDir)
      console.log('Temp directory cleaned and recreated')
    }
  } catch (error) {
    console.error('Error cleaning up user data:', error)
    // 不抛出错误，继续执行清理流程
  }
}

// 在现有的清理函数中添加对用户数据的清理
app.on('before-quit', () => {
  cleanupBackend()
  cleanupUserData()
})

// 在应用启动时检查并清理旧的锁文件
const lockFile = path.join(getAppDataPath(), '.lock')
if (fs.existsSync(lockFile)) {
  try {
    fs.unlinkSync(lockFile)
  } catch (error) {
    console.error('Error cleaning up old lock file:', error)
  }
}

// 添加确保目录存在的函数
function ensureDirectories() {
  try {
    const dirs = [
      USER_DATA_PATH,
      path.join(USER_DATA_PATH, 'session'),
      path.join(USER_DATA_PATH, 'temp'),
      path.join(USER_DATA_PATH, 'cache'),
      path.join(USER_DATA_PATH, 'logs')
    ]
    
    dirs.forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
        console.log(`Created directory: ${dir}`)
      }
    })
  } catch (error) {
    console.error('Error ensuring directories:', error)
    throw error
  }
}
