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
            # 只清理当前客户端的会话
            sessions = client_sessions[client_id].copy()
            for session_id in sessions:
                try:
                    if session_id in ssh_sessions:
                        session = ssh_sessions[session_id]
                        cleanup_session(session)
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

# 修改 read_output 函数，优化大量输出的处理
def read_output(session_id, channel):
    try:
        buffer = ""
        last_output_time = time.time()
        is_realtime_mode = False
        large_output_mode = False
        
        while True:
            with sessions_lock:
                if session_id not in ssh_sessions or not ssh_sessions[session_id].active:
                    break
            
            try:
                if channel.recv_ready():
                    output = channel.recv(4096).decode('utf-8', errors='ignore')
                    if output:
                        # 检查是否是实时更新命令的输出
                        if any(cmd in output.lower() for cmd in ['top -', 'htop', 'watch']):
                            is_realtime_mode = True
                            large_output_mode = False
                        
                        # 检查是否是大量输出
                        if len(output) > 4096 or output.count('\n') > 50:
                            large_output_mode = True
                        
                        # 检查是否包含特殊的终端控制序列
                        has_control_seq = any(seq in output for seq in [
                            '\x1b[H',  # 光标移到首位
                            '\x1b[2J',  # 清屏
                            '\x1b[K',   # 清除行
                            '\x1b[?1049h',  # 切换到备用屏幕缓冲区
                            '\x1b[?1049l',   # 切换回主屏幕缓冲区
                            '\x1b[6n',  # 请求光标位置
                            '\x1b[s',   # 保存光标位置
                            '\x1b[u'    # 恢复光标位置
                        ])
                        
                        # 处理输出的逻辑
                        if is_realtime_mode or has_control_seq:
                            # 实时模式或控制序列，立即发送
                            if buffer:
                                socketio.emit('ssh_output', {
                                    'session_id': session_id,
                                    'output': buffer
                                })
                                buffer = ""
                            socketio.emit('ssh_output', {
                                'session_id': session_id,
                                'output': output
                            })
                            socketio.sleep(0.01)
                        elif large_output_mode:
                            # 大量输出模式，使用更大的缓冲区和更频繁的发送
                            buffer += output
                            if len(buffer) >= 8192 or buffer.count('\n') >= 100:
                                socketio.emit('ssh_output', {
                                    'session_id': session_id,
                                    'output': buffer
                                })
                                buffer = ""
                                socketio.sleep(0.01)  # 短暂暂停，让客户端有时间处理
                        else:
                            # 普通输出模式
                            buffer += output
                            if '\n' in buffer or len(buffer) >= 1024:
                                socketio.emit('ssh_output', {
                                    'session_id': session_id,
                                    'output': buffer
                                })
                                buffer = ""
                        
                        last_output_time = time.time()
                else:
                    current_time = time.time()
                    elapsed_time = current_time - last_output_time
                    
                    # 根据不同模式设置不同的刷新间隔
                    if is_realtime_mode:
                        wait_time = 0.01
                    elif large_output_mode:
                        wait_time = 0.02
                    else:
                        wait_time = 0.05
                    
                    # 如果缓冲区有数据且超过等待时间，发送数据
                    if buffer and elapsed_time > wait_time:
                        socketio.emit('ssh_output', {
                            'session_id': session_id,
                            'output': buffer
                        })
                        buffer = ""
                        
                    # 根据模式设置不同的睡眠时间
                    socketio.sleep(wait_time)
                    
                    # 如果一段时间没有输出，重置模式标志
                    if elapsed_time > 1.0:  # 1秒没有输出
                        large_output_mode = False
                        if not is_realtime_mode:  # 保持实时模式不变
                            is_realtime_mode = False
                        
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
        if buffer:
            socketio.emit('ssh_output', {
                'session_id': session_id,
                'output': buffer
            })

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
                    'COLORTERM': 'truecolor',
                    'TERM_PROGRAM': 'xterm',
                    'LANG': 'en_US.UTF-8',
                    'LC_ALL': 'en_US.UTF-8',
                    'FORCE_COLOR': 'true'
                }
            )
            
            # 在创建 channel 后添加初始化命令
            init_commands = [
                # 清除屏幕，确保不显示任何命令
                'clear >/dev/null 2>&1',
                # 获取欢迎信息但不显示命令本身
                'cat /etc/motd 2>/dev/null; true',
                # 然后设置环境但不显示命令
                'export TERM=xterm-256color >/dev/null 2>&1',
                'export COLORTERM=truecolor >/dev/null 2>&1',
                'export FORCE_COLOR=true >/dev/null 2>&1',
                'export CLICOLOR=1 >/dev/null 2>&1',
                # 配置 PS1 提示符以使用颜色，但不显示命令本身
                'export PS1="\\[\\e[1;32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ " >/dev/null 2>&1',
                # 为常用命令添加颜色别名，但不显示命令本身
                'alias ls="ls --color=auto" >/dev/null 2>&1',
                'alias grep="grep --color=auto" >/dev/null 2>&1',
                'alias dir="dir --color=auto" >/dev/null 2>&1',
                'alias vdir="vdir --color=auto" >/dev/null 2>&1',
                # 加载 bashrc，但不显示任何输出
                'source ~/.bashrc >/dev/null 2>&1 || true',
                # 最后设置 PS1，这条命令的输出也不显示
                'PS1="\\[\\e[1;32m\\]\\u@\\h\\[\\e[0m\\]:\\[\\e[1;34m\\]\\w\\[\\e[0m\\]\\$ " >/dev/null 2>&1',
                # 清除历史
                'history -c >/dev/null 2>&1'
            ]
            
            channel.settimeout(0.1)
            channel.setblocking(0)

            # 发送初始化命令并收集欢迎信息的输出
            initial_output = ""
            for cmd in init_commands:
                channel.send(f'{cmd}\n')
                socketio.sleep(0.1)  # 给每个命令一些执行时间
                
                # 只收集欢迎信息命令的输出
                if 'cat /etc/motd' in cmd:
                    attempts = 0
                    while attempts < 20:  # 最多等待2秒
                        if channel.recv_ready():
                            output = channel.recv(4096).decode('utf-8', errors='ignore')
                            if output:
                                # 过滤掉命令本身和提示符
                                filtered_output = '\n'.join([
                                    line for line in output.splitlines()
                                    if not line.strip().startswith('cat') and 
                                       '$' not in line and 
                                       '#' not in line
                                ])
                                if filtered_output.strip():
                                    initial_output += filtered_output + '\n'
                        socketio.sleep(0.1)
                        attempts += 1
            
            # 清除任何可能的剩余输出
            while channel.recv_ready():
                channel.recv(4096)
            
            # 发送一个换行来获取新的提示符
            channel.send('\n')
            
            # 等待并收集新的提示符
            prompt_output = ""
            max_attempts = 20
            attempts = 0
            last_output_time = time.time()
            
            while attempts < max_attempts:
                if channel.recv_ready():
                    output = channel.recv(4096).decode('utf-8', errors='ignore')
                    if output:
                        prompt_output += output
                        last_output_time = time.time()
                
                if prompt_output and (time.time() - last_output_time) > 0.1:
                    break
                    
                socketio.sleep(0.01)
                attempts += 1
            
            # 组合欢迎信息和提示符
            if initial_output.strip():
                initial_output = f"\r\n{initial_output.strip()}\r\n\r\n"
            initial_output += prompt_output
        
        except Exception as e:
            socketio.emit('ssh_error', {
                'session_id': session_id,
                'error': f'Failed to create terminal: {str(e)}'
            })
            ssh.close()
            return

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

# 修改 handle_ssh_input 函数中的实时命令处理部分
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
                # 检查是否是实时更新命令
                is_realtime_cmd = any(cmd in input_data.lower() for cmd in ['top', 'htop', 'watch', 'tail -f'])
                
                # 发送输入到SSH服务器
                session.channel.send(input_data)
                print(f"Input sent to SSH server for session {session_id}")
                
                if is_realtime_cmd:
                    # 设置通道为非阻塞模式
                    session.channel.setblocking(0)
                    
                    # 给命令一点启动时间
                    socketio.sleep(0.2)
                    
                    # 创建一个新的线程来持续读取实时输出
                    def read_realtime_output():
                        try:
                            while session.active:
                                try:
                                    if session.channel.recv_ready():
                                        output = session.channel.recv(4096).decode('utf-8', errors='ignore')
                                        if output:
                                            socketio.emit('ssh_output', {
                                                'session_id': session_id,
                                                'output': output
                                            })
                                    socketio.sleep(0.1)  # 每100ms检查一次新输出
                                except socket.timeout:
                                    continue
                                except Exception as e:
                                    print(f"Error in realtime output thread: {e}")
                                    break
                        except Exception as e:
                            print(f"Realtime output thread error: {e}")
                        finally:
                            print("Realtime output thread ended")
                    
                    # 启动实时输出读取线程
                    realtime_thread = threading.Thread(
                        target=read_realtime_output,
                        daemon=True
                    )
                    realtime_thread.start()
                    
                    # 将线程保存到会话对象中
                    session.realtime_thread = realtime_thread
                else:
                    # 对于普通命令，使用原有的处理逻辑
                    max_attempts = 10
                    attempts = 0
                    output_buffer = ""
                    
                    while attempts < max_attempts:
                        if session.channel.recv_ready():
                            output = session.channel.recv(4096).decode('utf-8', errors='ignore')
                            if output:
                                output_buffer += output
                                if '\n' in output_buffer or len(output_buffer) >= 1024:
                                    socketio.emit('ssh_output', {
                                        'session_id': session_id,
                                        'output': output_buffer
                                    })
                                    output_buffer = ""
                        else:
                            if output_buffer:
                                socketio.emit('ssh_output', {
                                    'session_id': session_id,
                                    'output': output_buffer
                                })
                                output_buffer = ""
                            if attempts > 0:
                                break
                        socketio.sleep(0.01)
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
        logging.error("Exception in rename_item: %s", str(e))
        return jsonify({"error": "An internal error has occurred."}), 500

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

# 修改 cleanup 相关代码，确保实时线程也被正确清理
def cleanup_session(session):
    try:
        session.active = False
        if session.channel:
            session.channel.close()
        if session.ssh_client:
            session.ssh_client.close()
        if session.read_thread and session.read_thread.is_alive():
            session.read_thread.join(timeout=1)
        if session.realtime_thread and session.realtime_thread.is_alive():
            session.realtime_thread.join(timeout=1)
    except Exception as e:
        print(f"Error in cleanup_session: {e}")

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