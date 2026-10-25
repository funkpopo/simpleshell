import React, { memo } from "react";
import Box from "@mui/material/Box";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import {
  SIDEBAR_COMMAND_ROW_HEIGHT,
  SIDEBAR_ROW_GAP_PX,
  sidebarListItemButtonSx,
} from "./sidebarItemStyles";

export {
  SIDEBAR_COMMAND_ROW_HEIGHT,
  SIDEBAR_COMMAND_ROW_PITCH,
} from "./sidebarItemStyles";

export const SIDEBAR_MONO_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

// flexShrink:0：直接渲染在纵向 flex 列表区时保持固定行高，由列表区滚动
const ROW_SX = {
  display: "flex",
  flexShrink: 0,
  height: SIDEBAR_COMMAND_ROW_HEIGHT,
  mb: `${SIDEBAR_ROW_GAP_PX}px`,
  width: "100%",
  boxSizing: "border-box",
};

const ACTIONS_SX = {
  display: "flex",
  gap: 0.25,
  position: "absolute",
  right: 2,
  top: "50%",
  transform: "translateY(-50%)",
  flexShrink: 0,
};

const CHECKBOX_SLOT_SX = { minWidth: 36 };

const TEXT_SLOT_SX = { flex: 1, minWidth: 0 };

const LABEL_SX = {
  color: "text.secondary",
  lineHeight: 1.15,
  mb: 0.25,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const COMMAND_SX = {
  color: "text.primary",
  fontFamily: SIDEBAR_MONO_FONT_FAMILY,
  fontSize: "0.82rem",
  fontWeight: 500,
  lineHeight: 1.35,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

/** 行尾操作按钮的统一尺寸与配色（主操作 / 次要操作） */
export const sidebarRowActionSx = {
  primary: {
    width: 26,
    height: 26,
    color: "primary.main",
    bgcolor: "transparent",
    "&:hover": { bgcolor: "action.hover" },
    "& .MuiSvgIcon-root": { fontSize: 16 },
  },
  secondary: {
    width: 26,
    height: 26,
    color: "text.secondary",
    bgcolor: "transparent",
    "&:hover": { color: "text.primary", bgcolor: "action.hover" },
    "& .MuiSvgIcon-root": { fontSize: 16 },
  },
};

/** 命令文本：可选的名称（caption）+ 等宽命令行，均单行省略 */
export const SidebarCommandText = memo(function SidebarCommandText({
  label,
  command,
}) {
  return (
    <Box sx={TEXT_SLOT_SX}>
      {label ? (
        <Typography variant="caption" component="div" sx={LABEL_SX}>
          {label}
        </Typography>
      ) : null}
      <Typography variant="body2" component="div" sx={COMMAND_SX}>
        {command}
      </Typography>
    </Box>
  );
});

/**
 * 命令类侧栏的统一行外壳：固定高度、选中/悬停配色、可选复选框与行尾操作。
 * 调用方负责 memo（行尾操作需要各自的翻译 tooltip/aria-label）。
 * 额外 props（如 data-* 标记）透传给 ListItemButton。
 */
export default function SidebarCommandRow({
  selected = false,
  checkbox = null,
  actions = null,
  onClick,
  onContextMenu,
  children,
  ...buttonProps
}) {
  const theme = useTheme();
  return (
    <ListItem disablePadding sx={ROW_SX}>
      <ListItemButton
        disableGutters
        onClick={onClick}
        onContextMenu={onContextMenu}
        {...buttonProps}
        sx={[
          sidebarListItemButtonSx(theme, selected),
          {
            position: "relative",
            flex: 1,
            minWidth: 0,
            height: "100%",
            py: 0.5,
            pl: checkbox ? 0.5 : 1,
            pr: actions ? 6.75 : 1,
            boxSizing: "border-box",
          },
        ]}
      >
        {checkbox ? (
          <ListItemIcon sx={CHECKBOX_SLOT_SX}>{checkbox}</ListItemIcon>
        ) : null}
        {children}
        {actions ? <Box sx={ACTIONS_SX}>{actions}</Box> : null}
      </ListItemButton>
    </ListItem>
  );
}
