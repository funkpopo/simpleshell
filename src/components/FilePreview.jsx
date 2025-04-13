import React, { useState, useEffect } from 'react';
import { 
  Dialog, 
  DialogTitle, 
  DialogContent,
  DialogActions,
  IconButton,
  Button,
  Typography,
  Box,
  CircularProgress,
  Paper
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import { useTheme } from '@mui/material/styles';

// 获取文件扩展名
const getFileExtension = (filename) => {
  return filename.slice((filename.lastIndexOf(".") - 1 >>> 0) + 2).toLowerCase();
};

// 判断是否是文本文件
const isTextFile = (filename) => {
  const textExtensions = ['txt', 'log', 'json', 'js', 'jsx', 'html', 'css', 'scss', 'less', 'md', 'markdown', 
                          'xml', 'yml', 'yaml', 'conf', 'ini', 'sh', 'bash', 'py', 'java', 'c', 'cpp', 'h', 
                          'php', 'rb', 'go', 'ts', 'tsx', 'vue', 'sql', 'gitignore'];
  const ext = getFileExtension(filename);
  return textExtensions.includes(ext);
};

// 判断是否是图片文件
const isImageFile = (filename) => {
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico'];
  const ext = getFileExtension(filename);
  return imageExtensions.includes(ext);
};

// 获取MIME类型
const getMimeType = (filename) => {
  const ext = getFileExtension(filename);
  const mimeTypes = {
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'bmp': 'image/bmp',
    'svg': 'image/svg+xml',
    'webp': 'image/webp',
    'ico': 'image/x-icon'
  };
  return mimeTypes[ext] || 'application/octet-stream';
};

const FilePreview = ({ open, onClose, file, path, tabId }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  
  const fullPath = path === '/' ? 
    '/' + file?.name : 
    path + '/' + file?.name;
  
  useEffect(() => {
    if (!open || !file) return;
    
    const loadFileContent = async () => {
      setLoading(true);
      setError(null);
      
      try {
        if (isTextFile(file.name)) {
          // 读取文本文件
          if (window.terminalAPI && window.terminalAPI.readFileContent) {
            const response = await window.terminalAPI.readFileContent(tabId, fullPath);
            if (response.success) {
              setContent(response.content);
            } else {
              setError(response.error || '读取文件内容失败');
            }
          } else {
            setError('文件读取API不可用');
          }
        } else if (isImageFile(file.name)) {
          // 读取图片文件
          if (window.terminalAPI && window.terminalAPI.readFileAsBase64) {
            const response = await window.terminalAPI.readFileAsBase64(tabId, fullPath);
            if (response.success) {
              setContent(response.content);
            } else {
              setError(response.error || '读取文件内容失败');
            }
          } else {
            setError('文件读取API不可用');
          }
        } else {
          setError('不支持预览此类型的文件');
        }
      } catch (err) {
        console.error('预览文件失败:', err);
        setError('预览文件失败: ' + (err.message || '未知错误'));
      } finally {
        setLoading(false);
      }
    };
    
    loadFileContent();
  }, [open, file, fullPath, tabId]);
  
  // 处理下载文件
  const handleDownload = async () => {
    if (!file) return;
    
    try {
      if (window.terminalAPI && window.terminalAPI.downloadFile) {
        await window.terminalAPI.downloadFile(
          tabId, 
          fullPath, 
          () => {} // 简单进度回调
        );
      }
    } catch (error) {
      console.error('下载文件失败:', error);
    }
  };
  
  // 渲染文件内容
  const renderContent = () => {
    if (loading) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <CircularProgress size={40} />
        </Box>
      );
    }
    
    if (error) {
      return (
        <Box sx={{ p: 2, color: 'error.main' }}>
          <Typography variant="body1">{error}</Typography>
        </Box>
      );
    }
    
    if (isTextFile(file?.name)) {
      // 将文本内容拆分为行
      const lines = content ? content.split('\n') : [];
      
      return (
        <Box
          sx={{
            height: '100%',
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.875rem',
            backgroundColor: theme.palette.mode === 'dark' ? '#1e1e1e' : '#f5f5f5',
            display: 'flex',
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 1,
          }}
        >
          {/* 行号区域 */}
          <Box
            sx={{
              p: 2,
              backgroundColor: theme.palette.mode === 'dark' ? '#252525' : '#f0f0f0',
              color: theme.palette.text.secondary,
              borderRight: `1px solid ${theme.palette.divider}`,
              textAlign: 'right',
              pr: 1,
              pl: 1,
              flexShrink: 0,
              userSelect: 'none',
            }}
          >
            {lines.map((_, index) => (
              <div key={index}>{index + 1}</div>
            ))}
          </Box>
          
          {/* 文本内容区域 */}
          <Box
            sx={{
              p: 2,
              whiteSpace: 'pre',
              flexGrow: 1,
              overflowX: 'auto',
            }}
          >
            {lines.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </Box>
        </Box>
      );
    }
    
    if (isImageFile(file?.name)) {
      return (
        <Box sx={{ display: 'flex', justifyContent: 'center', height: '100%', overflow: 'auto' }}>
          <img 
            src={`data:${getMimeType(file.name)};base64,${content}`} 
            alt={file.name}
            style={{ maxWidth: '100%', objectFit: 'contain' }}
          />
        </Box>
      );
    }
    
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body1">不支持预览此类型的文件</Typography>
      </Box>
    );
  };
  
  if (!file) return null;
  
  return (
    <Dialog 
      open={open} 
      onClose={onClose}
      fullWidth
      maxWidth="md"
      sx={{ 
        '& .MuiDialog-paper': { 
          height: '80vh', 
          display: 'flex', 
          flexDirection: 'column' 
        } 
      }}
    >
      <DialogTitle sx={{ m: 0, p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" component="div">
          {file.name}
        </Typography>
        <Box>
          <IconButton onClick={handleDownload} title="下载">
            <DownloadIcon />
          </IconButton>
          <IconButton onClick={onClose} title="关闭">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent dividers sx={{ flexGrow: 1, overflow: 'hidden', p: 2 }}>
        {renderContent()}
      </DialogContent>
      
      <DialogActions sx={{ justifyContent: 'space-between', p: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {file.size && `文件大小: ${formatFileSize(file.size)}`}
          {file.modifyTime && ` • 修改时间: ${new Date(file.modifyTime).toLocaleString()}`}
        </Typography>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export default FilePreview; 