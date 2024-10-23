import sys
import collections
import collections.abc
import zipfile
import io
import time  # 添加这行

# 只替换 MutableMapping
collections.MutableMapping = collections.abc.MutableMapping

from flask import Flask, request, jsonify, send_file
from flask_socketio import SocketIO
from flask_cors import CORS
import paramiko
import json
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
import eventlet
import stat
import base64
from datetime import datetime
from functools import lru_cache
from threading import Lock
import tempfile

eventlet.monkey_patch()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# 修改 get_application_path 函数
def get_application_path():
    """获取应用程序的路径，兼容开发环境和打包后的环境"""
    if getattr(sys, 'frozen', False):
        # 如果是打包后的环境，使用 sys._MEIPASS
        application_path = os.path.dirname(sys.executable)
    else:
        # 如果是开发环境，使用当前文件的目录的父目录（项目根目录）
        application_path = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return application_path

# 修改 CONFIG_FILE 的定义
CONFIG_FILE = os.path.join(get_application_path(), 'config.json')
SSH_SESSIONS = {}

# 创建一个线程池
executor = ThreadPoolExecutor(max_workers=100)

# 同样修改 LOG_FILE 的路径
LOG_FILE = os.path.join(get_application_path(), 'sftp_log.log')

# 修改 temp 目录的路径
temp_dir = os.path.join(get_application_path(), 'temp')
os.makedirs(temp_dir, exist_ok=True)

# 添加文件缓存锁
cache_lock = Lock()

# 添加缓存装饰器，缓存目录列表结果5秒
@lru_cache(maxsize=100, typed=False)
def cached_list_directory(connection_str, path, timestamp):
    """缓存目录列表的结果"""
    connection = json.loads(connection_str)
    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        file_list = sftp.listdir_attr(path)
        
        result = []
        for file in file_list:
            file_path = os.path.join(path, file.filename).replace('\\', '/')
            if file_path.startswith('./'):
                file_path = file_path[2:]
            result.append({
                'name': file.filename,
                'path': file_path,
                'isDirectory': stat.S_ISDIR(file.st_mode),
                'size': file.st_size,
                'modificationTime': file.st_mtime
            })

        sftp.close()
        transport.close()
        return result
    except Exception as e:
        print(f"Error in cached_list_directory: {str(e)}")
        raise

def load_config():
    """加载配置文件"""
    try:
        # 确保配置文件存在
        if not os.path.exists(CONFIG_FILE):
            # 如果配置文件不存在，创建一个空的配置文件
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump([], f, indent=2, ensure_ascii=False)
            return []

        # 读取配置文件
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading config: {str(e)}")
        return []

def save_config(config):
    """保存配置文件"""
    try:
        # 确保配置文件目录存在
        os.makedirs(os.path.dirname(CONFIG_FILE), exist_ok=True)
        
        # 保存配置
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
            f.flush()
            os.fsync(f.fileno())  # 确保写入磁盘
    except Exception as e:
        print(f"Error saving config: {str(e)}")
        raise

def log_to_file(operation, path, timestamp):
    with open(LOG_FILE, 'a') as f:
        f.write(f"{timestamp},{operation},{path}\n")

def normalize_path(path):
    return path.replace('\\', '/').rstrip('/')

@app.route('/add_connection', methods=['POST'])
def add_connection():
    new_connection = request.json
    config = load_config()
    
    if new_connection.get('folderId'):
        for item in config:
            if item['type'] == 'folder' and item['id'] == new_connection['folderId']:
                if 'connections' not in item:
                    item['connections'] = []
                item['connections'].append(new_connection)
                break
    else:
        config.append(new_connection)
    
    save_config(config)
    return jsonify({"message": "Connection saved successfully"}), 200

@app.route('/get_connections', methods=['GET'])
def get_connections():
    try:
        config = load_config()
        result = []
        for item in config:
            if item['type'] == 'folder':
                folder = item.copy()
                if 'connections' not in folder:
                    folder['connections'] = []
                result.append(folder)
            elif item['type'] == 'connection' and 'folderId' not in item:
                result.append(item)
        return jsonify(result), 200
    except Exception as e:
        app.logger.error(f"Error in get_connections: {str(e)}")
        return jsonify({"error": "Internal server error"}), 500

@app.route('/add_folder', methods=['POST'])
def add_folder():
    new_folder = request.json
    config = load_config()
    config.append(new_folder)
    save_config(config)
    return jsonify({"message": "Folder saved successfully"}), 200

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    print('Client disconnected')

def create_ssh_connection(host, port, username, password=None, private_key=None):
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        if password:
            client.connect(hostname=host, port=port, username=username, password=password, timeout=10)
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(private_key))
            client.connect(hostname=host, port=port, username=username, pkey=pkey, timeout=10)
        return client
    except Exception as e:
        print(f"Failed to connect to {host}:{port} as {username}: {str(e)}")
        return None

def read_ssh_output(chan, session_id):
    while session_id in SSH_SESSIONS:
        try:
            data = chan.recv(1024).decode('utf-8')
            if not data:
                break
            socketio.emit('ssh_output', {'session_id': session_id, 'output': data})
        except Exception as e:
            print(f"Error reading SSH output: {str(e)}")
            break
    print(f"Channel for session {session_id} was closed")

@socketio.on('open_ssh')
def handle_open_ssh(data):
    try:
        session_id = data.get('session_id', str(uuid.uuid4()))
        
        client = create_ssh_connection(
            data['host'], 
            data['port'], 
            data['username'], 
            password=data.get('password'),
            private_key=data.get('privateKey')
        )

        if client is None:
            raise Exception("Failed to establish SSH connection")

        chan = client.invoke_shell()
        if chan is None:
            raise Exception("Failed to open SSH channel")

        SSH_SESSIONS[session_id] = {'client': client, 'chan': chan}
        
        eventlet.spawn(read_ssh_output, chan, session_id)

        socketio.emit('ssh_connected', {'message': 'SSH connection established', 'session_id': session_id})

    except Exception as e:
        error_message = f"Error opening SSH connection: {str(e)}"
        print(error_message)
        socketio.emit('ssh_error', {'message': error_message, 'session_id': session_id})

@socketio.on('ssh_input')
def handle_ssh_input(data):
    try:
        session_id = data['session_id']
        input_data = data['input']
        if session_id in SSH_SESSIONS:
            chan = SSH_SESSIONS[session_id]['chan']
            chan.send(input_data)
    except Exception as e:
        error_message = f"Error sending SSH input: {str(e)}"
        print(error_message)
        socketio.emit('ssh_error', {'message': error_message, 'session_id': session_id})

@socketio.on('close_ssh')
def handle_close_ssh(data):
    session_id = data['session_id']
    if session_id in SSH_SESSIONS:
        try:
            SSH_SESSIONS[session_id]['chan'].close()
            SSH_SESSIONS[session_id]['client'].close()
            del SSH_SESSIONS[session_id]
            socketio.emit('ssh_closed', {'message': 'SSH connection closed', 'session_id': session_id})
        except Exception as e:
            error_message = f"Error closing SSH connection: {str(e)}"
            print(error_message)
            socketio.emit('ssh_error', {'message': error_message, 'session_id': session_id})

@app.route('/update_config', methods=['POST'])
def update_config():
    try:
        new_config = request.json
        print(f"Received new config: {new_config}")  # 添加日志
        
        # 确保配置文件目录存在
        config_dir = os.path.dirname(CONFIG_FILE)
        os.makedirs(config_dir, exist_ok=True)

        # 写入新配置前备份当前配置
        if os.path.exists(CONFIG_FILE):
            backup_file = f"{CONFIG_FILE}.bak"
            try:
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    old_config = f.read()
                with open(backup_file, 'w', encoding='utf-8') as f:
                    f.write(old_config)
            except Exception as e:
                print(f"Failed to create backup: {str(e)}")

        # 写入新配置
        try:
            # 确保配置文件存在
            if not os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                    json.dump([], f, indent=2, ensure_ascii=False)

            # 写入新配置
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                # 确保新配置是一个列表
                if not isinstance(new_config, list):
                    new_config = [new_config]
                json.dump(new_config, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())  # 确保写入磁盘

            print(f"Config file updated successfully. New config: {new_config}")  # 添加日志
            return jsonify({"message": "Configuration updated successfully"}), 200

        except Exception as e:
            # 如果写入失败，尝试恢复备份
            print(f"Failed to write config: {str(e)}")  # 添加日志
            if os.path.exists(backup_file):
                with open(backup_file, 'r', encoding='utf-8') as f:
                    with open(CONFIG_FILE, 'w', encoding='utf-8') as f2:
                        f2.write(f.read())
                        f2.flush()
                        os.fsync(f2.fileno())
            print(f"Failed to update config: {str(e)}")  # 添加日志
            return jsonify({"error": f"Failed to update configuration: {str(e)}"}), 500
            
    except Exception as e:
        print(f"Error in update_config: {str(e)}")  # 添加日志
        return jsonify({"error": str(e)}), 500
    finally:
        # 清理备份文件
        if 'backup_file' in locals() and os.path.exists(backup_file):
            try:
                os.remove(backup_file)
            except Exception as e:
                print(f"Failed to remove backup file: {str(e)}")

# 修改原有的目录列表函数
@app.route('/sftp_list_directory', methods=['POST'])
def sftp_list_directory():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])
    force_root = data.get('forceRoot', False)

    print(f"Received SFTP list directory request for path: {path}")
    print(f"Connection details: {connection}")
    print(f"Force root: {force_root}")

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)

        if force_root:
            path = '/'
        elif path == '/' or path == 'root' or path == '':
            path = sftp.normalize('.')

        try:
            print(f"Attempting to list directory: {path}")
            file_list = sftp.listdir_attr(path)
            print(f"Successfully listed directory: {path}")
            
            result = []
            for file in file_list:
                file_path = os.path.join(path, file.filename).replace('\\', '/')
                if file_path.startswith('./'):
                    file_path = file_path[2:]
                result.append({
                    'name': file.filename,
                    'path': file_path,
                    'isDirectory': stat.S_ISDIR(file.st_mode),
                    'size': file.st_size,
                    'modificationTime': file.st_mtime
                })

            sftp.close()
            transport.close()
            
            print(f"Returning file list: {result}")
            return jsonify(result)
            
        except IOError as e:
            print(f"Error listing directory: {str(e)}")
            return jsonify({'error': f"Failed to list directory: {str(e)}"}), 500

    except Exception as e:
        print(f"Error in sftp_list_directory: {str(e)}")
        print(f"Error type: {type(e)}")
        print(f"Error args: {e.args}")
        return jsonify({'error': str(e)}), 500

# 修改文件读取函数，添加预读取功能
@app.route('/sftp_read_file', methods=['POST'])
def sftp_read_file():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        with sftp.open(path, 'r') as f:
            # 启用预读取
            f.prefetch()
            content = f.read().decode('utf-8')

        sftp.close()
        transport.close()
        return jsonify(content)
    except Exception as e:
        print(f"Error in sftp_read_file: {str(e)}")
        return jsonify({'error': str(e)}), 500

# 修改文件上传函数，使用分块传输
@app.route('/sftp_upload_file', methods=['POST'])
def sftp_upload_file():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])
    filename = data['filename']
    content = base64.b64decode(data['content'])

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        
        full_path = os.path.join(path, filename).replace('\\', '/')
        
        # 使用临时文件进行分块传输
        with tempfile.NamedTemporaryFile(delete=False) as temp_file:
            temp_file.write(content)
            temp_file.flush()
            
            # 使用put方法的callback参数来跟踪进度
            sftp.put(temp_file.name, full_path, callback=lambda x, y: None)

        os.unlink(temp_file.name)
        sftp.close()
        transport.close()

        return jsonify({'message': 'File uploaded successfully'})
    except Exception as e:
        print(f"Error in sftp_upload_file: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/sftp_delete_item', methods=['POST'])
def sftp_delete_item():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])

    print(f"Attempting to delete item: {path}")

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        
        # 检查文件是否存在
        try:
            sftp.stat(path)
        except IOError:
            print(f"File not found: {path}")
            return jsonify({'error': 'File not found'}), 404

        # 检查是否为目录
        try:
            sftp.listdir(path)
            # 如果没有抛出异常，说明是目录
            print(f"Attempting to remove directory: {path}")
            sftp.rmdir(path)
        except IOError:
            # 如果抛出IOError，说明是文件
            print(f"Attempting to remove file: {path}")
            sftp.remove(path)

        sftp.close()
        transport.close()

        print(f"Item {path} deleted successfully")
        return jsonify({'message': 'Item deleted successfully'})
    except Exception as e:
        print(f"Error in sftp_delete_item: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/log_sftp_operation', methods=['POST'])
def log_sftp_operation():
    data = request.json
    log_to_file(data['operation'], data['path'], data['timestamp'])
    return jsonify({"message": "Operation logged successfully"}), 200

@app.route('/get_sftp_history', methods=['GET'])
def get_sftp_history():
    try:
        with open(LOG_FILE, 'r') as f:
            lines = f.readlines()[-100:]  # 只返回最后100行
        return jsonify(''.join(lines)), 200
    except Exception as e:
        print(f"Error reading SFTP history: {str(e)}")
        return jsonify({"error": "Failed to read SFTP history"}), 500

@app.route('/sftp_rename_item', methods=['POST'])
def sftp_rename_item():
    data = request.json
    connection = data['connection']
    old_path = normalize_path(data['oldPath'])
    new_path = normalize_path(data['newPath'])

    print(f"Attempting to rename item from {old_path} to {new_path}")

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        
        sftp.rename(old_path, new_path)

        sftp.close()
        transport.close()

        print(f"Item renamed successfully from {old_path} to {new_path}")
        return jsonify({'message': 'Item renamed successfully'})
    except Exception as e:
        print(f"Error in sftp_rename_item: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/sftp_download_file', methods=['POST'])
def sftp_download_file():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])

    print(f"Attempting to download file: {path}")

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)

        # 检查文件是否存在
        try:
            sftp.stat(path)
        except IOError as e:
            print(f"File not found: {path}")
            return jsonify({'error': f"File not found: {path}"}), 404

        # 创建临时文件夹（如果不存在）
        temp_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'temp')
        os.makedirs(temp_dir, exist_ok=True)

        # 下载文件到临时文件夹
        filename = os.path.basename(path)
        local_path = os.path.join(temp_dir, filename)
        print(f"Downloading file to: {local_path}")
        
        # 使用 get 方法下载文件
        sftp.get(path, local_path)

        # 检查文件是否成功下载
        if os.path.exists(local_path) and os.path.getsize(local_path) > 0:
            print(f"File downloaded successfully: {local_path}")
            with open(local_path, 'rb') as file:
                file_content = file.read()
            
            sftp.close()
            transport.close()

            return send_file(
                io.BytesIO(file_content),
                mimetype='application/octet-stream',
                as_attachment=True,
                download_name=filename
            )
        else:
            raise Exception("File download failed or file is empty")

    except Exception as e:
        print(f"Error in sftp_download_file: {str(e)}")
        print(f"Error type: {type(e)}")
        print(f"Error args: {e.args}")
        return jsonify({'error': str(e)}), 500

@app.route('/sftp_download_item', methods=['POST'])
def sftp_download_item():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])
    is_directory = data['isDirectory']

    print(f"Attempting to download item: {path}")

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)

        if is_directory:
            memory_file = io.BytesIO()
            with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
                def zipdir(path, ziph):
                    for root, dirs, files in sftp_walk(sftp, path):
                        for file in files:
                            full_path = os.path.join(root, file).replace('\\', '/')
                            relative_path = os.path.relpath(full_path, path).replace('\\', '/')
                            file_content = sftp.open(full_path).read()
                            ziph.writestr(relative_path, file_content)
                zipdir(path, zf)
            memory_file.seek(0)
            sftp.close()
            transport.close()
            return send_file(
                memory_file,
                mimetype='application/zip',
                as_attachment=True,
                download_name=f"{os.path.basename(path)}.zip"
            )
        else:
            file_obj = io.BytesIO(sftp.open(path, 'rb').read())
            sftp.close()
            transport.close()
            return send_file(
                file_obj,
                mimetype='application/octet-stream',
                as_attachment=True,
                download_name=os.path.basename(path)
            )

    except Exception as e:
        print(f"Error in sftp_download_item: {str(e)}")
        return jsonify({'error': str(e)}), 500

def sftp_walk(sftp, remotepath):
    path = remotepath
    files = []
    folders = []
    for f in sftp.listdir_attr(remotepath):
        if stat.S_ISDIR(f.st_mode):
            folders.append(f.filename)
        else:
            files.append(f.filename)
    yield path, folders, files
    for folder in folders:
        new_path = os.path.join(remotepath, folder)
        for x in sftp_walk(sftp, new_path):
            yield x

@socketio.on('resize')
def handle_resize(data):
    session_id = data['session_id']
    cols = data['cols']
    rows = data['rows']
    if session_id in SSH_SESSIONS:
        chan = SSH_SESSIONS[session_id]['chan']
        chan.resize_pty(width=cols, height=rows)

@app.route('/health')
def health_check():
    return jsonify({"status": "ok"}), 200

if __name__ == '__main__':
    try:
        socketio.run(app, debug=True)
    except Exception as e:
        print(f"Error running the server: {str(e)}")
