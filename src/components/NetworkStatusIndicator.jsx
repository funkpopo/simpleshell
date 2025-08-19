import React, { memo } from 'react';
import {
  Box,
  Chip,
  Tooltip,
  IconButton,
  Popover,
  Paper,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  LinearProgress,
  Alert
} from '@mui/material';
import {
  WifiOff as WifiOffIcon,
  Wifi as WifiIcon,
  SignalWifi4Bar as ExcellentIcon,
  SignalWifi3Bar as GoodIcon,
  SignalWifi2Bar as PoorIcon,
  Refresh as RefreshIcon,
  History as HistoryIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import useNetworkState from '../hooks/useNetworkState';

const NetworkStatusIndicator = memo(function NetworkStatusIndicator() {
  const theme = useTheme();
  const { t } = useTranslation();
  const { 
    networkState, 
    connectionHistory, 
    checkNetworkNow,
    getQualityDescription 
  } = useNetworkState();

  const [anchorEl, setAnchorEl] = React.useState(null);
  const open = Boolean(anchorEl);

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleRefresh = async (event) => {
    event.stopPropagation();
    await checkNetworkNow();
  };

  const getStatusIcon = () => {
    if (networkState.isLoading) {
      return <LinearProgress sx={{ width: 20, height: 4 }} />;
    }

    if (!networkState.isOnline) {
      return <WifiOffIcon fontSize="small" />;
    }

    switch (networkState.quality) {
      case 'excellent':
        return <ExcellentIcon fontSize="small" />;
      case 'good':
        return <GoodIcon fontSize="small" />;
      case 'poor':
        return <PoorIcon fontSize="small" />;
      default:
        return <WifiIcon fontSize="small" />;
    }
  };

  const getStatusColor = () => {
    if (!networkState.isOnline) {
      return theme.palette.error.main;
    }
    
    const qualityInfo = getQualityDescription(networkState.quality);
    return qualityInfo.color;
  };

  const formatDuration = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m`;
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  return (
    <>
      <Tooltip 
        title={networkState.isOnline ? 
          `网络连接 - ${getQualityDescription(networkState.quality).text}` : 
          '网络离线'
        }
      >
        <Chip
          icon={getStatusIcon()}
          label={networkState.isOnline ? 
            getQualityDescription(networkState.quality).text : 
            '离线'
          }
          variant={networkState.isOnline ? 'filled' : 'outlined'}
          size="small"
          onClick={handleClick}
          sx={{
            backgroundColor: networkState.isOnline ? 
              `${getStatusColor()}20` : 
              theme.palette.error.main + '20',
            color: getStatusColor(),
            borderColor: getStatusColor(),
            cursor: 'pointer',
            '& .MuiChip-icon': {
              color: getStatusColor()
            }
          }}
        />
      </Tooltip>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={handleClose}
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'center',
        }}
        transformOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
      >
        <Paper sx={{ p: 2, minWidth: 320, maxWidth: 400 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="h6" component="div">
              网络状态
            </Typography>
            <IconButton 
              size="small" 
              onClick={handleRefresh}
              disabled={networkState.isLoading}
            >
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* 当前状态 */}
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
              {getStatusIcon()}
              <Typography variant="body1" sx={{ ml: 1, fontWeight: 'medium' }}>
                {networkState.isOnline ? '在线' : '离线'}
              </Typography>
              {networkState.isOnline && (
                <Chip 
                  label={getQualityDescription(networkState.quality).text}
                  size="small"
                  sx={{ 
                    ml: 1,
                    backgroundColor: `${getQualityDescription(networkState.quality).color}20`,
                    color: getQualityDescription(networkState.quality).color
                  }}
                />
              )}
            </Box>
            
            {networkState.lastCheck && (
              <Typography variant="caption" color="text.secondary">
                最后检查: {formatTimestamp(networkState.lastCheck)}
              </Typography>
            )}
          </Box>

          {/* 离线模式提示 */}
          {!networkState.isOnline && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <Typography variant="body2">
                应用当前处于离线模式，某些功能将不可用：
              </Typography>
              <List dense sx={{ mt: 1 }}>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="• SSH 连接"
                    primaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="• 文件传输"
                    primaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
                <ListItem sx={{ py: 0 }}>
                  <ListItemText 
                    primary="• AI 聊天"
                    primaryTypographyProps={{ variant: 'caption' }}
                  />
                </ListItem>
              </List>
            </Alert>
          )}

          {/* 离线时长 */}
          {!networkState.isOnline && networkState.offlineDuration > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                离线时长: {formatDuration(networkState.offlineDuration)}
              </Typography>
            </Box>
          )}

          {/* 连接历史 */}
          {connectionHistory.length > 0 && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <HistoryIcon fontSize="small" sx={{ mr: 1 }} />
                <Typography variant="body2" fontWeight="medium">
                  连接历史
                </Typography>
              </Box>
              <List dense sx={{ maxHeight: 150, overflow: 'auto' }}>
                {connectionHistory.slice(0, 5).map((entry, index) => (
                  <ListItem key={index} sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      {entry.isOnline ? (
                        <CheckCircleIcon fontSize="small" color="success" />
                      ) : (
                        <ErrorIcon fontSize="small" color="error" />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={entry.isOnline ? 
                        `已连接 (${getQualityDescription(entry.quality).text})` : 
                        '已断开'
                      }
                      secondary={formatTimestamp(entry.timestamp)}
                      primaryTypographyProps={{ variant: 'caption' }}
                      secondaryTypographyProps={{ variant: 'caption', fontSize: '0.7rem' }}
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Paper>
      </Popover>
    </>
  );
});

export default NetworkStatusIndicator;