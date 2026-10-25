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
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Button,
  Tooltip,
  Menu,
  MenuItem,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  Select,
  Tabs,
  Tab,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { compactContextMenuPaperSx } from "../../shared/ui/contextMenuStyles";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SendIcon from "@mui/icons-material/Send";
import FolderIcon from "@mui/icons-material/Folder";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CategoryIcon from "@mui/icons-material/Category";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import BoltIcon from "@mui/icons-material/Bolt";
import { useTranslation } from "react-i18next";
import {
  SIDEBAR_COMMAND_ROW_PITCH,
  SIDEBAR_ROW_GAP_PX,
  getSidebarItemSelectedBg,
  getSidebarItemSurfaceBg,
  sidebarFooterSx,
  sidebarListAreaSx,
  sidebarListItemButtonSx,
  sidebarSectionSx,
  sidebarTitleIconButtonSx,
} from "../../shared/ui/sidebarItemStyles";
import SidebarPanel from "../../shared/ui/SidebarPanel.jsx";
import WindowedSidebarList from "../../shared/ui/WindowedSidebarList.jsx";
import SidebarSearchField from "../../shared/ui/SidebarSearchField.jsx";
import SidebarCommandRow, {
  SidebarCommandText,
  sidebarRowActionSx,
} from "../../shared/ui/SidebarCommandRow.jsx";
import SidebarEmptyState from "../../shared/ui/SidebarEmptyState.jsx";
import { SidebarListSkeleton } from "../../shared/ui/SkeletonLoader.jsx";
import useSidebarPanel from "../../shared/hooks/useSidebarPanel";
import useContextMenuRetarget from "../../shared/hooks/useContextMenuRetarget";
import { generateId } from "../../../shared/common";
import { useNotification } from "../../shared/notifications/NotificationContext";

// 分类行：固定高度，便于窗口化列表直接按类型给出行高而无需逐行测量
const CATEGORY_ROW_HEIGHT = 52;
const CATEGORY_ROW_PITCH = CATEGORY_ROW_HEIGHT + SIDEBAR_ROW_GAP_PX;

const getCommandKey = (cmd) => cmd.id;
const getCategoryRowKey = (row) => `${row.type}-${row.item.id}`;
const getCategoryRowHeight = (index, { items }) =>
  items[index]?.type === "category"
    ? CATEGORY_ROW_PITCH
    : SIDEBAR_COMMAND_ROW_PITCH;

// 至少填满列表区：少量行时随内容增高由列表区滚动，窗口化列表则 flex 撑满
const TAB_PANEL_ACTIVE_STYLE = {
  flex: "1 0 auto",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const CATEGORY_COMMAND_INDENT_SX = { ml: 1.5, mr: 0.5, flexShrink: 0 };

// 命令行：只接收标量与稳定回调，右键目标变化时仅受影响的行重渲染
const CommandItem = React.memo(function CommandItem({
  cmd,
  highlighted,
  onSend,
  onCopy,
  onMenuOpen,
}) {
  const { t } = useTranslation();

  return (
    <SidebarCommandRow
      selected={highlighted}
      data-shortcut-menu-target="true"
      data-shortcut-menu-id={cmd.id}
      data-shortcut-menu-type="command"
      onClick={() => onSend(cmd.command, { execute: false })}
      onContextMenu={(e) => onMenuOpen(e, cmd.id, "command")}
      actions={
        <>
          <Tooltip title={t("shortcutCommands.sendAndExecute")}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onSend(cmd.command);
              }}
              sx={sidebarRowActionSx.primary}
              aria-label={t("shortcutCommands.sendAndExecute")}
            >
              <SendIcon />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("shortcutCommands.copyCommand")}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onCopy(cmd.command);
              }}
              sx={sidebarRowActionSx.secondary}
              aria-label={t("shortcutCommands.copyCommand")}
            >
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
        </>
      }
    >
      <SidebarCommandText label={cmd.name} command={cmd.command} />
    </SidebarCommandRow>
  );
});

const CategoryItem = React.memo(function CategoryItem({
  category,
  expanded,
  selected,
  onToggle,
  onMenuOpen,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isUncategorized = category.id === "uncategorized";

  return (
    <ListItem
      disablePadding
      sx={{
        height: CATEGORY_ROW_HEIGHT,
        flexShrink: 0,
        mb: `${SIDEBAR_ROW_GAP_PX}px`,
      }}
    >
      <ListItemButton
        data-shortcut-menu-target="true"
        data-shortcut-menu-id={category.id}
        data-shortcut-menu-type="category"
        aria-expanded={expanded}
        onClick={() => onToggle(category.id)}
        onContextMenu={(event) => {
          if (!isUncategorized) {
            onMenuOpen(event, category.id, "category");
          }
        }}
        sx={{
          ...sidebarListItemButtonSx(theme, selected),
          backgroundColor: selected
            ? getSidebarItemSelectedBg(theme)
            : getSidebarItemSurfaceBg(theme),
          height: "100%",
          px: 1.5,
          py: 0.75,
        }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          <FolderIcon sx={{ color: category.color, fontSize: 20 }} />
        </ListItemIcon>
        <ListItemText
          sx={{ my: 0, minWidth: 0 }}
          primary={
            <Typography variant="subtitle2" fontWeight="medium" noWrap>
              {category.name}
            </Typography>
          }
          secondary={
            <Typography variant="caption" color="text.secondary" noWrap>
              {category.commands.length} {t("shortcutCommands.commands")}
            </Typography>
          }
        />
        {expanded ? (
          <ExpandLessIcon sx={{ color: "text.secondary" }} />
        ) : (
          <ExpandMoreIcon sx={{ color: "text.secondary" }} />
        )}
        {!isUncategorized && (
          <Tooltip title={t("shortcutCommands.categoryActions")}>
            <IconButton
              size="small"
              onClick={(event) => {
                event.stopPropagation();
                onMenuOpen(event, category.id, "category");
              }}
              aria-label={t("shortcutCommands.categoryActions")}
              sx={{ ml: 0.5, opacity: 0.7 }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </ListItemButton>
    </ListItem>
  );
});

function ShortcutCommands({
  open,
  onClose,
  onSendCommand,
  sessionContext = null,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [commands, setCommands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef(null);
  const [selectedCategory] = useState("all");
  const [tabValue, setTabValue] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});
  const sidebarRootRef = useRef(null);

  useSidebarPanel({
    open,
    rootRef: sidebarRootRef,
    searchInputRef,
  });

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState(""); // 'command', 'category'
  const [dialogAction, setDialogAction] = useState(""); // 'add', 'edit'
  const [currentCommand, setCurrentCommand] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);

  // 菜单状态
  const [contextMenu, setContextMenu] = useState(null);
  const [menuTargetId, setMenuTargetId] = useState(null);
  const menuOpen = Boolean(contextMenu);

  // 通知（使用全局通知系统）
  const { showNotification: showGlobalNotification } = useNotification();

  // 加载命令数据
  useEffect(() => {
    if (open) {
      loadCommands();
    }
  }, [open]);

  // 加载命令数据
  const loadCommands = async () => {
    setLoading(true);
    try {
      if (window.terminalAPI?.getShortcutCommands) {
        const result = await window.terminalAPI.getShortcutCommands();
        if (result.success) {
          setCommands(result.data.commands || []);
          setCategories(result.data.categories || []);

          // 初始化展开状态
          const expanded = {};
          result.data.categories.forEach((category) => {
            expanded[category.id] = true;
          });
          setExpandedCategories(expanded);
        }
      }
    } catch {
      /* intentionally ignored */
    } finally {
      setLoading(false);
    }
  };

  // 保存命令数据
  const saveCommands = async (newCommands, newCategories) => {
    try {
      if (window.terminalAPI?.saveShortcutCommands) {
        const result = await window.terminalAPI.saveShortcutCommands({
          commands: newCommands || commands,
          categories: newCategories || categories,
        });
        if (!result.success) {
          console.warn("Failed to save shortcut commands");
        }
      }
    } catch {
      /* intentionally ignored */
    }
  };

  // 处理搜索输入变化
  const handleSearchChange = (event) => {
    setSearchTerm(event.target.value);
  };

  // 处理标签页切换
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  // 处理目录展开/折叠
  const toggleCategoryExpand = useCallback((categoryId) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  }, []);

  // 处理菜单打开
  const handleMenuOpen = useCallback((event, id, type) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
    setMenuTargetId(id);
    setDialogType(type);
  }, []);

  // 处理菜单关闭
  const handleMenuClose = () => {
    setContextMenu(null);
    setMenuTargetId(null);
  };

  useContextMenuRetarget({
    enabled: Boolean(open && contextMenu),
    rootRef: sidebarRootRef,
    menuSelector: '[data-shortcut-commands-context-menu="true"]',
    mode: "select",
    itemSelector: "[data-shortcut-menu-target]",
    getRetargetPayload: (targetElement) => {
      const targetId = targetElement?.dataset.shortcutMenuId;
      const targetType = targetElement?.dataset.shortcutMenuType;
      if (!targetId || !targetType) {
        return null;
      }
      if (targetType === "category" && targetId === "uncategorized") {
        return null;
      }
      return { targetId, targetType };
    },
    onRetarget: ({ targetId, targetType }, event) => {
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
      setMenuTargetId(targetId);
      setDialogType(targetType);
    },
  });

  // 处理添加命令
  // 打开新增/编辑对话框的公共流程
  const openEntityDialog = (setCurrent, entity, entityType, action) => {
    setCurrent(entity);
    setDialogType(entityType);
    setDialogAction(action);
    setDialogOpen(true);
    handleMenuClose();
  };

  const handleAddCommand = () => {
    openEntityDialog(
      setCurrentCommand,
      {
        id: "",
        name: "",
        command: "",
        category: categories.length > 0 ? categories[0].id : "",
        params: [],
        tags: [],
      },
      "command",
      "add",
    );
  };

  // 处理编辑命令
  const handleEditCommand = (commandId) => {
    const command = commands.find((cmd) => cmd.id === commandId);
    if (command) {
      openEntityDialog(setCurrentCommand, { ...command }, "command", "edit");
    } else {
      handleMenuClose();
    }
  };

  // 处理删除命令
  const handleDeleteCommand = async (commandId) => {
    const newCommands = commands.filter((cmd) => cmd.id !== commandId);
    setCommands(newCommands);
    await saveCommands(newCommands);
    handleMenuClose();
  };

  // 处理添加分类
  const handleAddCategory = () => {
    openEntityDialog(
      setCurrentCategory,
      {
        id: "",
        name: "",
        color: "#" + Math.floor(Math.random() * 16777215).toString(16),
      },
      "category",
      "add",
    );
  };

  // 处理编辑分类
  const handleEditCategory = (categoryId) => {
    const category = categories.find((cat) => cat.id === categoryId);
    if (category) {
      openEntityDialog(setCurrentCategory, { ...category }, "category", "edit");
    } else {
      handleMenuClose();
    }
  };

  // 处理删除分类
  const handleDeleteCategory = async (categoryId) => {
    // 删除分类，并将该分类下的命令设为未分类
    const newCategories = categories.filter((cat) => cat.id !== categoryId);
    const newCommands = commands.map((cmd) =>
      cmd.category === categoryId ? { ...cmd, category: "" } : cmd,
    );

    setCategories(newCategories);
    setCommands(newCommands);
    await saveCommands(newCommands, newCategories);
    handleMenuClose();
  };

  // 处理对话框关闭
  const handleDialogClose = () => {
    setDialogOpen(false);
  };

  // 处理命令表单变化
  const handleCommandFormChange = (field, value) => {
    setCurrentCommand((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 处理分类表单变化
  const handleCategoryFormChange = (field, value) => {
    setCurrentCategory((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // 处理保存命令
  const handleSaveCommand = async () => {
    let newCommands = [...commands];

    if (dialogAction === "add") {
      const newCommand = {
        ...currentCommand,
        id: generateId("cmd"),
      };
      newCommands.push(newCommand);
    } else {
      newCommands = commands.map((cmd) =>
        cmd.id === currentCommand.id ? { ...currentCommand } : cmd,
      );
    }

    setCommands(newCommands);
    await saveCommands(newCommands);
    setDialogOpen(false);
  };

  // 处理保存分类
  const handleSaveCategory = async () => {
    let newCategories = [...categories];

    if (dialogAction === "add") {
      const newCategory = {
        ...currentCategory,
        id: generateId("cat"),
      };
      newCategories.push(newCategory);

      // 更新展开状态
      setExpandedCategories((prev) => ({
        ...prev,
        [newCategory.id]: true,
      }));
    } else {
      newCategories = categories.map((cat) =>
        cat.id === currentCategory.id ? { ...currentCategory } : cat,
      );
    }

    setCategories(newCategories);
    await saveCommands(null, newCategories);
    setDialogOpen(false);
  };

  // 处理发送命令（稳定引用：编辑对话框输入等无关状态变化不会让命令行重渲染）
  const handleSendCommand = useCallback(
    (command, options = {}) => {
      const showNotification = (message, severity) => {
        showGlobalNotification(message, severity, {
          autoHideDuration: 3000,
          anchorOrigin: { vertical: "bottom", horizontal: "center" },
          variant: "standard",
        });
      };
      // 需要tabId，假设通过props.currentTabId传递
      if (onSendCommand && typeof onSendCommand === "function") {
        try {
          const result = onSendCommand(command, options);
          if (!result?.success) {
            showNotification(
              result?.error || t("commandHistory.noActiveSession"),
              "error",
            );
            return;
          }
          // 显示成功通知
          showNotification(
            t("shortcutCommands.commandSent", { command }),
            "success",
          );
        } catch (error) {
          // 显示错误通知
          showNotification(
            t("shortcutCommands.sendCommandFailed", {
              error: error.message,
            }),
            "error",
          );
          // 错误已通过UI通知显示给用户
        }
      } else {
        showNotification(
          t("shortcutCommands.sendCommandHandlerMissing"),
          "warning",
        );
        // 警告已通过UI通知显示给用户
      }
    },
    [onSendCommand, showGlobalNotification, t],
  );

  // 处理复制命令
  const handleCopyCommand = useCallback((command) => {
    window.clipboardAPI.writeText(command).catch(() => {});
  }, []);

  // 过滤命令；过滤使用延迟值，命令很多时输入仍保持流畅
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const filteredCommands = useMemo(() => {
    const query = deferredSearchTerm.toLowerCase();
    return commands.filter((cmd) => {
      // 根据搜索词过滤
      const matchesSearch =
        query === "" ||
        (cmd.name || "").toLowerCase().includes(query) ||
        (cmd.command || "").toLowerCase().includes(query);

      // 根据选定分类过滤
      const matchesCategory =
        selectedCategory === "all" || cmd.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [commands, deferredSearchTerm, selectedCategory]);

  const renderCommandItem = (cmd) => (
    <CommandItem
      cmd={cmd}
      highlighted={dialogType === "command" && menuTargetId === cmd.id}
      onSend={handleSendCommand}
      onCopy={handleCopyCommand}
      onMenuOpen={handleMenuOpen}
    />
  );

  // 获取按分类分组的命令
  const commandsByCategory = useMemo(() => {
    const result = {};

    // 添加未分类组
    result["uncategorized"] = {
      id: "uncategorized",
      name: t("shortcutCommands.uncategorized"),
      color: "#808080",
      commands: [],
    };

    // 为每个分类创建一个条目
    categories.forEach((cat) => {
      result[cat.id] = {
        ...cat,
        commands: [],
      };
    });

    // 将命令添加到相应分类
    filteredCommands.forEach((cmd) => {
      const categoryId =
        cmd.category && result[cmd.category] ? cmd.category : "uncategorized";
      result[categoryId].commands.push(cmd);
    });

    // 过滤掉没有命令的分类
    return Object.values(result).filter((cat) => cat.commands.length > 0);
  }, [categories, filteredCommands, t]);

  const categoryRows = useMemo(() => {
    const rows = [];
    for (const category of commandsByCategory) {
      rows.push({ type: "category", item: category });
      if (expandedCategories[category.id]) {
        for (const command of category.commands) {
          rows.push({ type: "command", item: command });
        }
      }
    }
    return rows;
  }, [commandsByCategory, expandedCategories]);

  // 首次加载显示骨架；已有数据时后台刷新不替换列表，避免重复打开时闪烁
  const showSkeleton = loading && commands.length === 0;

  const renderEmptyState = () => (
    <SidebarEmptyState
      icon={<BoltIcon />}
      message={
        deferredSearchTerm
          ? t("shortcutCommands.noCommandsFound")
          : t("shortcutCommands.noCommands")
      }
    />
  );

  // 渲染命令列表：少量数据直接渲染，大量数据窗口化
  const renderCommandList = () => {
    if (showSkeleton) {
      return <SidebarListSkeleton variant="shortcut" />;
    }

    if (filteredCommands.length === 0) {
      return renderEmptyState();
    }

    return (
      <WindowedSidebarList
        items={filteredCommands}
        rowHeight={SIDEBAR_COMMAND_ROW_PITCH}
        overscanCount={10}
        getItemKey={getCommandKey}
        renderItem={renderCommandItem}
      />
    );
  };

  // 渲染分类视图
  const renderCategoriesView = () => {
    if (showSkeleton) {
      return <SidebarListSkeleton variant="shortcut" />;
    }

    if (commandsByCategory.length === 0) {
      return renderEmptyState();
    }

    return (
      <WindowedSidebarList
        items={categoryRows}
        className="shortcut-categories-virtualized-list"
        rowHeight={getCategoryRowHeight}
        overscanCount={10}
        getItemKey={getCategoryRowKey}
        renderItem={(row) => {
          if (row.type === "command") {
            return (
              <Box sx={CATEGORY_COMMAND_INDENT_SX}>
                {renderCommandItem(row.item)}
              </Box>
            );
          }
          const category = row.item;
          return (
            <CategoryItem
              category={category}
              expanded={Boolean(expandedCategories[category.id])}
              selected={
                dialogType === "category" && menuTargetId === category.id
              }
              onToggle={toggleCategoryExpand}
              onMenuOpen={handleMenuOpen}
            />
          );
        }}
      />
    );
  };

  // 渲染命令对话框
  const renderCommandDialog = () => (
    <Dialog
      open={dialogOpen && dialogType === "command"}
      onClose={handleDialogClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {dialogAction === "add"
          ? t("shortcutCommands.addCommand")
          : t("shortcutCommands.editCommand")}
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label={t("shortcutCommands.commandName")}
          fullWidth
          value={currentCommand?.name || ""}
          onChange={(e) => handleCommandFormChange("name", e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          margin="dense"
          label={t("shortcutCommands.command")}
          fullWidth
          multiline
          rows={2}
          value={currentCommand?.command || ""}
          onChange={(e) => handleCommandFormChange("command", e.target.value)}
          sx={{ mb: 2 }}
        />
        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t("shortcutCommands.category")}</InputLabel>
          <Select
            value={currentCommand?.category || ""}
            onChange={(e) =>
              handleCommandFormChange("category", e.target.value)
            }
            label={t("shortcutCommands.category")}
          >
            <MenuItem value="">{t("shortcutCommands.uncategorized")}</MenuItem>
            {categories.map((cat) => (
              <MenuItem key={cat.id} value={cat.id}>
                {cat.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDialogClose}>{t("common.cancel")}</Button>
        <Button onClick={handleSaveCommand} color="primary">
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );

  // 渲染分类对话框
  const renderCategoryDialog = () => (
    <Dialog
      open={dialogOpen && dialogType === "category"}
      onClose={handleDialogClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {dialogAction === "add"
          ? t("shortcutCommands.addCategory")
          : t("shortcutCommands.editCategory")}
      </DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label={t("shortcutCommands.categoryName")}
          fullWidth
          value={currentCategory?.name || ""}
          onChange={(e) => handleCategoryFormChange("name", e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          margin="dense"
          label={t("shortcutCommands.color")}
          fullWidth
          value={currentCategory?.color || "#000000"}
          onChange={(e) => handleCategoryFormChange("color", e.target.value)}
          type="color"
          sx={{ mb: 2 }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDialogClose}>{t("common.cancel")}</Button>
        <Button onClick={handleSaveCategory} color="primary">
          {t("common.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );

  // 渲染菜单
  const renderMenu = () => (
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
        "data-shortcut-commands-context-menu": "true",
        sx: compactContextMenuPaperSx,
      }}
    >
      {dialogType === "command" && (
        <div>
          <MenuItem onClick={() => handleEditCommand(menuTargetId)}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("shortcutCommands.edit")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleDeleteCommand(menuTargetId)}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("shortcutCommands.delete")}</ListItemText>
          </MenuItem>
        </div>
      )}
      {dialogType === "category" && (
        <div>
          <MenuItem onClick={() => handleEditCategory(menuTargetId)}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("shortcutCommands.edit")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => handleDeleteCategory(menuTargetId)}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("shortcutCommands.delete")}</ListItemText>
          </MenuItem>
        </div>
      )}
    </Menu>
  );

  // 渲染组件主体
  return (
    <SidebarPanel
      open={open}
      rootRef={sidebarRootRef}
      title={t("shortcutCommands.title")}
      onClose={onClose}
      sessionContext={sessionContext}
      actions={
        <Tooltip title={t("shortcutCommands.addCommand")}>
          <IconButton
            onClick={handleAddCommand}
            size="small"
            sx={sidebarTitleIconButtonSx}

            aria-label={t("shortcutCommands.addCommand")}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      }
    >
      {/* 搜索框 */}
      <Box sx={sidebarSectionSx(theme)}>
        <SidebarSearchField
          inputRef={searchInputRef}
          placeholder={t("shortcutCommands.search")}
          value={searchTerm}
          onChange={handleSearchChange}
          onClear={() => setSearchTerm("")}
        />
      </Box>

      {/* 标签页 */}
      <Box
        sx={{
          flexShrink: 0,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Tabs
          value={tabValue}
          onChange={handleTabChange}
          variant="fullWidth"
          sx={{ minHeight: 40 }}
        >
          <Tab
            label={t("shortcutCommands.allCommands")}
            id="commands-tab-0"
            aria-controls="commands-tabpanel-0"
            sx={{ minHeight: 40, py: 0 }}
          />
          <Tab
            label={t("shortcutCommands.categories")}
            id="commands-tab-1"
            aria-controls="commands-tabpanel-1"
            sx={{ minHeight: 40, py: 0 }}
          />
        </Tabs>
      </Box>

      {/* 内容区域：窗口化列表以 flex 填满当前标签页 */}
      <Box className="app-scrollbar" sx={sidebarListAreaSx}>
        <div
          role="tabpanel"
          hidden={tabValue !== 0}
          style={tabValue === 0 ? TAB_PANEL_ACTIVE_STYLE : undefined}
          id="commands-tabpanel-0"
          aria-labelledby="commands-tab-0"
        >
          {tabValue === 0 && renderCommandList()}
        </div>
        <div
          role="tabpanel"
          hidden={tabValue !== 1}
          style={tabValue === 1 ? TAB_PANEL_ACTIVE_STYLE : undefined}
          id="commands-tabpanel-1"
          aria-labelledby="commands-tab-1"
        >
          {tabValue === 1 && (
            <>
              <Box sx={{ px: 1, pb: 0.5, textAlign: "right", flexShrink: 0 }}>
                <Button
                  startIcon={<CategoryIcon />}
                  size="small"
                  onClick={handleAddCategory}
                >
                  {t("shortcutCommands.addCategory")}
                </Button>
              </Box>
              {renderCategoriesView()}
            </>
          )}
        </div>
      </Box>

      {/* 状态栏 */}
      <Box sx={sidebarFooterSx(theme)}>
        <Typography variant="caption" color="text.secondary" noWrap>
          {showSkeleton
            ? t("shortcutCommands.loading")
            : commands.length > 0
              ? t("shortcutCommands.totalCommands", {
                  count: commands.length,
                })
              : ""}
        </Typography>
      </Box>

      {/* 对话框 */}
      {renderCommandDialog()}
      {renderCategoryDialog()}

      {/* 菜单 */}
      {renderMenu()}
    </SidebarPanel>
  );
}

export default ShortcutCommands;
