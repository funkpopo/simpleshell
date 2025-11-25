import React from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';

/**
 * 错误通知组件
 * 用于显示应用内的错误提醒，替代系统原生的错误窗口
 * 显示在左下角，提供简洁的用户友好错误信息
 */
const ErrorNotification = ({ error, open, onClose }) => {
  if (!error) return null;

  // 提取核心错误信息
  const extractErrorMessage = (err) => {
    // 如果是字符串，直接处理
    if (typeof err === 'string') {
      return err;
    }

    // 如果有 message 属性
    if (err.message) {
      return err.message;
    }

    // 如果是对象，尝试序列化
    if (typeof err === 'object') {
      try {
        const json = JSON.stringify(err);
        // 如果序列化结果太长，提取关键信息
        if (json.length > 200) {
          // 尝试提取 message 字段
          const match = json.match(/"message":"([^"]+)"/);
          if (match && match[1]) {
            return match[1];
          }
        }
        return json;
      } catch (e) {
        return String(err);
      }
    }

    return String(err);
  };

  // 清理错误消息
  const cleanErrorMessage = (message) => {
    if (!message) return '发生了未知错误';

    // 移除 "Unhandled error. " 前缀
    message = message.replace(/^Unhandled error\.\s*\(/i, '');
    message = message.replace(/\)$/, '');

    // 移除对象序列化的开头 "{" 和结尾 "}"
    message = message.trim();
    if (message.startsWith('{') && message.endsWith('}')) {
      try {
        const obj = JSON.parse(message);
        if (obj.message) {
          message = obj.message;
        }
      } catch (e) {
        // 解析失败，继续使用原始字符串
      }
    }

    // 移除堆栈跟踪（从 "at " 或 "\n" 开始的部分）
    const stackStart = message.indexOf('\n    at ');
    if (stackStart > 0) {
      message = message.substring(0, stackStart).trim();
    }

    // 移除多余的换行符
    message = message.split('\n')[0];

    // 限制长度
    if (message.length > 150) {
      message = message.substring(0, 150) + '...';
    }

    return message;
  };

  // 将错误消息转换为用户友好的格式
  const getFriendlyMessage = (rawMessage) => {
    const message = cleanErrorMessage(rawMessage);
    const msg = message.toLowerCase();

    // SSH连接相关错误
    if (msg.includes('ssh')) {
      if (msg.includes('超时') || msg.includes('timeout')) {
        return 'SSH连接超时，请检查网络连接或服务器状态';
      }
      if (msg.includes('断开') || msg.includes('关闭') || msg.includes('closed')) {
        return 'SSH连接已断开，正在尝试自动重连...';
      }
      if (msg.includes('连接错误') || msg.includes('connection error')) {
        return 'SSH连接失败，请检查服务器地址和端口';
      }
    }

    // 认证失败
    if (msg.includes('authentication') || msg.includes('认证') || msg.includes('密码')) {
      return 'SSH认证失败，请检查用户名和密码';
    }

    // 连接被拒绝
    if (msg.includes('econnrefused') || msg.includes('连接被拒绝')) {
      return '无法连接到服务器，请检查服务器地址和端口';
    }

    // 主机不存在
    if (msg.includes('enotfound') || msg.includes('主机不存在')) {
      return '无法解析主机名，请检查服务器地址';
    }

    // 网络错误
    if (msg.includes('network') || msg.includes('网络')) {
      return '网络连接失败，请检查网络设置';
    }

    // 代理错误
    if (msg.includes('proxy') || msg.includes('代理')) {
      return '代理连接失败，请检查代理配置';
    }

    // Telnet错误
    if (msg.includes('telnet')) {
      return 'Telnet连接失败，请检查连接配置';
    }

    // 返回清理后的消息
    return message;
  };

  const rawMessage = extractErrorMessage(error);
  const friendlyMessage = getFriendlyMessage(rawMessage);

  return (
    <Snackbar
      open={open}
      autoHideDuration={5000}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      sx={{
        bottom: '8px !important',
        left: '8px !important',
        zIndex: 9999
      }}
    >
      <Alert
        severity="error"
        variant="filled"
        onClose={onClose}
        sx={{
          minWidth: 300,
          maxWidth: 450,
          boxShadow: 3,
          '& .MuiAlert-message': {
            width: '100%'
          }
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {friendlyMessage}
        </Typography>
      </Alert>
    </Snackbar>
  );
};

export default ErrorNotification;
