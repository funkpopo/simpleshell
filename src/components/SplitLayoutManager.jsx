import React, { useState, useCallback, memo, useRef, useImperativeHandle, forwardRef } from 'react';
import { Box } from '@mui/material';
import SplitPane from './SplitPane.jsx';

// 分屏布局类型
export const LAYOUT_TYPES = {
  SINGLE: 'single',
  DUAL_HORIZONTAL: 'dual-horizontal',  // 左右分屏
  DUAL_VERTICAL: 'dual-vertical',      // 上下分屏
  QUAD: 'quad'                         // 四分屏
};

// 分屏位置定义
export const PANE_POSITIONS = {
  TOP_LEFT: 'top-left',
  TOP_RIGHT: 'top-right',
  BOTTOM_LEFT: 'bottom-left',
  BOTTOM_RIGHT: 'bottom-right'
};

const SplitLayoutManager = memo(forwardRef(({ 
  tabs = [],
  currentTab = 0,
  terminalInstances = {},
  onTabChange,
  renderTabContent
}, ref) => {
  // 分屏状态管理
  const [splitState, setSplitState] = useState({
    isEnabled: false,
    layout: LAYOUT_TYPES.SINGLE,
    panes: [
      { id: '1', position: PANE_POSITIONS.TOP_LEFT, tabId: null, tabIndex: null },
      { id: '2', position: PANE_POSITIONS.TOP_RIGHT, tabId: null, tabIndex: null },
      { id: '3', position: PANE_POSITIONS.BOTTOM_LEFT, tabId: null, tabIndex: null },
      { id: '4', position: PANE_POSITIONS.BOTTOM_RIGHT, tabId: null, tabIndex: null }
    ]
  });

  // 拖拽状态
  const [dragState, setDragState] = useState({
    isDragging: false,
    draggedTabIndex: null,
    dropTarget: null
  });

  const layoutRef = useRef(null);

  // 启用分屏模式
  const enableSplitLayout = useCallback((layout = LAYOUT_TYPES.DUAL_HORIZONTAL, primaryTabIndex = currentTab, secondaryTabIndex = null) => {
    if (!tabs[primaryTabIndex]) return;

    const newPanes = [...splitState.panes];
    
    // 设置主分屏
    newPanes[0] = {
      ...newPanes[0],
      tabId: tabs[primaryTabIndex].id,
      tabIndex: primaryTabIndex
    };

    if (layout !== LAYOUT_TYPES.SINGLE && secondaryTabIndex !== null && tabs[secondaryTabIndex]) {
      // 设置副分屏
      const secondaryPaneIndex = layout === LAYOUT_TYPES.DUAL_HORIZONTAL ? 1 : 
                                layout === LAYOUT_TYPES.DUAL_VERTICAL ? 2 : 1;
      newPanes[secondaryPaneIndex] = {
        ...newPanes[secondaryPaneIndex],
        tabId: tabs[secondaryTabIndex].id,
        tabIndex: secondaryTabIndex
      };
    }

    setSplitState({
      isEnabled: true,
      layout,
      panes: newPanes
    });
  }, [splitState.panes, tabs, currentTab]);

  // 禁用分屏模式
  const disableSplitLayout = useCallback(() => {
    setSplitState({
      isEnabled: false,
      layout: LAYOUT_TYPES.SINGLE,
      panes: splitState.panes.map(pane => ({
        ...pane,
        tabId: null,
        tabIndex: null
      }))
    });
  }, [splitState.panes]);

  // 处理标签页拖拽到分屏区域
  const handleTabDropToPane = useCallback((paneId, tabIndex) => {
    if (!tabs[tabIndex]) return;

    const newPanes = splitState.panes.map(pane => {
      if (pane.id === paneId) {
        return {
          ...pane,
          tabId: tabs[tabIndex].id,
          tabIndex: tabIndex
        };
      }
      return pane;
    });

    setSplitState(prev => ({
      ...prev,
      panes: newPanes
    }));
  }, [splitState.panes, tabs]);

  // 移除分屏中的标签页
  const removeTabFromPane = useCallback((paneId) => {
    const newPanes = splitState.panes.map(pane => {
      if (pane.id === paneId) {
        return {
          ...pane,
          tabId: null,
          tabIndex: null
        };
      }
      return pane;
    });

    setSplitState(prev => ({
      ...prev,
      panes: newPanes
    }));

    // 如果所有分屏都为空，退出分屏模式
    const activePanes = newPanes.filter(pane => pane.tabId !== null);
    if (activePanes.length <= 1) {
      disableSplitLayout();
    }
  }, [splitState.panes, disableSplitLayout]);

  // 获取布局样式
  const getLayoutStyles = useCallback(() => {
    if (!splitState.isEnabled) {
      return {
        display: 'block',
        width: '100%',
        height: '100%'
      };
    }

    const baseStyle = {
      display: 'grid',
      width: '100%',
      height: '100%',
      gap: '2px',
      backgroundColor: 'divider'
    };

    switch (splitState.layout) {
      case LAYOUT_TYPES.DUAL_HORIZONTAL:
        return {
          ...baseStyle,
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr'
        };
      case LAYOUT_TYPES.DUAL_VERTICAL:
        return {
          ...baseStyle,
          gridTemplateColumns: '1fr',
          gridTemplateRows: '1fr 1fr'
        };
      case LAYOUT_TYPES.QUAD:
        return {
          ...baseStyle,
          gridTemplateColumns: '1fr 1fr',
          gridTemplateRows: '1fr 1fr'
        };
      default:
        return baseStyle;
    }
  }, [splitState.isEnabled, splitState.layout]);

  // 获取需要渲染的分屏
  const getActivePanes = useCallback(() => {
    if (!splitState.isEnabled) {
      return [];
    }

    switch (splitState.layout) {
      case LAYOUT_TYPES.DUAL_HORIZONTAL:
        return splitState.panes.filter(pane => 
          pane.position === PANE_POSITIONS.TOP_LEFT || 
          pane.position === PANE_POSITIONS.TOP_RIGHT
        );
      case LAYOUT_TYPES.DUAL_VERTICAL:
        return splitState.panes.filter(pane => 
          pane.position === PANE_POSITIONS.TOP_LEFT || 
          pane.position === PANE_POSITIONS.BOTTOM_LEFT
        );
      case LAYOUT_TYPES.QUAD:
        return splitState.panes;
      default:
        return [];
    }
  }, [splitState.isEnabled, splitState.layout, splitState.panes]);

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    enableSplitLayout,
    disableSplitLayout,
    handleTabDropToPane,
    removeTabFromPane,
    getSplitState: () => splitState
  }), [enableSplitLayout, disableSplitLayout, handleTabDropToPane, removeTabFromPane, splitState]);

  // 如果不是分屏模式，渲染原始内容
  if (!splitState.isEnabled) {
    return (
      <Box sx={{ width: '100%', height: '100%' }}>
        {renderTabContent && renderTabContent(currentTab)}
      </Box>
    );
  }

  // 渲染分屏布局
  const activePanes = getActivePanes();

  return (
    <Box
      ref={layoutRef}
      sx={getLayoutStyles()}
    >
      {activePanes.map((pane) => (
        <SplitPane
          key={pane.id}
          paneId={pane.id}
          position={pane.position}
          tabId={pane.tabId}
          tabIndex={pane.tabIndex}
          tab={pane.tabIndex !== null ? tabs[pane.tabIndex] : null}
          terminalInstance={pane.tabId ? terminalInstances[pane.tabId] : null}
          onTabDrop={handleTabDropToPane}
          onRemoveTab={removeTabFromPane}
          onTabClick={onTabChange}
          renderTabContent={renderTabContent}
        />
      ))}
    </Box>
  );
}));

SplitLayoutManager.displayName = 'SplitLayoutManager';

export default SplitLayoutManager;