import React, { memo, useCallback } from "react";
import PropTypes from "prop-types";
import { Box, Typography, Tab, GlobalStyles, Tooltip } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { findGroupByTab } from "../core/syncInputGroups";

// 添加拖拽指示器动画和磁吸效果的全局样式
const dragIndicatorStyles = (
  <GlobalStyles
    styles={{
      "@keyframes indicatorGlassIn": {
        "0%": {
          transform: "scaleY(0.25)",
          opacity: 0,
          filter: "blur(6px)",
        },
        "55%": {
          transform: "scaleY(1.08)",
          opacity: 1,
          filter: "blur(0px)",
        },
        "100%": {
          transform: "scaleY(1)",
          opacity: 1,
          filter: "blur(0px)",
        },
      },
      "@keyframes indicatorGlowPulse": {
        "0%, 100%": {
          boxShadow:
            "0 0 12px rgba(100, 180, 255, 0.45), 0 0 2px rgba(255, 255, 255, 0.6) inset",
        },
        "50%": {
          boxShadow:
            "0 0 18px rgba(130, 200, 255, 0.65), 0 0 3px rgba(255, 255, 255, 0.75) inset",
        },
      },
      "@keyframes reconnectPulse": {
        "0%": {
          transform: "scale(0.9)",
          opacity: 0.8,
        },
        "50%": {
          transform: "scale(1.15)",
          opacity: 1,
        },
        "100%": {
          transform: "scale(0.9)",
          opacity: 0.8,
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
    prevProps.statusColor === nextProps.statusColor &&
    prevProps.statusTooltip === nextProps.statusTooltip &&
    prevProps.isDraggedOver === nextProps.isDraggedOver &&
    prevProps.dragInsertPosition === nextProps.dragInsertPosition &&
    prevProps.isDragSource === nextProps.isDragSource &&
    prevProps.dragSessionActive === nextProps.dragSessionActive
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
    statusColor = null,
    statusTooltip = null,
    isDraggedOver = false, // 是否被拖拽悬停
    dragInsertPosition = null, // 插入位置 ('before' | 'after')
    isDragSource = false, // 当前标签是否为被拖动的源（原位占位）
    dragSessionActive = false, // 是否有任意标签正在被拖动
    ...other
  } = props;

  // 分组相关状态
  const group = findGroupByTab(tabId);

  // 优化关闭按钮点击处理
  const handleCloseClick = (e) => {
    e.stopPropagation();
    if (onClose) {
      onClose(tabId);
    }
  };

  const handleDragOverMerged = useCallback(
    (e) => onDragOver?.(e, index),
    [onDragOver, index],
  );
  const handleDropMerged = useCallback(
    (e) => onDrop?.(e, index),
    [onDrop, index],
  );

  // 处理拖拽开始 - 支持分屏功能和幽灵元素预览
  const handleDragStart = useCallback(
    (e) => {
      // 先调用父组件的拖拽开始处理
      if (onDragStart) {
        onDragStart(e, index);
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

      // 创建幽灵元素预览（液态玻璃：多层高光、饱和模糊、柔和色散描边）
      const createDragPreview = () => {
        const preview = document.createElement("div");
        const isDark = document.body.classList.contains("dark-theme");

        const glassBg = isDark
          ? "linear-gradient(155deg, rgba(255,255,255,0.14) 0%, rgba(120,160,220,0.08) 42%, rgba(20,24,34,0.72) 100%)"
          : "linear-gradient(155deg, rgba(255,255,255,0.92) 0%, rgba(230,240,255,0.55) 38%, rgba(255,255,255,0.38) 100%)";

        preview.style.cssText = `
          position: relative;
          padding: 8px 16px;
          background: ${glassBg};
          color: ${isDark ? "rgba(255,255,255,0.96)" : "rgba(30,34,42,0.94)"};
          border-radius: 12px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.01em;
          border: 1px solid ${
            isDark ? "rgba(255, 255, 255, 0.22)" : "rgba(255, 255, 255, 0.85)"
          };
          box-shadow:
            0 1px 0 rgba(255,255,255,0.35) inset,
            0 12px 40px rgba(0, 0, 0, ${isDark ? 0.45 : 0.14}),
            0 4px 16px rgba(80, 140, 255, ${isDark ? 0.2 : 0.12}),
            0 0 0 1px rgba(120, 170, 255, ${isDark ? 0.12 : 0.08});
          backdrop-filter: saturate(180%) blur(24px);
          -webkit-backdrop-filter: saturate(180%) blur(24px);
          display: flex;
          align-items: center;
          gap: 6px;
          pointer-events: none;
          position: absolute;
          left: -9999px;
          top: -9999px;
          z-index: 99999;
          white-space: nowrap;
          max-width: 220px;
          overflow: hidden;
          text-overflow: ellipsis;
        `;

        const sheen = document.createElement("div");
        sheen.style.cssText = `
          position: absolute;
          inset: 0;
          border-radius: inherit;
          pointer-events: none;
          background: linear-gradient(
            118deg,
            rgba(255,255,255,0.55) 0%,
            rgba(255,255,255,0.12) 35%,
            rgba(255,255,255,0) 52%,
            rgba(120,180,255,0.08) 100%
          );
          opacity: ${isDark ? 0.5 : 0.65};
        `;
        preview.appendChild(sheen);

        const row = document.createElement("div");
        row.style.cssText = `
          display: flex;
          align-items: center;
          gap: 6px;
          position: relative;
          z-index: 1;
          min-width: 0;
        `;

        const icon = document.createElement("span");
        icon.style.cssText = `
          display: inline-flex;
          align-items: center;
          opacity: ${isDark ? 0.75 : 0.65};
          flex-shrink: 0;
        `;
        icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"></path></svg>`;

        const text = document.createElement("span");
        text.textContent = label;
        text.style.cssText = `
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        `;

        row.appendChild(icon);
        row.appendChild(text);
        preview.appendChild(row);
        document.body.appendChild(preview);

        e.dataTransfer.setDragImage(
          preview,
          preview.offsetWidth / 2,
          preview.offsetHeight / 2,
        );

        requestAnimationFrame(() => {
          setTimeout(() => {
            if (document.body.contains(preview)) {
              document.body.removeChild(preview);
            }
          }, 0);
        });
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
        onContextMenu={
          onContextMenu ? (e) => onContextMenu(e, tabId, index) : undefined
        }
        draggable={draggable}
        onDragStart={draggable ? handleDragStart : undefined}
        onDragOver={handleDragOverMerged}
        onDragLeave={onDragLeave}
        onDrop={handleDropMerged}
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
            {statusColor &&
              (statusTooltip ? (
                <Tooltip title={statusTooltip}>
                  <Box
                    component="span"
                    sx={{
                      width: 8,
                      height: 8,
                      minWidth: 8,
                      minHeight: 8,
                      borderRadius: "50%",
                      bgcolor: statusColor,
                      mr: 1,
                      boxShadow: "0 0 0 1px rgba(255,255,255,0.75)",
                      animation: "reconnectPulse 1.6s ease-in-out infinite",
                    }}
                  />
                </Tooltip>
              ) : (
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    minWidth: 8,
                    minHeight: 8,
                    borderRadius: "50%",
                    bgcolor: statusColor,
                    mr: 1,
                    boxShadow: "0 0 0 1px rgba(255,255,255,0.75)",
                    animation: "reconnectPulse 1.6s ease-in-out infinite",
                  }}
                />
              ))}
            {onClose && (
              <CloseIcon
                className="tab-close-icon"
                fontSize="small"
                sx={{
                  width: 16,
                  height: 16,
                  opacity: 0.35,
                  transition: "opacity 0.2s ease, color 0.2s ease",
                  "&:hover": {
                    color: "error.main",
                    opacity: 1,
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
          minHeight: 30,
          py: 0,
          px: 1.2,
          borderRadius: dragSessionActive ? "10px" : "8px 8px 0 0",
          cursor: isDragSource ? "grabbing" : "pointer",
          userSelect: "none",
          color: "text.secondary",
          transition: [
            "opacity 0.36s cubic-bezier(0.32, 0.72, 0, 1)",
            "transform 0.44s cubic-bezier(0.34, 1.45, 0.64, 1)",
            "box-shadow 0.38s cubic-bezier(0.32, 0.72, 0, 1)",
            "background-color 0.28s ease",
            "color 0.22s ease",
            "filter 0.34s ease",
            "border-color 0.3s ease",
            "backdrop-filter 0.34s ease",
          ].join(", "),
          willChange: "auto",
          "&:hover": {
            color: "text.primary",
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.08)"
                : "rgba(0, 0, 0, 0.04)",
            "& .tab-close-icon": {
              opacity: 0.85,
            },
          },

          // 拖拽进行中：其余标签轻微收缩，突出中间「槽位」感
          ...(dragSessionActive &&
            !isDragSource &&
            !isDraggedOver && {
              transform: "scale(0.985)",
              filter: "saturate(0.92) brightness(0.97)",
            }),

          // 原位占位：下沉的毛玻璃残影，与拖拽预览风格一致
          ...(isDragSource && {
            cursor: "grabbing",
            opacity: 0.38,
            transform: "scale(0.92) translateY(4px)",
            WebkitBackdropFilter: "saturate(165%) blur(14px)",
            backdropFilter: "saturate(165%) blur(14px)",
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(36, 40, 52, 0.58)"
                : "rgba(255, 255, 255, 0.5)",
            border: (theme) =>
              `1px solid ${
                theme.palette.mode === "dark"
                  ? "rgba(255,255,255,0.16)"
                  : "rgba(255,255,255,0.72)"
              }`,
            boxShadow: (theme) =>
              theme.palette.mode === "dark"
                ? "inset 0 1px 0 rgba(255,255,255,0.12), 0 16px 36px rgba(0,0,0,0.4), 0 0 0 1px rgba(100,170,255,0.14)"
                : "inset 0 1px 0 rgba(255,255,255,0.9), 0 14px 32px rgba(0,0,0,0.11), 0 0 0 1px rgba(90,150,230,0.1)",
            filter: "saturate(1.1)",
            willChange: "transform, opacity, filter",
          }),

          // 悬停目标：微微浮起 + 液态玻璃高亮
          ...(isDraggedOver && {
            position: "relative",
            cursor: "default",
            transform: "scale(1.03) translateY(-2px)",
            WebkitBackdropFilter: "saturate(180%) blur(12px)",
            backdropFilter: "saturate(180%) blur(12px)",
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(80, 130, 200, 0.14)"
                : "rgba(255, 255, 255, 0.72)",
            boxShadow: (theme) =>
              theme.palette.mode === "dark"
                ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 10px 28px rgba(0,0,0,0.32), 0 0 0 1px rgba(130,190,255,0.22)"
                : "inset 0 1px 0 rgba(255,255,255,0.95), 0 12px 28px rgba(70,130,220,0.12), 0 0 0 1px rgba(120,170,240,0.2)",
            filter: "saturate(1.08)",
            zIndex: 2,
            ...(dragInsertPosition === "before" && {
              "&::before": {
                content: '""',
                position: "absolute",
                left: 0,
                top: "18%",
                bottom: "18%",
                width: 4,
                borderRadius: 999,
                zIndex: 1002,
                background:
                  "linear-gradient(180deg, rgba(164,210,255,0.95) 0%, rgba(66,165,245,1) 45%, rgba(124,77,255,0.92) 100%)",
                animation:
                  "indicatorGlassIn 0.38s cubic-bezier(0.34, 1.45, 0.64, 1) forwards, indicatorGlowPulse 2.1s ease-in-out 0.12s infinite",
              },
            }),
            ...(dragInsertPosition === "after" && {
              "&::after": {
                content: '""',
                position: "absolute",
                right: 0,
                top: "18%",
                bottom: "18%",
                width: 4,
                borderRadius: 999,
                zIndex: 1002,
                background:
                  "linear-gradient(180deg, rgba(164,210,255,0.95) 0%, rgba(66,165,245,1) 45%, rgba(124,77,255,0.92) 100%)",
                animation:
                  "indicatorGlassIn 0.38s cubic-bezier(0.34, 1.45, 0.64, 1) forwards, indicatorGlowPulse 2.1s ease-in-out 0.12s infinite",
              },
            }),
          }),
          "&.Mui-selected": {
            color: "text.primary",
            backgroundColor: (theme) =>
              theme.palette.mode === "dark"
                ? "rgba(255, 255, 255, 0.14)"
                : "rgba(255, 255, 255, 0.92)",
            boxShadow: (theme) =>
              theme.palette.mode === "dark"
                ? "inset 0 1px 0 rgba(255,255,255,0.18), 0 8px 18px rgba(0,0,0,0.28)"
                : "inset 0 1px 0 rgba(255,255,255,0.95), 0 6px 16px rgba(0,0,0,0.08)",
            fontWeight: 600,
            transform: "translateY(-1px)",
            "& .tab-close-icon": {
              opacity: 0.72,
            },
            ...(isDragSource && {
              transform: "scale(0.92) translateY(4px)",
            }),
            ...(isDraggedOver && {
              transform: "scale(1.03) translateY(-2px)",
            }),
          },
        }}
      />
    </>
  );
}, areEqual);

// 设置显示名称用于调试
CustomTab.displayName = "CustomTab";

CustomTab.propTypes = {
  label: PropTypes.node.isRequired,
  onClose: PropTypes.func,
  onContextMenu: PropTypes.func,
  onClick: PropTypes.func,
  index: PropTypes.number,
  draggable: PropTypes.bool,
  onDragStart: PropTypes.func,
  onDragOver: PropTypes.func,
  onDragLeave: PropTypes.func,
  onDrop: PropTypes.func,
  onDragEnd: PropTypes.func,
  tabId: PropTypes.string,
  statusColor: PropTypes.string,
  statusTooltip: PropTypes.string,
  isDraggedOver: PropTypes.bool,
  dragInsertPosition: PropTypes.oneOf(["before", "after", null]),
  isDragSource: PropTypes.bool,
  dragSessionActive: PropTypes.bool,
};

export default CustomTab;
