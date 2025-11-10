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

  // 将错误消息转换为用户友好的格式
  const getFriendlyMessage = (message) => {
    if (!message) return '发生了一个未知错误';

    const msg = message.toLowerCase();

    // SSH连接超时
    if (msg.includes('ssh') && (msg.includes('超时') || msg.includes('timeout'))) {
      return 'SSH连接超时，请检查网络连接或服务器状态';
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

    // 如果包含技术性堆栈信息，只返回第一行
    const firstLine = message.split('\n')[0];
    if (firstLine.length > 100) {
      return firstLine.substring(0, 100) + '...';
    }

    return firstLine;
  };

  const friendlyMessage = getFriendlyMessage(error.message);

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
