const { Client } = require('ssh2');

/**
 * SSH连接管理类
 */
class SSHService {
  constructor() {
    this.connections = new Map();
    this.nextId = 1;
    this.bufferSize = 32 * 1024; // 32KB 缓冲区大小，可以根据需要调整
    this.useCompression = true; // 是否使用数据压缩
  }

  /**
   * 创建新的SSH连接
   * @param {Object} config 连接配置
   * @param {string} config.host 主机地址
   * @param {number} config.port 端口号，默认22
   * @param {string} config.username 用户名
   * @param {string} config.password 密码（如果使用密码认证）
   * @param {string} config.privateKey 私钥（如果使用密钥认证）
   * @param {boolean} config.useCompression 是否使用压缩，默认true
   * @param {Function} onData 数据回调函数
   * @param {Function} onClose 连接关闭回调函数
   * @param {Function} onError 错误回调函数
   * @returns {number} 连接ID
   */
  createConnection(config, onData, onClose, onError) {
    const connectionId = this.nextId++;
    const conn = new Client();
    
    // 使用配置中的压缩选项或默认值
    const useCompression = config.useCompression !== undefined ? config.useCompression : this.useCompression;

    // 处理连接错误
    conn.on('error', (err) => {
      console.error(`SSH连接错误 (ID: ${connectionId}):`, err);
      if (onError) onError(err);
      this.closeConnection(connectionId);
    });

    // 处理连接关闭
    conn.on('close', () => {
      console.log(`SSH连接关闭 (ID: ${connectionId})`);
      if (onClose) onClose();
      this.connections.delete(connectionId);
    });

    // 连接到服务器
    conn.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      // 启用压缩以减少数据量
      compress: useCompression,
      // 加密算法优先级
      algorithms: {
        cipher: [
          'aes128-gcm@openssh.com', 
          'aes256-gcm@openssh.com',
          'aes128-ctr', 
          'aes192-ctr', 
          'aes256-ctr'
        ]
      },
      // 提高TCP保活配置以保持连接稳定
      keepaliveInterval: 60000, // 60秒发送一次keepalive
      keepaliveCountMax: 3,     // 最多重试3次
      readyTimeout: 30000,      // 30秒连接超时
    });

    // 连接成功后
    conn.on('ready', () => {
      console.log(`SSH连接已就绪 (ID: ${connectionId})`);
      
      // 创建新的SSH Shell会话
      conn.shell({
        term: 'xterm-256color',  // 更高级的终端类型，支持更多功能
        rows: config.rows || 30,  // 使用传入的行数或默认值
        cols: config.cols || 120, // 使用传入的列数或默认值
        // 启用PTY模式获取更好的终端体验
        modes: {
          ECHO: 1,               // 本地回显开启
          TTY_OP_ISPEED: 38400,  // 输入速度
          TTY_OP_OSPEED: 38400   // 输出速度
        }
      }, (err, stream) => {
        if (err) {
          console.error(`创建Shell错误 (ID: ${connectionId}):`, err);
          if (onError) onError(err);
          this.closeConnection(connectionId);
          return;
        }

        // 存储stream对象以便后续使用
        this.connections.set(connectionId, { conn, stream });
        
        // 设置缓冲区大小，提高性能
        const rows = config.rows || 30;
        const cols = config.cols || 120;
        stream.setWindow(rows, cols, this.bufferSize, this.bufferSize);

        // 数据缓冲区 - 用于批量传输数据，减少WebSocket消息数量
        let dataBuffer = '';
        let bufferTimer = null;
        const flushInterval = 10; // 缓冲区刷新间隔(ms)

        // 数据缓冲处理函数
        const flushBuffer = () => {
          if (dataBuffer.length > 0) {
            if (onData) onData(dataBuffer);
            dataBuffer = '';
          }
          bufferTimer = null;
        };

        // 监听数据
        stream.on('data', (data) => {
          // 将数据添加到缓冲区
          const strData = data.toString('utf8');
          dataBuffer += strData;
          
          // 如果数据量很大或包含换行符，立即发送
          if (dataBuffer.length > 8192 || dataBuffer.includes('\n')) {
            if (bufferTimer) {
              clearTimeout(bufferTimer);
              bufferTimer = null;
            }
            flushBuffer();
          } 
          // 否则设置短延迟后再发送，以累积小数据包
          else if (!bufferTimer) {
            bufferTimer = setTimeout(flushBuffer, flushInterval);
          }
        });

        // 监听流关闭
        stream.on('close', () => {
          console.log(`SSH Stream已关闭 (ID: ${connectionId})`);
          // 确保缓冲区中的数据被发送
          if (bufferTimer) {
            clearTimeout(bufferTimer);
            flushBuffer();
          }
          this.closeConnection(connectionId);
        });

        // 监听流错误
        stream.on('error', (err) => {
          console.error(`SSH Stream错误 (ID: ${connectionId}):`, err);
          if (onError) onError(err);
        });
      });
    });

    return connectionId;
  }

  /**
   * 向SSH连接发送数据
   * @param {number} connectionId 连接ID
   * @param {string} data 要发送的数据
   * @returns {boolean} 是否成功发送
   */
  sendData(connectionId, data) {
    const connection = this.connections.get(connectionId);
    if (!connection || !connection.stream) {
      console.error(`找不到连接 ID: ${connectionId}`);
      return false;
    }

    connection.stream.write(data);
    return true;
  }

  /**
   * 关闭SSH连接
   * @param {number} connectionId 连接ID
   */
  closeConnection(connectionId) {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    if (connection.stream) {
      try {
        connection.stream.end();
      } catch (err) {
        console.error(`关闭Stream错误 (ID: ${connectionId}):`, err);
      }
    }
    
    try {
      connection.conn.end();
    } catch (err) {
      console.error(`关闭连接错误 (ID: ${connectionId}):`, err);
    }
    
    this.connections.delete(connectionId);
  }

  /**
   * 关闭所有SSH连接
   */
  closeAllConnections() {
    for (const connectionId of this.connections.keys()) {
      this.closeConnection(connectionId);
    }
  }
}

module.exports = new SSHService(); 