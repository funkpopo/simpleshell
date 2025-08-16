import React, { memo, useCallback, useMemo } from 'react';
import Tabs from '@mui/material/Tabs';
import CustomTab from './CustomTab.jsx';
import { 
  findGroupByTab, 
  getGroups, 
  addGroup, 
  addTabToGroup, 
  removeTabFromGroup 
} from '../core/syncInputGroups';

const TabManager = memo(function TabManager({
  state,
  dispatch,
  actions,
  onTabChange,
  onTabClose,
  onTabContextMenu,
  onTabMerge,
  onTabSplit,
  onTabDrop,
  activeSidebarMargin
}) {
  // Handle tab drag start
  const handleTabDragStart = useCallback((e, index) => {
    dispatch(actions.setDraggedTab(index));
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index);
  }, [dispatch, actions]);

  // Handle tab drag over
  const handleTabDragOver = useCallback((e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (state.draggedTabIndex === null || state.draggedTabIndex === index) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const width = rect.width;
    const threshold = width * 0.3;
    
    let operation = 'merge';
    let insertPosition = null;
    
    if (x < threshold) {
      operation = 'sort';
      insertPosition = 'before';
    } else if (x > width - threshold) {
      operation = 'sort';
      insertPosition = 'after';
    }
    
    dispatch(actions.setDragOverTab(index));
    dispatch(actions.setDragOperation(operation));
    dispatch(actions.setDragInsertPosition(insertPosition));
  }, [state.draggedTabIndex, dispatch, actions]);

  // Handle tab drag leave
  const handleTabDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      dispatch(actions.setDragOverTab(null));
      dispatch(actions.setDragOperation(null));
      dispatch(actions.setDragInsertPosition(null));
    }
  }, [dispatch, actions]);

  // Handle tab drop
  const handleTabDrop = useCallback((e, targetIndex) => {
    e.preventDefault();
    
    const sourceIndex = state.draggedTabIndex;
    
    if (sourceIndex === null || sourceIndex === targetIndex) {
      dispatch(actions.resetDragState());
      return;
    }

    if (state.dragOperation === 'merge') {
      // Merge tabs
      onTabMerge?.(sourceIndex, targetIndex);
    } else if (state.dragOperation === 'sort') {
      // Reorder tabs
      const newTabs = [...state.tabs];
      const [removed] = newTabs.splice(sourceIndex, 1);
      
      let insertIndex = targetIndex;
      if (state.dragInsertPosition === 'after' && sourceIndex > targetIndex) {
        insertIndex += 1;
      } else if (state.dragInsertPosition === 'before' && sourceIndex < targetIndex) {
        insertIndex -= 1;
      }
      
      newTabs.splice(insertIndex, 0, removed);
      dispatch(actions.setTabs(newTabs));
      
      // Adjust current tab index
      if (state.currentTab === sourceIndex) {
        dispatch(actions.setCurrentTab(insertIndex));
      } else if (sourceIndex < state.currentTab && insertIndex >= state.currentTab) {
        dispatch(actions.setCurrentTab(state.currentTab - 1));
      } else if (sourceIndex > state.currentTab && insertIndex <= state.currentTab) {
        dispatch(actions.setCurrentTab(state.currentTab + 1));
      }
    }
    
    dispatch(actions.resetDragState());
    onTabDrop?.();
  }, [state, dispatch, actions, onTabMerge, onTabDrop]);

  // Handle tab drag end
  const handleTabDragEnd = useCallback(() => {
    dispatch(actions.resetDragState());
  }, [dispatch, actions]);

  // Handle tab change
  const handleTabChange = useCallback((event, newValue) => {
    dispatch(actions.setCurrentTab(newValue));
    onTabChange?.(newValue);
  }, [dispatch, actions, onTabChange]);

  // Handle tab close
  const handleTabClose = useCallback((index) => {
    onTabClose?.(index);
  }, [onTabClose]);

  // Handle tab context menu
  const handleTabContextMenu = useCallback((event, index) => {
    event.preventDefault();
    dispatch(actions.setTabContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
      tabIndex: index,
    }));
    onTabContextMenu?.(event, index);
  }, [dispatch, actions, onTabContextMenu]);

  // Get tab color based on group
  const getTabColor = useCallback((tab) => {
    const group = findGroupByTab(tab.id);
    if (group) {
      const groups = getGroups();
      const groupIndex = groups.indexOf(group);
      const colors = ['#ff6b6b', '#4ecdc4', '#45b7d1', '#f9ca24', '#f0932b', '#eb4d4b'];
      return colors[groupIndex % colors.length];
    }
    return null;
  }, []);

  // Check if tab is merged
  const isTabMerged = useCallback((tabId) => {
    return state.mergedTabs[tabId] && state.mergedTabs[tabId].length > 0;
  }, [state.mergedTabs]);

  return (
    <Tabs
      value={state.currentTab}
      onChange={handleTabChange}
      variant="scrollable"
      scrollButtons="auto"
      sx={{
        flexGrow: 1,
        minHeight: 48,
        '& .MuiTabs-scrollButtons': {
          color: 'text.secondary',
        },
        '& .MuiTabs-indicator': {
          display: 'none',
        },
        ml: `${activeSidebarMargin + 56}px`,
        transition: 'margin-left 0.3s ease',
      }}
    >
      {state.tabs.map((tab, index) => (
        <CustomTab
          key={tab.id}
          tab={tab}
          index={index}
          isActive={state.currentTab === index}
          isMerged={isTabMerged(tab.id)}
          isDragging={state.draggedTabIndex === index}
          isDragOver={state.dragOverTabIndex === index}
          dragOperation={state.dragOverTabIndex === index ? state.dragOperation : null}
          dragInsertPosition={state.dragOverTabIndex === index ? state.dragInsertPosition : null}
          color={getTabColor(tab)}
          onClose={() => handleTabClose(index)}
          onContextMenu={(e) => handleTabContextMenu(e, index)}
          onDragStart={(e) => handleTabDragStart(e, index)}
          onDragOver={(e) => handleTabDragOver(e, index)}
          onDragLeave={handleTabDragLeave}
          onDrop={(e) => handleTabDrop(e, index)}
          onDragEnd={handleTabDragEnd}
          onSplit={() => onTabSplit?.(tab.id)}
        />
      ))}
    </Tabs>
  );
});

export default TabManager;