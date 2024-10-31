'use strict'

import { app, protocol, BrowserWindow, dialog, Menu } from 'electron'
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

// 获取应用程序的根目录
function getAppRootPath() {
  if (isDevelopment) {
    return path.join(__dirname, '..')
  } else {
    return path.dirname(app.getPath('exe'))
  }
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
    const rootDir = getAppRootPath()
    
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
    const tempDir = path.join(rootDir, 'temp')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

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
        CONFIG_PATH: configPath,
        LOG_PATH: path.join(rootDir, 'sftp_log.log')
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

// 创建主窗���
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
  } catch (error) {
    console.error('Error in createWindow:', error)
    dialog.showErrorBox('Application Error', `Failed to start application: ${error.message}`)
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

  app.on('will-quit', () => {
    cleanupBackend()
  })

  app.on('before-quit', () => {
    cleanupBackend()
  })

  app.on('activate', () => {
    if (mainWindow === null) createWindow()
  })

  app.on('ready', async () => {
    if (isDevelopment && !process.env.IS_TEST) {
      try {
        await installExtension(VUEJS3_DEVTOOLS)
      } catch (e) {
        console.error('Vue Devtools failed to install:', e.toString())
      }
    }
    
    await createWindow()
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
  cleanupBackend()
  process.exit(1)
})
