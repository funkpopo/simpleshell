import React, { memo, useCallback, useState } from "react";
import { Box, Typography, Tab, Menu, MenuItem, ListItemIcon, ListItemText } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import GroupRemoveIcon from "@mui/icons-material/GroupRemove";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import { findGroupByTab, getGroups, addGroup, addTabToGroup, removeTabFromGroup } from '../core/syncInputGroups';

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
    prevProps.onDrop === nextProps.onDrop &&
    prevProps.isDraggedOver === nextProps.isDraggedOver
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
    onDrop,
    tabId, // 新增：每个Tab需传递tabId
    isDraggedOver = false, // 新增：是否被拖拽悬停
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
      <Tab
        {...other}
        onContextMenu={onContextMenu}
        draggable="true"
        onDragStart={handleDragStart}
        onDragOver={onDragOver}
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
            <Typography variant="body2" component="span" sx={{ mr: 1 }}>
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
          cursor: "pointer",
          userSelect: "none",
          color: "text.secondary",
          // 拖拽悬停时的特殊样式
          ...(isDraggedOver && {
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(33, 150, 243, 0.15)"
                : "rgba(33, 150, 243, 0.08)",
            borderRadius: "4px",
            boxShadow: (theme) =>
              theme.palette.mode === "dark"
                ? "0 0 0 2px rgba(33, 150, 243, 0.3)"
                : "0 0 0 2px rgba(33, 150, 243, 0.2)",
            position: "relative",
            "&::after": isDraggedOver ? {
              content: '"合并标签"',
              position: "absolute",
              top: -24,
              left: "50%",
              transform: "translateX(-50%)",
              backgroundColor: "primary.main",
              color: "primary.contrastText",
              padding: "2px 6px",
              borderRadius: "4px",
              fontSize: "10px",
              whiteSpace: "nowrap",
              zIndex: 1000,
              opacity: 0.9,
            } : {}
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
