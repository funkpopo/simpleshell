import logging
import os
from datetime import datetime

def setup_logger(log_path):
    logger = logging.getLogger('sftp_logger')
    logger.setLevel(logging.INFO)
    
    # 创建文件处理器
    fh = logging.FileHandler(log_path, encoding='utf-8')
    fh.setLevel(logging.INFO)
    
    # 创建格式化器
    formatter = logging.Formatter('%(asctime)s - %(levelname)s - %(message)s')
    fh.setFormatter(formatter)
    
    # 添加处理器到logger
    logger.addHandler(fh)
    
    return logger

def log_sftp_operation(logger, operation, path):
    try:
        timestamp = datetime.utcnow().isoformat() + 'Z'
        logger.info(f"{timestamp},{operation},{path}")
    except Exception as e:
        logger.error(f"Error logging SFTP operation: {e}") 