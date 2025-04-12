const Client = require('ssh2-sftp-client');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { createReadStream, createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');
const { EventEmitter } = require('events');
const mime = require('mime-types');

/**
 * SFTP服务类，用于远程文件操作
 */
class SFTPService {
  constructor() {
    // 存储活动的SFTP连接
    this.connections = new Map();
    // 存储传输任务
    this.transfers = new Map();
    // 连接超时时间（5分钟）
    this.connectionTimeout = 5 * 60 * 1000;
    // 传输进度事件
    this.events = new EventEmitter();
    // 添加传输取消标志
    this.cancelledTransfers = new Set();
  }

  /**
   * 获取或创建SFTP客户端
   * @param {Object} sshConfig SSH连接配置
   * @returns {Promise<Object>} 包含sftp客户端的对象
   */
  async getClient(sshConfig) {
    // 生成连接ID
    const connectionId = `${sshConfig.host}:${sshConfig.port || 22}:${sshConfig.username}`;
    
    // 检查是否有现有连接
    let connection = this.connections.get(connectionId);
    
    // 如果有现有连接，检查是否已过期
    if (connection) {
      // 更新最后活动时间
      connection.lastActivity = Date.now();
      
      // 如果已连接，直接返回
      if (connection.connected) {
        return connection;
      }
      
      // 如果正在连接，等待连接完成
      if (connection.connecting) {
        await connection.connectPromise;
        return connection;
      }
    }
    
    // 创建新的连接
    const sftp = new Client();
    
    // 创建新的连接对象
    connection = {
      sftp,
      connectionId,
      connected: false,
      connecting: true,
      lastActivity: Date.now(),
      connectPromise: null
    };
    
    // 存储连接
    this.connections.set(connectionId, connection);
    
    // 连接SFTP
    const connectPromise = this.connectSFTP(sftp, sshConfig)
      .then(() => {
        connection.connected = true;
        connection.connecting = false;
        console.log(`SFTP连接成功: ${connectionId}`);
        return connection;
      })
      .catch(err => {
        console.error(`SFTP连接错误: ${connectionId}`, err);
        this.connections.delete(connectionId);
        throw err;
      });
    
    // 存储连接Promise
    connection.connectPromise = connectPromise;
    
    return connectPromise;
  }
  
  /**
   * 连接到SFTP服务器
   * @param {Object} sftp SFTP客户端
   * @param {Object} config SSH连接配置
   * @returns {Promise<void>}
   */
  async connectSFTP(sftp, config) {
    const options = {
      host: config.host,
      port: config.port || 22,
      username: config.username,
      // 根据认证类型设置认证信息
      ...(config.authType === 'password' 
        ? { password: config.password } 
        : { privateKey: config.privateKey }),
      readyTimeout: 30000,
      keepaliveInterval: 60000,
      keepaliveCountMax: 3
    };
    
    try {
      await sftp.connect(options);
    } catch (error) {
      console.error('SFTP连接失败:', error);
      throw new Error(`SFTP连接失败: ${error.message}`);
    }
  }
  
  /**
   * 关闭SFTP连接
   * @param {string} connectionId 连接ID
   */
  async closeConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (connection) {
      try {
        await connection.sftp.end();
        console.log(`SFTP连接已关闭: ${connectionId}`);
      } catch (error) {
        console.error(`关闭SFTP连接错误: ${connectionId}`, error);
      } finally {
        this.connections.delete(connectionId);
      }
    }
  }
  
  /**
   * 列出目录内容
   * @param {Object} sshConfig SSH连接配置
   * @param {string} dirPath 目录路径
   * @param {Object} options 选项
   * @returns {Promise<Object>} 目录内容
   */
  async listFiles(sshConfig, dirPath, options = {}) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = dirPath;
      if (dirPath === '~' || dirPath === '') {
        normalizedPath = '.';
      } else if (dirPath.startsWith('~/')) {
        normalizedPath = dirPath.substring(2);
      }
      
      // 获取文件列表
      const list = await sftp.list(normalizedPath);
      
      // 获取当前工作目录（对于相对路径）
      let currentDir = normalizedPath;
      if (normalizedPath === '.') {
        try {
          // 尝试获取当前工作目录
          currentDir = await sftp.realPath('.');
        } catch (error) {
          console.error('获取当前工作目录失败:', error);
          currentDir = '/'; // 默认使用根目录
        }
      }
      
      // 处理文件列表，添加额外信息
      const filesList = list.map(item => {
        // 路径处理
        const filePath = path.posix.join(currentDir, item.name);
        
        // MIME类型处理
        let mimeType = null;
        if (item.type !== 'd') { // 不是目录
          mimeType = mime.lookup(item.name) || 'application/octet-stream';
        }
        
        return {
          name: item.name,
          path: filePath,
          isDirectory: item.type === 'd',
          size: item.size,
          mtime: new Date(item.modifyTime).toISOString(),
          mimeType
        };
      });
      
      return {
        success: true,
        data: filesList
      };
    } catch (error) {
      console.error('列出文件失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 预览文件
   * @param {Object} sshConfig SSH连接配置
   * @param {string} filePath 文件路径
   * @param {Object} options 选项
   * @returns {Promise<Object>} 文件预览结果
   */
  async previewFile(sshConfig, filePath, options = {}) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = filePath;
      if (filePath.startsWith('~/')) {
        normalizedPath = filePath.substring(2);
      }
      
      // 获取文件属性
      const stats = await sftp.stat(normalizedPath);
      
      // 获取MIME类型
      const mimeType = mime.lookup(normalizedPath) || 'application/octet-stream';
      const fileType = mimeType.split('/')[0];
      
      // 根据文件类型和大小决定预览方式
      let previewData;
      
      // 对于文本文件，直接读取内容
      if (fileType === 'text' || 
          mimeType === 'application/json' || 
          mimeType === 'application/xml' ||
          mimeType === 'application/javascript') {
        // 文本文件限制大小（5MB）
        if (stats.size > 5 * 1024 * 1024) {
          return { 
            success: true, 
            preview: {
              type: 'error',
              message: '文件过大，无法预览(>5MB)'
            }
          };
        }
        
        // 读取文件内容
        const content = await sftp.get(normalizedPath);
        
        previewData = {
          type: 'text',
          content: content.toString('utf-8'),
          mimeType
        };
      } 
      // 对于图片文件，读取为Base64
      else if (fileType === 'image') {
        // 图片文件限制大小（10MB）
        if (stats.size > 10 * 1024 * 1024) {
          return { 
            success: true, 
            preview: {
              type: 'error',
              message: '图片过大，无法预览(>10MB)'
            }
          };
        }
        
        // 读取文件内容
        const buffer = await sftp.get(normalizedPath);
        
        previewData = {
          type: 'image',
          content: buffer.toString('base64'),
          mimeType
        };
      } 
      // 其他类型文件不支持预览
      else {
        previewData = {
          type: 'unsupported',
          message: `不支持预览的文件类型: ${mimeType}`,
          mimeType
        };
      }
      
      return { 
        success: true, 
        preview: previewData,
        fileName: path.basename(normalizedPath),
        fileSize: stats.size,
        mimeType
      };
    } catch (error) {
      console.error('预览文件失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 上传文件
   * @param {Object} sshConfig SSH连接配置
   * @param {string} srcPath 源文件路径
   * @param {string} destPath 目标文件路径
   * @param {Object} options 选项
   * @returns {Promise<Object>} 上传结果
   */
  async uploadFile(sshConfig, srcPath, destPath, options = {}) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = destPath;
      if (destPath.startsWith('~/')) {
        normalizedPath = destPath.substring(2);
      }
      
      // 创建传输ID
      const transferId = `upload-${Date.now()}`;
      
      // 检查源文件是否存在
      const stats = await fs.stat(srcPath);
      
      // 监听传输进度
      const progressCallback = (transferred, total) => {
        // 检查是否取消传输
        if (this.cancelledTransfers.has(transferId)) {
          return;
        }
        
        const speed = this.calculateTransferSpeed(transferId, transferred);
        const remainingTime = this.calculateRemainingTime(transferred, total, speed);
        
        const progress = {
          transferId,
          type: 'upload',
          srcPath,
          destPath: normalizedPath,
          fileName: path.basename(srcPath),
          progress: Math.round((transferred / stats.size) * 100),
          transferredBytes: transferred,
          totalBytes: stats.size,
          transferSpeed: speed,
          remainingTime
        };
        
        // 存储传输进度
        this.transfers.set(transferId, {
          ...progress,
          startTime: this.transfers.get(transferId)?.startTime || Date.now(),
          lastUpdate: Date.now(),
          lastBytes: transferred
        });
        
        // 触发内部进度事件
        this.events.emit(`transfer-progress-${transferId}`, progress);
        
        // 如果提供了onProgress回调，则调用它
        if (options.onProgress && typeof options.onProgress === 'function') {
          options.onProgress(progress);
        }
      };
      
      // 开始上传
      await sftp.fastPut(srcPath, normalizedPath, {
        step: (total_transferred, chunk, total) => {
          // 检查是否取消传输
          if (this.cancelledTransfers.has(transferId)) {
            throw new Error('传输已取消');
          }
          progressCallback(total_transferred, total);
        }
      });
      
      // 清理传输记录
      this.transfers.delete(transferId);
      this.cancelledTransfers.delete(transferId);
      
      return {
        success: true,
        message: `文件已上传: ${normalizedPath}`,
        transferId
      };
    } catch (error) {
      console.error('上传文件失败:', error);
      
      if (error.message === '传输已取消') {
        return {
          success: false,
          cancelled: true,
          error: '传输已取消'
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 上传文件夹
   * @param {Object} sshConfig SSH连接配置
   * @param {string} srcPath 源文件夹路径
   * @param {string} destPath 目标文件夹路径
   * @param {Object} options 选项
   * @returns {Promise<Object>} 上传结果
   */
  async uploadFolder(sshConfig, srcPath, destPath, options = {}) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = destPath;
      if (destPath.startsWith('~/')) {
        normalizedPath = destPath.substring(2);
      }
      
      // 创建传输ID
      const transferId = `upload-folder-${Date.now()}`;
      
      // 检查文件夹是否存在
      const stats = await fs.stat(srcPath);
      
      if (!stats.isDirectory()) {
        throw new Error('源路径不是文件夹');
      }
      
      // 确保目标文件夹存在
      try {
        await sftp.mkdir(normalizedPath);
      } catch (err) {
        // 如果文件夹已存在，忽略错误
        if (!err.message.includes('Already exists')) {
          throw err;
        }
      }
      
      // 实现文件夹上传逻辑
      // 进度通知通过options.onProgress回调
      if (options.onProgress && typeof options.onProgress === 'function') {
        options.onProgress({
          transferId,
          type: 'upload',
          progress: 0,
          fileName: path.basename(srcPath),
          message: '文件夹上传功能正在开发中'
        });
      }
      
      // 目前返回未实现错误，但保留传输ID
      return {
        success: false,
        error: '文件夹上传功能尚未完全实现',
        transferId
      };
    } catch (error) {
      console.error('上传文件夹失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 下载文件
   * @param {Object} sshConfig SSH连接配置
   * @param {string} remotePath 远程文件路径
   * @param {string} localPath 本地文件路径
   * @param {Object} options 选项
   * @returns {Promise<Object>} 下载结果
   */
  async downloadFile(sshConfig, remotePath, localPath, options = {}) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = remotePath;
      if (remotePath.startsWith('~/')) {
        normalizedPath = remotePath.substring(2);
      }
      
      // 创建传输ID
      const transferId = `download-${Date.now()}`;
      
      // 获取远程文件大小
      const stats = await sftp.stat(normalizedPath);
      
      // 监听传输进度
      const progressCallback = (transferred, total) => {
        // 检查是否取消传输
        if (this.cancelledTransfers.has(transferId)) {
          return;
        }
        
        const speed = this.calculateTransferSpeed(transferId, transferred);
        const remainingTime = this.calculateRemainingTime(transferred, total, speed);
        
        const progress = {
          transferId,
          type: 'download',
          srcPath: normalizedPath,
          destPath: localPath,
          fileName: path.basename(remotePath),
          progress: Math.round((transferred / stats.size) * 100),
          transferredBytes: transferred,
          totalBytes: stats.size,
          transferSpeed: speed,
          remainingTime
        };
        
        // 存储传输进度
        this.transfers.set(transferId, {
          ...progress,
          startTime: this.transfers.get(transferId)?.startTime || Date.now(),
          lastUpdate: Date.now(),
          lastBytes: transferred
        });
        
        // 触发内部进度事件
        this.events.emit(`transfer-progress-${transferId}`, progress);
        
        // 如果提供了onProgress回调，则调用它
        if (options.onProgress && typeof options.onProgress === 'function') {
          options.onProgress(progress);
        }
      };
      
      // 开始下载
      await sftp.fastGet(normalizedPath, localPath, {
        step: (total_transferred, chunk, total) => {
          // 检查是否取消传输
          if (this.cancelledTransfers.has(transferId)) {
            throw new Error('传输已取消');
          }
          progressCallback(total_transferred, total);
        }
      });
      
      // 清理传输记录
      this.transfers.delete(transferId);
      this.cancelledTransfers.delete(transferId);
      
      return {
        success: true,
        message: `文件已下载: ${localPath}`,
        transferId
      };
    } catch (error) {
      console.error('下载文件失败:', error);
      
      if (error.message === '传输已取消') {
        return {
          success: false,
          cancelled: true,
          error: '传输已取消'
        };
      }
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 取消传输
   * @param {string} transferId 传输ID
   * @returns {Promise<Object>} 取消结果
   */
  async cancelTransfer(transferId) {
    try {
      // 检查传输是否存在
      if (!this.transfers.has(transferId)) {
        return {
          success: false,
          error: '找不到指定的传输任务'
        };
      }
      
      // 标记为已取消
      this.cancelledTransfers.add(transferId);
      
      // 返回结果
      return {
        success: true,
        message: '传输已标记为取消'
      };
    } catch (error) {
      console.error('取消传输失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 计算传输速度 (bytes/second)
   * @param {string} transferId 传输ID
   * @param {number} currentBytes 当前传输的字节数
   * @returns {number} 传输速度
   */
  calculateTransferSpeed(transferId, currentBytes) {
    const transferInfo = this.transfers.get(transferId);
    if (!transferInfo) {
      return 0;
    }
    
    const now = Date.now();
    if (!transferInfo.lastUpdate || !transferInfo.lastBytes) {
      return 0;
    }
    
    const timeDiff = (now - transferInfo.lastUpdate) / 1000; // 转换为秒
    if (timeDiff < 0.1) { // 避免除以接近零的数
      return 0;
    }
    
    const bytesDiff = currentBytes - transferInfo.lastBytes;
    return Math.max(0, Math.round(bytesDiff / timeDiff));
  }
  
  /**
   * 计算剩余时间 (seconds)
   * @param {number} transferred 已传输的字节数
   * @param {number} total 总字节数 
   * @param {number} speed 传输速度
   * @returns {number} 剩余秒数
   */
  calculateRemainingTime(transferred, total, speed) {
    if (!speed || speed <= 0) {
      return 0;
    }
    
    const remaining = total - transferred;
    return Math.max(0, Math.round(remaining / speed));
  }
  
  /**
   * 删除文件或目录
   * @param {Object} sshConfig SSH连接配置
   * @param {string} path 文件或目录路径
   * @param {boolean} isDirectory 是否是目录
   * @returns {Promise<Object>} 删除结果
   */
  async deleteFile(sshConfig, path, isDirectory) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = path;
      if (path.startsWith('~/')) {
        normalizedPath = path.substring(2);
      }
      
      if (isDirectory) {
        // 删除目录
        await sftp.rmdir(normalizedPath, true);
      } else {
        // 删除文件
        await sftp.delete(normalizedPath);
      }
      
      return {
        success: true,
        message: `已删除: ${normalizedPath}`
      };
    } catch (error) {
      console.error('删除文件失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 重命名文件
   * @param {Object} sshConfig SSH连接配置
   * @param {string} oldPath 原文件路径
   * @param {string} newPath 新文件路径
   * @returns {Promise<Object>} 重命名结果
   */
  async renameFile(sshConfig, oldPath, newPath) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedOldPath = oldPath;
      if (oldPath.startsWith('~/')) {
        normalizedOldPath = oldPath.substring(2);
      }
      
      let normalizedNewPath = newPath;
      if (newPath.startsWith('~/')) {
        normalizedNewPath = newPath.substring(2);
      }
      
      // 重命名文件
      await sftp.rename(normalizedOldPath, normalizedNewPath);
      
      return {
        success: true,
        message: `已重命名: ${normalizedOldPath} -> ${normalizedNewPath}`
      };
    } catch (error) {
      console.error('重命名文件失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 创建文件夹
   * @param {Object} sshConfig SSH连接配置
   * @param {string} path 文件夹路径
   * @returns {Promise<Object>} 创建结果
   */
  async createFolder(sshConfig, path) {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = path;
      if (path.startsWith('~/')) {
        normalizedPath = path.substring(2);
      }
      
      // 创建文件夹
      await sftp.mkdir(normalizedPath, true);
      
      return {
        success: true,
        message: `已创建文件夹: ${normalizedPath}`
      };
    } catch (error) {
      console.error('创建文件夹失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 创建文件
   * @param {Object} sshConfig SSH连接配置
   * @param {string} path 文件路径
   * @param {string} content 文件内容
   * @returns {Promise<Object>} 创建结果
   */
  async createFile(sshConfig, path, content = '') {
    try {
      const connection = await this.getClient(sshConfig);
      const sftp = connection.sftp;
      
      // 处理路径，支持~作为用户主目录
      let normalizedPath = path;
      if (path.startsWith('~/')) {
        normalizedPath = path.substring(2);
      }
      
      // 创建文件
      await sftp.put(Buffer.from(content), normalizedPath);
      
      return {
        success: true,
        message: `已创建文件: ${normalizedPath}`
      };
    } catch (error) {
      console.error('创建文件失败:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 清理过期连接
   */
  cleanupConnections() {
    const now = Date.now();
    for (const [connectionId, connection] of this.connections.entries()) {
      // 如果连接已经空闲超过超时时间，关闭它
      if (now - connection.lastActivity > this.connectionTimeout) {
        this.closeConnection(connectionId);
      }
    }
  }
  
  /**
   * 关闭所有连接
   */
  closeAllConnections() {
    for (const connectionId of this.connections.keys()) {
      this.closeConnection(connectionId);
    }
  }
}

// 创建并导出SFTP服务实例
const sftpService = new SFTPService();

// 启动定期清理任务
setInterval(() => {
  sftpService.cleanupConnections();
}, 60000); // 每分钟清理一次

module.exports = sftpService; 