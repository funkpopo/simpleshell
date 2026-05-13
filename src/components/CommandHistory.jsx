import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  InputAdornment,
  CircularProgress,
  Snackbar,
  Alert,
  Checkbox,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import { useTranslation } from "react-i18next";

// 虚拟化历史记录项组件
const HistoryItem = React.memo(
  ({
    index,
    style,
    filteredHistory,
    selectMode,
    selectedCommands,
    contextMenuTargetCommand,
    toggleCommandSelection,
    handleSendCommand,
    handleMenuOpen,
    formatTime,
  }) => {
    const theme = useTheme();
    const item = filteredHistory[index];
    if (!item) return null;
    const isContextMenuTarget =
      !selectMode &&
      contextMenuTargetCommand &&
      contextMenuTargetCommand.command === item.command &&
      contextMenuTargetCommand.timestamp === item.timestamp;
    const contextMenuTargetBg = alpha(theme.palette.primary.main, 0.18);
    const contextMenuTargetHoverBg = alpha(theme.palette.primary.main, 0.24);

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
            data-command-history-item="true"
            data-command-history-index={index}
            onContextMenu={(event) => handleMenuOpen(event, item)}
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
                  : isContextMenuTarget
                    ? contextMenuTargetBg
                  : "transparent",
              borderLeft: isContextMenuTarget
                ? `4px solid ${theme.palette.primary.main}`
                : "4px solid transparent",
              borderRadius: 0,
              "&:hover": {
                bgcolor: isContextMenuTarget
                  ? contextMenuTargetHoverBg
                  : "action.hover",
              },
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
                </Box>
              }
              secondary={
                <Typography variant="caption" color="text.secondary">
                  {formatTime(item.timestamp)}
                </Typography>
              }
            />
          </ListItemButton>
        </ListItem>
      </div>
    );
  },
);

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
  const sidebarRootRef = useRef(null);
  const containerRef = useRef(null);
  const contextMenuRetargetingRef = useRef(false);

  const focusSidebarRoot = (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const focusableTarget = event.target.closest(
      'input, textarea, select, button, [role="button"], [tabindex]',
    );
    if (focusableTarget && focusableTarget !== sidebarRootRef.current) {
      return;
    }
    sidebarRootRef.current?.focus({ preventScroll: true });
  };

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

      const isFocusInSidebar =
        activeElement && sidebarRootRef.current?.contains(activeElement);

      // Ctrl+/ 全局聚焦搜索框；Ctrl+F 仅在焦点位于侧边栏内时接管浏览器查找
      if (
        e.ctrlKey &&
        (e.key === "/" || (e.key.toLowerCase() === "f" && isFocusInSidebar))
      ) {
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
  const [, setCurrentCommand] = useState(null);
  const [editedCommand, setEditedCommand] = useState("");

  // 菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [menuTargetCommand, setMenuTargetCommand] = useState(null);
  const menuOpen = Boolean(contextMenu);

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
    // addResizeObserver 返回资源ID，我们不需要在 useEffect 中返回它
    if (containerRef.current) {
      addResizeObserver(updateHeight, containerRef.current);
    }
    // useEffect 不应该返回 addResizeObserver 的返回值
    // eslint-disable-next-line consistent-return
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
    } catch {
      showNotification("加载历史记录出错", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !window.terminalAPI?.onCommandHistoryChanged) {
      return undefined;
    }

    return window.terminalAPI.onCommandHistoryChanged((payload) => {
      if (Array.isArray(payload?.history)) {
        setHistory(payload.history);
        setLoading(false);
      }
    });
  }, [open]);

  // 显示通知
  const showNotification = useCallback((message, severity = "success") => {
    setNotification({
      open: true,
      message,
      severity,
    });
  }, []);

  // 关闭通知
  const handleCloseNotification = () => {
    setNotification((prev) => ({ ...prev, open: false }));
  };

  // 处理搜索输入变化
  const handleSearchChange = useCallback((event) => {
    setSearchTerm(event.target.value);
  }, []);

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
  const formatTime = useCallback((timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleString();
  }, []);

  // 处理菜单打开
  const handleMenuOpen = useCallback((event, command) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectMode) {
      return;
    }
    setMenuTargetCommand(command);
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  }, [selectMode]);

  // 处理菜单关闭
  const handleMenuClose = useCallback(() => {
    setContextMenu(null);
    setMenuTargetCommand(null);
  }, []);

  useEffect(() => {
    if (!open || !contextMenu) {
      return undefined;
    }

    const getHistoryItemFromPoint = (event) => {
      const root = sidebarRootRef.current;
      if (!root) {
        return null;
      }

      const rawTarget = event.target;
      if (
        rawTarget instanceof Element &&
        (rawTarget.closest('[data-command-history-context-menu="true"]') ||
          rawTarget.closest('[role="menu"]'))
      ) {
        return null;
      }

      if (rawTarget instanceof Element && root.contains(rawTarget)) {
        return rawTarget.closest('[data-command-history-item="true"]');
      }

      const elementsAtPoint =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : [];

      const element = elementsAtPoint.find(
        (candidate) =>
          root.contains(candidate) &&
          !candidate.closest('[data-command-history-context-menu="true"]') &&
          !candidate.closest('[role="menu"]'),
      );

      return element?.closest?.('[data-command-history-item="true"]') || null;
    };

    const handleContextMenuRetarget = (event) => {
      if (contextMenuRetargetingRef.current || selectMode) {
        return;
      }

      const itemElement = getHistoryItemFromPoint(event);
      if (!itemElement) {
        return;
      }

      const itemIndex = Number(itemElement.dataset.commandHistoryIndex);
      const item = Number.isInteger(itemIndex)
        ? filteredHistory[itemIndex]
        : null;
      if (!item) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      contextMenuRetargetingRef.current = true;
      setMenuTargetCommand(item);
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
      queueMicrotask(() => {
        contextMenuRetargetingRef.current = false;
      });
    };

    document.addEventListener("contextmenu", handleContextMenuRetarget, true);
    return () => {
      document.removeEventListener(
        "contextmenu",
        handleContextMenuRetarget,
        true,
      );
    };
  }, [contextMenu, filteredHistory, open, selectMode]);

  // 处理发送命令
  const handleSendCommand = useCallback((command) => {
    if (!command) {
      handleMenuClose();
      return;
    }
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
  }, [handleMenuClose, onSendCommand, showNotification, t]);

  // 选择/取消选择命令
  const toggleCommandSelection = useCallback((command) => {
    setSelectedCommands((previous) => {
      const nextSelected = new Set(previous);
      if (nextSelected.has(command)) {
        nextSelected.delete(command);
      } else {
        nextSelected.add(command);
      }
      return nextSelected;
    });
  }, []);

  // 虚拟化列表的数据
  const listItemData = useMemo(
    () => ({
      filteredHistory,
      selectMode,
      selectedCommands,
      contextMenuTargetCommand: menuTargetCommand,
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
      menuTargetCommand,
    ],
  );

  // 复制命令到剪贴板
  const handleCopyCommand = async (command) => {
    if (!command) {
      handleMenuClose();
      return;
    }
    try {
      await window.clipboardAPI.writeText(command);
      showNotification(t("commandHistory.commandCopied"));
    } catch {
      showNotification(t("commandHistory.copyFailed"), "error");
    }
    handleMenuClose();
  };

  // 编辑命令
  const handleEditCommand = (historyItem) => {
    if (!historyItem) {
      handleMenuClose();
      return;
    }
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
    } catch {
      showNotification(t("commandHistory.saveToShortcutsFailed"), "error");
    }

    setEditDialogOpen(false);
    setCurrentCommand(null);
    setEditedCommand("");
  };

  // 删除单个历史记录
  const handleDeleteCommand = async (command) => {
    if (!command) {
      handleMenuClose();
      return;
    }
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
    } catch {
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
    } catch {
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
    } catch {
      showNotification(t("commandHistory.clearAllFailed"), "error");
    }
  };

  return (
    <>
      <Paper
        ref={sidebarRootRef}
        tabIndex={-1}
        onMouseDown={focusSidebarRoot}
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
                px: 1.25,
                py: 0.75,
                minHeight: 44,
                flexShrink: 0,
                borderBottom: `1px solid ${theme.palette.divider}`,
              }}
            >
              <Typography variant="subtitle1" fontWeight="medium">
                {t("commandHistory.title")}
              </Typography>
              <IconButton
                onClick={onClose}
                size="small"
                sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 18 } }}
              >
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
                      {...listItemData}
                    />
                  ))}
                </Box>
              ) : (
                // 对于大量数据，使用虚拟化渲染
                containerHeight > 0 && (
                  <List
                    style={{ height: containerHeight, width: "100%" }}
                    rowCount={filteredHistory.length}
                    rowHeight={48}
                    rowProps={listItemData}
                    overscanCount={15}
                    rowComponent={HistoryItem}
                  />
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
        open={menuOpen}
        onClose={handleMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        transitionDuration={0}
        disableAutoFocusItem
        disableScrollLock
        PaperProps={{
          "data-command-history-context-menu": "true",
        }}
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
