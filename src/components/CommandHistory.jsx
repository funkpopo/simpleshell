import React, { useState, useEffect, useRef, useMemo } from "react";
import useAutoCleanup from "../hooks/useAutoCleanup";
import { List } from "react-window";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Button,
  Divider,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  InputAdornment,
  CircularProgress,
  Snackbar,
  Alert,
  Checkbox,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import { useTranslation } from "react-i18next";
import { dispatchCommandToGroup } from "../core/syncGroupCommandDispatcher";

// 虚拟化历史记录项组件
const HistoryItem = React.memo(({ index, style, data }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const {
    filteredHistory,
    selectMode,
    selectedCommands,
    toggleCommandSelection,
    handleSendCommand,
    handleMenuOpen,
    formatTime,
  } = data;

  const item = filteredHistory[index];
  if (!item) return null;

  return (
    <div style={style}>
      <ListItem
        disablePadding
        sx={{
          borderBottom: `1px solid ${theme.palette.divider}`,
          overflow: "hidden",
        }}
      >
        <ListItemButton
          onClick={() =>
            selectMode
              ? toggleCommandSelection(item.command)
              : handleSendCommand(item.command)
          }
          sx={{
            minHeight: 48,
            bgcolor:
              selectMode && selectedCommands.has(item.command)
                ? "action.selected"
                : "transparent",
            borderRadius: 0,
          }}
        >
          {selectMode && (
            <ListItemIcon sx={{ minWidth: 36 }}>
              <Checkbox
                checked={selectedCommands.has(item.command)}
                onChange={() => toggleCommandSelection(item.command)}
                size="small"
              />
            </ListItemIcon>
          )}

          <ListItemText
            primary={
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    flex: 1,
                    wordBreak: "break-all",
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                    lineHeight: "1.2em",
                    maxHeight: "2.4em",
                  }}
                >
                  {item.command}
                </Typography>
                {item.count > 1 && (
                  <Chip
                    label={`${item.count}次`}
                    size="small"
                    variant="outlined"
                    sx={{ fontSize: "0.7rem", height: 20 }}
                  />
                )}
              </Box>
            }
            secondary={
              <Typography variant="caption" color="text.secondary">
                {formatTime(item.timestamp)}
              </Typography>
            }
          />

          {!selectMode && (
            <IconButton
              size="small"
              onClick={(e) => handleMenuOpen(e, item)}
              sx={{ ml: 1 }}
            >
              <MoreVertIcon />
            </IconButton>
          )}
        </ListItemButton>
      </ListItem>
    </div>
  );
});

function CommandHistory({ open, onClose, onSendCommand }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef(null);
  const [selectedCommands, setSelectedCommands] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [containerHeight, setContainerHeight] = useState(400);
  const containerRef = useRef(null);

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 只在历史命令管理器打开时处理快捷键
      if (!open) return;

      // 检查当前焦点是否在终端区域内，如果是则不处理侧边栏快捷键
      const activeElement = document.activeElement;
      const isInTerminal =
        activeElement &&
        (activeElement.classList.contains("xterm-helper-textarea") ||
          activeElement.classList.contains("xterm-screen"));

      // 如果焦点在终端的输入区域内，则不处理侧边栏的快捷键
      if (isInTerminal) return;

      // Ctrl+/ 聚焦到搜索框
      if (e.ctrlKey && e.key === "/") {
        e.preventDefault();
        e.stopPropagation();
        if (searchInputRef.current) {
          searchInputRef.current.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // 对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [currentCommand, setCurrentCommand] = useState(null);
  const [editedCommand, setEditedCommand] = useState("");

  // 菜单状态
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [menuTargetCommand, setMenuTargetCommand] = useState(null);
  const menuOpen = Boolean(menuAnchorEl);

  // 通知状态
  const [notification, setNotification] = useState({
    open: false,
    message: "",
    severity: "success",
  });

  // 加载历史记录
  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  // 使用自动清理Hook
  const { addResizeObserver } = useAutoCleanup();

  // 动态计算容器高度
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.height > 0) {
          setContainerHeight(rect.height);
        }
      }
    };

    updateHeight();

    // 使用 addResizeObserver 自动管理观察器，组件卸载时自动清理
    if (containerRef.current) {
      addResizeObserver(updateHeight, containerRef.current);
    }
  }, [open, addResizeObserver]);

  // 加载历史记录
  const loadHistory = async () => {
    setLoading(true);
    try {
      if (window.terminalAPI?.getAllCommandHistory) {
        const result = await window.terminalAPI.getAllCommandHistory();
        if (result.success) {
          setHistory(result.data || []);
        } else {
          showNotification("加载历史记录失败", "error");
        }
      }
    } catch (error) {
      showNotification("加载历史记录出错", "error");
    } finally {
      setLoading(false);
    }
  };

  // 显示通知
  const showNotification = (message, severity = "success") => {
    setNotification({
      open: true,
      message,
      severity,
    });
  };

  // 关闭通知
  const handleCloseNotification = () => {
    setNotification((prev) => ({ ...prev, open: false }));
  };

  // 处理搜索输入变化
  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  // 获取过滤后的历史记录
  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) {
      return history;
    }
    const searchTermLower = searchTerm.toLowerCase();
    return history.filter((item) =>
      item.command.toLowerCase().includes(searchTermLower),
    );
  }, [history, searchTerm]);

  // 格式化时间
  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  // 处理菜单打开
  const handleMenuOpen = (event, command) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
    setMenuTargetCommand(command);
  };

  // 处理菜单关闭
  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setMenuTargetCommand(null);
  };

  // 处理发送命令
  const handleSendCommand = (command) => {
    // 需要tabId，假设通过props.currentTabId传递
    if (onSendCommand) {
      const result = onSendCommand(command);
      if (result && result.success === false) {
        showNotification(`发送失败: ${result.error}`, "error");
      } else {
        showNotification(t("commandHistory.commandSent", { command }));
      }
    } else {
      showNotification(t("commandHistory.sendCommandHandlerMissing"), "error");
    }
    handleMenuClose();
  };

  // 选择/取消选择命令
  const toggleCommandSelection = (command) => {
    const newSelected = new Set(selectedCommands);
    if (newSelected.has(command)) {
      newSelected.delete(command);
    } else {
      newSelected.add(command);
    }
    setSelectedCommands(newSelected);
  };

  // 虚拟化列表的数据
  const listItemData = useMemo(
    () => ({
      filteredHistory,
      selectMode,
      selectedCommands,
      toggleCommandSelection,
      handleSendCommand,
      handleMenuOpen,
      formatTime,
    }),
    [
      filteredHistory,
      selectMode,
      selectedCommands,
      toggleCommandSelection,
      handleSendCommand,
      handleMenuOpen,
      formatTime,
    ],
  );

  // 获取过滤后的历史记录
  const getFilteredHistory = () => {
    return filteredHistory;
  };

  // 复制命令到剪贴板
  const handleCopyCommand = async (command) => {
    try {
      await navigator.clipboard.writeText(command);
      showNotification(t("commandHistory.commandCopied"));
    } catch (error) {
      showNotification(t("commandHistory.copyFailed"), "error");
    }
    handleMenuClose();
  };

  // 编辑命令
  const handleEditCommand = (historyItem) => {
    setCurrentCommand(historyItem);
    setEditedCommand(historyItem.command);
    setEditDialogOpen(true);
    handleMenuClose();
  };

  // 保存编辑的命令
  const handleSaveEditedCommand = async () => {
    if (!editedCommand.trim()) {
      showNotification(t("commandHistory.commandEmpty"), "error");
      return;
    }

    try {
      // 将编辑后的命令保存为快捷命令
      if (
        window.terminalAPI?.getShortcutCommands &&
        window.terminalAPI?.saveShortcutCommands
      ) {
        const result = await window.terminalAPI.getShortcutCommands();
        if (result.success) {
          const newCommand = {
            id: `cmd-${Date.now()}`,
            name: editedCommand.split(" ")[0] || "Command",
            command: editedCommand,
            description: `从历史记录编辑的命令`,
            category: result.data.categories?.[0]?.id || "",
            params: [],
            tags: [],
          };

          const updatedCommands = [...(result.data.commands || []), newCommand];
          const saveResult = await window.terminalAPI.saveShortcutCommands({
            commands: updatedCommands,
            categories: result.data.categories || [],
          });

          if (saveResult.success) {
            showNotification(t("commandHistory.savedToShortcuts"));
          } else {
            showNotification(
              t("commandHistory.saveToShortcutsFailed"),
              "error",
            );
          }
        }
      }
    } catch (error) {
      showNotification(t("commandHistory.saveToShortcutsFailed"), "error");
    }

    setEditDialogOpen(false);
    setCurrentCommand(null);
    setEditedCommand("");
  };

  // 删除单个历史记录
  const handleDeleteCommand = async (command) => {
    try {
      if (window.terminalAPI?.deleteCommandHistory) {
        const result = await window.terminalAPI.deleteCommandHistory(command);
        if (result.success) {
          await loadHistory(); // 重新加载历史记录
          showNotification(t("commandHistory.commandDeleted"));
        } else {
          showNotification(t("commandHistory.deleteFailed"), "error");
        }
      }
    } catch (error) {
      showNotification(t("commandHistory.deleteFailed"), "error");
    }
    handleMenuClose();
  };

  // 切换选择模式
  const toggleSelectMode = () => {
    setSelectMode(!selectMode);
    setSelectedCommands(new Set());
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (selectedCommands.size === filteredHistory.length) {
      setSelectedCommands(new Set());
    } else {
      setSelectedCommands(new Set(filteredHistory.map((item) => item.command)));
    }
  };

  // 批量删除选中的命令
  const handleDeleteSelected = async () => {
    if (selectedCommands.size === 0) return;

    try {
      if (window.terminalAPI?.deleteCommandHistoryBatch) {
        const result = await window.terminalAPI.deleteCommandHistoryBatch(
          Array.from(selectedCommands),
        );
        if (result.success) {
          await loadHistory();
          setSelectedCommands(new Set());
          setSelectMode(false);
          showNotification(
            t("commandHistory.batchDeleteSuccess", {
              count: selectedCommands.size,
            }),
          );
        } else {
          showNotification(t("commandHistory.batchDeleteFailed"), "error");
        }
      }
    } catch (error) {
      showNotification(t("commandHistory.batchDeleteFailed"), "error");
    }
  };

  // 清空所有历史记录
  const handleClearAll = async () => {
    try {
      if (window.terminalAPI?.clearCommandHistory) {
        const result = await window.terminalAPI.clearCommandHistory();
        if (result.success) {
          setHistory([]);
          setSelectedCommands(new Set());
          setSelectMode(false);
          showNotification(t("commandHistory.clearAllSuccess"));
        } else {
          showNotification(t("commandHistory.clearAllFailed"), "error");
        }
      }
    } catch (error) {
      showNotification(t("commandHistory.clearAllFailed"), "error");
    }
  };

  return (
    <>
      <Paper
        elevation={4}
        sx={{
          width: open ? 300 : 0,
          height: "100vh",
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
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                p: 2,
                borderBottom: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Typography variant="subtitle1" fontWeight="medium">
                {t("commandHistory.title")}
              </Typography>
              <IconButton onClick={onClose} size="small">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>

            {/* 搜索栏和工具栏 */}
            <Box
              sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}
            >
              <TextField
                inputRef={searchInputRef}
                fullWidth
                size="small"
                placeholder={t("commandHistory.search")}
                value={searchTerm}
                onChange={handleSearchChange}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon />
                    </InputAdornment>
                  ),
                  endAdornment: searchTerm && (
                    <InputAdornment position="end">
                      <IconButton
                        size="small"
                        onClick={() => setSearchTerm("")}
                        edge="end"
                      >
                        <ClearIcon fontSize="small" />
                      </IconButton>
                    </InputAdornment>
                  ),
                }}
                sx={{
                  mb: 2,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2,
                  },
                }}
              />

              <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                <Button
                  size="small"
                  variant={selectMode ? "contained" : "outlined"}
                  onClick={toggleSelectMode}
                  startIcon={<SelectAllIcon />}
                >
                  {selectMode
                    ? t("commandHistory.exitSelect")
                    : t("commandHistory.selectMode")}
                </Button>

                {selectMode && (
                  <>
                    <Button
                      size="small"
                      onClick={toggleSelectAll}
                      startIcon={<SelectAllIcon />}
                    >
                      {selectedCommands.size === filteredHistory.length
                        ? t("commandHistory.deselectAll")
                        : t("commandHistory.selectAll")}
                    </Button>

                    {selectedCommands.size > 0 && (
                      <Button
                        size="small"
                        color="error"
                        onClick={handleDeleteSelected}
                        startIcon={<DeleteIcon />}
                      >
                        {t("commandHistory.deleteSelected")} (
                        {selectedCommands.size})
                      </Button>
                    )}
                  </>
                )}

                <Button
                  size="small"
                  color="error"
                  onClick={handleClearAll}
                  startIcon={<ClearAllIcon />}
                  disabled={history.length === 0}
                >
                  {t("commandHistory.clearAll")}
                </Button>
              </Box>
            </Box>

            {/* 历史记录列表 */}
            <Box
              ref={containerRef}
              sx={{
                flex: 1,
                overflow: "auto",
                bgcolor:
                  theme.palette.mode === "dark"
                    ? "background.paper"
                    : "grey.50",
                "&::-webkit-scrollbar": {
                  width: "8px",
                },
                "&::-webkit-scrollbar-thumb": {
                  backgroundColor:
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.3)"
                      : "rgba(0,0,0,0.3)",
                  borderRadius: "4px",
                  "&:hover": {
                    backgroundColor:
                      theme.palette.mode === "dark"
                        ? "rgba(255,255,255,0.5)"
                        : "rgba(0,0,0,0.5)",
                  },
                },
                "&::-webkit-scrollbar-track": {
                  backgroundColor:
                    theme.palette.mode === "dark"
                      ? "rgba(255,255,255,0.05)"
                      : "rgba(0,0,0,0.05)",
                  borderRadius: "4px",
                },
              }}
            >
              {loading ? (
                <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                  <CircularProgress />
                </Box>
              ) : filteredHistory.length === 0 ? (
                <Box
                  sx={{ p: 4, textAlign: "center", color: "text.secondary" }}
                >
                  <HistoryIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                  <Typography>
                    {searchTerm
                      ? t("commandHistory.noCommandsFound")
                      : t("commandHistory.noCommands")}
                  </Typography>
                </Box>
              ) : filteredHistory.length < 50 ? (
                // 对于少量数据，使用传统渲染以避免虚拟化开销
                <Box sx={{ height: "100%", overflow: "auto" }}>
                  {filteredHistory.map((item, index) => (
                    <HistoryItem
                      key={`${item.command}-${item.timestamp}-${index}`}
                      index={index}
                      style={{ height: 48 }}
                      data={listItemData}
                    />
                  ))}
                </Box>
              ) : (
                // 对于大量数据，使用虚拟化渲染
                containerHeight > 0 && (
                  <List
                    height={containerHeight}
                    itemCount={filteredHistory.length}
                    itemSize={48}
                    itemData={listItemData}
                    overscanCount={15}
                    width="100%"
                  >
                    {HistoryItem}
                  </List>
                )
              )}
            </Box>

            {/* 状态栏 */}
            <Box
              sx={{
                p: 1,
                borderTop: `1px solid ${theme.palette.divider}`,
                bgcolor: "background.default",
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                align="center"
                display="block"
              >
                {t("commandHistory.totalCommands", {
                  count: filteredHistory.length,
                })}
                {searchTerm && ` / ${history.length} 总计`}
              </Typography>
            </Box>
          </>
        )}
      </Paper>

      {/* 上下文菜单 */}
      <Menu
        anchorEl={menuAnchorEl}
        open={menuOpen}
        onClose={handleMenuClose}
        transformOrigin={{ horizontal: "right", vertical: "top" }}
        anchorOrigin={{ horizontal: "right", vertical: "bottom" }}
      >
        <MenuItem onClick={() => handleSendCommand(menuTargetCommand?.command)}>
          <SendIcon sx={{ mr: 1 }} />
          {t("commandHistory.sendCommand")}
        </MenuItem>
        <MenuItem onClick={() => handleCopyCommand(menuTargetCommand?.command)}>
          <ContentCopyIcon sx={{ mr: 1 }} />
          {t("commandHistory.copyCommand")}
        </MenuItem>
        <MenuItem onClick={() => handleEditCommand(menuTargetCommand)}>
          <EditIcon sx={{ mr: 1 }} />
          {t("commandHistory.editCommand")}
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => handleDeleteCommand(menuTargetCommand?.command)}
          sx={{ color: "error.main" }}
        >
          <DeleteIcon sx={{ mr: 1 }} />
          {t("commandHistory.deleteCommand")}
        </MenuItem>
      </Menu>

      {/* 编辑命令对话框 */}
      <Dialog
        open={editDialogOpen}
        onClose={() => setEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("commandHistory.editCommand")}</DialogTitle>
        <DialogContent>
          <TextField
            fullWidth
            multiline
            minRows={3}
            value={editedCommand}
            onChange={(e) => setEditedCommand(e.target.value)}
            placeholder={t("commandHistory.enterCommand")}
            sx={{ mt: 1 }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 1, display: "block" }}
          >
            {t("commandHistory.editNote")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialogOpen(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleSaveEditedCommand} variant="contained">
            {t("commandHistory.saveToShortcuts")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 通知 */}
      <Snackbar
        open={notification.open}
        autoHideDuration={3000}
        onClose={handleCloseNotification}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={handleCloseNotification}
          severity={notification.severity}
          sx={{ width: "100%" }}
        >
          {notification.message}
        </Alert>
      </Snackbar>
    </>
  );
}

export default CommandHistory;
