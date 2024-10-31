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
monkey.patch_all()

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, 
                   cors_allowed_origins="*",
                   async_mode='gevent',
                   logger=True,
                   engineio_logger=True)

# 配置日志
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 获取配置文件路径
CONFIG_PATH = os.getenv('CONFIG_PATH', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'config.json'))
LOG_PATH = os.getenv('LOG_PATH', os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'sftp_log.log'))

# 存储SSH会话
ssh_sessions = {}
sftp_sessions = {}

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
        
        if connection.get('authType') == 'password':
            ssh.connect(
                connection['host'],
                port=connection['port'],
                username=connection['username'],
                password=connection['password']
            )
        else:
            private_key = paramiko.RSAKey.from_private_key(
                io.StringIO(connection['privateKey'])
            )
            ssh.connect(
                connection['host'],
                port=connection['port'],
                username=connection['username'],
                pkey=private_key
            )
        
        return ssh
    except Exception as e:
        logger.error(f"SSH connection error: {e}")
        raise

@socketio.on('open_ssh')
def handle_ssh_connection(data):
    try:
        session_id = data['session_id']
        print(f"Opening SSH connection for session {session_id}")
        ssh = create_ssh_client(data)
        channel = ssh.invoke_shell(
            term='xterm-256color',
            width=80,
            height=24
        )
        ssh_sessions[session_id] = {
            'ssh': ssh,
            'channel': channel
        }
        
        def read_output():
            while True:
                try:
                    if channel.recv_ready():
                        output = channel.recv(1024).decode('utf-8', errors='ignore')
                        print(f"Sending SSH output for session {session_id}: {output}")
                        socketio.emit('ssh_output', {
                            'session_id': session_id,
                            'output': output
                        })
                    time.sleep(0.1)
                except Exception as e:
                    print(f"Error in read_output for session {session_id}: {e}")
                    break
        
        thread = threading.Thread(target=read_output)
        thread.daemon = True
        thread.start()
        
        print(f"SSH connection established for session {session_id}")
        socketio.emit('ssh_connected', {
            'session_id': session_id,
            'message': 'Connected successfully'
        })
    except Exception as e:
        print(f"Error establishing SSH connection: {e}")
        socketio.emit('ssh_error', {'error': str(e)})

@socketio.on('ssh_input')
def handle_ssh_input(data):
    try:
        session_id = data['session_id']
        input_data = data['input']
        print(f"Received SSH input for session {session_id}: {input_data}")
        
        session = ssh_sessions.get(session_id)
        if session:
            channel = session['channel']
            channel.send(input_data)
            print(f"Input sent to SSH server for session {session_id}")
        else:
            print(f"No session found for {session_id}")
    except Exception as e:
        print(f"Error handling SSH input: {e}")
        socketio.emit('ssh_error', {'error': str(e)})

@socketio.on('close_ssh')
def handle_ssh_close(data):
    try:
        session_id = data['session_id']
        if session_id in ssh_sessions:
            session = ssh_sessions[session_id]
            session['channel'].close()
            session['ssh'].close()
            del ssh_sessions[session_id]
            emit('ssh_closed', {
                'session_id': session_id,
                'message': 'Connection closed'
            })
    except Exception as e:
        emit('ssh_error', {'error': str(e)})

@socketio.on('resize')
def handle_resize(data):
    try:
        session = ssh_sessions.get(data['session_id'])
        if session:
            session['channel'].resize_pty(
                width=int(data['cols']),
                height=int(data['rows'])
            )
    except Exception as e:
        emit('ssh_error', {'error': str(e)})

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