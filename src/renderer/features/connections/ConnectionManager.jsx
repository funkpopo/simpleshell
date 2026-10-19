import { useState, useEffect, memo, useCallback, useRef } from "react";
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
} from "@mui/material";
import { compactContextMenuPaperSx } from "../../shared/ui/contextMenuStyles";
import FolderIcon from "@mui/icons-material/Folder";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../shared/notifications/NotificationContext";
import SidebarPanel from "../../shared/ui/SidebarPanel.jsx";
import SidebarSearchField from "../../shared/ui/SidebarSearchField.jsx";
import useSidebarPanel from "../../shared/hooks/useSidebarPanel";
import useContextMenuRetarget from "../../shared/hooks/useContextMenuRetarget";
import {
  areConnectionListsEqual,
  CONNECTION_MANAGER_ROW_DATA_ATTR,
  getHostForClipboard,
} from "./lib/connectionTree.js";
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
    const { handleAddConnection, handleAddGroup, handleEdit } = editor; // 标记是否正在保存，用于忽略自己触发的变更事件

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

      setConnections(newConnections);

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

      setDeleteConfirmOpen(false);
      setDeleteItem(null);

      showSuccess(t("connectionManager.deleteSuccess"));
    }, [deleteItem, connections, t, showError, showSuccess]);

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

    return (
      <SidebarPanel
        open={open}
        rootRef={sidebarRootRef}
        title={t("connectionManager.title")}
        onClose={onClose}
        sessionContext={sessionContext}
      >
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

        {/* 搜索框 */}
        <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
          <SidebarSearchField
            inputRef={searchInputRef}
            placeholder={t("connectionManager.search")}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onClear={() => setSearchQuery("")}
            enableScale
          />
        </Box>

        {/* 连接列表区域 */}
        <ConnectionList
          searchQuery={searchQuery}
          connections={connections}
          setConnections={setConnections}
          isSavingRef={isSavingRef}
          handleToggleGroup={handleToggleGroup}
          openGroupContextMenuFromEvent={openGroupContextMenuFromEvent}
          openConnectionContextMenuFromEvent={
            openConnectionContextMenuFromEvent
          }
          handleOpenConnection={handleOpenConnection}
          connectionListContextMenu={connectionListContextMenu}
          connectionManagerListRootRef={connectionManagerListRootRef}
          handleBlankContextMenu={handleBlankContextMenu}
          isLoading={isLoading}
          handleVirtualizedItemContextMenu={handleVirtualizedItemContextMenu}
        />

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
