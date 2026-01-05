/**
 * X Server管理模块 - 管理内嵌VcXsrv的生命周期
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { logInfo, logError, logWarn } = require('../utils/logger');

class XServerManager {
  constructor() {
    this.process = null;
    this.displayNumber = 0;
    this.isRunning = false;
  }

  /**
   * 获取VcXsrv可执行文件路径
   */
  getVcXsrvPath() {
    // 开发环境
    let vcxsrvPath = path.join(process.cwd(), 'resources', 'vcxsrv', 'vcxsrv.exe');
    if (fs.existsSync(vcxsrvPath)) return vcxsrvPath;

    // 生产环境
    vcxsrvPath = path.join(path.dirname(process.execPath), 'resources', 'vcxsrv', 'vcxsrv.exe');
    if (fs.existsSync(vcxsrvPath)) return vcxsrvPath;

    return null;
  }

  /**
   * 检查指定display端口是否可用
   */
  async isPortAvailable(displayNum) {
    const port = 6000 + displayNum;
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      server.listen(port, '127.0.0.1');
    });
  }

  /**
   * 查找可用的display编号
   */
  async findAvailableDisplay() {
    for (let i = 0; i < 10; i++) {
      if (await this.isPortAvailable(i)) return i;
    }
    return 0;
  }

  /**
   * 检查端口是否有X Server在监听
   */
  async checkXServerRunning(displayNum) {
    const port = 6000 + displayNum;
    return new Promise((resolve) => {
      const socket = net.connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * 杀掉所有现有的vcxsrv进程
   */
  killExistingVcXsrv() {
    try {
      execSync('taskkill /F /IM vcxsrv.exe /T 2>nul', { stdio: 'ignore' });
      logInfo('已终止现有VcXsrv进程');
    } catch (e) {
      // 没有进程可杀，忽略错误
    }
  }

  /**
   * 启动X Server
   */
  async start(options = {}) {
    if (this.isRunning) {
      logInfo('X Server已在运行');
      return { success: true, display: this.displayNumber };
    }

    // 检查是否已有X Server在运行（可能是外部启动的）
    for (let i = 0; i < 10; i++) {
      if (await this.checkXServerRunning(i)) {
        this.displayNumber = i;
        this.isRunning = true;
        logInfo(`检测到已运行的X Server，DISPLAY=:${i}`);
        return { success: true, display: i };
      }
    }

    // 杀掉可能残留的vcxsrv进程
    this.killExistingVcXsrv();

    const vcxsrvPath = this.getVcXsrvPath();
    if (!vcxsrvPath) {
      logError('未找到VcXsrv可执行文件');
      return { success: false, error: '未找到VcXsrv' };
    }

    this.displayNumber = options.displayNumber ?? 0;

    const args = [
      `:${this.displayNumber}`,
      '-multiwindow',
      '-ac',
      '-silent-dup-error'
    ];

    if (options.clipboard !== false) {
      args.push('-clipboard');
    }

    logInfo(`启动X Server: ${vcxsrvPath} ${args.join(' ')}`);

    try {
      this.process = spawn(vcxsrvPath, args, {
        cwd: path.dirname(vcxsrvPath),
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: false
      });

      this.process.stderr.on('data', (data) => {
        logError(`X Server stderr: ${data.toString()}`);
      });

      this.process.unref();

      this.process.on('error', (err) => {
        logError(`X Server启动错误: ${err.message}`);
        this.isRunning = false;
        this.process = null;
      });

      this.process.on('exit', (code) => {
        logInfo(`X Server退出，代码: ${code}`);
        this.isRunning = false;
        this.process = null;
      });

      // 等待X Server启动
      const ready = await this.waitForReady();
      if (ready && this.process) {
        this.isRunning = true;
        logInfo(`X Server启动成功，DISPLAY=:${this.displayNumber}`);
        return { success: true, display: this.displayNumber };
      } else {
        logError('X Server启动后未能连接');
        return { success: false, error: 'X Server启动失败' };
      }
    } catch (err) {
      logError(`启动X Server失败: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * 等待X Server就绪
   */
  async waitForReady(timeout = 5000) {
    const port = 6000 + this.displayNumber;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const connected = await new Promise((resolve) => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.once('error', () => resolve(false));
        socket.setTimeout(500, () => {
          socket.destroy();
          resolve(false);
        });
      });

      if (connected) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  /**
   * 停止X Server
   */
  stop() {
    if (this.process) {
      logInfo('停止X Server');
      this.process.kill();
      this.process = null;
    }
    this.isRunning = false;
  }

  /**
   * 获取当前状态
   */
  getStatus() {
    return {
      running: this.isRunning,
      display: this.displayNumber,
      port: 6000 + this.displayNumber
    };
  }

  /**
   * 获取DISPLAY环境变量值
   */
  getDisplay() {
    return `127.0.0.1:${this.displayNumber}.0`;
  }
}

// 单例
const xserverManager = new XServerManager();

module.exports = xserverManager;
