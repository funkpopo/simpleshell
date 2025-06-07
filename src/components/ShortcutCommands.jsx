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
  FormControl,
  InputLabel,
  Select,
  Chip,
  Tabs,
  Tab,
  InputAdornment,
  CircularProgress,
  Collapse,
  Snackbar,
  Alert,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import FolderIcon from "@mui/icons-material/Folder";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import HistoryIcon from "@mui/icons-material/History";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CategoryIcon from "@mui/icons-material/Category";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import { useTranslation } from "react-i18next";

function ShortcutCommands({ open, onClose, onSendCommand }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [commands, setCommands] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [tabValue, setTabValue] = useState(0);
  const [expandedCategories, setExpandedCategories] = useState({});

  // 对话框状态
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState(""); // 'command', 'category'
  const [dialogAction, setDialogAction] = useState(""); // 'add', 'edit'
  const [currentCommand, setCurrentCommand] = useState(null);
  const [currentCategory, setCurrentCategory] = useState(null);

  // 菜单状态
  const [menuAnchorEl, setMenuAnchorEl] = useState(null);
  const [menuTargetId, setMenuTargetId] = useState(null);
  const menuOpen = Boolean(menuAnchorEl);

  // 添加通知状态
  const [notification, setNotification] = useState({
    open: false,
    message: "",
    severity: "success",
  });

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
        } else {
        }
      }
    } catch (error) {
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
        }
      }
    } catch (error) {}
  };

  // 生成唯一ID
  const generateUniqueId = (prefix = "") => {
    return `${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
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
  const toggleCategoryExpand = (categoryId) => {
    setExpandedCategories((prev) => ({
      ...prev,
      [categoryId]: !prev[categoryId],
    }));
  };

  // 处理菜单打开
  const handleMenuOpen = (event, id, type) => {
    event.stopPropagation();
    setMenuAnchorEl(event.currentTarget);
    setMenuTargetId(id);
    setDialogType(type);
  };

  // 处理菜单关闭
  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setMenuTargetId(null);
  };

  // 处理添加命令
  const handleAddCommand = () => {
    setCurrentCommand({
      id: "",
      name: "",
      command: "",
      description: "",
      category: categories.length > 0 ? categories[0].id : "",
      params: [],
      tags: [],
    });
    setDialogType("command");
    setDialogAction("add");
    setDialogOpen(true);
    handleMenuClose();
  };

  // 处理编辑命令
  const handleEditCommand = (commandId) => {
    const command = commands.find((cmd) => cmd.id === commandId);
    if (command) {
      setCurrentCommand({ ...command });
      setDialogType("command");
      setDialogAction("edit");
      setDialogOpen(true);
    }
    handleMenuClose();
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
    setCurrentCategory({
      id: "",
      name: "",
      color: "#" + Math.floor(Math.random() * 16777215).toString(16),
    });
    setDialogType("category");
    setDialogAction("add");
    setDialogOpen(true);
    handleMenuClose();
  };

  // 处理编辑分类
  const handleEditCategory = (categoryId) => {
    const category = categories.find((cat) => cat.id === categoryId);
    if (category) {
      setCurrentCategory({ ...category });
      setDialogType("category");
      setDialogAction("edit");
      setDialogOpen(true);
    }
    handleMenuClose();
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
        id: generateUniqueId("cmd-"),
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
        id: generateUniqueId("cat-"),
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

  // 处理发送命令
  const handleSendCommand = (command) => {
    if (onSendCommand && typeof onSendCommand === "function") {
      try {
        onSendCommand(command);
        // 显示成功通知
        setNotification({
          open: true,
          message: t("shortcutCommands.commandSent", { command }),
          severity: "success",
        });
      } catch (error) {
        // 显示错误通知
        setNotification({
          open: true,
          message: t("shortcutCommands.sendCommandFailed", {
            error: error.message,
          }),
          severity: "error",
        });
      }
    } else {
      setNotification({
        open: true,
        message: t("shortcutCommands.sendCommandHandlerMissing"),
        severity: "warning",
      });
      console.warn("发送命令处理函数未提供");
    }
  };

  // 处理复制命令
  const handleCopyCommand = (command) => {
    navigator.clipboard.writeText(command).catch((err) => {});
  };

  // 过滤命令
  const getFilteredCommands = () => {
    return commands.filter((cmd) => {
      // 根据搜索词过滤
      const matchesSearch =
        searchTerm === "" ||
        cmd.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cmd.command.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cmd.description.toLowerCase().includes(searchTerm.toLowerCase());

      // 根据选定分类过滤
      const matchesCategory =
        selectedCategory === "all" || cmd.category === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  };

  // 获取按分类分组的命令
  const getCommandsByCategory = () => {
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
    const filteredCommands = getFilteredCommands();
    filteredCommands.forEach((cmd) => {
      const categoryId =
        cmd.category && result[cmd.category] ? cmd.category : "uncategorized";
      result[categoryId].commands.push(cmd);
    });

    // 过滤掉没有命令的分类
    return Object.values(result).filter((cat) => cat.commands.length > 0);
  };

  // 渲染命令列表
  const renderCommandList = () => {
    const filteredCommands = getFilteredCommands();

    if (loading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
          <CircularProgress />
        </Box>
      );
    }

    if (filteredCommands.length === 0) {
      return (
        <Box sx={{ p: 2, textAlign: "center" }}>
          <Typography color="textSecondary">
            {searchTerm
              ? t("shortcutCommands.noCommandsFound")
              : t("shortcutCommands.noCommands")}
          </Typography>
        </Box>
      );
    }

    return (
      <List sx={{ width: "100%" }} dense>
        {filteredCommands.map((cmd) => (
          <ListItem
            key={cmd.id}
            disablePadding
            secondaryAction={
              <Box display="flex" gap={1}>
                <Tooltip title={t("shortcutCommands.sendCommand")}>
                  <IconButton
                    edge="end"
                    onClick={() => handleSendCommand(cmd.command)}
                  >
                    <SendIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("shortcutCommands.copyCommand")}>
                  <IconButton
                    edge="end"
                    onClick={() => handleCopyCommand(cmd.command)}
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <IconButton
                  edge="end"
                  onClick={(e) => handleMenuOpen(e, cmd.id, "command")}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              </Box>
            }
            sx={{
              "&:hover": {
                backgroundColor: theme.palette.action.hover,
              },
            }}
          >
            <ListItemButton sx={{ pr: 10 }}>
              <ListItemText
                primary={cmd.name}
                secondary={
                  <React.Fragment>
                    <Typography
                      variant="body2"
                      component="span"
                      sx={{
                        display: "inline",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {cmd.command}
                    </Typography>
                    {cmd.description && (
                      <Typography
                        variant="caption"
                        component="div"
                        sx={{
                          color: "text.secondary",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {cmd.description}
                      </Typography>
                    )}
                  </React.Fragment>
                }
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    );
  };

  // 渲染分类视图
  const renderCategoriesView = () => {
    const commandsByCategory = getCommandsByCategory();

    if (loading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", p: 3 }}>
          <CircularProgress />
        </Box>
      );
    }

    if (commandsByCategory.length === 0) {
      return (
        <Box sx={{ p: 2, textAlign: "center" }}>
          <Typography color="textSecondary">
            {searchTerm
              ? t("shortcutCommands.noCommandsFound")
              : t("shortcutCommands.noCommands")}
          </Typography>
        </Box>
      );
    }

    return (
      <List sx={{ width: "100%" }} dense>
        {commandsByCategory.map((category) => (
          <React.Fragment key={category.id}>
            <ListItem
              button
              onClick={() => toggleCategoryExpand(category.id)}
              sx={{
                backgroundColor: theme.palette.action.hover,
                px: 2,
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                <FolderIcon sx={{ color: category.color }} />
              </ListItemIcon>
              <ListItemText primary={category.name} />
              {expandedCategories[category.id] ? (
                <ExpandLessIcon />
              ) : (
                <ExpandMoreIcon />
              )}
              {category.id !== "uncategorized" && (
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleMenuOpen(e, category.id, "category");
                  }}
                  sx={{ ml: 1 }}
                >
                  <MoreVertIcon fontSize="small" />
                </IconButton>
              )}
            </ListItem>
            <Collapse
              in={expandedCategories[category.id] || false}
              timeout="auto"
              unmountOnExit
            >
              <List component="div" disablePadding>
                {category.commands.map((cmd) => (
                  <ListItem
                    key={cmd.id}
                    disablePadding
                    sx={{ pl: 4 }}
                    secondaryAction={
                      <Box display="flex" gap={1}>
                        <Tooltip title={t("shortcutCommands.sendCommand")}>
                          <IconButton
                            edge="end"
                            onClick={() => handleSendCommand(cmd.command)}
                            size="small"
                          >
                            <SendIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("shortcutCommands.copyCommand")}>
                          <IconButton
                            edge="end"
                            onClick={() => handleCopyCommand(cmd.command)}
                            size="small"
                          >
                            <ContentCopyIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <IconButton
                          edge="end"
                          onClick={(e) => handleMenuOpen(e, cmd.id, "command")}
                          size="small"
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    }
                  >
                    <ListItemButton sx={{ pr: 10 }}>
                      <ListItemText
                        primary={cmd.name}
                        secondary={
                          <React.Fragment>
                            <Typography
                              variant="body2"
                              component="span"
                              sx={{
                                display: "inline",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                              }}
                            >
                              {cmd.command}
                            </Typography>
                            {cmd.description && (
                              <Typography
                                variant="caption"
                                component="div"
                                sx={{
                                  color: "text.secondary",
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {cmd.description}
                              </Typography>
                            )}
                          </React.Fragment>
                        }
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Collapse>
          </React.Fragment>
        ))}
      </List>
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
        <TextField
          margin="dense"
          label={t("shortcutCommands.description")}
          fullWidth
          value={currentCommand?.description || ""}
          onChange={(e) =>
            handleCommandFormChange("description", e.target.value)
          }
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
      anchorEl={menuAnchorEl}
      open={menuOpen}
      onClose={handleMenuClose}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "right",
      }}
      transformOrigin={{
        vertical: "top",
        horizontal: "right",
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

  // 处理通知关闭
  const handleCloseNotification = () => {
    setNotification((prev) => ({
      ...prev,
      open: false,
    }));
  };

  // 渲染组件主体
  return (
    <Paper
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
      elevation={4}
    >
      {open && (
        <>
          {/* 标题栏 */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {t("shortcutCommands.title")}
            </Typography>
            <Box>
              <Tooltip title={t("shortcutCommands.addCommand")}>
                <IconButton onClick={handleAddCommand} size="small">
                  <AddIcon />
                </IconButton>
              </Tooltip>
              <IconButton onClick={onClose} size="small">
                <CloseIcon />
              </IconButton>
            </Box>
          </Box>

          {/* 搜索框 */}
          <Box
            sx={{ p: 1, borderBottom: `1px solid ${theme.palette.divider}` }}
          >
            <TextField
              placeholder={t("shortcutCommands.search")}
              variant="outlined"
              size="small"
              fullWidth
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
                    <IconButton size="small" onClick={() => setSearchTerm("")}>
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>

          {/* 标签页 */}
          <Box sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
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

          {/* 内容区域 */}
          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              bgcolor:
                theme.palette.mode === "dark" ? "background.paper" : "grey.50",
              "&::-webkit-scrollbar": {
                width: "8px",
              },
              "&::-webkit-scrollbar-thumb": {
                backgroundColor: "rgba(0,0,0,0.2)",
                borderRadius: "4px",
              },
            }}
          >
            <div
              role="tabpanel"
              hidden={tabValue !== 0}
              id="commands-tabpanel-0"
              aria-labelledby="commands-tab-0"
            >
              {tabValue === 0 && renderCommandList()}
            </div>
            <div
              role="tabpanel"
              hidden={tabValue !== 1}
              id="commands-tabpanel-1"
              aria-labelledby="commands-tab-1"
            >
              {tabValue === 1 && (
                <Box>
                  <Box sx={{ p: 1, textAlign: "right" }}>
                    <Button
                      startIcon={<CategoryIcon />}
                      size="small"
                      onClick={handleAddCategory}
                    >
                      {t("shortcutCommands.addCategory")}
                    </Button>
                  </Box>
                  {renderCategoriesView()}
                </Box>
              )}
            </div>
          </Box>

          {/* 底部操作区 */}
          <Box
            sx={{
              p: 1,
              borderTop: `1px solid ${theme.palette.divider}`,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Typography
              variant="caption"
              color="textSecondary"
              sx={{ flexGrow: 1, alignSelf: "center" }}
            >
              {loading
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

          {/* 添加通知组件 */}
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
      )}
    </Paper>
  );
}

export default ShortcutCommands;
