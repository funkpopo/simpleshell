import React, { memo, useCallback } from "react";
import PropTypes from "prop-types";
import { Box, Tab, Tooltip } from "@mui/material";
import { alpha } from "@mui/material/styles";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { findGroupByTab } from "../core/syncInputGroups";

// 拖拽指示器与重连动画的 keyframes 定义在 styles/global.css 中
// （indicatorGlassIn / indicatorGlowPulse / reconnectPulse）

// 自定义比较函数
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.label === nextProps.label &&
    prevProps.value === nextProps.value &&
    prevProps.selected === nextProps.selected &&
    // MUI 9 temporarily injects the Tabs indicator into the selected Tab on
    // the first render, then removes it after mount. Ignoring that transition
    // leaves the initial indicator layer permanently mounted over the label.
    Boolean(prevProps.indicator) === Boolean(nextProps.indicator) &&
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
  const { t } = useTranslation();
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

      // 创建与主界面一致的单色拖拽预览
      const createDragPreview = () => {
        const preview = document.createElement("div");
        const isDark = document.body.classList.contains("dark-theme");

        const previewBg = isDark
          ? "rgba(13, 15, 17, 0.96)"
          : "rgba(255, 255, 252, 0.96)";

        preview.style.cssText = `
          position: relative;
          padding: 7px 11px;
          background: ${previewBg};
          color: ${isDark ? "#f1f2ef" : "#151719"};
          border-radius: 3px;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.01em;
          border: 1px solid ${
            isDark ? "rgba(241, 242, 239, 0.2)" : "rgba(16, 18, 20, 0.18)"
          };
          box-shadow: 0 14px 40px rgba(0, 0, 0, ${isDark ? 0.5 : 0.14});
          backdrop-filter: blur(18px);
          -webkit-backdrop-filter: blur(18px);
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
          opacity: 0.62;
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
      <Tab
        {...other}
        disableRipple
        className={`simple-shell-tab ${other.className || ""}`.trim()}
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
            sx={{
              display: "flex",
              alignItems: "center",
              position: "relative",
              minWidth: 0,
              width: "100%",
            }}
          >
            {/* 分组圆点与编号 */}
            {group && (
              <Tooltip
                title={t("tabMenu.syncGroup", { groupId: group.groupId })}
              >
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
            <Box
              component="span"
              title={typeof label === "string" ? label : undefined}
              className="tab-label-text"
              sx={{
                minWidth: 28,
                flex: "1 1 auto",
                mr: onClose ? 0.75 : 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                color: "inherit",
                WebkitTextFillColor: "currentColor",
                opacity: "1 !important",
                visibility: "visible",
                fontSize: "0.78rem",
                fontWeight: "inherit",
                lineHeight: 1.25,
                display: "block",
              }}
            >
              {label}
            </Box>
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
              <Box
                component="span"
                className="tab-close-icon"
                onClick={handleCloseClick}
                aria-hidden="true"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 20,
                  height: 20,
                  borderRadius: "3px",
                  opacity: 0,
                  flexShrink: 0,
                  transition:
                    "opacity 0.2s ease, color 0.2s ease, background-color 0.2s ease",
                  "&:hover": {
                    color: "error.main",
                    opacity: 1,
                    backgroundColor: (theme) =>
                      alpha(theme.palette.error.main, 0.12),
                  },
                }}
              >
                <CloseIcon sx={{ width: 15, height: 15 }} />
              </Box>
            )}
          </Box>
        }
        sx={{
          textTransform: "none",
          minWidth: "auto",
          maxWidth: 240,
          minHeight: 30,
          py: 0,
          px: 1.2,
          borderRadius: dragSessionActive ? "3px" : 0,
          cursor: isDragSource ? "grabbing" : "pointer",
          userSelect: "none",
          color: "var(--color-text-secondary) !important",
          backgroundColor: "transparent !important",
          opacity: "1 !important",
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
            color: "var(--color-text-primary) !important",
            backgroundColor: "var(--color-hover) !important",
            "& .tab-close-icon": {
              opacity: 0.8,
            },
          },

          // 拖拽进行中：其余标签轻微收缩，突出中间「槽位」感
          ...(dragSessionActive &&
            !isDragSource &&
            !isDraggedOver && {
              transform: "scale(0.985)",
              filter: "saturate(0.92) brightness(0.97)",
            }),

          // 原位占位：保留清晰轮廓，不引入额外色彩
          ...(isDragSource && {
            cursor: "grabbing",
            opacity: 0.38,
            transform: "scale(0.92) translateY(4px)",
            backgroundColor: "background.default",
            border: "1px solid",
            borderColor: "divider",
            boxShadow: "none",
            filter: "none",
            willChange: "transform, opacity, filter",
          }),

          // 悬停目标：用单色底和插入线明确落点
          ...(isDraggedOver && {
            position: "relative",
            cursor: "default",
            transform: "scale(1.03) translateY(-2px)",
            backgroundColor: (theme) => alpha(theme.palette.text.primary, 0.1),
            boxShadow: "none",
            filter: "none",
            zIndex: 2,
            ...(dragInsertPosition === "before" && {
              "&::before": {
                content: '""',
                position: "absolute",
                left: 0,
                top: "18%",
                bottom: "18%",
                width: 2,
                borderRadius: 0,
                zIndex: 1002,
                backgroundColor: "text.primary",
                animation: "indicatorGlassIn 0.2s ease-out forwards",
              },
            }),
            ...(dragInsertPosition === "after" && {
              "&::after": {
                content: '""',
                position: "absolute",
                right: 0,
                top: "18%",
                bottom: "18%",
                width: 2,
                borderRadius: 0,
                zIndex: 1002,
                backgroundColor: "text.primary",
                animation: "indicatorGlassIn 0.2s ease-out forwards",
              },
            }),
          }),
          "&.Mui-selected": {
            color: "var(--tab-selected-fg) !important",
            backgroundColor: "transparent !important",
            boxShadow:
              "inset 0 -1px 0 var(--tab-selected-indicator) !important",
            fontWeight: 650,
            transform: "none",
            "& .tab-label-text": {
              color: "var(--tab-selected-fg) !important",
              WebkitTextFillColor: "var(--tab-selected-fg) !important",
              opacity: "1 !important",
            },
            "& .tab-close-icon": {
              opacity: 0.64,
            },
            "&:hover": {
              color: "var(--tab-selected-fg) !important",
              backgroundColor: "var(--tab-selected-hover-bg) !important",
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
