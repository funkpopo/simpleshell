import { memo, useCallback, useMemo } from "react";
import { Box, List, ListItem, ListItemText } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { useTranslation } from "react-i18next";
import { ConnectionManagerSkeleton } from "../../../shared/ui/SkeletonLoader.jsx";
import VirtualizedConnectionList from "../VirtualizedConnectionList.jsx";
import {
  cloneConnectionList,
  dedupeConnectionsById,
  ROOT_CONTAINER_ID,
  getGroupContainerId,
  CONNECTION_LIST_VIRTUALIZATION_THRESHOLD,
  sortConnectionsByIp,
  countVisibleItems,
} from "../lib/connectionTree.js";
import { ConnectionListItem, GroupListItem } from "./ConnectionListItems.jsx";

function ConnectionList({
  searchQuery,
  connections,
  setConnections,
  isSavingRef,
  handleToggleGroup,
  openGroupContextMenuFromEvent,
  openConnectionContextMenuFromEvent,
  handleOpenConnection,
  connectionListContextMenu,
  connectionManagerListRootRef,
  handleBlankContextMenu,
  isLoading,
  handleVirtualizedItemContextMenu,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const filteredItems = useMemo(() => {
    let items;
    if (!searchQuery) {
      items = connections;
    } else {
      const lowercasedQuery = searchQuery.toLowerCase();
      items = connections.reduce((acc, item) => {
        if (item.type === "group") {
          const isGroupNameMatch = item.name
            .toLowerCase()
            .includes(lowercasedQuery);
          const matchingConnections = item.items.filter((c) =>
            c.name.toLowerCase().includes(lowercasedQuery),
          );

          if (isGroupNameMatch || matchingConnections.length > 0) {
            acc.push({
              ...item,
              items: isGroupNameMatch ? item.items : matchingConnections,
            });
          }
        } else {
          if (item.name.toLowerCase().includes(lowercasedQuery)) {
            acc.push(item);
          }
        }
        return acc;
      }, []);
    }

    const dedupedItems = dedupeConnectionsById(items);

    // 对根级别的项目进行排序，并对每个分组内的连接项进行排序
    const sortedItems = sortConnectionsByIp(dedupedItems).map((item) => {
      if (item.type === "group" && item.items) {
        return {
          ...item,
          items: sortConnectionsByIp(item.items),
        };
      }
      return item;
    });

    return sortedItems;
  }, [connections, searchQuery]);
  const visibleItemCount = useMemo(
    () => countVisibleItems(filteredItems),
    [filteredItems],
  );
  const useVirtualizedConnectionList =
    visibleItemCount >= CONNECTION_LIST_VIRTUALIZATION_THRESHOLD;
  const dragDisabled = searchQuery.length > 0 || useVirtualizedConnectionList;
  const handleDragEnd = useCallback(
    ({ active, over }) => {
      if (!over || dragDisabled) {
        return;
      }

      const activeId = active.id;
      const overId = over.id;

      if (activeId === overId) {
        return;
      }

      const activeData = active.data.current || {};
      const overData = over.data.current || {};

      const saveToConfig = (newConnections) => {
        setConnections(newConnections);
        if (window.terminalAPI?.saveConnections) {
          isSavingRef.current = true;
          window.terminalAPI.saveConnections(newConnections).finally(() => {
            setTimeout(() => {
              isSavingRef.current = false;
            }, 100);
          });
        }
      };

      const findContainerId = (itemId, items = connections) => {
        if (!itemId) {
          return null;
        }

        if (itemId === ROOT_CONTAINER_ID) {
          return ROOT_CONTAINER_ID;
        }

        if (items.some((entry) => entry.id === itemId)) {
          return ROOT_CONTAINER_ID;
        }

        for (const entry of items) {
          if (entry.type === "group") {
            const containerId = getGroupContainerId(entry.id);
            if (containerId === itemId) {
              return containerId;
            }
            if ((entry.items || []).some((child) => child.id === itemId)) {
              return containerId;
            }
          }
        }

        return null;
      };

      const updatedConnections = cloneConnectionList(connections);

      const getGroupIndexFromContainer = (containerId) => {
        if (containerId === ROOT_CONTAINER_ID) {
          return -1;
        }
        const groupId = containerId.replace("group-container-", "");
        return updatedConnections.findIndex((item) => item.id === groupId);
      };

      const sourceContainerId =
        activeData.parentId || findContainerId(activeId, updatedConnections);
      const destinationContainerId =
        overData.type === "container"
          ? overId
          : overData.parentId || findContainerId(overId, updatedConnections);

      if (!sourceContainerId || !destinationContainerId) {
        return;
      }

      if (activeData.type === "group") {
        if (destinationContainerId !== ROOT_CONTAINER_ID) {
          return;
        }

        const oldIndex = updatedConnections.findIndex(
          (item) => item.id === activeId,
        );
        if (oldIndex === -1) {
          return;
        }

        let newIndex = updatedConnections.findIndex(
          (item) => item.id === overId,
        );

        if (overData.type === "container" || newIndex === -1) {
          newIndex = updatedConnections.length - 1;
        }

        if (newIndex === oldIndex) {
          return;
        }

        saveToConfig(arrayMove(updatedConnections, oldIndex, newIndex));
        return;
      }

      if (activeData.type !== "connection") {
        return;
      }

      if (sourceContainerId === destinationContainerId) {
        if (sourceContainerId === ROOT_CONTAINER_ID) {
          const oldIndex = updatedConnections.findIndex(
            (item) => item.id === activeId,
          );
          let newIndex = updatedConnections.findIndex(
            (item) => item.id === overId,
          );

          if (overData.type === "container" || newIndex === -1) {
            newIndex = updatedConnections.length - 1;
          }

          if (oldIndex === -1 || newIndex === -1 || newIndex === oldIndex) {
            return;
          }

          saveToConfig(arrayMove(updatedConnections, oldIndex, newIndex));
          return;
        }

        const groupIndex = getGroupIndexFromContainer(sourceContainerId);
        if (groupIndex === -1) {
          return;
        }

        const group = updatedConnections[groupIndex];
        const items = Array.isArray(group.items) ? [...group.items] : [];
        const oldIndex = items.findIndex((item) => item.id === activeId);
        let newIndex = items.findIndex((item) => item.id === overId);

        if (overData.type === "container" || newIndex === -1) {
          newIndex = items.length - 1;
        }

        if (oldIndex === -1 || newIndex < 0 || newIndex === oldIndex) {
          updatedConnections[groupIndex] = {
            ...group,
            items,
          };
          return;
        }

        updatedConnections[groupIndex] = {
          ...group,
          items: arrayMove(items, oldIndex, newIndex),
        };

        saveToConfig(updatedConnections);
        return;
      }

      let draggedItem = null;

      if (sourceContainerId === ROOT_CONTAINER_ID) {
        const sourceIndex = updatedConnections.findIndex(
          (item) => item.id === activeId,
        );
        if (sourceIndex !== -1) {
          [draggedItem] = updatedConnections.splice(sourceIndex, 1);
        }
      } else {
        const sourceGroupIndex = getGroupIndexFromContainer(sourceContainerId);
        if (sourceGroupIndex !== -1) {
          const group = updatedConnections[sourceGroupIndex];
          const items = Array.isArray(group.items) ? [...group.items] : [];
          const itemIndex = items.findIndex((item) => item.id === activeId);
          if (itemIndex !== -1) {
            [draggedItem] = items.splice(itemIndex, 1);
            updatedConnections[sourceGroupIndex] = {
              ...group,
              items,
            };
          }
        }
      }

      if (!draggedItem || draggedItem.type !== "connection") {
        return;
      }

      if (destinationContainerId === ROOT_CONTAINER_ID) {
        let insertIndex = updatedConnections.findIndex(
          (item) => item.id === overId,
        );
        if (insertIndex === -1 || overData.type === "container") {
          insertIndex = updatedConnections.length;
        }
        updatedConnections.splice(insertIndex, 0, draggedItem);
        saveToConfig(updatedConnections);
        return;
      }

      const targetGroupIndex = getGroupIndexFromContainer(
        destinationContainerId,
      );
      if (targetGroupIndex === -1) {
        return;
      }

      const targetGroup = updatedConnections[targetGroupIndex];
      const targetItems = Array.isArray(targetGroup.items)
        ? [...targetGroup.items]
        : [];

      let insertIndex = targetItems.findIndex((item) => item.id === overId);
      if (
        overData.type !== "connection" ||
        overData.parentId !== destinationContainerId ||
        insertIndex === -1
      ) {
        insertIndex = targetItems.length;
      }

      targetItems.splice(insertIndex, 0, draggedItem);

      updatedConnections[targetGroupIndex] = {
        ...targetGroup,
        items: targetItems,
        expanded: true,
      };

      saveToConfig(updatedConnections);
    },
    [connections, dragDisabled],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const { setNodeRef: setRootDroppableRef, isOver: isRootDraggingOver } =
    useDroppable({
      id: ROOT_CONTAINER_ID,
      data: { type: "container", parentId: ROOT_CONTAINER_ID },
      disabled: dragDisabled,
    });
  const connectionsList = useMemo(() => {
    return (
      <SortableContext
        id={ROOT_CONTAINER_ID}
        items={filteredItems.map((item) => item.id)}
        strategy={verticalListSortingStrategy}
      >
        {filteredItems.map((item) =>
          item.type === "group" ? (
            <GroupListItem
              key={item.id}
              theme={theme}
              group={item}
              dragDisabled={dragDisabled}
              onToggle={handleToggleGroup}
              onOpenGroupRowContextMenu={openGroupContextMenuFromEvent}
              onOpenConnectionRowContextMenu={
                openConnectionContextMenuFromEvent
              }
              onOpenConnection={handleOpenConnection}
              contextMenuTarget={connectionListContextMenu}
            />
          ) : (
            <ConnectionListItem
              key={item.id}
              theme={theme}
              connection={item}
              parentGroup={null}
              onOpenRowContextMenu={openConnectionContextMenuFromEvent}
              onOpen={handleOpenConnection}
              dragDisabled={dragDisabled}
              isContextMenuTarget={
                connectionListContextMenu?.kind === "connection" &&
                connectionListContextMenu.connection?.id === item.id
              }
            />
          ),
        )}
      </SortableContext>
    );
  }, [
    filteredItems,
    theme,
    dragDisabled,
    handleToggleGroup,
    openConnectionContextMenuFromEvent,
    openGroupContextMenuFromEvent,
    handleOpenConnection,
    connectionListContextMenu,
  ]);
  return (
    <Box
      ref={connectionManagerListRootRef}
      data-connection-manager-list-root="true"
      onContextMenu={handleBlankContextMenu}
      sx={{
        // flex 布局下由 flexGrow 自然填满剩余空间，无需 calc 估算固定高度
        flexGrow: 1,
        minHeight: 0,
        overflow: "auto",
      }}
    >
      {isLoading ? (
        <List dense sx={{ p: 1 }}>
          <ConnectionManagerSkeleton />
        </List>
      ) : useVirtualizedConnectionList ? (
        <VirtualizedConnectionList
          className="connection-manager-virtualized-list"
          connections={filteredItems}
          selectedItem={
            connectionListContextMenu?.kind === "connection"
              ? connectionListContextMenu.connection
              : connectionListContextMenu?.kind === "group"
                ? connectionListContextMenu.group
                : null
          }
          onToggleGroup={handleToggleGroup}
          onSelectConnection={handleOpenConnection}
          onDoubleClick={handleOpenConnection}
          onItemContextMenu={handleVirtualizedItemContextMenu}
          onBlankContextMenu={handleBlankContextMenu}
          height="100%"
          itemHeight={36}
          enableVirtualization
          emptyMessage={t("connectionManager.noConnections")}
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <List
            dense
            ref={setRootDroppableRef}
            sx={{
              p: 1,
              minHeight: "100%",
              backgroundColor: isRootDraggingOver
                ? theme.palette.mode === "dark"
                  ? alpha(theme.palette.primary.main, 0.2)
                  : alpha(theme.palette.primary.main, 0.15)
                : "transparent",
              transition: "background-color 0.2s ease",
            }}
          >
            <>
              {connectionsList}
              {filteredItems.length === 0 && (
                <ListItem>
                  <ListItemText
                    primary={t("connectionManager.noConnections")}
                    primaryTypographyProps={{
                      variant: "body2",
                      sx: {
                        fontStyle: "italic",
                        color: "text.secondary",
                        textAlign: "center",
                      },
                    }}
                  />
                </ListItem>
              )}
            </>
          </List>
        </DndContext>
      )}
    </Box>
  );
}
export default memo(ConnectionList);
