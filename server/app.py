from flask import request, jsonify, send_file
import os
import tempfile
import zipfile
import base64
import shutil
from sftp_client import create_sftp_client, upload_directory, download_directory

@app.route('/sftp_upload_folder', methods=['POST'])
def sftp_upload_folder():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']
        folder_name = data['folderName']
        content = data['content']

        # 创建临时目录
        temp_dir = tempfile.mkdtemp()
        zip_path = os.path.join(temp_dir, f"{folder_name}.zip")
        
        # 保存压缩文件
        with open(zip_path, 'wb') as f:
            f.write(base64.b64decode(content))
        
        # 解压文件
        target_dir = os.path.join(temp_dir, folder_name)
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(target_dir)
        
        # 通过 SFTP 上传文件夹
        with create_sftp_client(connection) as sftp:
            remote_path = os.path.join(path, folder_name)
            upload_directory(sftp, target_dir, remote_path)
        
        # 清理临时文件
        shutil.rmtree(temp_dir)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/sftp_download_folder', methods=['POST'])
def sftp_download_folder():
    try:
        data = request.json
        connection = data['connection']
        path = data['path']
        
        # 创建临时目录
        temp_dir = tempfile.mkdtemp()
        folder_name = os.path.basename(path)
        local_path = os.path.join(temp_dir, folder_name)
        
        # 通过 SFTP 下载文件夹
        with create_sftp_client(connection) as sftp:
            download_directory(sftp, path, local_path)
        
        # 压缩文件夹
        zip_path = os.path.join(temp_dir, f"{folder_name}.zip")
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, _, files in os.walk(local_path):
                for file in files:
                    file_path = os.path.join(root, file)
                    arcname = os.path.relpath(file_path, local_path)
                    zipf.write(file_path, arcname)
        
        # 返回压缩文件
        response = send_file(zip_path, as_attachment=True)
        
        # 清理临时文件
        shutil.rmtree(temp_dir)
        
        return response
    except Exception as e:
        return jsonify({'error': str(e)}), 500 