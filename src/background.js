'use strict'

import { app, protocol, BrowserWindow, dialog, Menu, ipcMain } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import { initialize, enable } from '@electron/remote/main'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { execSync } from 'child_process'

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

// 获取resources目录路径
const resourcesPath = process.env.NODE_ENV === 'development' 
  ? path.join(__dirname, '../backend/dist/service') 
  : path.join(process.resourcesPath)

// 配置文件路径
const configPath = path.join(resourcesPath, 'config.json')
// 日志文件路径
const logPath = path.join(resourcesPath, 'sftp_log.log')

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
      executable: path.join(process.resourcesPath, 'service.exe'),
      args: [],
      cwd: process.resourcesPath
    }
  }
}

// 启动后端服务
function startBackend() {
  try {
    const { executable, args, cwd } = getBackendPath()
    
    console.log('Starting backend process:', executable)
    console.log('Backend args:', args)
    console.log('Working directory:', cwd)

    if (!isDevelopment && !fs.existsSync(executable)) {
      throw new Error(`Backend executable not found at: ${executable}`)
    }

    // 终止已存在的后端进程
    if (backendProcess) {
      cleanupBackend()
    }

    // 启动后端进程
    backendProcess = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      cwd: cwd,
      windowsHide: true,
      env: {
        ...process.env,
        CONFIG_PATH: configPath,
        LOG_PATH: logPath
      }
    })

    // 添加进程事件处理
    backendProcess.on('error', (err) => {
      console.error('Failed to start backend process:', err)
      dialog.showErrorBox('Backend Error', `Failed to start backend service: ${err.message}`)
    })

    backendProcess.on('close', (code, signal) => {
      console.log(`Backend process exited with code ${code} (signal: ${signal})`)
      backendProcess = null
    })

    // 添加标准输出和错误输出的处理
    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend stdout: ${data}`)
    })

    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend stderr: ${data}`)
    })

    return true
  } catch (error) {
    console.error('Error in startBackend:', error)
    dialog.showErrorBox('Backend Error', `Failed to start backend service: ${error.message}`)
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
      // 在 Windows 上使用 taskkill 确保子进程被终止
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /pid ${backendProcess.pid} /T /F`, { windowsHide: true })
        } catch (e) {
          console.error('Error killing process with taskkill:', e)
          // 如果 taskkill 失败，尝试使用 process.kill
          process.kill(backendProcess.pid)
        }
      } else {
        process.kill(-backendProcess.pid) // 在 Unix 系统上使用进程组 ID
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
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, '[]', 'utf8')
  }

  // 设置文件监听
  configWatcher = fs.watch(configPath, (eventType) => {
    if (eventType === 'change') {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
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
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        webSecurity: false,
        nodeIntegrationInWorker: true,
        preload: path.join(__dirname, 'preload.js')
      }
    })

    require("@electron/remote/main").enable(mainWindow.webContents)

    if (process.env.WEBPACK_DEV_SERVER_URL) {
      // 开发环境
      await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
      if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
    } else {
      // 生产环境
      try {
        // 修改这里的路径处理
        const indexPath = isDevelopment
          ? path.join(__dirname, '../dist/index.html')
          : path.join(process.resourcesPath, 'app.asar/dist/index.html')

        console.log('Loading index.html from:', indexPath)
        
        if (!fs.existsSync(indexPath)) {
          throw new Error(`index.html not found at ${indexPath}`)
        }

        // 使用 loadFile 加载
        await mainWindow.loadFile(indexPath)
        
        // 显示窗口
        mainWindow.show()
      } catch (error) {
        console.error('Failed to load app:', error)
        console.error('Current directory:', __dirname)
        console.error('Resource path:', process.resourcesPath)
        dialog.showErrorBox('Loading Error', `Failed to load app: ${error.message}`)
      }
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
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('before-quit', () => {
    cleanupBackend()
  })

  app.on('will-quit', () => {
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

      // 创建协议
      if (!process.env.WEBPACK_DEV_SERVER_URL) {
        createProtocol('app')
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

// 理 IPC 消息
ipcMain.handle('read-config', async () => {
  try {
    const config = fs.readFileSync(configPath, 'utf8')
    return JSON.parse(config)
  } catch (error) {
    console.error('Error reading config:', error)
    return []
  }
})

ipcMain.handle('save-config', async (event, config) => {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
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

app.on('will-quit', () => {
  cleanupBackend()
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
