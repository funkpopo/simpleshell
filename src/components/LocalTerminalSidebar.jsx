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
  Chip,
  Divider,
  Button,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import ComputerIcon from "@mui/icons-material/Computer";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import { useTranslation } from "react-i18next";
import useAutoCleanup from "../hooks/useAutoCleanup";

// 终端类型图标映射
const getTerminalIcon = (type, icon) => {
  const iconMap = {
    'powershell-core': '🔵',
    'powershell': '🔷', 
    'cmd': '⚫',
    'git-bash': '🦊',
    'windows-terminal': '🔳',
    'wsl': '🐧',
    'vscode': '📝',
    'conemu': '🟨',
    'cmder': '🟩',
    'terminal': '⚫',
    'iterm2': '🔷',
    'hyper': '⚡',
    'gnome-terminal': '🔷',
    'konsole': '🔵',
    'xfce4-terminal': '🐁',
    'terminator': '🤖'
  };
  
  return iconMap[type] || icon || '💻';
};

const LocalTerminalSidebar = ({ open, onClose, onLaunchTerminal }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [detectedTerminals, setDetectedTerminals] = useState([]);
  const [isDetecting, setIsDetecting] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [menuAnchor, setMenuAnchor] = useState(null);
  const [selectedTerminal, setSelectedTerminal] = useState(null);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "info",
  });
  
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
  const handleLaunchTerminal = useCallback(async (terminal, options = {}) => {
    try {
      if (onLaunchTerminal) {
        await onLaunchTerminal(terminal, options);
        const distText = options.distribution ? ` (${options.distribution})` : '';
        setSnackbar({
          open: true,
          message: t("localTerminal.launchSuccess", { name: terminal.name + distText }),
          severity: "success",
        });
      }
    } catch (error) {
      setSnackbar({
        open: true,
        message: t("localTerminal.launchError", { error: error.message }),
        severity: "error",
      });
    }
  }, [onLaunchTerminal, t]);

  // 处理菜单打开
  const handleMenuOpen = useCallback((event, terminal) => {
    event.preventDefault();
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setSelectedTerminal(terminal);
  }, []);

  // 处理菜单关闭
  const handleMenuClose = useCallback(() => {
    setMenuAnchor(null);
    setSelectedTerminal(null);
  }, []);

  // 处理终端启动选项
  const handleTerminalLaunchOption = useCallback(async (options) => {
    if (selectedTerminal) {
      await handleLaunchTerminal(selectedTerminal, options);
    }
    handleMenuClose();
  }, [selectedTerminal, handleLaunchTerminal, handleMenuClose]);

  // 清空搜索
  const clearSearch = useCallback(() => {
    setSearchQuery("");
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  // 终端项组件
  const TerminalItem = useCallback(({ terminal }) => {
    const hasDistributions = terminal.availableDistributions && terminal.availableDistributions.length > 0;
    
    return (
      <ListItem disablePadding sx={{ mb: 0.5 }}>
        <ListItemButton
          onClick={() => handleLaunchTerminal(terminal)}
          onContextMenu={(e) => hasDistributions && handleMenuOpen(e, terminal)}
          sx={{
            borderRadius: 1,
            minHeight: 60,
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
                backgroundColor: theme.palette.background.paper,
                fontSize: '16px',
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              {getTerminalIcon(terminal.type, terminal.icon)}
            </Box>
          </ListItemIcon>
          
          <ListItemText
            primary={
              <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                {terminal.name}
              </Typography>
            }
            secondary={
              <Box sx={{ mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {terminal.type}
                </Typography>
                {hasDistributions && (
                  <Box sx={{ mt: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {terminal.availableDistributions.slice(0, 2).map((dist) => (
                      <Chip
                        key={dist.name}
                        label={dist.name}
                        size="small"
                        variant="outlined"
                        sx={{ 
                          height: 16, 
                          fontSize: '10px',
                          '& .MuiChip-label': { px: 0.5 }
                        }}
                      />
                    ))}
                    {terminal.availableDistributions.length > 2 && (
                      <Typography variant="caption" color="text.secondary">
                        +{terminal.availableDistributions.length - 2}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            }
          />

          {hasDistributions && (
            <IconButton
              size="small"
              onClick={(e) => handleMenuOpen(e, terminal)}
              sx={{ ml: 1 }}
            >
              <ArrowDropDownIcon />
            </IconButton>
          )}
        </ListItemButton>
      </ListItem>
    );
  }, [theme, handleLaunchTerminal, handleMenuOpen]);

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
        <ComputerIcon color="primary" />
        <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 600 }}>
          {t("localTerminal.title")}
        </Typography>
        
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
              {filteredTerminals.map((terminal) => (
                <TerminalItem
                  key={terminal.type}
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

      {/* 启动选项菜单 */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        {selectedTerminal && (
          <>
            <MenuItem onClick={() => handleTerminalLaunchOption({})}>
              <ListItemIcon>
                <Box sx={{ fontSize: '16px', mr: 1 }}>
                  {getTerminalIcon(selectedTerminal.type, selectedTerminal.icon)}
                </Box>
              </ListItemIcon>
              <ListItemText primary={t("localTerminal.launchNormal")} />
            </MenuItem>

            {selectedTerminal.availableDistributions && selectedTerminal.availableDistributions.length > 0 && (
              <>
                <Divider />
                <MenuItem disabled>
                  <ListItemText 
                    primary={t("localTerminal.wslDistributions")}
                    sx={{ 
                      '& .MuiListItemText-primary': { 
                        fontSize: '0.875rem', 
                        fontWeight: 500,
                        color: 'text.secondary' 
                      }
                    }}
                  />
                </MenuItem>
                {selectedTerminal.availableDistributions.map((dist) => (
                  <MenuItem 
                    key={dist.name}
                    onClick={() => handleTerminalLaunchOption({ distribution: dist.name })}
                  >
                    <ListItemIcon>
                      <Box sx={{ fontSize: '14px', mr: 1 }}>🐧</Box>
                    </ListItemIcon>
                    <ListItemText 
                      primary={dist.name}
                      secondary={`${dist.version} • ${dist.state}`}
                    />
                  </MenuItem>
                ))}
              </>
            )}
          </>
        )}
      </Menu>
    </Paper>
  );
};

export default LocalTerminalSidebar;