'use strict'

import { app, protocol, BrowserWindow, dialog, Menu } from 'electron'
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

function showError(title, content) {
  dialog.showErrorBox(title, content)
}

function startBackend() {
  try {
    const appPath = app.getPath('exe')
    const appDir = path.dirname(appPath)
    
    // 在开发环境和生产环境使用不同的后端启动方式
    const backendExecutable = isDevelopment
      ? 'python'
      : path.join(appDir, 'app.exe')

    const backendArgs = isDevelopment
      ? [path.join(__dirname, '..', 'backend', 'app.py')]
      : []

    console.log('Starting backend process:', backendExecutable)
    console.log('Backend args:', backendArgs)
    console.log('Working directory:', appDir)

    // 检查后端可执行文件是否存在
    if (!isDevelopment && !fs.existsSync(backendExecutable)) {
      throw new Error(`Backend executable not found at: ${backendExecutable}`)
    }

    // 尝试终止可能存在的旧进程
    if (backendProcess) {
      try {
        backendProcess.kill()
      } catch (e) {
        console.log('Error killing existing backend process:', e)
      }
    }

    backendProcess = spawn(backendExecutable, backendArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32', // Windows 上不需要 detached
      cwd: appDir,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    })

    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend stdout: ${data}`)
    })

    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend stderr: ${data}`)
      // 如果发现关键错误信息，可以显示给用户
      if (data.toString().includes('Error:')) {
        showError('Backend Error', data.toString())
      }
    })

    backendProcess.on('error', (err) => {
      console.error('Failed to start backend process:', err)
      showError('Backend Start Error', `Failed to start backend: ${err.message}`)
    })

    backendProcess.on('close', (code) => {
      console.log(`Backend process exited with code ${code}`)
      if (code !== 0 && code !== null) {
        // 如果后端进程异常退出，尝试重启
        console.log('Attempting to restart backend process...')
        setTimeout(() => {
          startBackend()
        }, 1000) // 等待1秒后重试
      }
    })

    // 检查进程是否成功启动
    if (!backendProcess.pid) {
      throw new Error('Failed to get backend process PID')
    }

    return true
  } catch (error) {
    console.error('Error in startBackend:', error)
    showError('Backend Error', `Failed to start backend service: ${error.message}`)
    return false
  }
}

async function waitForBackend() {
  const maxAttempts = 30 // 最多等待30秒
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
    // 启动后端服务
    const backendStarted = startBackend()
    if (!backendStarted) {
      throw new Error('Failed to start backend service')
    }

    // 等待后端服务就绪
    try {
      await waitForBackend()
    } catch (error) {
      console.error('Backend startup timeout:', error)
      showError('Backend Error', 'Backend service failed to start in time')
      app.quit()
      return
    }

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
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

    mainWindow.on('closed', () => {
      mainWindow = null
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
    if (process.platform !== 'darwin') {
      cleanupBackend() // 使用新的清理函数
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
    const configPath = path.join(appDir, 'config.json')
    
    try {
      // 创建 temp 目录
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir)
      }
      
      // 确保 config.json 存在
      if (!fs.existsSync(configPath)) {
        fs.writeFileSync(configPath, '[]', 'utf8')
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
    cleanupBackend() // 使用新的清理函数
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

// 添加新的清理函数
function cleanupBackend() {
  if (backendProcess) {
    try {
      // 在 Windows 上，我们需要使用 taskkill 来确保进程及其子进程都被终止
      if (process.platform === 'win32') {
        const { execSync } = require('child_process')
        try {
          // 首先尝试正常终止进程
          backendProcess.kill()
          
          // 然后强制终止所有相关进程
          execSync(`taskkill /F /T /PID ${backendProcess.pid}`, { 
            windowsHide: true,
            stdio: 'ignore' 
          })
        } catch (e) {
          console.log('Error during taskkill:', e)
        }
      } else {
        // 在非 Windows 平台上使用 kill
        process.kill(-backendProcess.pid) // 使用负 PID 来终止整个进程组
      }
    } catch (error) {
      console.error('Error killing backend process:', error)
    } finally {
      backendProcess = null
    }
  }
}

// 添加进程退出时的清理
process.on('exit', () => {
  cleanupBackend()
})

// 添加异常退出时的清理
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
