import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
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
  Tooltip,
  CircularProgress,
  Alert,
  Snackbar,
  InputAdornment,
  Menu,
  MenuItem,
  Divider,
  ListItemSecondaryAction,
  Chip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import AddIcon from "@mui/icons-material/Add";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import LaunchIcon from "@mui/icons-material/Launch";
import TerminalIcon from "@mui/icons-material/Terminal";
import CodeIcon from "@mui/icons-material/Code";
import StorageIcon from "@mui/icons-material/Storage";
import WebIcon from "@mui/icons-material/Web";
import BuildIcon from "@mui/icons-material/Build";
import { RiTerminalBoxLine } from "react-icons/ri";
import { VscTerminalLinux, VscTerminalUbuntu, VscTerminalDebian } from "react-icons/vsc";
import { GrArchlinux } from "react-icons/gr";
import { SiAlpinelinux, SiGit } from "react-icons/si";
import { FaGitAlt } from "react-icons/fa";
import { useTranslation } from "react-i18next";
import useAutoCleanup from "../hooks/useAutoCleanup";
import TerminalConfigDialog from "./TerminalConfigDialog";

// 终端类型图标映射
const getTerminalIcon = (terminal) => {
  const { type, distribution, icon } = terminal;
  
  // 自定义终端图标
  if (terminal.isCustom && icon) {
    const iconMap = {
      'terminal': <TerminalIcon sx={{ fontSize: 20 }} />,
      'vscode': <CodeIcon sx={{ fontSize: 20 }} />,
      'git': <FaGitAlt size={20} />,
      'editor': <EditIcon sx={{ fontSize: 20 }} />,
      'browser': <WebIcon sx={{ fontSize: 20 }} />,
      'database': <StorageIcon sx={{ fontSize: 20 }} />,
      'server': <StorageIcon sx={{ fontSize: 20 }} />,
      'tool': <BuildIcon sx={{ fontSize: 20 }} />
    };
    return iconMap[icon] || <RiTerminalBoxLine size={20} />;
  }
  
  // WSL 系统类型检测
  if (type === 'wsl' && distribution) {
    const distName = distribution.toLowerCase();
    if (distName.includes('ubuntu')) return <VscTerminalUbuntu size={20} />;
    if (distName.includes('debian')) return <VscTerminalDebian size={20} />;
    if (distName.includes('arch')) return <GrArchlinux size={20} />;
    if (distName.includes('alpine')) return <SiAlpinelinux size={20} />;
    return <VscTerminalLinux size={20} />;
  }
  
  // 其他终端类型
  const iconMap = {
    'wsl': <VscTerminalLinux size={20} />,
  };
  
  return iconMap[type] || <RiTerminalBoxLine size={20} />;
};

const LocalTerminalSidebar = ({ open, onClose, onLaunchTerminal }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [detectedTerminals, setDetectedTerminals] = useState([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "info",
  });
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [editingTerminal, setEditingTerminal] = useState(null);
  
  const searchInputRef = useRef(null);
  const sidebarRef = useRef(null);

  // 清理资源的自定义hook
  useAutoCleanup(open);

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!open) return;
      
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

  // 检测可用终端
  const detectTerminals = useCallback(async () => {
    setIsDetecting(true);
    try {
      if (window.terminalAPI?.detectLocalTerminals) {
        console.log('开始检测本地终端...');
        const terminals = await window.terminalAPI.detectLocalTerminals();
        console.log('检测到的终端:', terminals);
        console.log('终端数量:', terminals?.length);
        
        setDetectedTerminals(terminals || []);
        setSnackbar({
          open: true,
          message: t("localTerminal.detectSuccess", { count: terminals?.length || 0 }),
          severity: "success",
        });
      } else {
        console.error('terminalAPI.detectLocalTerminals 不可用');
        setSnackbar({
          open: true,
          message: "终端API不可用",
          severity: "error",
        });
      }
    } catch (error) {
      console.error('Failed to detect terminals:', error);
      setSnackbar({
        open: true,
        message: t("localTerminal.detectError"),
        severity: "error",
      });
    } finally {
      setIsDetecting(false);
    }
  }, [t]);

  // 初始检测终端
  useEffect(() => {
    if (open && detectedTerminals.length === 0) {
      detectTerminals();
    }
  }, [open, detectedTerminals.length, detectTerminals]);

  // 过滤终端列表
  const filteredTerminals = useMemo(() => {
    if (!searchQuery) return detectedTerminals;
    const query = searchQuery.toLowerCase();
    return detectedTerminals.filter(terminal => 
      terminal.name.toLowerCase().includes(query) ||
      terminal.type.toLowerCase().includes(query)
    );
  }, [detectedTerminals, searchQuery]);

  // 启动终端
  const handleLaunchTerminal = useCallback(async (terminal) => {
    // 添加终端配置检查
    if (!terminal) {
      console.error("Terminal configuration is undefined");
      setSnackbar({
        open: true,
        message: t("localTerminal.noTerminalSelected", "请选择一个终端"),
        severity: "warning",
      });
      return;
    }
    
    console.log("尝试启动终端:", terminal);
    
    try {
      if (onLaunchTerminal) {
        await onLaunchTerminal(terminal);
        setSnackbar({
          open: true,
          message: t("localTerminal.launchSuccess", { name: terminal.name }),
          severity: "success",
        });
      }
    } catch (error) {
      console.error("Failed to launch terminal:", error);
      
      // 提供更详细的错误信息
      let errorMessage = error.message || t("localTerminal.launchError", { error: "Unknown error" });
      
      if (error.executable) {
        errorMessage = `${errorMessage}\n路径: ${error.executable}`;
      }
      
      if (error.suggestion) {
        errorMessage = `${errorMessage}\n${error.suggestion}`;
      }
      
      setSnackbar({
        open: true,
        message: errorMessage,
        severity: "error",
      });
    }
  }, [onLaunchTerminal, t]);

  // 处理右键菜单
  const handleContextMenu = useCallback((event, terminal) => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedTerminal(terminal);
    setContextMenu({
      mouseX: event.clientX - 2,
      mouseY: event.clientY - 4,
    });
  }, []);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
    setSelectedTerminal(null);
  }, []);

  // 添加自定义终端
  const handleAddCustomTerminal = useCallback(() => {
    setEditingTerminal(null);
    setConfigDialogOpen(true);
    handleCloseContextMenu();
  }, [handleCloseContextMenu]);

  // 编辑终端
  const handleEditTerminal = useCallback(() => {
    if (selectedTerminal) {
      setEditingTerminal(selectedTerminal);
      setConfigDialogOpen(true);
    }
    handleCloseContextMenu();
  }, [selectedTerminal, handleCloseContextMenu]);

  // 删除终端
  const handleDeleteTerminal = useCallback(async () => {
    if (selectedTerminal && selectedTerminal.isCustom) {
      try {
        const result = await window.terminalAPI.deleteCustomTerminal(selectedTerminal.id);
        if (result.success) {
          // 刷新终端列表
          await detectTerminals();
          setSnackbar({
            open: true,
            message: t("localTerminal.deleteSuccess", { name: selectedTerminal.name }),
            severity: "success",
          });
        } else {
          throw new Error(result.error);
        }
      } catch (error) {
        setSnackbar({
          open: true,
          message: t("localTerminal.deleteError", { error: error.message }),
          severity: "error",
        });
      }
    }
    handleCloseContextMenu();
  }, [selectedTerminal, detectTerminals, t, handleCloseContextMenu]);

  // 保存终端配置
  const handleSaveTerminalConfig = useCallback(async (terminalConfig) => {
    try {
      let result;
      if (editingTerminal && editingTerminal.id) {
        // 更新现有终端
        result = await window.terminalAPI.updateCustomTerminal(
          editingTerminal.id,
          terminalConfig
        );
      } else {
        // 添加新终端
        result = await window.terminalAPI.addCustomTerminal(terminalConfig);
      }

      if (result.success) {
        // 刷新终端列表
        await detectTerminals();
        setSnackbar({
          open: true,
          message: editingTerminal
            ? t("localTerminal.updateSuccess", { name: terminalConfig.name })
            : t("localTerminal.addSuccess", { name: terminalConfig.name }),
          severity: "success",
        });
        setConfigDialogOpen(false);
        setEditingTerminal(null);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: t("localTerminal.saveError", { error: error.message }),
        severity: "error",
      });
    }
  }, [editingTerminal, detectTerminals, t]);


  // 清空搜索
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // 终端项组件
  const TerminalItem = useCallback(({ terminal }) => {
    return (
      <ListItem 
        disablePadding 
        sx={{ mb: 0.5 }}
        onContextMenu={(e) => handleContextMenu(e, terminal)}
      >
        <ListItemButton
          onClick={() => handleLaunchTerminal(terminal)}
          sx={{
            borderRadius: 1,
            minHeight: 48,
            py: 1,
            pr: terminal.isCustom ? 6 : 2,
            '&:hover': {
              backgroundColor: theme.palette.action.hover,
            }
          }}
        >
          <ListItemIcon sx={{ minWidth: 40 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: terminal.isCustom 
                  ? theme.palette.primary.main + '15'
                  : theme.palette.background.paper,
                border: `1px solid ${terminal.isCustom 
                  ? theme.palette.primary.main + '30'
                  : theme.palette.divider}`,
              }}
            >
              {getTerminalIcon(terminal)}
            </Box>
          </ListItemIcon>
          
          <ListItemText
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.875rem' }}>
                  {terminal.name}
                </Typography>
                {terminal.isCustom && (
                  <Chip 
                    label={t('localTerminal.custom')} 
                    size="small" 
                    sx={{ height: 18, fontSize: '0.7rem' }}
                  />
                )}
              </Box>
            }
            secondary={
              terminal.description && (
                <Typography variant="caption" color="text.secondary">
                  {terminal.description}
                </Typography>
              )
            }
          />
          
          {terminal.isCustom && (
            <ListItemSecondaryAction>
              <IconButton
                edge="end"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleContextMenu(e, terminal);
                }}
              >
                <MoreVertIcon fontSize="small" />
              </IconButton>
            </ListItemSecondaryAction>
          )}
        </ListItemButton>
      </ListItem>
    );
  }, [theme, handleLaunchTerminal, handleContextMenu, t]);

  if (!open) return null;

  return (
    <Paper
      ref={sidebarRef}
      elevation={3}
      square={true}
      sx={{
        width: 300,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
    >
      {/* 头部 */}
      <Box
        sx={{
          p: 2,
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <Typography variant="subtitle1" fontWeight="medium" sx={{ flexGrow: 1 }}>
          {t("localTerminal.title")}
        </Typography>
        
        <Tooltip title={t("localTerminal.addCustom")}>
          <IconButton
            size="small"
            onClick={handleAddCustomTerminal}
          >
            <AddIcon />
          </IconButton>
        </Tooltip>
        
        <Tooltip title={t("localTerminal.refresh")}>
          <IconButton
            size="small"
            onClick={detectTerminals}
            disabled={isDetecting}
          >
            {isDetecting ? (
              <CircularProgress size={18} />
            ) : (
              <RefreshIcon />
            )}
          </IconButton>
        </Tooltip>
        
        <Tooltip title={t("common.close")}>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 搜索框 */}
      <Box sx={{ p: 2, pb: 1 }}>
        <TextField
          ref={searchInputRef}
          fullWidth
          size="small"
          placeholder={t("localTerminal.searchPlaceholder")}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon fontSize="small" />
              </InputAdornment>
            ),
            endAdornment: searchQuery && (
              <InputAdornment position="end">
                <IconButton size="small" onClick={clearSearch}>
                  <ClearIcon fontSize="small" />
                </IconButton>
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              borderRadius: 2,
            }
          }}
        />
      </Box>

      {/* 可用终端列表 */}
      <Box sx={{ flexGrow: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Box sx={{ px: 2, pb: 1 }}>
          <Typography variant="subtitle2" color="text.secondary" sx={{ fontWeight: 500 }}>
            {t("localTerminal.availableTerminals")} ({filteredTerminals.length})
          </Typography>
        </Box>
        
        <Box sx={{ px: 2, flex: 1, overflow: 'auto' }}>
          {filteredTerminals.length > 0 ? (
            <List disablePadding>
              {filteredTerminals.map((terminal, index) => (
                <TerminalItem
                  key={terminal.id || terminal.type || `terminal-${index}`}
                  terminal={terminal}
                />
              ))}
            </List>
          ) : (
            <Alert severity="info" sx={{ mt: 1 }}>
              {isDetecting ? t("localTerminal.detecting") : t("localTerminal.noTerminals")}
            </Alert>
          )}
        </Box>
      </Box>

      {/* 右键菜单 */}
      <Menu
        open={contextMenu !== null}
        onClose={handleCloseContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu !== null
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
      >
        <MenuItem onClick={() => {
          if (selectedTerminal) {
            handleLaunchTerminal(selectedTerminal);
          }
          handleCloseContextMenu();
        }}>
          <ListItemIcon>
            <LaunchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t('localTerminal.launch')}</ListItemText>
        </MenuItem>
        
        {selectedTerminal?.isCustom && [
          <MenuItem key="edit" onClick={handleEditTerminal}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('common.edit')}</ListItemText>
          </MenuItem>,
          <Divider key="divider" />,
          <MenuItem key="delete" onClick={handleDeleteTerminal}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t('common.delete')}</ListItemText>
          </MenuItem>
        ]}
      </Menu>

      {/* 终端配置对话框 */}
      <TerminalConfigDialog
        open={configDialogOpen}
        onClose={() => {
          setConfigDialogOpen(false);
          setEditingTerminal(null);
        }}
        terminal={editingTerminal}
        onSave={handleSaveTerminalConfig}
      />

      {/* Snackbar消息提示 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert 
          onClose={() => setSnackbar({ ...snackbar, open: false })} 
          severity={snackbar.severity}
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Paper>
  );
};

export default LocalTerminalSidebar;