import React, { useEffect, useState } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import CloseIcon from "@mui/icons-material/Close";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  sidebarContentSx,
  sidebarPaperSx,
  sidebarTitleBarSx,
  sidebarTitleIconButtonSx,
} from "./sidebarItemStyles";

/**
 * 侧边栏标题栏：标题 + 可选会话上下文 + 附加操作 + 关闭按钮。
 * 也可独立使用（如 FileManager 保留自有 Paper 外壳时）。
 */
export function SidebarTitleBar({
  title,
  titleSx,
  onClose,
  closeDisabled,
  actions,
  actionsSx,
  sessionContext,
  sx,
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  const closeButton = onClose ? (
    <Tooltip title={t("common.close")}>
      {closeDisabled !== undefined ? (
        <span>
          <IconButton
            size="small"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label={t("common.close")}
            sx={sidebarTitleIconButtonSx}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </span>
      ) : (
        <IconButton
          size="small"
          onClick={onClose}
          aria-label={t("common.close")}
          sx={sidebarTitleIconButtonSx}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      )}
    </Tooltip>
  ) : null;

  const contextLine = sessionContext ? (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        minWidth: 0,
        mt: 0.15,
        flexWrap: "wrap",
      }}
    >
      {sessionContext.protocol && (
        <Chip
          size="small"
          label={sessionContext.protocol}
          sx={{
            height: 18,
            fontSize: "0.65rem",
            fontWeight: 600,
            "& .MuiChip-label": { px: 0.75 },
          }}
        />
      )}
      {sessionContext.host && (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          title={sessionContext.host}
          sx={{ maxWidth: "100%", lineHeight: 1.2 }}
        >
          {sessionContext.host}
        </Typography>
      )}
      {sessionContext.quality && (
        <Typography
          variant="caption"
          color="text.disabled"
          noWrap
          sx={{ lineHeight: 1.2 }}
        >
          · {sessionContext.quality}
        </Typography>
      )}
      {sessionContext.cwd && (
        <Typography
          variant="caption"
          color="text.disabled"
          noWrap
          title={sessionContext.cwd}
          sx={{ maxWidth: "100%", lineHeight: 1.2, fontFamily: "monospace" }}
        >
          · {sessionContext.cwd}
        </Typography>
      )}
    </Box>
  ) : null;

  return (
    <Box sx={{ ...sidebarTitleBarSx(theme), ...sx }}>
      <Box sx={{ minWidth: 0, flex: 1, pr: 1 }}>
        <Typography
          variant="subtitle1"
          fontWeight="medium"
          noWrap
          sx={titleSx}
        >
          {title}
        </Typography>
        {contextLine}
      </Box>
      {actions ? (
        <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0, ...actionsSx }}>
          {actions}
          {closeButton}
        </Box>
      ) : (
        closeButton
      )}
    </Box>
  );
}

/**
 * 侧边栏组件通用外壳：Paper + 滑入内容容器 + 标题栏。
 *
 * @param {object} props
 * @param {boolean} props.open 侧边栏是否打开（驱动滑入/滑出动画）
 * @param {React.ReactNode} props.title 标题内容
 * @param {Function} [props.onClose] 关闭回调（提供时渲染关闭按钮）
 * @param {boolean} [props.closeDisabled] 传入布尔值时关闭按钮包裹 span 并支持禁用
 * @param {React.ReactNode} [props.actions] 标题栏中关闭按钮之前的额外操作按钮
 * @param {object} [props.actionsSx] 包裹 actions + 关闭按钮的 Box 样式
 * @param {object} [props.titleSx] 标题 Typography 样式
 * @param {object} [props.titleBarSx] 标题栏容器附加样式
 * @param {{ host?: string, protocol?: string, quality?: string, cwd?: string }} [props.sessionContext]
 * @param {object} [props.rootRef] 提供时启用外壳焦点管理（tabIndex=-1 + onMouseDown 聚焦）
 * @param {number} [props.elevation] Paper elevation；默认暗色 1 / 亮色 0
 * @param {boolean} [props.square] Paper square
 * @param {boolean} [props.borderLeft] 是否绘制左侧分隔线，默认 true
 * @param {object} [props.paperSx] Paper 附加样式（覆盖基础外壳样式）
 * @param {object} [props.paperProps] 透传给 Paper 的其他 props（如拖拽事件）
 */
function SidebarPanel({
  open,
  title,
  onClose,
  closeDisabled,
  actions,
  actionsSx,
  titleSx,
  titleBarSx,
  sessionContext,
  rootRef,
  elevation,
  square,
  borderLeft = true,
  paperSx,
  paperProps,
  children,
}) {
  const theme = useTheme();
  const resolvedElevation =
    elevation !== undefined
      ? elevation
      : theme.palette.mode === "dark"
        ? 1
        : 0;

  // 滑入/滑出期间开启 willChange，结束后清除
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    setAnimating(true);
  }, [open]);

  const handleTransitionEnd = (event) => {
    if (event.propertyName !== "transform") return;
    if (event.target !== event.currentTarget) return;
    setAnimating(false);
  };

  const focusSidebarRoot = (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const focusableTarget = event.target.closest(
      'input, textarea, select, button, [role="button"], [tabindex]',
    );
    if (focusableTarget && focusableTarget !== rootRef?.current) {
      return;
    }
    rootRef?.current?.focus({ preventScroll: true });
  };

  const focusProps = rootRef
    ? { ref: rootRef, tabIndex: -1, onMouseDown: focusSidebarRoot }
    : {};

  return (
    <Paper
      {...focusProps}
      elevation={resolvedElevation}
      square={square}
      sx={{ ...sidebarPaperSx(theme, { borderLeft }), ...paperSx }}
      {...paperProps}
    >
      <Box
        sx={sidebarContentSx(theme, open, { animating })}
        onTransitionEnd={handleTransitionEnd}
      >
        <SidebarTitleBar
          title={title}
          titleSx={titleSx}
          onClose={onClose}
          closeDisabled={closeDisabled}
          actions={actions}
          actionsSx={actionsSx}
          sessionContext={sessionContext}
          sx={titleBarSx}
        />
        {children}
      </Box>
    </Paper>
  );
}

export default SidebarPanel;
