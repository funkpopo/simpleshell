import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Typography, 
  Paper, 
  List, 
  ListItem, 
  ListItemText, 
  ListItemIcon, 
  ListItemButton,
  Collapse,
  Divider,
  IconButton,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Alert
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ComputerIcon from '@mui/icons-material/Computer';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import CloseIcon from '@mui/icons-material/Close';

const ConnectionManager = ({ open, onClose, initialConnections = [], onConnectionsUpdate, onOpenConnection }) => {
  const theme = useTheme();
  const [connections, setConnections] = useState(initialConnections);
  const [isLoading, setIsLoading] = useState(!initialConnections.length);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: '',
    severity: 'info'
  });

  // 初始加载数据
  useEffect(() => {
    if (open && isLoading) {
      try {
        if (window.terminalAPI && window.terminalAPI.loadConnections) {
          window.terminalAPI.loadConnections()
            .then(data => {
              if (data && Array.isArray(data)) {
                setConnections(data);
                if (onConnectionsUpdate) {
                  onConnectionsUpdate(data);
                }
              }
              setIsLoading(false);
            })
            .catch(error => {
              console.error('Error loading connections:', error);
              setSnackbar({
                open: true,
                message: '加载连接配置失败',
                severity: 'error'
              });
              setIsLoading(false);
            });
        } else {
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error accessing terminal API:', error);
        setIsLoading(false);
      }
    }
  }, [open, isLoading, onConnectionsUpdate]);
  
  // 当接收到新的initialConnections时更新
  useEffect(() => {
    if (initialConnections.length > 0 && JSON.stringify(connections) !== JSON.stringify(initialConnections)) {
      setConnections(initialConnections);
      setIsLoading(false);
    }
  }, [initialConnections]);
  
  // 当连接数据变化时保存到文件
  useEffect(() => {
    if (!isLoading && onConnectionsUpdate) {
      onConnectionsUpdate(connections);
    }
  }, [connections, isLoading, onConnectionsUpdate]);
  
  // 关闭消息提示
  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };
  
  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState(''); // 'connection' 或 'group'
  const [dialogMode, setDialogMode] = useState(''); // 'add' 或 'edit'
  const [selectedItem, setSelectedItem] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    authType: 'password',
    privateKeyPath: '',
    parentGroup: ''
  });
  
  // 处理组的展开/折叠
  const handleToggleGroup = (groupId) => {
    setConnections(prevConnections => 
      prevConnections.map(item => 
        item.id === groupId 
          ? { ...item, expanded: !item.expanded } 
          : item
      )
    );
  };
  
  // 打开添加连接对话框
  const handleAddConnection = (parentGroupId = null) => {
    setDialogType('connection');
    setDialogMode('add');
    setFormData({
      name: '',
      host: '',
      port: 22,
      username: '',
      password: '',
      authType: 'password',
      privateKeyPath: '',
      parentGroup: parentGroupId
    });
    setDialogOpen(true);
  };
  
  // 打开添加组对话框
  const handleAddGroup = () => {
    setDialogType('group');
    setDialogMode('add');
    setFormData({
      name: ''
    });
    setDialogOpen(true);
  };
  
  // 打开编辑对话框
  const handleEdit = (item, parentGroup = null) => {
    setSelectedItem({
      ...item,
      parentGroupId: parentGroup ? parentGroup.id : null
    });
    setDialogMode('edit');
    
    if (item.type === 'group') {
      setDialogType('group');
      setFormData({
        name: item.name
      });
    } else {
      setDialogType('connection');
      setFormData({
        name: item.name,
        host: item.host,
        port: item.port || 22,
        username: item.username || '',
        password: item.password || '',
        authType: item.authType || 'password',
        privateKeyPath: item.privateKeyPath || '',
        parentGroup: parentGroup ? parentGroup.id : ''
      });
    }
    
    setDialogOpen(true);
  };
  
  // 删除项目
  const handleDelete = (itemId, parentGroup = null) => {
    if (parentGroup) {
      // 删除组内的连接
      setConnections(prevConnections => 
        prevConnections.map(group => 
          group.id === parentGroup.id
            ? { ...group, items: group.items.filter(item => item.id !== itemId) }
            : group
        )
      );
    } else {
      // 删除最顶层的项目（组或连接）
      setConnections(prevConnections => prevConnections.filter(item => item.id !== itemId));
    }
  };
  
  // 处理对话框关闭
  const handleDialogClose = () => {
    setDialogOpen(false);
  };
  
  // 处理表单变化
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };
  
  // 保存表单数据
  const handleSave = () => {
    const newId = `${dialogType}-${Date.now()}`;
    
    if (dialogMode === 'add') {
      if (dialogType === 'connection') {
        const newConnection = {
          id: newId,
          name: formData.name,
          host: formData.host,
          port: formData.port,
          username: formData.username,
          password: formData.password,
          type: 'connection',
          authType: formData.authType,
          privateKeyPath: formData.privateKeyPath
        };
        
        if (formData.parentGroup) {
          // 添加到指定组
          setConnections(prevConnections => 
            prevConnections.map(group => 
              group.id === formData.parentGroup
                ? { ...group, items: [...group.items, newConnection] }
                : group
            )
          );
        } else {
          // 添加到顶层
          setConnections(prev => [...prev, newConnection]);
        }
      } else if (dialogType === 'group') {
        // 添加新组
        setConnections(prev => [...prev, {
          id: newId,
          name: formData.name,
          type: 'group',
          expanded: false,
          items: []
        }]);
      }
    } else if (dialogMode === 'edit') {
      if (dialogType === 'connection') {
        const updatedConnection = {
          ...selectedItem,
          name: formData.name,
          host: formData.host,
          port: formData.port,
          username: formData.username,
          password: formData.password,
          authType: formData.authType,
          privateKeyPath: formData.privateKeyPath
        };
        
        // 判断是否需要移动连接到不同的组
        if (formData.parentGroup && selectedItem.parentGroupId !== formData.parentGroup) {
          // 从原组中删除
          if (selectedItem.parentGroupId) {
            setConnections(prevConnections => 
              prevConnections.map(group => 
                group.id === selectedItem.parentGroupId
                  ? { ...group, items: group.items.filter(item => item.id !== selectedItem.id) }
                  : group
              )
            );
          } else {
            // 从顶层删除
            setConnections(prev => prev.filter(item => item.id !== selectedItem.id));
          }
          
          // 添加到新组
          setConnections(prevConnections => 
            prevConnections.map(group => 
              group.id === formData.parentGroup
                ? { ...group, items: [...group.items, updatedConnection] }
                : group
            )
          );
        } else {
          // 更新当前位置
          if (selectedItem.parentGroupId) {
            setConnections(prevConnections => 
              prevConnections.map(group => 
                group.id === selectedItem.parentGroupId
                  ? { 
                      ...group, 
                      items: group.items.map(item => 
                        item.id === selectedItem.id ? updatedConnection : item
                      ) 
                    }
                  : group
              )
            );
          } else {
            setConnections(prev => 
              prev.map(item => item.id === selectedItem.id ? updatedConnection : item)
            );
          }
        }
      } else if (dialogType === 'group') {
        // 更新组
        setConnections(prev => 
          prev.map(item => 
            item.id === selectedItem.id
              ? { ...item, name: formData.name }
              : item
          )
        );
      }
    }
    
    setDialogOpen(false);
  };
  
  // 处理打开连接
  const handleOpenConnection = (connection) => {
    if (onOpenConnection && connection) {
      onOpenConnection(connection);
      // 可选：关闭连接管理器
      onClose();
    }
  };
  
  // 渲染连接项
  const renderConnectionItem = (connection, parentGroup = null) => {
    return (
      <ListItem
        key={connection.id}
        disablePadding
        sx={{ 
          pl: parentGroup ? 4 : 1,
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.04)',
          }
        }}
        secondaryAction={
          <Box>
            <IconButton 
              edge="end" 
              size="small"
              onClick={() => handleEdit(connection, parentGroup)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton 
              edge="end" 
              size="small"
              onClick={() => handleDelete(connection.id, parentGroup)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      >
        <ListItemButton 
          onClick={() => handleOpenConnection(connection)}
          dense
          sx={{ borderRadius: 1 }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            <ComputerIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText 
            primary={connection.name || connection.host} 
            secondary={connection.username ? `${connection.username}@${connection.host}` : connection.host}
            primaryTypographyProps={{ variant: 'body2' }}
            secondaryTypographyProps={{ variant: 'caption' }}
          />
        </ListItemButton>
      </ListItem>
    );
  };
  
  // 渲染组
  const renderGroup = (group) => (
    <React.Fragment key={group.id}>
      <ListItem 
        disablePadding 
        secondaryAction={
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <IconButton 
              edge="end" 
              size="small" 
              onClick={(e) => {
                e.stopPropagation();
                handleAddConnection(group.id);
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton 
              edge="end" 
              size="small" 
              onClick={(e) => {
                e.stopPropagation();
                handleEdit(group);
              }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton 
              edge="end" 
              size="small" 
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(group.id);
              }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        }
      >
        <ListItemButton 
          onClick={() => handleToggleGroup(group.id)}
          sx={{ py: 0.7 }} // 减小上下内边距，但比连接项稍高
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            {group.expanded ? <FolderOpenIcon fontSize="small" /> : <FolderIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText 
            primary={group.name} 
            primaryTypographyProps={{ 
              variant: 'body2', 
              fontWeight: 'medium',
              margin: 0 
            }}
            sx={{ my: 0 }} // 减小外边距
          />
        </ListItemButton>
      </ListItem>
      
      <Collapse in={group.expanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding sx={{ pl: 2 }}>
          {group.items.map(item => renderConnectionItem(item, group))}
          {group.items.length === 0 && (
            <ListItem sx={{ pl: 2 }}>
              <ListItemText 
                primary="没有连接项" 
                primaryTypographyProps={{ variant: 'caption', sx: { fontStyle: 'italic', color: 'text.disabled' } }}
              />
            </ListItem>
          )}
        </List>
      </Collapse>
    </React.Fragment>
  );

  return (
    <Paper
      sx={{
        width: open ? 300 : 0,
        height: '100%',
        overflow: 'hidden',
        transition: theme.transitions.create('width', {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0,
      }}
      elevation={4}
    >
      {open && (
        <>
          {/* 头部 */}
          <Box sx={{ 
            p: 2, 
            borderBottom: 1, 
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <Typography variant="h6">连接管理</Typography>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          
          {/* 操作按钮区 */}
          <Box sx={{ 
            p: 1, 
            display: 'flex', 
            justifyContent: 'flex-end', 
            borderBottom: 1, 
            borderColor: 'divider',
            gap: 1
          }}>
            <Button 
              size="small" 
              startIcon={<AddIcon />}
              onClick={() => handleAddConnection()}
              sx={{ fontSize: '0.75rem' }}
            >
              新建连接
            </Button>
            <Button 
              size="small" 
              startIcon={<FolderIcon />}
              onClick={handleAddGroup}
              sx={{ fontSize: '0.75rem' }}
            >
              新建分组
            </Button>
          </Box>
          
          {/* 连接列表区域 */}
          <Box sx={{ flexGrow: 1, overflow: 'auto', height: 'calc(100% - 120px)' }}>
            <List dense sx={{ p: 1 }}>
              {connections.map(item => 
                item.type === 'group' 
                  ? renderGroup(item) 
                  : renderConnectionItem(item)
              )}
              {connections.length === 0 && (
                <ListItem>
                  <ListItemText 
                    primary="没有连接项" 
                    primaryTypographyProps={{ 
                      variant: 'body2', 
                      sx: { fontStyle: 'italic', color: 'text.secondary', textAlign: 'center' } 
                    }}
                  />
                </ListItem>
              )}
            </List>
          </Box>
          
          {/* 添加/编辑对话框 */}
          <Dialog open={dialogOpen} onClose={handleDialogClose} maxWidth="sm" fullWidth>
            <DialogTitle>
              {dialogMode === 'add' ? '新建' : '编辑'} 
              {dialogType === 'connection' ? '连接' : '分组'}
            </DialogTitle>
            <DialogContent dividers>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField
                  label="名称"
                  name="name"
                  value={formData.name}
                  onChange={handleFormChange}
                  fullWidth
                  size="small"
                  required
                />
                
                {dialogType === 'connection' && (
                  <>
                    <TextField
                      label="主机地址"
                      name="host"
                      value={formData.host}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      required
                    />
                    
                    <TextField
                      label="端口"
                      name="port"
                      type="number"
                      value={formData.port}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                    />
                    
                    <TextField
                      label="用户名"
                      name="username"
                      value={formData.username}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                    />
                    
                    <TextField
                      label="密码"
                      name="password"
                      type="password"
                      value={formData.password}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      disabled={formData.authType === 'privateKey'}
                    />
                    
                    <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                      <InputLabel>认证方式</InputLabel>
                      <Select
                        name="authType"
                        value={formData.authType}
                        label="认证方式"
                        onChange={handleFormChange}
                      >
                        <MenuItem value="password">密码认证</MenuItem>
                        <MenuItem value="privateKey">密钥认证</MenuItem>
                      </Select>
                    </FormControl>

                    {formData.authType === 'privateKey' && (
                      <Box sx={{ display: 'flex', mt: 1 }}>
                        <TextField
                          label="私钥路径"
                          name="privateKeyPath"
                          value={formData.privateKeyPath}
                          onChange={handleFormChange}
                          fullWidth
                          size="small"
                          sx={{ flexGrow: 1 }}
                        />
                        <Button 
                          variant="outlined" 
                          size="small" 
                          sx={{ ml: 1 }}
                          onClick={() => {
                            if (window.terminalAPI && window.terminalAPI.selectKeyFile) {
                              window.terminalAPI.selectKeyFile().then(filePath => {
                                if (filePath) {
                                  setFormData(prev => ({
                                    ...prev,
                                    privateKeyPath: filePath
                                  }));
                                }
                              });
                            }
                          }}
                        >
                          浏览...
                        </Button>
                      </Box>
                    )}
                    
                    <FormControl fullWidth size="small">
                      <InputLabel>分组</InputLabel>
                      <Select
                        name="parentGroup"
                        value={formData.parentGroup}
                        label="分组"
                        onChange={handleFormChange}
                      >
                        <MenuItem value="">
                          <em>不分组</em>
                        </MenuItem>
                        {connections.filter(c => c.type === 'group').map(group => (
                          <MenuItem key={group.id} value={group.id}>{group.name}</MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleDialogClose}>取消</Button>
              <Button onClick={handleSave} variant="contained">保存</Button>
            </DialogActions>
          </Dialog>
          
          {/* 消息提示组件 */}
          <Snackbar 
            open={snackbar.open} 
            autoHideDuration={4000} 
            onClose={handleSnackbarClose}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          >
            <Alert 
              onClose={handleSnackbarClose} 
              severity={snackbar.severity}
              sx={{ width: '100%' }}
            >
              {snackbar.message}
            </Alert>
          </Snackbar>
        </>
      )}
    </Paper>
  );
};

export default ConnectionManager; 