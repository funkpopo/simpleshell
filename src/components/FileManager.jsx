import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Paper, 
  Typography, 
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Divider,
  CircularProgress,
  TextField,
  InputAdornment,
  Tooltip,
  Menu,
  MenuItem,
  Button,
  LinearProgress
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import FolderIcon from '@mui/icons-material/Folder';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import RefreshIcon from '@mui/icons-material/Refresh';
import HomeIcon from '@mui/icons-material/Home';
import CreateNewFolderIcon from '@mui/icons-material/CreateNewFolder';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import LinkIcon from '@mui/icons-material/Link';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import CancelIcon from '@mui/icons-material/Cancel';

const FileManager = ({ open, onClose, sshConnection, tabId }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPath, setCurrentPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [files, setFiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  
  // 传输进度相关状态
  const [transferProgress, setTransferProgress] = useState(null);
  const [transferCancelled, setTransferCancelled] = useState(false);

  // 当SSH连接改变时，重置状态并加载目录
  useEffect(() => {
    if (open && sshConnection && tabId) {
      console.log('FileManager: Loading files for tab', tabId);
      
      // 先检查API是否可用
      if (!window.terminalAPI || !window.terminalAPI.listFiles) {
        console.error('FileManager: listFiles API not available');
        setError('文件管理API不可用');
        return;
      }
      
      setCurrentPath('/');
      setPathInput('/');
      loadDirectory('/');
    }
  }, [open, sshConnection, tabId]);

  // 加载目录内容
  const loadDirectory = async (path) => {
    if (!sshConnection || !tabId) {
      console.error('FileManager: Missing SSH connection or tabId');
      setError('缺少SSH连接信息');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      console.log(`FileManager: Listing files at path "${path}" for tab ${tabId}`);
      if (window.terminalAPI && window.terminalAPI.listFiles) {
        // 将~转换为空字符串，用于API调用
        const apiPath = path === '~' ? '' : path;
        const response = await window.terminalAPI.listFiles(tabId, apiPath);
        console.log('FileManager: Got response', response);
        if (response?.success) {
          setFiles(response.data || []);
          setCurrentPath(path); // 保持UI中显示~
          setPathInput(path);
        } else {
          setError(response?.error || '加载目录失败');
        }
      } else {
        console.error('FileManager: listFiles API not available');
        setError('文件管理API不可用');
      }
    } catch (error) {
      console.error('加载目录失败:', error);
      setError('加载目录失败：' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  // 进入目录
  const handleEnterDirectory = (path) => {
    loadDirectory(path);
  };

  // 返回上级目录
  const handleGoBack = () => {
    // 如果当前在家目录，返回到根目录
    if (currentPath === '~') {
      loadDirectory('/');
      return;
    }

    // 如果当前路径为空或根目录，不执行任何操作
    if (!currentPath || currentPath === '/') return;

    const lastSlashIndex = currentPath.lastIndexOf('/');
    let parentPath = '';
    
    if (lastSlashIndex > 0) {
      parentPath = currentPath.substring(0, lastSlashIndex);
    } else {
      // 如果没有找到斜杠，或斜杠在开头位置，返回根目录
      parentPath = '/';
    }
    
    loadDirectory(parentPath);
  };

  // 刷新目录
  const handleRefresh = () => {
    loadDirectory(currentPath);
  };

  // 返回主目录
  const handleGoHome = () => {
    loadDirectory('~');
  };

  // 处理搜索
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  // 切换搜索框显示
  const toggleSearch = () => {
    setShowSearch(!showSearch);
    if (showSearch) {
      setSearchTerm('');
    }
  };

  // 处理右键菜单
  const handleContextMenu = (event, file) => {
    event.preventDefault();
    setSelectedFile(file);
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  };

  // 关闭右键菜单
  const handleContextMenuClose = () => {
    setContextMenu(null);
  };

  // 处理删除
  const handleDelete = async () => {
    if (!selectedFile || !sshConnection) return;

    setLoading(true);
    try {
      const fullPath = currentPath === '/' ? 
        '/' + selectedFile.name : 
        currentPath ? currentPath + '/' + selectedFile.name : 
        selectedFile.name;

      if (window.terminalAPI && window.terminalAPI.deleteFile) {
        await window.terminalAPI.deleteFile(tabId, fullPath, selectedFile.isDirectory);
        await loadDirectory(currentPath);
      }
    } catch (error) {
      console.error('删除文件失败:', error);
      setError('删除文件失败: ' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
    handleContextMenuClose();
  };

  // 处理下载
  const handleDownload = async () => {
    if (!selectedFile || !sshConnection) return;

    // 重置取消状态
    setTransferCancelled(false);
    
    try {
      const fullPath = currentPath === '/' ? 
        '/' + selectedFile.name : 
        currentPath ? currentPath + '/' + selectedFile.name : 
        selectedFile.name;

      if (window.terminalAPI && window.terminalAPI.downloadFile) {
        // 设置初始传输进度状态
        setTransferProgress({
          type: 'download',
          progress: 0,
          fileName: selectedFile.name,
          transferredBytes: 0,
          totalBytes: selectedFile.size || 0,
          transferSpeed: 0,
          remainingTime: 0
        });
        
        // 使用progressCallback处理进度更新
        await window.terminalAPI.downloadFile(
          tabId, 
          fullPath, 
          (progress, fileName, transferredBytes, totalBytes, transferSpeed, remainingTime) => {
            setTransferProgress({
              type: 'download',
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime
            });
          }
        );
        
        // 下载完成后清除进度状态
        setTimeout(() => setTransferProgress(null), 1500);
      }
    } catch (error) {
      console.error('下载文件失败:', error);
      
      // 只有在不是用户主动取消的情况下才显示错误
      if (!transferCancelled && !error.message?.includes('reply was never sent')) {
        setError('下载文件失败: ' + (error.message || '未知错误'));
      }
      
      setTransferProgress(null);
    }
    handleContextMenuClose();
  };

  // 处理重命名
  const handleRename = () => {
    if (!selectedFile) return;
    setNewFileName(selectedFile.name);
    setShowRenameDialog(true);
    handleContextMenuClose();
  };

  // 提交重命名
  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    setShowRenameDialog(false);
    
    if (!selectedFile || !newFileName || newFileName === selectedFile.name) return;
    
    setLoading(true);
    try {
      const oldPath = currentPath === '/' ? 
        '/' + selectedFile.name : 
        currentPath ? currentPath + '/' + selectedFile.name : 
        selectedFile.name;
      
      if (window.terminalAPI && window.terminalAPI.renameFile) {
        await window.terminalAPI.renameFile(tabId, oldPath, newFileName);
        await loadDirectory(currentPath);
      }
    } catch (error) {
      console.error('重命名失败:', error);
      setError('重命名失败: ' + (error.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  // 处理上传文件到当前目录
  const handleUploadFile = async () => {
    handleContextMenuClose();
    
    if (!sshConnection) return;
    
    // 重置取消状态
    setTransferCancelled(false);
    
    try {
      // 构建目标路径，确保路径格式正确
      let targetPath;
      
      if (selectedFile && selectedFile.isDirectory) {
        // 上传到选中的文件夹
        if (currentPath === '/') {
          targetPath = '/' + selectedFile.name;
        } else if (currentPath === '~') {
          targetPath = '~/' + selectedFile.name;
        } else {
          targetPath = currentPath + '/' + selectedFile.name;
        }
      } else {
        // 上传到当前文件夹
        targetPath = currentPath;
      }
      
      console.log(`Uploading to path: ${targetPath}`);
      
      if (window.terminalAPI && window.terminalAPI.uploadFile) {
        // 设置初始传输进度状态
        setTransferProgress({
          type: 'upload',
          progress: 0,
          fileName: '',
          transferredBytes: 0,
          totalBytes: 0,
          transferSpeed: 0,
          remainingTime: 0
        });
        
        // 使用progressCallback处理进度更新
        const result = await window.terminalAPI.uploadFile(
          tabId, 
          targetPath, 
          (progress, fileName, transferredBytes, totalBytes, transferSpeed, remainingTime) => {
            setTransferProgress({
              type: 'upload',
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime
            });
          }
        );
        
        if (result.success) {
          // 上传完成后清除进度状态
          setTimeout(() => setTransferProgress(null), 1500);
          await loadDirectory(currentPath);
        } else if (!transferCancelled) {
          // 只有在不是用户主动取消的情况下才显示错误
          setError(result.error || '上传文件失败');
          setTransferProgress(null);
        }
      }
    } catch (error) {
      console.error('上传文件失败:', error);
      
      // 只有在不是用户主动取消的情况下才显示错误
      if (!transferCancelled && !error.message?.includes('reply was never sent')) {
        setError('上传文件失败: ' + (error.message || '未知错误'));
      }
      
      setTransferProgress(null);
    }
  };

  // 复制绝对路径
  const handleCopyAbsolutePath = async () => {
    if (!selectedFile) return;
    
    try {
      const relativePath = currentPath === '/' ? 
        '/' + selectedFile.name : 
        currentPath ? currentPath + '/' + selectedFile.name : 
        selectedFile.name;
      
      if (window.terminalAPI && window.terminalAPI.getAbsolutePath) {
        const response = await window.terminalAPI.getAbsolutePath(tabId, relativePath);
        if (response?.success && response.path) {
          // 使用navigator.clipboard API复制到剪贴板
          await navigator.clipboard.writeText(response.path);
        }
      }
    } catch (error) {
      console.error('复制路径失败:', error);
      setError('复制路径失败: ' + (error.message || '未知错误'));
    }
    handleContextMenuClose();
  };

  // 过滤文件列表
  const filteredFiles = searchTerm 
    ? files.filter(file => 
        file.name.toLowerCase().includes(searchTerm.toLowerCase()))
    : files;

  // 渲染文件列表
  const renderFileList = () => {
    if (loading) {
      return (
        <Box sx={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center',
          height: '100%',
          width: '100%'
        }}>
          <CircularProgress size={24} />
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ 
          padding: 2, 
          color: 'error.main',
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Typography variant="body2">{error}</Typography>
        </Box>
      );
    }

    if (!filteredFiles.length) {
      return (
        <Box sx={{ 
          padding: 2,
          height: '100%',
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <Typography variant="body2" color="text.secondary">
            {searchTerm ? '没有找到匹配的文件' : '此目录为空'}
          </Typography>
        </Box>
      );
    }

    // 先显示目录，然后是文件
    const sortedFiles = [...filteredFiles].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <List dense sx={{ width: '100%', padding: 0 }}>
        {sortedFiles.map((file) => (
          <ListItem 
            key={file.name}
            disablePadding
            onContextMenu={(e) => handleContextMenu(e, file)}
          >
            <ListItemButton
              onClick={() => file.isDirectory && handleEnterDirectory(
                currentPath === '/' ? 
                  '/' + file.name : 
                  currentPath + '/' + file.name
              )}
              dense
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                {file.isDirectory ? (
                  <FolderIcon color="primary" fontSize="small" />
                ) : (
                  <InsertDriveFileIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText 
                primary={file.name} 
                secondary={file.size && !file.isDirectory ? formatFileSize(file.size) : null}
                primaryTypographyProps={{ variant: 'body2' }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
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

  // 处理路径输入更改
  const handlePathInputChange = (e) => {
    setPathInput(e.target.value);
  };

  // 处理路径输入提交
  const handlePathInputSubmit = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      loadDirectory(pathInput);
    }
  };

  // 格式化传输速度
  const formatTransferSpeed = (bytesPerSecond) => {
    if (!bytesPerSecond) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(1024));
    return `${(bytesPerSecond / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  };
  
  // 格式化剩余时间
  const formatRemainingTime = (seconds) => {
    if (!seconds || !isFinite(seconds)) return '计算中...';
    if (seconds < 1) return '即将完成';
    
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  // 处理取消传输
  const handleCancelTransfer = async () => {
    if (!transferProgress || !window.terminalAPI || !window.terminalAPI.cancelTransfer) {
      return;
    }
    
    try {
      // 标记传输已取消，用于避免显示错误消息
      setTransferCancelled(true);
      
      const result = await window.terminalAPI.cancelTransfer(tabId, transferProgress.type);
      
      if (result.success) {
        // 更新UI以显示已取消
        setTransferProgress({
          ...transferProgress,
          progress: 0,
          isCancelled: true,
          cancelMessage: '传输已取消'
        });
        
        // 短暂延迟后移除进度条
        setTimeout(() => setTransferProgress(null), 1500);
      } else {
        // 即使取消失败也不要显示错误，因为原始传输可能已经取消
        console.log('取消传输失败: ' + (result.error || '未知错误'));
        
        // 仍然更新UI以避免用户困惑
        setTransferProgress({
          ...transferProgress,
          progress: 0,
          isCancelled: true,
          cancelMessage: '传输已中断'
        });
        
        // 短暂延迟后移除进度条
        setTimeout(() => setTransferProgress(null), 1500);
      }
    } catch (error) {
      console.error('取消传输失败:', error);
      
      // 即使出现错误，也更新UI表明传输已中断
      setTransferProgress({
        ...transferProgress,
        progress: 0,
        isCancelled: true,
        cancelMessage: '传输已中断'
      });
      
      // 短暂延迟后移除进度条
      setTimeout(() => setTransferProgress(null), 1500);
    }
  };

  return (
    <Paper
      sx={{
        width: open ? 300 : 0,
        height: '100%',
        overflow: 'hidden',
        transition: theme => theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        borderTopRightRadius: 0,
        borderBottomRightRadius: 0,
      }}
    >
      {/* 标题栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          p: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexShrink: 0, // 不收缩
        }}
      >
        <Typography variant="subtitle1" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
          文件管理
        </Typography>
        <IconButton size="small" onClick={onClose} edge="end">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* 路径导航和工具栏 */}
      <Box
        sx={{
          p: 1,
          display: 'flex',
          alignItems: 'center',
          borderBottom: `1px solid ${theme.palette.divider}`,
          gap: 0.5,
          flexShrink: 0, // 不收缩
        }}
      >
        <Tooltip title="返回上级目录">
          <span>
            <IconButton 
              size="small" 
              onClick={handleGoBack}
              disabled={!currentPath || (currentPath === '/' && currentPath !== '~')}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        
        <Tooltip title="主目录">
          <IconButton size="small" onClick={handleGoHome}>
            <HomeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        
        <Tooltip title="刷新">
          <IconButton size="small" onClick={handleRefresh}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        
        <Tooltip title="搜索">
          <IconButton size="small" onClick={toggleSearch}>
            <SearchIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 搜索框 */}
      {showSearch && (
        <Box sx={{ 
          p: 1, 
          borderBottom: `1px solid ${theme.palette.divider}`,
          flexShrink: 0 // 不收缩
        }}>
          <TextField
            size="small"
            fullWidth
            placeholder="搜索文件..."
            value={searchTerm}
            onChange={handleSearchChange}
            variant="outlined"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchTerm && (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    onClick={() => setSearchTerm('')}
                    edge="end"
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              )
            }}
          />
        </Box>
      )}

      {/* 当前路径 */}
      <Box sx={{ 
        px: 1, 
        py: 0.5, 
        overflow: 'hidden',
        borderBottom: `1px solid ${theme.palette.divider}`,
        zIndex: 1, // 确保路径输入框显示在上层
        flexShrink: 0 // 不收缩
      }}>
        <TextField
          fullWidth
          size="small"
          variant="outlined"
          value={pathInput}
          onChange={handlePathInputChange}
          onKeyDown={handlePathInputSubmit}
          placeholder="输入路径..."
          InputProps={{
            style: { fontSize: '0.75rem' },
            startAdornment: (
              <InputAdornment position="start">
                <FolderIcon color="action" fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderColor: theme.palette.divider,
              },
              '&:hover fieldset': {
                borderColor: theme.palette.primary.main,
              },
            }
          }}
        />
      </Box>

      {/* 文件列表 */}
      <Box sx={{ 
        flexGrow: 1, 
        overflow: 'auto',
        marginTop: 0, // 确保没有额外的边距
        display: 'flex',
        flexDirection: 'column',
        height: 0, // 确保flex布局正常工作
        position: 'relative' // 创建新的定位上下文
      }}>
        {renderFileList()}
      </Box>

      {/* 文件传输进度 */}
      {transferProgress && (
        <Box sx={{ 
          p: 1.5, 
          borderTop: `1px solid ${theme.palette.divider}`,
          backgroundColor: theme.palette.background.paper,
          flexShrink: 0 // 不收缩
        }}>
          <Box sx={{ mb: 0.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" noWrap sx={{ maxWidth: '60%' }}>
              {transferProgress.type === 'upload' ? '上传: ' : '下载: '}{transferProgress.fileName}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Typography variant="caption" sx={{ mr: 1 }}>
                {transferProgress.isCancelled ? transferProgress.cancelMessage : `${transferProgress.progress}%`}
              </Typography>
              <IconButton 
                size="small" 
                onClick={handleCancelTransfer}
                disabled={transferProgress.isCancelled || transferProgress.progress === 100}
                sx={{ padding: 0.5 }}
              >
                <CancelIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
          
          <LinearProgress 
            variant="determinate" 
            value={transferProgress.progress} 
            sx={{ 
              mb: 0.5,
              ...(transferProgress.isCancelled && {
                '& .MuiLinearProgress-bar': {
                  backgroundColor: theme.palette.error.main,
                }
              })
            }}
          />
          
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="caption">
              {formatFileSize(transferProgress.transferredBytes)} / {formatFileSize(transferProgress.totalBytes)}
            </Typography>
            <Typography variant="caption">
              {!transferProgress.isCancelled && formatTransferSpeed(transferProgress.transferSpeed)}
            </Typography>
          </Box>
          
          {!transferProgress.isCancelled && (
            <Typography variant="caption" sx={{ display: 'block', textAlign: 'right' }}>
              剩余: {formatRemainingTime(transferProgress.remainingTime)}
            </Typography>
          )}
        </Box>
      )}

      {/* 右键菜单 */}
      <Menu
        open={contextMenu !== null}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={handleRename}>
          <ListItemIcon>
            <DriveFileRenameOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>重命名</ListItemText>
        </MenuItem>

        <MenuItem onClick={handleCopyAbsolutePath}>
          <ListItemIcon>
            <LinkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>复制绝对路径</ListItemText>
        </MenuItem>
        
        <Divider />
        
        {selectedFile?.isDirectory && (
          <MenuItem onClick={handleUploadFile}>
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>上传文件到此文件夹</ListItemText>
          </MenuItem>
        )}
        
        {!selectedFile?.isDirectory && (
          <MenuItem onClick={handleDownload}>
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>下载文件</ListItemText>
          </MenuItem>
        )}
        
        <MenuItem onClick={handleDelete}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>删除</ListItemText>
        </MenuItem>
      </Menu>

      {/* 重命名对话框 */}
      {showRenameDialog && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1300,
          }}
        >
          <Paper
            sx={{
              width: '80%',
              maxWidth: 400,
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <Typography variant="subtitle1">重命名</Typography>
            <form onSubmit={handleRenameSubmit}>
              <TextField
                fullWidth
                label="新名称"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                autoFocus
                variant="outlined"
                size="small"
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2, gap: 1 }}>
                <Button onClick={() => setShowRenameDialog(false)} color="inherit" size="small">
                  取消
                </Button>
                <Button type="submit" variant="contained" color="primary" size="small">
                  确定
                </Button>
              </Box>
            </form>
          </Paper>
        </Box>
      )}
    </Paper>
  );
};

export default FileManager; 