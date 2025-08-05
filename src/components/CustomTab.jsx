import React, { memo, useCallback, useState } from "react";
import { Box, Typography, Tab, Menu, MenuItem, ListItemIcon, ListItemText, GlobalStyles } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import GroupRemoveIcon from "@mui/icons-material/GroupRemove";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { findGroupByTab, getGroups, addGroup, addTabToGroup, removeTabFromGroup } from '../core/syncInputGroups';

// 添加拖拽指示器动画的全局样式
const dragIndicatorStyles = (
  <GlobalStyles
    styles={{
      '@keyframes dragIndicator': {
        '0%': {
          opacity: 0.7,
          transform: 'scaleY(0.9) scaleX(0.95)',
          boxShadow: '0 0 8px rgba(46, 125, 50, 0.6)',
        },
        '50%': {
          opacity: 1,
          transform: 'scaleY(1) scaleX(1)',
          boxShadow: '0 0 24px rgba(46, 125, 50, 1.0)',
        },
        '100%': {
          opacity: 0.7,
          transform: 'scaleY(0.9) scaleX(0.95)',
          boxShadow: '0 0 8px rgba(46, 125, 50, 0.6)',
        },
      },
    }}
  />
);

// 自定义比较函数
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.label === nextProps.label &&
    prevProps.value === nextProps.value &&
    prevProps.selected === nextProps.selected &&
    prevProps.index === nextProps.index &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onContextMenu === nextProps.onContextMenu &&
    prevProps.onDragStart === nextProps.onDragStart &&
    prevProps.onDragOver === nextProps.onDragOver &&
    prevProps.onDragLeave === nextProps.onDragLeave &&
    prevProps.onDrop === nextProps.onDrop &&
    prevProps.isDraggedOver === nextProps.isDraggedOver &&
    prevProps.dragOperation === nextProps.dragOperation &&
    prevProps.dragInsertPosition === nextProps.dragInsertPosition
  );
};

// 自定义标签页组件
const CustomTab = memo((props) => {
  const {
    label,
    onClose,
    onContextMenu,
    index,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    tabId, // 新增：每个Tab需传递tabId
    isDraggedOver = false, // 新增：是否被拖拽悬停
    dragOperation = null, // 新增：拖拽操作类型 ('sort' | 'merge')
    dragInsertPosition = null, // 新增：插入位置 ('before' | 'after')
    ...other
  } = props;

  // 分组相关状态
  const group = findGroupByTab(tabId);

  // 优化关闭按钮点击处理
  const handleCloseClick = useCallback(
    (e) => {
      e.stopPropagation();
      onClose?.();
    },
    [onClose],
  );

  // 处理拖拽开始 - 支持分屏功能
  const handleDragStart = useCallback((e) => {
    // 设置拖拽数据
    const dragData = {
      type: 'tab',
      tabId: tabId,
      tabIndex: index,
      label: label
    };
    
    e.dataTransfer.setData('application/json', JSON.stringify(dragData));
    e.dataTransfer.effectAllowed = 'move';
    
    // 调用原始的拖拽开始处理
    if (onDragStart) {
      onDragStart(e);
    }
  }, [tabId, index, label, onDragStart]);

  return (
    <>
      {dragIndicatorStyles}
      <Tab
        {...other}
        onContextMenu={onContextMenu}
        draggable="true"
        onDragStart={handleDragStart}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        label={
          <Box sx={{ display: "flex", alignItems: "center", position: 'relative' }}>
            {/* 分组圆点与编号 */}
            {group && (
              <Box
                sx={{
                  width: 14, // 更紧凑
                  height: 14,
                  minWidth: 14,
                  minHeight: 14,
                  borderRadius: '50%',
                  background: group.color,
                  color: '#fff',
                  fontSize: 10, // 编号更小更精致
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mr: 1,
                  ml: 0.2,
                  border: '1.5px solid #fff',
                  boxShadow: '0 0 0 1px rgba(0,0,0,0.10)',
                  lineHeight: 1,
                  p: 0,
                  overflow: 'hidden',
                  transition: 'box-shadow 0.2s',
                }}
                title={`同步分组 ${group.groupId}`}
              >
                {group.groupId.replace('G', '')}
              </Box>
            )}
            <Typography variant="body2" component="span" sx={{ 
              mr: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "300px", // 限制最大宽度，避免标签页过长
              display: "inline-block"
            }}>
              {label}
            </Typography>
            {onClose && (
              <CloseIcon
                fontSize="small"
                sx={{
                  width: 16,
                  height: 16,
                  "&:hover": {
                    color: "error.main",
                  },
                }}
                onClick={handleCloseClick}
              />
            )}
          </Box>
        }
        sx={{
          textTransform: "none",
          minWidth: "auto",
          minHeight: 40,
          py: 0,
          cursor: isDraggedOver && dragOperation === 'sort' ? "grab" : "pointer",
          userSelect: "none",
          color: "text.secondary",
          // 拖拽悬停时的特殊样式
          ...(isDraggedOver && {
            backgroundColor: (theme) =>
              dragOperation === 'sort' 
                ? (theme.palette.mode === "dark"
                    ? "rgba(76, 175, 80, 0.12)"
                    : "rgba(46, 125, 50, 0.15)")
                : (theme.palette.mode === "dark"
                    ? "rgba(33, 150, 243, 0.15)"
                    : "rgba(25, 118, 210, 0.12)"),
            borderRadius: "4px",
            boxShadow: (theme) =>
              dragOperation === 'sort'
                ? (theme.palette.mode === "dark"
                    ? "0 0 0 2px rgba(76, 175, 80, 0.4)"
                    : "0 0 0 3px rgba(46, 125, 50, 0.5), 0 2px 8px rgba(46, 125, 50, 0.2)")
                : (theme.palette.mode === "dark"
                    ? "0 0 0 2px rgba(33, 150, 243, 0.3)"
                    : "0 0 0 3px rgba(25, 118, 210, 0.4), 0 2px 8px rgba(25, 118, 210, 0.15)"),
            position: "relative",
            transform: dragOperation === 'sort' ? 'scale(1.02)' : 'scale(1)',
            transition: 'all 0.2s ease-in-out',
            
            // 根据拖拽操作类型显示不同的指示器
            ...(dragOperation === 'merge' && {
              "&::after": {
                content: '"合并标签"',
                position: "absolute",
                top: -26,
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: (theme) => 
                  theme.palette.mode === "dark" 
                    ? "rgba(33, 150, 243, 0.95)"
                    : "rgba(25, 118, 210, 1)",
                color: "white",
                padding: "3px 8px",
                borderRadius: "6px",
                fontSize: "11px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                zIndex: 1002,
                opacity: 1,
                boxShadow: (theme) =>
                  theme.palette.mode === "dark"
                    ? "0 2px 8px rgba(0,0,0,0.2)"
                    : "0 3px 12px rgba(25, 118, 210, 0.4), 0 1px 4px rgba(0,0,0,0.2)",
                border: (theme) => 
                  theme.palette.mode === "dark" 
                    ? "1px solid rgba(255,255,255,0.1)"
                    : "1px solid rgba(25, 118, 210, 0.8)",
              }
            }),
            
            // 排序操作的插入位置指示器
            ...(dragOperation === 'sort' && dragInsertPosition === 'before' && {
              "&::before": {
                content: '""',
                position: "absolute",
                left: -5,
                top: 0,
                bottom: 0,
                width: 7,
                background: (theme) => 
                  theme.palette.mode === "dark" 
                    ? "linear-gradient(180deg, #81c784 0%, #4caf50 50%, #388e3c 100%)"
                    : "linear-gradient(180deg, #2e7d32 0%, #388e3c 50%, #1b5e20 100%)",
                borderRadius: "3px",
                zIndex: 1001,
                boxShadow: (theme) =>
                  theme.palette.mode === "dark"
                    ? "0 0 16px rgba(76, 175, 80, 0.9), inset 0 1px 0 rgba(255,255,255,0.4)"
                    : "0 0 16px rgba(46, 125, 50, 0.8), 0 0 4px rgba(27, 94, 32, 0.6), inset 0 1px 0 rgba(255,255,255,0.6)",
                animation: "dragIndicator 0.6s ease-in-out infinite alternate",
                border: (theme) => 
                  theme.palette.mode === "dark" 
                    ? "1px solid rgba(129, 199, 132, 0.3)" 
                    : "2px solid rgba(46, 125, 50, 0.7)",
              }
            }),
            
            ...(dragOperation === 'sort' && dragInsertPosition === 'after' && {
              "&::after": {
                content: '""',
                position: "absolute",
                right: -5,
                top: 0,
                bottom: 0,
                width: 7,
                background: (theme) => 
                  theme.palette.mode === "dark" 
                    ? "linear-gradient(180deg, #81c784 0%, #4caf50 50%, #388e3c 100%)"
                    : "linear-gradient(180deg, #2e7d32 0%, #388e3c 50%, #1b5e20 100%)",
                borderRadius: "3px",
                zIndex: 1001,
                boxShadow: (theme) =>
                  theme.palette.mode === "dark"
                    ? "0 0 16px rgba(76, 175, 80, 0.9), inset 0 1px 0 rgba(255,255,255,0.4)"
                    : "0 0 16px rgba(46, 125, 50, 0.8), 0 0 4px rgba(27, 94, 32, 0.6), inset 0 1px 0 rgba(255,255,255,0.6)",
                animation: "dragIndicator 0.6s ease-in-out infinite alternate",
                border: (theme) => 
                  theme.palette.mode === "dark" 
                    ? "1px solid rgba(129, 199, 132, 0.3)" 
                    : "2px solid rgba(46, 125, 50, 0.7)",
              }
            }),
          }),
          "&.Mui-selected": {
            color: "text.primary",
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.1)"
                : "rgba(245, 245, 245, 0.91)",
            borderRadius: "4px 4px 0 0",
            fontWeight: "bold",
          },
        }}
      />
    </>
  );
}, areEqual);

// 设置显示名称用于调试
CustomTab.displayName = "CustomTab";

export default CustomTab;
