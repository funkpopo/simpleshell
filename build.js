const builder = require('electron-builder')
const Platform = builder.Platform
const { execSync } = require('child_process')
const path = require('path')

function getCurrentPlatform() {
  switch (process.platform) {
    case 'win32':
      return Platform.WINDOWS
    case 'darwin':
      return Platform.MAC
    case 'linux':
      return Platform.LINUX
    default:
      throw new Error('Cannot resolve current platform!')
  }
}

// 清理进程函数
function cleanupProcesses() {
  try {
    execSync('taskkill /F /IM SimpleShell.exe /T', { stdio: 'ignore' })
    execSync('taskkill /F /IM service.exe /T', { stdio: 'ignore' })
  } catch (error) {
    console.log('No processes to clean up')
  }
}

async function build() {
  try {
    cleanupProcesses()
    await new Promise(resolve => setTimeout(resolve, 1000))

    await builder.build({
      targets: getCurrentPlatform().createTarget(),
      config: {
        appId: 'com.example.simpleshell',
        productName: 'SimpleShell',
        directories: {
          output: 'dist_electron'
        },
        files: [
          'dist/**/*',
          'package.json',
          'background.js'
        ],
        extraResources: [
          {
            from: 'backend/dist/service/service.exe',
            to: '.'
          }
        ],
        win: {
          target: [
            {
              target: 'portable',
              arch: ['x64']
            }
          ],
          requestedExecutionLevel: 'requireAdministrator',
          signAndEditExecutable: true,
          publisherName: 'funkpopo@github.com',
          legalTrademarks: 'Copyright © 2024 funkpopo@github.com'
        },
        portable: {
          splashImage: false
        },
        asar: true
      }
    })
    console.log('Build complete!')
  } catch (error) {
    console.error('Build failed:', error)
    process.exit(1)
  }
}

build()