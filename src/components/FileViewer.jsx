import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  CircularProgress,
  Tooltip,
  Skeleton
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import ImageIcon from '@mui/icons-material/Image';
import TextSnippetIcon from '@mui/icons-material/TextSnippet';
import ErrorIcon from '@mui/icons-material/Error';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

// 代码语法高亮
import SyntaxHighlighter from 'react-syntax-highlighter';
import { dracula } from 'react-syntax-highlighter/dist/esm/styles/hljs';

const FileViewer = ({ open, filePath, fileName, onClose, remoteOptions }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [fileInfo, setFileInfo] = useState(null);

  // 加载文件预览内容
  useEffect(() => {
    if (!open || !filePath) return;

    const loadPreview = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // 调用预览API，传递远程选项
        const result = await window.terminalAPI.previewFile(filePath, remoteOptions);
        
        if (result.success) {
          setPreview(result.preview);
          setFileInfo({
            fileName: result.fileName || fileName || '未知文件',
            fileSize: result.fileSize,
            mimeType: result.mimeType
          });
        } else {
          setError(result.error || '无法预览文件');
        }
      } catch (err) {
        console.error('预览文件失败:', err);
        setError(err.message || '预览文件时发生错误');
      } finally {
        setLoading(false);
      }
    };

    loadPreview();
  }, [open, filePath, fileName, remoteOptions]);

  // 处理下载
  const handleDownload = async () => {
    try {
      // 直接使用浏览器API下载文件
      const a = document.createElement('a');
      
      if (preview.type === 'image') {
        // 对于图片，创建一个Blob对象
        const byteCharacters = atob(preview.content);
        const byteArrays = [];
        for (let i = 0; i < byteCharacters.length; i++) {
          byteArrays.push(byteCharacters.charCodeAt(i));
        }
        const blob = new Blob([new Uint8Array(byteArrays)], { type: preview.mimeType });
        a.href = URL.createObjectURL(blob);
      } else if (preview.type === 'text') {
        // 对于文本，创建一个文本Blob对象
        const blob = new Blob([preview.content], { type: 'text/plain' });
        a.href = URL.createObjectURL(blob);
      } else {
        // 不支持的类型，无法直接下载
        return;
      }
      
      a.download = fileInfo.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('下载文件失败:', err);
      setError('下载文件失败: ' + (err.message || '未知错误'));
    }
  };

  // 渲染文件类型图标
  const renderFileTypeIcon = () => {
    if (!preview || !preview.type) return <InsertDriveFileIcon />;
    
    switch (preview.type) {
      case 'text':
        return <TextSnippetIcon />;
      case 'image':
        return <ImageIcon />;
      case 'error':
        return <ErrorIcon color="error" />;
      default:
        return <InsertDriveFileIcon />;
    }
  };

  // 根据MIME类型确定语法高亮语言
  const getLanguageFromMimeType = (mimeType) => {
    if (!mimeType) return 'text';
    
    const mimeMap = {
      'application/json': 'json',
      'application/javascript': 'javascript',
      'application/xml': 'xml',
      'text/html': 'html',
      'text/css': 'css',
      'text/javascript': 'javascript',
      'text/x-python': 'python',
      'text/x-java': 'java',
      'text/x-c': 'c',
      'text/x-c++': 'cpp'
    };
    
    return mimeMap[mimeType] || 'text';
  };

  // 渲染文件预览内容
  const renderPreview = () => {
    if (loading) {
      return (
        <Box sx={{ p: 2, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '300px' }}>
          <CircularProgress />
        </Box>
      );
    }
    
    if (error) {
      return (
        <Box sx={{ p: 2, color: 'error.main' }}>
          <Typography variant="body1" color="error">
            {error}
          </Typography>
        </Box>
      );
    }
    
    if (!preview) {
      return (
        <Box sx={{ p: 2 }}>
          <Typography variant="body1">
            无预览内容
          </Typography>
        </Box>
      );
    }
    
    switch (preview.type) {
      case 'text':
        return (
          <Box sx={{ 
            p: 0, 
            overflowX: 'auto',
            maxHeight: '70vh',
            '& pre': {
              margin: 0,
              maxHeight: '100%'
            }
          }}>
            <SyntaxHighlighter
              language={getLanguageFromMimeType(preview.mimeType)}
              style={dracula}
              showLineNumbers={true}
              wrapLines={true}
              customStyle={{ margin: 0, borderRadius: 0 }}
            >
              {preview.content}
            </SyntaxHighlighter>
          </Box>
        );
        
      case 'image':
        return (
          <Box sx={{ 
            p: 2, 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center',
            maxHeight: '70vh',
            overflow: 'auto'
          }}>
            <img 
              src={`data:${preview.mimeType};base64,${preview.content}`} 
              alt={fileInfo?.fileName || '图片预览'} 
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
            />
          </Box>
        );
        
      case 'error':
        return (
          <Box sx={{ p: 2, color: 'error.main' }}>
            <Typography variant="body1" color="error">
              {preview.message || '无法预览此文件'}
            </Typography>
          </Box>
        );
        
      case 'unsupported':
        return (
          <Box sx={{ p: 2 }}>
            <Typography variant="body1">
              {preview.message || '不支持预览此类型文件'}
            </Typography>
          </Box>
        );
        
      default:
        return (
          <Box sx={{ p: 2 }}>
            <Typography variant="body1">
              未知预览类型
            </Typography>
          </Box>
        );
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === undefined || bytes === null) return '未知大小';
    if (bytes === 0) return '0 Bytes';
    
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!open) return null;

  return (
    <Paper 
      elevation={3}
      sx={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '90%',
        maxWidth: 900,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: theme.zIndex.modal + 1
      }}
    >
      {/* 标题栏 */}
      <Box sx={{ 
        p: 1.5, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        borderBottom: 1, 
        borderColor: 'divider'
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {renderFileTypeIcon()}
          <Typography variant="subtitle1" sx={{ fontWeight: 'bold', ml: 1 }}>
            {fileInfo?.fileName || fileName || '文件预览'}
          </Typography>
          {fileInfo && (
            <Typography variant="body2" sx={{ ml: 2, color: 'text.secondary' }}>
              {formatFileSize(fileInfo.fileSize)}
            </Typography>
          )}
        </Box>
        
        <Box>
          {preview && (preview.type === 'text' || preview.type === 'image') && (
            <Tooltip title="下载文件">
              <IconButton onClick={handleDownload}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="关闭预览">
            <IconButton onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {/* 预览内容 */}
      {renderPreview()}
    </Paper>
  );
};

export default FileViewer; 