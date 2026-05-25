import React, {
  useState,
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  IconButton,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Menu,
  Tooltip,
  InputAdornment,
  Switch,
  FormControlLabel,
  Divider,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { compactContextMenuPaperSx } from "./contextMenuStyles";
import ComputerIcon from "@mui/icons-material/Computer";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import SearchIcon from "@mui/icons-material/Search";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { alpha } from "@mui/material/styles";
import { countries } from "countries-list";
import { useTranslation } from "react-i18next";
import { useNotification } from "../contexts/NotificationContext";
import { ConnectionManagerSkeleton } from "./SkeletonLoader.jsx";
import VirtualizedConnectionList from "./VirtualizedConnectionList.jsx";
import { sidebarContentSx, sidebarListItemSx } from "./sidebarItemStyles";

const REDUCED_MOTION_QUERY = "@media (prefers-reduced-motion: reduce)";

// 自定义比较函数
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.open === nextProps.open &&
    prevProps.initialConnections === nextProps.initialConnections &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onConnectionsUpdate === nextProps.onConnectionsUpdate &&
    prevProps.onOpenConnection === nextProps.onOpenConnection
  );
};

const getConnectionTimestamp = (connection) => {
  if (!connection) {
    return null;
  }
  return (
    connection.updatedAt ??
    connection.modifiedAt ??
    connection.lastUpdated ??
    connection.lastModified ??
    connection.timestamp ??
    connection.meta?.updatedAt ??
    null
  );
};

const getConnectionVersion = (connection) => {
  if (!connection) {
    return "";
  }

  const timestamp = getConnectionTimestamp(connection);
  if (timestamp) {
    return String(timestamp);
  }

  if (connection.type === "group") {
    return [
      connection.name || "",
      connection.expanded ? "1" : "0",
      (connection.items || []).length,
    ].join("|");
  }

  const proxySignature = connection.proxy
    ? [
        connection.proxy.type || "",
        connection.proxy.host || "",
        connection.proxy.port ?? "",
        connection.proxy.username || "",
        connection.proxy.password || "",
        connection.proxy.useDefault ? "1" : "0",
      ].join("|")
    : "";

  return [
    connection.name || "",
    connection.host || "",
    connection.port ?? "",
    connection.username || "",
    connection.protocol || "",
    connection.connectionType || "",
    connection.authType || "",
    connection.privateKeyPath || "",
    connection.country || "",
    connection.os || "",
    connection.password || "",
    proxySignature,
  ].join("|");
};

const getSearchFieldMotionSx = (theme, { borderRadius = 2 } = {}) => {
  const focusOutlineColor =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.primary.light, 0.28)
      : alpha(theme.palette.primary.main, 0.22);
  const focusShadowColor =
    theme.palette.mode === "dark"
      ? alpha(theme.palette.primary.main, 0.28)
      : alpha(theme.palette.primary.main, 0.16);

  return {
    "& .MuiOutlinedInput-root": {
      borderRadius,
      transition:
        "transform 0.2s ease, box-shadow 0.2s ease, background-color 0.2s ease",
      transformOrigin: "center",
      "&:hover": {
        backgroundColor: theme.palette.background.paper,
      },
      "&.Mui-focused": {
        backgroundColor: theme.palette.background.paper,
        transform: "scale(1.01)",
        boxShadow: `0 0 0 1px ${focusOutlineColor}, 0 10px 24px ${focusShadowColor}`,
      },
      [REDUCED_MOTION_QUERY]: {
        transition: "box-shadow 0.2s ease, background-color 0.2s ease",
        "&.Mui-focused": {
          transform: "none",
        },
      },
    },
  };
};

const areConnectionListsEqual = (prevList = [], nextList = []) => {
  if (prevList === nextList) {
    return true;
  }

  if (!Array.isArray(prevList) || !Array.isArray(nextList)) {
    return false;
  }

  if (prevList.length !== nextList.length) {
    return false;
  }

  for (let index = 0; index < prevList.length; index += 1) {
    const prev = prevList[index];
    const next = nextList[index];

    if (!prev || !next) {
      return false;
    }

    if (
      (prev.id || "") !== (next.id || "") ||
      (prev.type || "") !== (next.type || "")
    ) {
      return false;
    }

    if (getConnectionVersion(prev) !== getConnectionVersion(next)) {
      return false;
    }

    const prevChildren = prev.items || [];
    const nextChildren = next.items || [];

    if (
      (prevChildren.length > 0 || nextChildren.length > 0) &&
      !areConnectionListsEqual(prevChildren, nextChildren)
    ) {
      return false;
    }
  }

  return true;
};

const cloneConnectionNode = (node) => {
  if (!node || typeof node !== "object") {
    return node;
  }

  const cloned = {
    ...node,
  };

  if (node.proxy && typeof node.proxy === "object") {
    cloned.proxy = { ...node.proxy };
  }

  if (Array.isArray(node.items)) {
    cloned.items = node.items.map(cloneConnectionNode);
  }

  return cloned;
};

const cloneConnectionList = (list = []) => list.map(cloneConnectionNode);

const dedupeConnectionsById = (list = []) => {
  if (!Array.isArray(list) || list.length === 0) {
    return [];
  }

  const seen = new Set();
  const deduped = [];

  list.forEach((item) => {
    if (!item || typeof item !== "object") {
      return;
    }

    const itemId = item.id || "";
    const dedupeKey = `${item.type || "unknown"}:${itemId}`;
    if (itemId && seen.has(dedupeKey)) {
      return;
    }
    if (itemId) {
      seen.add(dedupeKey);
    }

    if (item.type === "group" && Array.isArray(item.items)) {
      deduped.push({
        ...item,
        items: dedupeConnectionsById(item.items),
      });
      return;
    }

    deduped.push(item);
  });

  return deduped;
};

const ROOT_CONTAINER_ID = "connection-list";
const getGroupContainerId = (groupId) => `group-container-${groupId}`;
const CONNECTION_LIST_VIRTUALIZATION_THRESHOLD = 200;
const CONNECTION_MANAGER_ROW_DATA_ATTR = "data-connection-manager-item";

/** 复制到剪贴板的主机地址（去掉尾部 :port，保留 [IPv6] 形式） */
const getHostForClipboard = (connection) => {
  const raw = String(connection?.host ?? "").trim();
  if (!raw) {
    return "";
  }
  if (raw.startsWith("[")) {
    const end = raw.indexOf("]");
    if (end > 0) {
      return raw.slice(0, end + 1);
    }
    return raw;
  }
  const lastColon = raw.lastIndexOf(":");
  if (lastColon > 0) {
    const after = raw.slice(lastColon + 1);
    if (/^\d+$/.test(after)) {
      return raw.slice(0, lastColon);
    }
  }
  return raw;
};

// IP地址排序辅助函数
const parseIpAddress = (ipString) => {
  if (!ipString) return null;

  // 移除端口号（如果有的话）
  const ipWithoutPort = ipString.split(":")[0];

  // 支持IPv4格式
  const ipv4Parts = ipWithoutPort.split(".");
  if (ipv4Parts.length === 4) {
    const numericParts = ipv4Parts.map((part) => parseInt(part, 10));
    if (numericParts.every((num) => !isNaN(num) && num >= 0 && num <= 255)) {
      // 将IPv4转换为数字以便比较
      return (
        numericParts[0] * 16777216 +
        numericParts[1] * 65536 +
        numericParts[2] * 256 +
        numericParts[3]
      );
    }
  }

  // 如果不是有效的IP地址，返回null
  return null;
};

const sortConnectionsByIp = (connections) => {
  if (!Array.isArray(connections) || connections.length === 0) {
    return connections;
  }

  return [...connections].sort((a, b) => {
    // 分组类型始终按名称排序
    if (a.type === "group" && b.type === "group") {
      return (a.name || "").localeCompare(b.name || "");
    }

    // 分组始终在连接之前
    if (a.type === "group") return -1;
    if (b.type === "group") return 1;

    // 对于连接，按IP地址排序
    const ipA = parseIpAddress(a.host);
    const ipB = parseIpAddress(b.host);

    // 如果两个都有有效的IP地址，按数值排序
    if (ipA !== null && ipB !== null) {
      return ipA - ipB;
    }

    // 有效IP地址排在前面
    if (ipA !== null) return -1;
    if (ipB !== null) return 1;

    // 如果都不是有效IP，按主机名字符串排序
    return (a.host || "").localeCompare(b.host || "");
  });
};

const countVisibleItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    return 0;
  }

  return items.reduce((total, item) => {
    if (!item || typeof item !== "object") {
      return total;
    }

    if (item.type === "group") {
      const children = item.expanded ? countVisibleItems(item.items || []) : 0;
      return total + 1 + children;
    }

    return total + 1;
  }, 0);
};

const ConnectionListItem = memo(function ConnectionListItem({
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
        sx={{
          flexGrow: 1,
          py: 0.5,
          "&:hover": {
            backgroundColor: "transparent",
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 28, ml: -0.5 }}>
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
          sx={{
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
          }}
        />
      </ListItemButton>
    </ListItem>
  );
});

const GroupListItem = memo(function GroupListItem({
  theme,
  group,
  dragDisabled,
  onToggle,
  onOpenGroupRowContextMenu,
  onOpenConnectionRowContextMenu,
  onOpenConnection,
  contextMenuTarget = null,
}) {
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
          sx={{
            py: 0.5,
            flexGrow: 1,
            "&:hover": {
              backgroundColor: "transparent",
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 28, ml: -0.5 }}>
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
            sx={{ my: 0 }}
          />
        </ListItemButton>
      </ListItem>

      <Box
        ref={setGroupDroppableRef}
        sx={{
          backgroundColor: isOver
            ? theme.palette.mode === "dark"
              ? alpha(theme.palette.primary.main, 0.2)
              : alpha(theme.palette.primary.main, 0.15)
            : "transparent",
          transition: "all 0.2s ease",
          maxHeight: shouldShowChildren ? "none" : "0px",
          opacity: shouldShowChildren ? 1 : 0,
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
          <List
            component="div"
            disablePadding
            sx={{
              pl: 1.5,
              display: shouldShowChildren ? "block" : "none",
            }}
          >
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
              <ListItem sx={{ pl: 2 }}>
                <ListItemText
                  primary="没有连接项"
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
        </SortableContext>
      </Box>
    </React.Fragment>
  );
});

const ConnectionManager = memo(
  ({
    open,
    onClose,
    initialConnections = [],
    onConnectionsUpdate,
    onOpenConnection,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const { showError, showSuccess } = useNotification();
    const [connections, setConnections] = useState(initialConnections);
    const [isLoading, setIsLoading] = useState(!initialConnections.length);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef(null);
    const sidebarRootRef = useRef(null);
    const [connectionListContextMenu, setConnectionListContextMenu] =
      useState(null);
    const connectionManagerListRootRef = useRef(null);
    const connectionContextMenuRedispatchingRef = useRef(false);

    const focusSidebarRoot = (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const focusableTarget = event.target.closest(
        'input, textarea, select, button, [role="button"], [tabindex]',
      );
      if (focusableTarget && focusableTarget !== sidebarRootRef.current) {
        return;
      }
      sidebarRootRef.current?.focus({ preventScroll: true });
    };

    useEffect(() => {
      if (!open) {
        setConnectionListContextMenu(null);
      }
    }, [open]);

    // 键盘快捷键处理
    useEffect(() => {
      const handleKeyDown = (e) => {
        // 只在连接管理器打开时处理快捷键
        if (!open) return;

        // 检查当前焦点是否在终端区域内，如果是则不处理侧边栏快捷键
        const activeElement = document.activeElement;
        const isInTerminal =
          activeElement &&
          (activeElement.classList.contains("xterm-helper-textarea") ||
            activeElement.classList.contains("xterm-screen"));

        // 如果焦点在终端的输入区域内，则不处理侧边栏的快捷键
        if (isInTerminal) return;

        const isFocusInSidebar =
          activeElement && sidebarRootRef.current?.contains(activeElement);

        // Ctrl+/ 全局聚焦搜索框；Ctrl+F 仅在焦点位于侧边栏内时接管浏览器查找
        if (
          e.ctrlKey &&
          (e.key === "/" || (e.key.toLowerCase() === "f" && isFocusInSidebar))
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [open]);

    // 初始加载数据
    useEffect(() => {
      if (open && isLoading) {
        try {
          if (window.terminalAPI && window.terminalAPI.loadConnections) {
            window.terminalAPI
              .loadConnections()
              .then((data) => {
                if (data && Array.isArray(data)) {
                  setConnections(data);
                  if (onConnectionsUpdate) {
                    onConnectionsUpdate(data);
                  }
                }
                setIsLoading(false);
              })
              .catch(() => {
                showError(t("connectionManager.loadFailed"));
                setIsLoading(false);
              });
          } else {
            setIsLoading(false);
          }
        } catch {
          setIsLoading(false);
        }
      }
    }, [open, isLoading, onConnectionsUpdate]);

    // 添加监听配置变化的effect，确保连接列表实时更新
    // 使用 ref 来跟踪当前连接状态，避免在依赖项中使用 connections 导致无限循环
    const connectionsStateRef = useRef(connections);
    const isSavingRef = useRef(false); // 标记是否正在保存，用于忽略自己触发的变更事件

    // 更新 ref 以保持最新状态
    useEffect(() => {
      connectionsStateRef.current = connections;
    }, [connections]);

    useEffect(() => {
      if (!open) return;

      let isMounted = true; // 添加标志以避免组件卸载后的状态更新

      // 定义重新加载连接的函数
      const reloadConnections = () => {
        // 如果是自己触发的保存，忽略此次变更事件，避免重复加载
        if (isSavingRef.current) {
          return;
        }

        if (
          !isMounted ||
          !window.terminalAPI ||
          !window.terminalAPI.loadConnections
        ) {
          return;
        }

        window.terminalAPI
          .loadConnections()
          .then((data) => {
            if (isMounted && data && Array.isArray(data)) {
              // 检查数据是否真的发生了变化，避免不必要的重渲染
              const sanitized = Array.isArray(data) ? data : [];
              // 使用 ref 获取当前状态进行比较
              if (
                !areConnectionListsEqual(connectionsStateRef.current, sanitized)
              ) {
                setConnections(sanitized);
                if (onConnectionsUpdate) {
                  onConnectionsUpdate(sanitized);
                }
              }
            }
          })
          .catch(() => {
            if (isMounted) {
              showError(t("connectionManager.reloadFailed"));
            }
          });
      };

      // 监听连接配置变化事件
      if (window.terminalAPI && window.terminalAPI.onConnectionsChanged) {
        window.terminalAPI.onConnectionsChanged(reloadConnections);
      }

      // 组件卸载时清理监听器
      return () => {
        isMounted = false; // 设置标志为false
        if (window.terminalAPI && window.terminalAPI.offConnectionsChanged) {
          window.terminalAPI.offConnectionsChanged(reloadConnections);
        }
      };
    }, [open, onConnectionsUpdate]); // 移除 connections 依赖，使用 ref 代替

    // 当接收到新的initialConnections时更新 - 优化比较逻辑避免循环
    useEffect(() => {
      if (
        initialConnections.length > 0 &&
        initialConnections !== connections &&
        !areConnectionListsEqual(connections, initialConnections)
      ) {
        setConnections(initialConnections);
        setIsLoading(false);
      }
    }, [initialConnections]); // 移除connections依赖避免循环

    // 当连接数据变化时保存到文件 - 添加条件防止不必要的调用
    const connectionsRef = useRef(connections);
    const isUpdatingRef = useRef(false); // 添加一个标志来避免重复更新

    useEffect(() => {
      if (
        !isLoading &&
        onConnectionsUpdate &&
        connectionsRef.current !== connections &&
        !isUpdatingRef.current // 避免重复更新
      ) {
        connectionsRef.current = connections;
        isUpdatingRef.current = true; // 设置更新标志
        onConnectionsUpdate(connections);
        // 在下一个tick重置标志
        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    }, [connections, isLoading, onConnectionsUpdate]);

    // 关闭消息提示 - 不再需要
    // const handleSnackbarClose = useCallback(() => {
    //   setSnackbar((prev) => ({ ...prev, open: false }));
    // }, []);

    // 对话框状态
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogType, setDialogType] = useState(""); // 'connection' 或 'group'
    const [dialogMode, setDialogMode] = useState(""); // 'add' 或 'edit'
    const [selectedItem, setSelectedItem] = useState(null);

    // 确认删除对话框状态
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState(null);
    const [formData, setFormData] = useState({
      name: "",
      host: "",
      port: 22,
      username: "",
      password: "",
      authType: "password",
      privateKeyPath: "",
      parentGroup: "",
      country: "",
      os: "",
      connectionType: "",
      protocol: "ssh", // 新增：连接协议，默认为SSH
      // 代理配置
      enableProxy: false,
      proxyType: "http",
      proxyHost: "",
      proxyPort: 8080,
      proxyUsername: "",
      proxyPassword: "",
      proxyUseDefault: true, // 使用默认代理配置
    });

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

    // 处理组的展开/折叠 - 添加防抖和状态检查
    const handleToggleGroup = useCallback((groupId) => {
      setConnections((prevConnections) => {
        // 检查当前状态，避免重复更新
        const targetGroup = prevConnections.find(
          (item) => item.id === groupId && item.type === "group",
        );
        if (!targetGroup) return prevConnections;

        // 创建新的连接数组，确保React检测到变化
        const newConnections = prevConnections.map((item) => {
          if (item.id === groupId && item.type === "group") {
            return { ...item, expanded: !item.expanded };
          }
          return item;
        });

        // 保存到配置文件
        if (window.terminalAPI?.saveConnections) {
          isSavingRef.current = true;
          window.terminalAPI.saveConnections(newConnections).finally(() => {
            setTimeout(() => {
              isSavingRef.current = false;
            }, 100);
          });
        }

        // 确保状态更新
        return newConnections;
      });
    }, []);

    // 打开添加连接对话框
    const handleAddConnection = useCallback((parentGroupId = null) => {
      setSelectedItem(null);
      setDialogType("connection");
      setDialogMode("add");
      setFormData({
        name: "",
        host: "",
        port: 22,
        username: "",
        password: "",
        authType: "password",
        privateKeyPath: "",
        parentGroup: parentGroupId || "",
        country: "",
        os: "",
        connectionType: "",
        protocol: "ssh", // 默认为SSH
        // 代理配置（保持字段完整，避免 undefined）
        enableProxy: false,
        proxyType: "http",
        proxyHost: "",
        proxyPort: 8080,
        proxyUsername: "",
        proxyPassword: "",
        proxyUseDefault: true,
      });
      setDialogOpen(true);
    }, []);

    // 打开添加组对话框
    const handleAddGroup = useCallback(() => {
      setSelectedItem(null);
      setDialogType("group");
      setDialogMode("add");
      setFormData({
        name: "",
      });
      setDialogOpen(true);
    }, []);

    // 打开编辑对话框
    const handleEdit = useCallback((item, parentGroup = null) => {
      setSelectedItem({
        ...item,
        parentGroupId: parentGroup ? parentGroup.id : null,
      });
      setDialogMode("edit");

      if (item.type === "group") {
        setDialogType("group");
        setFormData({
          name: item.name,
        });
      } else {
        setDialogType("connection");
        // 确保端口值与协议类型匹配
        const port = item.port || (item.protocol === "telnet" ? 23 : 22);
        setFormData({
          name: item.name,
          host: item.host,
          port: port,
          username: item.username || "",
          password: item.password || "",
          authType: item.authType || "password",
          privateKeyPath: item.privateKeyPath || "",
          parentGroup: parentGroup ? parentGroup.id : "",
          country: item.country || "",
          os: item.os || "",
          connectionType: item.connectionType || "",
          protocol: item.protocol || "ssh",
          // 代理配置
          enableProxy: !!item.proxy,
          proxyType: item.proxy?.type || "http",
          proxyHost: item.proxy?.host || "",
          proxyPort: item.proxy?.port || 8080,
          proxyUsername: item.proxy?.username || "",
          proxyPassword: item.proxy?.password || "",
          proxyUseDefault:
            item.proxy?.useDefault !== undefined ? item.proxy.useDefault : true,
        });
      }

      setDialogOpen(true);
    }, []);

    // 删除项目 - 显示确认对话框
    const handleDelete = useCallback(
      (itemId, parentGroup = null) => {
        const item = parentGroup
          ? parentGroup.items.find((item) => item.id === itemId)
          : connections.find((item) => item.id === itemId);

        if (item) {
          setDeleteItem({ item, parentGroup, itemId });
          setDeleteConfirmOpen(true);
        }
      },
      [connections],
    );

    // 确认删除项目
    const handleConfirmDelete = useCallback(() => {
      if (!deleteItem) return;

      const { itemId, parentGroup } = deleteItem;
      let newConnections;

      if (parentGroup) {
        // 删除组内的连接
        newConnections = connections.map((group) =>
          group.id === parentGroup.id
            ? {
                ...group,
                items: group.items.filter((item) => item.id !== itemId),
              }
            : group,
        );
      } else {
        // 删除顶级项目
        newConnections = connections.filter((item) => item.id !== itemId);
      }

      // 更新本地状态
      setConnections(newConnections);

      // 保存到配置文件
      if (window.terminalAPI && window.terminalAPI.saveConnections) {
        // 设置标志，避免自己触发的变更事件导致重复加载
        isSavingRef.current = true;
        window.terminalAPI
          .saveConnections(newConnections)
          .catch(() => {
            showError(t("connectionManager.saveFailed"));
          })
          .finally(() => {
            // 延迟重置标志，确保变更事件已被处理
            setTimeout(() => {
              isSavingRef.current = false;
            }, 100);
          });
      }

      // 关闭确认对话框并清理状态
      setDeleteConfirmOpen(false);
      setDeleteItem(null);

      showSuccess(t("connectionManager.deleteSuccess"));
    }, [deleteItem, connections, t, showError, showSuccess]);

    // 取消删除
    const handleCancelDelete = useCallback(() => {
      setDeleteConfirmOpen(false);
      setDeleteItem(null);
    }, []);

    const handleConnectionListContextMenuClose = useCallback(() => {
      setConnectionListContextMenu(null);
    }, []);

    const openConnectionContextMenuFromEvent = useCallback(
      (event, connection, parentGroup) => {
        setConnectionListContextMenu({
          mouseX: event.clientX,
          mouseY: event.clientY,
          kind: "connection",
          connection,
          parentGroup: parentGroup ?? null,
        });
      },
      [],
    );

    const openGroupContextMenuFromEvent = useCallback((event, group) => {
      setConnectionListContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
        kind: "group",
        group,
      });
    }, []);

    const handleVirtualizedItemContextMenu = useCallback(
      (event, item, parentGroup) => {
        if (!item) {
          return;
        }
        if (item.type === "group") {
          openGroupContextMenuFromEvent(event, item);
        } else {
          openConnectionContextMenuFromEvent(event, item, parentGroup);
        }
      },
      [openConnectionContextMenuFromEvent, openGroupContextMenuFromEvent],
    );

    useEffect(() => {
      if (!open || !connectionListContextMenu) {
        return;
      }

      const getContextMenuRetargetElement = (event) => {
        const root = connectionManagerListRootRef.current;
        if (!root) {
          return null;
        }

        const rawTarget = event.target;
        if (
          rawTarget instanceof Element &&
          (rawTarget.closest('[data-connection-manager-context-menu="true"]') ||
            rawTarget.closest('[role="menu"]'))
        ) {
          return null;
        }

        if (rawTarget instanceof Element && root.contains(rawTarget)) {
          return rawTarget;
        }

        const elementsAtPoint =
          typeof document.elementsFromPoint === "function"
            ? document.elementsFromPoint(event.clientX, event.clientY)
            : [];

        return (
          elementsAtPoint.find(
            (element) =>
              root.contains(element) &&
              !element.closest(
                '[data-connection-manager-context-menu="true"]',
              ) &&
              !element.closest('[role="menu"]'),
          ) || null
        );
      };

      const handleContextMenuRetarget = (event) => {
        if (connectionContextMenuRedispatchingRef.current) {
          return;
        }

        const retargetElement = getContextMenuRetargetElement(event);
        if (!retargetElement) {
          return;
        }

        const itemEl =
          retargetElement.closest("[data-connection-manager-item]") ||
          retargetElement.closest(".MuiListItem-root") ||
          retargetElement;

        if (!itemEl) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        const mouseEventInit = {
          bubbles: true,
          cancelable: true,
          view: window,
          button: 2,
          buttons: 2,
          clientX: event.clientX,
          clientY: event.clientY,
          screenX: event.screenX,
          screenY: event.screenY,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          metaKey: event.metaKey,
        };

        flushSync(() => {
          setConnectionListContextMenu(null);
        });

        if (!itemEl.isConnected) {
          return;
        }

        try {
          itemEl.focus?.();
        } catch (_) {
          // ignore
        }

        connectionContextMenuRedispatchingRef.current = true;
        try {
          itemEl.dispatchEvent(new MouseEvent("contextmenu", mouseEventInit));
        } finally {
          connectionContextMenuRedispatchingRef.current = false;
        }
      };

      document.addEventListener("contextmenu", handleContextMenuRetarget, true);
      return () => {
        document.removeEventListener(
          "contextmenu",
          handleContextMenuRetarget,
          true,
        );
      };
    }, [connectionListContextMenu, open]);

    const handleDialogClose = useCallback(() => {
      setDialogOpen(false);
    }, []);

    const handleFormChange = useCallback((e) => {
      const { name, value } = e.target;

      setFormData((prev) => {
        // 如果修改的是协议字段，根据协议类型自动更新端口值
        if (name === "protocol") {
          const defaultPort = value === "telnet" ? 23 : 22;
          // 只有在端口是默认值时才更新，如果用户已手动修改则保留
          if (prev.port === 22 || prev.port === 23) {
            return { ...prev, [name]: value, port: defaultPort };
          }
        }
        return { ...prev, [name]: value };
      });
    }, []);

    const handleSave = useCallback(() => {
      // 验证必填字段
      if (!formData.name || !formData.name.trim()) {
        showError(t("connectionManager.nameRequired"));
        return;
      }

      // 只有在创建连接时才检查主机地址
      if (
        dialogType === "connection" &&
        (!formData.host || !formData.host.trim())
      ) {
        showError(t("connectionManager.hostRequired"));
        return;
      }

      if (dialogType === "group") {
        const groupData = {
          id: selectedItem?.id || `group_${Date.now()}`,
          type: "group",
          name: formData.name,
          items: selectedItem?.items || [],
        };

        let newConnections;
        if (dialogMode === "add") {
          newConnections = [...connections, groupData];
        } else {
          newConnections = connections.map((item) =>
            item.id === selectedItem.id
              ? { ...item, name: formData.name }
              : item,
          );
        }

        setConnections(newConnections);

        // 保存到配置文件
        if (window.terminalAPI && window.terminalAPI.saveConnections) {
          isSavingRef.current = true;
          window.terminalAPI
            .saveConnections(newConnections)
            .catch(() => {
              showError(t("connectionManager.saveFailed"));
            })
            .finally(() => {
              setTimeout(() => {
                isSavingRef.current = false;
              }, 100);
            });
        }

        setDialogOpen(false);
        showSuccess(
          dialogMode === "add"
            ? t("connectionManager.createSuccess")
            : t("connectionManager.updateSuccess"),
        );
        return;
      }

      // 处理连接保存
      const connectionData = {
        id:
          dialogMode === "add"
            ? `conn_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
            : selectedItem?.id || `conn_${Date.now()}`,
        type: "connection",
        name: formData.name,
        host: formData.host,
        port:
          parseInt(formData.port) || (formData.protocol === "ssh" ? 22 : 23),
        username: formData.username,
        password: formData.password,
        authType: formData.authType,
        privateKeyPath: formData.privateKeyPath,
        country: formData.country,
        os: formData.os,
        connectionType: formData.connectionType,
        protocol: formData.protocol,
        // 代理配置
        proxy: formData.enableProxy
          ? {
              type: formData.proxyType,
              host: formData.proxyHost,
              port: parseInt(formData.proxyPort) || 8080,
              username: formData.proxyUsername || undefined,
              password: formData.proxyPassword || undefined,
              useDefault: formData.proxyUseDefault,
            }
          : null,
      };

      // 保存到本地状态
      let newConnections;
      if (dialogMode === "add") {
        if (formData.parentGroup) {
          // 添加到组内
          newConnections = connections.map((item) =>
            item.id === formData.parentGroup
              ? { ...item, items: [...(item.items || []), connectionData] }
              : item,
          );
        } else {
          // 添加到顶级
          newConnections = [...connections, connectionData];
        }
      } else {
        // 编辑连接
        const oldParentId = selectedItem.parentGroupId;
        const newParentId = formData.parentGroup;

        if (oldParentId === newParentId) {
          // 分组未改变，原地更新
          if (oldParentId) {
            // 在组内编辑
            newConnections = connections.map((group) =>
              group.id === oldParentId
                ? {
                    ...group,
                    items: group.items.map((item) =>
                      item.id === selectedItem.id ? connectionData : item,
                    ),
                  }
                : group,
            );
          } else {
            // 在顶级编辑
            newConnections = connections.map((item) =>
              item.id === selectedItem.id ? connectionData : item,
            );
          }
        } else {
          // 分组已改变，先删除后添加
          let tempConnections = [...connections];

          // 1. 从旧位置移除
          if (oldParentId) {
            const oldGroupIndex = tempConnections.findIndex(
              (g) => g.id === oldParentId,
            );
            if (oldGroupIndex > -1) {
              tempConnections[oldGroupIndex] = {
                ...tempConnections[oldGroupIndex],
                items: tempConnections[oldGroupIndex].items.filter(
                  (i) => i.id !== selectedItem.id,
                ),
              };
            }
          } else {
            tempConnections = tempConnections.filter(
              (i) => i.id !== selectedItem.id,
            );
          }

          // 2. 添加到新位置
          if (newParentId) {
            const newGroupIndex = tempConnections.findIndex(
              (g) => g.id === newParentId,
            );
            if (newGroupIndex > -1) {
              tempConnections[newGroupIndex] = {
                ...tempConnections[newGroupIndex],
                items: [
                  ...(tempConnections[newGroupIndex].items || []),
                  connectionData,
                ],
              };
            }
          } else {
            tempConnections.push(connectionData);
          }

          newConnections = tempConnections;
        }
      }

      // 更新本地状态
      setConnections(newConnections);

      // 保存到配置文件
      if (window.terminalAPI && window.terminalAPI.saveConnections) {
        // 设置标志，避免自己触发的变更事件导致重复加载
        isSavingRef.current = true;
        window.terminalAPI
          .saveConnections(newConnections)
          .catch(() => {
            showError(t("connectionManager.saveFailed"));
          })
          .finally(() => {
            // 延迟重置标志，确保变更事件已被处理
            setTimeout(() => {
              isSavingRef.current = false;
            }, 100);
          });
      }

      setDialogOpen(false);
      showSuccess(
        dialogMode === "add"
          ? t("connectionManager.createSuccess")
          : t("connectionManager.updateSuccess"),
      );
    }, [
      dialogType,
      dialogMode,
      formData,
      selectedItem,
      connections,
      t,
      showError,
      showSuccess,
    ]);

    const handleOpenConnection = useCallback(
      (connection) => {
        if (onOpenConnection) {
          onOpenConnection(connection);
        }
      },
      [onOpenConnection],
    );

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
          const sourceGroupIndex =
            getGroupIndexFromContainer(sourceContainerId);
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
    ]);
    const groupOptions = useMemo(() => {
      return connections
        .filter((c) => c.type === "group")
        .map((group) => (
          <MenuItem key={group.id} value={group.id}>
            {group.name}
          </MenuItem>
        ));
    }, [connections]);

    const countryOptions = useMemo(() => {
      return Object.entries(countries).map(([code, country]) => (
        <MenuItem key={code} value={code}>
          {`(${country.native}) - ${country.name}`}
        </MenuItem>
      ));
    }, []);

    return (
      <Paper
        ref={sidebarRootRef}
        tabIndex={-1}
        onMouseDown={focusSidebarRoot}
        sx={{
          width: 300,
          height: "100%",
          overflow: "hidden",
          borderLeft: `1px solid ${theme.palette.divider}`,
          display: "flex",
          flexDirection: "column",
          borderRadius: 0,
        }}
        elevation={4}
      >
        <Box sx={sidebarContentSx(theme, open)}>
          {/* 头部 */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 1.25,
              py: 0.75,
              minHeight: 44,
              flexShrink: 0,
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              连接管理
            </Typography>
            <IconButton
              size="small"
              onClick={onClose}
              sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 18 } }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* 操作按钮区 */}
          <Box
            sx={{
              p: 1,
              display: "flex",
              justifyContent: "flex-end",
              borderBottom: 1,
              borderColor: "divider",
              gap: 1,
            }}
          >
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleAddConnection()}
              sx={{ fontSize: "0.75rem" }}
            >
              新建连接
            </Button>
            <Button
              size="small"
              startIcon={<FolderIcon />}
              onClick={handleAddGroup}
              sx={{ fontSize: "0.75rem" }}
            >
              新建分组
            </Button>
          </Box>

          {/* 搜索框 */}
          <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
            <TextField
              inputRef={searchInputRef}
              placeholder={t("connectionManager.search")}
              variant="outlined"
              size="small"
              fullWidth
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: searchQuery && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setSearchQuery("")}
                      edge="end"
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                ...getSearchFieldMotionSx(theme, {
                  borderRadius: 2,
                }),
              }}
            />
          </Box>

          {/* 连接列表区域 */}
          <Box
            ref={connectionManagerListRootRef}
            sx={{
              flexGrow: 1,
              overflow: "auto",
              height: "calc(100% - 160px)", // 调整高度以适应搜索框
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
                height="100%"
                itemHeight={36}
                enableVirtualization
                emptyMessage="没有连接项"
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
                          primary="没有连接项"
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

          <Menu
            open={Boolean(connectionListContextMenu)}
            onClose={handleConnectionListContextMenuClose}
            anchorReference="anchorPosition"
            anchorPosition={
              connectionListContextMenu
                ? {
                    top: connectionListContextMenu.mouseY,
                    left: connectionListContextMenu.mouseX,
                  }
                : undefined
            }
            transitionDuration={0}
            disableAutoFocusItem
            disableScrollLock
            PaperProps={{
              "data-connection-manager-context-menu": "true",
              sx: compactContextMenuPaperSx,
            }}
          >
            {connectionListContextMenu?.kind === "connection" && (
              <>
                <MenuItem
                  disabled={
                    !getHostForClipboard(connectionListContextMenu.connection)
                  }
                  onClick={() => {
                    const ctx = connectionListContextMenu;
                    if (!ctx || ctx.kind !== "connection") {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    const text = getHostForClipboard(ctx.connection);
                    if (!text) {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    handleConnectionListContextMenuClose();
                    window.clipboardAPI?.writeText(text).catch(() => {
                      showError(t("connectionManager.copyFailed"));
                    });
                  }}
                >
                  <ListItemIcon>
                    <ContentCopyIcon fontSize="small" />
                  </ListItemIcon>
                  {t("connectionManager.contextCopyIp")}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const ctx = connectionListContextMenu;
                    if (!ctx || ctx.kind !== "connection") {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    const { connection, parentGroup } = ctx;
                    handleConnectionListContextMenuClose();
                    handleEdit(connection, parentGroup ?? null);
                  }}
                >
                  <ListItemIcon>
                    <EditIcon fontSize="small" />
                  </ListItemIcon>
                  {t("common.edit")}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const ctx = connectionListContextMenu;
                    if (!ctx || ctx.kind !== "connection") {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    const { connection, parentGroup } = ctx;
                    handleConnectionListContextMenuClose();
                    handleDelete(connection.id, parentGroup ?? null);
                  }}
                >
                  <ListItemIcon>
                    <DeleteIcon fontSize="small" />
                  </ListItemIcon>
                  {t("connectionManager.delete")}
                </MenuItem>
              </>
            )}
            {connectionListContextMenu?.kind === "group" && (
              <>
                <MenuItem
                  onClick={() => {
                    const ctx = connectionListContextMenu;
                    if (!ctx || ctx.kind !== "group") {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    const groupId = ctx.group.id;
                    handleConnectionListContextMenuClose();
                    handleAddConnection(groupId);
                  }}
                >
                  <ListItemIcon>
                    <AddIcon fontSize="small" />
                  </ListItemIcon>
                  {t("connectionManager.contextAddConnection")}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const ctx = connectionListContextMenu;
                    if (!ctx || ctx.kind !== "group") {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    const { group } = ctx;
                    handleConnectionListContextMenuClose();
                    handleEdit(group);
                  }}
                >
                  <ListItemIcon>
                    <EditIcon fontSize="small" />
                  </ListItemIcon>
                  {t("common.edit")}
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    const ctx = connectionListContextMenu;
                    if (!ctx || ctx.kind !== "group") {
                      handleConnectionListContextMenuClose();
                      return;
                    }
                    const groupId = ctx.group.id;
                    handleConnectionListContextMenuClose();
                    handleDelete(groupId);
                  }}
                >
                  <ListItemIcon>
                    <DeleteIcon fontSize="small" />
                  </ListItemIcon>
                  {t("connectionManager.delete")}
                </MenuItem>
              </>
            )}
          </Menu>

          {/* 添加/编辑对话框 */}
          <Dialog
            open={dialogOpen}
            onClose={handleDialogClose}
            maxWidth="sm"
            fullWidth
            slotProps={{
              paper: {
                sx: {
                  maxHeight: "90vh",
                },
              },
            }}
          >
            <DialogTitle>
              {dialogMode === "add" ? "新建" : "编辑"}{" "}
              {dialogType === "connection" ? "连接" : "分组"}
            </DialogTitle>
            <DialogContent
              dividers
              sx={{
                overflow: "auto",
                maxHeight: "calc(90vh - 120px)",
              }}
            >
              <Box
                component="form"
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.5,
                  py: 1,
                }}
              >
                <TextField
                  label={t("common.name")}
                  name="name"
                  value={formData.name}
                  onChange={handleFormChange}
                  fullWidth
                  size="small"
                  required
                />

                {dialogType === "connection" && (
                  <>
                    <FormControl fullWidth size="small">
                      <InputLabel>{t("connectionManager.protocol")}</InputLabel>
                      <Select
                        name="protocol"
                        value={formData.protocol || "ssh"}
                        label={t("connectionManager.protocol")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="ssh">SSH</MenuItem>
                        <MenuItem value="telnet">Telnet</MenuItem>
                      </Select>
                    </FormControl>

                    <TextField
                      label={t("connectionManager.hostAddress")}
                      name="host"
                      value={formData.host}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      required
                    />

                    <TextField
                      label={t("connectionManager.port")}
                      name="port"
                      type="number"
                      value={formData.port}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      placeholder={formData.protocol === "telnet" ? "23" : "22"}
                    />

                    <TextField
                      label={t("connectionManager.username")}
                      name="username"
                      value={formData.username}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                    />

                    <TextField
                      label={t("connectionManager.password")}
                      name="password"
                      type="password"
                      value={formData.password}
                      onChange={handleFormChange}
                      fullWidth
                      size="small"
                      disabled={
                        formData.protocol === "ssh" &&
                        formData.authType === "privateKey"
                      }
                    />

                    {formData.protocol === "ssh" && (
                      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                        <InputLabel>
                          {t("connectionManager.authType")}
                        </InputLabel>
                        <Select
                          name="authType"
                          value={formData.authType || "password"}
                          label={t("connectionManager.authType")}
                          onChange={handleFormChange}
                        >
                          <MenuItem value="password">
                            {t("connectionManager.passwordAuth")}
                          </MenuItem>
                          <MenuItem value="privateKey">
                            {t("connectionManager.privateKeyAuth")}
                          </MenuItem>
                        </Select>
                      </FormControl>
                    )}

                    {formData.protocol === "ssh" &&
                      formData.authType === "privateKey" && (
                        <Box sx={{ display: "flex", mt: 1 }}>
                          <TextField
                            label={t("connectionManager.privateKeyPath")}
                            name="privateKeyPath"
                            value={formData.privateKeyPath}
                            onChange={handleFormChange}
                            fullWidth
                            size="small"
                            sx={{ flexGrow: 1 }}
                          />
                          <Button
                            variant="outlined"
                            size="small"
                            sx={{ ml: 1 }}
                            onClick={() => {
                              if (
                                window.terminalAPI &&
                                window.terminalAPI.selectKeyFile
                              ) {
                                window.terminalAPI
                                  .selectKeyFile()
                                  .then((result) => {
                                    if (
                                      result &&
                                      result.success &&
                                      result.path
                                    ) {
                                      setFormData((prev) => ({
                                        ...prev,
                                        privateKeyPath: result.path,
                                      }));
                                    }
                                  });
                              }
                            }}
                          >
                            {t("connectionManager.browse")}
                          </Button>
                        </Box>
                      )}

                    <FormControl fullWidth size="small">
                      <InputLabel>{t("connectionManager.group")}</InputLabel>
                      <Select
                        name="parentGroup"
                        value={formData.parentGroup || ""}
                        label={t("connectionManager.group")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="">
                          <em>{t("connectionManager.noGroup")}</em>
                        </MenuItem>
                        {groupOptions}
                      </Select>
                    </FormControl>

                    <FormControl fullWidth size="small">
                      <InputLabel>{t("connectionManager.type")}</InputLabel>
                      <Select
                        name="connectionType"
                        value={formData.connectionType || ""}
                        label={t("connectionManager.type")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="">
                          <em>{t("common.none")}</em>
                        </MenuItem>
                        <MenuItem value="VPS">VPS</MenuItem>
                        <MenuItem value="NAS">NAS</MenuItem>
                        <MenuItem value="BareMetal">
                          {t("connectionManager.bareMetal")}
                        </MenuItem>
                        <MenuItem value="Other">{t("common.other")}</MenuItem>
                      </Select>
                    </FormControl>

                    <FormControl fullWidth size="small">
                      <InputLabel>{t("connectionManager.os")}</InputLabel>
                      <Select
                        name="os"
                        value={formData.os || ""}
                        label={t("connectionManager.os")}
                        onChange={handleFormChange}
                      >
                        <MenuItem value="">
                          <em>{t("common.none")}</em>
                        </MenuItem>
                        <MenuItem value="Linux">Linux</MenuItem>
                        <MenuItem value="Windows">Windows</MenuItem>
                        <MenuItem value="macOS">macOS</MenuItem>
                        <MenuItem value="Other">{t("common.other")}</MenuItem>
                      </Select>
                    </FormControl>

                    <FormControl fullWidth size="small">
                      <InputLabel>
                        {t("connectionManager.countryRegion")}
                      </InputLabel>
                      <Select
                        name="country"
                        value={formData.country || ""}
                        label={t("connectionManager.countryRegion")}
                        onChange={handleFormChange}
                        MenuProps={{
                          PaperProps: {
                            style: {
                              maxHeight: 200,
                            },
                          },
                        }}
                      >
                        <MenuItem value="">
                          <em>{t("common.none")}</em>
                        </MenuItem>
                        {countryOptions}
                      </Select>
                    </FormControl>

                    {/* 代理配置分割线 */}
                    <Divider sx={{ my: 1 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t("connectionManager.proxyConfig")}
                      </Typography>
                    </Divider>

                    {/* 启用代理开关 */}
                    <FormControlLabel
                      control={
                        <Switch
                          checked={formData.enableProxy}
                          onChange={(e) =>
                            setFormData((prev) => ({
                              ...prev,
                              enableProxy: e.target.checked,
                            }))
                          }
                          size="small"
                        />
                      }
                      label={t("connectionManager.enableProxy")}
                    />

                    {/* 代理配置表单 */}
                    {formData.enableProxy && (
                      <>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={formData.proxyUseDefault}
                              onChange={(e) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  proxyUseDefault: e.target.checked,
                                }))
                              }
                              size="small"
                            />
                          }
                          label={t("connectionManager.useSystemProxy")}
                        />

                        {!formData.proxyUseDefault && (
                          <Box
                            sx={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 1.5,
                              pl: 2,
                              borderLeft: 2,
                              borderColor: "divider",
                            }}
                          >
                            <Box sx={{ display: "flex", gap: 1 }}>
                              <FormControl size="small" sx={{ minWidth: 100 }}>
                                <InputLabel>
                                  {t("connectionManager.type")}
                                </InputLabel>
                                <Select
                                  name="proxyType"
                                  value={formData.proxyType}
                                  label={t("connectionManager.type")}
                                  onChange={handleFormChange}
                                >
                                  <MenuItem value="http">HTTP</MenuItem>
                                  <MenuItem value="https">HTTPS</MenuItem>
                                  <MenuItem value="socks4">SOCKS4</MenuItem>
                                  <MenuItem value="socks5">SOCKS5</MenuItem>
                                </Select>
                              </FormControl>
                              <TextField
                                label={t("connectionManager.proxyHost")}
                                name="proxyHost"
                                value={formData.proxyHost}
                                onChange={handleFormChange}
                                size="small"
                                sx={{ flexGrow: 1 }}
                                placeholder="127.0.0.1"
                              />
                              <TextField
                                label={t("connectionManager.proxyPort")}
                                name="proxyPort"
                                type="number"
                                value={formData.proxyPort}
                                onChange={handleFormChange}
                                size="small"
                                sx={{ width: 90 }}
                                placeholder="8080"
                              />
                            </Box>

                            <Box sx={{ display: "flex", gap: 1 }}>
                              <TextField
                                label={t("connectionManager.proxyUsername")}
                                name="proxyUsername"
                                value={formData.proxyUsername}
                                onChange={handleFormChange}
                                size="small"
                                sx={{ flexGrow: 1 }}
                              />
                              <TextField
                                label={t("connectionManager.proxyPassword")}
                                name="proxyPassword"
                                type="password"
                                value={formData.proxyPassword}
                                onChange={handleFormChange}
                                size="small"
                                sx={{ flexGrow: 1 }}
                              />
                            </Box>
                          </Box>
                        )}
                      </>
                    )}
                  </>
                )}
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleDialogClose}>{t("common.cancel")}</Button>
              <Button onClick={handleSave} variant="contained">
                {t("common.save")}
              </Button>
            </DialogActions>
          </Dialog>

          {/* 删除确认对话框 */}
          <Dialog
            open={deleteConfirmOpen}
            onClose={handleCancelDelete}
            maxWidth="xs"
          >
            <DialogTitle>{t("connectionManager.confirmDelete")}</DialogTitle>
            <DialogContent>
              <Typography>
                {deleteItem?.item?.type === "group"
                  ? t("connectionManager.deleteGroupConfirm", {
                      name: deleteItem?.item?.name,
                    })
                  : t("connectionManager.deleteConnectionConfirm", {
                      name: deleteItem?.item?.name,
                    })}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                {t("connectionManager.cannotUndo")}
              </Typography>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleCancelDelete}>{t("common.cancel")}</Button>
              <Button
                onClick={handleConfirmDelete}
                variant="contained"
                color="error"
              >
                {t("common.delete")}
              </Button>
            </DialogActions>
          </Dialog>
        </Box>
      </Paper>
    );
  },
  areEqual,
);

// 设置显示名称用于调试
ConnectionManager.displayName = "ConnectionManager";

export default ConnectionManager;
