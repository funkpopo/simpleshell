import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useDeferredValue,
} from "react";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
import {
  Box,
  Typography,
  IconButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Button,
  Divider,
  Menu,
  MenuItem,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Tooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import SendIcon from "@mui/icons-material/Send";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import HistoryIcon from "@mui/icons-material/History";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import { useTranslation } from "react-i18next";
import {
  SIDEBAR_COMMAND_ROW_PITCH,
  sidebarFooterSx,
  sidebarListAreaSx,
  sidebarSectionSx,
} from "../../shared/ui/sidebarItemStyles";
import SidebarPanel from "../../shared/ui/SidebarPanel.jsx";
import SidebarSearchField from "../../shared/ui/SidebarSearchField.jsx";
import SidebarCommandRow, {
  SidebarCommandText,
  sidebarRowActionSx,
} from "../../shared/ui/SidebarCommandRow.jsx";
import SidebarEmptyState from "../../shared/ui/SidebarEmptyState.jsx";
import WindowedSidebarList from "../../shared/ui/WindowedSidebarList.jsx";
import { SidebarListSkeleton } from "../../shared/ui/SkeletonLoader.jsx";
import useSidebarPanel from "../../shared/hooks/useSidebarPanel";
import useContextMenuRetarget from "../../shared/hooks/useContextMenuRetarget";
import { useNotification } from "../../shared/notifications/NotificationContext";
import { compactContextMenuPaperSx } from "../../shared/ui/contextMenuStyles";

const getHistoryItemKey = (item, index) =>
  `${item.command}-${item.timestamp}-${index}`;

// 行组件只接收标量与稳定回调：选中、右键目标等状态变化时仅受影响的行重渲染
const HistoryItem = React.memo(function HistoryItem({
  item,
  index,
  selectMode,
  checked,
  highlighted,
  onToggleSelect,
  onSend,
  onCopy,
  onMenuOpen,
}) {
  const { t } = useTranslation();

  return (
    <SidebarCommandRow
      selected={highlighted}
      data-command-history-item="true"
      data-command-history-index={index}
      onContextMenu={(event) => onMenuOpen(event, item)}
      onClick={() =>
        selectMode ? onToggleSelect(item.command) : onSend(item.command)
      }
      checkbox={
        selectMode ? (
          <Checkbox
            checked={checked}
            onChange={() => onToggleSelect(item.command)}
            onClick={(event) => event.stopPropagation()}
            size="small"
          />
        ) : null
      }
      actions={
        selectMode ? null : (
          <>
            <Tooltip title={t("commandHistory.sendCommand")}>
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  onSend(item.command);
                }}
                aria-label={t("commandHistory.sendCommand")}
                sx={sidebarRowActionSx.primary}
              >
                <SendIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("commandHistory.copyCommand")}>
              <IconButton
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  void onCopy(item.command);
                }}
                aria-label={t("commandHistory.copyCommand")}
                sx={sidebarRowActionSx.secondary}
              >
                <ContentCopyIcon />
              </IconButton>
            </Tooltip>
          </>
        )
      }
    >
      <SidebarCommandText command={item.command} />
    </SidebarCommandRow>
  );
});

function CommandHistory({
  open,
  onClose,
  onSendCommand,
  sessionContext = null,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef(null);
  const [selectedCommands, setSelectedCommands] = useState(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const sidebarRootRef = useRef(null);

  useSidebarPanel({
    open,
    rootRef: sidebarRootRef,
    searchInputRef,
  });

  // 对话框状态
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [, setCurrentCommand] = useState(null);
  const [editedCommand, setEditedCommand] = useState("");

  // 菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [menuTargetCommand, setMenuTargetCommand] = useState(null);
  const menuOpen = Boolean(contextMenu);

  // 通知（使用全局通知系统）
  const { showNotification: showGlobalNotification } = useNotification();

  // 加载历史记录
  useEffect(() => {
    if (open) {
      loadHistory();
    }
  }, [open]);

  // 加载历史记录（已有数据时列表保持可见，仅首次加载显示骨架）
  const loadHistory = async () => {
    setLoading(true);
    try {
      if (window.terminalAPI?.getAllCommandHistory) {
        const result = await window.terminalAPI.getAllCommandHistory();
        if (result.success) {
          setHistory(result.data || []);
        } else {
          showNotification(t("commandHistory.loadFailed"), "error");
        }
      }
    } catch {
      showNotification(t("commandHistory.loadError"), "error");
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
  const showNotification = useCallback(
    (message, severity = "success") => {
      showGlobalNotification(message, severity, {
        autoHideDuration: 3000,
        anchorOrigin: { vertical: "bottom", horizontal: "center" },
        variant: "standard",
      });
    },
    [showGlobalNotification],
  );

  // 处理搜索输入变化
  const handleSearchChange = useCallback((event) => {
    setSearchTerm(event.target.value);
  }, []);

  // 获取过滤后的历史记录；过滤使用延迟值，海量历史下输入仍保持流畅
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const filteredHistory = useMemo(() => {
    if (!deferredSearchTerm.trim()) {
      return history;
    }
    const searchTermLower = deferredSearchTerm.toLowerCase();
    return history.filter((item) =>
      item.command.toLowerCase().includes(searchTermLower),
    );
  }, [history, deferredSearchTerm]);

  // 处理菜单打开
  const handleMenuOpen = useCallback(
    (event, command) => {
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
    },
    [selectMode],
  );

  // 处理菜单关闭
  const handleMenuClose = useCallback(() => {
    setContextMenu(null);
    setMenuTargetCommand(null);
  }, []);

  useContextMenuRetarget({
    enabled: Boolean(open && contextMenu && !selectMode),
    rootRef: sidebarRootRef,
    menuSelector: '[data-command-history-context-menu="true"]',
    mode: "select",
    itemSelector: '[data-command-history-item="true"]',
    getRetargetPayload: (itemElement) => {
      const itemIndex = Number(itemElement.dataset.commandHistoryIndex);
      return Number.isInteger(itemIndex)
        ? filteredHistory[itemIndex] || null
        : null;
    },
    onRetarget: (item, event) => {
      setMenuTargetCommand(item);
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    },
  });

  // 处理发送命令
  const handleSendCommand = useCallback(
    (command) => {
      if (!command) {
        handleMenuClose();
        return;
      }
      // 需要tabId，假设通过props.currentTabId传递
      if (onSendCommand) {
        const result = onSendCommand(command);
        if (result && result.success === false) {
          showNotification(
            t("commandHistory.sendFailedWithError", { error: result.error }),
            "error",
          );
        } else {
          showNotification(t("commandHistory.commandSent", { command }));
        }
      } else {
        showNotification(
          t("commandHistory.sendCommandHandlerMissing"),
          "error",
        );
      }
      handleMenuClose();
    },
    [handleMenuClose, onSendCommand, showNotification, t],
  );

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

  // 复制命令到剪贴板
  const handleCopyCommand = useCallback(
    async (command) => {
      if (!command) {
        handleMenuClose();
        return;
      }
      try {
        await window.clipboardAPI.writeText(command);
      } catch {
        showNotification(t("commandHistory.copyFailed"), "error");
      }
      handleMenuClose();
    },
    [handleMenuClose, showNotification, t],
  );

  const renderHistoryItem = (item, index) => {
    const checked = selectMode && selectedCommands.has(item.command);
    const isContextMenuTarget =
      !selectMode &&
      menuTargetCommand?.command === item.command &&
      menuTargetCommand?.timestamp === item.timestamp;
    return (
      <HistoryItem
        item={item}
        index={index}
        selectMode={selectMode}
        checked={checked}
        highlighted={checked || isContextMenuTarget}
        onToggleSelect={toggleCommandSelection}
        onSend={handleSendCommand}
        onCopy={handleCopyCommand}
        onMenuOpen={handleMenuOpen}
      />
    );
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
      <SidebarPanel
        open={open}
        rootRef={sidebarRootRef}
        title={t("commandHistory.title")}
        onClose={onClose}
        sessionContext={sessionContext}
      >
        {/* 搜索栏和工具栏 */}
        <Box sx={sidebarSectionSx(theme)}>
          <SidebarSearchField
            inputRef={searchInputRef}
            placeholder={t("commandHistory.search")}
            value={searchTerm}
            onChange={handleSearchChange}
            onClear={() => setSearchTerm("")}
            sx={{ mb: 1 }}
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

        {/* 历史记录列表：少量数据直接渲染，大量数据窗口化 */}
        <Box
          className="app-scrollbar app-scrollbar-compact"
          sx={sidebarListAreaSx}
        >
          {loading && history.length === 0 ? (
            <SidebarListSkeleton variant="history" />
          ) : filteredHistory.length === 0 ? (
            <SidebarEmptyState
              icon={<HistoryIcon />}
              message={
                deferredSearchTerm
                  ? t("commandHistory.noCommandsFound")
                  : t("commandHistory.noCommands")
              }
            />
          ) : (
            <WindowedSidebarList
              items={filteredHistory}
              className="app-scrollbar-compact"
              rowHeight={SIDEBAR_COMMAND_ROW_PITCH}
              overscanCount={10}
              getItemKey={getHistoryItemKey}
              renderItem={renderHistoryItem}
            />
          )}
        </Box>

        {/* 状态栏 */}
        <Box sx={sidebarFooterSx(theme)}>
          <Typography variant="caption" color="text.secondary" noWrap>
            {t("commandHistory.totalCommands", {
              count: filteredHistory.length,
            })}
            {deferredSearchTerm &&
              t("commandHistory.totalWithSearch", { total: history.length })}
          </Typography>
        </Box>
      </SidebarPanel>

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
          sx: compactContextMenuPaperSx,
        }}
      >
        <MenuItem onClick={() => handleEditCommand(menuTargetCommand)}>
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("commandHistory.editCommand")}</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => handleDeleteCommand(menuTargetCommand?.command)}
          sx={{ color: "error.main" }}
        >
          <ListItemIcon sx={{ color: "inherit" }}>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("commandHistory.deleteCommand")}</ListItemText>
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
    </>
  );
}

export default CommandHistory;
