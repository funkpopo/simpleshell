import React, { memo, useState, useEffect } from 'react';
import { Box, Paper, Typography, IconButton, Divider } from '@mui/material';
import { styled } from '@mui/material/styles';
import WebTerminal from './WebTerminal.jsx';

// 分屏容器样式
const SplitContainer = styled(Box)(({ theme, splitCount }) => {
  // 三标签特殊布局：上方两个终端，下方一个终端
  if (splitCount === 3) {
    return {
      display: 'grid',
      width: '100%',
      height: '100%',
      gap: '2px',
      backgroundColor: theme.palette.divider,
      gridTemplateColumns: '1fr 1fr',
      gridTemplateRows: '1fr 1fr',
      gridTemplateAreas: `
        "top-left top-right"
        "bottom bottom"
      `
    };
  }
  
  // 其他情况保持原有布局
  return {
    display: 'grid',
    width: '100%',
    height: '100%',
    gap: '2px',
    backgroundColor: theme.palette.divider,
    gridTemplateColumns: splitCount <= 2 ? (splitCount === 1 ? '1fr' : '1fr 1fr') : '1fr 1fr',
    gridTemplateRows: splitCount <= 2 ? '1fr' : '1fr 1fr'
  };
});

// 单个分屏面板样式
const SplitPane = styled(Paper)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  backgroundColor: theme.palette.background.paper,
  border: `1px solid ${theme.palette.divider}`,
}));

// 分屏头部
const SplitHeader = styled(Box)(({ theme }) => ({
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

const MergedTabContent = memo(({ 
  mergedTabs, 
  terminalInstances,
  currentTabId 
}) => {
  // 添加布局更新状态，用于触发终端适配
  const [layoutUpdateKey, setLayoutUpdateKey] = useState(0);
  
  // 监听分屏布局变化事件，进行布局调整而不是重新创建终端
  useEffect(() => {
    const handleSplitLayoutChanged = (event) => {
      const { type, targetTabId, mainTabId, splitTabs, timestamp } = event.detail || {};
      
      // 检查是否与当前标签相关
      const isRelated = targetTabId === currentTabId || mainTabId === currentTabId ||
        (splitTabs && splitTabs.some(tab => tab.id === currentTabId));
      
      if (isRelated) {
        // 触发布局更新，但不强制重新创建终端
        setLayoutUpdateKey(prev => prev + 1);
        
        // 延迟触发resize事件，确保DOM布局已更新
        setTimeout(() => {
          window.dispatchEvent(new Event("resize"));
          
          // 如果是分屏操作，需要通知所有相关终端进行尺寸适配
          if (mergedTabs && mergedTabs.length > 0) {
            mergedTabs.forEach(tab => {
              if (tab && tab.id) {
                // 触发特定于标签的resize事件
                window.dispatchEvent(
                  new CustomEvent("terminalResize", {
                    detail: { 
                      tabId: tab.id, 
                      layoutType: type,
                      timestamp: timestamp 
                    },
                  }),
                );
              }
            });
          }
          
          // 如果是拆分操作，额外触发强制刷新
          if (type === "split" && splitTabs) {
            splitTabs.forEach(tab => {
              if (tab && tab.id) {
                window.dispatchEvent(
                  new CustomEvent("tabChanged", {
                    detail: { 
                      tabId: tab.id, 
                      forceRefresh: true,
                      timestamp: timestamp
                    },
                  }),
                );
              }
            });
          }
        }, 100);
      }
    };

    window.addEventListener("splitLayoutChanged", handleSplitLayoutChanged);
    return () => window.removeEventListener("splitLayoutChanged", handleSplitLayoutChanged);
  }, [currentTabId, mergedTabs]);

  // 当合并状态改变时，仅进行布局调整
  useEffect(() => {
    if (mergedTabs && mergedTabs.length > 1) {
      // 延迟触发布局调整，确保DOM已经更新
      const timer = setTimeout(() => {
        setLayoutUpdateKey(prev => prev + 1);
        
        // 触发resize事件通知终端进行尺寸适配
        window.dispatchEvent(new Event("resize"));
        
        // 为每个标签触发特定的resize事件
        mergedTabs.forEach(tab => {
          if (tab && tab.id) {
            window.dispatchEvent(
              new CustomEvent("terminalResize", {
                detail: { 
                  tabId: tab.id, 
                  layoutType: "layout-change",
                  timestamp: Date.now() 
                },
              }),
            );
          }
        });
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [mergedTabs]);

  if (!mergedTabs || mergedTabs.length <= 1) {
    // 单个标签页，直接渲染
    const tab = mergedTabs?.[0] || null;
    if (!tab || !terminalInstances[tab.id]) return null;
    
    return (
      <WebTerminal
        key={`${tab.id}-single`} // 使用稳定的key，避免重新创建
        tabId={tab.id}
        refreshKey={terminalInstances[`${tab.id}-refresh`]}
        usePowershell={
          tab.type !== "ssh" && terminalInstances.usePowershell
        }
        sshConfig={
          tab.type === "ssh"
            ? terminalInstances[`${tab.id}-config`]
            : null
        }
        isActive={true}
      />
    );
  }

  // 多个标签页，显示分屏
  const validTabs = mergedTabs.filter(tab => tab && terminalInstances[tab.id]);
  
  return (
    <SplitContainer splitCount={validTabs.length}>
      {validTabs.map((tab, index) => {
        // 三标签特殊布局处理
        if (validTabs.length === 3) {
          let gridArea;
          switch (index) {
            case 0:
              gridArea = 'top-left';
              break;
            case 1:
              gridArea = 'top-right';
              break;
            case 2:
              gridArea = 'bottom';
              break;
            default:
              gridArea = '';
          }
          
          return (
            <SplitPane 
              key={`${tab.id}-split`} 
              elevation={1}
              sx={{ 
                gridArea: gridArea,
                ...(index === 2 && { gridColumn: '1 / -1' }) // 下方终端填满宽度
              }}
            >
              <SplitHeader>
                <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: '0.75rem' }}>
                  {tab.label}
                </Typography>
              </SplitHeader>
              
              <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <WebTerminal
                  key={`${tab.id}-multi`} // 使用稳定的key，避免重新创建
                  tabId={tab.id}
                  refreshKey={terminalInstances[`${tab.id}-refresh`] || layoutUpdateKey}
                  usePowershell={
                    tab.type !== "ssh" && terminalInstances.usePowershell
                  }
                  sshConfig={
                    tab.type === "ssh"
                      ? terminalInstances[`${tab.id}-config`]
                      : null
                  }
                  isActive={true}
                />
              </Box>
            </SplitPane>
          );
        }
        
        // 其他情况保持原有渲染逻辑
        return (
          <SplitPane key={`${tab.id}-split`} elevation={1}> {/* 使用稳定的key */}
            <SplitHeader>
              <Typography variant="body2" noWrap sx={{ flex: 1, fontSize: '0.75rem' }}>
                {tab.label}
              </Typography>
            </SplitHeader>
            
            <Box sx={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
              <WebTerminal
                key={`${tab.id}-multi`} // 使用稳定的key，避免重新创建
                tabId={tab.id}
                refreshKey={terminalInstances[`${tab.id}-refresh`] || layoutUpdateKey}
                usePowershell={
                  tab.type !== "ssh" && terminalInstances.usePowershell
                }
                sshConfig={
                  tab.type === "ssh"
                    ? terminalInstances[`${tab.id}-config`]
                    : null
                }
                isActive={true}
              />
            </Box>
          </SplitPane>
        );
      })}
    </SplitContainer>
  );
});

MergedTabContent.displayName = 'MergedTabContent';

export default MergedTabContent;