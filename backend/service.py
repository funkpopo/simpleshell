from flask import Flask, request, jsonify, send_file, Response, stream_with_context
from flask_socketio import SocketIO, emit
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
from gevent import monkey
import socket
import sys
import requests
import atexit
import re
import httpx
from typing import Dict, Tuple

# 先执行 monkey patch
monkey.patch_all()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, 
                   cors_allowed_origins="*",
                   async_mode='gevent',
                   logger=True,
                   engineio_logger=True,
                   ping_timeout=300,
                   ping_interval=60)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
            # 不要立即清理会话，只记录客户端断开
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
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    connect_kwargs = {
        'hostname': connection['host'],
        'port': int(connection['port']),
        'username': connection['username'],
        'timeout': 30
    }
    
    if connection.get('authType') == 'password':
        connect_kwargs['password'] = connection['password']
    else:
        try:
            if connection.get('privateKey'):
                pkey = paramiko.RSAKey.from_private_key(
                    io.StringIO(connection['privateKey'])
                )
                connect_kwargs['pkey'] = pkey
            elif connection.get('privateKeyPath'):
                pkey = paramiko.RSAKey.from_private_key_file(
                    connection['privateKeyPath']
                )
                connect_kwargs['pkey'] = pkey
        except paramiko.ssh_exception.SSHException:
            raise Exception('Invalid private key format or passphrase required')
        except IOError:
            raise Exception('Failed to read private key file')
    
    print(f"Attempting SSH connection to {connection['host']}:{connection['port']}")
    ssh.connect(**connect_kwargs)
    print("SSH connection successful")
    return ssh

def create_ssh_client(connection):
    """创建用于终端的 SSH 客户端"""
    try:
        ssh = create_base_client(connection)
        
        # 创建并配置通道
        channel = ssh.invoke_shell(
            term='xterm-256color',
            width=80,
            height=24,
            environment={
                'TERM': 'xterm-256color',
                'COLORTERM': 'truecolor',
                'TERM_PROGRAM': 'xterm',
                'LANG': 'en_US.UTF-8',
                'LC_ALL': 'en_US.UTF-8',
                'FORCE_COLOR': 'true'
            }
        )
        
        # 配置通道为非阻塞模式，超时时间非常短
        channel.settimeout(0.001)
        channel.setblocking(0)
        
        # 配置传输层
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
            ssh.close()
        raise e

def create_sftp_client(connection):
    """创建用于文件传输的 SFTP 客户端"""
    ssh = create_base_client(connection)
    try:
        sftp = ssh.open_sftp()
        return ssh, sftp
    except Exception as e:
        ssh.close()
        raise e

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
        except paramiko.AuthenticationException:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': 'Authentication Failed: Invalid username, password or key'
            }, room=client_id)
            return
        except Exception as e:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Connection failed: {str(e)}'
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
    try:
        client_id = request.sid
        session_id = data['session_id']
        
        with sessions_lock:
            session = ssh_sessions.get(session_id)
            if session and session.active and session.client_id == client_id:
                with session.lock:
                    session.channel.resize_pty(
                        width=int(data['cols']),
                        height=int(data['rows'])
                    )
    except Exception as e:
        socketio.emit('ssh_error', {
            'session_id': session_id,
            'error': str(e)
        })

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
                    
                items.append({
                    'name': item.filename,
                    'path': os.path.join(path, item.filename).replace('\\', '/'),
                    'isDirectory': stat.S_ISDIR(item.st_mode),
                    'size': item.st_size,
                    'modTime': item.st_mtime,
                    'isHidden': item.filename.startswith('.')
                })
            return jsonify(items)
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sftp_upload_file', methods=['POST'])
def upload_file():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']
        filename = data['filename']
        content = data['content']

        ssh, sftp = create_sftp_client(connection)
        try:
            import base64
            file_content = base64.b64decode(content)
            remote_path = os.path.join(path, filename).replace('\\', '/')
            
            with sftp.file(remote_path, 'wb') as f:
                f.write(file_content)
            
            log_sftp_operation('upload', remote_path)
            return jsonify({"status": "success"})
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sftp_download_file', methods=['POST'])
def download_file():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']

        ssh, sftp = create_sftp_client(connection)
        try:
            with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                sftp.get(path, temp_file.name)
                log_sftp_operation('download', path)
                return send_file(
                    temp_file.name,
                    as_attachment=True,
                    download_name=os.path.basename(path)
                )
        finally:
            sftp.close()
            ssh.close()
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
            try:
                # 尝试作为文件删除
                sftp.remove(path)
            except IOError:
                # 果失败，尝试作为目录删除
                sftp.rmdir(path)
            
            log_sftp_operation('delete', path)
            return jsonify({"status": "success"})
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
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
        # ... 现有的处理程序���册 ...
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
            # 获取内存使用情况
            stdin, stdout, stderr = ssh_client.exec_command("free | grep Mem")
            mem_info = stdout.read().decode().strip()
            mem_parts = mem_info.split()
            if len(mem_parts) >= 3:
                total_mem = float(mem_parts[1])
                used_mem = float(mem_parts[2])
                mem_usage = (used_mem / total_mem * 100) if total_mem > 0 else 0
            else:
                logger.warning("Invalid memory info format")
                mem_usage = 0
                
            # 获取CPU使用情况
            stdin, stdout, stderr = ssh_client.exec_command("top -bn1 | grep 'Cpu(s)'")
            cpu_info = stdout.read().decode().strip()
            cpu_match = re.search(r'(\d+\.\d+)\s*id', cpu_info)
            if cpu_match:
                idle = float(cpu_match.group(1))
                cpu_usage = 100.0 - idle
            else:
                logger.warning("Invalid CPU info format")
                cpu_usage = 0
                
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
                        stream=True  # 启用流式输出
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
                    
                    # 使用用户指定的模型名称
                    model = genai.GenerativeModel(model_name)
                    chat = model.start_chat()
                    
                    for msg in messages[:-1]:  # 处理历史消息
                        if msg["role"] == "user":
                            chat.send_message(msg["content"])
                    
                    # 流式处理最后一条消息
                    # 在创建模型时设置生成参数
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
        
        socketio.run(app, 
                    host='0.0.0.0', 
                    port=5000, 
                    debug=True,
                    use_reloader=False)  # 禁用重载器
    except Exception as e:
        print(f"Failed to start server: {e}")
        raise 