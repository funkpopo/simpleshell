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
import { useTheme } from "@mui/material/styles";

// 命令历史记录组件
function CommandHistory({ open, onClose, activeTabId }) {
  const theme = useTheme();
  const [commandHistory, setCommandHistory] = useState([]);
  const [filteredHistory, setFilteredHistory] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [sortAnchorEl, setSortAnchorEl] = useState(null);
  const [sortBy, setSortBy] = useState("time"); // time, frequency, alphabet
  
  // 加载命令历史记录
  useEffect(() => {
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
    
    loadHistory();
  }, []);
  
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
    if (window.terminalAPI?.sendToProcess && activeTabId) {
      try {
        // 获取活动标签页的进程ID
        const processId = window.processCache?.[activeTabId];
        
        if (processId) {
          // 发送命令到终端
          await window.terminalAPI.sendToProcess(processId, command + "\r");
          
          // 更新使用次数
          const updatedHistory = commandHistory.map(item => {
            if (item.command === command) {
              return {
                ...item,
                count: (item.count || 1) + 1,
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
        }
      } catch (error) {
        console.error("Failed to send command to terminal:", error);
      }
    }
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
                <ListItem key={index} disablePadding divider>
                  <ListItemButton onClick={() => handleCommandClick(item.command)}>
                    <ListItemText
                      primary={item.command}
                      secondary={
                        <Box display="flex" alignItems="center" gap={1}>
                          <Chip 
                            label={`使用次数: ${item.count || 1}`} 
                            size="small" 
                            variant="outlined" 
                          />
                          <Typography variant="caption">
                            {item.lastUsed ? new Date(item.lastUsed).toLocaleString() : ""}
                          </Typography>
                        </Box>
                      }
                      sx={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
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
        </>
      )}
    </Paper>
  );
}

export default CommandHistory; 