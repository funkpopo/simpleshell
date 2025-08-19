import React, { memo, useCallback, useState } from "react";
import {
  Box,
  Typography,
  Tab,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  GlobalStyles,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import GroupAddIcon from "@mui/icons-material/GroupAdd";
import GroupRemoveIcon from "@mui/icons-material/GroupRemove";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import {
  findGroupByTab,
  getGroups,
  addGroup,
  addTabToGroup,
  removeTabFromGroup,
} from "../core/syncInputGroups";

// 添加拖拽指示器动画和磁吸效果的全局样式
const dragIndicatorStyles = (
  <GlobalStyles
    styles={{
      "@keyframes dragIndicator": {
        "0%": {
          opacity: 0.7,
          transform: "scaleY(0.9) scaleX(0.95)",
          boxShadow: "0 0 8px rgba(46, 125, 50, 0.6)",
        },
        "50%": {
          opacity: 1,
          transform: "scaleY(1) scaleX(1)",
          boxShadow: "0 0 24px rgba(46, 125, 50, 1.0)",
        },
        "100%": {
          opacity: 0.7,
          transform: "scaleY(0.9) scaleX(0.95)",
          boxShadow: "0 0 8px rgba(46, 125, 50, 0.6)",
        },
      },
      "@keyframes magneticPull": {
        "0%": {
          transform: "scale(1) translateY(0)",
        },
        "50%": {
          transform: "scale(1.02) translateY(-1px)",
        },
        "100%": {
          transform: "scale(1.05) translateY(-2px)",
        },
      },
      "@keyframes magneticGlow": {
        "0%": {
          boxShadow: "0 0 0 rgba(25, 118, 210, 0)",
        },
        "100%": {
          boxShadow:
            "0 0 20px rgba(25, 118, 210, 0.6), 0 0 40px rgba(25, 118, 210, 0.4)",
        },
      },
      "@keyframes dragEnter": {
        "0%": {
          transform: "scale(1) rotate(0deg)",
          filter: "brightness(1)",
        },
        "50%": {
          transform: "scale(1.08) rotate(1deg)",
          filter: "brightness(1.1)",
        },
        "100%": {
          transform: "scale(1.05) rotate(0deg)",
          filter: "brightness(1.05)",
        },
      },
      "@keyframes dragLeave": {
        "0%": {
          transform: "scale(1.05)",
          filter: "brightness(1.05)",
        },
        "100%": {
          transform: "scale(1)",
          filter: "brightness(1)",
        },
      },
      "@keyframes dropZonePulse": {
        "0%, 100%": {
          boxShadow: "0 0 0 0 rgba(46, 125, 50, 0.7)",
        },
        "50%": {
          boxShadow: "0 0 0 6px rgba(46, 125, 50, 0)",
        },
      },
      "@keyframes mergeZonePulse": {
        "0%, 100%": {
          boxShadow: "0 0 0 0 rgba(25, 118, 210, 0.7)",
        },
        "50%": {
          boxShadow: "0 0 0 6px rgba(25, 118, 210, 0)",
        },
      },
      "@keyframes slideIn": {
        "0%": {
          opacity: 0,
          transform: "translateY(-10px) scale(0.9)",
        },
        "100%": {
          opacity: 1,
          transform: "translateY(0) scale(1)",
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
  const handleCloseClick = (e) => {
    e.stopPropagation();
    onClose?.();
  };

  // 处理拖拽开始 - 支持分屏功能和幽灵元素预览
  const handleDragStart = useCallback(
    (e) => {
      // 先调用父组件的拖拽开始处理
      if (onDragStart) {
        onDragStart(e);
      }

      // 设置拖拽数据
      const dragData = {
        type: "tab",
        tabId: tabId,
        tabIndex: index,
        label: label,
      };

      e.dataTransfer.setData("application/json", JSON.stringify(dragData));
      e.dataTransfer.effectAllowed = "move";

      // 创建幽灵元素预览
      const createDragPreview = () => {
        const preview = document.createElement("div");
        preview.style.cssText = `
        padding: 10px 18px;
        background: linear-gradient(135deg, 
          rgba(25, 118, 210, 0.95) 0%, 
          rgba(21, 101, 192, 0.95) 30%, 
          rgba(13, 71, 161, 0.95) 70%,
          rgba(25, 118, 210, 0.95) 100%);
        color: white;
        border-radius: 12px;
        font-family: 'Roboto', 'Arial', sans-serif;
        font-size: 14px;
        font-weight: 600;
        box-shadow: 0 12px 40px rgba(25, 118, 210, 0.5), 
                    0 4px 16px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.2);
        border: 2px solid rgba(255, 255, 255, 0.3);
        backdrop-filter: blur(20px);
        transform: rotate(-3deg) scale(1.05);
        white-space: nowrap;
        pointer-events: none;
        z-index: 10000;
        position: absolute;
        left: -2000px;
        top: -2000px;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
        letter-spacing: 0.5px;
        animation: dragPreviewPulse 0.8s ease-in-out infinite alternate;
      `;
        
        // 创建图标元素
        const icon = document.createElement("span");
        icon.style.cssText = `
          display: inline-block;
          margin-right: 8px;
          font-size: 16px;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
        `;
        icon.textContent = "🏷️";
        
        // 创建文本元素
        const text = document.createElement("span");
        text.textContent = label;
        
        preview.appendChild(icon);
        preview.appendChild(text);
        
        // 添加拖拽预览脉冲动画
        const style = document.createElement("style");
        style.textContent = `
          @keyframes dragPreviewPulse {
            0% { 
              box-shadow: 0 12px 40px rgba(25, 118, 210, 0.5), 
                         0 4px 16px rgba(0, 0, 0, 0.3),
                         inset 0 1px 0 rgba(255, 255, 255, 0.2);
            }
            100% { 
              box-shadow: 0 16px 48px rgba(25, 118, 210, 0.7), 
                         0 6px 20px rgba(0, 0, 0, 0.4),
                         inset 0 1px 0 rgba(255, 255, 255, 0.3);
            }
          }
        `;
        document.head.appendChild(style);
        document.body.appendChild(preview);

        // 设置拖拽预览图像
        e.dataTransfer.setDragImage(
          preview,
          preview.offsetWidth / 2,
          preview.offsetHeight / 2,
        );

        // 延迟移除预览元素和样式，给浏览器时间捕获它
        setTimeout(() => {
          if (document.body.contains(preview)) {
            document.body.removeChild(preview);
          }
          if (document.head.contains(style)) {
            document.head.removeChild(style);
          }
        }, 100);
      };

      // 使用requestAnimationFrame确保在下一帧创建预览
      requestAnimationFrame(createDragPreview);
    },
    [tabId, index, label, onDragStart],
  );

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
          <Box
            sx={{ display: "flex", alignItems: "center", position: "relative" }}
          >
            {/* 分组圆点与编号 */}
            {group && (
              <Box
                sx={{
                  width: 14, // 更紧凑
                  height: 14,
                  minWidth: 14,
                  minHeight: 14,
                  borderRadius: "50%",
                  background: group.color,
                  color: "#fff",
                  fontSize: 10, // 编号更小更精致
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  mr: 1,
                  ml: 0.2,
                  border: "1.5px solid #fff",
                  boxShadow: "0 0 0 1px rgba(0,0,0,0.10)",
                  lineHeight: 1,
                  p: 0,
                  overflow: "hidden",
                  transition: "box-shadow 0.2s",
                }}
                title={`同步分组 ${group.groupId}`}
              >
                {group.groupId.replace("G", "")}
              </Box>
            )}
            <Typography
              variant="body2"
              component="span"
              sx={{
                mr: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "300px", // 限制最大宽度，避免标签页过长
                display: "inline-block",
              }}
            >
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
          cursor:
            isDraggedOver && dragOperation === "sort" ? "grab" : "pointer",
          userSelect: "none",
          color: "text.secondary",
          // 拖拽悬停时的特殊样式，添加磁吸效果和增强的动画
          ...(isDraggedOver && {
            backgroundColor: (theme) =>
              dragOperation === "sort"
                ? theme.palette.mode === "dark"
                  ? "rgba(76, 175, 80, 0.12)"
                  : "rgba(46, 125, 50, 0.15)"
                : theme.palette.mode === "dark"
                  ? "rgba(33, 150, 243, 0.15)"
                  : "rgba(25, 118, 210, 0.12)",
            borderRadius: "6px",
            boxShadow: (theme) =>
              dragOperation === "sort"
                ? theme.palette.mode === "dark"
                  ? "0 0 0 2px rgba(76, 175, 80, 0.4), 0 4px 16px rgba(76, 175, 80, 0.2)"
                  : "0 0 0 3px rgba(46, 125, 50, 0.5), 0 4px 20px rgba(46, 125, 50, 0.3), 0 0 0 6px rgba(46, 125, 50, 0.1)"
                : theme.palette.mode === "dark"
                  ? "0 0 0 2px rgba(33, 150, 243, 0.4), 0 4px 16px rgba(33, 150, 243, 0.2)"
                  : "0 0 0 3px rgba(25, 118, 210, 0.5), 0 4px 20px rgba(25, 118, 210, 0.3), 0 0 0 6px rgba(25, 118, 210, 0.1)",
            position: "relative",
            transform: dragOperation === "sort" ? "scale(1.03) translateY(-1px)" : "scale(1.02)",
            transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
            filter: "brightness(1.05) saturate(1.1)",

            // 增强的磁吸效果动画
            animation:
              dragOperation === "merge"
                ? "dragEnter 0.4s ease-out forwards, magneticGlow 0.4s ease-out forwards, mergeZonePulse 1.5s ease-in-out infinite"
                : dragOperation === "sort"
                  ? "dragEnter 0.3s ease-out forwards, dropZonePulse 1.2s ease-in-out infinite"
                  : "dragEnter 0.2s ease-out forwards",

            // 根据拖拽操作类型显示不同的指示器
            ...(dragOperation === "merge" && {
              "&::before": {
                content: '""',
                position: "absolute",
                top: -8,
                left: -8,
                right: -8,
                bottom: -8,
                background: (theme) =>
                  theme.palette.mode === "dark"
                    ? "linear-gradient(45deg, rgba(33, 150, 243, 0.1), rgba(33, 150, 243, 0.2))"
                    : "linear-gradient(45deg, rgba(25, 118, 210, 0.1), rgba(25, 118, 210, 0.15))",
                borderRadius: "10px",
                zIndex: -1,
                animation: "slideIn 0.3s ease-out forwards",
              },
              "&::after": {
                content: '"🔗 合并标签"',
                position: "absolute",
                top: -32,
                left: "50%",
                transform: "translateX(-50%)",
                backgroundColor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(33, 150, 243, 0.98)"
                    : "rgba(25, 118, 210, 1)",
                color: "white",
                padding: "4px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 700,
                whiteSpace: "nowrap",
                zIndex: 1003,
                opacity: 1,
                boxShadow: (theme) =>
                  theme.palette.mode === "dark"
                    ? "0 4px 16px rgba(0,0,0,0.3), 0 1px 4px rgba(33, 150, 243, 0.4)"
                    : "0 6px 20px rgba(25, 118, 210, 0.5), 0 2px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.2)",
                border: (theme) =>
                  theme.palette.mode === "dark"
                    ? "1px solid rgba(255,255,255,0.15)"
                    : "1px solid rgba(25, 118, 210, 0.9)",
                animation: "slideIn 0.3s ease-out 0.1s both",
                textShadow: "0 1px 2px rgba(0,0,0,0.3)",
              },
            }),

            // 排序操作的插入位置指示器 - 增强版本
            ...(dragOperation === "sort" &&
              dragInsertPosition === "before" && {
                "&::before": {
                  content: '""',
                  position: "absolute",
                  left: -6,
                  top: -2,
                  bottom: -2,
                  width: 8,
                  background: (theme) =>
                    theme.palette.mode === "dark"
                      ? "linear-gradient(180deg, #81c784 0%, #4caf50 30%, #388e3c 70%, #2e7d32 100%)"
                      : "linear-gradient(180deg, #43a047 0%, #2e7d32 30%, #1b5e20 70%, #0d5016 100%)",
                  borderRadius: "4px",
                  zIndex: 1002,
                  boxShadow: (theme) =>
                    theme.palette.mode === "dark"
                      ? "0 0 20px rgba(76, 175, 80, 1), 0 0 8px rgba(76, 175, 80, 0.7), inset 0 2px 0 rgba(255,255,255,0.5)"
                      : "0 0 24px rgba(46, 125, 50, 1), 0 0 12px rgba(27, 94, 32, 0.8), 0 2px 8px rgba(0,0,0,0.3), inset 0 2px 0 rgba(255,255,255,0.7)",
                  animation:
                    "dragIndicator 0.5s ease-in-out infinite alternate, slideIn 0.2s ease-out forwards",
                  border: (theme) =>
                    theme.palette.mode === "dark"
                      ? "2px solid rgba(129, 199, 132, 0.4)"
                      : "3px solid rgba(46, 125, 50, 0.8)",
                },
              }),

            ...(dragOperation === "sort" &&
              dragInsertPosition === "after" && {
                "&::after": {
                  content: '""',
                  position: "absolute",
                  right: -6,
                  top: -2,
                  bottom: -2,
                  width: 8,
                  background: (theme) =>
                    theme.palette.mode === "dark"
                      ? "linear-gradient(180deg, #81c784 0%, #4caf50 30%, #388e3c 70%, #2e7d32 100%)"
                      : "linear-gradient(180deg, #43a047 0%, #2e7d32 30%, #1b5e20 70%, #0d5016 100%)",
                  borderRadius: "4px",
                  zIndex: 1002,
                  boxShadow: (theme) =>
                    theme.palette.mode === "dark"
                      ? "0 0 20px rgba(76, 175, 80, 1), 0 0 8px rgba(76, 175, 80, 0.7), inset 0 2px 0 rgba(255,255,255,0.5)"
                      : "0 0 24px rgba(46, 125, 50, 1), 0 0 12px rgba(27, 94, 32, 0.8), 0 2px 8px rgba(0,0,0,0.3), inset 0 2px 0 rgba(255,255,255,0.7)",
                  animation:
                    "dragIndicator 0.5s ease-in-out infinite alternate, slideIn 0.2s ease-out forwards",
                  border: (theme) =>
                    theme.palette.mode === "dark"
                      ? "2px solid rgba(129, 199, 132, 0.4)"
                      : "3px solid rgba(46, 125, 50, 0.8)",
                },
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
