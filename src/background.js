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

// 在应用启动前注册协议
protocol.registerSchemesAsPrivileged([
  { 
    scheme: 'app', 
    privileges: { 
      secure: true, 
      standard: true,
      supportFetchAPI: true,
      stream: true
    } 
  }
])

// 禁用硬件加速以减少内存使用
app.disableHardwareAcceleration()

// 优化应用启动
app.commandLine.appendSwitch('disable-http-cache')
app.commandLine.appendSwitch('disable-gpu-vsync')
app.commandLine.appendSwitch('disable-software-rasterizer')
app.commandLine.appendSwitch('disable-gpu-compositing')
app.commandLine.appendSwitch('enable-tcp-fast-open')
app.commandLine.appendSwitch('enable-zero-copy')

// 设置空菜单
Menu.setApplicationMenu(null)

// 添加性能监控
let startupTime = Date.now()

let backendProcess = null
let mainWindow = null
let splashWindow = null

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
    // 根据平台选择正确的可执行文件
    const executableName = process.platform === 'win32' ? 'service.exe' : 'service';
    return {
      executable: path.join(process.resourcesPath, executableName),
      args: [],
      cwd: process.resourcesPath
    }
  }
}

// 添加获取后端端口的函数
function getBackendPort() {
  const portFile = path.join(getAppDataPath(), 'service_port.txt')
  try {
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8').trim())
      return port
    }
  } catch (error) {
    console.error('Error reading port file:', error)
  }
  return null
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

    // 在 Linux 平台上确保可执行文件有执行权限
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
  if (splashWindow) splashWindow.close()
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

// 修改等待后端服务就绪的函数
async function waitForBackend() {
  const maxAttempts = 30
  let attempts = 0

  while (attempts < maxAttempts) {
    try {
      const port = getBackendPort()
      if (!port) {
        console.log('Waiting for port file...')
        await new Promise(resolve => setTimeout(resolve, 1000))
        attempts++
        continue
      }

      const response = await fetch(`http://localhost:${port}/health`)
      if (response.ok) {
        console.log('Backend is ready on port:', port)
        // 将端口号保存到全局变量
        global.backendPort = port
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

// 添加创建启动窗口的函数
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 300,
    height: 320,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    center: true
  });

  // 在开发环境中加载
  if (process.env.WEBPACK_DEV_SERVER_URL) {
    splashWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL + 'splash.html')
  } else {
    // 在生产环境中加载
    createProtocol('app')
    splashWindow.loadURL('app://./splash.html')
  }

  // 防止闪烁
  splashWindow.once('ready-to-show', () => {
    splashWindow.show()
  })

  // 禁用启动窗口的鼠标事件
  splashWindow.setIgnoreMouseEvents(true)
}

// 修改 createWindow 函数
async function createWindow() {
  try {
    // 创建并显示启动窗口
    createSplashWindow()
    
    // 启动后端前先等待一下
    await new Promise(resolve => setTimeout(resolve, 500))
    
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
      cleanupBackend()
      if (splashWindow) {
        splashWindow.close()
        splashWindow = null
      }
      app.quit()
      return
    }

    // 创建主窗口但不立即显示
    mainWindow = new BrowserWindow({
      width: 1024,
      height: 768,
      minWidth: 800,
      minHeight: 600,
      title: 'SimpleShell',
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        // 优化渲染性能
        backgroundThrottling: false,
        spellcheck: false,
        // 启用硬件加速
        webgl: true,
        // 优化内存使用
        enableBlinkFeatures: 'MemoryCache',
        // 优化页面加载
        preload: path.join(__dirname, 'preload.js')
      }
    })

    // 优化窗口加载性能
    mainWindow.webContents.on('did-start-loading', () => {
      mainWindow.webContents.setZoomFactor(1.0)
    })

    mainWindow.webContents.on('did-finish-load', () => {
      const loadTime = Date.now() - startupTime
      console.log(`Application loaded in ${loadTime}ms`)
    })

    // 等待主窗口加载完成
    mainWindow.once('ready-to-show', () => {
      // 添加延迟以确保平滑过渡
      setTimeout(() => {
        if (splashWindow) {
          splashWindow.close()
          splashWindow = null
        }
        mainWindow.show()
        mainWindow.focus()
      }, 300)
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
          'Content-Security-Policy': [`default-src 'self' 'unsafe-inline' 'unsafe-eval' ws://localhost:* http://localhost:*`]
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
    if (splashWindow) {
      splashWindow.close()
      splashWindow = null
    }
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
    if (splashWindow) splashWindow.close()
    cleanupBackend()
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (mainWindow === null) {
      startupTime = Date.now()
      createWindow()
    } else {
      mainWindow.show()
    }
  })

  app.on('ready', async () => {
    startupTime = Date.now()
    
    // 预热V8引擎
    require('v8').setFlagsFromString('--expose_gc')
    global.gc && global.gc()

    if (isDevelopment && !process.env.IS_TEST) {
      // 修复 Vue Devtools 安装
      try {
        const { default: installExtension, VUEJS3_DEVTOOLS } = require('electron-devtools-installer')
        await installExtension(VUEJS3_DEVTOOLS.id)
      } catch (e) {
        console.error('Vue Devtools failed to install:', e.toString())
      }
    }
    
    // 创建协议
    if (isDevelopment) {
      if (process.env.WEBPACK_DEV_SERVER_URL) {
        // 开发模式使用现有的服务器
        await createWindow()
      }
    } else {
      createProtocol('app')
      await createWindow()
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

// 优化内存使用
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (event, navigationUrl) => {
    event.preventDefault()
  })
})