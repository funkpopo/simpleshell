const { spawn } = require('child_process');
const { Worker } = require('worker_threads');
const path = require('path');
const EventEmitter = require('events');

class LocalTerminalManager extends EventEmitter {
  constructor() {
    super();
    this.activeTerminals = new Map();
    this.workers = new Map();
    this.isWindows = process.platform === 'win32';
    this.isMacOS = process.platform === 'darwin';
    this.isLinux = process.platform === 'linux';
  }

  /**
   * 启动本地终端
   * @param {Object} terminalConfig - 终端配置
   * @param {string} tabId - 标签页ID
   * @param {Object} options - 启动选项 (adminMode, distribution, etc.)
   */
  async launchTerminal(terminalConfig, tabId, options = {}) {
    try {
      // 检查是否已经有相同类型的终端在运行
      const existingTerminal = Array.from(this.activeTerminals.values()).find(
        terminal => terminal.config && terminal.config.type === terminalConfig.type
      );
      
      if (existingTerminal && existingTerminal.status !== 'exited') {
        console.log(`Terminal of type ${terminalConfig.type} is already running (PID: ${existingTerminal.pid})`);
        // 返回现有终端的信息，而不是启动新的
        return existingTerminal;
      }

      // 如果当前tabId已经存在活动终端，先关闭它
      if (this.activeTerminals.has(tabId)) {
        await this.closeTerminal(tabId);
      }

      const terminalInfo = {
        config: terminalConfig,
        tabId,
        options,
        process: null,
        worker: null,
        hwnd: null,
        startTime: Date.now(),
        status: 'starting',
        distribution: options.distribution || null
      };

      // 根据操作系统启动相应的终端
      if (this.isWindows) {
        await this.launchWindowsTerminal(terminalInfo);
      } else if (this.isMacOS) {
        await this.launchMacOSTerminal(terminalInfo);
      } else if (this.isLinux) {
        await this.launchLinuxTerminal(terminalInfo);
      }

      this.activeTerminals.set(tabId, terminalInfo);
      this.emit('terminalLaunched', { tabId, terminalInfo });
      
      return terminalInfo;
    } catch (error) {
      console.error(`Failed to launch terminal for ${tabId}:`, error);
      this.emit('terminalError', { tabId, error });
      throw error;
    }
  }

  /**
   * 启动Windows终端
   */
  async launchWindowsTerminal(terminalInfo) {
    const { config, tabId, options, distribution } = terminalInfo;
    
    // 根据终端类型设置启动参数
    let spawnArgs = [];
    let spawnOptions = {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: false,
      env: { ...process.env }
    };

    // 根据终端类型配置参数
    switch (config.type) {
      case 'powershell-core':
      case 'powershell':
        spawnArgs = ['-NoExit', '-NoProfile'];
        break;
      case 'cmd':
        spawnArgs = ['/k'];
        break;
      case 'git-bash':
        spawnArgs = ['--login', '-i'];
        spawnOptions.shell = false;
        break;
      case 'wsl':
        // WSL最好通过Windows Terminal启动以避免闪退
        // 检查是否有Windows Terminal可用
        console.log('检查Windows Terminal可用性...');
        const hasWindowsTerminal = await this.isWindowsTerminalAvailable();
        console.log('Windows Terminal可用:', hasWindowsTerminal);
        
        if (hasWindowsTerminal) {
          // 使用Windows Terminal启动WSL
          console.log('使用Windows Terminal启动WSL');
          config.executablePath = 'wt.exe';
          spawnArgs = ['new-tab'];
          
          if (distribution) {
            spawnArgs.push('--title', `WSL-${distribution}`, 'wsl', '-d', distribution);
          } else if (config.availableDistributions && config.availableDistributions.length > 0) {
            // 使用默认发行版或第一个可用发行版
            const defaultDist = config.availableDistributions.find(d => d.isDefault) || config.availableDistributions[0];
            spawnArgs.push('--title', `WSL-${defaultDist.name}`, 'wsl', '-d', defaultDist.name);
          } else if (config.launchArgs && config.launchArgs.includes('--distribution')) {
            const distIndex = config.launchArgs.indexOf('--distribution');
            const distName = config.launchArgs[distIndex + 1];
            spawnArgs.push('--title', `WSL-${distName}`, 'wsl', '-d', distName);
          } else {
            spawnArgs.push('--title', 'WSL', 'wsl');
          }
          
          // Windows Terminal需要不同的spawn选项
          spawnOptions.detached = false;
          spawnOptions.stdio = ['ignore', 'ignore', 'ignore'];
        } else {
          // 回退方案：尝试使用conhost直接启动WSL
          console.log('使用conhost直接启动WSL');
          spawnArgs = [];
          if (distribution) {
            spawnArgs.push('--distribution', distribution);
          } else if (config.availableDistributions && config.availableDistributions.length > 0) {
            // 使用默认发行版或第一个可用发行版
            const defaultDist = config.availableDistributions.find(d => d.isDefault) || config.availableDistributions[0];
            spawnArgs.push('--distribution', defaultDist.name);
          } else if (config.launchArgs) {
            spawnArgs.push(...config.launchArgs);
          }
          
          // 调整spawn选项
          spawnOptions.detached = true;
          spawnOptions.stdio = ['ignore', 'ignore', 'ignore'];
          spawnOptions.windowsHide = false;
          
          // 尝试使用conhost来启动WSL终端
          const originalPath = config.executablePath;
          config.executablePath = 'conhost.exe';
          spawnArgs = [originalPath, ...spawnArgs];
        }
        break;
      case 'windows-terminal':
        spawnArgs = ['new-tab'];
        break;
      default:
        spawnArgs = [];
    }

    // 启动进程
    console.log(`尝试启动终端: ${config.executablePath} ${spawnArgs.join(' ')}`);
    
    if (!config.executablePath) {
      throw new Error(`终端 ${config.name || config.type} 的执行路径未设置`);
    }
    
    const childProcess = spawn(config.executablePath, spawnArgs, spawnOptions);
    
    terminalInfo.process = childProcess;
    terminalInfo.pid = childProcess.pid;

    // 等待进程启动并获取窗口句柄
    setTimeout(async () => {
      try {
        const hwnd = await this.findWindowByPid(childProcess.pid);
        if (hwnd) {
          terminalInfo.hwnd = hwnd;
          terminalInfo.status = 'ready';
          this.emit('terminalReady', { tabId, hwnd, pid: childProcess.pid });
        }
      } catch (error) {
        console.error('Error finding window handle:', error);
      }
    }, 1000);

    // 处理进程事件
    childProcess.on('error', (error) => {
      console.error(`Terminal process error for ${tabId}:`, error);
      terminalInfo.status = 'error';
      this.emit('terminalError', { tabId, error });
    });

    childProcess.on('exit', (code) => {
      console.log(`Terminal process exited for ${tabId} with code:`, code);
      terminalInfo.status = 'exited';
      this.activeTerminals.delete(tabId);
      this.emit('terminalExited', { tabId, code });
    });
  }

  /**
   * 启动macOS终端
   */
  async launchMacOSTerminal(terminalInfo) {
    const { config, tabId } = terminalInfo;
    
    let spawnArgs = [];
    let executablePath = config.executablePath;

    if (config.type === 'terminal') {
      spawnArgs = ['-a', 'Terminal'];
      executablePath = 'open';
    } else if (config.type === 'iterm2') {
      spawnArgs = ['-a', 'iTerm'];
      executablePath = 'open';
    }

    const childProcess = spawn(executablePath, spawnArgs, {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });

    terminalInfo.process = childProcess;
    terminalInfo.pid = childProcess.pid;
    terminalInfo.status = 'ready';

    this.emit('terminalReady', { tabId, pid: childProcess.pid });
  }

  /**
   * 启动Linux终端
   */
  async launchLinuxTerminal(terminalInfo) {
    const { config, tabId } = terminalInfo;
    
    const childProcess = spawn(config.executablePath, [], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore']
    });

    terminalInfo.process = childProcess;
    terminalInfo.pid = childProcess.pid;
    terminalInfo.status = 'ready';

    this.emit('terminalReady', { tabId, pid: childProcess.pid });
  }

  /**
   * 通过PID查找Windows窗口句柄
   */
  async findWindowByPid(pid) {
    return new Promise((resolve) => {
      if (!this.isWindows) {
        resolve(null);
        return;
      }

      // 使用PowerShell查找窗口句柄
      const { exec } = require('child_process');
      const script = `
        $processes = Get-Process -Id ${pid} -ErrorAction SilentlyContinue
        if ($processes) {
          $process = $processes[0]
          if ($process.MainWindowHandle -ne 0) {
            $process.MainWindowHandle.ToInt64()
          }
        }
      `;

      exec(`powershell -c "${script}"`, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
        } else {
          const hwnd = parseInt(stdout.trim());
          resolve(hwnd || null);
        }
      });
    });
  }

  /**
   * 获取窗口位置和大小信息
   */
  async getWindowRect(hwnd) {
    if (!this.isWindows || !hwnd) {
      return null;
    }

    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
            
            [StructLayout(LayoutKind.Sequential)]
            public struct RECT {
              public int Left;
              public int Top;
              public int Right;
              public int Bottom;
            }
          }
"@

        $hwnd = [IntPtr]${hwnd}
        $rect = New-Object Win32+RECT
        if ([Win32]::GetWindowRect($hwnd, [ref]$rect)) {
          @{
            left = $rect.Left
            top = $rect.Top
            right = $rect.Right
            bottom = $rect.Bottom
            width = $rect.Right - $rect.Left
            height = $rect.Bottom - $rect.Top
          } | ConvertTo-Json -Compress
        }
      `;

      exec(`powershell -c "${script}"`, (error, stdout) => {
        if (error || !stdout.trim()) {
          resolve(null);
        } else {
          try {
            resolve(JSON.parse(stdout.trim()));
          } catch (parseError) {
            resolve(null);
          }
        }
      });
    });
  }

  /**
   * 设置窗口位置和大小
   */
  async setWindowRect(hwnd, x, y, width, height) {
    if (!this.isWindows || !hwnd) {
      return false;
    }

    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
          }
"@

        $hwnd = [IntPtr]${hwnd}
        $HWND_TOP = [IntPtr]0
        $SWP_SHOWWINDOW = 0x0040
        [Win32]::SetWindowPos($hwnd, $HWND_TOP, ${x}, ${y}, ${width}, ${height}, $SWP_SHOWWINDOW)
      `;

      exec(`powershell -c "${script}"`, (error) => {
        resolve(!error);
      });
    });
  }

  /**
   * 设置窗口为子窗口
   */
  async setWindowParent(hwnd, parentHwnd) {
    if (!this.isWindows || !hwnd || !parentHwnd) {
      return false;
    }

    return new Promise((resolve) => {
      const { exec } = require('child_process');
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
            
            [DllImport("user32.dll")]
            public static extern bool SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
            
            public const int GWL_STYLE = -16;
            public const int WS_CHILD = 0x40000000;
            public const int WS_POPUP = unchecked((int)0x80000000);
          }
"@

        $childHwnd = [IntPtr]${hwnd}
        $parentHwnd = [IntPtr]${parentHwnd}
        
        # 移除窗口边框和标题栏
        [Win32]::SetWindowLong($childHwnd, [Win32]::GWL_STYLE, [Win32]::WS_CHILD)
        
        # 设置父窗口
        $result = [Win32]::SetParent($childHwnd, $parentHwnd)
        $result -ne [IntPtr]::Zero
      `;

      exec(`powershell -c "${script}"`, (error, stdout) => {
        const success = !error && stdout.trim() === 'True';
        resolve(success);
      });
    });
  }

  /**
   * 关闭终端
   */
  async closeTerminal(tabId) {
    const terminalInfo = this.activeTerminals.get(tabId);
    if (!terminalInfo) {
      return;
    }

    try {
      if (terminalInfo.process && !terminalInfo.process.killed) {
        if (this.isWindows) {
          // 在Windows上优雅地关闭进程
          const { exec } = require('child_process');
          exec(`taskkill /pid ${terminalInfo.process.pid} /f`, () => {
            // 清理完成
          });
        } else {
          terminalInfo.process.kill('SIGTERM');
        }
      }

      if (terminalInfo.worker) {
        await terminalInfo.worker.terminate();
      }
    } catch (error) {
      console.error(`Error closing terminal ${tabId}:`, error);
    }

    this.activeTerminals.delete(tabId);
    this.emit('terminalClosed', { tabId });
  }

  /**
   * 获取活动终端信息（返回可序列化的数据）
   */
  getActiveTerminal(tabId) {
    const terminalInfo = this.activeTerminals.get(tabId);
    if (!terminalInfo) return null;
    
    // 返回可序列化的数据，排除process等不可序列化的属性
    return {
      tabId: terminalInfo.tabId,
      config: terminalInfo.config,
      pid: terminalInfo.pid,
      hwnd: terminalInfo.hwnd,
      startTime: terminalInfo.startTime,
      status: terminalInfo.status
    };
  }

  /**
   * 获取所有活动终端（返回可序列化的数据）
   */
  getAllActiveTerminals() {
    const terminals = Array.from(this.activeTerminals.values());
    
    // 返回可序列化的数据数组
    return terminals.map(terminalInfo => ({
      tabId: terminalInfo.tabId,
      config: terminalInfo.config,
      pid: terminalInfo.pid,
      hwnd: terminalInfo.hwnd,
      startTime: terminalInfo.startTime,
      status: terminalInfo.status
    }));
  }

  /**
   * 清理所有终端
   */
  async cleanup() {
    const promises = Array.from(this.activeTerminals.keys()).map(tabId => 
      this.closeTerminal(tabId)
    );
    await Promise.all(promises);
  }

  /**
   * 检查Windows Terminal是否可用
   */
  async isWindowsTerminalAvailable() {
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // 方法1：使用where命令查找wt.exe（最简单可靠）
      try {
        const { stdout } = await execAsync('where wt.exe', { 
          timeout: 3000,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'ignore'] // 忽略stderr避免错误消息
        });
        if (stdout.trim()) {
          console.log('通过where命令检测到Windows Terminal:', stdout.trim());
          return true;
        }
      } catch (error) {
        // where命令失败，继续尝试其他方法
        console.log('where命令未找到wt.exe');
      }
      
      // 方法2：检查WindowsApps路径下的wt.exe
      const fs = require('fs').promises;
      try {
        const wtPath = `${process.env.LOCALAPPDATA}\\Microsoft\\WindowsApps\\wt.exe`;
        await fs.access(wtPath);
        console.log('通过WindowsApps路径检测到Windows Terminal');
        return true;
      } catch (error) {
        // 文件不存在
      }
      
      // 方法3：检查Windows应用包（无窗口方式）
      try {
        const { stdout } = await execAsync(
          'powershell -WindowStyle Hidden -c "Get-AppxPackage -Name Microsoft.WindowsTerminal -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name"',
          { timeout: 5000, windowsHide: true }
        );
        if (stdout.trim().includes('Microsoft.WindowsTerminal')) {
          console.log('通过AppxPackage检测到Windows Terminal');
          return true;
        }
      } catch (error) {
        // PowerShell检查失败
        console.log('PowerShell检查失败:', error.message);
      }
      
      console.log('未检测到Windows Terminal');
      return false;
    } catch (error) {
      console.error('检查Windows Terminal可用性时出错:', error.message);
      return false;
    }
  }
}

module.exports = LocalTerminalManager;