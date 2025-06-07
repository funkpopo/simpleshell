import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Button,
  Divider,
  Tooltip,
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
  FormControlLabel,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
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

function CommandHistory({ open, onClose, onSendCommand }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCommands, setSelectedCommands] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);

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
  const getFilteredHistory = () => {
    if (!searchTerm.trim()) {
      return history;
    }

    const searchTermLower = searchTerm.toLowerCase();
    return history.filter((item) =>
      item.command.toLowerCase().includes(searchTermLower),
    );
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

  // 发送命令到终端
  const handleSendCommand = (command) => {
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

  // 全选/取消全选
  const toggleSelectAll = () => {
    const filteredHistory = getFilteredHistory();
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

  // 格式化时间
  const formatTime = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString();
  };

  const filteredHistory = getFilteredHistory();

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
              <Typography variant="h6" component="h2">
                <HistoryIcon sx={{ mr: 1, verticalAlign: "middle" }} />
                {t("commandHistory.title")}
              </Typography>
              <IconButton onClick={onClose} size="small">
                <CloseIcon />
              </IconButton>
            </Box>

            {/* 搜索栏和工具栏 */}
            <Box
              sx={{ p: 2, borderBottom: `1px solid ${theme.palette.divider}` }}
            >
              <TextField
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
                }}
                sx={{ mb: 2 }}
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
                  backgroundColor: "rgba(0,0,0,0.2)",
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
              ) : (
                <List dense>
                  {filteredHistory.map((item, index) => (
                    <ListItem
                      key={`${item.command}-${item.timestamp}-${index}`}
                      disablePadding
                      sx={{
                        borderBottom: `1px solid ${theme.palette.divider}`,
                      }}
                    >
                      <ListItemButton
                        onClick={() =>
                          selectMode
                            ? toggleCommandSelection(item.command)
                            : handleSendCommand(item.command)
                        }
                        sx={{
                          minHeight: 72,
                          bgcolor:
                            selectMode && selectedCommands.has(item.command)
                              ? "action.selected"
                              : "transparent",
                        }}
                      >
                        {selectMode && (
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            <Checkbox
                              checked={selectedCommands.has(item.command)}
                              onChange={() =>
                                toggleCommandSelection(item.command)
                              }
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
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
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
                  ))}
                </List>
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
