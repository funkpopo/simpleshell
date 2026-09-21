import React, { useCallback, useRef } from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import useDragResize from "../../../shared/hooks/useDragResize.js";
import { clampRatio } from "../model/paneLayout.js";

const DIVIDER_THICKNESS = 5;
const DIVIDER_HIT_AREA = 12;
const MIN_PANE_SIZE_PX = 80;

/**
 * 单个窗格：轻量头部（拖拽手柄 + 标题 + 关闭）+ 终端区域。
 * 头部仅用于分屏识别 / 拖拽 / 关闭；单窗格状态下不渲染头部。
 */
const Pane = ({
  paneId,
  label,
  focused,
  showHeader,
  showCloseButton,
  sx,
  children,
  onFocusPane,
  onClosePane,
  onPaneDragStart,
  onPaneDragOver,
  onPaneDrop,
  onPaneDragEnd,
  isPaneDragOver,
}) => {
  const { t } = useTranslation();
  const handleHeaderDragStart = useCallback(
    (event) => {
      if (!onPaneDragStart) return;
      event.stopPropagation();
      onPaneDragStart(event, paneId);
    },
    [onPaneDragStart, paneId],
  );

  return (
    <Box
      data-pane-id={paneId}
      onMouseDown={() => onFocusPane?.(paneId)}
      onDragOver={onPaneDragOver ? (e) => onPaneDragOver(e, paneId) : undefined}
      onDrop={onPaneDrop ? (e) => onPaneDrop(e, paneId) : undefined}
      onDragEnd={onPaneDragEnd}
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        overflow: "hidden",
        bgcolor: isPaneDragOver ? "action.hover" : "transparent",
        ...sx,
      }}
    >
      {showHeader ? (
        <Box
          draggable
          onDragStart={handleHeaderDragStart}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            height: 22,
            flexShrink: 0,
            px: 0.75,
            bgcolor: focused ? "action.selected" : "action.hover",
            borderBottom: "1px solid",
            borderColor: "divider",
            cursor: "grab",
            userSelect: "none",
            WebkitAppRegion: "no-drag",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: "text.secondary",
              fontSize: "0.7rem",
              lineHeight: 1,
            }}
          >
            {label}
          </Typography>
          {showCloseButton ? (
            <Tooltip title={t("terminal.pane.closePane")} arrow>
              <IconButton
                size="small"
                aria-label={t("terminal.pane.closePane")}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onClosePane?.(paneId);
                }}
                sx={{ p: 0.25 }}
              >
                <CloseIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </Tooltip>
          ) : null}
        </Box>
      ) : null}
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>{children}</Box>
      {focused && showHeader ? (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            bgcolor: "primary.main",
            zIndex: 4,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {isPaneDragOver ? (
        <Box
          sx={{
            position: "absolute",
            inset: 0,
            border: "2px dashed",
            borderColor: "primary.main",
            bgcolor: "action.focus",
            opacity: 0.35,
            pointerEvents: "none",
            zIndex: 5,
          }}
        />
      ) : null}
    </Box>
  );
};

Pane.propTypes = {
  paneId: PropTypes.string.isRequired,
  label: PropTypes.node,
  focused: PropTypes.bool,
  showHeader: PropTypes.bool,
  showCloseButton: PropTypes.bool,
  sx: PropTypes.object,
  children: PropTypes.node,
  onFocusPane: PropTypes.func,
  onClosePane: PropTypes.func,
  onPaneDragStart: PropTypes.func,
  onPaneDragOver: PropTypes.func,
  onPaneDrop: PropTypes.func,
  onPaneDragEnd: PropTypes.func,
  isPaneDragOver: PropTypes.bool,
};

/**
 * 分隔条：复用 useDragResize（像素拖拽 → 换算为百分比回调）。
 * orientation: "vertical"（左右分栏，调整列宽比例）| "horizontal"（上下分栏）
 */
const PaneDivider = ({ orientation, getRatio, setRatio, sx }) => {
  const dividerRef = useRef(null);
  const containerSizeRef = useRef({ width: 0, height: 0 });

  const measureContainer = useCallback(() => {
    const container = dividerRef.current?.parentElement || null;
    const rect = container?.getBoundingClientRect() || {
      width: 0,
      height: 0,
    };
    containerSizeRef.current = {
      width: rect.width - DIVIDER_HIT_AREA,
      height: rect.height - DIVIDER_HIT_AREA,
    };
    return rect;
  }, []);

  const startResize = useDragResize({
    getStart: () => {
      const rect = measureContainer();
      const size =
        (orientation === "vertical" ? rect.width : rect.height) -
        DIVIDER_HIT_AREA;
      return orientation === "vertical"
        ? { width: (size * getRatio()) / 100 }
        : { height: (size * getRatio()) / 100 };
    },
    getBounds: () => {
      const size =
        orientation === "vertical"
          ? containerSizeRef.current.width
          : containerSizeRef.current.height;
      const max = Math.max(MIN_PANE_SIZE_PX, size - MIN_PANE_SIZE_PX);
      return orientation === "vertical"
        ? { minWidth: MIN_PANE_SIZE_PX, maxWidth: max }
        : { minHeight: MIN_PANE_SIZE_PX, maxHeight: max };
    },
    onResize: (next) => {
      const size =
        orientation === "vertical"
          ? containerSizeRef.current.width
          : containerSizeRef.current.height;
      const px = orientation === "vertical" ? next.width : next.height;
      if (!size || !Number.isFinite(px)) return;
      setRatio(clampRatio((px / size) * 100));
    },
    manageBodyStyles: true,
    direction: 1,
    stopPropagation: true,
  });

  const isVertical = orientation === "vertical";

  return (
    <Box
      ref={dividerRef}
      data-pane-divider={orientation}
      role="separator"
      aria-orientation={orientation}
      aria-valuenow={Math.round(getRatio())}
      aria-valuemin={15}
      aria-valuemax={85}
      tabIndex={0}
      onKeyDown={(event) => {
        const negative = isVertical ? "ArrowLeft" : "ArrowUp";
        const positive = isVertical ? "ArrowRight" : "ArrowDown";
        if (event.key !== negative && event.key !== positive) return;
        event.preventDefault();
        setRatio(clampRatio(getRatio() + (event.key === positive ? 2 : -2)));
      }}
      onMouseDown={startResize(isVertical ? "width" : "height")}
      sx={{
        flexShrink: 0,
        position: "relative",
        width: isVertical ? DIVIDER_HIT_AREA : "100%",
        height: isVertical ? "100%" : DIVIDER_HIT_AREA,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: isVertical ? "col-resize" : "row-resize",
        WebkitAppRegion: "no-drag",
        ...sx,
        "&::after": {
          content: '""',
          display: "block",
          width: isVertical ? DIVIDER_THICKNESS : "100%",
          height: isVertical ? "100%" : DIVIDER_THICKNESS,
          bgcolor: "divider",
          transition: "background-color 0.15s ease",
        },
        "&:hover::after": {
          bgcolor: "primary.main",
        },
      }}
    />
  );
};

PaneDivider.propTypes = {
  sx: PropTypes.object,
  orientation: PropTypes.oneOf(["vertical", "horizontal"]).isRequired,
  getRatio: PropTypes.func.isRequired,
  setRatio: PropTypes.func.isRequired,
};

/**
 * PaneGrid：按 layout 渲染 1×2 / 2×1 / 2×2 分屏。
 *
 * 布局语义：
 * - row:    [pane0 | pane1]                比例 ratios[0]
 * - column: [pane0 / pane1]                比例 ratios[0]
 * - grid:   2×2，ratios[0] = 列比例，ratios[1] = 行比例
 *           panes 顺序：左上、右上、左下、右下
 *
 * 每个窗格渲染独立 WebTerminal（sessionKey = paneId），
 * 只有聚焦窗格收到 isActive=true（焦点 + 布局恢复走 isActive 通路）。
 * >2 窗格或后台标签使用标准渲染器，前台最多分配两个 WebGL 上下文。
 */
const PaneGrid = ({
  tabId,
  layout,
  isActive,
  renderPaneTerminal,
  getPaneLabel,
  canClosePane,
  onFocusPane,
  onClosePane,
  onSetRatios,
  onPaneDragStart,
  onPaneDragOver,
  onPaneDrop,
  onPaneDragEnd,
  paneDragOverId,
}) => {
  const { direction, panes, ratios, focusedPaneId } = layout;
  const paneCount = panes.length;
  const grid = direction === "grid";
  const row = direction === "row";
  const columns = grid || (row && paneCount > 1);
  const rows = grid || (!row && paneCount > 1);
  const columnRatio = clampRatio(ratios[0]);
  const rowRatio = clampRatio(ratios[grid ? 1 : 0]);
  const tracks = (ratio) => `${ratio}fr ${DIVIDER_HIT_AREA}px ${100 - ratio}fr`;
  return (
    <Box
      data-pane-grid={tabId}
      sx={{
        width: "100%",
        height: "100%",
        display: "grid",
        gridTemplateColumns: columns ? tracks(columnRatio) : "minmax(0, 1fr)",
        gridTemplateRows: rows ? tracks(rowRatio) : "minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      {panes.map((paneId, index) => (
        <Pane
          key={paneId}
          paneId={paneId}
          label={getPaneLabel(paneId)}
          focused={focusedPaneId === paneId}
          showHeader={paneCount > 1}
          showCloseButton={paneCount > 1 && canClosePane(paneId)}
          isPaneDragOver={paneDragOverId === paneId}
          sx={{
            gridColumn: grid
              ? index % 2 === 0
                ? 1
                : 3
              : row
                ? index * 2 + 1
                : 1,
            gridRow: grid ? (index < 2 ? 1 : 3) : row ? 1 : index * 2 + 1,
            ...(grid && paneCount === 3 && index === 2
              ? { gridColumn: "1 / 4" }
              : {}),
          }}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onPaneDragStart={onPaneDragStart}
          onPaneDragOver={onPaneDragOver}
          onPaneDrop={onPaneDrop}
          onPaneDragEnd={onPaneDragEnd}
        >
          {renderPaneTerminal(paneId, {
            isActive: Boolean(isActive) && focusedPaneId === paneId,
            allowWebgl: Boolean(isActive) && paneCount <= 2,
          })}
        </Pane>
      ))}
      {columns && (
        <PaneDivider
          key="columns"
          orientation="vertical"
          sx={{
            gridColumn: 2,
            gridRow: grid && paneCount === 4 ? "1 / 4" : 1,
            zIndex: 2,
          }}
          getRatio={() => columnRatio}
          setRatio={(value) => onSetRatios([value, ratios[1]])}
        />
      )}
      {rows && (
        <PaneDivider
          key="rows"
          orientation="horizontal"
          sx={{ gridRow: 2, gridColumn: grid ? "1 / 4" : 1, zIndex: 3 }}
          getRatio={() => rowRatio}
          setRatio={(value) =>
            onSetRatios(grid ? [ratios[0], value] : [value, ratios[1]])
          }
        />
      )}
    </Box>
  );
};

PaneGrid.propTypes = {
  tabId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
  layout: PropTypes.shape({
    direction: PropTypes.oneOf(["row", "column", "grid"]),
    panes: PropTypes.arrayOf(PropTypes.string),
    ratios: PropTypes.arrayOf(PropTypes.number),
    focusedPaneId: PropTypes.string,
  }),
  isActive: PropTypes.bool,
  renderPaneTerminal: PropTypes.func.isRequired,
  getPaneLabel: PropTypes.func,
  canClosePane: PropTypes.func,
  onFocusPane: PropTypes.func,
  onClosePane: PropTypes.func,
  onSetRatios: PropTypes.func,
  onPaneDragStart: PropTypes.func,
  onPaneDragOver: PropTypes.func,
  onPaneDrop: PropTypes.func,
  onPaneDragEnd: PropTypes.func,
  paneDragOverId: PropTypes.string,
};

PaneGrid.defaultProps = {
  onSetRatios: () => {},
  onFocusPane: () => {},
  onClosePane: () => {},
  canClosePane: () => true,
};

// React.memo：布局/焦点不变时不重排（终端内容自行管理重绘）
export default React.memo(PaneGrid);
