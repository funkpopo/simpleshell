import React, { memo, useMemo, useCallback } from "react";
import { List } from "react-window";
import { Box, ListItem, useTheme } from "@mui/material";
import ComputerIcon from "@mui/icons-material/Computer";
import { useTranslation } from "react-i18next";
import {
  CONNECTION_GROUP_ROW_HEIGHT,
  CONNECTION_LIST_DEPTH_INDENT_PX,
  CONNECTION_ROW_HEIGHT,
} from "../../shared/ui/sidebarItemStyles";
import SidebarEmptyState from "../../shared/ui/SidebarEmptyState.jsx";
import {
  ConnectionDragHandle,
  ConnectionPinButton,
  ConnectionRowButton,
  GroupRowButton,
  focusConnectionRow,
  getConnectionRowSx,
} from "./components/ConnectionListItems.jsx";

const LIST_STYLE = { flex: "1 1 0", minHeight: 0, width: "100%" };
const ROOT_SX = {
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};
const OVERSCAN_COUNT = 8;

// 行视觉与可拖拽列表（ConnectionListItems）完全共用，只是不挂载 dnd-kit：
// 连接数越过虚拟化阈值时，列表外观不发生切换。
const ConnectionItem = memo(function ConnectionItem({
  index,
  style,
  flattenedItems,
  rowSxByVariant,
  selectedItem,
  onToggleGroup,
  onSelectConnection,
  onDoubleClick,
  onTogglePin,
  pinLabel,
  unpinLabel,
  onItemContextMenu,
}) {
  const item = flattenedItems[index];
  if (!item) return null;

  const isGroup = item.type === "group";
  const depth = item.depth || 0;
  const selected = selectedItem?.id === item.id;
  const variantKey =
    (isGroup ? 4 : 0) | (depth > 0 ? 2 : 0) | (selected ? 1 : 0);

  const handleRowContextMenu = (event) => {
    if (!onItemContextMenu) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    focusConnectionRow(event);
    onItemContextMenu(event, item, item.parentGroup || null);
  };

  return (
    <div style={style}>
      <div
        style={
          depth > 0
            ? { paddingLeft: `${depth * CONNECTION_LIST_DEPTH_INDENT_PX}px` }
            : undefined
        }
      >
        <ListItem
          disablePadding
          onContextMenu={handleRowContextMenu}
          sx={rowSxByVariant[variantKey]}
        >
          <ConnectionDragHandle dragDisabled />
          {isGroup ? (
            <GroupRowButton
              group={item}
              onClick={() => onToggleGroup(item.id)}
            />
          ) : (
            <>
              <ConnectionRowButton
                connection={item}
                onClick={() => onSelectConnection(item)}
                onDoubleClick={
                  onDoubleClick ? () => onDoubleClick(item) : undefined
                }
              />
              {onTogglePin ? (
                <ConnectionPinButton
                  connection={item}
                  parentGroup={item.parentGroup || null}
                  onTogglePin={onTogglePin}
                  pinLabel={pinLabel}
                  unpinLabel={unpinLabel}
                />
              ) : null}
            </>
          )}
        </ListItem>
      </div>
    </div>
  );
});

ConnectionItem.displayName = "ConnectionItem";

// 展开的分组把子项摊平到同一列表中，并记录层级与所属分组
const flattenConnections = (
  connections,
  parentGroup = null,
  depth = 0,
  out = [],
) => {
  for (let i = 0; i < connections.length; i += 1) {
    const item = connections[i];
    out.push({
      ...item,
      depth,
      parentGroup,
    });

    if (item.type === "group" && item.expanded && item.items) {
      flattenConnections(item.items, item, depth + 1, out);
    }
  }

  return out;
};

const getRowHeight = (index, { flattenedItems }) =>
  flattenedItems[index]?.type === "group"
    ? CONNECTION_GROUP_ROW_HEIGHT
    : CONNECTION_ROW_HEIGHT;

// 大量连接（超过 CONNECTION_LIST_VIRTUALIZATION_THRESHOLD）时使用的窗口化列表。
// 过滤、排序由调用方完成；这里只负责摊平与按类型给出固定行高。
const VirtualizedConnectionList = ({
  connections = [],
  selectedItem,
  onToggleGroup,
  onSelectConnection,
  onDoubleClick,
  onTogglePin,
  onItemContextMenu,
  onBlankContextMenu,
  emptyMessage,
  className,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const pinLabel = t("connections.pinned.pin");
  const unpinLabel = t("connections.pinned.unpin");

  const rowSxByVariant = useMemo(
    () => [
      getConnectionRowSx(theme, {
        isGroup: false,
        nested: false,
        selected: false,
      }),
      getConnectionRowSx(theme, {
        isGroup: false,
        nested: false,
        selected: true,
      }),
      getConnectionRowSx(theme, {
        isGroup: false,
        nested: true,
        selected: false,
      }),
      getConnectionRowSx(theme, {
        isGroup: false,
        nested: true,
        selected: true,
      }),
      getConnectionRowSx(theme, {
        isGroup: true,
        nested: false,
        selected: false,
      }),
      getConnectionRowSx(theme, {
        isGroup: true,
        nested: false,
        selected: true,
      }),
      getConnectionRowSx(theme, {
        isGroup: true,
        nested: true,
        selected: false,
      }),
      getConnectionRowSx(theme, {
        isGroup: true,
        nested: true,
        selected: true,
      }),
    ],
    [theme],
  );

  const handleToggleGroup = useCallback(
    (groupId) => {
      onToggleGroup?.(groupId);
    },
    [onToggleGroup],
  );

  const flattenedItems = useMemo(
    () => flattenConnections(connections),
    [connections],
  );

  const rowProps = useMemo(
    () => ({
      flattenedItems,
      rowSxByVariant,
      selectedItem,
      onToggleGroup: handleToggleGroup,
      onSelectConnection,
      onDoubleClick,
      onTogglePin,
      pinLabel,
      unpinLabel,
      onItemContextMenu,
    }),
    [
      flattenedItems,
      rowSxByVariant,
      selectedItem,
      handleToggleGroup,
      onSelectConnection,
      onDoubleClick,
      onTogglePin,
      pinLabel,
      unpinLabel,
      onItemContextMenu,
    ],
  );

  if (flattenedItems.length === 0) {
    return (
      <Box
        className={className}
        onContextMenu={onBlankContextMenu}
        sx={ROOT_SX}
      >
        <SidebarEmptyState
          icon={<ComputerIcon />}
          message={emptyMessage || t("connectionManager.noConnections")}
        />
      </Box>
    );
  }

  return (
    <Box className={className} onContextMenu={onBlankContextMenu} sx={ROOT_SX}>
      <List
        className="react-window-list app-scrollbar"
        style={LIST_STYLE}
        rowCount={flattenedItems.length}
        rowHeight={getRowHeight}
        rowProps={rowProps}
        overscanCount={OVERSCAN_COUNT}
        rowComponent={ConnectionItem}
      />
    </Box>
  );
};

export default memo(VirtualizedConnectionList);
