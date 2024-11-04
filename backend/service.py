from flask import Flask, request, jsonify, send_file
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
import zipfile
import io
from datetime import datetime
from gevent import monkey
import socket
import sys
import requests
import atexit
monkey.patch_all()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, 
                   cors_allowed_origins="*",
                   async_mode='gevent',
                   logger=True,
                   engineio_logger=True,
                   ping_timeout=60,  # 增加超时时间
                   ping_interval=25)  # 增加心跳间隔

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

# 配置文件路径
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
            # 只清理当前客户端的会话
            sessions = client_sessions[client_id].copy()
            for session_id in sessions:
                try:
                    if session_id in ssh_sessions:
                        session = ssh_sessions[session_id]
                        session.active = False
                        with session.lock:
                            try:
                                session.channel.close()
                                session.ssh_client.close()
                            except:
                                pass
                        del ssh_sessions[session_id]
                        client_sessions[client_id].remove(session_id)
                except Exception as e:
                    print(f"Error cleaning up session {session_id}: {e}")
            del client_sessions[client_id]

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

def create_ssh_client(connection):
    try:
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
    except paramiko.AuthenticationException:
        raise Exception('Authentication Failed: Invalid username, password or key')
    except paramiko.SSHException as e:
        raise Exception(f'SSH Error: {str(e)}')
    except socket.gaierror:
        raise Exception('Failed to resolve hostname. Please check the host address')
    except socket.timeout:
        raise Exception('Connection timed out. Please check network or firewall settings')
    except Exception as e:
        raise Exception(f'Connection failed: {str(e)}')

# 添加 read_output 函数定义（放在 create_ssh_client 函数之后）
def read_output(session_id, channel):
    try:
        buffer = ""
        last_output_time = time.time()
        
        while True:
            with sessions_lock:
                if session_id not in ssh_sessions or not ssh_sessions[session_id].active:
                    break
            
            try:
                if channel.recv_ready():
                    output = channel.recv(4096).decode('utf-8', errors='ignore')
                    if output:
                        buffer += output
                        last_output_time = time.time()
                        
                        # 立即发送包含换行符的输出
                        if '\n' in buffer:
                            socketio.emit('ssh_output', {
                                'session_id': session_id,
                                'output': buffer
                            })
                            buffer = ""
                        # 或者当缓冲区达到一定大小时发送
                        elif len(buffer) >= 1024:
                            socketio.emit('ssh_output', {
                                'session_id': session_id,
                                'output': buffer
                            })
                            buffer = ""
                else:
                    # 如果缓冲区中有数据且超过50ms没有新数据，发送剩余数据
                    if buffer and (time.time() - last_output_time) > 0.05:
                        socketio.emit('ssh_output', {
                            'session_id': session_id,
                            'output': buffer
                        })
                        buffer = ""
                    socketio.sleep(0.01)
            except socket.timeout:
                continue
            except Exception as e:
                print(f"Error reading from channel: {e}")
                break
                
    except Exception as e:
        print(f"Error in read_output for session {session_id}: {e}")
        with sessions_lock:
            if session_id in ssh_sessions:
                ssh_sessions[session_id].active = False
        socketio.emit('ssh_error', {
            'session_id': session_id,
            'error': str(e)
        })
    finally:
        # 发送剩余的缓冲区数据
        if buffer:
            socketio.emit('ssh_output', {
                'session_id': session_id,
                'output': buffer
            })
        print(f"Read thread ending for session {session_id}")

@socketio.on('open_ssh')
def handle_ssh_connection(data):
    try:
        client_id = request.sid
        session_id = data['session_id']
        print(f"Opening SSH connection for session {session_id} from client {client_id}")
        
        try:
            # 创建新的 SSH 客户端
            ssh = create_ssh_client(data)
        except paramiko.AuthenticationException:
            # 认证失败的错误处理
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': 'Authentication Failed: Invalid username, password or key'
            })
            return
        except paramiko.SSHException as e:
            # SSH 相关的其他错误
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'SSH Error: {str(e)}'
            })
            return
        except socket.gaierror:
            # 域名解析错误
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': 'Failed to resolve hostname. Please check the host address'
            })
            return
        except socket.timeout:
            # 连接超时
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': 'Connection timed out. Please check network or firewall settings'
            })
            return
        except Exception as e:
            # 其他错误
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Connection failed: {str(e)}'
            })
            return
        
        # 创建交互式会话
        try:
            channel = ssh.invoke_shell(
                term='xterm-256color',
                width=80,
                height=24,
                environment={
                    'TERM': 'xterm-256color',
                    'LANG': 'en_US.UTF-8',
                    'LC_ALL': 'en_US.UTF-8'
                }
            )
        except Exception as e:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Failed to create terminal: {str(e)}'
            })
            ssh.close()
            return

        channel.settimeout(0.1)
        channel.setblocking(0)
        
        # 等待初始输出并发送
        initial_output = ""
        max_attempts = 50  # 增加等待时间到5秒
        attempts = 0
        last_output_time = time.time()
        
        while attempts < max_attempts:
            if channel.recv_ready():
                output = channel.recv(4096).decode('utf-8', errors='ignore')
                if output:
                    initial_output += output
                    last_output_time = time.time()  # 更新最后输出时间
            
            # 如果已经有输出，且超过0.5秒没有新输出，认为初始输出完成
            if initial_output and (time.time() - last_output_time) > 0.5:
                break
                
            socketio.sleep(0.1)
            attempts += 1
        
        print(f"Initial output collected: {initial_output}")
        
        # 创建并启动读取线程
        read_thread = threading.Thread(
            target=read_output,
            args=(session_id, channel),
            daemon=True
        )
        read_thread.start()
        
        # 创建新的会话对象
        session = SSHSession(ssh, channel, read_thread)
        session.client_id = client_id
        
        # 安全地存储会话
        with sessions_lock:
            ssh_sessions[session_id] = session
            if client_id not in client_sessions:
                client_sessions[client_id] = set()
            client_sessions[client_id].add(session_id)
        
        print(f"SSH connection established for session {session_id}")
        
        # 先发送连接成功消息
        socketio.emit('ssh_connected', {
            'session_id': session_id,
            'message': 'Connected successfully'
        })
        
        # 如果有初始输出，立即发送
        if initial_output:
            print(f"Sending initial output for session {session_id}")
            # 分批发送大量输出，避免单个消息过大
            chunk_size = 1024
            for i in range(0, len(initial_output), chunk_size):
                chunk = initial_output[i:i + chunk_size]
                socketio.emit('ssh_output', {
                    'session_id': session_id,
                    'output': chunk
                })
                socketio.sleep(0.01)  # 添加小延迟，避免消息堆积
        
    except Exception as e:
        print(f"Error establishing SSH connection: {e}")
        socketio.emit('ssh_error', {
            'session_id': session_id,
            'error': f'Connection error: {str(e)}'
        })

@socketio.on('ssh_input')
def handle_ssh_input(data):
    try:
        client_id = request.sid
        session_id = data['session_id']
        input_data = data['input']
        
        with sessions_lock:
            session = ssh_sessions.get(session_id)
            if not session or not session.active:
                raise Exception('Session not found or inactive')
            if session.client_id != client_id:
                raise Exception('Session belongs to another client')
            
            with session.lock:
                # 发送输入到SSH服务器
                session.channel.send(input_data)
                print(f"Input sent to SSH server for session {session_id}")
                
                # 立即尝试读取响应
                max_attempts = 10  # 最多尝试10次
                attempts = 0
                output_buffer = ""
                
                while attempts < max_attempts:
                    if session.channel.recv_ready():
                        output = session.channel.recv(4096).decode('utf-8', errors='ignore')
                        if output:
                            output_buffer += output
                            # 如果收到完整的响应（包含换行符）或缓冲区足够大，就发送
                            if '\n' in output_buffer or len(output_buffer) >= 1024:
                                socketio.emit('ssh_output', {
                                    'session_id': session_id,
                                    'output': output_buffer
                                })
                                output_buffer = ""
                    else:
                        # 如果没有更多数据且缓冲区不为空，发送剩余数据
                        if output_buffer:
                            socketio.emit('ssh_output', {
                                'session_id': session_id,
                                'output': output_buffer
                            })
                            output_buffer = ""
                        # 如果已经有输出了，就不用继续等待
                        if attempts > 0:
                            break
                    socketio.sleep(0.01)  # 短暂等待更多输出
                    attempts += 1
                
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

        ssh = create_ssh_client(connection)
        sftp = ssh.open_sftp()

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

        ssh = create_ssh_client(connection)
        sftp = ssh.open_sftp()

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

        ssh = create_ssh_client(connection)
        sftp = ssh.open_sftp()

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

        ssh = create_ssh_client(connection)
        sftp = ssh.open_sftp()

        try:
            try:
                # 尝试作为文件删除
                sftp.remove(path)
            except IOError:
                # 如果失败，尝试作为目录删除
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

        ssh = create_ssh_client(connection)
        sftp = ssh.open_sftp()

        try:
            sftp.rename(old_path, new_path)
            log_sftp_operation('rename', f"{old_path} to {new_path}")
            return jsonify({"status": "success"})
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sftp_create_folder', methods=['POST'])
def create_folder():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']

        ssh = create_ssh_client(connection)
        sftp = ssh.open_sftp()

        try:
            sftp.mkdir(path)
            log_sftp_operation('create_folder', path)
            return jsonify({"status": "success"})
        finally:
            sftp.close()
            ssh.close()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/get_sftp_history', methods=['GET'])
def get_sftp_history():
    try:
        with open(LOG_PATH, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/clear_sftp_history', methods=['POST'])
def clear_sftp_history():
    try:
        with open(LOG_PATH, 'w', encoding='utf-8') as f:
            f.write('')
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# 在文件开头添加 RequestsSession 类
class RequestsSession:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'SimpleSSH'
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

if __name__ == '__main__':
    try:
        # 确保日志文件目录存在
        log_dir = os.path.dirname(LOG_PATH)
        if log_dir and not os.path.exists(log_dir):
            os.makedirs(log_dir)
            
        # 确保配置文件目录存在
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