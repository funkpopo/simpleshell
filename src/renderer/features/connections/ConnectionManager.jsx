import { useState, useEffect, memo, useCallback, useMemo, useRef } from "react";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
import {
  Box,
  Typography,
  ListItemIcon,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Menu,
  TextField,
  Chip,
} from "@mui/material";
import { compactContextMenuPaperSx } from "../../shared/ui/contextMenuStyles";
import FolderIcon from "@mui/icons-material/Folder";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import StarRoundedIcon from "@mui/icons-material/StarRounded";
import StarBorderRoundedIcon from "@mui/icons-material/StarBorderRounded";
import BoltIcon from "@mui/icons-material/Bolt";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import FileCopyOutlinedIcon from "@mui/icons-material/FileCopyOutlined";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../shared/notifications/NotificationContext";
import SidebarPanel from "../../shared/ui/SidebarPanel.jsx";
import SidebarSearchField from "../../shared/ui/SidebarSearchField.jsx";
import { sidebarSectionSx } from "../../shared/ui/sidebarItemStyles";
import useSidebarPanel from "../../shared/hooks/useSidebarPanel";
import useContextMenuRetarget from "../../shared/hooks/useContextMenuRetarget";
import {
  areConnectionListsEqual,
  collectAllConnectionTags,
  CONNECTION_MANAGER_ROW_DATA_ATTR,
  getHostForClipboard,
} from "./lib/connectionTree.js";
import { buildDuplicateConnectionPayload } from "./lib/connectionForm.js";
import {
  buildTransientQuickConnectConnection,
  dismissTransientQuickConnect,
  getQuickConnectErrorText,
  getTransientQuickConnects,
  parseQuickConnectTarget,
  recordTransientQuickConnect,
  resolveQuickConnectDetail,
} from "./lib/quickConnect.js";
import ConnectionList from "./components/ConnectionList.jsx";
import ConnectionEditorDialog from "./components/ConnectionEditorDialog.jsx";
import useConnectionEditor from "./hooks/useConnectionEditor.js";

const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.open === nextProps.open &&
    prevProps.initialConnections === nextProps.initialConnections &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onConnectionsUpdate === nextProps.onConnectionsUpdate &&
    prevProps.onOpenConnection === nextProps.onOpenConnection &&
    prevProps.createConnectionSignal === nextProps.createConnectionSignal &&
    prevProps.onCreateConnectionSignalConsumed ===
      nextProps.onCreateConnectionSignalConsumed &&
    prevProps.sessionContext === nextProps.sessionContext
  );
};
const ConnectionManager = memo(
  ({
    open,
    onClose,
    initialConnections = [],
    onConnectionsUpdate,
    onOpenConnection,
    createConnectionSignal = 0,
    onCreateConnectionSignalConsumed,
    sessionContext = null,
  }) => {
    const { t } = useTranslation();
    const { showError, showSuccess } = useNotification();
    const [connections, setConnections] = useState(initialConnections);
    const [isLoading, setIsLoading] = useState(!initialConnections.length);
    const [searchQuery, setSearchQuery] = useState("");
    const [onlyPinned, setOnlyPinned] = useState(false);
    const [selectedTag, setSelectedTag] = useState("");
    const [quickConnectTarget, setQuickConnectTarget] = useState("");
    const [quickConnectError, setQuickConnectError] = useState("");
    const [transientQuickConnects, setTransientQuickConnects] = useState(() =>
      getTransientQuickConnects(initialConnections),
    );
    const searchInputRef = useRef(null);
    const sidebarRootRef = useRef(null);
    const [connectionListContextMenu, setConnectionListContextMenu] =
      useState(null);
    const connectionManagerListRootRef = useRef(null);

    useSidebarPanel({
      open,
      rootRef: sidebarRootRef,
      searchInputRef,
    });

    useEffect(() => {
      if (!open) {
        setConnectionListContextMenu(null);
      }
    }, [open]);

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

    const connectionsStateRef = useRef(connections);
    const isSavingRef = useRef(false);
    const editor = useConnectionEditor({
      connections,
      setConnections,
      isSavingRef,
      open,
      createConnectionSignal,
      onCreateConnectionSignalConsumed,
    });
    const {
      handleAddConnection,
      handleAddFromPreset,
      handleAddGroup,
      handleEdit,
    } = editor; // 标记是否正在保存，用于忽略自己触发的变更事件

    useEffect(() => {
      connectionsStateRef.current = connections;
    }, [connections]);

    useEffect(() => {
      if (!open) return;

      let isMounted = true; // 添加标志以避免组件卸载后的状态更新

      const reloadConnections = () => {
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
              const sanitized = Array.isArray(data) ? data : [];

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

      if (window.terminalAPI && window.terminalAPI.onConnectionsChanged) {
        window.terminalAPI.onConnectionsChanged(reloadConnections);
      }

      return () => {
        isMounted = false; // 设置标志为false
        if (window.terminalAPI && window.terminalAPI.offConnectionsChanged) {
          window.terminalAPI.offConnectionsChanged(reloadConnections);
        }
      };
    }, [open, onConnectionsUpdate]); // 移除 connections 依赖，使用 ref 代替

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

        setTimeout(() => {
          isUpdatingRef.current = false;
        }, 0);
      }
    }, [connections, isLoading, onConnectionsUpdate]);

    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [deleteItem, setDeleteItem] = useState(null);

    const handleToggleGroup = useCallback((groupId) => {
      setConnections((prevConnections) => {
        const targetGroup = prevConnections.find(
          (item) => item.id === groupId && item.type === "group",
        );
        if (!targetGroup) return prevConnections;

        const newConnections = prevConnections.map((item) => {
          if (item.id === groupId && item.type === "group") {
            return { ...item, expanded: !item.expanded };
          }
          return item;
        });

        return newConnections;
      });
    }, []);

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

    const persistConnections = useCallback(
      (nextConnections) => {
        setConnections(nextConnections);
        if (window.terminalAPI && window.terminalAPI.saveConnections) {
          isSavingRef.current = true;
          window.terminalAPI
            .saveConnections(nextConnections)
            .catch(() => {
              showError(t("connectionManager.saveFailed"));
            })
            .finally(() => {
              setTimeout(() => {
                isSavingRef.current = false;
              }, 100);
            });
        }
      },
      [showError, t],
    );

    const handleConfirmDelete = useCallback(() => {
      if (!deleteItem) return;

      const { itemId, parentGroup } = deleteItem;
      let newConnections;

      if (parentGroup) {
        newConnections = connections.map((group) =>
          group.id === parentGroup.id
            ? {
                ...group,
                items: group.items.filter((item) => item.id !== itemId),
              }
            : group,
        );
      } else {
        newConnections = connections.filter((item) => item.id !== itemId);
      }

      persistConnections(newConnections);

      setDeleteConfirmOpen(false);
      setDeleteItem(null);

      showSuccess(t("connectionManager.deleteSuccess"));
    }, [deleteItem, connections, persistConnections, t, showSuccess]);

    const handleTogglePin = useCallback(
      (connection, parentGroup = null) => {
        if (!connection?.id) {
          return;
        }
        const nextPinned = connection.pinned !== true;
        const nextConnections = parentGroup
          ? connections.map((group) =>
              group.id === parentGroup.id
                ? {
                    ...group,
                    items: (group.items || []).map((item) =>
                      item.id === connection.id
                        ? { ...item, pinned: nextPinned }
                        : item,
                    ),
                  }
                : group,
            )
          : connections.map((item) =>
              item.id === connection.id
                ? { ...item, pinned: nextPinned }
                : item,
            );
        persistConnections(nextConnections);
      },
      [connections, persistConnections],
    );

    const handleDuplicateConnection = useCallback(
      (connection, parentGroup = null) => {
        if (!connection || connection.type !== "connection") {
          return;
        }
        const duplicated = buildDuplicateConnectionPayload(
          connection,
          connections,
          t("connections.duplicate.copySuffix"),
        );

        const insertAfter = (list) => {
          const idx = list.findIndex((item) => item.id === connection.id);
          if (idx === -1) {
            return [...list, duplicated];
          }
          return [
            ...list.slice(0, idx + 1),
            duplicated,
            ...list.slice(idx + 1),
          ];
        };

        const nextConnections = parentGroup
          ? connections.map((group) =>
              group.id === parentGroup.id
                ? { ...group, items: insertAfter(group.items || []) }
                : group,
            )
          : insertAfter(connections);

        persistConnections(nextConnections);
        showSuccess(t("connections.duplicate.success"));
      },
      [connections, persistConnections, showSuccess, t],
    );

    const handleCancelDelete = useCallback(() => {
      setDeleteConfirmOpen(false);
      setDeleteItem(null);
    }, []);

    const handleConnectionListContextMenuClose = useCallback(() => {
      setConnectionListContextMenu(null);
    }, []);

    const openConnectionListContextMenuFromEvent = useCallback(
      (event, payload) => {
        setConnectionListContextMenu({
          mouseX: event.clientX,
          mouseY: event.clientY,
          ...payload,
        });
      },
      [],
    );

    const openConnectionContextMenuFromEvent = useCallback(
      (event, connection, parentGroup) => {
        openConnectionListContextMenuFromEvent(event, {
          kind: "connection",
          connection,
          parentGroup: parentGroup ?? null,
        });
      },
      [openConnectionListContextMenuFromEvent],
    );

    const openGroupContextMenuFromEvent = useCallback(
      (event, group) => {
        openConnectionListContextMenuFromEvent(event, { kind: "group", group });
      },
      [openConnectionListContextMenuFromEvent],
    );

    const openBlankContextMenuFromEvent = useCallback(
      (event) => {
        openConnectionListContextMenuFromEvent(event, { kind: "blank" });
      },
      [openConnectionListContextMenuFromEvent],
    );

    const handleBlankContextMenu = useCallback(
      (event) => {
        if (!(event?.target instanceof Element)) {
          return;
        }

        if (
          event.target.closest(`[${CONNECTION_MANAGER_ROW_DATA_ATTR}]`) ||
          event.target.closest(".MuiListItemButton-root")
        ) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        openBlankContextMenuFromEvent(event);
      },
      [openBlankContextMenuFromEvent],
    );

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

    useContextMenuRetarget({
      enabled: Boolean(open && connectionListContextMenu),
      rootRef: connectionManagerListRootRef,
      menuSelector: '[data-connection-manager-context-menu="true"]',
      mode: "redispatch",
      resolveItemElement: (retargetElement) => {
        const rowButton = retargetElement.closest?.(
          `[${CONNECTION_MANAGER_ROW_DATA_ATTR}]`,
        );
        if (rowButton) {
          return rowButton.closest?.(".MuiListItem-root") || rowButton;
        }

        const listItem = retargetElement.closest?.(".MuiListItem-root");
        if (
          listItem?.querySelector?.(`[${CONNECTION_MANAGER_ROW_DATA_ATTR}]`)
        ) {
          return listItem;
        }

        const groupArea = retargetElement.closest?.(
          "[data-connection-manager-group-area]",
        );
        if (groupArea) {
          return groupArea;
        }

        return (
          retargetElement.closest?.(
            '[data-connection-manager-list-root="true"]',
          ) || retargetElement
        );
      },
      onCloseMenus: () => {
        setConnectionListContextMenu(null);
      },
    });

    const handleOpenConnection = useCallback(
      (connection) => {
        if (onOpenConnection) {
          onOpenConnection(connection);
        }
      },
      [onOpenConnection],
    );

    const launchQuickConnect = useCallback(
      (rawTarget) => {
        const parsed = parseQuickConnectTarget(rawTarget);
        if (!parsed.ok) {
          setQuickConnectError(getQuickConnectErrorText(t, parsed.errorCode));
          return false;
        }
        const transientConnection = buildTransientQuickConnectConnection(
          parsed.value,
        );
        recordTransientQuickConnect(transientConnection);
        setTransientQuickConnects(getTransientQuickConnects(connections));
        setQuickConnectError("");
        setQuickConnectTarget("");
        onOpenConnection?.(transientConnection);
        return true;
      },
      [connections, onOpenConnection, t],
    );

    const handleQuickConnectSubmit = useCallback(
      (event) => {
        event?.preventDefault?.();
        launchQuickConnect(quickConnectTarget);
      },
      [launchQuickConnect, quickConnectTarget],
    );

    useEffect(() => {
      setTransientQuickConnects(getTransientQuickConnects(connections));
    }, [connections]);

    const allTags = useMemo(
      () => collectAllConnectionTags(connections),
      [connections],
    );

    useEffect(() => {
      if (selectedTag && !allTags.includes(selectedTag)) {
        setSelectedTag("");
      }
    }, [allTags, selectedTag]);

    useEffect(() => {
      const handleTransientChanged = () => {
        setTransientQuickConnects(
          getTransientQuickConnects(connectionsStateRef.current),
        );
      };
      const handleExternalQuickConnect = (event) => {
        if (event.defaultPrevented || typeof onOpenConnection !== "function") {
          return;
        }
        const resolved = resolveQuickConnectDetail(event.detail);
        if (!resolved.ok) {
          showError(getQuickConnectErrorText(t, resolved.errorCode));
          return;
        }
        event.preventDefault();
        recordTransientQuickConnect(resolved.connection);
        setTransientQuickConnects(
          getTransientQuickConnects(connectionsStateRef.current),
        );
        onOpenConnection(resolved.connection);
      };
      const handleSaveAsConnectionEvent = (event) => {
        const preset = event?.detail;
        if (preset && typeof preset === "object" && preset.host) {
          handleAddFromPreset(preset);
        }
      };

      window.addEventListener(
        "simpleshell:transientQuickConnectsChanged",
        handleTransientChanged,
      );
      window.addEventListener(
        "simpleshell:quickConnect",
        handleExternalQuickConnect,
      );
      window.addEventListener(
        "simpleshell:saveAsConnection",
        handleSaveAsConnectionEvent,
      );
      return () => {
        window.removeEventListener(
          "simpleshell:transientQuickConnectsChanged",
          handleTransientChanged,
        );
        window.removeEventListener(
          "simpleshell:quickConnect",
          handleExternalQuickConnect,
        );
        window.removeEventListener(
          "simpleshell:saveAsConnection",
          handleSaveAsConnectionEvent,
        );
      };
    }, [handleAddFromPreset, onOpenConnection, showError, t]);

    return (
      <SidebarPanel
        open={open}
        rootRef={sidebarRootRef}
        title={t("connectionManager.title")}
        onClose={onClose}
        sessionContext={sessionContext}
      >
        {/* 操作按钮与搜索区（对齐统一 12px 栅格，减少重复水平分隔线） */}
        <Box
          sx={(theme) => ({
            ...sidebarSectionSx(theme),
            display: "flex",
            flexDirection: "column",
            gap: 1,
          })}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 1,
            }}
          >
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={() => handleAddConnection()}
              sx={{ fontSize: "0.75rem" }}
            >
              {t("connectionManager.newConnection")}
            </Button>
            <Button
              size="small"
              startIcon={<FolderIcon />}
              onClick={handleAddGroup}
              sx={{ fontSize: "0.75rem" }}
            >
              {t("connectionManager.newGroup")}
            </Button>
          </Box>
          <Box
            component="form"
            onSubmit={handleQuickConnectSubmit}
            sx={{ display: "flex", gap: 0.75, alignItems: "flex-start" }}
          >
            <TextField
              size="small"
              fullWidth
              value={quickConnectTarget}
              onChange={(e) => {
                setQuickConnectTarget(e.target.value);
                if (quickConnectError) {
                  setQuickConnectError("");
                }
              }}
              placeholder={t("connections.quickConnect.placeholder")}
              error={Boolean(quickConnectError)}
              helperText={quickConnectError || undefined}
              slotProps={{
                htmlInput: {
                  "aria-label": t("connections.quickConnect.inputLabel"),
                },
              }}
              sx={{ flexGrow: 1, minWidth: 0 }}
            />
            <Button
              type="submit"
              variant="contained"
              size="small"
              startIcon={<BoltIcon />}
              sx={{
                height: 36,
                flexShrink: 0,
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
              }}
            >
              {t("connections.quickConnect.connect")}
            </Button>
          </Box>
          {transientQuickConnects.length > 0 && (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 0.5,
                p: 0.75,
                borderRadius: 1,
                border: "1px dashed",
                borderColor: "divider",
                bgcolor: "action.hover",
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {t("connections.quickConnect.unsavedNotice")}
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {transientQuickConnects.slice(0, 2).map((item) => (
                  <Chip
                    key={item.id}
                    size="small"
                    icon={<BookmarkAddOutlinedIcon />}
                    label={`${item.name} · ${t("connections.quickConnect.saveAsConnection")}`}
                    onClick={() => handleAddFromPreset(item)}
                    onDelete={() => dismissTransientQuickConnect(item)}
                    color="primary"
                    variant="outlined"
                    clickable
                    sx={{ maxWidth: "100%" }}
                  />
                ))}
              </Box>
            </Box>
          )}
          <SidebarSearchField
            inputRef={searchInputRef}
            placeholder={t("connectionManager.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            enableScale
          />
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: 0.5,
            }}
          >
            <Chip
              size="small"
              icon={<StarRoundedIcon />}
              label={t("connections.pinned.filterLabel")}
              clickable
              color={onlyPinned ? "warning" : "default"}
              variant={onlyPinned ? "filled" : "outlined"}
              onClick={() => setOnlyPinned((prev) => !prev)}
            />
            {allTags.map((tag) => {
              const active = selectedTag === tag;
              return (
                <Chip
                  key={tag}
                  size="small"
                  label={tag}
                  clickable
                  color={active ? "primary" : "default"}
                  variant={active ? "filled" : "outlined"}
                  onClick={() => setSelectedTag(active ? "" : tag)}
                />
              );
            })}
          </Box>
        </Box>

        {/* 连接列表区域 */}
        <ConnectionList
          searchQuery={searchQuery}
          onlyPinned={onlyPinned}
          selectedTag={selectedTag}
          connections={connections}
          setConnections={setConnections}
          isSavingRef={isSavingRef}
          handleToggleGroup={handleToggleGroup}
          openGroupContextMenuFromEvent={openGroupContextMenuFromEvent}
          openConnectionContextMenuFromEvent={
            openConnectionContextMenuFromEvent
          }
          handleOpenConnection={handleOpenConnection}
          onTogglePin={handleTogglePin}
          connectionListContextMenu={connectionListContextMenu}
          connectionManagerListRootRef={connectionManagerListRootRef}
          handleBlankContextMenu={handleBlankContextMenu}
          isLoading={isLoading}
          handleVirtualizedItemContextMenu={handleVirtualizedItemContextMenu}
        />

        <Menu
          slotProps={{
            paper: {
              "data-connection-manager-context-menu": "true",
              sx: compactContextMenuPaperSx,
            },
          }}
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
        >
          {connectionListContextMenu?.kind === "connection" && (
            <>
              <MenuItem
                onClick={() => {
                  const ctx = connectionListContextMenu;
                  if (!ctx || ctx.kind !== "connection") {
                    handleConnectionListContextMenuClose();
                    return;
                  }
                  const { connection, parentGroup } = ctx;
                  handleConnectionListContextMenuClose();
                  handleTogglePin(connection, parentGroup ?? null);
                }}
              >
                <ListItemIcon>
                  {connectionListContextMenu.connection?.pinned ? (
                    <StarRoundedIcon fontSize="small" color="warning" />
                  ) : (
                    <StarBorderRoundedIcon fontSize="small" />
                  )}
                </ListItemIcon>
                {connectionListContextMenu.connection?.pinned
                  ? t("connections.pinned.unpin")
                  : t("connections.pinned.pin")}
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
                  handleDuplicateConnection(connection, parentGroup ?? null);
                }}
              >
                <ListItemIcon>
                  <FileCopyOutlinedIcon fontSize="small" />
                </ListItemIcon>
                {t("connections.duplicate.action")}
              </MenuItem>
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
          {connectionListContextMenu?.kind === "blank" && (
            <>
              <MenuItem
                onClick={() => {
                  handleConnectionListContextMenuClose();
                  handleAddConnection();
                }}
              >
                <ListItemIcon>
                  <AddIcon fontSize="small" />
                </ListItemIcon>
                {t("connectionManager.newConnection")}
              </MenuItem>
              <MenuItem
                onClick={() => {
                  handleConnectionListContextMenuClose();
                  handleAddGroup();
                }}
              >
                <ListItemIcon>
                  <FolderIcon fontSize="small" />
                </ListItemIcon>
                {t("connectionManager.newGroup")}
              </MenuItem>
            </>
          )}
        </Menu>

        {/* 添加/编辑对话框 */}
        <ConnectionEditorDialog editor={editor} />

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
      </SidebarPanel>
    );
  },
  areEqual,
);

ConnectionManager.displayName = "ConnectionManager";

export default ConnectionManager;
