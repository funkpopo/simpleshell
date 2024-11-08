'use strict'

import { app, protocol, BrowserWindow, dialog, Menu, ipcMain } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import installExtension, { VUEJS3_DEVTOOLS } from 'electron-devtools-installer'
import { initialize, enable } from '@electron/remote/main'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

initialize()

const isDevelopment = process.env.NODE_ENV !== 'production'

// 禁用硬件加速
app.disableHardwareAcceleration()

// 设置空菜单
Menu.setApplicationMenu(null)

// Scheme must be registered before the app is ready
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

let backendProcess = null
let mainWindow = null

// 修改获取应用数据路径的函数
function getAppDataPath() {
  if (isDevelopment) {
    // 开发环境下使用 backend 目录
    return path.join(__dirname, '..', 'backend')
  } else {
    // 生产环境使用 resources 目录
    return path.join(process.resourcesPath)
  }
}

// 修改配置文件和日志路径
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

// 修改后端路径获取函数
function getBackendPath() {
  if (isDevelopment) {
    return {
      executable: 'python',
      args: [path.join(__dirname, '..', 'backend', 'service.py')],
      cwd: path.join(__dirname, '..')
    }
  } else {
    // 根据平台返回不同的可执行文件配置
    if (process.platform === 'win32') {
      return {
        executable: path.join(process.resourcesPath, 'service.exe'),
        args: [],
        cwd: process.resourcesPath
      }
    } else {
      // Linux 平台
      return {
        executable: path.join(process.resourcesPath, 'service.py'),
        args: [],
        cwd: process.resourcesPath
      }
    }
  }
}

// 修改后端进程启动函数
function startBackend() {
  try {
    const { executable, args, cwd } = getBackendPath()
    
    console.log('Starting backend process:', executable)
    console.log('Backend args:', args)
    console.log('Working directory:', cwd)

    if (!isDevelopment && !fs.existsSync(executable)) {
      throw new Error(`Backend executable not found at: ${executable}`)
    }

    // Linux 平台设置可执行权限
    if (!isDevelopment && process.platform !== 'win32') {
      try {
        fs.chmodSync(executable, '755')
      } catch (error) {
        console.error('Error setting executable permissions:', error)
      }
    }

    // 终止已存在的后端进程
    if (backendProcess) {
      cleanupBackend()
    }

    // 创建临时目录
    const tempDir = path.join(cwd, 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    // 修改进程启动配置
    backendProcess = spawn(executable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false, // 确保不会独立运行
      cwd: cwd,
      windowsHide: true,
      // 在 Windows 上设置进程组
      ...(process.platform === 'win32' ? { 
        shell: false,
        windowsHide: true,
        // 创建新的进程组但不分离
        createProcessGroup: true
      } : {}),
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        TEMP: tempDir,
        TMP: tempDir,
        CONFIG_PATH: CONFIG_PATH,
        LOG_PATH: LOG_PATH,
        // 添加系统代理环境变量
        HTTP_PROXY: process.env.HTTP_PROXY || '',
        HTTPS_PROXY: process.env.HTTPS_PROXY || '',
        NO_PROXY: process.env.NO_PROXY || ''
      }
    })

    // 设置进程引用，确保子进程随父进程退出
    if (process.platform === 'win32') {
      require('child_process').exec(`wmic process where ParentProcessId=${backendProcess.pid} CALL setpriority "normal"`)
    }

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
      backendProcess = null
    })

    // 检查进程是否成功启动
    if (!backendProcess.pid) {
      throw new Error('Failed to get backend process PID')
    }

    return true
  } catch (error) {
    console.error('Error in startBackend:', error)
    return false
  }
}

// 修改清理函数
function cleanupBackend() {
  if (backendProcess) {
    try {
      if (process.platform === 'win32') {
        try {
          // 首先尝试使用 taskkill 终止进程树
          const { execSync } = require('child_process')
          execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { 
            windowsHide: true,
            stdio: 'ignore' 
          })
        } catch (e) {
          console.log('Error during taskkill:', e)
          // 如果 taskkill 失败，尝试使用 process.kill
          try {
            process.kill(backendProcess.pid)
          } catch (killError) {
            console.log('Error during process.kill:', killError)
          }
        }
      } else {
        // 在 Unix 系统上终止进程组
        process.kill(-backendProcess.pid)
      }
    } catch (error) {
      console.error('Error killing backend process:', error)
    } finally {
      backendProcess = null
    }
  }
}

// 修改应用退出处理
app.on('before-quit', (event) => {
  // 在应用退出前确保后端进程被清理
  if (backendProcess) {
    event.preventDefault()
    cleanupBackend()
    app.quit()
  }
})

app.on('will-quit', () => {
  cleanupBackend()
})

// 确保在所有窗口关闭时清理后端进程
app.on('window-all-closed', () => {
  cleanupBackend()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// 添加进程异常处理
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

// 处理配置文件读取
ipcMain.handle('read-config', async () => {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      // 如果配置文件不存在，创建一个空的配置文件
      fs.writeFileSync(CONFIG_PATH, '[]', 'utf8')
      return []
    }
    const config = fs.readFileSync(CONFIG_PATH, 'utf8')
    return JSON.parse(config)
  } catch (error) {
    console.error('Error reading config:', error)
    return []
  }
})

// 处理配置文件保存
ipcMain.handle('save-config', async (event, config) => {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8')
    return true
  } catch (error) {
    console.error('Error saving config:', error)
    return false
  }
})

// 添加错误处理函数
function showError(title, message) {
  dialog.showErrorBox(title, message)
}

// 添加等待后端服务就绪的函数
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

async function createWindow() {
  try {
    // 启动后端前先等待一下
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const backendStarted = startBackend()
    if (!backendStarted) {
      throw new Error('Failed to start backend service')
    }

    // 等待后端服务就绪
    try {
      await waitForBackend()
    } catch (error) {
      console.error('Backend startup timeout:', error)
      dialog.showErrorBox('Backend Error', 'Backend service failed to start in time')
      cleanupBackend() // 添加这行，确保在超时时清理后端进程
      app.quit()
      return
    }

    mainWindow = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        webSecurity: false,
        allowRunningInsecureContent: true,
        webviewTag: true,
        webSockets: true,
        experimentalFeatures: true,
        additionalArguments: ['--enable-features=WebSocketStream'],
        nativeWindowOpen: true,
        sandbox: false
      }
    })

    require("@electron/remote/main").enable(mainWindow.webContents)

    // 添加 WebSocket 连接错误处理
    mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      if (details.url.startsWith('ws://')) {
        console.log('WebSocket connection attempt:', details.url)
      }
      callback({ cancel: false })
    })

    mainWindow.webContents.session.webRequest.onErrorOccurred((details) => {
      if (details.url.startsWith('ws://')) {
        console.error('WebSocket error:', details.error)
      }
    })

    // 添加 CSP 配置
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' ws://localhost:5000 http://localhost:5000"]
        }
      })
    })

    if (process.env.WEBPACK_DEV_SERVER_URL) {
      await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
      if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
    } else {
      createProtocol('app')
      mainWindow.loadURL('app://./index.html')
    }

    mainWindow.on('closed', () => {
      mainWindow = null
    })

    mainWindow.on('close', (e) => {
      e.preventDefault()
      cleanupBackend()
      mainWindow.destroy()
    })

    mainWindow.webContents.on('did-finish-load', () => {
      console.log('Window loaded, checking WebSocket...')
      // 尝试建立测试 WebSocket 连接
      mainWindow.webContents.executeJavaScript(`
        try {
          const testWs = new WebSocket('ws://localhost:5000');
          testWs.onopen = () => {
            console.log('Test WebSocket connected');
            testWs.close();
          };
          testWs.onerror = (error) => {
            console.error('Test WebSocket error:', error);
          };
        } catch (error) {
          console.error('Failed to create test WebSocket:', error);
        }
      `)
    })
  } catch (error) {
    console.error('Error in createWindow:', error)
    showError('Application Error', `Failed to start application: ${error.message}`)
    app.quit()
  }
}

// 确保只有一个实例在运行
const gotTheLock = app.requestSingleInstanceLock()

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

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
  })

  app.on('ready', async () => {
    const appPath = app.getPath('exe')
    const appDir = path.dirname(appPath)
    
    // 确保必要的目录和文件存在
    const tempDir = path.join(appDir, 'temp')
    
    try {
      // 创建 temp 目录
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir)
      }

      if (isDevelopment && !process.env.IS_TEST) {
        try {
          await installExtension(VUEJS3_DEVTOOLS)
        } catch (e) {
          console.error('Vue Devtools failed to install:', e.toString())
        }
      }
      
      await createWindow()
    } catch (error) {
      console.error('Error during app ready:', error)
      showError('Initialization Error', `Failed to initialize application: ${error.message}`)
      app.quit()
    }
  })

  // 确保在应用退出时清理后端进程
  app.on('will-quit', () => {
    cleanupBackend()
  })
}

// Exit cleanly on request from parent process in development mode.
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

// 添加更多的清理点
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
  cleanupBackend()
  process.exit(1)
})