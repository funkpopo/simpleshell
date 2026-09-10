import React, { useCallback, useMemo, useRef } from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import useDragResize from "../../hooks/useDragResize.js";
import { clampRatio } from "../../modules/terminal/paneLayout.js";

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
const PaneDivider = ({ orientation, getRatio, setRatio }) => {
  const dividerRef = useRef(null);
  const containerSizeRef = useRef({ width: 0, height: 0 });

  const measureContainer = useCallback(() => {
    const container = dividerRef.current?.parentElement || null;
    const rect = container?.getBoundingClientRect() || {
      width: 0,
      height: 0,
    };
    containerSizeRef.current = { width: rect.width, height: rect.height };
    return rect;
  }, []);

  const startResize = useDragResize({
    getStart: () => {
      const rect = measureContainer();
      const size = orientation === "vertical" ? rect.width : rect.height;
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
  });

  const isVertical = orientation === "vertical";

  return (
    <Box
      ref={dividerRef}
      data-pane-divider={orientation}
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
 * >2 窗格时通过 allowWebgl=false 降级 DOM 渲染器，避免 WebGL 上下文超限。
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
  const {
    direction = "row",
    panes = [],
    ratios = [],
    focusedPaneId,
  } = layout || {};

  const safeRatios = useMemo(() => {
    const values = Array.isArray(ratios) ? ratios : [];
    return [
      clampRatio(Number(values[0]) || 50),
      clampRatio(Number(values[1]) || 50),
    ];
  }, [ratios]);

  const paneCount = panes.length;
  const showHeaders = paneCount > 1;

  const renderPane = useCallback(
    (paneId, sx = {}) => {
      const focused = focusedPaneId ? focusedPaneId === paneId : false;
      return (
        <Pane
          key={paneId}
          paneId={paneId}
          label={getPaneLabel ? getPaneLabel(paneId) : paneId}
          focused={focused}
          showHeader={showHeaders}
          showCloseButton={showHeaders && canClosePane(paneId)}
          isPaneDragOver={paneDragOverId === paneId}
          sx={sx}
          onFocusPane={onFocusPane}
          onClosePane={onClosePane}
          onPaneDragStart={onPaneDragStart}
          onPaneDragOver={onPaneDragOver}
          onPaneDrop={onPaneDrop}
          onPaneDragEnd={onPaneDragEnd}
        >
          {renderPaneTerminal(paneId, {
            isActive: Boolean(isActive) && focused,
          })}
        </Pane>
      );
    },
    [
      canClosePane,
      focusedPaneId,
      getPaneLabel,
      isActive,
      onClosePane,
      onFocusPane,
      onPaneDragEnd,
      onPaneDragOver,
      onPaneDragStart,
      onPaneDrop,
      paneCount,
      paneDragOverId,
      renderPaneTerminal,
      showHeaders,
    ],
  );

  if (paneCount === 0) {
    return null;
  }

  if (direction === "grid" && paneCount >= 3) {
    const [topLeft, topRight, bottomLeft, bottomRight] = panes;
    const verticalDivider = (
      <PaneDivider
        orientation="vertical"
        getRatio={() => safeRatios[0]}
        setRatio={(value) => onSetRatios([value, safeRatios[1]])}
      />
    );
    return (
      <Box
        data-pane-grid={tabId}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <Box sx={{ display: "flex", flex: 1, minHeight: 0, width: "100%" }}>
          <Box
            sx={{ width: `${safeRatios[0]}%`, minWidth: 0, display: "flex" }}
          >
            {renderPane(topLeft, { flex: 1 })}
          </Box>
          {topRight ? verticalDivider : null}
          {topRight ? (
            <Box sx={{ flex: 1, minWidth: 0, display: "flex" }}>
              {renderPane(topRight, { flex: 1 })}
            </Box>
          ) : null}
        </Box>
        {bottomLeft ? (
          <>
            <PaneDivider
              orientation="horizontal"
              getRatio={() => safeRatios[1]}
              setRatio={(value) => onSetRatios([safeRatios[0], value])}
            />
            <Box sx={{ display: "flex", flex: 1, minHeight: 0, width: "100%" }}>
              <Box
                sx={{
                  width: `${safeRatios[0]}%`,
                  minWidth: 0,
                  display: "flex",
                }}
              >
                {renderPane(bottomLeft, { flex: 1 })}
              </Box>
              {bottomRight ? verticalDivider : null}
              {bottomRight ? (
                <Box sx={{ flex: 1, minWidth: 0, display: "flex" }}>
                  {renderPane(bottomRight, { flex: 1 })}
                </Box>
              ) : null}
            </Box>
          </>
        ) : null}
      </Box>
    );
  }

  const isRow = direction === "row";
  const [first, second] = panes;

  // row/column 布局超过 2 窗格（如连续拖入多个标签页）：等分排布，
  // 避免第三个及之后的窗格被隐藏
  if (paneCount > 2) {
    return (
      <Box
        data-pane-grid={tabId}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: isRow ? "row" : "column",
          overflow: "hidden",
        }}
      >
        {panes.map((paneId, index) => (
          <Box
            key={paneId}
            sx={{
              flex: 1,
              minWidth: 0,
              minHeight: 0,
              display: "flex",
              [isRow ? "borderLeft" : "borderTop"]:
                index > 0 ? "1px solid" : "none",
              borderColor: "divider",
            }}
          >
            {renderPane(paneId, { flex: 1 })}
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Box
      data-pane-grid={tabId}
      sx={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: isRow ? "row" : "column",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          [isRow ? "width" : "height"]: `${safeRatios[0]}%`,
          minWidth: 0,
          minHeight: 0,
          display: "flex",
        }}
      >
        {renderPane(first, { flex: 1 })}
      </Box>
      {second ? (
        <PaneDivider
          orientation={isRow ? "vertical" : "horizontal"}
          getRatio={() => safeRatios[0]}
          setRatio={(value) => onSetRatios([value, safeRatios[1]])}
        />
      ) : null}
      {second ? (
        <Box sx={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex" }}>
          {renderPane(second, { flex: 1 })}
        </Box>
      ) : null}
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
