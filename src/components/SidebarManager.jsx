import React, { memo, useCallback } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Paper from '@mui/material/Paper';
import LinkIcon from '@mui/icons-material/Link';
import MonitorHeartIcon from '@mui/icons-material/MonitorHeart';
import FolderIcon from '@mui/icons-material/Folder';
import PublicIcon from '@mui/icons-material/Public';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import HistoryIcon from '@mui/icons-material/History';
import TerminalIcon from '@mui/icons-material/Terminal';
import { useTranslation } from 'react-i18next';
import { SIDEBAR_WIDTHS } from '../constants/layout.js';

const SidebarButton = memo(function SidebarButton({ 
  icon, 
  tooltip, 
  onClick, 
  isActive,
  color = "default"
}) {
  return (
    <Tooltip title={tooltip} placement="right">
      <IconButton
        onClick={onClick}
        sx={{
          mb: 1,
          backgroundColor: isActive ? 'action.selected' : 'transparent',
          '&:hover': {
            backgroundColor: 'action.hover',
          },
        }}
        color={color}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );
});

const SidebarManager = memo(function SidebarManager({
  state,
  dispatch,
  actions,
  onSidebarToggle,
  canShowFileManager
}) {
  const { t } = useTranslation();

  // Sidebar toggle handlers
  const handleConnectionManagerToggle = useCallback(() => {
    const newState = !state.connectionManagerOpen;
    dispatch(actions.setConnectionManagerOpen(newState));
    onSidebarToggle('connectionManager', newState);
  }, [state.connectionManagerOpen, dispatch, actions, onSidebarToggle]);

  const handleResourceMonitorToggle = useCallback(() => {
    const newState = !state.resourceMonitorOpen;
    dispatch(actions.setResourceMonitorOpen(newState));
    onSidebarToggle('resourceMonitor', newState);
  }, [state.resourceMonitorOpen, dispatch, actions, onSidebarToggle]);

  const handleFileManagerToggle = useCallback(() => {
    const newState = !state.fileManagerOpen;
    dispatch(actions.setFileManagerOpen(newState));
    onSidebarToggle('fileManager', newState);
  }, [state.fileManagerOpen, dispatch, actions, onSidebarToggle]);

  const handleIpAddressQueryToggle = useCallback(() => {
    const newState = !state.ipAddressQueryOpen;
    dispatch(actions.setIpAddressQueryOpen(newState));
    onSidebarToggle('ipAddressQuery', newState);
  }, [state.ipAddressQueryOpen, dispatch, actions, onSidebarToggle]);

  const handleRandomPasswordGeneratorToggle = useCallback(() => {
    const newState = !state.randomPasswordGeneratorOpen;
    dispatch(actions.setRandomPasswordGeneratorOpen(newState));
    onSidebarToggle('randomPasswordGenerator', newState);
  }, [state.randomPasswordGeneratorOpen, dispatch, actions, onSidebarToggle]);

  const handleShortcutCommandsToggle = useCallback(() => {
    const newState = !state.shortcutCommandsOpen;
    dispatch(actions.setShortcutCommandsOpen(newState));
    onSidebarToggle('shortcutCommands', newState);
  }, [state.shortcutCommandsOpen, dispatch, actions, onSidebarToggle]);

  const handleCommandHistoryToggle = useCallback(() => {
    const newState = !state.commandHistoryOpen;
    dispatch(actions.setCommandHistoryOpen(newState));
    onSidebarToggle('commandHistory', newState);
  }, [state.commandHistoryOpen, dispatch, actions, onSidebarToggle]);

  return (
    <Paper
      elevation={0}
      sx={{
        position: 'fixed',
        left: 0,
        top: 64,
        bottom: 0,
        width: 56,
        backgroundColor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        py: 1,
        zIndex: 1200,
      }}
    >
      <SidebarButton
        icon={<LinkIcon />}
        tooltip={t('connectionManager')}
        onClick={handleConnectionManagerToggle}
        isActive={state.connectionManagerOpen}
      />
      
      <SidebarButton
        icon={<MonitorHeartIcon />}
        tooltip={t('resourceMonitor')}
        onClick={handleResourceMonitorToggle}
        isActive={state.resourceMonitorOpen}
      />
      
      {canShowFileManager && (
        <SidebarButton
          icon={<FolderIcon />}
          tooltip={t('fileManager')}
          onClick={handleFileManagerToggle}
          isActive={state.fileManagerOpen}
        />
      )}
      
      <SidebarButton
        icon={<PublicIcon />}
        tooltip={t('ipAddressQuery')}
        onClick={handleIpAddressQueryToggle}
        isActive={state.ipAddressQueryOpen}
      />
      
      <SidebarButton
        icon={<VpnKeyIcon />}
        tooltip={t('randomPasswordGenerator')}
        onClick={handleRandomPasswordGeneratorToggle}
        isActive={state.randomPasswordGeneratorOpen}
      />
      
      <SidebarButton
        icon={<TerminalIcon />}
        tooltip={t('shortcutCommands')}
        onClick={handleShortcutCommandsToggle}
        isActive={state.shortcutCommandsOpen}
      />
      
      <SidebarButton
        icon={<HistoryIcon />}
        tooltip={t('commandHistory')}
        onClick={handleCommandHistoryToggle}
        isActive={state.commandHistoryOpen}
      />
    </Paper>
  );
});

export default SidebarManager;