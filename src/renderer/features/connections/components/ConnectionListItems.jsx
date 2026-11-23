import React, { memo } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Collapse,
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import UsbIcon from "@mui/icons-material/Usb";
import NetworkPingIcon from "@mui/icons-material/NetworkPing";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import OverflowTooltipText from "../../../shared/ui/OverflowTooltipText.jsx";
import {
  CONNECTION_GROUP_ROW_HEIGHT,
  CONNECTION_ROW_HEIGHT,
  sidebarListItemSx,
  CONNECTION_LIST_DEPTH_INDENT_PX,
} from "../../../shared/ui/sidebarItemStyles";
import {
  ROOT_CONTAINER_ID,
  getGroupContainerId,
  CONNECTION_MANAGER_ROW_DATA_ATTR,
} from "../lib/connectionTree.js";

/* ------------------------------------------------------------------------ */
/* 行视觉（可拖拽列表与虚拟化列表共用）                                     */
/* ------------------------------------------------------------------------ */

const PROTOCOL_ICON_COLORS = {
  telnet: "warning.main",
  serial: "info.main",
  mosh: "success.main",
};

export const ConnectionProtocolIcon = memo(function ConnectionProtocolIcon({
  protocol,
}) {
  const sx = PROTOCOL_ICON_COLORS[protocol]
    ? { color: PROTOCOL_ICON_COLORS[protocol] }
    : undefined;
  if (protocol === "serial") {
    return <UsbIcon fontSize="small" sx={sx} />;
  }
  if (protocol === "mosh") {
    return <NetworkPingIcon fontSize="small" sx={sx} />;
  }
  return <ComputerIcon fontSize="small" sx={sx} />;
});

export const getConnectionSecondaryText = (connection) =>
  connection.username
    ? `${connection.username}@${connection.host}`
    : connection.host;

/** 拖拽柄占位：禁用拖拽（搜索中、虚拟化列表）时保留同样的列宽，行内容不位移 */
export const ConnectionDragHandle = React.forwardRef(
  function ConnectionDragHandle({ dragDisabled, ...handleProps }, ref) {
    return (
      <Box
        ref={ref}
        {...handleProps}
        sx={
          dragDisabled
            ? viewStyles.dragHandleDisabledSx
            : viewStyles.dragHandleSx
        }
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>
    );
  },
);

/** 连接行主体：协议图标 + 色标圆点 + 名称 / 标签 / user@host，超长时悬停显示完整内容 */
export const ConnectionRowButton = memo(function ConnectionRowButton({
  connection,
  onClick,
  onDoubleClick,
}) {
  const primaryContent = connection.name || connection.host;
  const secondaryText = getConnectionSecondaryText(connection);
  const tags =
    Array.isArray(connection.tags) && connection.tags.length > 0
      ? connection.tags
      : null;
  const colorTag =
    typeof connection.colorTag === "string" ? connection.colorTag.trim() : "";

  const primaryNode =
    colorTag || tags ? (
      <span style={PRIMARY_ROW_STYLE}>
        {colorTag ? (
          <span
            aria-hidden="true"
            style={{
              ...COLOR_DOT_STYLE,
              backgroundColor: colorTag,
            }}
          />
        ) : null}
        <OverflowTooltipText
          variant="body2"
          sx={viewStyles.primaryTextSx}
          tooltipProps={viewStyles.tooltipProps}
        >
          {primaryContent}
        </OverflowTooltipText>
        {tags ? (
          <span style={INLINE_TAG_STYLE} title={tags.join(", ")}>
            {tags.length > 1 ? `${tags[0]} +${tags.length - 1}` : tags[0]}
          </span>
        ) : null}
      </span>
    ) : (
      <OverflowTooltipText
        variant="body2"
        sx={viewStyles.primaryTextSx}
        tooltipProps={viewStyles.tooltipProps}
      >
        {primaryContent}
      </OverflowTooltipText>
    );

  return (
    <ListItemButton
      {...{ [CONNECTION_MANAGER_ROW_DATA_ATTR]: "true" }}
      tabIndex={0}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      dense
      sx={viewStyles.listItemButtonSx}
    >
      <ListItemIcon sx={viewStyles.listItemIconSx}>
        <ConnectionProtocolIcon protocol={connection.protocol} />
      </ListItemIcon>
      <ListItemText
        disableTypography
        sx={viewStyles.listItemTextSx}
        primary={primaryNode}
        secondary={
          <OverflowTooltipText
            variant="caption"
            color="text.secondary"
            sx={viewStyles.secondaryTextSx}
            tooltipProps={viewStyles.tooltipProps}
          >
            {secondaryText}
          </OverflowTooltipText>
        }
      />
    </ListItemButton>
  );
});

export const ConnectionPinButton = memo(function ConnectionPinButton({
  connection,
  parentGroup = null,
  onTogglePin,
  pinLabel = "",
  unpinLabel = "",
}) {
  if (!onTogglePin || !connection) {
    return null;
  }
  const isPinned = connection.pinned === true;
  const label = isPinned ? unpinLabel : pinLabel;

  return (
    <button
      type="button"
      className="ss-conn-pin-btn"
      title={label}
      aria-label={label}
      aria-pressed={isPinned}
      style={isPinned ? PIN_BUTTON_ACTIVE_STYLE : PIN_BUTTON_INACTIVE_STYLE}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onTogglePin(connection, parentGroup);
      }}
    >
      {isPinned ? (
        <StarRoundedIcon style={PIN_ICON_STYLE} />
      ) : (
        <StarBorderRoundedIcon style={PIN_ICON_STYLE} />
      )}
    </button>
  );
});

/** 分组行主体：文件夹图标（随展开状态切换）+ 分组名 */
export const GroupRowButton = memo(function GroupRowButton({ group, onClick }) {
  return (
    <ListItemButton
      {...{ [CONNECTION_MANAGER_ROW_DATA_ATTR]: "true" }}
      tabIndex={0}
      aria-expanded={Boolean(group.expanded)}
      onClick={onClick}
      sx={viewStyles.groupButtonSx}
    >
      <ListItemIcon sx={viewStyles.listItemIconSx}>
        {group.expanded ? (
          <FolderOpenIcon fontSize="small" />
        ) : (
          <FolderIcon fontSize="small" />
        )}
      </ListItemIcon>
      <ListItemText
        disableTypography
        sx={viewStyles.listItemTextSx}
        primary={
          <OverflowTooltipText
            variant="body2"
            sx={viewStyles.primaryTextSx}
            tooltipProps={viewStyles.tooltipProps}
          >
            {group.name}
          </OverflowTooltipText>
        }
      />
    </ListItemButton>
  );
});

/** 行容器样式：连接行与分组行的高度、左内边距、选中/拖拽态 */
export const getConnectionRowSx = (
  theme,
  { isGroup = false, nested = false, selected = false, dragging = false } = {},
) => ({
  pl: nested ? 1.5 : 0.5,
  minHeight: isGroup ? CONNECTION_GROUP_ROW_HEIGHT : CONNECTION_ROW_HEIGHT,
  flexShrink: 0,
  ...sidebarListItemSx(theme, selected),
  ...(dragging
    ? {
        background:
          theme.palette.mode === "dark"
            ? theme.palette.grey[700]
            : theme.palette.grey[200],
        boxShadow: theme.shadows[4],
      }
    : {}),
});

// 右键时先把焦点移到行按钮，再打开菜单（与原生列表行为一致）
export const focusConnectionRow = (event) => {
  try {
    const focusTarget =
      event.currentTarget?.querySelector?.(
        `[${CONNECTION_MANAGER_ROW_DATA_ATTR}="true"]`,
      ) || event.currentTarget;
    focusTarget?.focus?.();
  } catch (_) {
    // ignore
  }
};

/* ------------------------------------------------------------------------ */
/* 可拖拽列表项                                                             */
/* ------------------------------------------------------------------------ */

export const ConnectionListItem = memo(function ConnectionListItem({
  theme,
  connection,
  parentGroup,
  onOpenRowContextMenu,
  onOpen,
  onTogglePin,
  pinLabel,
  unpinLabel,
  dragDisabled,
  isContextMenuTarget = false,
}) {
  const containerId = parentGroup
    ? getGroupContainerId(parentGroup.id)
    : ROOT_CONTAINER_ID;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: connection.id,
    data: {
      type: "connection",
      parentId: containerId,
      groupId: parentGroup?.id ?? null,
    },
    disabled: dragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      disablePadding
      sx={getConnectionRowSx(theme, {
        nested: Boolean(parentGroup),
        selected: isContextMenuTarget,
        dragging: isDragging,
      })}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        focusConnectionRow(e);
        onOpenRowContextMenu?.(e, connection, parentGroup);
      }}
    >
      <ConnectionDragHandle
        ref={setActivatorNodeRef}
        dragDisabled={dragDisabled}
        {...listeners}
        {...attributes}
      />
      <ConnectionRowButton
        connection={connection}
        onClick={() => onOpen(connection)}
      />
      {onTogglePin ? (
        <ConnectionPinButton
          connection={connection}
          parentGroup={parentGroup}
          onTogglePin={onTogglePin}
          pinLabel={pinLabel}
          unpinLabel={unpinLabel}
        />
      ) : null}
    </ListItem>
  );
});

export const GroupListItem = memo(function GroupListItem({
  theme,
  group,
  dragDisabled,
  onToggle,
  onOpenGroupRowContextMenu,
  onOpenConnectionRowContextMenu,
  onOpenConnection,
  onTogglePin,
  pinLabel,
  unpinLabel,
  contextMenuTarget = null,
}) {
  const { t } = useTranslation();
  const containerId = getGroupContainerId(group.id);

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: group.id,
    data: {
      type: "group",
      parentId: ROOT_CONTAINER_ID,
    },
    disabled: dragDisabled,
  });

  const { setNodeRef: setGroupDroppableRef, isOver } = useDroppable({
    id: containerId,
    data: {
      type: "container",
      parentId: containerId,
      groupId: group.id,
    },
    disabled: dragDisabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const shouldShowChildren = group.expanded || (isOver && !dragDisabled);
  const isContextMenuTarget =
    contextMenuTarget?.kind === "group" &&
    contextMenuTarget.group?.id === group.id;

  return (
    <React.Fragment>
      <ListItem
        disablePadding
        ref={setNodeRef}
        style={style}
        sx={getConnectionRowSx(theme, {
          isGroup: true,
          selected: isContextMenuTarget,
          dragging: isDragging,
        })}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          focusConnectionRow(e);
          onOpenGroupRowContextMenu?.(e, group);
        }}
      >
        <ConnectionDragHandle
          ref={setActivatorNodeRef}
          dragDisabled={dragDisabled}
          {...listeners}
          {...attributes}
        />
        <GroupRowButton group={group} onClick={() => onToggle(group.id)} />
      </ListItem>

      <Box
        ref={setGroupDroppableRef}
        data-connection-manager-group-area="true"
        onContextMenu={(e) => {
          // 分组内部空白（含“没有连接项”占位）右键：打开分组菜单
          if (
            e.target instanceof Element &&
            (e.target.closest(`[${CONNECTION_MANAGER_ROW_DATA_ATTR}]`) ||
              e.target.closest(".MuiListItemButton-root"))
          ) {
            return;
          }
          e.preventDefault();
          e.stopPropagation();
          onOpenGroupRowContextMenu?.(e, group);
        }}
        sx={{
          backgroundColor: isOver
            ? theme.palette.mode === "dark"
              ? alpha(theme.palette.primary.main, 0.2)
              : alpha(theme.palette.primary.main, 0.15)
            : "transparent",
          // max-height: none 不可插值、display 瞬时切换会让过渡失效并抖动，
          // 折叠动画交由 MUI Collapse（自动测量内容高度）处理
          transition: "background-color 0.2s ease, margin 0.2s ease",
          overflow: "hidden",
          borderRadius: !group.expanded && isOver ? 1 : 0,
          margin: !group.expanded && isOver ? "0 8px" : 0,
        }}
      >
        <SortableContext
          id={containerId}
          items={(group.items || []).map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          <Collapse in={shouldShowChildren} timeout={200} unmountOnExit>
            <List component="div" disablePadding sx={viewStyles.listSx}>
              {group.items &&
                group.items.map((item) => (
                  <ConnectionListItem
                    key={item.id}
                    theme={theme}
                    connection={item}
                    parentGroup={group}
                    onOpenRowContextMenu={onOpenConnectionRowContextMenu}
                    onOpen={onOpenConnection}
                    onTogglePin={onTogglePin}
                    pinLabel={pinLabel}
                    unpinLabel={unpinLabel}
                    dragDisabled={dragDisabled}
                    isContextMenuTarget={
                      contextMenuTarget?.kind === "connection" &&
                      contextMenuTarget.connection?.id === item.id
                    }
                  />
                ))}
              {(!group.items || group.items.length === 0) && (
                <ListItem sx={viewStyles.listItemSx}>
                  <ListItemText
                    slotProps={{
                      primary: {
                        variant: "caption",
                        sx: {
                          fontStyle: "italic",
                          color: "text.disabled",
                        },
                      },
                    }}
                    primary={t("connectionManager.noConnections")}
                  />
                </ListItem>
              )}
            </List>
          </Collapse>
        </SortableContext>
      </Box>
    </React.Fragment>
  );
});

/// Stable declarations shared by row renders. Dynamic styles stay with their owner.
const DRAG_HANDLE_BASE_SX = {
  display: "flex",
  alignItems: "center",
  minWidth: 20,
  justifyContent: "center",
  mr: 0.25,
  color: "text.secondary",
};

const PRIMARY_ROW_STYLE = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
};
const COLOR_DOT_STYLE = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  flexShrink: 0,
};
const INLINE_TAG_STYLE = {
  flexShrink: 0,
  maxWidth: 74,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: "0.625rem",
  lineHeight: 1.25,
  padding: "1px 4px",
  borderRadius: 6,
  backgroundColor: "rgba(128, 128, 128, 0.16)",
  opacity: 0.85,
};
const PIN_BUTTON_BASE_STYLE = {
  marginRight: 4,
  padding: 4,
  flexShrink: 0,
  background: "transparent",
  border: 0,
  borderRadius: "50%",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  lineHeight: 0,
};
const PIN_BUTTON_INACTIVE_STYLE = {
  ...PIN_BUTTON_BASE_STYLE,
  color: "inherit",
  opacity: 0.45,
};
const PIN_BUTTON_ACTIVE_STYLE = {
  ...PIN_BUTTON_BASE_STYLE,
  color: "#ed6c02",
  opacity: 1,
};
const PIN_ICON_STYLE = {
  fontSize: 16,
};

const viewStyles = {
  dragHandleSx: {
    ...DRAG_HANDLE_BASE_SX,
    cursor: "grab",
    "&:active": { cursor: "grabbing" },
  },
  dragHandleDisabledSx: {
    ...DRAG_HANDLE_BASE_SX,
    cursor: "default",
    pointerEvents: "none",
  },
  listItemButtonSx: {
    flexGrow: 1,
    minWidth: 0,
    py: 0.5,
    "&:hover": {
      backgroundColor: "transparent",
    },
  },
  groupButtonSx: {
    py: 0.5,
    flexGrow: 1,
    minWidth: 0,
    "&:hover": {
      backgroundColor: "transparent",
    },
  },
  listItemIconSx: { minWidth: 28, ml: -0.5 },
  listItemTextSx: { my: 0, minWidth: 0 },
  // 双行合计 ≤ 36px，保证 44px 固定行高（虚拟化）下不被裁切
  primaryTextSx: {
    fontWeight: 500,
    fontSize: "0.85rem",
    lineHeight: 1.35,
    minWidth: 0,
    flex: "1 1 auto",
  },
  secondaryTextSx: {
    lineHeight: 1.4,
  },
  tooltipProps: { placement: "top" },
  listSx: {
    // 每层缩进与虚拟化列表口径一致（20px/层）
    pl: CONNECTION_LIST_DEPTH_INDENT_PX / 8,
  },
  listItemSx: { pl: 2 },
};
