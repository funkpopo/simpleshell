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
  
  // 拖拽相关状态
  const [draggedItem, setDraggedItem] = useState(null);
  const [draggedItemPath, setDraggedItemPath] = useState(null); // 存储拖拽项的路径 ['groupId'] 或 ['groupId', 'connectionId']
  const [dragOverItem, setDragOverItem] = useState(null);
  const [dragOverType, setDragOverType] = useState(null); // 'item', 'group', 'inside-group'
  const [dragOverPath, setDragOverPath] = useState(null);
  
  // 查找项目路径的辅助函数
  const findItemPath = (itemId, items = connections, currentPath = []) => {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // 检查当前项是否匹配
      if (item.id === itemId) {
        return [...currentPath, i];
      }
      
      // 如果是组，则递归检查其子项
      if (item.type === 'group' && Array.isArray(item.items)) {
        const path = findItemPath(itemId, item.items, [...currentPath, i, 'items']);
        if (path) return path;
      }
    }
    
    return null; // 未找到
  };
  
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
        
        // 判断是否需要移动连接到不同的组或从组中移出
        if ((formData.parentGroup && selectedItem.parentGroupId !== formData.parentGroup) || 
            (!formData.parentGroup && selectedItem.parentGroupId)) {
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
          
          // 添加到新组或顶层
          if (formData.parentGroup) {
            // 添加到新组
            setConnections(prevConnections => 
              prevConnections.map(group => 
                group.id === formData.parentGroup
                  ? { ...group, items: [...group.items, updatedConnection] }
                  : group
              )
            );
          } else {
            // 添加到顶层
            setConnections(prev => [...prev, updatedConnection]);
          }
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
  
  // 拖拽开始处理
  const handleDragStart = (e, item, parentGroup = null) => {
    e.stopPropagation();
    // 设置拖拽效果
    e.dataTransfer.effectAllowed = 'move';
    // 设置拖拽图像
    if (e.target.tagName === 'LI') {
      e.dataTransfer.setDragImage(e.target, 10, 10);
    }
    
    // 将被拖拽项的ID存储在dataTransfer中
    e.dataTransfer.setData('text/plain', JSON.stringify({
      id: item.id,
      type: item.type,
      parentId: parentGroup ? parentGroup.id : null
    }));
    
    // 设置拖拽状态
    setDraggedItem(item);
    const path = findItemPath(item.id);
    setDraggedItemPath(path);
    
    // 添加拖拽时的视觉效果
    e.target.style.opacity = '0.4';
  };
  
  // 拖拽经过处理
  const handleDragOver = (e, item, parentGroup = null, type = 'item') => {
    e.preventDefault();
    e.stopPropagation();
    
    // 如果正在拖拽自己到自己上面，不做任何处理
    if (draggedItem && draggedItem.id === item.id) {
      setDragOverItem(null);
      setDragOverType(null);
      setDragOverPath(null);
      return;
    }
    
    // 新增：如果拖拽的是文件夹且目标是文件夹内部，不允许放置
    if (draggedItem && draggedItem.type === 'group' && type === 'inside-group') {
      // 不更新拖拽状态，表示不可放置
      setDragOverItem(null);
      setDragOverType(null);
      setDragOverPath(null);
      e.dataTransfer.dropEffect = 'none'; // 显示"禁止"图标
      return;
    }
    
    // 设置放置效果为移动
    e.dataTransfer.dropEffect = 'move';
    
    // 更新拖拽经过的目标
    setDragOverItem(item);
    setDragOverType(type);
    
    // 计算目标路径
    const targetPath = findItemPath(item.id);
    setDragOverPath(targetPath);
    
    // 当拖拽到文件夹上并悬停足够时间时，自动展开文件夹
    if (item.type === 'group' && type === 'group') {
      // 可以在这里添加自动展开文件夹的逻辑
      // 例如，如果悬停超过1秒，则展开文件夹
    }
  };
  
  // 处理放置
  const handleDrop = (e, targetItem, parentGroup = null, dropType = 'item') => {
    e.preventDefault();
    e.stopPropagation();
    
    // 如果没有拖拽项或拖拽自己到自己上面，不做任何处理
    if (!draggedItem || draggedItem.id === targetItem.id) {
      resetDragState();
      return;
    }
    
    try {
      // 从dataTransfer中获取拖拽项数据
      const dragData = JSON.parse(e.dataTransfer.getData('text/plain'));
      const { id: dragId, type: dragType, parentId: dragParentId } = dragData;
      
      // 不允许将组拖入连接项
      if (dragType === 'group' && targetItem.type === 'connection') {
        resetDragState();
        return;
      }
      
      // 新增：不允许将文件夹放置到另一个文件夹内部
      if (dragType === 'group' && dropType === 'inside-group') {
        resetDragState();
        return;
      }
      
      // 不允许将组拖入其子组（会导致循环引用）- 代码保留但实际上不再需要，因为已经完全禁止组嵌套
      if (dragType === 'group' && dropType === 'inside-group') {
        // 检查目标组是否是拖拽组的子组
        const isChildGroup = (parentId, childId) => {
          const parent = connections.find(item => item.id === parentId);
          if (!parent || parent.type !== 'group') return false;
          
          // 检查直接子组
          if (parent.items.some(item => item.id === childId)) return true;
          
          // 递归检查子组的子组
          return parent.items
            .filter(item => item.type === 'group')
            .some(group => isChildGroup(group.id, childId));
        };
        
        if (isChildGroup(dragId, targetItem.id)) {
          resetDragState();
          return;
        }
      }
      
      // 创建连接的副本
      const newConnections = [...connections];
      
      // 移动处理逻辑
      if (dropType === 'inside-group' && targetItem.type === 'group') {
        // 检查是否为文件夹：文件夹只能在顶层排序，不能放入其他文件夹
        if (dragType === 'group') {
          resetDragState();
          return;
        }
        // 将项移动到组内 - 仅适用于连接项
        moveItemToGroup(newConnections, dragId, targetItem.id, dragParentId);
      } else {
        // 将项移动到目标位置前面
        moveItemBefore(newConnections, dragId, targetItem.id, dragParentId, parentGroup ? parentGroup.id : null);
      }
      
      // 更新连接状态
      setConnections(newConnections);
    } catch (error) {
      console.error('拖拽处理错误:', error);
    }
    
    // 重置拖拽状态
    resetDragState();
  };
  
  // 移动项到组内
  const moveItemToGroup = (connections, dragId, targetGroupId, dragParentId) => {
    // 获取拖拽项和目标组
    let draggedItem = null;
    let sourceIndex = -1;
    let sourceParentItems = connections;
    
    // 如果拖拽项有父组，从父组中查找
    if (dragParentId) {
      const parentGroup = connections.find(item => item.id === dragParentId);
      if (parentGroup && parentGroup.type === 'group') {
        sourceParentItems = parentGroup.items;
        sourceIndex = sourceParentItems.findIndex(item => item.id === dragId);
        if (sourceIndex !== -1) {
          draggedItem = sourceParentItems[sourceIndex];
          // 如果目标组和源组相同，不做任何操作
          if (dragParentId === targetGroupId) {
            return;
          }
        }
      }
    } else {
      // 从顶层查找
      sourceIndex = connections.findIndex(item => item.id === dragId);
      if (sourceIndex !== -1) {
        draggedItem = connections[sourceIndex];
      }
    }
    
    // 如果找到拖拽项，从原位置移除
    if (draggedItem) {
      sourceParentItems.splice(sourceIndex, 1);
      
      // 查找目标组并添加拖拽项
      const targetGroup = findGroupById(connections, targetGroupId);
      if (targetGroup) {
        targetGroup.items.push(draggedItem);
      }
    }
  };
  
  // 移动项到目标项前面
  const moveItemBefore = (connections, dragId, targetId, dragParentId, targetParentId) => {
    // 获取拖拽项
    let draggedItem = null;
    let sourceIndex = -1;
    let sourceParentItems = connections;
    
    // 获取目标项
    let targetIndex = -1;
    let targetParentItems = connections;
    
    // 查找拖拽项
    if (dragParentId) {
      const parentGroup = findGroupById(connections, dragParentId);
      if (parentGroup) {
        sourceParentItems = parentGroup.items;
        sourceIndex = sourceParentItems.findIndex(item => item.id === dragId);
        if (sourceIndex !== -1) {
          draggedItem = sourceParentItems[sourceIndex];
        }
      }
    } else {
      sourceIndex = connections.findIndex(item => item.id === dragId);
      if (sourceIndex !== -1) {
        draggedItem = connections[sourceIndex];
      }
    }
    
    // 查找目标项
    if (targetParentId) {
      const parentGroup = findGroupById(connections, targetParentId);
      if (parentGroup) {
        targetParentItems = parentGroup.items;
        targetIndex = targetParentItems.findIndex(item => item.id === targetId);
      }
    } else {
      targetIndex = connections.findIndex(item => item.id === targetId);
    }
    
    // 如果找到了拖拽项和目标位置
    if (draggedItem && targetIndex !== -1) {
      // 如果源和目标是同一个容器
      if (sourceParentItems === targetParentItems) {
        // 从原位置移除
        sourceParentItems.splice(sourceIndex, 1);
        
        // 计算新的目标索引（如果源索引在目标索引之前，目标索引需要减1）
        const newTargetIndex = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        
        // 插入到目标位置
        targetParentItems.splice(newTargetIndex, 0, draggedItem);
      } else {
        // 从原位置移除
        sourceParentItems.splice(sourceIndex, 1);
        
        // 插入到目标位置
        targetParentItems.splice(targetIndex, 0, draggedItem);
      }
    }
  };
  
  // 根据ID查找组
  const findGroupById = (items, groupId) => {
    // 直接在当前级别查找
    const directGroup = items.find(item => item.id === groupId && item.type === 'group');
    if (directGroup) return directGroup;
    
    // 在子组中递归查找
    for (const item of items) {
      if (item.type === 'group' && Array.isArray(item.items)) {
        const group = findGroupById(item.items, groupId);
        if (group) return group;
      }
    }
    
    return null;
  };
  
  // 重置拖拽状态
  const resetDragState = () => {
    setDraggedItem(null);
    setDraggedItemPath(null);
    setDragOverItem(null);
    setDragOverType(null);
    setDragOverPath(null);
  };
  
  // 处理拖拽结束
  const handleDragEnd = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 恢复元素的原始样式
    if (e.target && e.target.style) {
      e.target.style.opacity = '1';
    }
    
    // 重置所有拖拽状态
    resetDragState();
  };
  
  // 渲染连接项
  const renderConnectionItem = (connection, parentGroup = null) => {
    const isBeingDragged = draggedItem && draggedItem.id === connection.id;
    const isDropTarget = dragOverItem && dragOverItem.id === connection.id && dragOverType === 'item';
    
    return (
      <ListItem
        key={connection.id}
        disablePadding
        sx={{ 
          pl: parentGroup ? 4 : 1,
          '&:hover': {
            backgroundColor: 'rgba(0, 0, 0, 0.04)',
          },
          backgroundColor: isDropTarget ? 'rgba(144, 202, 249, 0.15)' : 'transparent',
          opacity: isBeingDragged ? 0.4 : 1,
          borderTop: isDropTarget ? `2px solid ${theme.palette.primary.main}` : 'none',
          position: 'relative'
        }}
        secondaryAction={
          <Box>
            <IconButton 
              edge="end" 
              size="small"
              onClick={() => handleEdit(connection, parentGroup)}
              onDragStart={(e) => e.stopPropagation()} // 防止按钮拖拽干扰项目拖拽
            >
              <EditIcon fontSize="small" />
            </IconButton>
            <IconButton 
              edge="end" 
              size="small"
              onClick={() => handleDelete(connection.id, parentGroup)}
              onDragStart={(e) => e.stopPropagation()} // 防止按钮拖拽干扰项目拖拽
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        }
        draggable={true}
        onDragStart={(e) => handleDragStart(e, connection, parentGroup)}
        onDragOver={(e) => handleDragOver(e, connection, parentGroup, 'item')}
        onDrop={(e) => handleDrop(e, connection, parentGroup, 'item')}
        onDragEnd={handleDragEnd}
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
  const renderGroup = (group) => {
    const isBeingDragged = draggedItem && draggedItem.id === group.id;
    const isDropTarget = dragOverItem && dragOverItem.id === group.id;
    const isItemDropTarget = isDropTarget && dragOverType === 'group';
    const isInsideDropTarget = isDropTarget && dragOverType === 'inside-group';
    
    // 判断是否应该显示文件夹内部放置的指示器
    // 只有当拖拽项不是文件夹时才显示
    const showInsideDropIndicator = isInsideDropTarget && 
                                 (!draggedItem || draggedItem.type !== 'group');
    
    return (
      <React.Fragment key={group.id}>
        <ListItem 
          disablePadding 
          sx={{
            backgroundColor: isItemDropTarget ? 'rgba(144, 202, 249, 0.15)' : 'transparent',
            opacity: isBeingDragged ? 0.4 : 1,
            borderTop: isItemDropTarget ? `2px solid ${theme.palette.primary.main}` : 'none',
            position: 'relative'
          }}
          secondaryAction={
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <IconButton 
                edge="end" 
                size="small" 
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddConnection(group.id);
                }}
                onDragStart={(e) => e.stopPropagation()} // 防止按钮拖拽干扰项目拖拽
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
                onDragStart={(e) => e.stopPropagation()} // 防止按钮拖拽干扰项目拖拽
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
                onDragStart={(e) => e.stopPropagation()} // 防止按钮拖拽干扰项目拖拽
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          }
          draggable={true}
          onDragStart={(e) => handleDragStart(e, group)}
          onDragOver={(e) => handleDragOver(e, group, null, 'group')}
          onDrop={(e) => handleDrop(e, group, null, 'group')}
          onDragEnd={handleDragEnd}
        >
          <ListItemButton 
            onClick={() => handleToggleGroup(group.id)}
            sx={{ py: 0.7 }} // 减小上下内边距，但比连接项稍高
            onDragOver={(e) => {
              e.stopPropagation();
              handleDragOver(e, group, null, 'inside-group');
            }}
            onDrop={(e) => {
              e.stopPropagation();
              handleDrop(e, group, null, 'inside-group');
            }}
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
        
        {/* 组内拖放区域指示器 - 只在拖拽项不是文件夹时显示 */}
        {showInsideDropIndicator && !group.expanded && (
          <Box 
            sx={{ 
              height: '2px', 
              backgroundColor: theme.palette.primary.main,
              mx: 4,
              my: 1
            }} 
          />
        )}
        
        <Collapse in={group.expanded} timeout="auto" unmountOnExit>
          <List component="div" disablePadding sx={{ pl: 2 }}>
            {group.items.map(item => renderConnectionItem(item, group))}
            {group.items.length === 0 && (
              <ListItem 
                sx={{ 
                  pl: 2,
                  backgroundColor: showInsideDropIndicator ? 'rgba(144, 202, 249, 0.15)' : 'transparent'
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDragOver(e, group, null, 'inside-group');
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleDrop(e, group, null, 'inside-group');
                }}
              >
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
  };

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