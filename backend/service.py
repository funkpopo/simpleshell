from gevent import monkey
monkey.patch_all()

from flask import Flask, request, jsonify, send_file, Response
from flask_socketio import SocketIO
from flask_cors import CORS
import paramiko
import json
import os
import stat
import logging
import threading
import time
import tempfile
import io
from datetime import datetime
import socket
import sys
import requests
import atexit
import re
import httpx
from typing import Dict, Tuple, Optional
from functools import lru_cache
import uuid
import base64

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, 
                   cors_allowed_origins="*",
                   async_mode='gevent',
                   logger=True,
                   engineio_logger=True,
                   ping_timeout=300,
                   ping_interval=60)

# 配置更轻量的日志
logging.basicConfig(
    level=logging.WARNING,  # 只记录警告和错误
    format='%(asctime)s - %(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)

@lru_cache(maxsize=32)
def get_executable_dir():
    # 获取可执行文件所在目录
    if getattr(sys, 'frozen', False):
        # 生产环境
        return os.path.dirname(sys.executable)
    else:
        # 开发环境，使用 backend 目录
        return os.path.dirname(os.path.abspath(__file__))

# 配置文件路
CONFIG_PATH = os.path.join(get_executable_dir(), 'config.json')
# 日志文件路径
LOG_PATH = os.path.join(get_executable_dir(), 'sftp_log.log')

# 修改会话管理相关代码
class SSHSession:
    def __init__(self, ssh_client, channel, read_thread=None):
        self.ssh_client = ssh_client
        self.channel = channel
        self.active = True
        self.read_thread = read_thread
        self.lock = threading.Lock()
        self.client_id = None  # 添加客户端ID
        self.realtime_thread = None  # 添加实时线程属性

# 修改会话存储结构
ssh_sessions = {}
client_sessions = {}  # 添加客户端会话映射
sessions_lock = threading.Lock()

@socketio.on('connect')
def handle_connect():
    client_id = request.sid
    print(f"Client connected: {client_id}")
    with sessions_lock:
        client_sessions[client_id] = set()

@socketio.on('disconnect')
def handle_disconnect():
    client_id = request.sid
    print(f"Client disconnected: {client_id}")
    with sessions_lock:
        if client_id in client_sessions:
            # 不要立即清理会话，只记录客户端断
            print(f"Client {client_id} disconnected but keeping sessions")
            return

def load_config():
    try:
        if os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        return []
    except Exception as e:
        logger.error(f"Error loading config: {e}")
        return []

def save_config(config):
    try:
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
    except Exception as e:
        logger.error(f"Error saving config: {e}")
        raise

def log_sftp_operation(operation, path):
    try:
        with open(LOG_PATH, 'a', encoding='utf-8') as f:
            timestamp = datetime.utcnow().isoformat() + 'Z'
            f.write(f"{timestamp},{operation},{path}\n")
    except Exception as e:
        logger.error(f"Error logging SFTP operation: {e}")

@app.route('/health')
def health_check():
    return jsonify({"status": "healthy"})

@app.route('/get_connections', methods=['GET'])
def get_connections():
    return jsonify(load_config())

@app.route('/add_connection', methods=['POST'])
def add_connection():
    try:
        connection = request.json
        config = load_config()
        config.append(connection)
        save_config(config)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/add_folder', methods=['POST'])
def add_folder():
    try:
        folder = request.json
        config = load_config()
        config.append(folder)
        save_config(config)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/update_config', methods=['POST'])
def update_config():
    try:
        new_config = request.json
        save_config(new_config)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 分离 SSH SFTP 的连接创建函数
def create_base_client(connection):
    """创建基础 SSH 客户端"""
    ssh = None
    try:
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        
        connect_kwargs = {
            'hostname': connection['host'],
            'port': int(connection['port']),
            'username': connection['username'],
            'timeout': 30
        }
        
        # 身份验证配置
        if connection.get('authType') == 'password':
            # 解密 base64 编码
            import base64
            try:
                password = connection['password']
                password += '=' * ((4 - len(password) % 4) % 4)
                decoded_password = base64.b64decode(password).decode('utf-8')
                connect_kwargs['password'] = decoded_password
            except Exception as e:
                print(f"Base64 decryption failed: {e}")
                connect_kwargs['password'] = connection['password']
        else:
            # 使用私钥文件路径
            if connection.get('privateKeyPath'):
                try:
                    pkey = paramiko.RSAKey.from_private_key_file(
                        connection['privateKeyPath']
                    )
                    connect_kwargs['pkey'] = pkey
                except paramiko.ssh_exception.SSHException:
                    raise Exception('Invalid private key format or passphrase required')
                except IOError:
                    raise Exception('Failed to read private key file')
            else:
                raise Exception('Private key path is required for key authentication')
        
        ssh.connect(**connect_kwargs)
        return ssh
        
    except Exception as e:
        if ssh:
            ssh.close()
        raise

def create_ssh_client(connection):
    """SSH 客户端"""
    ssh = None
    try:
        ssh = create_base_client(connection)
        
        # 创建并配置通道，使用更大的初始终端大小
        channel = ssh.invoke_shell(
            term='xterm-256color',
            width=132,  # 更大的初始宽度
            height=43,  # 更大的初始高度
            environment={
                'TERM': 'xterm-256color',
                'COLORTERM': 'truecolor',
                'TERM_PROGRAM': 'xterm',
                'LANG': 'en_US.UTF-8',
                'LC_ALL': 'en_US.UTF-8',
                'FORCE_COLOR': 'true',
                'COLUMNS': '132',  # 设置环境变量
                'LINES': '43'
            }
        )
        
        # 配置通道
        channel.settimeout(0.001)
        channel.setblocking(0)
        
        # 配置传输层以提高性能
        transport = ssh.get_transport()
        if transport:
            transport.set_keepalive(60)
            transport.use_compression(True)
            transport.window_size = 2147483647
            transport.packetizer.REKEY_BYTES = pow(2, 40)
            transport.packetizer.REKEY_PACKETS = pow(2, 40)
            transport.default_max_packet_size = 32768
        
        return ssh, channel
        
    except Exception as e:
        if ssh:
            try:
                ssh.close()
            except:
                pass
        raise

def create_sftp_client(connection):
    """创建用于文件传输的 SFTP 客户端"""
    ssh = None  # 初始化 ssh 为 None
    try:
        ssh = create_base_client(connection)
        sftp = ssh.open_sftp()
        return ssh, sftp
    except Exception as e:
        # 如果 SFTP 连接失败，确保关闭连接
        if ssh:
            try:
                ssh.close()
            except:
                pass
        raise  # 重新抛出原始异常

# 修改 read_output 函数
def read_output(session_id, channel):
    try:
        print(f"Starting read thread for session {session_id}")
        last_activity = time.time()
        
        while True:
            with sessions_lock:
                if session_id not in ssh_sessions or not ssh_sessions[session_id].active:
                    break
            
            try:
                if channel.recv_ready():
                    data = channel.recv(1024)
                    if data:
                        try:
                            text = data.decode('utf-8', errors='ignore')
                            print(f"Sending output for session {session_id}: {text[:100]}")
                            socketio.emit('ssh_output', {
                                'session_id': session_id,
                                'output': text
                            })
                            last_activity = time.time()  # 更新最后活动时间
                        except Exception as e:
                            print(f"Error processing output: {e}")
                else:
                    # 每 60 秒发送一次保活信号
                    current_time = time.time()
                    if current_time - last_activity > 60:
                        try:
                            channel.send('\x00')  # 发送空字节作为保活信号
                            last_activity = current_time
                        except Exception as e:
                            print(f"Error sending keepalive: {e}")
                            break
                    
                    socketio.sleep(0.1)  # 增加睡眠时间，减少 CPU 使用
                
                # 检查通道状态
                if channel.closed or not channel.get_transport() or not channel.get_transport().is_active():
                    print(f"Channel closed for session {session_id}")
                    break
                    
            except socket.timeout:
                continue
            except Exception as e:
                print(f"Error reading from channel: {e}")
                break
                
    except Exception as e:
        print(f"Error in read_output for session {session_id}: {e}")
    finally:
        print(f"Read thread ending for session {session_id}")
        with sessions_lock:
            if session_id in ssh_sessions:
                ssh_sessions[session_id].active = False
        socketio.emit('ssh_closed', {
            'session_id': session_id,
            'message': 'Connection closed'
        })

@socketio.on('open_ssh')
def handle_ssh_connection(data):
    try:
        client_id = request.sid
        session_id = data['session_id']
        print(f"Opening SSH connection for session {session_id} from client {client_id}")
        
        try:
            # 创建新的 SSH 客户端和通道
            ssh, channel = create_ssh_client(data)
        except ConnectionError as conn_err:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Network Connection Failed: {str(conn_err)}',
                'type': 'network'
            }, room=client_id)
            return
        except paramiko.AuthenticationException:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': 'Authentication Failed: Invalid username, password or key',
                'type': 'auth'
            }, room=client_id)
            return
        except Exception as e:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Connection failed: {str(e)}',
                'type': 'unknown'
            }, room=client_id)
            return
        
        try:
            # 创建并启动读取线程
            read_thread = threading.Thread(
                target=read_output,
                args=(session_id, channel),
                daemon=True
            )
            
            # 创建新的会话对象
            session = SSHSession(ssh, channel, read_thread)
            session.client_id = client_id
            
            # 安全地存储会话
            with sessions_lock:
                ssh_sessions[session_id] = session
                if client_id not in client_sessions:
                    client_sessions[client_id] = set()
                client_sessions[client_id].add(session_id)
            
            # 先启动读取线程
            read_thread.start()
            
            # 等待一小段时间确保通道准备就绪
            socketio.sleep(0.1)
            
            # 发送连接成功消息
            socketio.emit('ssh_connected', {
                'session_id': session_id,
                'message': 'Connected successfully'
            }, room=client_id)
            
            print(f"SSH connection established for session {session_id}")
            
        except Exception as e:
            print(f"Error in session initialization: {e}")
            if ssh:
                ssh.close()
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Session initialization error: {str(e)}'
            }, room=client_id)
            return
            
    except Exception as e:
        print(f"Error establishing SSH connection: {e}")
        socketio.emit('ssh_error', {
            'session_id': session_id,
            'error': f'Connection error: {str(e)}'
        }, room=client_id)

# 修改 handle_ssh_input 函数
@socketio.on('ssh_input')
def handle_ssh_input(data):
    try:
        client_id = request.sid
        session_id = data['session_id']
        input_data = data['input']
        
        print(f"Received input for session {session_id}: {input_data.encode()}")
        
        with sessions_lock:
            session = ssh_sessions.get(session_id)
            if not session or not session.active:
                raise Exception('Session not found or inactive')
            if session.client_id != client_id:
                raise Exception('Session belongs to another client')
            
            with session.lock:
                # 直接发送输入到服务器，让服务器处理回显
                session.channel.send(input_data)
                print(f"Input sent to channel for session {session_id}")
                
    except Exception as e:
        print(f"Error handling SSH input: {e}")
        socketio.emit('ssh_error', {
            'session_id': session_id,
            'error': str(e)
        })

@socketio.on('close_ssh')
def handle_ssh_close(data):
    try:
        client_id = request.sid
        session_id = data['session_id']
        print(f"Closing SSH session {session_id} for client {client_id}")
        
        with sessions_lock:
            if session_id in ssh_sessions:
                session = ssh_sessions[session_id]
                if session.client_id == client_id:  # 验证会话所有权
                    session.active = False
                    with session.lock:
                        try:
                            session.channel.close()
                            session.ssh_client.close()
                        except:
                            pass
                    
                    del ssh_sessions[session_id]
                    if client_id in client_sessions:
                        client_sessions[client_id].remove(session_id)
                    
                    socketio.emit('ssh_closed', {
                        'session_id': session_id,
                        'message': 'Connection closed'
                    })
                    print(f"Session {session_id} closed successfully")
                else:
                    print(f"Session {session_id} belongs to another client")
            else:
                print(f"Session {session_id} not found")
    except Exception as e:
        print(f"Error closing session {session_id}: {e}")
        socketio.emit('ssh_error', {
            'session_id': session_id,
            'error': str(e)
        })

@socketio.on('resize')
def handle_resize(data):
    """处理终端大小调整请求"""
    try:
        session_id = data.get('session_id')
        if not session_id or session_id not in ssh_sessions:
            return
            
        # 获取新的终端大小
        cols = max(80, min(data.get('cols', 80), 500))  # 限制列范围
        rows = max(24, min(data.get('rows', 24), 200))  # 限制行范围
        
        session = ssh_sessions[session_id]
        channel = session.channel
        
        # 调整终端大小
        try:
            channel.resize_pty(width=cols, height=rows)
            # 同时更新环境变量
            channel.update_environment({
                'COLUMNS': str(cols),
                'LINES': str(rows)
            })
            logger.info(f"Resized terminal for session {session_id} to {cols}x{rows}")
        except Exception as e:
            logger.error(f"Error resizing terminal: {e}")
            
    except Exception as e:
        logger.error(f"Error in handle_resize: {e}")

# SFTP相关路由
@app.route('/sftp_list_directory', methods=['POST'])
def list_directory():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']
        show_hidden = data.get('showHidden', True)

        ssh, sftp = create_sftp_client(connection)
        try:
            items = []
            for item in sftp.listdir_attr(path):
                if not show_hidden and item.filename.startswith('.'):
                    continue
                    
                # 转换时间戳为秒级时间戳
                mod_time = int(item.st_mtime)
                
                items.append({
                    'name': item.filename,
                    'path': os.path.join(path, item.filename).replace('\\', '/'),
                    'isDirectory': stat.S_ISDIR(item.st_mode),
                    'size': item.st_size,
                    'modTime': mod_time,  # 使用秒级时间戳
                    'isHidden': item.filename.startswith('.')
                })
            return jsonify(items)
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 添加传输进度跟踪类
class TransferProgress:
    def __init__(self, total_size: int, operation: str):
        self.total_size = total_size
        self.current_size = 0
        self.start_time = time.time()
        self.operation = operation  # 'upload' or 'download'
        self._lock = threading.Lock()
        
        # 添加新的属性用于计算速度
        self._last_update_time = time.time()
        self._last_size = 0
        self._speed_samples = []  # 用于计算平均速度
        self.speed = 0.0
        self.progress = 0.0
        self.estimated_time = 0
        self.status = 'normal'  # 添加状态字段：normal, cancelled, error
        self._cancelled = threading.Event()  # 添加取消事件

    def update(self, bytes_transferred: int):
        """更新传输进度"""
        with self._lock:
            current_time = time.time()
            self.current_size = bytes_transferred
            
            # 计算速度
            time_diff = current_time - self._last_update_time
            if time_diff > 0:
                # 计算瞬时速度
                size_diff = self.current_size - self._last_size
                instant_speed = size_diff / time_diff 
                
                # 添加到速度样本中
                self._speed_samples.append(instant_speed)
                if len(self._speed_samples) > 10:  # 保留最近10个样本
                    self._speed_samples.pop(0)
                
                # 计算平均速度
                self.speed = sum(self._speed_samples) / len(self._speed_samples) / 2
                
                # 更新进度
                self.progress = (self.current_size / self.total_size) * 100 if self.total_size > 0 else 0
                
                # 计算剩余时间
                remaining_bytes = self.total_size - self.current_size
                self.estimated_time = remaining_bytes / self.speed if self.speed > 0 else 0
                
                # 更新最后一次记录的值
                self._last_update_time = current_time
                self._last_size = self.current_size

    def cancel(self):
        """标记传输为已取消状态"""
        with self._lock:
            self.status = 'cancelled'
            self._cancelled.set()  # 设置取消事件

    def is_cancelled(self) -> bool:
        """检查传输是否被取消"""
        return self._cancelled.is_set()

    def get_status(self) -> Dict:
        """获取当前传输状态"""
        with self._lock:
            status_data = {
                'progress': round(self.progress, 2),
                'speed': self.format_speed(self.speed),
                'estimated_time': self.format_time(self.estimated_time),
                'transferred': self.format_size(self.current_size),
                'total': self.format_size(self.total_size),
                'status': self.status  # 添加状态信息
            }
            return status_data

    @staticmethod
    def format_speed(speed: float) -> str:
        """格式化速度显示"""
        if speed >= 1024 * 1024 * 1024:
            return f"{speed / (1024 * 1024 * 1024):.2f} GB/s"
        elif speed >= 1024 * 1024:
            return f"{speed / (1024 * 1024):.2f} MB/s"
        elif speed >= 1024:
            return f"{speed / 1024:.2f} KB/s"
        return f"{speed:.2f} B/s"

    @staticmethod
    def format_time(seconds: float) -> str:
        """格式化时间显示"""
        if seconds < 60:
            return f"{seconds:.0f}s"
        elif seconds < 3600:
            return f"{seconds / 60:.0f}m {seconds % 60:.0f}s"
        else:
            hours = seconds // 3600
            minutes = (seconds % 3600) // 60
            return f"{hours:.0f}h {minutes:.0f}m"

    @staticmethod
    def format_size(size: int) -> str:
        """格式化文件大小显示"""
        for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
            if size < 1024:
                return f"{size:.2f} {unit}"
            size /= 1024
        return f"{size:.2f} PB"

# 添加传输管理器
class TransferManager:
    def __init__(self):
        self._transfers = {}
        self._lock = threading.Lock()
        self._cancel_flags = {}  # 添加取消标志字典

    def cancel_transfer(self, transfer_id: str) -> bool:
        """取消指定的传输任务"""
        with self._lock:
            transfer = self._transfers.get(transfer_id)
            if transfer:
                transfer.cancel()
                self._cancel_flags[transfer_id] = True
                return True
            return False

    def is_cancelled(self, transfer_id: str) -> bool:
        """检查传输是否被取消"""
        with self._lock:
            return self._cancel_flags.get(transfer_id, False)

    def create_transfer(self, transfer_id: str, total_size: int, operation: str) -> TransferProgress:
        with self._lock:
            progress = TransferProgress(total_size, operation)
            self._transfers[transfer_id] = progress
            self._cancel_flags[transfer_id] = False  # 初始化取消标志
            return progress

    def get_transfer(self, transfer_id: str) -> Optional[TransferProgress]:
        with self._lock:
            return self._transfers.get(transfer_id)

    def remove_transfer(self, transfer_id: str):
        with self._lock:
            self._transfers.pop(transfer_id, None)
            self._cancel_flags.pop(transfer_id, None)

# 创建全局传输管理器实例
transfer_manager = TransferManager()

# 修改上传文件的路由
@app.route('/sftp_upload_file', methods=['POST'])
def upload_file():
    temp_file_path = None
    try:
        data = request.json
        connection = data['connection']
        path = data['path']
        filename = data['filename']
        content = data.get('content')
        chunk_index = data.get('chunkIndex', 0)
        is_last_chunk = data.get('isLastChunk', True)
        temp_file_id = data.get('tempFileId')
        transfer_id = data.get('transferId')
        total_size = data.get('totalSize', 0)

        # 获取或创建传输进度跟踪器
        if chunk_index == 0:
            transfer_progress = transfer_manager.create_transfer(transfer_id, total_size, 'upload')
        else:
            transfer_progress = transfer_manager.get_transfer(transfer_id)

        if transfer_progress and transfer_progress.is_cancelled():
            # 如果传输已被取消，立即返回
            return jsonify({"status": "cancelled", "message": "Transfer cancelled"}), 200

        temp_dir = os.path.join(tempfile.gettempdir(), 'sftp_uploads')
        os.makedirs(temp_dir, exist_ok=True)

        try:
            ssh, sftp = create_sftp_client(connection)
            try:
                if chunk_index == 0:
                    temp_file_id = str(uuid.uuid4())
                    temp_file_path = os.path.join(temp_dir, temp_file_id)
                else:
                    temp_file_path = os.path.join(temp_dir, temp_file_id)

                # 解码并写入当前块
                if content:
                    chunk_data = base64.b64decode(content)
                    with open(temp_file_path, 'ab') as f:
                        f.write(chunk_data)
                    
                    # 更新进度并检查是否取消
                    if transfer_progress:
                        current_size = os.path.getsize(temp_file_path)
                        transfer_progress.update(current_size)
                        if transfer_progress.is_cancelled():
                            raise Exception("Transfer cancelled")

                # 如果是最后一个块，执行上传
                if is_last_chunk:
                    remote_path = os.path.join(path, filename).replace('\\', '/')
                    
                    def progress_callback(transferred, total):
                        if transfer_progress:
                            transfer_progress.update(transferred)
                            # 检查是否取消
                            if transfer_progress.is_cancelled():
                                raise Exception("Transfer cancelled")
                    
                    # 上传文件
                    with open(temp_file_path, 'rb') as f:
                        sftp.putfo(f, remote_path, callback=progress_callback)
                    
                    # 记录操作
                    log_sftp_operation('upload', remote_path)
                    
                    # 清理临时文件
                    try:
                        os.unlink(temp_file_path)
                    except:
                        pass
                    
                    # 移除传输进度跟踪器
                    transfer_manager.remove_transfer(transfer_id)
                    
                    return jsonify({"status": "success"})
                
                # 如果不是最后一个块，返回临时文件ID
                return jsonify({
                    "status": "chunk_uploaded",
                    "tempFileId": temp_file_id
                })

            finally:
                sftp.close()
                ssh.close()

        except Exception as e:
            if "Transfer cancelled" in str(e):
                # 传输被取消的情况
                return jsonify({"status": "cancelled", "message": "Transfer cancelled"}), 200
            raise

    except Exception as e:
        logger.error(f"Upload error: {str(e)}")
        # 清理临时文件
        if temp_file_path and os.path.exists(temp_file_path):
            try:
                os.unlink(temp_file_path)
            except:
                pass
        # 移除传输进度跟踪器
        if transfer_id:
            transfer_manager.remove_transfer(transfer_id)
        return jsonify({"error": str(e)}), 500

# 修改下载文件的路由
@app.route('/sftp_download_file', methods=['POST'])
def download_file():
    temp_file = None
    try:
        data = request.json
        connection = data['connection']
        path = data['path']
        transfer_id = data.get('transferId')

        ssh, sftp = create_sftp_client(connection)
        try:
            file_size = sftp.stat(path).st_size
            transfer_progress = transfer_manager.create_transfer(transfer_id, file_size, 'download')

            def generate():
                nonlocal temp_file
                try:
                    temp_file = tempfile.NamedTemporaryFile(delete=False)
                    network_bytes = [0]

                    def progress_callback(transferred, total):
                        # 检查是否取消
                        if transfer_progress.is_cancelled():
                            raise Exception("Transfer cancelled")
                        network_bytes[0] += transferred
                        if transfer_progress:
                            transfer_progress.update(transferred)

                    try:
                        sftp.get(path, temp_file.name, callback=progress_callback)
                    except Exception as e:
                        if transfer_progress.is_cancelled():
                            raise Exception("Transfer cancelled")
                        raise e

                    chunk_size = 8192
                    with open(temp_file.name, 'rb') as f:
                        while True:
                            if transfer_progress.is_cancelled():
                                raise Exception("Transfer cancelled")
                            chunk = f.read(chunk_size)
                            if not chunk:
                                break
                            yield chunk

                except Exception as e:
                    if "Transfer cancelled" in str(e):
                        # 传输被取消的情况
                        yield b''  # 发送空字节以结束响应
                    else:
                        raise
                finally:
                    try:
                        temp_file.close()
                        os.unlink(temp_file.name)
                    except:
                        pass
                    transfer_manager.remove_transfer(transfer_id)
                    sftp.close()
                    ssh.close()

            response = Response(
                generate(),
                mimetype='application/octet-stream',
                headers={
                    'Content-Disposition': f'attachment; filename={os.path.basename(path)}',
                    'Content-Length': str(file_size)
                }
            )
            return response

        except Exception as e:
            sftp.close()
            ssh.close()
            if transfer_id:
                transfer_manager.remove_transfer(transfer_id)
            raise

    except Exception as e:
        if "Transfer cancelled" in str(e):
            return jsonify({"status": "cancelled", "message": "Transfer cancelled"}), 200
        return jsonify({"error": str(e)}), 500

# 添加获取传输进度的路由
@app.route('/transfer_progress/<transfer_id>', methods=['GET'])
def get_transfer_progress(transfer_id):
    try:
        transfer = transfer_manager.get_transfer(transfer_id)
        if transfer:
            return jsonify(transfer.get_status())
        return jsonify({"error": "Transfer not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sftp_delete_item', methods=['POST'])
def delete_item():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']

        ssh, sftp = create_sftp_client(connection)
        try:
            def remove_recursive(sftp_client, remote_path):
                """递归删除文件或目录"""
                try:
                    # 获取文件/目录属性
                    stat_info = sftp_client.stat(remote_path)
                    
                    # 如果是目录，递归删除其内容
                    if stat.S_ISDIR(stat_info.st_mode):
                        for item in sftp_client.listdir_attr(remote_path):
                            item_path = os.path.join(remote_path, item.filename).replace('\\', '/')
                            remove_recursive(sftp_client, item_path)
                        
                        # 删除空目录
                        sftp_client.rmdir(remote_path)
                    else:
                        # 如果是文件，直接删除
                        sftp_client.remove(remote_path)
                
                except IOError as e:
                    # 处理权限或其他删除错误
                    logging.error(f"Error deleting {remote_path}: {e}")
                    raise

            # 执行递归删除
            remove_recursive(sftp, path)
            
            log_sftp_operation('delete', path)
            return jsonify({"status": "success"})
        
        finally:
            sftp.close()
            ssh.close()
    
    except Exception as e:
        logging.error(f"Error in delete_item: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/sftp_rename_item', methods=['POST'])
def rename_item():
    try:
        data = request.json
        connection = data['connection']
        old_path = data['oldPath']
        new_path = data['newPath']

        ssh, sftp = create_sftp_client(connection)
        try:
            sftp.rename(old_path, new_path)
            log_sftp_operation('rename', f"{old_path} to {new_path}")
            return jsonify({"status": "success"})
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        logging.error("Exception in rename_item: %s", str(e))
        return jsonify({"error": "An internal error has occurred."}), 500

@app.route('/sftp_create_folder', methods=['POST'])
def create_folder():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']

        ssh, sftp = create_sftp_client(connection)
        try:
            sftp.mkdir(path)
            log_sftp_operation('create_folder', path)
            return jsonify({"status": "success"})
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        logging.error("Exception in create_folder: %s", str(e))
        return jsonify({"error": "An internal error has occurred."}), 500

@app.route('/get_sftp_history', methods=['GET'])
def get_sftp_history():
    try:
        with open(LOG_PATH, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        logging.error("Exception in get_sftp_history: %s", str(e))
        return jsonify({"error": "An internal error has occurred."}), 500

@app.route('/clear_sftp_history', methods=['POST'])
def clear_sftp_history():
    try:
        with open(LOG_PATH, 'w', encoding='utf-8') as f:
            f.write('')
        return jsonify({"status": "success"})
    except Exception as e:
        logging.error("Exception in clear_sftp_history: %s", str(e))
        return jsonify({"error": "An internal error has occurred."}), 500

# 在文件开头添加 RequestsSession 类
class RequestsSession:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'SimpleShell'
        }
        # 从环境变量获取代理设置
        self.proxies = {}
        if os.environ.get('HTTP_PROXY'):
            self.proxies['http'] = os.environ.get('HTTP_PROXY')
        if os.environ.get('HTTPS_PROXY'):
            self.proxies['https'] = os.environ.get('HTTPS_PROXY')

    def get(self, url, timeout=15):
        try:
            response = self.session.get(
                url,
                headers=self.headers,
                proxies=self.proxies,
                timeout=timeout,
                verify=True
            )
            response.raise_for_status()
            return response
        except Exception as e:
            raise e
        
    def close(self):
        self.session.close()

# 添加全局 requests_session 对象
requests_session = RequestsSession()

# 在应用退出时关闭 session
@atexit.register
def cleanup():
    requests_session.close()

# 修改 cleanup 相关代码，确保实时线程也被正确清理
def cleanup_session(session):
    try:
        if not session.active:
            return
            
        session.active = False
        if session.channel:
            try:
                session.channel.close()
            except:
                pass
        if session.ssh_client:
            try:
                session.ssh_client.close()
            except:
                pass
        if session.read_thread and session.read_thread.is_alive():
            session.read_thread.join(timeout=1)
    except Exception as e:
        print(f"Error in cleanup_session: {e}")

class SSHService:
    # ... 现有代码 ...
    
    async def get_resource_usage(self, session_id: str) -> Dict[str, float]:
        """获取目标服务器的资源使用情况"""
        try:
            if session_id not in self.ssh_clients:
                return {"cpu": 0, "memory": 0}
            
            client = self.ssh_clients[session_id]
            
            # 获取内存使用情况
            _, stdout, _ = await client.exec_command("free | grep Mem")
            mem_info = stdout.read().decode().strip()
            total_mem, used_mem = self._parse_memory_info(mem_info)
            mem_usage = (used_mem / total_mem * 100) if total_mem > 0 else 0
            
            # 获取CPU使用情况
            _, stdout, _ = await client.exec_command("top -bn1 | grep 'Cpu(s)'")
            cpu_info = stdout.read().decode().strip()
            cpu_usage = self._parse_cpu_info(cpu_info)
            
            return {
                "cpu": round(cpu_usage, 1),
                "memory": round(mem_usage, 1)
            }
        except Exception as e:
            logger.error(f"Error getting resource usage: {str(e)}")
            return {"cpu": 0, "memory": 0}
    
    def _parse_memory_info(self, mem_info: str) -> Tuple[float, float]:
        """解析内存信息"""
        try:
            parts = mem_info.split()
            total = float(parts[1])
            used = float(parts[2])
            return total, used
        except (IndexError, ValueError):
            return 0, 0
    
    def _parse_cpu_info(self, cpu_info: str) -> float:
        """解析CPU信息"""
        try:
            # 提取CPU使用率
            match = re.search(r'(\d+\.\d+)\s*id', cpu_info)
            if match:
                idle = float(match.group(1))
                return 100.0 - idle
            return 0
        except (AttributeError, ValueError):
            return 0

# 在 SocketService 类中添加新的处理方法
class SocketService:    
    async def handle_resource_monitor(self, sid: str, data: dict):
        """处理资源监控请求"""
        try:
            session_id = data.get('session_id')
            if not session_id:
                return
                
            usage = await self.ssh_service.get_resource_usage(session_id)
            await self.sio.emit('resource_usage', {
                'session_id': session_id,
                'usage': usage
            }, room=sid)
            
        except Exception as e:
            logger.error(f"Error in resource monitoring: {str(e)}")
    
    def register_handlers(self):
        self.sio.on('monitor_resources', self.handle_resource_monitor)

# 修改 handle_ssh_connection 函数，添加资源监控相关代码
@socketio.on('monitor_resources')
def handle_resource_monitor(data):
    try:
        session_id = data.get('session_id')
        if not session_id or session_id not in ssh_sessions:
            logger.warning(f"Invalid session for resource monitoring: {session_id}")
            return
            
        session = ssh_sessions[session_id]
        ssh_client = session.ssh_client
        
        logger.info(f"Getting resource usage for session {session_id}")
        
        try:
            # 使用更通用的命令获取资源使用情况
            # 尝试多种方法获取 CPU 和内存使用率
            cpu_cmd = "top -bn1 | grep 'Cpu(s)' || ps -eo %cpu | awk '{sum+=$1} END {print sum}'"
            mem_cmd = "free | grep Mem || cat /proc/meminfo"
            
            # 执行命令
            stdin, stdout, stderr = ssh_client.exec_command(cpu_cmd)
            cpu_output = stdout.read().decode().strip()
            
            stdin, stdout, stderr = ssh_client.exec_command(mem_cmd)
            mem_output = stdout.read().decode().strip()
            
            # 解析 CPU 使用率
            cpu_usage = 0
            if 'Cpu(s)' in cpu_output:
                # 标准 top 输出
                cpu_match = re.search(r'(\d+\.\d+)\s*%?\s*id', cpu_output)
                if cpu_match:
                    idle = float(cpu_match.group(1))
                    cpu_usage = 100.0 - idle
            else:
                # 备用方案：直接计算 CPU 使用率
                try:
                    cpu_usage = float(cpu_output)
                except ValueError:
                    cpu_usage = 0
            
            # 解析内存使用率
            mem_usage = 0
            if 'Mem:' in mem_output:
                # 标准 free 输出
                mem_parts = mem_output.split()
                if len(mem_parts) >= 7:
                    total_mem = float(mem_parts[1])
                    used_mem = float(mem_parts[2])
                    mem_usage = (used_mem / total_mem * 100) if total_mem > 0 else 0
            elif 'MemTotal:' in mem_output:
                # /proc/meminfo 格式
                mem_lines = mem_output.split('\n')
                total_mem = used_mem = 0
                for line in mem_lines:
                    if line.startswith('MemTotal:'):
                        total_mem = int(line.split()[1]) * 1024
                    elif line.startswith('MemAvailable:'):
                        used_mem = total_mem - (int(line.split()[1]) * 1024)
                mem_usage = (used_mem / total_mem * 100) if total_mem > 0 else 0
            
            logger.info(f"Resource usage - CPU: {cpu_usage}%, Memory: {mem_usage}%")
            
            # 发送资源使用情况
            socketio.emit('resource_usage', {
                'session_id': session_id,
                'usage': {
                    'cpu': round(cpu_usage, 1),
                    'memory': round(mem_usage, 1)
                }
            })
                
        except Exception as e:
            logger.error(f"Error executing commands: {str(e)}")
            raise
            
    except Exception as e:
        logger.error(f"Error in resource monitoring: {str(e)}")
        socketio.emit('resource_usage', {
            'session_id': session_id,
            'usage': {
                'cpu': 0,
                'memory': 0
            }
        })

# AI 相关的路由和函数
@app.route('/chat', methods=['POST'])
def handle_chat():
    try:
        # 仅在需要时导入
        from importlib import import_module
        from flask import Response, stream_with_context
        
        data = request.json
        if not data.get('api_key'):
            return jsonify({"error": "API key is required"}), 400

        provider = data.get('provider', '').lower()
        model_name = data.get('model')
        messages = data.get('messages', [])
        api_key = data.get('api_key')
        api_url = data.get('api_url', '').rstrip('/')
        temperature = float(data.get('temperature', 0.7))
        max_tokens = int(data.get('max_tokens', 2048))

        logger.info(f"Using temperature: {temperature}, max_tokens: {max_tokens}")

        def generate_stream():
            try:
                if provider == 'openai':
                    openai = import_module('openai')
                    client = openai.OpenAI(
                        api_key=api_key,
                        base_url=api_url
                    )
                    
                    stream = client.chat.completions.create(
                        model=model_name,
                        messages=messages,
                        temperature=temperature,
                        max_tokens=max_tokens,
                        stream=True  # 启流式输出
                    )
                    
                    for chunk in stream:
                        if chunk.choices[0].delta.content is not None:
                            yield f"data: {json.dumps({'content': chunk.choices[0].delta.content})}\n\n"

                elif provider == 'zhipu':
                    zhipuai = import_module('zhipuai')
                    zhipuai.api_key = api_key
                    response = zhipuai.model_api.invoke(
                        model=model_name,
                        prompt=messages,
                        temperature=temperature,
                        stream=True  # 启用流式输出
                    )
                    
                    for chunk in response:
                        if chunk['data'].get('choices', [{}])[0].get('content'):
                            yield f"data: {json.dumps({'content': chunk['data']['choices'][0]['content']})}\n\n"

                elif provider == 'qwen':
                    try:
                        qwenai = import_module('openai')
                        client = qwenai.OpenAI(
                            api_key=api_key,
                            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
                        )
                        
                        logger.info(f"Connecting to Qwen API with model: {model_name}")
                        
                        # 创建流式聊天完成
                        stream = client.chat.completions.create(
                            model=model_name,  # 例如: "qwen-plus"
                            messages=messages,
                            temperature=temperature,
                            max_tokens=4096,
                            stream=True  # 启用流式输出
                        )
                        
                        # 处理流式响应
                        for chunk in stream:
                            if chunk.choices[0].delta.content is not None:
                                yield f"data: {json.dumps({'content': chunk.choices[0].delta.content})}\n\n"
                                
                    except Exception as e:
                        error_msg = f"Qwen API error: {str(e)}"
                        logger.error(error_msg)
                        logger.error(f"Error type: {type(e)}")
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"

                elif provider == 'gemini':
                    genai = import_module('google.generativeai')
                    genai.configure(api_key=api_key)
                    
                    # 使用户指定的模型名称
                    model = genai.GenerativeModel(model_name)
                    chat = model.start_chat()
                    
                    for msg in messages[:-1]:  # 处理历史消息
                        if msg["role"] == "user":
                            chat.send_message(msg["content"])
                    
                    # 流式处理最后一条消息
                    # 创建模型时设置生成参数
                    generation_config = {
                        'temperature': temperature,
                        'max_output_tokens': max_tokens,
                    }
                    
                    model = genai.GenerativeModel(
                        model_name=model_name,
                        generation_config=generation_config
                    )
                    chat = model.start_chat()
                    
                    # 重新发送历史消息
                    for msg in messages[:-1]:
                        if msg["role"] == "user":
                            chat.send_message(msg["content"])
                    
                    # 发送最后一条消息并获取流式响应
                    response = chat.send_message(
                        messages[-1]["content"],
                        stream=True  # 只保留 stream 参数
                    )
                    
                    for chunk in response:
                        if chunk.text:
                            yield f"data: {json.dumps({'content': chunk.text})}\n\n"

                elif provider == 'ollama':  
                    ollama = import_module('ollama')                  
                    try:
                        # 配置客户端
                        client = ollama.Client(
                            host=api_url,
                            timeout=httpx.Timeout(60.0, connect=30.0)
                        )
                        
                        logger.info(f"Attempting to connect to Ollama server at {api_url}...")
                        
                        # 使用 stream=True 进行流式处理
                        response = client.chat(
                            model=model_name,
                            messages=messages,
                            options={
                                "temperature": temperature,
                                "num_predict": max_tokens
                            },
                            stream=True
                        )
                        
                        # 处理流式响应
                        for chunk in response:
                            try:
                                if chunk and 'message' in chunk:
                                    content = chunk['message']['content']
                                    if content.strip():  # 确保内容不为空
                                        yield f"data: {json.dumps({'content': content})}\n\n"
                            except Exception as e:
                                logger.error(f"Error processing chunk: {e}")
                                continue
                                
                    except httpx.ReadError as e:
                        error_msg = f"Connection error: {e}"
                        logger.error(error_msg)
                        logger.error("Please check if the Ollama server is accessible and the URL is correct")
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"
                        
                    except httpx.ConnectError as e:
                        error_msg = f"Failed to connect to server: {e}"
                        logger.error(error_msg)
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"
                        
                    except Exception as e:
                        error_msg = f"Unexpected error: {e}"
                        logger.error(error_msg)
                        logger.error(f"Error type: {type(e)}")
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"

                elif provider == 'siliconflow':
                    silicon = import_module('openai')
                    try:
                        client = silicon.OpenAI(
                            base_url=api_url or "https://api.siliconflow.cn/v1",
                            api_key=api_key
                        )
                        
                        # 创建流式聊天完成
                        stream = client.chat.completions.create(
                            model=model_name,
                            messages=messages,
                            temperature=temperature,
                            max_tokens=max_tokens,
                            stream=True
                        )
                        
                        # 处理流式响应
                        for chunk in stream:
                            if chunk.choices[0].delta.content is not None:
                                yield f"data: {json.dumps({'content': chunk.choices[0].delta.content})}\n\n"
                                
                    except Exception as e:
                        error_msg = f"SiliconFlow API error: {str(e)}"
                        logger.error(error_msg)
                        logger.error(f"Error type: {type(e)}")
                        if "max_tokens" in str(e):
                            error_msg = "Max Tokens value is too large. Please reduce it and try again."
                        yield f"data: {json.dumps({'error': error_msg})}\n\n"
                
            except Exception as e:
                logger.error(f"Error in stream generation: {str(e)}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(
            stream_with_context(generate_stream()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no'
            }
        )

    except Exception as e:
        logger.error(f"Error in chat handler: {str(e)}")
        return jsonify({"error": str(e)}), 500

def profile_startup():
    import cProfile
    import pstats
    
    profiler = cProfile.Profile()
    profiler.enable()
    
    # 主启动逻辑
    socketio.run(app, host='0.0.0.0', port=5000, debug=False, use_reloader=False)
    
    profiler.disable()
    stats = pstats.Stats(profiler).sort_stats('cumulative')
    stats.print_stats()

def minimal_startup_checks():
    # 仅进行最小必要的启动检查
    try:
        # 快速检查目录是否存在，避免复杂的创建逻辑
        os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    except Exception as e:
        logger.warning(f"Startup directory check failed: {e}")

def log_startup_performance():
    import time
    start_time = time.time()
    
    # 记录启动关键步骤的耗时
    startup_steps = {
        'config_load': 0,
        'log_setup': 0,
        'socket_init': 0
    }
    
    # 在各步骤记录耗时
    end_time = time.time()
    total_startup_time = end_time - start_time
    
    logger.info(f"Total Startup Time: {total_startup_time:.2f} seconds")
    logger.info(f"Startup Steps: {startup_steps}")


@app.route('/sftp_read_file', methods=['POST'])
def read_file():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']

        ssh, sftp = create_sftp_client(connection)
        try:
            # 获取文件属性
            stat_info = sftp.stat(path)
            
            # 限制文件大小，防止读取过大文件
            max_file_size = 3 * 1024 * 1024  # 3MB

            if stat_info.st_size > max_file_size:
                return jsonify({
                    "error": "File too large to preview",
                    "size": stat_info.st_size,
                    "type": "large"
                }), 413  # Payload Too Large

            # 读取文件内容，使用 'replace' 处理无法解码的字符
            with sftp.file(path, 'r') as remote_file:
                content = remote_file.read().decode('utf-8', errors='replace')
            
            # 如果是图片，返回 Base64 编码
            file_extension = path.split('.')[-1].lower()
            image_extensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg']
            
            if file_extension in image_extensions:
                # 对于图片，重新读取并转换为 Base64
                with sftp.file(path, 'rb') as img_file:
                    import base64
                    base64_content = base64.b64encode(img_file.read()).decode('utf-8')
                    return jsonify({
                        "content": base64_content,
                        "type": "image",
                        "size": stat_info.st_size,
                        "extension": file_extension
                    })
            
            return jsonify({
                "content": content,
                "type": "text",
                "size": stat_info.st_size,
                "extension": file_extension
            })
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        logging.error(f"Error reading file {path}: {e}")
        return jsonify({"error": str(e)}), 500

# 添加取消传输的路由
@app.route('/cancel_transfer/<transfer_id>', methods=['POST'])
def cancel_transfer(transfer_id):
    try:
        if transfer_manager.cancel_transfer(transfer_id):
            return jsonify({"status": "success", "message": "Transfer cancelled"})
        return jsonify({"status": "error", "message": "Transfer not found"}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    try:
        # 确保日志文件目录存在
        log_dir = os.path.dirname(LOG_PATH)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir)
            
        # 确认配置文件目录存在
        config_dir = os.path.dirname(CONFIG_PATH)
        if config_dir and not os.path.exists(config_dir):
            os.makedirs(config_dir)
            
        if not os.path.exists(CONFIG_PATH):
            with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
                json.dump([], f)
                
        print(f"Starting server on port 5000...")
        print(f"Config file: {CONFIG_PATH}")
        print(f"Log file: {LOG_PATH}")
        
        minimal_startup_checks()
        profile_startup()
    except Exception as e:
        print(f"Failed to start server: {e}")
        raise 