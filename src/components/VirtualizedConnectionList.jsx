import React, {
  memo,
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";
import useAutoCleanup from "../hooks/useAutoCleanup";
import { List } from "react-window";
import {
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  useTheme,
  Collapse,
  IconButton,
} from "@mui/material";
import {
  Computer as ComputerIcon,
  Folder as FolderIcon,
  FolderOpen as FolderOpenIcon,
  ExpandMore as ExpandMoreIcon,
  DragIndicator as DragIndicatorIcon,
} from "@mui/icons-material";

// Connection group or item component for virtualization
const ConnectionItem = memo(({ index, style, ariaAttributes, flattenedItems, selectedItem, onToggleGroup, onSelectConnection, onDoubleClick, dragHandleProps, isDragging }) => {
  const theme = useTheme();

  const item = flattenedItems[index];
  if (!item) return null;

  const isSelected = selectedItem?.id === item.id;
  const isGroup = item.type === "group";
  const depth = item.depth || 0;
  const paddingLeft = 16 + depth * 20; // Indentation based on nesting level

  const handleClick = useCallback(() => {
    if (isGroup) {
      onToggleGroup(item.id);
    } else {
      onSelectConnection(item);
    }
  }, [item, isGroup, onToggleGroup, onSelectConnection]);

  const handleDoubleClick = useCallback(() => {
    if (onDoubleClick) {
      onDoubleClick(item);
    }
  }, [item, onDoubleClick]);

  const itemIcon = useMemo(() => {
    if (isGroup) {
      return item.expanded ? (
        <FolderOpenIcon color="primary" />
      ) : (
        <FolderIcon color="primary" />
      );
    }
    return <ComputerIcon color={item.connected ? "success" : "disabled"} />;
  }, [isGroup, item.expanded, item.connected]);

  return (
    <div style={style}>
      <ListItem
        disablePadding
        sx={{
          bgcolor: isSelected ? "action.selected" : "transparent",
          borderLeft: isSelected
            ? `3px solid ${theme.palette.primary.main}`
            : "3px solid transparent",
          opacity: isDragging ? 0.5 : 1,
        }}
      >
        <ListItemButton
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          sx={{
            pl: `${paddingLeft}px`,
            minHeight: 48,
            "&:hover": {
              backgroundColor: "action.hover",
            },
          }}
        >
          {/* Drag handle for reordering */}
          {dragHandleProps && (
            <Box
              {...dragHandleProps}
              sx={{
                display: "flex",
                alignItems: "center",
                mr: 1,
                cursor: "grab",
                opacity: 0.6,
                "&:hover": { opacity: 1 },
              }}
            >
              <DragIndicatorIcon fontSize="small" />
            </Box>
          )}

          <ListItemIcon sx={{ minWidth: 36 }}>{itemIcon}</ListItemIcon>

          <ListItemText
            primary={
              <Box display="flex" alignItems="center" gap={1}>
                <Typography
                  variant="body2"
                  color={isSelected ? "primary" : "text.primary"}
                  fontWeight={isSelected ? "medium" : "normal"}
                  noWrap
                >
                  {item.name}
                </Typography>
                {item.status && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{
                      px: 0.5,
                      py: 0.25,
                      borderRadius: 1,
                      bgcolor: "action.hover",
                    }}
                  >
                    {item.status}
                  </Typography>
                )}
              </Box>
            }
            secondary={
              !isGroup && item.host ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {item.username}@{item.host}:{item.port || 22}
                </Typography>
              ) : (
                isGroup && (
                  <Typography variant="caption" color="text.secondary">
                    {item.items?.length || 0} connections
                  </Typography>
                )
              )
            }
          />

          {/* Expand/Collapse for groups */}
          {isGroup && (
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                onToggleGroup(item.id);
              }}
              sx={{
                transform: item.expanded ? "rotate(180deg)" : "rotate(0deg)",
                transition: theme.transitions.create("transform"),
              }}
            >
              <ExpandMoreIcon />
            </IconButton>
          )}
        </ListItemButton>
      </ListItem>
    </div>
  );
});

ConnectionItem.displayName = "ConnectionItem";

// Flatten hierarchical connection data for virtualization
const flattenConnections = (
  connections,
  expandedGroups = new Set(),
  depth = 0,
) => {
  const flattened = [];

  connections.forEach((item) => {
    // Add the current item
    flattened.push({ ...item, depth });

    // If it's an expanded group, add its children
    if (
      item.type === "group" &&
      item.expanded &&
      expandedGroups.has(item.id) &&
      item.items
    ) {
      const children = flattenConnections(
        item.items,
        expandedGroups,
        depth + 1,
      );
      flattened.push(...children);
    }
  });

  return flattened;
};

// Calculate dynamic overscan based on list characteristics
const calculateOverscan = (
  itemCount,
  hasGroups,
  devicePerformance = "medium",
) => {
  const baseOverscan = 10;

  // Adjust for list size
  let sizeMultiplier = 1;
  if (itemCount > 500) {
    sizeMultiplier = 0.8;
  } else if (itemCount > 200) {
    sizeMultiplier = 0.9;
  } else if (itemCount < 50) {
    sizeMultiplier = 1.3;
  }

  // Adjust for complexity (groups require more overscan)
  const complexityMultiplier = hasGroups ? 1.2 : 1;

  // Device performance adjustment
  const performanceMultipliers = {
    low: 0.7,
    medium: 1,
    high: 1.4,
  };

  return Math.floor(
    baseOverscan *
      sizeMultiplier *
      complexityMultiplier *
      (performanceMultipliers[devicePerformance] || 1),
  );
};

// Main virtualized connection list component
const VirtualizedConnectionList = ({
  connections = [],
  selectedItem,
  onToggleGroup,
  onSelectConnection,
  onDoubleClick,
  height = 400,
  itemHeight = 48,
  enableVirtualization = true,
  devicePerformance = "medium",
  enableDragDrop = false,
  onReorder,
  searchTerm = "",
  emptyMessage = "No connections",
  className,
}) => {
  const theme = useTheme();
  const { addResizeObserver } = useAutoCleanup();
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  // Dynamic height calculation
  useEffect(() => {
    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.height > 0) {
          setContainerHeight(rect.height);
        }
      }
    };

    updateHeight();
    // addResizeObserver 返回资源ID，我们不需要在 useEffect 中返回它
    if (containerRef.current) {
      addResizeObserver(updateHeight, containerRef.current);
    }
    // useEffect 不应该返回 addResizeObserver 的返回值
    // eslint-disable-next-line consistent-return
  }, [addResizeObserver]);

  // Track expanded groups
  const handleToggleGroup = useCallback(
    (groupId) => {
      setExpandedGroups((prev) => {
        const newExpanded = new Set(prev);
        if (newExpanded.has(groupId)) {
          newExpanded.delete(groupId);
        } else {
          newExpanded.add(groupId);
        }
        return newExpanded;
      });
      onToggleGroup?.(groupId);
    },
    [onToggleGroup],
  );

  // Filter connections based on search term
  const filteredConnections = useMemo(() => {
    if (!searchTerm.trim()) {
      return connections;
    }

    const searchLower = searchTerm.toLowerCase();
    const filterRecursive = (items) => {
      return items
        .map((item) => {
          if (item.type === "group") {
            const filteredItems = item.items ? filterRecursive(item.items) : [];
            // Include group if it has matching children or matches itself
            if (
              filteredItems.length > 0 ||
              item.name.toLowerCase().includes(searchLower)
            ) {
              return { ...item, items: filteredItems };
            }
            return null;
          }

          // For connections, check name, host, username
          const matches =
            item.name.toLowerCase().includes(searchLower) ||
            item.host?.toLowerCase().includes(searchLower) ||
            item.username?.toLowerCase().includes(searchLower);
          return matches ? item : null;
        })
        .filter(Boolean);
    };

    return filterRecursive(connections);
  }, [connections, searchTerm]);

  // Flatten the hierarchical structure for virtualization
  const flattenedItems = useMemo(() => {
    return flattenConnections(filteredConnections, expandedGroups);
  }, [filteredConnections, expandedGroups]);

  // Check if we have groups (affects overscan calculation)
  const hasGroups = useMemo(() => {
    return flattenedItems.some((item) => item.type === "group");
  }, [flattenedItems]);

  // Calculate dynamic overscan
  const dynamicOverscan = useMemo(() => {
    return calculateOverscan(
      flattenedItems.length,
      hasGroups,
      devicePerformance,
    );
  }, [flattenedItems.length, hasGroups, devicePerformance]);

  // Prepare data for virtualized items
  const itemData = useMemo(
    () => ({
      flattenedItems,
      selectedItem,
      onToggleGroup: handleToggleGroup,
      onSelectConnection,
      onDoubleClick,
      dragHandleProps: enableDragDrop ? { "data-drag-handle": true } : null,
      isDragging: false,
    }),
    [
      flattenedItems,
      selectedItem,
      handleToggleGroup,
      onSelectConnection,
      onDoubleClick,
      enableDragDrop,
    ],
  );

  // Empty state
  if (flattenedItems.length === 0) {
    return (
      <Box
        ref={containerRef}
        className={className}
        sx={{
          height: height === "100%" ? "100%" : height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
          textAlign: "center",
          p: 3,
        }}
      >
        <Box>
          <ComputerIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
          <Typography variant="body2">
            {searchTerm ? "No matching connections found" : emptyMessage}
          </Typography>
        </Box>
      </Box>
    );
  }

  const actualHeight = height === "100%" ? containerHeight : height;

  // For small lists, use traditional rendering to avoid virtualization overhead
  if (!enableVirtualization || flattenedItems.length < 30) {
    return (
      <Box
        ref={containerRef}
        className={className}
        sx={{
          height: height === "100%" ? "100%" : height,
          overflow: "auto",
          "&::-webkit-scrollbar": { width: 8 },
          "&::-webkit-scrollbar-track": {
            backgroundColor: theme.palette.action.hover,
            borderRadius: 4,
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: theme.palette.action.disabled,
            borderRadius: 4,
            "&:hover": {
              backgroundColor: theme.palette.action.focus,
            },
          },
        }}
      >
        {flattenedItems.map((item, index) => (
          <ConnectionItem
            key={`${item.id}-${item.type}-${index}`}
            index={index}
            style={{ height: itemHeight }}
            {...itemData}
          />
        ))}
      </Box>
    );
  }

  // Virtualized rendering for large lists
  return (
    <Box
      ref={containerRef}
      className={className}
      sx={{
        height: height === "100%" ? "100%" : height,
        "& .react-window-list": {
          "&::-webkit-scrollbar": { width: 8 },
          "&::-webkit-scrollbar-track": {
            backgroundColor: theme.palette.action.hover,
            borderRadius: 4,
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: theme.palette.action.disabled,
            borderRadius: 4,
            "&:hover": {
              backgroundColor: theme.palette.action.focus,
            },
          },
        },
      }}
    >
      {actualHeight > 0 && (
        <List
          listRef={listRef}
          className="react-window-list"
          style={{ height: actualHeight, width: '100%' }}
          rowCount={flattenedItems.length}
          rowHeight={itemHeight}
          rowProps={itemData}
          overscanCount={dynamicOverscan}
          rowComponent={ConnectionItem}
          onRowsRendered={(visibleRows, allRows) => {
            // Performance monitoring in development
            if (
              typeof window !== "undefined" &&
              window.location?.hostname === "localhost"
            ) {
              console.debug(
                `虚拟化连接列表渲染: ${allRows.startIndex}-${allRows.stopIndex} / ${flattenedItems.length}`,
              );
            }
          }}
        />
      )}
    </Box>
  );
};

export default memo(VirtualizedConnectionList);
