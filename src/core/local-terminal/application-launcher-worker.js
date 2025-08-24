const { parentPort, workerData } = require('worker_threads');
const { spawn } = require('child_process');
const path = require('path');

/**
 * Worker线程用于启动后台应用程序
 * 这样可以避免阻塞主线程，并且可以独立管理应用生命周期
 */

try {
  const { executable, args, env, cwd, detached } = workerData;
  
  console.log(`Worker starting application: ${executable}`);
  console.log(`Arguments: ${args.join(' ')}`);
  console.log(`Working directory: ${cwd}`);
  
  // 处理可执行文件路径
  let executablePath = executable;
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    // 标准化路径分隔符
    executablePath = executablePath.replace(/\//g, '\\');
  }
  
  // 准备启动选项
  const spawnOptions = {
    detached,
    stdio: 'ignore',
    env,
    windowsHide: false
  };
  
  // 设置工作目录
  if (cwd && cwd.trim()) {
    spawnOptions.cwd = cwd;
  }
  
  // 在Windows上的特殊处理
  if (isWindows) {
    // 判断文件类型
    const ext = path.extname(executablePath).toLowerCase();
    
    if (ext === '.exe') {
      // .exe 文件
      spawnOptions.shell = !path.isAbsolute(executablePath);
    } else if (['.bat', '.cmd', '.ps1'].includes(ext)) {
      // 脚本文件需要通过 shell 执行
      spawnOptions.shell = true;
    } else {
      // 其他情况，尝试通过 shell
      spawnOptions.shell = true;
    }
    
    // 使用 windowsVerbatimArguments 确保参数正确传递
    spawnOptions.windowsVerbatimArguments = true;
  } else {
    // 非 Windows 系统
    spawnOptions.shell = !path.isAbsolute(executablePath);
  }
  
  // 启动子进程
  let childProcess;
  
  try {
    childProcess = spawn(executablePath, args, spawnOptions);
  } catch (spawnError) {
    console.error(`Failed to spawn process: ${spawnError.message}`);
    
    // 如果直接执行失败，尝试通过 shell 执行
    if (!spawnOptions.shell) {
      console.log('Retrying with shell...');
      spawnOptions.shell = true;
      childProcess = spawn(executablePath, args, spawnOptions);
    } else {
      throw spawnError;
    }
  }
  
  if (!childProcess || !childProcess.pid) {
    throw new Error('Failed to start process - no PID returned');
  }

  // 发送启动成功消息
  parentPort.postMessage({
    type: 'started',
    pid: childProcess.pid,
    executable: executablePath,
    args
  });

  // 监听进程错误
  childProcess.on('error', (error) => {
    console.error(`Application error: ${error.message}`);
    
    let errorMessage = error.message;
    if (error.code === 'ENOENT') {
      errorMessage = `找不到可执行文件: ${executablePath}`;
    } else if (error.code === 'EACCES') {
      errorMessage = `没有执行权限: ${executablePath}`;
    }
    
    parentPort.postMessage({
      type: 'error',
      error: errorMessage,
      code: error.code
    });
  });

  // 监听进程退出
  childProcess.on('exit', (code, signal) => {
    console.log(`Application exited with code ${code}, signal ${signal}`);
    parentPort.postMessage({
      type: 'exited',
      code,
      signal
    });
  });

  // 如果是分离的进程，允许它独立运行
  if (detached) {
    childProcess.unref();
  }

} catch (error) {
  console.error(`Worker failed to start application: ${error.message}`);
  parentPort.postMessage({
    type: 'error',
    error: error.message || '启动应用程序失败'
  });
}