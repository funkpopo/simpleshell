import React, { useState, useEffect, memo, useRef } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Collapse,
  Tooltip,
} from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import UsbIcon from "@mui/icons-material/Usb";
import NetworkPingIcon from "@mui/icons-material/NetworkPing";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  sidebarListItemSx,
  CONNECTION_LIST_DEPTH_INDENT_PX,
} from "../../../shared/ui/sidebarItemStyles";
import {
  ROOT_CONTAINER_ID,
  getGroupContainerId,
  CONNECTION_MANAGER_ROW_DATA_ATTR,
} from "../lib/connectionTree.js";

export const ConnectionListItem = memo(function ConnectionListItem({
  theme,
  connection,
  parentGroup,
  onOpenRowContextMenu,
  onOpen,
  dragDisabled,
  isContextMenuTarget = false,
}) {
  const containerId = parentGroup
    ? getGroupContainerId(parentGroup.id)
    : ROOT_CONTAINER_ID;

  const primaryRef = useRef(null);
  const secondaryRef = useRef(null);
  const [isPrimaryTruncated, setIsPrimaryTruncated] = useState(false);
  const [isSecondaryTruncated, setIsSecondaryTruncated] = useState(false);

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

  const getProtocolIcon = () => {
    if (connection.protocol === "telnet") {
      return (
        <ComputerIcon
          fontSize="small"
          sx={{ color: theme.palette.warning.main }}
        />
      );
    }
    if (connection.protocol === "serial") {
      return (
        <UsbIcon fontSize="small" sx={{ color: theme.palette.info.main }} />
      );
    }
    if (connection.protocol === "mosh") {
      return (
        <NetworkPingIcon
          fontSize="small"
          sx={{ color: theme.palette.success.main }}
        />
      );
    }
    return <ComputerIcon fontSize="small" />;
  };

  const secondaryText = connection.username
    ? `${connection.username}@${connection.host}`
    : connection.host;

  const primaryContent = connection.name || connection.host;

  useEffect(() => {
    const checkTruncation = () => {
      if (primaryRef.current) {
        setIsPrimaryTruncated(
          primaryRef.current.scrollWidth > primaryRef.current.clientWidth,
        );
      }
      if (secondaryRef.current) {
        setIsSecondaryTruncated(
          secondaryRef.current.scrollWidth > secondaryRef.current.clientWidth,
        );
      }
    };
    checkTruncation();
  }, [primaryContent, secondaryText]);

  return (
    <ListItem
      ref={setNodeRef}
      style={style}
      disablePadding
      sx={{
        pl: parentGroup ? 1.5 : 0.5,
        minHeight: "32px",
        ...sidebarListItemSx(theme, isContextMenuTarget),
        ...(isDragging
          ? {
              background:
                theme.palette.mode === "dark"
                  ? theme.palette.grey[700]
                  : theme.palette.grey[200],
              boxShadow: theme.shadows[4],
            }
          : {}),
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          const focusTarget =
            e.currentTarget?.querySelector?.(
              `[${CONNECTION_MANAGER_ROW_DATA_ATTR}="true"]`,
            ) || e.currentTarget;
          focusTarget?.focus?.();
        } catch (_) {
          // ignore
        }
        onOpenRowContextMenu?.(e, connection, parentGroup);
      }}
    >
      <Box
        ref={setActivatorNodeRef}
        {...listeners}
        {...attributes}
        sx={{
          display: "flex",
          alignItems: "center",
          cursor: dragDisabled ? "default" : "grab",
          "&:active": {
            cursor: dragDisabled ? "default" : "grabbing",
          },
          minWidth: 20,
          justifyContent: "center",
          mr: 0.25,
          pointerEvents: dragDisabled ? "none" : "auto",
          color: "text.secondary",
        }}
      >
        <DragIndicatorIcon fontSize="small" />
      </Box>
      <ListItemButton
        {...{ [CONNECTION_MANAGER_ROW_DATA_ATTR]: "true" }}
        tabIndex={0}
        onClick={() => onOpen(connection)}
        dense
        sx={viewStyles.listItemButtonSx}
      >
        <ListItemIcon sx={viewStyles.listItemIconSx}>
          {getProtocolIcon()}
        </ListItemIcon>
        <ListItemText
          primary={
            <Tooltip
              title={primaryContent}
              placement="top"
              disableHoverListener={!isPrimaryTruncated}
            >
              <span ref={primaryRef}>{primaryContent}</span>
            </Tooltip>
          }
          primaryTypographyProps={{
            variant: "body2",
            fontWeight: "medium",
            margin: 0,
            fontSize: "0.85rem",
          }}
          secondary={
            <Tooltip
              title={secondaryText}
              placement="top"
              disableHoverListener={!isSecondaryTruncated}
            >
              <span ref={secondaryRef}>{secondaryText}</span>
            </Tooltip>
          }
          secondaryTypographyProps={{
            variant: "caption",
            color: "text.secondary",
          }}
          sx={viewStyles.listItemTextSx}
        />
      </ListItemButton>
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
        sx={{
          pl: 0.5,
          minHeight: "32px",
          ...sidebarListItemSx(theme, isContextMenuTarget),
          ...(isDragging
            ? {
                background:
                  theme.palette.mode === "dark"
                    ? theme.palette.grey[700]
                    : theme.palette.grey[200],
                boxShadow: theme.shadows[4],
              }
            : {}),
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            const focusTarget =
              e.currentTarget?.querySelector?.(
                `[${CONNECTION_MANAGER_ROW_DATA_ATTR}="true"]`,
              ) || e.currentTarget;
            focusTarget?.focus?.();
          } catch (_) {
            // ignore
          }
          onOpenGroupRowContextMenu?.(e, group);
        }}
      >
        <Box
          ref={setActivatorNodeRef}
          {...listeners}
          {...attributes}
          sx={{
            display: "flex",
            alignItems: "center",
            cursor: dragDisabled ? "default" : "grab",
            "&:active": {
              cursor: dragDisabled ? "default" : "grabbing",
            },
            minWidth: 20,
            justifyContent: "center",
            mr: 0.25,
            pointerEvents: dragDisabled ? "none" : "auto",
            color: "text.secondary",
          }}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
        <ListItemButton
          {...{ [CONNECTION_MANAGER_ROW_DATA_ATTR]: "true" }}
          tabIndex={0}
          onClick={() => onToggle(group.id)}
          sx={viewStyles.listItemButtonSx2}
        >
          <ListItemIcon sx={viewStyles.listItemIconSx}>
            {group.expanded ? (
              <FolderOpenIcon fontSize="small" />
            ) : (
              <FolderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={group.name}
            primaryTypographyProps={{
              variant: "body2",
              fontWeight: "medium",
              margin: 0,
              fontSize: "0.85rem",
            }}
            sx={viewStyles.listItemTextSx2}
          />
        </ListItemButton>
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
                    primary={t("connectionManager.noConnections")}
                    primaryTypographyProps={{
                      variant: "caption",
                      sx: {
                        fontStyle: "italic",
                        color: "text.disabled",
                      },
                    }}
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

// Stable declarations shared by row renders. Dynamic styles stay with their owner.
const viewStyles = {
  listItemButtonSx: {
    flexGrow: 1,
    py: 0.5,
    "&:hover": {
      backgroundColor: "transparent",
    },
  },
  listItemIconSx: { minWidth: 28, ml: -0.5 },
  listItemTextSx: {
    my: 0,
    ".MuiTypography-root": {
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      "& > span": {
        display: "block",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
    },
  },
  listItemButtonSx2: {
    py: 0.5,
    flexGrow: 1,
    "&:hover": {
      backgroundColor: "transparent",
    },
  },
  listItemTextSx2: { my: 0 },
  listSx: {
    // 每层缩进与虚拟化列表口径一致（20px/层）
    pl: CONNECTION_LIST_DEPTH_INDENT_PX / 8,
  },
  listItemSx: { pl: 2 },
};
