const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class TerminalDetector {
  constructor() {
    this.detectedTerminals = [];
    this.isWindows = process.platform === 'win32';
    this.isMacOS = process.platform === 'darwin';
    this.isLinux = process.platform === 'linux';
  }

  /**
   * 检测系统中所有可用的终端
   */
  async detectAllTerminals() {
    this.detectedTerminals = [];
    
    try {
      console.log('开始检测本地终端，操作系统:', process.platform);
      
      if (this.isWindows) {
        await this.detectWindowsTerminals();
      } else if (this.isMacOS) {
        await this.detectMacOSTerminals();
      } else if (this.isLinux) {
        await this.detectLinuxTerminals();
      }
      
      console.log(`检测到 ${this.detectedTerminals.length} 个终端:`, 
        this.detectedTerminals.map(t => `${t.name} (${t.type})`));
    } catch (error) {
      console.error('检测终端时发生错误:', error);
      // 即使发生错误也返回已检测到的终端
    }

    return this.detectedTerminals;
  }

  /**
   * 检测Windows系统中的终端
   */
  async detectWindowsTerminals() {
    const terminals = [
      // WSL (Windows Subsystem for Linux)
      {
        name: 'WSL (Ubuntu)',
        type: 'wsl',
        executable: 'wsl.exe',
        icon: '🐧',
        priority: 12,
        systemCommand: 'wsl.exe',
        launchArgs: ['--distribution', 'Ubuntu'],
        adminRequired: false
      },

      // PowerShell Core
      {
        name: 'PowerShell Core',
        type: 'powershell-core',
        executable: 'pwsh.exe',
        icon: '🔵',
        priority: 10,
        checkPaths: [
          'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
          'C:\\Program Files\\PowerShell\\6\\pwsh.exe',
        ],
        registryPath: 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\pwsh.exe'
      },
      
      // Windows PowerShell
      {
        name: 'Windows PowerShell',
        type: 'powershell',
        executable: 'powershell.exe',
        icon: '🔷',
        priority: 9,
        checkPaths: [
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        ],
        systemCommand: 'powershell.exe'
      },

      // Command Prompt
      {
        name: 'Command Prompt',
        type: 'cmd',
        executable: 'cmd.exe',
        icon: '⚫',
        priority: 8,
        checkPaths: [
          'C:\\Windows\\System32\\cmd.exe',
        ],
        systemCommand: 'cmd.exe'
      },

      // Git Bash
      {
        name: 'Git Bash',
        type: 'git-bash',
        executable: 'bash.exe',
        icon: '🦊',
        priority: 7,
        checkPaths: [
          'C:\\Program Files\\Git\\bin\\bash.exe',
          'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
          ...(process.env.LOCALAPPDATA ? [process.env.LOCALAPPDATA + '\\Programs\\Git\\bin\\bash.exe'] : []),
          ...(process.env.ProgramFiles ? [process.env.ProgramFiles + '\\Git\\bin\\bash.exe'] : []),
          ...(process.env['ProgramFiles(x86)'] ? [process.env['ProgramFiles(x86)'] + '\\Git\\bin\\bash.exe'] : []),
        ],
        environmentPaths: ['GIT_INSTALL_ROOT', 'GIT_HOME']
      },

      // Windows Terminal
      {
        name: 'Windows Terminal',
        type: 'windows-terminal',
        executable: 'wt.exe',
        icon: '🔳',
        priority: 11,
        packageName: 'Microsoft.WindowsTerminal_8wekyb3d8bbwe'
      },

      // Visual Studio Code Terminal
      {
        name: 'VS Code Terminal',
        type: 'vscode',
        executable: 'code.exe',
        icon: '📝',
        priority: 6,
        checkPaths: [
          'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
          'C:\\Program Files\\Microsoft VS Code\\Code.exe',
          'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
        ]
      },

      // ConEmu
      {
        name: 'ConEmu',
        type: 'conemu',
        executable: 'ConEmu64.exe',
        icon: '🟨',
        priority: 5,
        checkPaths: [
          'C:\\Program Files\\ConEmu\\ConEmu64.exe',
          process.env.LOCALAPPDATA + '\\ConEmu\\ConEmu64.exe',
        ]
      },

      // Cmder
      {
        name: 'Cmder',
        type: 'cmder',
        executable: 'Cmder.exe',
        icon: '🟩',
        priority: 4,
        checkPaths: [
          'C:\\cmder\\Cmder.exe',
          'C:\\tools\\cmder\\Cmder.exe',
        ]
      }
    ];

    for (const terminal of terminals) {
      try {
        if (await this.checkTerminalAvailability(terminal)) {
          this.detectedTerminals.push(terminal);
          console.log(`✓ 检测到终端: ${terminal.name} at ${terminal.executablePath}`);
        } else {
          console.log(`✗ 未找到终端: ${terminal.name}`);
        }
      } catch (error) {
        console.error(`检测终端 ${terminal.name} 时出错:`, error.message);
        // 继续检测其他终端
      }
    }

    // 按优先级排序
    this.detectedTerminals.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 检测macOS系统中的终端
   */
  async detectMacOSTerminals() {
    const terminals = [
      {
        name: 'Terminal',
        type: 'terminal',
        executable: '/System/Applications/Utilities/Terminal.app',
        icon: '⚫',
        priority: 10
      },
      {
        name: 'iTerm2',
        type: 'iterm2',
        executable: '/Applications/iTerm.app',
        icon: '🔷',
        priority: 9
      },
      {
        name: 'Hyper',
        type: 'hyper',
        executable: '/Applications/Hyper.app',
        icon: '⚡',
        priority: 8
      }
    ];

    for (const terminal of terminals) {
      try {
        if (await this.checkTerminalAvailability(terminal)) {
          this.detectedTerminals.push(terminal);
          console.log(`✓ 检测到终端: ${terminal.name} at ${terminal.executablePath}`);
        } else {
          console.log(`✗ 未找到终端: ${terminal.name}`);
        }
      } catch (error) {
        console.error(`检测终端 ${terminal.name} 时出错:`, error.message);
        // 继续检测其他终端
      }
    }

    this.detectedTerminals.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 检测Linux系统中的终端
   */
  async detectLinuxTerminals() {
    const terminals = [
      {
        name: 'GNOME Terminal',
        type: 'gnome-terminal',
        executable: 'gnome-terminal',
        icon: '🔷',
        priority: 10
      },
      {
        name: 'Konsole',
        type: 'konsole',
        executable: 'konsole',
        icon: '🔵',
        priority: 9
      },
      {
        name: 'XFCE Terminal',
        type: 'xfce4-terminal',
        executable: 'xfce4-terminal',
        icon: '🐁',
        priority: 8
      },
      {
        name: 'Terminator',
        type: 'terminator',
        executable: 'terminator',
        icon: '🤖',
        priority: 7
      }
    ];

    for (const terminal of terminals) {
      try {
        if (await this.checkTerminalAvailability(terminal)) {
          this.detectedTerminals.push(terminal);
          console.log(`✓ 检测到终端: ${terminal.name} at ${terminal.executablePath}`);
        } else {
          console.log(`✗ 未找到终端: ${terminal.name}`);
        }
      } catch (error) {
        console.error(`检测终端 ${terminal.name} 时出错:`, error.message);
        // 继续检测其他终端
      }
    }

    this.detectedTerminals.sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  /**
   * 检查终端是否可用
   */
  async checkTerminalAvailability(terminal) {
    try {
      console.log(`正在检测终端: ${terminal.name} (${terminal.type})`);
      
      // 1. 首先检查指定路径
      if (terminal.checkPaths) {
        console.log(`检查预定义路径: ${terminal.checkPaths.length} 个`);
        for (const checkPath of terminal.checkPaths) {
          if (checkPath && await this.fileExists(checkPath)) {
            terminal.executablePath = checkPath;
            console.log(`✓ 在路径找到: ${checkPath}`);
            return true;
          }
        }
      }

      // 2. 检查环境变量指定的路径
      if (terminal.environmentPaths) {
        console.log(`检查环境变量路径: ${terminal.environmentPaths.join(', ')}`);
        for (const envVar of terminal.environmentPaths) {
          const envPath = process.env[envVar];
          if (envPath) {
            // 检查环境变量路径下的可执行文件
            const possiblePaths = [
              path.join(envPath, terminal.executable),
              path.join(envPath, 'bin', terminal.executable),
              path.join(envPath, 'cmd', terminal.executable)
            ];
            
            for (const possiblePath of possiblePaths) {
              if (await this.fileExists(possiblePath)) {
                terminal.executablePath = possiblePath;
                console.log(`✓ 在环境变量路径找到: ${possiblePath}`);
                return true;
              }
            }
          }
        }
      }

      // 3. WSL特殊检查
      if (terminal.type === 'wsl') {
        console.log('执行WSL特殊检测');
        return await this.checkWSLAvailability(terminal);
      }

      // 4. 检查系统命令
      if (terminal.systemCommand) {
        console.log(`检查系统命令: ${terminal.systemCommand}`);
        try {
          const whereCommand = this.isWindows ? 'where' : 'which';
          const { stdout } = await execAsync(`${whereCommand} ${terminal.systemCommand}`, { timeout: 5000 });
          if (stdout.trim()) {
            terminal.executablePath = terminal.systemCommand;
            console.log(`✓ 在系统PATH找到: ${terminal.systemCommand}`);
            return true;
          }
        } catch (error) {
          console.log(`系统命令检查失败: ${error.message}`);
          // 命令不存在，继续尝试其他方法
        }
      }

      // 5. 检查Windows应用包
      if (this.isWindows && terminal.packageName) {
        console.log(`检查Windows应用包: ${terminal.packageName}`);
        try {
          const { stdout } = await execAsync(
            `powershell -c "Get-AppxPackage -Name *${terminal.packageName.split('_')[0]}* | Select-Object -First 1 -ExpandProperty InstallLocation"`,
            { timeout: 8000 }
          );
          if (stdout.trim()) {
            terminal.executablePath = terminal.executable;
            console.log(`✓ Windows应用包找到: ${terminal.packageName}`);
            return true;
          }
        } catch (error) {
          console.log(`Windows应用包检查失败: ${error.message}`);
          // 包不存在
        }
      }

      // 6. 通用可执行文件检查 (macOS/Linux)
      if (!this.isWindows && terminal.executable) {
        console.log(`检查通用可执行文件: ${terminal.executable}`);
        if (await this.fileExists(terminal.executable)) {
          terminal.executablePath = terminal.executable;
          console.log(`✓ 通用可执行文件找到: ${terminal.executable}`);
          return true;
        }
        
        // 尝试在PATH中查找
        try {
          const { stdout } = await execAsync(`which ${terminal.executable}`, { timeout: 5000 });
          if (stdout.trim()) {
            terminal.executablePath = stdout.trim();
            console.log(`✓ PATH中找到: ${stdout.trim()}`);
            return true;
          }
        } catch (error) {
          console.log(`PATH检查失败: ${error.message}`);
          // 不在PATH中
        }
      }

      console.log(`✗ 未找到终端: ${terminal.name}`);
      return false;
    } catch (error) {
      console.error(`检查终端 ${terminal.name} 可用性时出错:`, error.message);
      return false;
    }
  }

  /**
   * 检查WSL是否可用
   */
  async checkWSLAvailability(terminal) {
    try {
      console.log('检查WSL是否安装...');
      // 检查WSL是否安装，使用特定的编码处理
      const { stdout: wslList } = await execAsync('wsl -l -v', { 
        timeout: 8000,
        encoding: 'utf16le' // 指定UTF-16LE编码
      });
      console.log('WSL列表输出:', wslList);
      
      // 清理输出中可能的null字节
      const cleanOutput = wslList.replace(/\0/g, '');
      console.log('清理后的输出:', cleanOutput);
      
      if (cleanOutput.includes('Ubuntu') || cleanOutput.includes('Debian') || cleanOutput.includes('Alpine') || 
          cleanOutput.includes('Windows Subsystem for Linux') || cleanOutput.includes('docker-desktop') ||
          cleanOutput.includes('SUSE') || cleanOutput.includes('CentOS') || cleanOutput.includes('Fedora') ||
          cleanOutput.includes('NAME')) { // NAME表示WSL已安装且有发行版列表
        terminal.executablePath = 'wsl.exe';
        
        // 检测所有可用的WSL发行版
        const distributions = this.parseWSLDistributions(cleanOutput);
        console.log('解析的所有WSL发行版:', distributions);
        
        // 过滤掉docker-desktop等非Linux发行版
        const validDistributions = distributions.filter(dist => 
          !dist.name.toLowerCase().includes('docker-desktop') && 
          !dist.name.toLowerCase().includes('podman-machine')
        );
        
        console.log('有效的WSL发行版:', validDistributions);
        
        if (validDistributions.length > 0) {
          terminal.availableDistributions = validDistributions;
          console.log(`发现 ${validDistributions.length} 个有效WSL发行版:`, validDistributions.map(d => d.name));
          
          // 如果有多个发行版，创建多个终端选项
          if (validDistributions.length > 1) {
            terminal.hasMultipleDistributions = true;
          }
          
          return true;
        } else {
          console.log('没有找到有效的WSL发行版');
          return false;
        }
      }
      
      console.log('WSL未安装或无可用发行版');
      return false;
    } catch (error) {
      console.error('WSL检查失败:', error.message);
      // WSL不可用
      return false;
    }
  }

  /**
   * 解析WSL发行版列表
   */
  parseWSLDistributions(wslOutput) {
    console.log('开始解析WSL输出，长度:', wslOutput.length);
    const lines = wslOutput.split('\n');
    const distributions = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (trimmed && !trimmed.startsWith('NAME') && !trimmed.startsWith('Windows Subsystem')) {
        // 移除可能的 * 标记并分割
        const cleanLine = trimmed.replace(/^\*\s*/, '');
        const parts = cleanLine.split(/\s+/);
        
        if (parts.length >= 2) {
          const name = parts[0];
          const state = parts[1];
          const version = parts[2] || 'WSL1';
          
          // 跳过标题行和无效条目
          if (name && state && name !== 'STATE' && name !== 'NAME' && state !== 'STATE') {
            const distribution = {
              name,
              state,
              version,
              isDefault: trimmed.startsWith('*')
            };
            distributions.push(distribution);
            console.log('发现WSL发行版:', distribution);
          }
        }
      }
    }
    
    console.log('最终解析的WSL发行版:', distributions);
    return distributions;
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取已检测的终端列表
   */
  getDetectedTerminals() {
    return [...this.detectedTerminals];
  }

  /**
   * 按类型获取终端
   */
  getTerminalByType(type) {
    return this.detectedTerminals.find(terminal => terminal.type === type);
  }

  /**
   * 获取推荐的默认终端
   */
  getRecommendedTerminal() {
    if (this.detectedTerminals.length === 0) {
      return null;
    }
    return this.detectedTerminals[0]; // 已经按优先级排序
  }
}

module.exports = TerminalDetector;