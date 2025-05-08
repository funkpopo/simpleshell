import React, { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import SortIcon from "@mui/icons-material/Sort";
import SearchIcon from "@mui/icons-material/Search";
import TextField from "@mui/material/TextField";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import { useTheme } from "@mui/material/styles";

// 命令历史记录组件
function CommandHistory({ open, onClose, activeTabId }) {
  const theme = useTheme();
  const [commandHistory, setCommandHistory] = useState([]);
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortAnchorEl, setSortAnchorEl] = useState(null);
  const [sortBy, setSortBy] = useState("time"); // time, frequency, alphabet
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success"
  });
  
  // 编辑和删除相关状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentCommand, setCurrentCommand] = useState(null);
  const [editedCommand, setEditedCommand] = useState("");
  
  // 提取加载命令历史记录函数，便于重复调用
  const loadHistory = async () => {
    if (window.terminalAPI?.loadCommandHistory) {
      try {
        const history = await window.terminalAPI.loadCommandHistory();
        
        // 确保所有历史记录都有标准格式
        const standardizedHistory = history.map(item => {
          if (typeof item === 'string') {
            return {
              command: item,
              count: 1,
              lastUsed: Date.now()
            };
          }
          return item;
        });
        
        setCommandHistory(standardizedHistory);
        applyFiltersAndSort(standardizedHistory, searchTerm, sortBy);
      } catch (error) {
        console.error("Failed to load command history:", error);
      }
    }
  };
  
  // 初始加载历史记录
  useEffect(() => {
    loadHistory();
  }, []);
  
  // 添加自动刷新机制，每秒刷新一次
  useEffect(() => {
    let intervalId = null;
    
    // 只有在面板打开时才启动定时器
    if (open) {
      intervalId = setInterval(() => {
        loadHistory();
      }, 1000);
    }
    
    // 清理函数：组件卸载或面板关闭时停止定时器
    return () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
    };
  }, [open, searchTerm, sortBy]); // 依赖项包括open状态和筛选条件
  
  // 搜索和排序功能
  const applyFiltersAndSort = (history, term, sortType) => {
    let filtered = [...history];
    
    // 应用搜索过滤
    if (term) {
      filtered = filtered.filter(item => 
        item.command.toLowerCase().includes(term.toLowerCase())
      );
    }
    
    // 应用排序
    switch (sortType) {
      case "frequency":
        filtered.sort((a, b) => (b.count || 1) - (a.count || 1));
        break;
      case "alphabet":
        filtered.sort((a, b) => a.command.localeCompare(b.command));
        break;
      case "time":
      default:
        filtered.sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0));
        break;
    }
    
    setFilteredHistory(filtered);
  };
  
  // 搜索处理
  const handleSearchChange = (event) => {
    const term = event.target.value;
    setSearchTerm(term);
    applyFiltersAndSort(commandHistory, term, sortBy);
  };
  
  // 排序菜单
  const handleSortClick = (event) => {
    setSortAnchorEl(event.currentTarget);
  };
  
  const handleSortClose = () => {
    setSortAnchorEl(null);
  };
  
  const handleSortSelect = (type) => {
    setSortBy(type);
    applyFiltersAndSort(commandHistory, searchTerm, type);
    handleSortClose();
  };
  
  // 发送命令到终端
  const handleCommandClick = async (command) => {
    try {
      // 复制命令到剪贴板
      await navigator.clipboard.writeText(command);
      
      // 更新使用时间但不增加使用次数
      const updatedHistory = commandHistory.map(item => {
        if (item.command === command) {
          return {
            ...item,
            lastUsed: Date.now()
          };
        }
        return item;
      });
      
      // 保存更新后的历史记录
      if (window.terminalAPI?.saveCommandHistory) {
        await window.terminalAPI.saveCommandHistory(updatedHistory);
      }
      
      // 更新状态
      setCommandHistory(updatedHistory);
      applyFiltersAndSort(updatedHistory, searchTerm, sortBy);
      
      // 显示复制成功信息
      setSnackbar({
        open: true,
        message: "命令已复制到剪贴板",
        severity: "success"
      });
    } catch (error) {
      console.error("Failed to copy command to clipboard:", error);
      setSnackbar({
        open: true,
        message: "复制到剪贴板失败: " + error.message,
        severity: "error"
      });
    }
  };
  
  // 关闭提示框
  const handleSnackbarClose = () => {
    setSnackbar({ ...snackbar, open: false });
  };
  
  // 处理删除命令
  const handleDeleteClick = async (command) => {
    try {
      // 从历史记录中移除该命令
      const updatedHistory = commandHistory.filter(item => 
        item.command !== command.command
      );
      
      // 保存更新后的历史记录
      if (window.terminalAPI?.saveCommandHistory) {
        await window.terminalAPI.saveCommandHistory(updatedHistory);
      }
      
      // 更新状态
      setCommandHistory(updatedHistory);
      applyFiltersAndSort(updatedHistory, searchTerm, sortBy);
      
      // 显示删除成功信息
      setSnackbar({
        open: true,
        message: "命令已删除",
        severity: "success"
      });
    } catch (error) {
      console.error("Failed to delete command:", error);
      setSnackbar({
        open: true,
        message: "删除命令失败: " + error.message,
        severity: "error"
      });
    }
  };
  
  // 打开编辑对话框
  const handleEditClick = (command) => {
    setCurrentCommand(command);
    setEditedCommand(command.command);
    setEditDialogOpen(true);
  };
  
  // 关闭编辑对话框
  const handleEditCancel = () => {
    setEditDialogOpen(false);
    setCurrentCommand(null);
    setEditedCommand("");
  };
  
  // 处理编辑内容变化
  const handleEditChange = (event) => {
    setEditedCommand(event.target.value);
  };
  
  // 保存编辑后的命令
  const handleEditSave = async () => {
    if (!currentCommand || editedCommand.trim() === "") return;
    
    try {
      // 更新命令历史记录
      const updatedHistory = commandHistory.map(item => {
        if (item.command === currentCommand.command) {
          return {
            ...item,
            command: editedCommand.trim(),
            lastUsed: Date.now()
          };
        }
        return item;
      });
      
      // 保存更新后的历史记录
      if (window.terminalAPI?.saveCommandHistory) {
        await window.terminalAPI.saveCommandHistory(updatedHistory);
      }
      
      // 更新状态
      setCommandHistory(updatedHistory);
      applyFiltersAndSort(updatedHistory, searchTerm, sortBy);
      
      // 显示编辑成功信息
      setSnackbar({
        open: true,
        message: "命令已更新",
        severity: "success"
      });
    } catch (error) {
      console.error("Failed to update command:", error);
      setSnackbar({
        open: true,
        message: "更新命令失败: " + error.message,
        severity: "error"
      });
    }
    
    // 关闭对话框
    setEditDialogOpen(false);
    setCurrentCommand(null);
    setEditedCommand("");
  };

  return (
    <Paper
      elevation={4}
      sx={{
        width: open ? 300 : 0,
        height: "100%",
        overflow: "hidden",
        transition: theme.transitions.create("width", {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
    >
      {open && (
        <>
          {/* 标题栏 */}
          <Box
            sx={{
              p: 1,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="h6" component="div">
              命令历史记录
            </Typography>
            <Box>
              <Tooltip title="排序方式">
                <IconButton size="small" onClick={handleSortClick}>
                  <SortIcon />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={sortAnchorEl}
                open={Boolean(sortAnchorEl)}
                onClose={handleSortClose}
              >
                <MenuItem onClick={() => handleSortSelect("time")}>
                  按时间排序 {sortBy === "time" && "✓"}
                </MenuItem>
                <MenuItem onClick={() => handleSortSelect("frequency")}>
                  按使用频率排序 {sortBy === "frequency" && "✓"}
                </MenuItem>
                <MenuItem onClick={() => handleSortSelect("alphabet")}>
                  按字母排序 {sortBy === "alphabet" && "✓"}
                </MenuItem>
              </Menu>
              <IconButton size="small" onClick={onClose}>
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>
          
          {/* 搜索框 */}
          <Box sx={{ p: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="搜索命令"
              value={searchTerm}
              onChange={handleSearchChange}
              InputProps={{
                startAdornment: <SearchIcon sx={{ mr: 1, color: "text.secondary" }} />,
              }}
            />
          </Box>
          
          {/* 命令列表 */}
          <List
            sx={{
              overflow: "auto",
              flexGrow: 1,
              maxHeight: "calc(100% - 110px)",
            }}
          >
            {filteredHistory.length > 0 ? (
              filteredHistory.map((item, index) => (
                <ListItem 
                  key={index} 
                  disablePadding 
                  divider
                  secondaryAction={
                    <Box 
                      className="command-actions" 
                      sx={{ 
                        display: 'flex',
                        visibility: 'hidden', // 默认隐藏
                        transition: 'visibility 0.2s'
                      }}
                    >
                      <Tooltip title="编辑命令">
                        <IconButton 
                          edge="end" 
                          size="small" 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditClick(item);
                          }}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除命令">
                        <IconButton 
                          edge="end" 
                          size="small" 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteClick(item);
                          }}
                          sx={{ ml: 0.5 }}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                  sx={{
                    '&:hover .command-actions': {
                      visibility: 'visible',
                    },
                  }}
                >
                  <ListItemButton 
                    onClick={() => handleCommandClick(item.command)}
                    sx={{
                      '&:hover': {
                        backgroundColor: theme.palette.mode === 'dark' 
                          ? 'rgba(255, 255, 255, 0.08)' 
                          : 'rgba(0, 0, 0, 0.04)',
                      }
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <Typography 
                            component="span" 
                            variant="body2" 
                            sx={{ 
                              flexGrow: 1,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {item.command}
                          </Typography>
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" sx={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          width: '100%'
                        }}>
                          <span>{item.lastUsed ? new Date(item.lastUsed).toLocaleString() : ""}</span>
                          {item.count > 1 && <span>× {item.count}</span>}
                        </Typography>
                      }
                      sx={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        pr: 6,
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              ))
            ) : (
              <ListItem>
                <ListItemText
                  primary={searchTerm ? "没有匹配的命令" : "暂无命令历史记录"}
                  sx={{ textAlign: "center", color: "text.secondary" }}
                />
              </ListItem>
            )}
          </List>

          {/* 提示框 */}
          <Snackbar
            open={snackbar.open}
            autoHideDuration={4000}
            onClose={handleSnackbarClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
          >
            <Alert
              onClose={handleSnackbarClose}
              severity={snackbar.severity}
              sx={{ width: "100%" }}
            >
              {snackbar.message}
            </Alert>
          </Snackbar>
          
          {/* 编辑命令对话框 */}
          <Dialog
            open={editDialogOpen}
            onClose={handleEditCancel}
            fullWidth
            maxWidth="sm"
          >
            <DialogTitle>编辑命令</DialogTitle>
            <DialogContent>
              <TextField
                autoFocus
                margin="dense"
                label="命令"
                type="text"
                fullWidth
                variant="outlined"
                value={editedCommand}
                onChange={handleEditChange}
                sx={{ mt: 1 }}
              />
            </DialogContent>
            <DialogActions>
              <Button onClick={handleEditCancel}>取消</Button>
              <Button 
                onClick={handleEditSave} 
                color="primary"
                disabled={editedCommand.trim() === ""}
              >
                保存
              </Button>
            </DialogActions>
          </Dialog>
        </>
      )}
    </Paper>
  );
}

export default CommandHistory; 