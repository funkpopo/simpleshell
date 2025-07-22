import React, { useState, useCallback, useRef, memo } from 'react';
import { Box, Typography, IconButton, Paper, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { styled } from '@mui/material/styles';

// 带有拖拽放置功能的分屏面板容器
const StyledSplitPane = styled(Paper)(({ theme, isDragOver, isEmpty }) => ({
  position: 'relative',
  height: '100%',
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  backgroundColor: isEmpty 
    ? theme.palette.mode === 'dark' 
      ? 'rgba(255, 255, 255, 0.02)'
      : 'rgba(0, 0, 0, 0.02)'
    : 'transparent',
  border: isEmpty 
    ? `2px dashed ${theme.palette.divider}`
    : `1px solid ${theme.palette.divider}`,
  borderRadius: theme.spacing(1),
  overflow: 'hidden',
  transition: 'all 0.2s ease-in-out',
  
  // 拖拽悬停效果
  ...(isDragOver && isEmpty && {
    borderColor: theme.palette.primary.main,
    backgroundColor: theme.palette.mode === 'dark' 
      ? 'rgba(33, 150, 243, 0.08)'
      : 'rgba(33, 150, 243, 0.04)',
    boxShadow: `0 0 0 2px ${theme.palette.primary.main}40`
  })
}));

// 分屏面板头部
const PaneHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: theme.spacing(0.5, 1),
  backgroundColor: theme.palette.mode === 'dark' 
    ? 'rgba(255, 255, 255, 0.05)'
    : 'rgba(0, 0, 0, 0.03)',
  borderBottom: `1px solid ${theme.palette.divider}`,
  minHeight: 32
}));

// 空面板占位内容
const EmptyPaneContent = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  color: theme.palette.text.disabled,
  fontSize: '0.875rem',
  textAlign: 'center',
  padding: theme.spacing(2)
}));

const SplitPane = memo(({ 
  paneId,
  position,
  tabId,
  tabIndex,
  tab,
  terminalInstance,
  onTabDrop,
  onRemoveTab,
  onTabClick,
  renderTabContent
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const dropZoneRef = useRef(null);
  const dragCounterRef = useRef(0);

  const isEmpty = !tabId || !tab;

  // 处理拖拽进入
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 使用计数器来正确处理嵌套元素的拖拽事件
    dragCounterRef.current += 1;
    
    if (isEmpty) {
      setIsDragOver(true);
    }
  }, [isEmpty]);

  // 处理拖拽离开
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    dragCounterRef.current -= 1;
    
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  // 处理拖拽悬停
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // 设置拖拽效果
    e.dataTransfer.dropEffect = isEmpty ? 'move' : 'none';
  }, [isEmpty]);

  // 处理放置
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    
    setIsDragOver(false);
    dragCounterRef.current = 0;
    
    if (isEmpty) {
      try {
        const dragData = JSON.parse(e.dataTransfer.getData('application/json'));
        if (dragData.type === 'tab' && typeof dragData.tabIndex === 'number') {
          onTabDrop?.(paneId, dragData.tabIndex);
        }
      } catch (error) {
        console.warn('Failed to parse drag data:', error);
      }
    }
  }, [isEmpty, paneId, onTabDrop]);

  // 移除当前标签页
  const handleRemoveTab = useCallback(() => {
    onRemoveTab?.(paneId);
  }, [paneId, onRemoveTab]);

  // 在新窗口中打开
  const handleOpenInNew = useCallback(() => {
    if (tabIndex !== null && onTabClick) {
      onTabClick(tabIndex);
    }
  }, [tabIndex, onTabClick]);

  // 获取位置显示名称
  const getPositionLabel = useCallback(() => {
    switch (position) {
      case 'top-left':
        return '左上';
      case 'top-right':
        return '右上';
      case 'bottom-left':
        return '左下';
      case 'bottom-right':
        return '右下';
      default:
        return '分屏';
    }
  }, [position]);

  return (
    <StyledSplitPane
      ref={dropZoneRef}
      isDragOver={isDragOver}
      isEmpty={isEmpty}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      elevation={isEmpty ? 0 : 1}
    >
      {isEmpty ? (
        // 空面板
        <EmptyPaneContent>
          <OpenInNewIcon sx={{ fontSize: 48, mb: 1, opacity: 0.3 }} />
          <Typography variant="body2" sx={{ mb: 0.5 }}>
            {getPositionLabel()}面板
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.7 }}>
            将标签页拖拽到此处
          </Typography>
        </EmptyPaneContent>
      ) : (
        // 有内容的面板
        <>
          <PaneHeader>
            <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: '0.75rem' }}>
              {tab?.label || '未知标签'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title="在主窗口打开">
                <IconButton
                  size="small"
                  onClick={handleOpenInNew}
                  sx={{ 
                    p: 0.25,
                    '&:hover': {
                      backgroundColor: 'action.hover'
                    }
                  }}
                >
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="关闭分屏">
                <IconButton
                  size="small"
                  onClick={handleRemoveTab}
                  sx={{ 
                    p: 0.25,
                    '&:hover': {
                      backgroundColor: 'error.main',
                      color: 'error.contrastText'
                    }
                  }}
                >
                  <CloseIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </PaneHeader>
          
          {/* 标签页内容 */}
          <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {renderTabContent && tabIndex !== null && renderTabContent(tabIndex)}
          </Box>
        </>
      )}
    </StyledSplitPane>
  );
});

SplitPane.displayName = 'SplitPane';

export default SplitPane;