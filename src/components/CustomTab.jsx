import React, { memo, useCallback } from "react";
import { Box, Typography, Tab, GlobalStyles, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { findGroupByTab } from "../core/syncInputGroups";

// 添加拖拽指示器动画和磁吸效果的全局样式
const dragIndicatorStyles = (
  <GlobalStyles
    styles={{
      "@keyframes indicatorPopIn": {
        "0%": {
          transform: "scaleY(0.3)",
          opacity: 0,
        },
        "100%": {
          transform: "scaleY(1)",
          opacity: 1,
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
    prevProps.tabId === nextProps.tabId &&
    prevProps.draggable === nextProps.draggable &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onContextMenu === nextProps.onContextMenu &&
    prevProps.onDragStart === nextProps.onDragStart &&
    prevProps.onDragOver === nextProps.onDragOver &&
    prevProps.onDragLeave === nextProps.onDragLeave &&
    prevProps.onDrop === nextProps.onDrop &&
    prevProps.onDragEnd === nextProps.onDragEnd &&
    prevProps.isDraggedOver === nextProps.isDraggedOver &&
    prevProps.dragInsertPosition === nextProps.dragInsertPosition
  );
};

// 自定义标签页组件
const CustomTab = memo((props) => {
  const {
    label,
    onClose,
    onContextMenu,
    onClick,
    index,
    draggable = true,
    onDragStart,
    onDragOver,
    onDragLeave,
    onDrop,
    onDragEnd, // 拖拽结束回调
    tabId, // 每个Tab需传递tabId
    isDraggedOver = false, // 是否被拖拽悬停
    dragInsertPosition = null, // 插入位置 ('before' | 'after')
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
        const isDark = document.body.classList.contains("dark-theme");

        preview.style.cssText = `
          padding: 6px 14px;
          background-color: ${isDark ? "rgba(40, 40, 40, 0.85)" : "rgba(255, 255, 255, 0.85)"};
          color: ${isDark ? "#fff" : "#333"};
          border-radius: 6px;
          font-family: system-ui, -apple-system, sans-serif;
          font-size: 13px;
          font-weight: 500;
          box-shadow: ${
            isDark
              ? "0 8px 24px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)"
              : "0 8px 24px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.05)"
          };
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          display: flex;
          align-items: center;
          gap: 6px;
          pointer-events: none;
          position: absolute;
          left: -9999px;
          top: -9999px;
          z-index: 99999;
          white-space: nowrap;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        `;

        // 创建图标元素
        const icon = document.createElement("span");
        icon.style.cssText = `
          display: inline-flex;
          align-items: center;
          opacity: 0.7;
        `;
        icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`;

        // 创建文本元素
        const text = document.createElement("span");
        text.textContent = label;
        text.style.overflow = "hidden";
        text.style.textOverflow = "ellipsis";

        preview.appendChild(icon);
        preview.appendChild(text);
        document.body.appendChild(preview);

        // 设置拖拽预览图像
        e.dataTransfer.setDragImage(
          preview,
          preview.offsetWidth / 2,
          preview.offsetHeight / 2,
        );

        // 延迟移除预览元素
        setTimeout(() => {
          if (document.body.contains(preview)) {
            document.body.removeChild(preview);
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
        onClick={onClick}
        onContextMenu={onContextMenu}
        draggable={draggable}
        onDragStart={draggable ? handleDragStart : undefined}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onDragEnd={onDragEnd}
        label={
          <Box
            sx={{ display: "flex", alignItems: "center", position: "relative" }}
          >
            {/* 分组圆点与编号 */}
            {group && (
              <Tooltip title={`同步分组 ${group.groupId}`}>
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
                >
                  {group.groupId.replace("G", "")}
                </Box>
              </Tooltip>
            )}
            <Typography
              variant="body2"
              component="span"
              sx={{
                mr: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: {
                  xs: "150px",
                  sm: "180px",
                  md: "220px",
                }, // 响应式限制宽度，避免挤压其他标签
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
          cursor: isDraggedOver ? "grab" : "pointer",
          userSelect: "none",
          color: "text.secondary",
          transition:
            "opacity 0.2s ease, background-color 0.2s ease, color 0.2s ease",

          // 拖拽悬停时的特殊样式（仅排序）
          ...(isDraggedOver && {
            position: "relative",
            // 排序操作的插入位置指示器
            ...(dragInsertPosition === "before" && {
              "&::before": {
                content: '""',
                position: "absolute",
                left: -1,
                top: "20%",
                bottom: "20%",
                width: 3,
                backgroundColor: "primary.main",
                borderRadius: 3,
                zIndex: 1002,
                animation:
                  "indicatorPopIn 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
              },
            }),

            ...(dragInsertPosition === "after" && {
              "&::after": {
                content: '""',
                position: "absolute",
                right: -1,
                top: "20%",
                bottom: "20%",
                width: 3,
                backgroundColor: "primary.main",
                borderRadius: 3,
                zIndex: 1002,
                animation:
                  "indicatorPopIn 0.15s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
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
