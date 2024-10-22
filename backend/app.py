import sys
import collections
import collections.abc
import zipfile
import io

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

eventlet.monkey_patch()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# 修改 CONFIG_FILE 路径为项目根目录
CONFIG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'config.json')
SSH_SESSIONS = {}

# 创建一个线程池
executor = ThreadPoolExecutor(max_workers=100)

LOG_FILE = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'sftp_log.log')

# 确保 temp 文件夹存在
temp_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'temp')
os.makedirs(temp_dir, exist_ok=True)

def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r') as f:
            return json.load(f)
    return []

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)

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
    new_config = request.json
    save_config(new_config)
    return jsonify({"message": "Configuration updated successfully"}), 200

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
        except IOError as e:
            print(f"Error listing directory: {str(e)}")
            return jsonify({'error': f"Failed to list directory: {str(e)}"}), 500

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

        print(f"Returning file list: {result}")
        sftp.close()
        transport.close()

        return jsonify(result)
    except Exception as e:
        print(f"Error in sftp_list_directory: {str(e)}")
        print(f"Error type: {type(e)}")
        print(f"Error args: {e.args}")
        return jsonify({'error': str(e)}), 500

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
        with sftp.file(path, 'r') as f:
            content = f.read().decode('utf-8')

        sftp.close()
        transport.close()

        return jsonify(content)
    except Exception as e:
        print(f"Error in sftp_read_file: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/sftp_upload_file', methods=['POST'])
def sftp_upload_file():
    data = request.json
    connection = data['connection']
    path = normalize_path(data['path'])
    filename = data['filename']
    content = base64.b64decode(data['content'])

    print(f"Uploading file: {filename} to path: {path}")

    try:
        transport = paramiko.Transport((connection['host'], connection['port']))
        if connection['authType'] == 'password':
            transport.connect(username=connection['username'], password=connection['password'])
        else:
            pkey = paramiko.RSAKey.from_private_key(io.StringIO(connection['privateKey']))
            transport.connect(username=connection['username'], pkey=pkey)

        sftp = paramiko.SFTPClient.from_transport(transport)
        
        full_path = os.path.join(path, filename).replace('\\', '/')
        print(f"Full path for upload: {full_path}")
        
        with sftp.file(full_path, 'wb') as f:
            f.write(content)

        sftp.close()
        transport.close()

        print(f"File {filename} uploaded successfully")
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

if __name__ == '__main__':
    try:
        socketio.run(app, debug=True)
    except Exception as e:
        print(f"Error running the server: {str(e)}")
