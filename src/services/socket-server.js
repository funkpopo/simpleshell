const { Server } = require('socket.io');
const http = require('http');
const sshService = require('./ssh');

/**
 * Socket服务器类，负责处理与渲染进程的通信
 */
class SocketServer {
  constructor() {
    this.io = null;
    this.httpServer = null;
    this.port = 0; // 使用0表示让系统自动分配可用端口
    this.connections = new Map(); // 存储socket连接和对应的SSH连接ID
  }

  /**
   * 初始化并启动Socket服务器
   * @returns {Promise} 启动成功的Promise
   */
  init() {
    return new Promise((resolve, reject) => {
      try {
        // 创建HTTP服务器
        this.httpServer = http.createServer();
        
        // 创建Socket.io服务器
        this.io = new Server(this.httpServer, {
          // 强制仅使用WebSocket传输，不使用轮询等回退方式
          transports: ['websocket'],
          // 禁用轮询
          allowUpgrades: false,
          cors: {
            origin: '*', // 允许所有来源，生产环境应当限制
            methods: ['GET', 'POST']
          },
          // 增加ping超时时间，提高连接稳定性
          pingTimeout: 30000,
          // 增加心跳间隔，降低流量消耗
          pingInterval: 25000,
          // 超过此时间后未收到响应则认为连接断开
          connectTimeout: 10000,
          // 禁用自动重连，让客户端控制重连逻辑
          reconnection: false
        });

        // 设置连接事件处理
        this.io.on('connection', this.handleConnection.bind(this));
        
        // 监听连接错误事件
        this.io.engine.on('connection_error', (err) => {
          console.error('Socket.io连接错误:', err);
        });

        // 启动HTTP服务器，使用端口0让系统自动分配可用端口
        this.httpServer.listen(this.port, () => {
          // 获取系统分配的实际端口
          this.port = this.httpServer.address().port;
          console.log(`Socket服务器已启动在端口 ${this.port}，仅使用WebSocket传输`);
          resolve(this.port);
        });
      } catch (err) {
        console.error('Socket服务器启动失败:', err);
        reject(err);
      }
    });
  }

  /**
   * 处理新的Socket连接
   * @param {Object} socket Socket.io连接对象
   */
  handleConnection(socket) {
    console.log('新的客户端连接:', socket.id);
    
    // 检查传输类型，确保使用WebSocket
    if (socket.conn.transport.name !== 'websocket') {
      console.warn(`客户端 ${socket.id} 使用了非WebSocket传输: ${socket.conn.transport.name}`);
      socket.emit('ssh:error', { message: '仅支持WebSocket连接' });
      socket.disconnect(true);
      return;
    }
    
    console.log(`客户端 ${socket.id} 使用WebSocket连接成功`);

    // 处理SSH连接请求
    socket.on('ssh:connect', (config) => {
      try {
        console.log(`收到SSH连接请求: ${config.host}:${config.port || 22}`);
        
        // 创建SSH连接
        const sshId = sshService.createConnection(
          config,
          // 数据回调，将SSH输出发送给渲染进程
          (data) => {
            socket.emit('ssh:data', { data });
          },
          // 关闭回调
          () => {
            socket.emit('ssh:close', { message: 'SSH连接已关闭' });
            this.connections.delete(socket.id);
          },
          // 错误回调
          (error) => {
            socket.emit('ssh:error', { message: error.message || '未知错误' });
          }
        );

        // 存储socket和SSH连接的映射关系
        this.connections.set(socket.id, sshId);
        
        // 通知客户端连接成功
        socket.emit('ssh:connected', { message: 'SSH连接已建立' });
      } catch (err) {
        console.error('创建SSH连接时出错:', err);
        socket.emit('ssh:error', { message: err.message || '创建SSH连接失败' });
      }
    });

    // 处理数据发送请求
    socket.on('ssh:data', ({ data }) => {
      const sshId = this.connections.get(socket.id);
      if (!sshId) {
        socket.emit('ssh:error', { message: '没有活动的SSH连接' });
        return;
      }

      sshService.sendData(sshId, data);
    });

    // 处理调整终端大小请求
    socket.on('ssh:resize', ({ cols, rows }) => {
      const sshId = this.connections.get(socket.id);
      if (!sshId) return;

      const connection = sshService.connections.get(sshId);
      if (connection && connection.stream) {
        connection.stream.setWindow(rows, cols);
      }
    });

    // 处理断开连接请求
    socket.on('ssh:disconnect', () => {
      const sshId = this.connections.get(socket.id);
      if (sshId) {
        sshService.closeConnection(sshId);
        this.connections.delete(socket.id);
      }
    });

    // 处理Socket断开连接
    socket.on('disconnect', (reason) => {
      console.log(`客户端断开连接 ${socket.id}, 原因: ${reason}`);
      const sshId = this.connections.get(socket.id);
      if (sshId) {
        sshService.closeConnection(sshId);
        this.connections.delete(socket.id);
      }
    });
    
    // 处理连接错误
    socket.on('error', (error) => {
      console.error(`客户端 ${socket.id} 连接错误:`, error);
      const sshId = this.connections.get(socket.id);
      if (sshId) {
        sshService.closeConnection(sshId);
        this.connections.delete(socket.id);
      }
    });
  }

  /**
   * 关闭Socket服务器
   */
  close() {
    if (this.io) {
      // 关闭所有SSH连接
      for (const sshId of this.connections.values()) {
        sshService.closeConnection(sshId);
      }
      this.connections.clear();

      // 关闭Socket服务器
      this.io.close(() => {
        console.log('Socket服务器已关闭');
      });
      
      // 关闭HTTP服务器
      if (this.httpServer) {
        this.httpServer.close();
      }
    }
  }
}

module.exports = new SocketServer(); 