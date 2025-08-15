import React, { useState, useEffect, useRef, useMemo } from "react";
import { FixedSizeList as List } from "react-window";
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
import ClearIcon from "@mui/icons-material/Clear";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import SearchIcon from "@mui/icons-material/Search";
import SendIcon from "@mui/icons-material/Send";
import FolderIcon from "@mui/icons-material/Folder";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CategoryIcon from "@mui/icons-material/Category";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useTranslation } from "react-i18next";
import { dispatchCommandToGroup } from "../core/syncGroupCommandDispatcher";

// 虚拟化命令项组件
const CommandItem = React.memo(({ index, style, data }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { commands, handleSendCommand, handleCopyCommand, handleMenuOpen } =
    data;
  const cmd = commands[index];

  if (!cmd) return null;

  return (
    <div style={style}>
      <ListItem
        disablePadding
        sx={{
          mb: 0.5,
          mx: 0.5,
          borderRadius: 1,
          overflow: "hidden",
          minHeight: 72,
          width: "calc(100% - 8px)",
          boxSizing: "border-box",
        }}
      >
        <ListItemButton
          sx={{
            pl: 1,
            pr: 1,
            minHeight: 72,
            borderRadius: 1,
            position: "relative",
            py: 1,
            width: "100%",
            boxSizing: "border-box",
            "&:hover": {
              backgroundColor: theme.palette.action.hover,
              "& .command-actions": {
                opacity: 1,
              },
            },
          }}
        >
          <ListItemText
            sx={{
              flex: 1,
              minWidth: 0,
              mr: 1,
            }}
            primary={
              <Typography
                variant="subtitle2"
                fontWeight="medium"
                sx={{
                  color: theme.palette.text.primary,
                  mb: 0.5,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {cmd.name}
              </Typography>
            }
            secondary={
              <Box sx={{ minWidth: 0 }}>
                <Typography
                  variant="body2"
                  component="div"
                  sx={{
                    fontFamily: "monospace",
                    backgroundColor: theme.palette.action.hover,
                    color: theme.palette.text.secondary,
                    px: 1,
                    py: 0.4,
                    borderRadius: 0.5,
                    fontSize: "0.75rem",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    mb: cmd.description ? 0.4 : 0,
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
              </Box>
            }
          />
          <Box
            className="command-actions"
            sx={{
              display: "flex",
              gap: 0.5,
              opacity: 0,
              transition: "opacity 0.2s",
              position: "absolute",
              right: 8,
              top: "50%",
              transform: "translateY(-50%)",
              flexShrink: 0,
            }}
          >
            <Tooltip title={t("shortcutCommands.sendCommand")}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSendCommand(cmd.command);
                }}
                sx={{
                  backgroundColor: theme.palette.primary.main,
                  color: "white",
                  "&:hover": {
                    backgroundColor: theme.palette.primary.dark,
                  },
                }}
              >
                <SendIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("shortcutCommands.copyCommand")}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyCommand(cmd.command);
                }}
                sx={{
                  backgroundColor: theme.palette.grey[600],
                  color: "white",
                  "&:hover": {
                    backgroundColor: theme.palette.grey[700],
                  },
                }}
              >
                <ContentCopyIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                handleMenuOpen(e, cmd.id, "command");
              }}
              sx={{
                backgroundColor: theme.palette.grey[500],
                color: "white",
                "&:hover": {
                  backgroundColor: theme.palette.grey[600],
                },
              }}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Box>
        </ListItemButton>
      </ListItem>
    </div>
  );
});

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
  const [containerHeight, setContainerHeight] = useState(400);
  const containerRef = useRef(null);

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

    let resizeObserver;
    try {
      resizeObserver = new ResizeObserver(updateHeight);
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
    } catch (error) {
      // ResizeObserver 不可用，使用默认高度
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
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
    // 需要tabId，假设通过props.currentTabId传递
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
        // 错误已通过UI通知显示给用户
      }
    } else {
      setNotification({
        open: true,
        message: t("shortcutCommands.sendCommandHandlerMissing"),
        severity: "warning",
      });
      // 警告已通过UI通知显示给用户
    }
  };

  // 处理复制命令
  const handleCopyCommand = (command) => {
    navigator.clipboard.writeText(command).catch((err) => {});
  };

  // 过滤命令
  const filteredCommands = useMemo(() => {
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
  }, [commands, searchTerm, selectedCategory]);

  // 虚拟化列表的数据
  const listItemData = useMemo(
    () => ({
      commands: filteredCommands,
      handleSendCommand,
      handleCopyCommand,
      handleMenuOpen,
    }),
    [filteredCommands, handleSendCommand, handleCopyCommand, handleMenuOpen],
  );

  // 过滤命令 (保留原函数以兼容其他地方的调用)
  const getFilteredCommands = () => {
    return filteredCommands;
  };

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

  // 获取按分类分组的命令 (保留原函数以兼容其他地方的调用)
  const getCommandsByCategory = () => {
    return commandsByCategory;
  };

  // 渲染命令列表
  const renderCommandList = () => {
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

    // 对于少量命令，使用传统渲染以避免虚拟化开销
    if (filteredCommands.length < 30) {
      return (
        <Box
          sx={{
            width: "100%",
            p: 0,
            overflowX: "hidden",
            height: "100%",
            overflow: "auto",
          }}
        >
          {filteredCommands.map((cmd) => (
            <CommandItem
              key={cmd.id}
              index={filteredCommands.indexOf(cmd)}
              style={{ height: 72 }}
              data={listItemData}
            />
          ))}
        </Box>
      );
    }

    // 对于大量命令，使用虚拟化渲染
    return (
      containerHeight > 0 && (
        <List
          height={containerHeight}
          itemCount={filteredCommands.length}
          itemSize={72}
          itemData={listItemData}
          overscanCount={10}
          width="100%"
        >
          {CommandItem}
        </List>
      )
    );
  };

  // 渲染分类视图
  const renderCategoriesView = () => {
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
      <List sx={{ width: "100%", p: 0, overflowX: "hidden" }} dense={false}>
        {commandsByCategory.map((category) => (
          <Box key={category.id} sx={{ mb: 1 }}>
            <ListItem
              disablePadding
              sx={{
                mx: 0.5,
                borderRadius: 1,
                overflow: "hidden",
                minHeight: 60,
              }}
            >
              <ListItemButton
                onClick={() => toggleCategoryExpand(category.id)}
                sx={{
                  backgroundColor:
                    theme.palette.mode === "dark"
                      ? "rgba(255, 255, 255, 0.08)"
                      : "rgba(0, 0, 0, 0.04)",
                  borderRadius: 1,
                  px: 2,
                  py: 1.5,
                  minHeight: 60,
                  "&:hover": {
                    backgroundColor:
                      theme.palette.mode === "dark"
                        ? "rgba(255, 255, 255, 0.12)"
                        : "rgba(0, 0, 0, 0.08)",
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <FolderIcon sx={{ color: category.color, fontSize: 20 }} />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Typography variant="subtitle2" fontWeight="medium">
                      {category.name}
                    </Typography>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary">
                      {category.commands.length}{" "}
                      {t("shortcutCommands.commands")}
                    </Typography>
                  }
                />
                {expandedCategories[category.id] ? (
                  <ExpandLessIcon sx={{ color: "text.secondary" }} />
                ) : (
                  <ExpandMoreIcon sx={{ color: "text.secondary" }} />
                )}
                {category.id !== "uncategorized" && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMenuOpen(e, category.id, "category");
                    }}
                    sx={{
                      ml: 1,
                      opacity: 0.7,
                      "&:hover": {
                        opacity: 1,
                        backgroundColor: "rgba(255, 255, 255, 0.1)",
                      },
                    }}
                  >
                    <MoreVertIcon fontSize="small" />
                  </IconButton>
                )}
              </ListItemButton>
            </ListItem>
            <Collapse
              in={expandedCategories[category.id] || false}
              timeout="auto"
              unmountOnExit
            >
              <Box sx={{ ml: 1.5, mr: 0.5, mt: 0.5, overflowX: "hidden" }}>
                {category.commands.map((cmd) => (
                  <ListItem
                    key={cmd.id}
                    disablePadding
                    sx={{
                      mb: 0.5,
                      borderRadius: 1,
                      overflow: "hidden",
                      minHeight: 66,
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    <ListItemButton
                      sx={{
                        pl: 1,
                        pr: 1,
                        minHeight: 66,
                        borderRadius: 1,
                        position: "relative",
                        py: 1,
                        width: "100%",
                        boxSizing: "border-box",
                        backgroundColor:
                          theme.palette.mode === "dark"
                            ? "rgba(255, 255, 255, 0.02)"
                            : "rgba(0, 0, 0, 0.02)",
                        "&:hover": {
                          backgroundColor: theme.palette.action.hover,
                          "& .command-actions": {
                            opacity: 1,
                          },
                        },
                      }}
                    >
                      <ListItemText
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          mr: 1,
                        }}
                        primary={
                          <Typography
                            variant="body2"
                            fontWeight="medium"
                            sx={{
                              mb: 0.5,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {cmd.name}
                          </Typography>
                        }
                        secondary={
                          <Box sx={{ minWidth: 0 }}>
                            <Typography
                              variant="caption"
                              component="div"
                              sx={{
                                fontFamily: "monospace",
                                backgroundColor: theme.palette.action.hover,
                                color: theme.palette.text.secondary,
                                px: 0.8,
                                py: 0.25,
                                borderRadius: 0.5,
                                fontSize: "0.7rem",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                mb: cmd.description ? 0.25 : 0,
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
                                  fontSize: "0.65rem",
                                }}
                              >
                                {cmd.description}
                              </Typography>
                            )}
                          </Box>
                        }
                      />
                      <Box
                        className="command-actions"
                        sx={{
                          display: "flex",
                          gap: 0.3,
                          opacity: 0,
                          transition: "opacity 0.2s",
                          position: "absolute",
                          right: 6,
                          top: "50%",
                          transform: "translateY(-50%)",
                          flexShrink: 0,
                        }}
                      >
                        <Tooltip title={t("shortcutCommands.sendCommand")}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendCommand(cmd.command);
                            }}
                            sx={{
                              width: 24,
                              height: 24,
                              backgroundColor: theme.palette.primary.main,
                              color: "white",
                              "&:hover": {
                                backgroundColor: theme.palette.primary.dark,
                              },
                            }}
                          >
                            <SendIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t("shortcutCommands.copyCommand")}>
                          <IconButton
                            size="small"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyCommand(cmd.command);
                            }}
                            sx={{
                              width: 24,
                              height: 24,
                              backgroundColor: theme.palette.grey[600],
                              color: "white",
                              "&:hover": {
                                backgroundColor: theme.palette.grey[700],
                              },
                            }}
                          >
                            <ContentCopyIcon sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMenuOpen(e, cmd.id, "command");
                          }}
                          sx={{
                            width: 24,
                            height: 24,
                            backgroundColor: theme.palette.grey[500],
                            color: "white",
                            "&:hover": {
                              backgroundColor: theme.palette.grey[600],
                            },
                          }}
                        >
                          <MoreVertIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Box>
                    </ListItemButton>
                  </ListItem>
                ))}
              </Box>
            </Collapse>
          </Box>
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
                      <ClearIcon fontSize="small" />
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
            ref={containerRef}
            sx={{
              flexGrow: 1,
              overflow: "auto",
              bgcolor:
                theme.palette.mode === "dark" ? "background.paper" : "grey.50",
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
