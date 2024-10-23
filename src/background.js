'use strict'

import { app, protocol, BrowserWindow, dialog } from 'electron'
import { createProtocol } from 'vue-cli-plugin-electron-builder/lib'
import { initialize, enable } from '@electron/remote/main'
import path from 'path'
import { spawn } from 'child_process'
import fs from 'fs'

initialize()

const isDevelopment = process.env.NODE_ENV !== 'production'

// 禁用硬件加速
app.disableHardwareAcceleration()

// 预加载窗口
let mainWindow = null
let backendProcess = null
let isAppReady = false
let isWindowCreated = false

// 提前注册协议
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { secure: true, standard: true } }
])

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

function startBackend() {
  try {
    const appPath = app.getPath('exe')
    const appDir = path.dirname(appPath)
    
    const backendExecutable = isDevelopment
      ? 'python'
      : path.join(appDir, 'app.exe')

    const backendArgs = isDevelopment
      ? [path.join(__dirname, '..', 'backend', 'app.py')]
      : []

    console.log('Starting backend process:', backendExecutable)
    console.log('Backend args:', backendArgs)
    console.log('Working directory:', appDir)

    // 在生产环境中检查后端可执行文件是否存在
    if (!isDevelopment && !fs.existsSync(backendExecutable)) {
      throw new Error(`Backend executable not found at: ${backendExecutable}`)
    }

    // Windows 平台特殊处理
    if (process.platform === 'win32' && !isDevelopment) {
      backendProcess = spawn(backendExecutable, backendArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false, // 确保进程不会独立运行
        windowsHide: true,
        cwd: appDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1'
        }
      })
    } else {
      backendProcess = spawn(backendExecutable, backendArgs, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: false,
        windowsHide: true,
        cwd: appDir,
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1'
        }
      })
    }

    // 添加进程错误处理
    backendProcess.on('error', (err) => {
      console.error('Backend process error:', err)
      dialog.showErrorBox('Backend Error', `Failed to start backend: ${err.message}`)
      app.quit()
    })

    // 添加进程退出处理
    backendProcess.on('exit', (code, signal) => {
      console.log(`Backend process exited with code ${code} and signal ${signal}`)
      if (code !== 0 && code !== null) {
        dialog.showErrorBox('Backend Error', `Backend process exited unexpectedly with code ${code}`)
        app.quit()
      }
    })

    // 添加日志输出
    backendProcess.stdout.on('data', (data) => {
      console.log(`Backend stdout: ${data}`)
    })

    backendProcess.stderr.on('data', (data) => {
      console.error(`Backend stderr: ${data}`)
    })

    return true
  } catch (error) {
    console.error('Failed to start backend:', error)
    dialog.showErrorBox('Backend Error', `Failed to start backend service: ${error.message}`)
    return false
  }
}

async function createWindow() {
  if (!isAppReady || isWindowCreated) return

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    backgroundColor: '#fff',
    webPreferences: {
      nodeIntegration: process.env.ELECTRON_NODE_INTEGRATION,
      contextIsolation: !process.env.ELECTRON_NODE_INTEGRATION,
      enableRemoteModule: true
    }
  })

  enable(mainWindow.webContents)

  if (process.env.WEBPACK_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.WEBPACK_DEV_SERVER_URL)
    if (!process.env.IS_TEST) mainWindow.webContents.openDevTools()
  } else {
    createProtocol('app')
    mainWindow.loadURL('app://./index.html')
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    isWindowCreated = false
  })

  isWindowCreated = true
}

// 确保只有一个实例
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  // 优化应用启动
  app.whenReady().then(async () => {
    isAppReady = true
    
    // 启动后端服务
    const backendStarted = startBackend()
    if (!backendStarted) {
      dialog.showErrorBox('Error', 'Failed to start backend service')
      app.quit()
      return
    }

    // 等待后端就绪
    try {
      await waitForBackend()
      await createWindow()
    } catch (error) {
      dialog.showErrorBox('Error', 'Backend service failed to start')
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      if (backendProcess) {
        backendProcess.kill()
      }
      app.quit()
    }
  })

  app.on('activate', () => {
    if (!isWindowCreated) createWindow()
  })
}

// 开发环境下的退出处理
if (isDevelopment) {
  if (process.platform === 'win32') {
    process.on('message', (data) => {
      if (data === 'graceful-exit') {
        if (backendProcess) {
          backendProcess.kill()
        }
        app.quit()
      }
    })
  } else {
    process.on('SIGTERM', () => {
      if (backendProcess) {
        backendProcess.kill()
      }
      app.quit()
    })
  }
}

// 优化错误处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  if (mainWindow) {
    mainWindow.webContents.send('error', error.message)
  }
})

// 设置应用程序名称
app.setName('SimpleSSH')

// 优化内存使用
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=2048')

// 在 Windows 上禁用 GPU 合成以提高性能
if (process.platform === 'win32') {
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// 修改应用退出处理
app.on('will-quit', () => {
  if (backendProcess) {
    try {
      // Windows 平台特殊处理
      if (process.platform === 'win32') {
        // 使用 taskkill 确保子进程被终止
        const { execSync } = require('child_process')
        try {
          execSync(`taskkill /F /T /PID ${backendProcess.pid}`)
        } catch (e) {
          console.log('Error during taskkill:', e)
        }
      } else {
        process.kill(-backendProcess.pid) // 使用进程组 ID
      }
    } catch (error) {
      console.error('Error killing backend process:', error)
    }
  }
})

// 添加异常退出处理
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  if (backendProcess) {
    try {
      backendProcess.kill()
    } catch (e) {
      console.error('Error killing backend process:', e)
    }
  }
  app.quit()
})
