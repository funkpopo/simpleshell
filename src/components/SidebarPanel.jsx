import React from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
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
 * 侧边栏标题栏：标题 + 可选附加操作按钮 + 关闭按钮。
 * 也可独立使用（如 FileManager 保留自有 Paper 外壳时）。
 */
export function SidebarTitleBar({
  title,
  titleSx,
  onClose,
  closeDisabled,
  actions,
  actionsSx,
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

  return (
    <Box sx={{ ...sidebarTitleBarSx(theme), ...sx }}>
      <Typography variant="subtitle1" fontWeight="medium" sx={titleSx}>
        {title}
      </Typography>
      {actions ? (
        <Box sx={actionsSx}>
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
 * @param {object} [props.rootRef] 提供时启用外壳焦点管理（tabIndex=-1 + onMouseDown 聚焦）
 * @param {number} [props.elevation] Paper elevation，默认 4
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
  rootRef,
  elevation = 4,
  square,
  borderLeft = true,
  paperSx,
  paperProps,
  children,
}) {
  const theme = useTheme();

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
      elevation={elevation}
      square={square}
      sx={{ ...sidebarPaperSx(theme, { borderLeft }), ...paperSx }}
      {...paperProps}
    >
      <Box sx={sidebarContentSx(theme, open)}>
        <SidebarTitleBar
          title={title}
          titleSx={titleSx}
          onClose={onClose}
          closeDisabled={closeDisabled}
          actions={actions}
          actionsSx={actionsSx}
          sx={titleBarSx}
        />
        {children}
      </Box>
    </Paper>
  );
}

export default SidebarPanel;
