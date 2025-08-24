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
   * 启动本地终端或应用程序
   * @param {Object} terminalConfig - 终端配置
   * @param {string} tabId - 标签页ID
   * @param {Object} options - 启动选项 (adminMode, distribution, runInBackground, etc.)
   */
  async launchTerminal(terminalConfig, tabId, options = {}) {
    try {
      // 对于自定义终端/应用程序，支持后台运行多个实例
      if (terminalConfig.isCustom && terminalConfig.runInBackground) {
        return await this.launchBackgroundApplication(terminalConfig, tabId, options);
      }
      
      // 检查是否已经有相同类型的终端在运行
      const existingTerminal = Array.from(this.activeTerminals.values()).find(
        terminal => terminal.config && terminal.config.type === terminalConfig.type
      );
      
      if (existingTerminal && existingTerminal.status !== 'exited' && !terminalConfig.isCustom) {
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
        distribution: options.distribution || null,
        isCustom: terminalConfig.isCustom || false
      };

      // 如果是自定义终端，使用特殊处理
      if (terminalConfig.isCustom) {
        await this.launchCustomApplication(terminalInfo);
      } else {
        // 根据操作系统启动相应的系统终端
        if (this.isWindows) {
          await this.launchWindowsTerminal(terminalInfo);
        } else if (this.isMacOS) {
          await this.launchMacOSTerminal(terminalInfo);
        } else if (this.isLinux) {
          await this.launchLinuxTerminal(terminalInfo);
        }
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
   * 启动后台应用程序（不嵌入窗口）
   */
  async launchBackgroundApplication(terminalConfig, tabId, options = {}) {
    try {
      const { executable, args = [], env = {}, cwd } = terminalConfig;
      
      // 使用 Worker 线程来启动后台应用
      const workerPath = path.join(__dirname, 'application-launcher-worker.js');
      const worker = new Worker(workerPath, {
        workerData: {
          executable,
          args,
          env: { ...process.env, ...env },
          cwd: cwd || process.cwd(),
          detached: true
        }
      });

      const appInfo = {
        config: terminalConfig,
        tabId,
        options,
        worker,
        startTime: Date.now(),
        status: 'running',
        isBackground: true,
        isCustom: true
      };

      // 监听 Worker 消息
      worker.on('message', (message) => {
        if (message.type === 'started') {
          appInfo.pid = message.pid;
          appInfo.status = 'running';
          this.emit('terminalReady', { tabId, pid: message.pid });
        } else if (message.type === 'error') {
          appInfo.status = 'error';
          this.emit('terminalError', { tabId, error: message.error });
        } else if (message.type === 'exited') {
          appInfo.status = 'exited';
          this.emit('terminalExited', { tabId, code: message.code });
          this.activeTerminals.delete(tabId);
        }
      });

      worker.on('error', (error) => {
        console.error('Worker error:', error);
        this.emit('terminalError', { tabId, error });
      });

      this.activeTerminals.set(tabId, appInfo);
      this.emit('terminalLaunched', { tabId, terminalInfo: appInfo });
      
      return appInfo;
    } catch (error) {
      console.error('Failed to launch background application:', error);
      throw error;
    }
  }

  /**
   * 启动自定义应用程序
   */
  async launchCustomApplication(terminalInfo) {
    const { config, tabId } = terminalInfo;
    const { executable, args = [], env = {}, cwd } = config;
    
    try {
      // 处理可执行文件路径
      let executablePath = executable;
      
      // 在 Windows 上处理路径
      if (this.isWindows) {
        // 标准化路径分隔符
        executablePath = executablePath.replace(/\//g, '\\');
      }
      
      console.log(`Launching custom application: ${executablePath}`);
      console.log(`Arguments: ${args.join(' ')}`);
      console.log(`Working directory: ${cwd || 'default'}`);
      
      // 在 Windows 上使用 start 命令来避免权限问题
      if (this.isWindows) {
        try {
          // 使用 Windows 的 start 命令
          // start 命令格式: start "title" /D "workdir" "program" args...
          const startArgs = ['/c', 'start'];
          
          // 添加空标题（必需的，避免第一个带引号的参数被当作标题）
          startArgs.push('""');
          
          // 如果有工作目录，添加 /D 参数
          if (cwd && cwd.trim()) {
            startArgs.push('/D', `"${cwd}"`);
          }
          
          // 添加程序路径（如果包含空格，需要引号）
          if (executablePath.includes(' ')) {
            startArgs.push(`"${executablePath}"`);
          } else {
            startArgs.push(executablePath);
          }
          
          // 添加程序参数
          args.forEach(arg => {
            if (arg.includes(' ')) {
              startArgs.push(`"${arg}"`);
            } else {
              startArgs.push(arg);
            }
          });
          
          console.log('Using Windows start command:', 'cmd.exe', startArgs.join(' '));
          
          // 使用 cmd.exe 执行 start 命令
          const childProcess = spawn('cmd.exe', startArgs, {
            shell: false,
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: { ...process.env, ...env }
          });
          
          if (!childProcess || !childProcess.pid) {
            throw new Error('Failed to start process using start command');
          }
          
          terminalInfo.process = childProcess;
          terminalInfo.pid = childProcess.pid;
          terminalInfo.status = 'starting';
          
          console.log(`Process started with PID: ${childProcess.pid}`);
          
          // start 命令会立即返回，实际程序在新进程中运行
          setTimeout(() => {
            terminalInfo.status = 'ready';
            this.emit('terminalReady', { 
              tabId, 
              pid: childProcess.pid,
              hwnd: null 
            });
          }, 500);
          
          // 监听 cmd.exe 进程的退出（不是实际应用程序）
          childProcess.on('exit', (code, signal) => {
            console.log(`Start command process exited for ${tabId}: code=${code}`);
            // start 命令正常退出，不影响实际应用程序
            if (code === 0) {
              console.log('Application launched successfully');
            } else {
              terminalInfo.status = 'exited';
              this.emit('terminalExited', { tabId, code });
            }
          });
          
          childProcess.on('error', (error) => {
            console.error(`Start command error for ${tabId}:`, error);
            terminalInfo.status = 'error';
            this.emit('terminalError', { 
              tabId, 
              error: { 
                message: `无法启动程序: ${error.message}`,
                code: error.code,
                executable: executablePath
              }
            });
          });
          
          return; // 成功启动，提前返回
          
        } catch (startError) {
          console.error('Failed to use start command, trying alternative method:', startError);
          // 如果 start 命令失败，继续尝试其他方法
        }
      }
      
      // 备用方案：直接启动（用于非 Windows 系统或 start 命令失败的情况）
      const spawnOptions = {
        detached: !config.runInBackground,
        stdio: config.runInBackground ? 'ignore' : ['ignore', 'ignore', 'ignore'],
        env: { ...process.env, ...env },
        windowsHide: false
      };
      
      // 设置工作目录
      if (cwd && cwd.trim()) {
        spawnOptions.cwd = cwd;
      }
      
      // 根据文件类型决定是否使用 shell
      if (this.isWindows) {
        const ext = path.extname(executablePath).toLowerCase();
        
        if (['.bat', '.cmd', '.ps1'].includes(ext)) {
          spawnOptions.shell = true;
        } else if (ext === '.exe' && !path.isAbsolute(executablePath)) {
          spawnOptions.shell = true;
        }
        
        spawnOptions.windowsVerbatimArguments = true;
      }
      
      let childProcess;
      
      try {
        childProcess = spawn(executablePath, args, spawnOptions);
        
        if (!childProcess || !childProcess.pid) {
          throw new Error('Process failed to start - no PID returned');
        }
      } catch (spawnError) {
        console.error(`Failed to spawn process directly: ${spawnError.message}`);
        throw spawnError;
      }
      
      terminalInfo.process = childProcess;
      terminalInfo.pid = childProcess.pid;
      terminalInfo.status = 'starting';
      
      console.log(`Process started with PID: ${childProcess.pid}`);

      // 监听进程事件
      childProcess.on('error', (error) => {
        console.error(`Custom application error for ${tabId}:`, error);
        
        let errorMessage = error.message;
        if (error.code === 'ENOENT') {
          errorMessage = `找不到可执行文件: ${executablePath}\n请检查路径是否正确`;
        } else if (error.code === 'EACCES') {
          errorMessage = `没有执行权限: ${executablePath}\n请尝试以管理员身份运行或检查文件权限`;
        } else if (error.code === 'UNKNOWN') {
          errorMessage = `无法启动程序: ${executablePath}\n可能需要管理员权限或程序被防病毒软件阻止`;
        }
        
        terminalInfo.status = 'error';
        this.emit('terminalError', { 
          tabId, 
          error: { 
            message: errorMessage,
            code: error.code,
            executable: executablePath
          }
        });
      });

      childProcess.on('exit', (code, signal) => {
        console.log(`Custom application exited for ${tabId}: code=${code}, signal=${signal}`);
        terminalInfo.status = 'exited';
        this.emit('terminalExited', { tabId, code });
      });

      // 标记为就绪
      setTimeout(() => {
        if (terminalInfo.status === 'starting') {
          terminalInfo.status = 'ready';
          this.emit('terminalReady', { 
            tabId, 
            pid: childProcess.pid,
            hwnd: null 
          });
        }
      }, 1000);

    } catch (error) {
      console.error(`Failed to launch custom application for ${tabId}:`, error);
      terminalInfo.status = 'error';
      
      // 提供更友好的错误信息
      const friendlyError = {
        message: error.message || '启动应用程序失败',
        executable: executable,
        suggestion: '请检查可执行文件路径是否正确，以及是否有执行权限。某些程序可能需要管理员权限。'
      };
      
      this.emit('terminalError', { tabId, error: friendlyError });
      throw friendlyError;
    }
  }

  /**
   * 启动Windows终端
   */
  async launchWindowsTerminal(terminalInfo) {
    const { config, tabId, options, distribution } = terminalInfo;
    
    // 统一字段名：支持 executable 和 executablePath
    if (!config.executablePath && config.executable) {
      config.executablePath = config.executable;
    }
    
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
      case 'wsl':
        // WSL最好通过Windows Terminal启动以避免闪退
        // 检查是否有Windows Terminal可用
        console.log('检测Windows Terminal可用性...');
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
          // 回退方案：使用系统命令或默认路径
          console.log('使用系统命令直接启动WSL');
          config.executablePath = config.systemCommand || config.executable || 'wsl.exe';
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
        }
        break;
      case 'windows-terminal':
        config.executablePath = config.executable || 'wt.exe';
        spawnArgs = ['new-tab'];
        break;
      default:
        // 默认情况，确保有 executablePath
        if (!config.executablePath && config.executable) {
          config.executablePath = config.executable;
        }
        spawnArgs = [];
    }

    // 启动进程
    console.log(`尝试启动终端: ${config.executablePath} ${spawnArgs.join(' ')}`);
    
    if (!config.executablePath) {
      throw new Error(`终端 ${config.name || config.type} 的执行路径未设置`);
    }
    
    try {
      // 验证可执行文件是否存在
      const fs = require('fs');
      if (!fs.existsSync(config.executablePath)) {
        throw new Error(`可执行文件不存在: ${config.executablePath}`);
      }
    } catch (fsError) {
      console.warn(`文件检查失败，继续尝试启动: ${fsError.message}`);
    }
    
    const childProcess = spawn(config.executablePath, spawnArgs, spawnOptions);
    
    if (!childProcess.pid) {
      throw new Error(`进程启动失败，未获得PID`);
    }
    
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
      // Window handle detection removed - requires PowerShell
      // For now, return null as this is not critical functionality
      resolve(null);
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

      // Window rect detection removed - requires PowerShell
      // This functionality is not critical for basic terminal operation
      resolve(null);
    });
  }

  /**
   * 设置窗口位置和大小
   */
  async setWindowRect(hwnd, x, y, width, height) {
    // Window positioning removed - requires PowerShell
    // This functionality is not critical for basic terminal operation
    return false;
  }

  /**
   * 设置窗口为子窗口
   */
  async setWindowParent(hwnd, parentHwnd) {
    // Window parenting removed - requires PowerShell
    // This functionality is not critical for basic terminal operation
    return false;
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
        // Simplified detection - just check if wt.exe exists in PATH
        const { exec } = require('child_process');
        return new Promise((resolve) => {
          exec('where wt.exe', { windowsHide: true }, (error) => {
            if (!error) {
              console.log('检测到Windows Terminal (wt.exe)');
              resolve(true);
            } else {
              console.log('未检测到Windows Terminal');
              resolve(false);
            }
          });
        });
      } catch (error) {
        // 检查失败
        console.log('Windows Terminal检查失败:', error.message);
        return false;
      }
    } catch (error) {
      console.error('检查Windows Terminal可用性时出错:', error.message);
      return false;
    }
  }
}

module.exports = LocalTerminalManager;