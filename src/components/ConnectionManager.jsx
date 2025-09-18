import React, {
  useState,
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
} from "react";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Collapse,
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
  Snackbar,
  Alert,
  Tooltip,
  InputAdornment,
  Switch,
  FormControlLabel,
  Divider,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import { DragDropContext, Draggable } from "react-beautiful-dnd";
import { Droppable } from "./CustomDragDrop.jsx";
import { arrayMoveImmutable } from "array-move";
import { alpha } from "@mui/material/styles";
import { countries } from "countries-list";
import { ConnectionManagerSkeleton } from "./SkeletonLoader.jsx";

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

    if ((prev.id || "") !== (next.id || "") || (prev.type || "") !== (next.type || "")) {
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

const ConnectionManager = memo(
  ({
    open,
    onClose,
    initialConnections = [],
    onConnectionsUpdate,
    onOpenConnection,
  }) => {
    const theme = useTheme();
    const [connections, setConnections] = useState(initialConnections);
    const [isLoading, setIsLoading] = useState(!initialConnections.length);
    const [searchQuery, setSearchQuery] = useState("");
    const searchInputRef = useRef(null);
    const [snackbar, setSnackbar] = useState({
      open: false,
      message: "",
      severity: "info",
    });

    // 使用 useRef 存储稳定的渲染函数引用
    const renderConnectionItemRef = useRef();

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

        // Ctrl+/ 聚焦到搜索框
        if (e.ctrlKey && e.key === "/") {
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
              .catch((error) => {
                setSnackbar({
                  open: true,
                  message: "加载连接配置失败",
                  severity: "error",
                });
                setIsLoading(false);
              });
          } else {
            setIsLoading(false);
          }
        } catch (error) {
          setIsLoading(false);
        }
      }
    }, [open, isLoading, onConnectionsUpdate]);

    // 添加监听配置变化的effect，确保连接列表实时更新
    useEffect(() => {
      if (!open) return;

      let isMounted = true; // 添加标志以避免组件卸载后的状态更新

      // 定义重新加载连接的函数
      const reloadConnections = () => {
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
              if (!areConnectionListsEqual(connections, sanitized)) {
                setConnections(sanitized);
                if (onConnectionsUpdate) {
                  onConnectionsUpdate(sanitized);
                }
              }
            }
          })
          .catch((error) => {
            if (isMounted) {
              setSnackbar({
                open: true,
                message: "重新加载连接配置失败",
                severity: "error",
              });
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
    }, [open, onConnectionsUpdate, connections]);

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

    // 关闭消息提示
    const handleSnackbarClose = useCallback(() => {
      setSnackbar((prev) => ({ ...prev, open: false }));
    }, []);

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
      if (!searchQuery) {
        return connections;
      }
      const lowercasedQuery = searchQuery.toLowerCase();
      return connections.reduce((acc, item) => {
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

        // 确保状态更新
        return newConnections;
      });
    }, []);

    // 打开添加连接对话框
    const handleAddConnection = useCallback((parentGroupId = null) => {
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
      });
      setDialogOpen(true);
    }, []);

    // 打开添加组对话框
    const handleAddGroup = useCallback(() => {
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
        window.terminalAPI.saveConnections(newConnections).catch((error) => {
          setSnackbar({
            open: true,
            message: "保存连接配置失败",
            severity: "error",
          });
        });
      }

      // 关闭确认对话框并清理状态
      setDeleteConfirmOpen(false);
      setDeleteItem(null);

      setSnackbar({
        open: true,
        message: "删除成功",
        severity: "success",
      });
    }, [deleteItem, connections]);

    // 取消删除
    const handleCancelDelete = useCallback(() => {
      setDeleteConfirmOpen(false);
      setDeleteItem(null);
    }, []);

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
        setSnackbar({
          open: true,
          message: "名称不能为空",
          severity: "error",
        });
        return;
      }

      // 只有在创建连接时才检查主机地址
      if (
        dialogType === "connection" &&
        (!formData.host || !formData.host.trim())
      ) {
        setSnackbar({
          open: true,
          message: "主机地址不能为空",
          severity: "error",
        });
        return;
      }

      if (dialogType === "group") {
        const groupData = {
          id: selectedItem?.id || `group_${Date.now()}`,
          type: "group",
          name: formData.name,
          items: selectedItem?.items || [],
        };

        if (dialogMode === "add") {
          setConnections((prevConnections) => [...prevConnections, groupData]);
        } else {
          setConnections((prevConnections) =>
            prevConnections.map((item) =>
              item.id === selectedItem.id
                ? { ...item, name: formData.name }
                : item,
            ),
          );
        }
        setDialogOpen(false);
        setSnackbar({
          open: true,
          message: `${dialogMode === "add" ? "创建" : "更新"}成功`,
          severity: "success",
        });
        return;
      }

      // 处理连接保存
      const connectionData = {
        id: selectedItem?.id || `conn_${Date.now()}`,
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
        window.terminalAPI.saveConnections(newConnections).catch((error) => {
          setSnackbar({
            open: true,
            message: "保存连接配置失败",
            severity: "error",
          });
        });
      }

      setDialogOpen(false);
      setSnackbar({
        open: true,
        message: `${dialogMode === "add" ? "创建" : "更新"}成功`,
        severity: "success",
      });
    }, [dialogType, dialogMode, formData, selectedItem, connections]);

    const handleOpenConnection = useCallback(
      (connection) => {
        if (onOpenConnection) {
          onOpenConnection(connection);
        }
      },
      [onOpenConnection],
    );

    const handleDragEnd = useCallback(
      (result) => {
        if (!result.destination) return;

        const { source, destination, type, draggableId } = result;

        // 创建连接数据的深拷贝，避免直接修改状态
        let newConnections = cloneConnectionList(connections);

        // 如果是在同一个容器内拖拽
        if (source.droppableId === destination.droppableId) {
          // 处理顶级项目拖拽
          if (source.droppableId === "connection-list") {
            newConnections = arrayMoveImmutable(
              newConnections,
              source.index,
              destination.index,
            );
            setConnections(newConnections);
            return;
          }

          // 处理组内项目拖拽
          const groupId = source.droppableId;
          const groupIndex = newConnections.findIndex(
            (item) => item.id === groupId,
          );

          if (groupIndex !== -1 && newConnections[groupIndex].items) {
            const newItems = arrayMoveImmutable(
              newConnections[groupIndex].items,
              source.index,
              destination.index,
            );
            newConnections[groupIndex].items = newItems;
            setConnections(newConnections);
          }
          return;
        }
        // 处理跨容器拖拽
        else {
          // 获取被拖拽的项目
          let draggedItem = null;

          if (source.droppableId === "connection-list") {
            const removedItems = newConnections.splice(source.index, 1);
            draggedItem = removedItems[0] || null;
          } else {
            const sourceGroupId = source.droppableId;
            const sourceGroupIndex = newConnections.findIndex(
              (item) => item.id === sourceGroupId,
            );

            if (sourceGroupIndex !== -1) {
              const sourceGroup = newConnections[sourceGroupIndex];
              const sourceItems = Array.isArray(sourceGroup.items)
                ? [...sourceGroup.items]
                : [];
              const removed = sourceItems.splice(source.index, 1);
              draggedItem = removed[0] || null;

              newConnections[sourceGroupIndex] = {
                ...sourceGroup,
                items: sourceItems,
              };
            }
          }

          if (!draggedItem) return;

          if (destination.droppableId === "connection-list") {
            if (draggedItem.type === "connection") {
              newConnections.splice(destination.index, 0, draggedItem);
            }
          } else {
            const targetGroupId = destination.droppableId;
            const targetGroupIndex = newConnections.findIndex(
              (item) => item.id === targetGroupId,
            );

            if (targetGroupIndex !== -1 && draggedItem.type === "connection") {
              const targetGroup = newConnections[targetGroupIndex];
              const targetItems = Array.isArray(targetGroup.items)
                ? [...targetGroup.items]
                : [];
              targetItems.splice(destination.index, 0, draggedItem);

              newConnections[targetGroupIndex] = {
                ...targetGroup,
                items: targetItems,
                expanded: true,
              };
            }
          }

          setConnections(newConnections);
          return;
        }
      },
      [connections],
    );

    // 渲染连接项 - 使用 useCallback 但移除不必要的依赖
    const renderConnectionItem = useCallback(
      (connection, parentGroup = null, index) => {
        // 获取连接协议图标
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

        // 计算注释文本内容
        const secondaryText = connection.username
          ? `${connection.username}@${connection.host}`
          : connection.host;

        // 更精准的检测逻辑：考虑实际显示宽度和中文字符
        // 由于CSS设置了maxWidth: 'calc(100% - 20px)'，我们需要更保守的估算
        const estimateTextWidth = (text) => {
          // 粗略估算：中文字符宽度约为英文字符的2倍
          let width = 0;
          for (let i = 0; i < text.length; i++) {
            const char = text.charAt(i);
            if (/[\u4e00-\u9fff]/.test(char)) {
              width += 2; // 中文字符
            } else {
              width += 1; // 英文字符
            }
          }
          return width;
        };

        // 根据显示宽度判断是否会被截断，这里使用更保守的阈值
        const maxDisplayWidth = 17; // 根据实际容器宽度调整，更保守的值
        const isSecondaryTextTruncated =
          estimateTextWidth(secondaryText) > maxDisplayWidth;

        return (
          <Draggable
            key={connection.id}
            draggableId={connection.id}
            index={index}
          >
            {(provided, snapshot) => (
              <ListItem
                ref={provided.innerRef}
                {...provided.draggableProps}
                disablePadding
                sx={{
                  pl: parentGroup ? 1.5 : 0.5, // 减小左侧内边距
                  minHeight: "32px", // 减小最小高度
                  "&:hover": {
                    backgroundColor:
                      theme.palette.mode === "dark"
                        ? alpha(theme.palette.primary.main, 0.15) // 夜间主题下使用主色调半透明版本
                        : alpha(theme.palette.primary.main, 0.08), // 日间主题下使用较浅的主色调
                  },
                  ...(snapshot.isDragging
                    ? {
                        background:
                          theme.palette.mode === "dark"
                            ? theme.palette.grey[700]
                            : theme.palette.grey[200],
                        boxShadow: theme.shadows[4],
                      }
                    : {}),
                }}
                secondaryAction={
                  <Box
                    sx={{
                      opacity: 0, // 默认隐藏
                      transition: "opacity 0.2s ease", // 添加过渡效果
                      ".MuiListItem-root:hover &": {
                        opacity: 1, // 当ListItem被悬停时显示
                      },
                    }}
                  >
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => handleEdit(connection, parentGroup)}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      edge="end"
                      size="small"
                      onClick={() => handleDelete(connection.id, parentGroup)}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Box>
                }
              >
                <Box
                  {...provided.dragHandleProps}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    cursor: "grab",
                    "&:active": { cursor: "grabbing" },
                    minWidth: 20, // 进一步减小拖拽图标容器宽度
                    justifyContent: "center", // 确保图标居中对齐
                    mr: 0.25, // 减小右侧边距
                  }}
                >
                  <DragIndicatorIcon
                    fontSize="small"
                    sx={{ color: "text.secondary" }}
                  />
                </Box>
                <ListItemButton
                  onClick={() => handleOpenConnection(connection)}
                  dense
                  sx={{
                    flexGrow: 1,
                    py: 0.5, // 减小上下内边距
                    "&:hover": {
                      backgroundColor: "transparent", // 防止ListItemButton自身的hover效果
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28, ml: -0.5 }}>
                    {/* 减小图标容器宽度并添加负左边距 */}
                    {getProtocolIcon()}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      // 检查主文本是否需要省略
                      estimateTextWidth(connection.name || connection.host) >
                      maxDisplayWidth ? (
                        <Tooltip
                          title={connection.name || connection.host}
                          placement="top"
                          arrow
                        >
                          <span>{connection.name || connection.host}</span>
                        </Tooltip>
                      ) : (
                        <span>{connection.name || connection.host}</span>
                      )
                    }
                    secondary={
                      // 副文本不再显示tooltip，只显示内容
                      <span>{secondaryText}</span>
                    }
                    sx={{
                      my: 0,
                      "& .MuiListItemText-primary": {
                        fontSize: "0.85rem", // 稍微减小主文本字体大小
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        maxWidth: "calc(100% - 20px)", // 预留按钮的空间
                      },
                      "& .MuiListItemText-secondary": {
                        fontSize: "0.7rem", // 稍微减小副文本字体大小
                        textOverflow: "ellipsis",
                        overflow: "hidden",
                        whiteSpace: "nowrap",
                        maxWidth: "calc(100% - 20px)", // 预留按钮的空间
                        lineHeight: 1.2, // 减小行高
                        mt: 0.25, // 减小上边距
                      },
                    }}
                  />
                </ListItemButton>
              </ListItem>
            )}
          </Draggable>
        );
      },
      [theme, handleEdit, handleDelete, handleOpenConnection],
    );

    // 存储最新的 renderConnectionItem 引用
    renderConnectionItemRef.current = renderConnectionItem;

    // 渲染组 - 移除 renderConnectionItem 依赖，使用 ref 引用
    const renderGroupItem = useCallback(
      (group, index) => {
        // 优化渲染逻辑
        const key = `group-${group.id}`;

        return (
          <Draggable key={group.id} draggableId={group.id} index={index}>
            {(provided, snapshot) => (
              <React.Fragment>
                <ListItem
                  disablePadding
                  ref={provided.innerRef}
                  {...provided.draggableProps}
                  sx={{
                    pl: 0.5, // 减小左侧内边距
                    minHeight: "32px", // 减小最小高度
                    "&:hover": {
                      backgroundColor:
                        theme.palette.mode === "dark"
                          ? alpha(theme.palette.primary.main, 0.15) // 夜间主题下使用主色调半透明版本
                          : alpha(theme.palette.primary.main, 0.08), // 日间主题下使用较浅的主色调
                    },
                    ...(snapshot.isDragging
                      ? {
                          background:
                            theme.palette.mode === "dark"
                              ? theme.palette.grey[700]
                              : theme.palette.grey[200],
                          boxShadow: theme.shadows[4],
                        }
                      : {}),
                  }}
                  secondaryAction={
                    <Box
                      sx={{
                        display: "flex",
                        gap: 0.5,
                        opacity: 0, // 默认隐藏
                        transition: "opacity 0.2s ease", // 添加过渡效果
                        ".MuiListItem-root:hover &": {
                          opacity: 1, // 当ListItem被悬停时显示
                        },
                      }}
                    >
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAddConnection(group.id);
                        }}
                      >
                        <AddIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEdit(group);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(group.id);
                        }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  }
                >
                  <Box
                    {...provided.dragHandleProps}
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      cursor: "grab",
                      "&:active": { cursor: "grabbing" },
                      minWidth: 20, // 进一步减小拖拽图标容器宽度
                      justifyContent: "center", // 确保图标居中对齐
                      mr: 0.25, // 减小右侧边距
                    }}
                  >
                    <DragIndicatorIcon
                      fontSize="small"
                      sx={{ color: "text.secondary" }}
                    />
                  </Box>
                  <ListItemButton
                    onClick={() => handleToggleGroup(group.id)}
                    sx={{
                      py: 0.5, // 减小上下内边距
                      flexGrow: 1,
                      "&:hover": {
                        backgroundColor: "transparent",
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 28, ml: -0.5 }}>
                      {/* 减小图标容器宽度并添加负左边距 */}
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
                        fontSize: "0.85rem", // 稍微减小主文本字体大小
                      }}
                      sx={{ my: 0 }}
                    />
                  </ListItemButton>
                </ListItem>

                {/* 使用单一Droppable，避免组件卸载/重新挂载 */}
                <Droppable
                  key={`${group.id}-items`}
                  droppableId={group.id}
                  type="connection-item"
                  isDropDisabled={searchQuery.length > 0}
                >
                  {(provided, snapshot) => (
                    <Box
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      sx={{
                        backgroundColor: snapshot.isDraggingOver
                          ? theme.palette.mode === "dark"
                            ? alpha(theme.palette.primary.main, 0.2)
                            : alpha(theme.palette.primary.main, 0.1)
                          : "transparent",
                        transition: "all 0.2s ease",
                        maxHeight: group.expanded
                          ? "none"
                          : snapshot.isDraggingOver
                            ? "40px"
                            : "0px",
                        opacity: group.expanded
                          ? 1
                          : snapshot.isDraggingOver
                            ? 0.8
                            : 0,
                        overflow: "hidden",
                        borderRadius:
                          !group.expanded && snapshot.isDraggingOver ? 1 : 0,
                        margin:
                          !group.expanded && snapshot.isDraggingOver
                            ? "0 8px"
                            : 0,
                      }}
                    >
                      <List
                        component="div"
                        disablePadding
                        sx={{
                          pl: 1.5, // 减小组内项目的左侧内边距
                          display:
                            group.expanded || snapshot.isDraggingOver
                              ? "block"
                              : "none",
                        }}
                      >
                        {group.items &&
                          group.items.map((item, itemIndex) =>
                            renderConnectionItemRef.current(
                              item,
                              group,
                              itemIndex,
                            ),
                          )}
                        {provided.placeholder}
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
                    </Box>
                  )}
                </Droppable>
              </React.Fragment>
            )}
          </Draggable>
        );
      },
      [
        theme,
        searchQuery,
        handleToggleGroup,
        handleAddConnection,
        handleEdit,
        handleDelete,
      ],
    );

    // 使用 useMemo 优化连接列表渲染 - 移除 renderConnectionItem 依赖
    const connectionsList = useMemo(() => {
      return filteredItems.map((item, index) =>
        item.type === "group"
          ? renderGroupItem(item, index)
          : renderConnectionItemRef.current
            ? renderConnectionItemRef.current(item, null, index)
            : renderConnectionItem(item, null, index),
      );
    }, [filteredItems, renderGroupItem]); // 移除 renderConnectionItem 依赖，因为它会频繁变化

    // 使用 useMemo 优化分组选择器选项
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
        sx={{
          width: open ? 300 : 0,
          height: "100%",
          overflow: "hidden",
          transition: theme.transitions.create("width", {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.enteringScreen,
          }),
          borderLeft: `1px solid ${theme.palette.divider}`,
          display: "flex",
          flexDirection: "column",
          borderRadius: 0,
        }}
        elevation={4}
      >
        {open && (
          <>
            {/* 头部 */}
            <Box
              sx={{
                p: 2,
                borderBottom: 1,
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Typography variant="subtitle1" fontWeight="medium">
                连接管理
              </Typography>
              <IconButton size="small" onClick={onClose}>
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
                label="搜索..."
                variant="outlined"
                size="small"
                fullWidth
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                InputProps={{
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
              />
            </Box>

            {/* 连接列表区域 */}
            <Box
              sx={{
                flexGrow: 1,
                overflow: "auto",
                height: "calc(100% - 160px)", // 调整高度以适应搜索框
              }}
            >
              <DragDropContext onDragEnd={handleDragEnd}>
                <Droppable
                  key="connection-list"
                  droppableId="connection-list"
                  type="connection-item"
                  isDropDisabled={searchQuery.length > 0}
                >
                  {(provided, snapshot) => (
                    <List
                      dense
                      sx={{
                        p: 1,
                        backgroundColor: snapshot.isDraggingOver
                          ? theme.palette.mode === "dark"
                            ? alpha(theme.palette.primary.main, 0.2)
                            : alpha(theme.palette.primary.main, 0.1)
                          : "transparent",
                        transition: "background-color 0.2s ease",
                      }}
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                    >
                      {isLoading ? (
                        <ConnectionManagerSkeleton />
                      ) : (
                        <>
                          {connectionsList}
                          {provided.placeholder}
                          {connections.length === 0 && (
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
                      )}
                    </List>
                  )}
                </Droppable>
              </DragDropContext>
            </Box>

            {/* 添加/编辑对话框 */}
            <Dialog
              open={dialogOpen}
              onClose={handleDialogClose}
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle>
                {dialogMode === "add" ? "新建" : "编辑"}{" "}
                {dialogType === "connection" ? "连接" : "分组"}
              </DialogTitle>
              <DialogContent dividers>
                <Box
                  component="form"
                  sx={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    pt: 1,
                  }}
                >
                  <TextField
                    label="名称"
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
                        <InputLabel>协议</InputLabel>
                        <Select
                          name="protocol"
                          value={formData.protocol || "ssh"}
                          label="协议"
                          onChange={handleFormChange}
                        >
                          <MenuItem value="ssh">SSH</MenuItem>
                          <MenuItem value="telnet">Telnet</MenuItem>
                        </Select>
                      </FormControl>

                      <TextField
                        label="主机地址"
                        name="host"
                        value={formData.host}
                        onChange={handleFormChange}
                        fullWidth
                        size="small"
                        required
                      />

                      <TextField
                        label="端口"
                        name="port"
                        type="number"
                        value={formData.port}
                        onChange={handleFormChange}
                        fullWidth
                        size="small"
                        placeholder={
                          formData.protocol === "telnet" ? "23" : "22"
                        }
                      />

                      <TextField
                        label="用户名"
                        name="username"
                        value={formData.username}
                        onChange={handleFormChange}
                        fullWidth
                        size="small"
                      />

                      <TextField
                        label="密码"
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
                          <InputLabel>认证方式</InputLabel>
                          <Select
                            name="authType"
                            value={formData.authType || "password"}
                            label="认证方式"
                            onChange={handleFormChange}
                          >
                            <MenuItem value="password">密码认证</MenuItem>
                            <MenuItem value="privateKey">密钥认证</MenuItem>
                          </Select>
                        </FormControl>
                      )}

                      {formData.protocol === "ssh" &&
                        formData.authType === "privateKey" && (
                          <Box sx={{ display: "flex", mt: 1 }}>
                            <TextField
                              label="私钥路径"
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
                                    .then((filePath) => {
                                      if (filePath) {
                                        setFormData((prev) => ({
                                          ...prev,
                                          privateKeyPath: filePath,
                                        }));
                                      }
                                    });
                                }
                              }}
                            >
                              浏览...
                            </Button>
                          </Box>
                        )}

                      <FormControl fullWidth size="small">
                        <InputLabel>分组</InputLabel>
                        <Select
                          name="parentGroup"
                          value={formData.parentGroup || ""}
                          label="分组"
                          onChange={handleFormChange}
                        >
                          <MenuItem value="">
                            <em>不分组</em>
                          </MenuItem>
                          {groupOptions}
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel>类型</InputLabel>
                        <Select
                          name="connectionType"
                          value={formData.connectionType || ""}
                          label="类型"
                          onChange={handleFormChange}
                        >
                          <MenuItem value="">
                            <em>无</em>
                          </MenuItem>
                          <MenuItem value="VPS">VPS</MenuItem>
                          <MenuItem value="NAS">NAS</MenuItem>
                          <MenuItem value="BareMetal">裸金属</MenuItem>
                          <MenuItem value="Other">其他</MenuItem>
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel>操作系统</InputLabel>
                        <Select
                          name="os"
                          value={formData.os || ""}
                          label="操作系统"
                          onChange={handleFormChange}
                        >
                          <MenuItem value="">
                            <em>无</em>
                          </MenuItem>
                          <MenuItem value="Linux">Linux</MenuItem>
                          <MenuItem value="Windows">Windows</MenuItem>
                          <MenuItem value="macOS">macOS</MenuItem>
                          <MenuItem value="Other">其他</MenuItem>
                        </Select>
                      </FormControl>

                      <FormControl fullWidth size="small">
                        <InputLabel>国家/地区</InputLabel>
                        <Select
                          name="country"
                          value={formData.country || ""}
                          label="国家/地区"
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
                            <em>无</em>
                          </MenuItem>
                          {countryOptions}
                        </Select>
                      </FormControl>

                      {/* 代理配置分割线 */}
                      <Divider sx={{ my: 2 }}>
                        <Typography variant="body2" color="text.secondary">
                          代理配置 (可选)
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
                          />
                        }
                        label="启用代理"
                        sx={{ mb: 1 }}
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
                              />
                            }
                            label="使用系统默认代理配置"
                            sx={{ mb: 1 }}
                          />

                          {!formData.proxyUseDefault && (
                            <>
                              <Box sx={{ display: "flex", gap: 1 }}>
                                <FormControl
                                  size="small"
                                  sx={{ minWidth: 120 }}
                                >
                                  <InputLabel>代理类型</InputLabel>
                                  <Select
                                    name="proxyType"
                                    value={formData.proxyType}
                                    label="代理类型"
                                    onChange={handleFormChange}
                                  >
                                    <MenuItem value="http">HTTP</MenuItem>
                                    <MenuItem value="socks4">SOCKS4</MenuItem>
                                    <MenuItem value="socks5">SOCKS5</MenuItem>
                                  </Select>
                                </FormControl>
                                <TextField
                                  label="代理主机"
                                  name="proxyHost"
                                  value={formData.proxyHost}
                                  onChange={handleFormChange}
                                  size="small"
                                  sx={{ flexGrow: 1 }}
                                  placeholder="例如: 127.0.0.1"
                                />
                                <TextField
                                  label="端口"
                                  name="proxyPort"
                                  type="number"
                                  value={formData.proxyPort}
                                  onChange={handleFormChange}
                                  size="small"
                                  sx={{ width: 100 }}
                                  placeholder="8080"
                                />
                              </Box>

                              <Box sx={{ display: "flex", gap: 1 }}>
                                <TextField
                                  label="代理用户名 (可选)"
                                  name="proxyUsername"
                                  value={formData.proxyUsername}
                                  onChange={handleFormChange}
                                  size="small"
                                  sx={{ flexGrow: 1 }}
                                />
                                <TextField
                                  label="代理密码 (可选)"
                                  name="proxyPassword"
                                  type="password"
                                  value={formData.proxyPassword}
                                  onChange={handleFormChange}
                                  size="small"
                                  sx={{ flexGrow: 1 }}
                                />
                              </Box>
                            </>
                          )}
                        </>
                      )}
                    </>
                  )}
                </Box>
              </DialogContent>
              <DialogActions>
                <Button onClick={handleDialogClose}>取消</Button>
                <Button onClick={handleSave} variant="contained">
                  保存
                </Button>
              </DialogActions>
            </Dialog>

            {/* 删除确认对话框 */}
            <Dialog
              open={deleteConfirmOpen}
              onClose={handleCancelDelete}
              maxWidth="xs"
            >
              <DialogTitle>确认删除</DialogTitle>
              <DialogContent>
                <Typography>
                  {deleteItem?.item?.type === "group"
                    ? `确定要删除分组 "${deleteItem?.item?.name}" 吗？删除分组将同时删除组内的所有连接项。`
                    : `确定要删除连接 "${deleteItem?.item?.name}" 吗？`}
                </Typography>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1 }}
                >
                  此操作无法撤销。
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={handleCancelDelete}>取消</Button>
                <Button
                  onClick={handleConfirmDelete}
                  variant="contained"
                  color="error"
                >
                  删除
                </Button>
              </DialogActions>
            </Dialog>

            {/* 消息提示组件 */}
            <Snackbar
              open={snackbar.open}
              autoHideDuration={4000}
              onClose={handleSnackbarClose}
              anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
            >
              <Alert
                onClose={handleSnackbarClose}
                severity={snackbar.severity}
                sx={{ width: "100%" }}
              >
                {snackbar.message}
              </Alert>
            </Snackbar>
          </>
        )}
      </Paper>
    );
  },
  areEqual,
);

// 设置显示名称用于调试
ConnectionManager.displayName = "ConnectionManager";

export default ConnectionManager;
