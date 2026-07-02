import React, {
  useState,
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
} from "react";
import Dialog from "./AccessibleDialog.jsx";
import { flushSync } from "react-dom";
import useAutoCleanup from "../hooks/useAutoCleanup";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  ListItemIcon,
  ListItemText,
  Divider,
  CircularProgress,
  TextField,
  InputAdornment,
  Tooltip,
  Menu,
  MenuItem,
  Button,
  Alert,
  Snackbar,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";
import { FileManagerSkeleton } from "./SkeletonLoader.jsx";
import { compactContextMenuPaperSx } from "./contextMenuStyles";
import FolderIcon from "@mui/icons-material/Folder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RefreshIcon from "@mui/icons-material/Refresh";
import HomeIcon from "@mui/icons-material/Home";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import DeleteIcon from "@mui/icons-material/Delete";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LinkIcon from "@mui/icons-material/Link";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import LockIcon from "@mui/icons-material/Lock";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import FilePreview from "./FilePreview.jsx";
import OverflowTooltipText from "./OverflowTooltipText.jsx";
// TransferProgressFloat 已移至全局显示,不再导入
import FilePermissionEditor from "./FilePermissionEditor.jsx";
import { List, ListItem, ListItemButton } from "@mui/material";
import { List as VirtualizedList } from "react-window";
import { InsertDriveFile as InsertDriveFileIcon } from "@mui/icons-material";
import {
  formatLastRefreshTime,
  formatFileSize,
} from "../core/utils/formatters.js";
import { debounce } from "../core/utils/performance.js";
import { useTranslation } from "react-i18next";
import { useGlobalTransfers } from "../store/globalTransferStore.js";
import { sidebarContentSx } from "./sidebarItemStyles";
import { getSearchFieldMotionSx } from "../utils/searchFieldStyles";

const FILE_LIST_ROW_HEIGHT = 36;
const FILE_LIST_VIRTUALIZATION_THRESHOLD = 200;
const FILE_LIST_OVERSCAN = 12;
const FILE_MANAGER_PATH_HISTORY_LIMIT = 50;
const TRANSFER_CONFLICT_PREVIEW_LIMIT = 8;

const FILE_LIST_ITEM_MIN_HEIGHT = 32;

const FILE_LIST_TEXT_SX = {
  my: 0,
  minWidth: 0,
  "& .MuiListItemText-primary": {
    fontSize: "0.875rem",
    lineHeight: 1.2,
    marginBottom: "2px",
    fontWeight: 500,
  },
  "& .MuiListItemText-secondary": {
    fontSize: "0.75rem",
    lineHeight: 1.1,
    marginTop: 0,
  },
};

const FILE_LIST_NAME_SX = {
  fontSize: "0.875rem",
  lineHeight: 1.2,
  marginBottom: "2px",
  fontWeight: 500,
};

const FILE_LIST_SECONDARY_TEXT_SX = {
  display: "block",
  minWidth: 0,
  fontSize: "0.75rem",
  lineHeight: 1.1,
  marginTop: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const CONFIRM_DIALOG_INITIAL_STATE = {
  open: false,
  title: "",
  message: "",
  detail: "",
  detailItems: [],
  detailFooter: "",
  onConfirm: null,
  confirmText: "",
  cancelText: "",
  confirmColor: "primary",
  defaultAction: "cancel",
};

const CONFIRM_DIALOG_COLORS = new Set([
  "primary",
  "secondary",
  "success",
  "error",
  "info",
  "warning",
]);

const joinPath = (basePath, childName) => {
  if (!childName) return basePath;

  if (basePath === "/") {
    return `/${childName}`;
  }

  if (basePath === "~") {
    return `~/${childName}`;
  }

  const normalizedBase = basePath.endsWith("/")
    ? basePath.slice(0, -1)
    : basePath;

  return `${normalizedBase}/${childName}`;
};

const getParentPath = (targetPath) => {
  if (!targetPath || targetPath === "/" || targetPath === "~") {
    return targetPath || "/";
  }

  const normalizedPath =
    targetPath.length > 1 && targetPath.endsWith("/")
      ? targetPath.slice(0, -1)
      : targetPath;
  const lastSlashIndex = normalizedPath.lastIndexOf("/");

  if (lastSlashIndex <= 0) {
    return normalizedPath.startsWith("~") ? "~" : "/";
  }

  return normalizedPath.slice(0, lastSlashIndex);
};

const normalizeTransferName = (name) =>
  typeof name === "string" ? name.trim() : "";

const buildTransferDisplayName = (names, itemLabel = "项目") => {
  const normalizedNames = Array.from(
    new Set((names || []).map(normalizeTransferName).filter(Boolean)),
  );

  if (normalizedNames.length === 0) {
    return "";
  }

  if (normalizedNames.length === 1) {
    return normalizedNames[0];
  }

  return `${normalizedNames[0]} 等 ${normalizedNames.length} 个${itemLabel}`;
};

const getTopLevelTransferItemName = (targetPath) => {
  const normalizedPath = String(targetPath || "")
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\/+/, "");

  if (!normalizedPath) {
    return "";
  }

  const [firstSegment] = normalizedPath.split("/").filter(Boolean);
  return firstSegment || "";
};

const getLocalPathBaseName = (localPath) => {
  const normalized = String(localPath || "").replace(/[\\/]+$/, "");
  const parts = normalized.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || "";
};

const getDroppedEntryName = (entry) => {
  const name = typeof entry?.name === "string" ? entry.name : "";
  if (!name || name === "." || name === ".." || /[\\/]/.test(name)) {
    return "";
  }
  return name;
};

const joinDroppedLocalPath = (basePath, childName) => {
  const base = String(basePath || "");
  const child = typeof childName === "string" ? childName : "";

  if (
    !base ||
    !child ||
    child === "." ||
    child === ".." ||
    /[\\/]/.test(child)
  ) {
    return "";
  }

  const separator = base.includes("\\") ? "\\" : "/";
  return `${base}${/[\\/]$/.test(base) ? "" : separator}${child}`;
};

const normalizeNavigationState = (navigationState, currentPath = "/") => {
  const safeCurrentPath =
    typeof currentPath === "string" && currentPath.trim() ? currentPath : "/";

  let pathHistory = Array.isArray(navigationState?.pathHistory)
    ? navigationState.pathHistory.filter(
        (value) => typeof value === "string" && value.trim(),
      )
    : [];

  if (pathHistory.length > FILE_MANAGER_PATH_HISTORY_LIMIT) {
    pathHistory = pathHistory.slice(-FILE_MANAGER_PATH_HISTORY_LIMIT);
  }

  const currentPathIndex = pathHistory.lastIndexOf(safeCurrentPath);
  if (currentPathIndex === -1) {
    pathHistory = [...pathHistory, safeCurrentPath];
    if (pathHistory.length > FILE_MANAGER_PATH_HISTORY_LIMIT) {
      pathHistory = pathHistory.slice(-FILE_MANAGER_PATH_HISTORY_LIMIT);
    }
  }

  return {
    pathHistory,
    historyIndex: pathHistory.lastIndexOf(safeCurrentPath),
  };
};

const VirtualizedFileRow = memo(function VirtualizedFileRow({
  index,
  style,
  rows,
  isFileSelected,
  onContextMenu,
  onSelect,
  onActivate,
  theme,
}) {
  const row = rows[index];
  if (!row) return null;

  const { file, secondaryText } = row;
  const isSelected = isFileSelected(file);

  return (
    <div
      style={{
        ...style,
        boxSizing: "border-box",
        padding: "2px 4px",
      }}
    >
      <ListItem
        disablePadding
        disableGutters
        onContextMenu={(e) => onContextMenu(e, file, index)}
        sx={{
          py: 0,
          my: 0,
          minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
          height: FILE_LIST_ITEM_MIN_HEIGHT,
        }}
      >
        <ListItemButton
          data-file-item="true"
          onClick={(e) => onSelect(file, index, e)}
          onDoubleClick={() => onActivate(file)}
          dense
          selected={isSelected}
          sx={{
            minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
            height: FILE_LIST_ITEM_MIN_HEIGHT,
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            transition:
              "background-color 0.15s ease-in-out, border-color 0.15s ease-in-out",
            userSelect: "none",
            cursor: "default",
            "&.Mui-selected": {
              backgroundColor: alpha(theme.palette.primary.main, 0.12),
              "&:hover": {
                backgroundColor: alpha(theme.palette.primary.main, 0.18),
              },
            },
            "&:hover": {
              backgroundColor: theme.palette.action.hover,
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 24, mr: 0.75 }}>
            {file.isDirectory ? (
              <FolderIcon color="primary" sx={{ fontSize: 20 }} />
            ) : (
              <InsertDriveFileIcon sx={{ fontSize: 20 }} />
            )}
          </ListItemIcon>
          <ListItemText
            disableTypography
            primary={
              <OverflowTooltipText
                variant="body2"
                sx={FILE_LIST_NAME_SX}
                tooltipTitle={file.name || ""}
              >
                {file.name || ""}
              </OverflowTooltipText>
            }
            secondary={
              <Box component="span" sx={FILE_LIST_SECONDARY_TEXT_SX}>
                {secondaryText}
              </Box>
            }
            sx={FILE_LIST_TEXT_SX}
          />
        </ListItemButton>
      </ListItem>
    </div>
  );
});

const FileManager = memo(
  ({
    open,
    onClose,
    sshConnection,
    tabId,
    tabName,
    initialPath = "/",
    navigationState,
    onPathChange,
    onNavigationStateChange,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const normalizedInitialPath =
      typeof initialPath === "string" && initialPath.trim() ? initialPath : "/";
    const initialNavigationState = useMemo(
      () => normalizeNavigationState(navigationState, normalizedInitialPath),
      [navigationState, normalizedInitialPath],
    );
    const [currentPath, setCurrentPath] = useState(normalizedInitialPath);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // 连接/重试期间的轻量 loading（避免侧边栏内容区域空白）
    const [connectionLoading, setConnectionLoading] = useState(false);
    const [connectionLoadingMessage, setConnectionLoadingMessage] =
      useState("");
    const [lastRefreshTime, setLastRefreshTime] = useState(null);
    const [, forceUpdate] = useState(0); // 用于强制更新组件以刷新时间显示
    const directoryCacheRef = useRef(new Map());

    // 使用 ref 读取最新状态，避免将高频状态放入 useCallback/useMemo 依赖导致函数频繁重建
    const currentPathRef = useRef(currentPath);
    useEffect(() => {
      currentPathRef.current = currentPath;
    }, [currentPath]);

    const loadingRef = useRef(loading);
    useEffect(() => {
      loadingRef.current = loading;
    }, [loading]);
    const [isDeleting, setIsDeleting] = useState(false);
    const isDeletingRef = useRef(isDeleting);
    useEffect(() => {
      isDeletingRef.current = isDeleting;
    }, [isDeleting]);

    const openRef = useRef(open);
    useEffect(() => {
      openRef.current = open;
    }, [open]);

    useEffect(() => {
      if (!open) {
        setConnectionLoading(false);
        setConnectionLoadingMessage("");
        setIsClosing(false);
      }
    }, [open]);

    const lastRefreshTimeRef = useRef(lastRefreshTime);
    useEffect(() => {
      lastRefreshTimeRef.current = lastRefreshTime;
    }, [lastRefreshTime]);
    const markLastRefreshTime = useCallback((timestamp = Date.now()) => {
      lastRefreshTimeRef.current = timestamp;
      setLastRefreshTime(timestamp);
    }, []);
    const [contextMenu, setContextMenu] = useState(null);
    const fileManagerRootRef = useRef(null);
    const contextMenuRedispatchingRef = useRef(false);
    const [searchTerm, setSearchTerm] = useState("");
    const searchInputRef = useRef(null);
    const [showSearch, setShowSearch] = useState(false);
    useEffect(() => {
      if (!showSearch) {
        return;
      }

      const timeoutId = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 0);

      return () => clearTimeout(timeoutId);
    }, [showSearch]);
    const [selectedFile, setSelectedFile] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState([]); // 多选文件列表
    const [, setLastSelectedIndex] = useState(-1); // 用于Shift范围选择
    const [anchorIndex, setAnchorIndex] = useState(-1); // Shift选择的锚点索引
    const [showRenameDialog, setShowRenameDialog] = useState(false);
    const [newName, setNewName] = useState("");
    const [renameDialogError, setRenameDialogError] = useState("");
    const [renameSubmitting, setRenameSubmitting] = useState(false);
    const [blankContextMenu, setBlankContextMenu] = useState(null);
    const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [createFolderDialogError, setCreateFolderDialogError] = useState("");
    const [createFolderSubmitting, setCreateFolderSubmitting] = useState(false);
    const [showCreateFileDialog, setShowCreateFileDialog] = useState(false);
    const [newFileName, setNewFileName] = useState("");
    const [createFileDialogError, setCreateFileDialogError] = useState("");
    const [createFileSubmitting, setCreateFileSubmitting] = useState(false);
    const [filePreview, setFilePreview] = useState(null);
    const [showPreview, setShowPreview] = useState(false);
    const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);
    const [propertiesLoading, setPropertiesLoading] = useState(false);
    const [propertiesData, setPropertiesData] = useState(null);
    const [pathInput, setPathInput] = useState(normalizedInitialPath);
    const [transferCancelled, setTransferCancelled] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [notification, setNotification] = useState(null);
    const [createMenuAnchor, setCreateMenuAnchor] = useState(null);
    const [uploadMenuAnchor, setUploadMenuAnchor] = useState(null);
    const [externalEditorEnabled, setExternalEditorEnabled] = useState(false);
    const [sortMode, setSortMode] = useState("name"); // "name" or "time"
    const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
    const [pathHistory, setPathHistory] = useState(
      initialNavigationState.pathHistory,
    ); // 路径历史记录
    const [historyIndex, setHistoryIndex] = useState(
      initialNavigationState.historyIndex,
    ); // 当前在历史记录中的位置
    const pathHistoryRef = useRef(pathHistory);
    useEffect(() => {
      pathHistoryRef.current = pathHistory;
    }, [pathHistory]);
    const historyIndexRef = useRef(historyIndex);
    useEffect(() => {
      historyIndexRef.current = historyIndex;
    }, [historyIndex]);
    useEffect(() => {
      if (!tabId || typeof onNavigationStateChange !== "function") {
        return;
      }

      onNavigationStateChange(tabId, {
        pathHistory,
        historyIndex,
      });
    }, [tabId, pathHistory, historyIndex, onNavigationStateChange]);
    const skipInitialPathSyncRef = useRef(false);
    const previousInitialPathRef = useRef(normalizedInitialPath);
    const [isDragging, setIsDragging] = useState(false); // 拖拽状态
    const [, setDragCounter] = useState(0); // 拖拽计数器，用于处理子元素的dragenter/dragleave
    const selectedFileRef = useRef(selectedFile);
    useEffect(() => {
      selectedFileRef.current = selectedFile;
    }, [selectedFile]);
    const selectedFilesRef = useRef(selectedFiles);
    useEffect(() => {
      selectedFilesRef.current = selectedFiles;
    }, [selectedFiles]);
    const throttledLoadStateRef = useRef({
      lastExecution: 0,
      timeoutId: null,
    });

    // 权限弹窗状态
    const [showPermissionDialog, setShowPermissionDialog] = useState(false);
    const [permDialogPermissions, setPermDialogPermissions] = useState("644");
    const [permDialogOwner, setPermDialogOwner] = useState("");
    const [permDialogGroup, setPermDialogGroup] = useState("");
    const [permInitial, setPermInitial] = useState({
      permissions: "",
      owner: "",
      group: "",
    });

    // 确认对话框状态
    const [confirmDialog, setConfirmDialog] = useState({
      ...CONFIRM_DIALOG_INITIAL_STATE,
    });
    const confirmDialogResolveRef = useRef(null);
    const confirmDialogCancelButtonRef = useRef(null);
    const confirmDialogConfirmButtonRef = useRef(null);

    useEffect(
      () => () => {
        if (confirmDialogResolveRef.current) {
          confirmDialogResolveRef.current(false);
          confirmDialogResolveRef.current = null;
        }
      },
      [],
    );

    const showConfirmDialog = useCallback((options) => {
      if (confirmDialogResolveRef.current) {
        confirmDialogResolveRef.current(false);
      }

      return new Promise((resolve) => {
        confirmDialogResolveRef.current = resolve;
        setConfirmDialog({
          ...CONFIRM_DIALOG_INITIAL_STATE,
          ...options,
          open: true,
          onConfirm: null,
        });
      });
    }, []);

    const closeConfirmDialog = useCallback((confirmed) => {
      const resolver = confirmDialogResolveRef.current;
      confirmDialogResolveRef.current = null;
      setConfirmDialog((prev) => ({
        ...prev,
        open: false,
        onConfirm: null,
      }));

      if (resolver) {
        resolver(confirmed);
      }
    }, []);

    const handleConfirmDialogCancel = useCallback(() => {
      closeConfirmDialog(false);
    }, [closeConfirmDialog]);

    const handleConfirmDialogConfirm = useCallback(() => {
      const onConfirm = confirmDialog.onConfirm;
      closeConfirmDialog(true);

      if (typeof onConfirm === "function") {
        onConfirm();
      }
    }, [closeConfirmDialog, confirmDialog.onConfirm]);

    const clearSelection = useCallback(() => {
      setSelectedFiles([]);
      setSelectedFile(null);
      setLastSelectedIndex(-1);
      setAnchorIndex(-1);
    }, []);

    const getSelectionIdentity = useCallback((file) => {
      if (!file || typeof file.name !== "string") {
        return "";
      }
      return `${file.isDirectory ? "dir" : "file"}:${file.name}`;
    }, []);

    const reconcileSelectionWithNextList = useCallback(
      (nextList) => {
        if (!Array.isArray(nextList) || nextList.length === 0) {
          clearSelection();
          return;
        }

        const nextEntriesByKey = new Map();
        nextList.forEach((file, index) => {
          nextEntriesByKey.set(getSelectionIdentity(file), { file, index });
        });

        const seenKeys = new Set();
        const nextSelectedFiles = [];
        selectedFilesRef.current.forEach((file) => {
          const key = getSelectionIdentity(file);
          const match = nextEntriesByKey.get(key);
          if (key && match && !seenKeys.has(key)) {
            seenKeys.add(key);
            nextSelectedFiles.push(match.file);
          }
        });

        const currentSelectedKey = getSelectionIdentity(
          selectedFileRef.current,
        );
        const currentSelectedMatch = currentSelectedKey
          ? nextEntriesByKey.get(currentSelectedKey)
          : null;
        const preservedSelected = nextSelectedFiles[0] || null;
        const nextSelectedFile =
          currentSelectedMatch?.file || preservedSelected;
        const nextAnchorIndex = currentSelectedMatch
          ? currentSelectedMatch.index
          : nextSelectedFile
            ? nextList.findIndex(
                (file) =>
                  getSelectionIdentity(file) ===
                  getSelectionIdentity(nextSelectedFile),
              )
            : -1;

        setSelectedFiles(nextSelectedFiles);
        setSelectedFile(nextSelectedFile);
        setLastSelectedIndex(nextAnchorIndex);
        setAnchorIndex(nextAnchorIndex);
      },
      [clearSelection, getSelectionIdentity],
    );

    // 用于存储延迟移除定时器的引用

    // 拖拽事件处理函数
    // 增量加载优化：状态与缓冲
    const [isChunking, setIsChunking] = useState(false);
    const isChunkingRef = useRef(isChunking);
    useEffect(() => {
      isChunkingRef.current = isChunking;
    }, [isChunking]);
    const chunkBufferRef = useRef([]);
    const flushTimerRef = useRef(null);
    const filesRef = useRef(files);
    useEffect(() => {
      filesRef.current = files;
    }, [files]);
    const externalEditorEventThrottles = useRef(new Map());

    const handleDragEnter = useCallback((e) => {
      e.preventDefault();
      e.stopPropagation();

      // 增加计数器
      setDragCounter((prev) => prev + 1);

      // 检查是否包含文件
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    }, []);

    const handleDragLeave = useCallback((e) => {
      e.preventDefault();
      e.stopPropagation();

      // 减少计数器
      setDragCounter((prev) => {
        const newCounter = prev - 1;
        // 只有当计数器为0时才真正离开拖拽区域
        if (newCounter === 0) {
          setIsDragging(false);
        }
        return newCounter;
      });
    }, []);

    const handleDragOver = useCallback((e) => {
      e.preventDefault();
      e.stopPropagation();

      // 设置允许的拖拽效果
      e.dataTransfer.dropEffect = "copy";
    }, []);

    const focusSidebarRoot = (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const focusableTarget = event.target.closest(
        'input, textarea, select, button, [role="button"], [tabindex]',
      );
      if (focusableTarget && focusableTarget !== fileManagerRootRef.current) {
        return;
      }
      fileManagerRootRef.current?.focus({ preventScroll: true });
    };

    // 键盘快捷键处理
    useEffect(() => {
      const handleKeyDown = (e) => {
        // 只在文件管理器打开时处理快捷键
        if (!open || showPreview) return;

        const targetElement = e.target || document.activeElement;
        if (
          targetElement &&
          typeof targetElement.closest === "function" &&
          targetElement.closest('[data-file-preview-dialog="true"]')
        ) {
          return;
        }

        // 检查当前焦点是否在终端区域内，如果是则不处理侧边栏快捷键
        const activeElement = document.activeElement;
        const isInTerminal =
          activeElement &&
          (activeElement.classList.contains("xterm-helper-textarea") ||
            activeElement.classList.contains("xterm-screen"));

        // 如果焦点在终端的输入区域内，则不处理侧边栏的快捷键
        if (isInTerminal) return;

        const isFocusInSidebar =
          activeElement && fileManagerRootRef.current?.contains(activeElement);

        // Ctrl+/ 全局聚焦搜索框；Ctrl+F 仅在焦点位于侧边栏内时接管浏览器查找
        if (
          e.ctrlKey &&
          (e.key === "/" || (e.key.toLowerCase() === "f" && isFocusInSidebar))
        ) {
          e.preventDefault();
          e.stopPropagation();
          if (!showSearch) {
            setShowSearch(true);
          }
          // 等待一帧后聚焦，确保输入框已渲染
          setTimeout(() => {
            if (searchInputRef.current) {
              searchInputRef.current.focus();
            }
          }, 0);
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [open, showSearch, showPreview]);

    // 使用自动清理Hook
    const { addEventListener, addTimeout } = useAutoCleanup();

    useEffect(() => {
      let ignore = false;

      const loadExternalEditorSetting = async () => {
        if (!window.terminalAPI?.loadUISettings) {
          if (!ignore) {
            setExternalEditorEnabled(false);
          }
          return;
        }
        try {
          const settings = await window.terminalAPI.loadUISettings();
          if (!ignore) {
            setExternalEditorEnabled(
              settings?.externalEditor?.enabled === true,
            );
          }
        } catch {
          if (!ignore) {
            setExternalEditorEnabled(false);
          }
        }
      };

      loadExternalEditorSetting();

      return () => {
        ignore = true;
      };
    }, []);

    useEffect(() => {
      // addEventListener 返回资源ID用于管理，而不是清理函数
      // useAutoCleanup会在组件卸载时自动清理
      addEventListener(window, "settingsChanged", (event) => {
        const externalEditorSettings = event.detail?.externalEditor;
        if (
          externalEditorSettings &&
          typeof externalEditorSettings.enabled === "boolean"
        ) {
          setExternalEditorEnabled(externalEditorSettings.enabled);
        }
      });
      // useEffect 不应该返回 addEventListener 的返回值
    }, [addEventListener]);

    const showNotification = useCallback(
      (
        message,
        severity = "info",
        duration = 3000,
        showAction = false,
        actionCallback = null,
      ) => {
        setNotification({
          message,
          severity,
          duration,
          showAction,
          actionCallback,
        });

        if (severity !== "error" && duration > 0) {
          addTimeout(() => setNotification(null), duration);
        }
      },
      [addTimeout],
    );

    const {
      transferList,
      addTransferProgress: storeAddTransferProgress,
      updateTransferProgress: storeUpdateTransferProgress,
      scheduleTransferCleanup: storeScheduleTransferCleanup,
    } = useGlobalTransfers(tabId);

    const transferProgressList = transferList;

    // 缓存过期时间（毫秒）
    const CACHE_EXPIRY_TIME = 10000; // 10秒

    // 自动刷新相关参数
    const USER_ACTIVITY_REFRESH_DELAY = 300; // 将用户活动后刷新延迟从1000ms减少到300ms
    const DIRECTORY_WATCH_INTERVAL_MS = 1500;

    // 防止主进程阻塞时反复触发 IPC，导致 listFiles 积压
    const BACKGROUND_REFRESH_MIN_INTERVAL_MS = 2000;
    const BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS = 60000;

    // 传输进度管理函数
    // 添加新的传输任务
    const addTransferProgress = (transferData) => {
      return storeAddTransferProgress(transferData);
    };

    // 更新传输进度
    const updateTransferProgress = (transferId, updateData) => {
      storeUpdateTransferProgress(transferId, updateData);
    };

    // 清理已完成的传输任务

    // 清理所有传输任务

    const normalizeExistsResponse = useCallback((result) => {
      if (typeof result === "boolean") {
        return result;
      }

      if (result && typeof result === "object") {
        return result.exists === true;
      }

      return false;
    }, []);

    const revealDownloadedItem = useCallback(
      async (targetPath) => {
        if (!targetPath) {
          return;
        }

        if (!window.terminalAPI?.showItemInFolder) {
          showNotification(
            t("fileManager.messages.openDownloadedLocationFailed", {
              path: targetPath,
            }),
            "warning",
          );
          return;
        }

        try {
          const response =
            await window.terminalAPI.showItemInFolder(targetPath);
          if (!response?.success) {
            showNotification(
              t("fileManager.messages.openDownloadedLocationFailed", {
                path: targetPath,
              }),
              "warning",
            );
          }
        } catch {
          showNotification(
            t("fileManager.messages.openDownloadedLocationFailed", {
              path: targetPath,
            }),
            "warning",
          );
        }
      },
      [showNotification, t],
    );

    const showDownloadedLocationNotification = useCallback(
      async ({
        itemName,
        downloadPath,
        successMessage,
        missingPathMessage,
        severity = "success",
        duration = 15000,
      }) => {
        const resolvedItemName = itemName || t("fileManager.fileTypes.file");
        const normalizedPath =
          typeof downloadPath === "string" && downloadPath.trim()
            ? downloadPath.replace(/\//g, "\\")
            : "";

        if (!normalizedPath) {
          showNotification(
            successMessage ||
              t("fileManager.messages.downloadCompleted", {
                name: resolvedItemName,
              }),
            severity,
            duration,
          );
          return;
        }

        let exists = true;
        if (window.terminalAPI?.checkPathExists) {
          try {
            exists = normalizeExistsResponse(
              await window.terminalAPI.checkPathExists(normalizedPath),
            );
          } catch {
            exists = true;
          }
        }

        if (!exists) {
          showNotification(
            missingPathMessage ||
              t("fileManager.messages.downloadMissingPath", {
                name: resolvedItemName,
                path: normalizedPath,
              }),
            "warning",
            10000,
          );
          return;
        }

        showNotification(
          successMessage ||
            t("fileManager.messages.downloadSavedToPath", {
              name: resolvedItemName,
              path: normalizedPath,
            }),
          severity,
          duration,
          true,
          () => {
            void revealDownloadedItem(normalizedPath);
          },
        );
      },
      [normalizeExistsResponse, revealDownloadedItem, showNotification, t],
    );

    const buildBatchDownloadStatusText = useCallback(
      ({ processedFiles = 0, totalFiles = 0, currentFile = "" } = {}) => {
        if (currentFile) {
          return t("fileManager.transfer.status.downloadingFile", {
            name: currentFile,
          });
        }

        if (totalFiles > 1) {
          const completedCount = Math.max(0, Number(processedFiles) || 0);
          return t("fileManager.transfer.status.downloadingBatch", {
            completed: Math.min(completedCount, totalFiles),
            total: totalFiles,
          });
        }

        return t("fileManager.transfer.status.downloading");
      },
      [t],
    );

    const buildFolderDownloadStatusText = useCallback(
      ({ currentFile = "", processedFiles = 0, totalFiles = 0 } = {}) => {
        if (currentFile) {
          return t("fileManager.transfer.status.downloadingFile", {
            name: currentFile,
          });
        }

        if (totalFiles > 0) {
          const completedCount = Math.max(0, Number(processedFiles) || 0);
          return t("fileManager.transfer.status.processingFolder", {
            completed: Math.min(completedCount, totalFiles),
            total: totalFiles,
          });
        }

        return t("fileManager.transfer.status.scanningRemoteFolder");
      },
      [t],
    );

    // 检查错误消息是否与用户取消操作相关
    const isUserCancellationError = (error) => {
      // 检查错误对象
      if (!error) return false;

      // 如果是字符串类型的错误消息
      if (typeof error === "string") {
        return (
          error.includes("cancel") ||
          error.includes("abort") ||
          error.includes(t("fileManager.errors.userCancelled")) ||
          error.includes(t("fileManager.errors.transferCancelled"))
        );
      }

      // 如果是带有message属性的错误对象
      if (error.message) {
        return (
          error.message.includes("cancel") ||
          error.message.includes("abort") ||
          error.message.includes(t("fileManager.errors.userCancelled")) ||
          error.message.includes(t("fileManager.errors.transferCancelled"))
        );
      }

      // 如果是API响应对象
      if (error.error) {
        return (
          error.error.includes("cancel") ||
          error.error.includes("abort") ||
          error.error.includes(t("fileManager.errors.userCancelled")) ||
          error.error.includes(t("fileManager.errors.transferCancelled")) ||
          error.userCancelled ||
          error.cancelled
        );
      }

      // 检查特殊标志
      return error.userCancelled || error.cancelled;
    };

    // 更新当前路径并通知父组件
    const updateCurrentPath = (newPath, isHistoryNavigation = false) => {
      currentPathRef.current = newPath;
      setCurrentPath(newPath);
      if (onPathChange && tabId) {
        skipInitialPathSyncRef.current = true;
        onPathChange(tabId, newPath);
      }

      // 只有在非历史导航时才添加到历史记录
      if (!isHistoryNavigation) {
        addToHistory(newPath);
      }
    };

    // 当SSH连接改变时，重置状态并加载目录
    useEffect(() => {
      if (!open) {
        return;
      }

      if (!tabId) {
        setError(t("fileManager.errors.missingConnectionInfo"));
        return;
      }

      if (!sshConnection) {
        setError(t("fileManager.errors.missingConnectionInfo"));
        return;
      }

      // 先检查API是否可用
      if (!window.terminalAPI || !window.terminalAPI.listFiles) {
        setError(t("fileManager.errors.fileApiNotAvailable"));
        return;
      }

      // 使用记忆的路径或默认路径
      const pathToLoad = normalizedInitialPath;
      const isSamePath = pathToLoad === currentPathRef.current;
      const initialPathChanged =
        previousInitialPathRef.current !== normalizedInitialPath;
      previousInitialPathRef.current = normalizedInitialPath;

      if (skipInitialPathSyncRef.current && initialPathChanged && isSamePath) {
        skipInitialPathSyncRef.current = false;
        setPathInput(pathToLoad);
        return;
      }

      skipInitialPathSyncRef.current = false;

      // 清空缓存
      directoryCacheRef.current.clear();

      currentPathRef.current = pathToLoad;
      setCurrentPath(pathToLoad);
      setPathInput(pathToLoad);
      loadDirectory(pathToLoad, 0, false, true);
    }, [open, sshConnection, tabId, normalizedInitialPath]);

    // 从缓存中获取目录内容
    // 增量目录加载 token（listFiles 首批响应返回）
    const [listToken, setListToken] = useState(null);
    const listTokenRef = useRef(listToken);
    useEffect(() => {
      listTokenRef.current = listToken;
    }, [listToken]);

    // 后台目录刷新（用于轮询/用户活动后的静默刷新），与前台目录加载(listToken)分离
    const backgroundListRequestRef = useRef({
      inFlight: false,
      token: null,
      apiPath: null,
      startedAt: 0,
      reason: null, // "directoryWatch" | "userActivity" | "manual" | ...
      resolve: null,
      reject: null,
      watchdog: null,
    });
    const backgroundListBufferRef = useRef([]);
    const backgroundListLastAttemptAtRef = useRef(0);
    // 前台目录加载计数（同步更新，避免 setState 延迟导致与静默刷新竞态）
    const foregroundLoadCountRef = useRef(0);
    // 前台目录加载请求序号：仅允许最新请求回写 UI，避免旧响应覆盖新目录
    const activeForegroundLoadRequestIdRef = useRef(0);

    // 稳定列表签名（用于判断文件列表是否变化，避免对大列表 JSON.stringify）
    const stableListSignatureRef = useRef(null);
    const stableListSignatureKeyRef = useRef(null);
    const directoryWatchIdRef = useRef(null);
    const directoryWatchPathRef = useRef(null);
    const directoryWatchGenerationRef = useRef(0);
    const pendingDirectoryWatchRefreshRef = useRef(false);
    const directoryWatchRefreshRetryTimerRef = useRef(null);

    const toApiPath = useCallback((path) => {
      if (path === "~") return "";
      return path || "";
    }, []);

    const makeListKey = useCallback((id, apiPath) => {
      return `${id || ""}::${apiPath || ""}`;
    }, []);

    // 低成本(近似)签名：对每个条目做 hash，再用 sum/xor 合并，避免对大数组 JSON.stringify
    const computeFileListSignature = useCallback((list) => {
      if (!Array.isArray(list) || list.length === 0) return "0:0:0";

      let xor = 0;
      let sum = 0;

      for (let i = 0; i < list.length; i++) {
        const f = list[i] || {};
        const name = typeof f.name === "string" ? f.name : "";
        const modifyTime = Number.isFinite(f.modifyTime) ? f.modifyTime : 0;
        const size = Number.isFinite(f.size) ? f.size : 0;
        const isDir = f.isDirectory ? 1 : 0;

        // FNV-1a 32-bit (via Math.imul for speed)
        let h = 2166136261;
        const s = `${name}\u0000${modifyTime}\u0000${size}\u0000${isDir}`;
        for (let j = 0; j < s.length; j++) {
          h ^= s.charCodeAt(j);
          h = Math.imul(h, 16777619);
        }
        h >>>= 0;

        xor ^= h;
        sum = (sum + h) >>> 0;
      }

      return `${list.length}:${(xor >>> 0).toString(16)}:${sum.toString(16)}`;
    }, []);

    const getDirectoryFromCache = (path) => {
      const cacheEntry = directoryCacheRef.current.get(path);
      if (!cacheEntry) {
        return null;
      }
      const now = Date.now();

      // 检查缓存是否过期
      if (now - cacheEntry.timestamp > CACHE_EXPIRY_TIME) {
        return null;
      }
      return cacheEntry.data;
    };

    // 更新目录缓存
    const updateDirectoryCache = (path, data) => {
      directoryCacheRef.current.set(path, {
        data,
        timestamp: Date.now(),
      });
    };

    // 订阅非阻塞目录分片事件
    useEffect(() => {
      if (!window.terminalAPI || !window.terminalAPI.onListFilesChunk) return;

      const unsubscribe = window.terminalAPI.onListFilesChunk((payload) => {
        try {
          // 侧边栏关闭或组件未挂载时忽略异步分片更新，防止竞态/异常
          if (!openRef.current) return;
          if (!payload || payload.tabId !== tabId || !payload.token) return;

          const apiPath = toApiPath(currentPathRef.current);
          const bg = backgroundListRequestRef.current;
          const fgToken = listTokenRef.current;

          const isForeground =
            payload.path === apiPath && payload.token === fgToken;
          const isBackground =
            Boolean(bg?.inFlight) &&
            payload.path === bg.apiPath &&
            payload.token === bg.token;

          if (!isForeground && !isBackground) return;

          // 后台刷新：先缓冲，done 时再一次性判断变化并更新 UI（避免轮询导致列表闪烁/重置选择）
          if (isBackground) {
            if (Array.isArray(payload.items) && payload.items.length > 0) {
              // 直接 push，避免 concat 产生额外数组
              backgroundListBufferRef.current.push(...payload.items);
            }

            if (payload.done) {
              const nextList = Array.isArray(backgroundListBufferRef.current)
                ? backgroundListBufferRef.current
                : [];
              backgroundListBufferRef.current = [];

              // 清理 watchdog/状态
              try {
                if (bg.watchdog) clearTimeout(bg.watchdog);
              } catch {
                /* intentionally ignored */
              }
              bg.watchdog = null;

              const resolve = bg.resolve;
              bg.inFlight = false;
              bg.token = null;
              bg.apiPath = null;
              bg.startedAt = 0;
              bg.reason = null;
              bg.resolve = null;
              bg.reject = null;

              // 路径切换/前台加载时丢弃后台结果（避免覆盖用户的显式操作）
              const stillSamePath =
                toApiPath(currentPathRef.current) === payload.path;
              const canApply =
                stillSamePath &&
                foregroundLoadCountRef.current === 0 &&
                !loadingRef.current &&
                !listTokenRef.current &&
                !isChunkingRef.current;

              if (canApply) {
                const key = makeListKey(tabId, payload.path);
                const prevSig =
                  stableListSignatureKeyRef.current === key
                    ? stableListSignatureRef.current
                    : computeFileListSignature(filesRef.current || []);
                const nextSig = computeFileListSignature(nextList);
                const changed = prevSig !== nextSig;

                // 即使未变化，也更新缓存与刷新时间（保证侧边栏“最近刷新”正确）
                updateDirectoryCache(currentPathRef.current, nextList);
                markLastRefreshTime();

                if (changed) {
                  setFiles(nextList);
                  reconcileSelectionWithNextList(nextList);
                }

                stableListSignatureKeyRef.current = key;
                stableListSignatureRef.current = nextSig;

                if (typeof resolve === "function") {
                  resolve({ ok: true, changed });
                }
              } else {
                if (typeof resolve === "function") {
                  resolve({ ok: true, changed: false, discarded: true });
                }
              }
            }
            return;
          }

          // 前台目录加载：分片增量更新 UI
          if (Array.isArray(payload.items) && payload.items.length > 0) {
            isChunkingRef.current = true;
            setIsChunking(true);

            // buffer chunks and batch update to reduce re-renders
            try {
              chunkBufferRef.current.push(payload.items);
              if (!flushTimerRef.current) {
                flushTimerRef.current = setTimeout(() => {
                  try {
                    const buffered = chunkBufferRef.current.flat();
                    chunkBufferRef.current = [];
                    if (buffered.length > 0) {
                      const nextFiles = (filesRef.current || []).concat(
                        buffered,
                      );
                      filesRef.current = nextFiles;
                      setFiles(nextFiles);
                    }
                  } finally {
                    flushTimerRef.current = null;
                  }
                }, 80);
              }
            } catch {
              setFiles((prev) => prev.concat(payload.items));
            }
          }

          // finalize chunked loading with buffer flush
          if (payload.done) {
            if (flushTimerRef.current) {
              clearTimeout(flushTimerRef.current);
              flushTimerRef.current = null;
            }
            const remaining = chunkBufferRef.current.flat();
            chunkBufferRef.current = [];
            if (remaining.length > 0) {
              const nextFiles = (filesRef.current || []).concat(remaining);
              filesRef.current = nextFiles;
              setFiles(nextFiles);
            }

            updateDirectoryCache(
              currentPathRef.current,
              filesRef.current || [],
            );

            // 更新稳定签名，供轮询快速比较
            try {
              const key = makeListKey(tabId, apiPath);
              stableListSignatureKeyRef.current = key;
              stableListSignatureRef.current = computeFileListSignature(
                filesRef.current || [],
              );
            } catch {
              /* intentionally ignored */
            }

            listTokenRef.current = null;
            setListToken(null);
            isChunkingRef.current = false;
            setIsChunking(false);
            markLastRefreshTime();
          }
        } catch {
          // ignore
        }
      });

      return () => {
        if (typeof unsubscribe === "function") unsubscribe();
      };
    }, [
      tabId,
      toApiPath,
      makeListKey,
      computeFileListSignature,
      reconcileSelectionWithNextList,
      markLastRefreshTime,
    ]);

    const startBackgroundDirectoryRefresh = useCallback(
      async ({ reason = "userActivity", awaitDone = true } = {}) => {
        const curPath = currentPathRef.current;
        const curLoading = loadingRef.current;
        const curChunking = isChunkingRef.current;
        const curListToken = listTokenRef.current;
        const curLastRefresh = lastRefreshTimeRef.current;

        // 仅在侧边栏打开且连接信息齐全时运行
        if (!open || !sshConnection || !tabId || !curPath) {
          return { ok: false, skipped: true, reason: "missingContext" };
        }
        if (!window.terminalAPI || !window.terminalAPI.listFiles) {
          return { ok: false, skipped: true, reason: "apiUnavailable" };
        }

        // 避免与前台目录加载/分片渲染并发，减少队列积压
        if (
          foregroundLoadCountRef.current > 0 ||
          curLoading ||
          curChunking ||
          curListToken
        ) {
          return { ok: false, skipped: true, reason: "busy" };
        }

        // 避免在一次刷新刚完成后立即再次刷新，减少竞态/抖动
        try {
          if (curLastRefresh && Date.now() - curLastRefresh < 700) {
            return { ok: false, skipped: true, reason: "recentlyRefreshed" };
          }
        } catch {
          /* intentionally ignored */
        }

        const now = Date.now();
        const lastAttempt = backgroundListLastAttemptAtRef.current || 0;
        if (now - lastAttempt < BACKGROUND_REFRESH_MIN_INTERVAL_MS) {
          return { ok: false, skipped: true, reason: "throttled" };
        }
        backgroundListLastAttemptAtRef.current = now;

        const bg = backgroundListRequestRef.current;
        if (bg.inFlight) {
          // 超过最大等待时间认为卡死，释放锁（防止一直无法刷新）
          if (
            bg.startedAt &&
            now - bg.startedAt > BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS
          ) {
            try {
              if (bg.watchdog) clearTimeout(bg.watchdog);
            } catch {
              /* intentionally ignored */
            }
            bg.watchdog = null;
            bg.inFlight = false;
            bg.token = null;
            bg.apiPath = null;
            bg.startedAt = 0;
            bg.reason = null;
            bg.resolve = null;
            bg.reject = null;
            backgroundListBufferRef.current = [];
          } else {
            return { ok: false, skipped: true, reason: "inFlight" };
          }
        }

        const apiPath = toApiPath(curPath);

        // 初始化后台刷新上下文（结果由 listFiles:chunk done 回调统一处理）
        bg.inFlight = true;
        bg.token = null;
        bg.apiPath = apiPath;
        bg.startedAt = now;
        bg.reason = reason;
        backgroundListBufferRef.current = [];

        const donePromise = new Promise((resolve) => {
          bg.resolve = resolve;
        });

        const options = {
          type: "readdir",
          path: apiPath,
          canMerge: true,
          priority: "low",
          nonBlocking: true,
          chunkSize: 300,
        };

        let response = null;
        try {
          response = await window.terminalAPI.listFiles(
            tabId,
            apiPath,
            options,
          );
        } catch (error) {
          const resolve = bg.resolve;
          bg.inFlight = false;
          bg.token = null;
          bg.apiPath = null;
          bg.startedAt = 0;
          bg.reason = null;
          bg.resolve = null;
          bg.reject = null;
          backgroundListBufferRef.current = [];
          if (typeof resolve === "function") {
            resolve({ ok: false, error: error?.message || String(error) });
          }
          return { ok: false, error: error?.message || String(error) };
        }

        if (!response?.success) {
          const resolve = bg.resolve;
          bg.inFlight = false;
          bg.token = null;
          bg.apiPath = null;
          bg.startedAt = 0;
          bg.reason = null;
          bg.resolve = null;
          bg.reject = null;
          backgroundListBufferRef.current = [];
          if (typeof resolve === "function") {
            resolve({
              ok: false,
              error: response?.error || "listFiles failed",
            });
          }
          return { ok: false, error: response?.error || "listFiles failed" };
        }

        // nonBlocking 模式下依赖 token + chunk 事件完成
        if (response.chunked && response.token) {
          bg.token = response.token;

          // watchdog：避免主进程/IPC异常导致 inFlight 永久卡住
          try {
            if (bg.watchdog) clearTimeout(bg.watchdog);
          } catch {
            /* intentionally ignored */
          }
          bg.watchdog = setTimeout(() => {
            try {
              const cur = backgroundListRequestRef.current;
              if (cur && cur.inFlight && cur.token === response.token) {
                const resolve = cur.resolve;
                cur.inFlight = false;
                cur.token = null;
                cur.apiPath = null;
                cur.startedAt = 0;
                cur.reason = null;
                cur.resolve = null;
                cur.reject = null;
                try {
                  if (cur.watchdog) clearTimeout(cur.watchdog);
                } catch {
                  /* intentionally ignored */
                }
                cur.watchdog = null;
                backgroundListBufferRef.current = [];
                if (typeof resolve === "function") {
                  resolve({ ok: false, timeout: true });
                }
              }
            } catch {
              /* intentionally ignored */
            }
          }, BACKGROUND_REFRESH_MAX_IN_FLIGHT_MS);

          if (awaitDone) {
            return await donePromise;
          }

          // fire-and-forget 场景：避免未捕获 promise
          donePromise.catch(() => {});
          return { ok: true, started: true };
        }

        // 非阻塞刷新必须返回 token；没有 token 视为协议错误。
        const resolve = bg.resolve;
        bg.inFlight = false;
        bg.token = null;
        bg.apiPath = null;
        bg.startedAt = 0;
        bg.reason = null;
        bg.resolve = null;
        bg.reject = null;
        backgroundListBufferRef.current = [];
        const protocolError = "listFiles nonBlocking response missing token";
        if (typeof resolve === "function") {
          resolve({ ok: false, error: protocolError });
        }
        return { ok: false, error: protocolError };
      },
      [open, sshConnection, tabId, toApiPath],
    );

    // 静默刷新当前目录（不显示加载指示器）：用于用户活动触发，采用后台刷新并避免重复请求
    const silentRefreshCurrentDirectory = useCallback(() => {
      startBackgroundDirectoryRefresh({
        reason: "userActivity",
        awaitDone: false,
      }).catch(() => {});
    }, [startBackgroundDirectoryRefresh]);

    const flushPendingDirectoryWatchRefreshRef = useRef(null);

    const scheduleDirectoryWatchRefreshRetry = useCallback(
      (delayMs = BACKGROUND_REFRESH_MIN_INTERVAL_MS) => {
        try {
          if (directoryWatchRefreshRetryTimerRef.current) {
            clearTimeout(directoryWatchRefreshRetryTimerRef.current);
          }
        } catch {
          /* intentionally ignored */
        }

        directoryWatchRefreshRetryTimerRef.current = setTimeout(
          () => {
            if (
              typeof flushPendingDirectoryWatchRefreshRef.current === "function"
            ) {
              flushPendingDirectoryWatchRefreshRef.current();
            }
          },
          Math.max(250, delayMs),
        );
      },
      [],
    );

    const flushPendingDirectoryWatchRefresh = useCallback(() => {
      if (!pendingDirectoryWatchRefreshRef.current) {
        return;
      }

      if (
        !openRef.current ||
        !sshConnection ||
        !tabId ||
        !currentPathRef.current
      ) {
        return;
      }

      if (
        foregroundLoadCountRef.current > 0 ||
        loadingRef.current ||
        isChunkingRef.current ||
        listTokenRef.current
      ) {
        scheduleDirectoryWatchRefreshRetry(500);
        return;
      }

      pendingDirectoryWatchRefreshRef.current = false;

      startBackgroundDirectoryRefresh({
        reason: "directoryWatch",
        awaitDone: false,
      })
        .then((result) => {
          if (result?.ok) {
            return;
          }

          pendingDirectoryWatchRefreshRef.current = true;
          if (openRef.current) {
            scheduleDirectoryWatchRefreshRetry(
              result?.skipped ? 500 : BACKGROUND_REFRESH_MIN_INTERVAL_MS,
            );
          }
        })
        .catch(() => {
          pendingDirectoryWatchRefreshRef.current = true;
          if (openRef.current) {
            scheduleDirectoryWatchRefreshRetry(
              BACKGROUND_REFRESH_MIN_INTERVAL_MS,
            );
          }
        });
    }, [
      sshConnection,
      tabId,
      startBackgroundDirectoryRefresh,
      scheduleDirectoryWatchRefreshRetry,
    ]);

    flushPendingDirectoryWatchRefreshRef.current =
      flushPendingDirectoryWatchRefresh;

    useEffect(() => {
      flushPendingDirectoryWatchRefresh();
    }, [
      currentPath,
      isChunking,
      listToken,
      loading,
      flushPendingDirectoryWatchRefresh,
    ]);

    useEffect(() => {
      return () => {
        try {
          if (directoryWatchRefreshRetryTimerRef.current) {
            clearTimeout(directoryWatchRefreshRetryTimerRef.current);
          }
        } catch {
          /* intentionally ignored */
        }
        directoryWatchRefreshRetryTimerRef.current = null;

        const bg = backgroundListRequestRef.current;
        if (bg && bg.inFlight) {
          try {
            if (bg.watchdog) clearTimeout(bg.watchdog);
          } catch {
            /* intentionally ignored */
          }
          const resolve = bg.resolve;
          bg.inFlight = false;
          bg.token = null;
          bg.apiPath = null;
          bg.startedAt = 0;
          bg.reason = null;
          bg.resolve = null;
          bg.reject = null;
          bg.watchdog = null;
          backgroundListBufferRef.current = [];
          if (typeof resolve === "function") {
            resolve({ ok: false, cancelled: true });
          }
        }
      };
    }, [open, sshConnection, tabId, currentPath]);

    useEffect(() => {
      if (!window.terminalAPI?.onDirectoryWatchEvent || !tabId) {
        return undefined;
      }

      const unsubscribe = window.terminalAPI.onDirectoryWatchEvent((event) => {
        if (!event || event.tabId !== String(tabId)) {
          return;
        }

        if (
          !directoryWatchIdRef.current ||
          event.watchId !== directoryWatchIdRef.current ||
          event.path !== directoryWatchPathRef.current
        ) {
          return;
        }

        if (event.event === "changed") {
          pendingDirectoryWatchRefreshRef.current = true;
          flushPendingDirectoryWatchRefresh();
          return;
        }

        if (event.event === "error") {
          directoryWatchIdRef.current = null;
          directoryWatchPathRef.current = null;
          showNotification(
            t("fileManager.errors.directoryWatchFailed", {
              error: event.error || t("fileManager.errors.unknownError"),
            }),
            "error",
            6000,
          );
        }
      });

      return () => {
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      };
    }, [tabId, flushPendingDirectoryWatchRefresh, showNotification, t]);

    useEffect(() => {
      const generation = ++directoryWatchGenerationRef.current;
      let cancelled = false;

      const stopWatch = async (watchId) => {
        if (!watchId || !window.terminalAPI?.stopDirectoryWatch || !tabId) {
          return;
        }

        try {
          await window.terminalAPI.stopDirectoryWatch(tabId, watchId);
        } catch {
          /* intentionally ignored */
        }
      };

      const syncDirectoryWatch = async () => {
        const previousWatchId = directoryWatchIdRef.current;
        directoryWatchIdRef.current = null;
        directoryWatchPathRef.current = null;
        pendingDirectoryWatchRefreshRef.current = false;

        try {
          if (directoryWatchRefreshRetryTimerRef.current) {
            clearTimeout(directoryWatchRefreshRetryTimerRef.current);
          }
        } catch {
          /* intentionally ignored */
        }
        directoryWatchRefreshRetryTimerRef.current = null;

        if (previousWatchId) {
          await stopWatch(previousWatchId);
        }

        if (
          cancelled ||
          generation !== directoryWatchGenerationRef.current ||
          !open ||
          !sshConnection ||
          !tabId ||
          !window.terminalAPI?.startDirectoryWatch
        ) {
          return;
        }

        const watchPath = toApiPath(currentPath);

        try {
          const response = await window.terminalAPI.startDirectoryWatch(
            tabId,
            watchPath,
            {
              intervalMs: DIRECTORY_WATCH_INTERVAL_MS,
            },
          );

          if (cancelled || generation !== directoryWatchGenerationRef.current) {
            if (response?.success && response.watchId) {
              await stopWatch(response.watchId);
            }
            return;
          }

          if (!response?.success || !response?.watchId) {
            showNotification(
              t("fileManager.errors.directoryWatchFailed", {
                error: response?.error || t("fileManager.errors.unknownError"),
              }),
              "error",
              6000,
            );
            return;
          }

          directoryWatchIdRef.current = response.watchId;
          directoryWatchPathRef.current = watchPath;
        } catch (error) {
          if (cancelled || generation !== directoryWatchGenerationRef.current) {
            return;
          }

          showNotification(
            t("fileManager.errors.directoryWatchFailed", {
              error: error?.message || t("fileManager.errors.unknownError"),
            }),
            "error",
            6000,
          );
        }
      };

      syncDirectoryWatch().catch(() => {});

      return () => {
        cancelled = true;
        directoryWatchGenerationRef.current += 1;
        const activeWatchId = directoryWatchIdRef.current;
        directoryWatchIdRef.current = null;
        directoryWatchPathRef.current = null;
        pendingDirectoryWatchRefreshRef.current = false;

        try {
          if (directoryWatchRefreshRetryTimerRef.current) {
            clearTimeout(directoryWatchRefreshRetryTimerRef.current);
          }
        } catch {
          /* intentionally ignored */
        }
        directoryWatchRefreshRetryTimerRef.current = null;

        void stopWatch(activeWatchId);
      };
    }, [
      open,
      sshConnection,
      tabId,
      currentPath,
      toApiPath,
      showNotification,
      t,
      DIRECTORY_WATCH_INTERVAL_MS,
    ]);

    const updatePathHistoryState = useCallback((nextHistory, nextIndex) => {
      pathHistoryRef.current = nextHistory;
      historyIndexRef.current = nextIndex;
      setPathHistory(nextHistory);
      setHistoryIndex(nextIndex);
    }, []);

    // 添加路径到历史记录
    const addToHistory = useCallback(
      (path) => {
        const currentHistory = Array.isArray(pathHistoryRef.current)
          ? pathHistoryRef.current
          : [];
        const currentIndex = Number.isInteger(historyIndexRef.current)
          ? historyIndexRef.current
          : -1;
        const baseHistory =
          currentIndex >= 0 ? currentHistory.slice(0, currentIndex + 1) : [];

        let nextHistory = baseHistory;
        let nextIndex = currentIndex;

        if (
          baseHistory.length === 0 ||
          baseHistory[baseHistory.length - 1] !== path
        ) {
          nextHistory = [...baseHistory, path];
          if (nextHistory.length > FILE_MANAGER_PATH_HISTORY_LIMIT) {
            nextHistory = nextHistory.slice(-FILE_MANAGER_PATH_HISTORY_LIMIT);
          }
          nextIndex = nextHistory.length - 1;
        } else {
          nextIndex = baseHistory.length - 1;
        }

        updatePathHistoryState(nextHistory, nextIndex);
      },
      [updatePathHistoryState],
    );

    // 修改loadDirectory，添加刷新时间记录
    const loadDirectory = async (
      path,
      retryCount = 0,
      forceRefresh = false,
      isHistoryNavigation = false,
      requestId = undefined,
    ) => {
      const loadRequestId =
        typeof requestId === "number"
          ? requestId
          : (activeForegroundLoadRequestIdRef.current += 1);
      const isCurrentLoadRequest = () =>
        activeForegroundLoadRequestIdRef.current === loadRequestId;

      if (!isCurrentLoadRequest()) {
        return;
      }

      if (!sshConnection || !tabId) {
        if (isCurrentLoadRequest()) {
          setError(t("fileManager.errors.missingConnectionInfo"));
        }
        return;
      }

      // 切换路径时重置前台分片状态，避免旧分片残留导致持续加载
      try {
        if (flushTimerRef.current) {
          clearTimeout(flushTimerRef.current);
        }
      } catch {
        /* intentionally ignored */
      }
      flushTimerRef.current = null;
      chunkBufferRef.current = [];
      if (listTokenRef.current) {
        listTokenRef.current = null;
        setListToken(null);
      }
      if (isChunkingRef.current) {
        isChunkingRef.current = false;
        setIsChunking(false);
      }

      const isPathChanged = path !== currentPathRef.current;

      // 如果不是强制刷新，尝试从缓存获取数据
      if (!forceRefresh) {
        const cachedData = getDirectoryFromCache(path);
        if (cachedData) {
          if (!isCurrentLoadRequest()) {
            return;
          }
          filesRef.current = cachedData;
          setFiles(cachedData);
          updateCurrentPath(path, isHistoryNavigation);
          setPathInput(path);
          if (isPathChanged) {
            clearSelection();
          } else {
            reconcileSelectionWithNextList(cachedData);
          }
          return;
        }
      }

      foregroundLoadCountRef.current += 1;
      setLoading(true);
      setError(null);
      let isRetrying = false; // 标记是否正在重试

      try {
        if (!isCurrentLoadRequest()) {
          return;
        }

        if (isPathChanged) {
          // 进入新目录前同步清空 ref/state，避免旧列表在分片到达前残留
          filesRef.current = [];
          setFiles([]);
          clearSelection();
        }

        if (window.terminalAPI && window.terminalAPI.listFiles) {
          // 将~转换为空字符串，用于API调用
          const apiPath = path === "~" ? "" : path;

          // 使用可合并的目录读取操作
          const options = {
            type: "readdir",
            path: apiPath,
            canMerge: true,
            priority: forceRefresh ? "high" : "normal",
            nonBlocking: true,
            chunkSize: 300,
          };

          const response = await window.terminalAPI.listFiles(
            tabId,
            apiPath,
            options,
          );

          if (!isCurrentLoadRequest()) {
            return;
          }

          if (response?.success) {
            setConnectionLoading(false);
            setConnectionLoadingMessage("");
            const fileData = Array.isArray(response.data) ? response.data : [];
            if (response.chunked && response.token) {
              listTokenRef.current = response.token;
              setListToken(response.token);
              isChunkingRef.current = true;
              setIsChunking(true);
            } else {
              listTokenRef.current = null;
              setListToken(null);
              isChunkingRef.current = false;
              setIsChunking(false);
            }

            // 更新缓存
            updateDirectoryCache(path, fileData);

            filesRef.current = fileData;
            setFiles(fileData);
            updateCurrentPath(path, isHistoryNavigation); // 保持UI中显示~
            setPathInput(path);
            if (isPathChanged) {
              clearSelection();
            } else {
              reconcileSelectionWithNextList(fileData);
            }

            // 分片加载在 done 时记录刷新时间；非分片在此处记录
            if (!(response.chunked && response.token)) {
              markLastRefreshTime();
            }
          } else {
            // 处理错误，检查是否需要重试
            if (
              response?.error?.includes("SFTP错误") ||
              response?.error?.includes("Channel open failure") ||
              response?.error?.includes("SSH连接尚未就绪") ||
              response?.error?.includes("No SSH connection info found") ||
              response?.error?.includes("ECONNRESET")
            ) {
              // 如果是SFTP通道错误或SSH连接未就绪，且重试次数未达到上限，则进行重试
              if (retryCount < 5) {
                // 增加重试等待时间，指数退避算法
                const waitTime = Math.min(
                  500 * Math.pow(1.5, retryCount),
                  5000,
                ); // 最长等待5秒
                setConnectionLoading(true);
                setConnectionLoadingMessage(
                  t("fileManager.messages.retrying", {
                    current: retryCount + 1,
                    max: 5,
                  }),
                );

                // 先关闭loading状态，避免持续显示
                if (isCurrentLoadRequest()) {
                  setLoading(false);
                }
                isRetrying = true; // 标记正在重试

                // 添加延迟，避免立即重试
                setTimeout(() => {
                  loadDirectory(
                    path,
                    retryCount + 1,
                    forceRefresh,
                    isHistoryNavigation,
                    loadRequestId,
                  );
                }, waitTime);
                return;
              }
            }

            // 重试失败或其他错误
            if (isCurrentLoadRequest()) {
              setConnectionLoading(false);
              setConnectionLoadingMessage("");
              setError(
                response?.error || t("fileManager.errors.loadDirectoryFailed"),
              );
            }
          }
        } else {
          if (isCurrentLoadRequest()) {
            setConnectionLoading(false);
            setConnectionLoadingMessage("");
            setError(t("fileManager.errors.fileApiNotAvailable"));
          }
        }
      } catch (error) {
        if (!isCurrentLoadRequest()) {
          return;
        }

        // 加载目录失败

        // 如果是异常错误且重试次数未达到上限，则进行重试
        if (retryCount < 5) {
          // 增加重试等待时间，指数退避算法
          const waitTime = Math.min(500 * Math.pow(1.5, retryCount), 5000); // 最长等待5秒
          setConnectionLoading(true);
          setConnectionLoadingMessage(
            t("fileManager.messages.retrying", {
              current: retryCount + 1,
              max: 5,
            }),
          );

          // 先关闭loading状态，避免持续显示
          if (isCurrentLoadRequest()) {
            setLoading(false);
          }
          isRetrying = true; // 标记正在重试

          // 添加延迟，避免立即重试
          setTimeout(() => {
            loadDirectory(
              path,
              retryCount + 1,
              forceRefresh,
              isHistoryNavigation,
              loadRequestId,
            );
          }, waitTime);
          return;
        }

        if (isCurrentLoadRequest()) {
          setConnectionLoading(false);
          setConnectionLoadingMessage("");
          setError(
            t("fileManager.errors.loadDirectoryFailed") +
              ": " +
              (error.message || t("fileManager.errors.unknownError")),
          );
        }
      } finally {
        foregroundLoadCountRef.current = Math.max(
          0,
          foregroundLoadCountRef.current - 1,
        );
        // 只有在不重试的情况下才关闭loading
        if (!isRetrying && isCurrentLoadRequest()) {
          setLoading(false);
        }
      }
    };

    const loadDirectoryRef = useRef(loadDirectory);
    loadDirectoryRef.current = loadDirectory;

    // 刷新目录（强制从服务器重新加载）

    // 节流函数，用于限制连续的目录加载操作
    const throttleLoadDirectory = useCallback(
      (path, forceRefresh = false, isHistoryNavigation = false) => {
        const throttleState = throttledLoadStateRef.current;
        const invokeLoad = () => {
          throttleState.lastExecution = Date.now();
          throttleState.timeoutId = null;
          if (typeof loadDirectoryRef.current === "function") {
            loadDirectoryRef.current(
              path,
              0,
              forceRefresh,
              isHistoryNavigation,
            );
          }
        };

        const now = Date.now();
        const timeSinceLastCall = now - throttleState.lastExecution;

        if (timeSinceLastCall < 300) {
          if (throttleState.timeoutId) {
            clearTimeout(throttleState.timeoutId);
          }

          throttleState.timeoutId = setTimeout(() => {
            invokeLoad();
          }, 300 - timeSinceLastCall);
          return;
        }

        if (throttleState.timeoutId) {
          clearTimeout(throttleState.timeoutId);
          throttleState.timeoutId = null;
        }

        invokeLoad();
      },
      [],
    );

    useEffect(() => {
      return () => {
        const timeoutId = throttledLoadStateRef.current.timeoutId;
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      };
    }, []);

    const handleHistoryBack = () => {
      const currentIndex = historyIndexRef.current;
      const history = pathHistoryRef.current;

      if (currentIndex <= 0 || currentIndex >= history.length) {
        return;
      }

      const nextIndex = currentIndex - 1;
      updatePathHistoryState(history, nextIndex);
      loadDirectory(history[nextIndex], 0, false, true);
    };

    // 前进到下一个路径
    const handleGoToNextPath = () => {
      const currentIndex = historyIndexRef.current;
      const history = pathHistoryRef.current;

      if (currentIndex < 0 || currentIndex >= history.length - 1) {
        return;
      }

      const nextIndex = currentIndex + 1;
      updatePathHistoryState(history, nextIndex);
      loadDirectory(history[nextIndex], 0, false, true);
    };

    // 进入目录
    const handleEnterDirectory = (path) => {
      throttleLoadDirectory(path);
    };

    // 返回上级目录
    const handleGoUp = () => {
      if (currentPath === "~") {
        throttleLoadDirectory("/");
        return;
      }

      if (!currentPath || currentPath === "/") return;

      const lastSlashIndex = currentPath.lastIndexOf("/");
      const parentPath =
        lastSlashIndex > 0 ? currentPath.substring(0, lastSlashIndex) : "/";

      throttleLoadDirectory(parentPath);
    };

    // 刷新目录
    const handleRefresh = () => {
      throttleLoadDirectory(currentPath, true); // 强制刷新
    };

    // 返回主目录
    const handleGoHome = () => {
      throttleLoadDirectory("~");
    };

    // 优化的搜索处理函数，使用useCallback清理依赖
    const handleSearchChange = useCallback((e) => {
      setSearchTerm(e.target.value);
    }, []);

    // 切换搜索框显示
    const toggleSearch = useCallback(() => {
      setShowSearch((prev) => {
        if (prev) {
          setSearchTerm("");
        }
        return !prev;
      });
    }, []);

    // 多选文件管理函数 - 使用 Set 优化性能
    const selectedFilesSet = useMemo(() => {
      const set = new Set();
      selectedFiles.forEach((file) => {
        set.add(`${file.name}-${file.modifyTime}`);
      });
      return set;
    }, [selectedFiles]);

    const isFileSelected = useCallback(
      (file) => {
        return selectedFilesSet.has(`${file.name}-${file.modifyTime}`);
      },
      [selectedFilesSet],
    );

    // 清理重复选择项的辅助函数
    const deduplicateSelectedFiles = useCallback((files) => {
      const seen = new Set();
      return files.filter((file) => {
        const key = `${file.name}-${file.modifyTime}`;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      // removed legacy block
    }, []);

    // 显示用文件列表：过滤 + 排序（增量加载时跳过排序以提升首屏）
    const displayFiles = useMemo(() => {
      let processed = files;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        processed = files.filter(
          (f) => f.name && f.name.toLowerCase().includes(term),
        );
      }
      if (isChunking) return processed;
      return [...processed].sort((a, b) => {
        if (sortMode === "time") {
          const aTime = Number.isFinite(a?.mtimeMs)
            ? a.mtimeMs
            : new Date(a?.modifyTime || 0).getTime();
          const bTime = Number.isFinite(b?.mtimeMs)
            ? b.mtimeMs
            : new Date(b?.modifyTime || 0).getTime();
          return bTime - aTime;
        }
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "", undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
    }, [files, searchTerm, sortMode, isChunking]);

    // 格式化日期函数
    const formatDate = useCallback((date) => {
      const now = new Date();
      const diff = now - date;
      const day = 24 * 60 * 60 * 1000;

      // 如果是今天的文件，显示时间
      if (diff < day && date.getDate() === now.getDate()) {
        return date.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
      }

      // 如果是最近一周的文件，显示星期几
      if (diff < 7 * day) {
        const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
        return days[date.getDay()];
      }

      // 其他情况显示年-月-日
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }, []);

    // 文件渲染数据预处理，避免 render 阶段重复做格式化
    const displayFileRows = useMemo(() => {
      return displayFiles.map((file, index) => {
        const formattedDate = file?.modifyTime
          ? formatDate(new Date(file.modifyTime))
          : "";
        const formattedSize =
          file?.size && !file?.isDirectory
            ? formatFileSize(file.size, { t })
            : "";

        return {
          file,
          index,
          secondaryText: [formattedDate, formattedSize]
            .filter(Boolean)
            .join(" · "),
        };
      });
    }, [displayFiles, formatDate, t]);

    // 过滤和排序文件列表（根据搜索词） - 优化版本，使用useMemo缓存

    // 搜索过滤

    // 排序：按名称时目录在前，按时间时不区分文件类型

    // 按时间排序（最新的在前），不区分文件夹和文件

    // 按名称排序时，目录在前

    const handleFileSelect = useCallback(
      (file, index, event) => {
        event.stopPropagation();

        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          event.preventDefault();
        }

        const isMultiSelect = event.ctrlKey || event.metaKey;
        const isRangeSelect = event.shiftKey;

        if (isRangeSelect && anchorIndex !== -1) {
          // Shift范围选择 - 使用排序后的文件列表
          const start = Math.min(anchorIndex, index);
          const end = Math.max(anchorIndex, index);
          const rangeFiles = displayFiles.slice(start, end + 1);

          // 如果同时按住Ctrl+Shift，则添加到现有选择
          if (isMultiSelect) {
            // 合并现有选择和范围选择
            const newSelection = [...selectedFiles];
            rangeFiles.forEach((rangeFile) => {
              // 只添加未选中的文件
              if (
                !newSelection.some(
                  (f) =>
                    f.name === rangeFile.name &&
                    f.modifyTime === rangeFile.modifyTime,
                )
              ) {
                newSelection.push(rangeFile);
              }
            });
            const deduplicated = deduplicateSelectedFiles(newSelection);
            setSelectedFiles(deduplicated);
          } else {
            // 直接设置范围内的文件为选中状态（完全替换之前的选择）
            const deduplicated = deduplicateSelectedFiles(rangeFiles);
            setSelectedFiles(deduplicated);
          }

          setSelectedFile(file);
          setLastSelectedIndex(index);
          // 保持锚点不变，这样连续的Shift选择都从同一个起点开始
        } else if (isMultiSelect) {
          // Ctrl多选
          const isCurrentlySelected = isFileSelected(file);

          if (isCurrentlySelected) {
            // 取消选择 - 从当前选择中移除该文件
            const newSelectedFiles = selectedFiles.filter(
              (f) =>
                !(f.name === file.name && f.modifyTime === file.modifyTime),
            );
            setSelectedFiles(newSelectedFiles);

            // 如果取消选择的是当前的selectedFile，更新selectedFile
            if (
              selectedFile &&
              selectedFile.name === file.name &&
              selectedFile.modifyTime === file.modifyTime
            ) {
              setSelectedFile(
                newSelectedFiles.length > 0 ? newSelectedFiles[0] : null,
              );
            }
          } else {
            // 添加到选择 - 防止重复添加
            const newSelection = [...selectedFiles, file];
            const deduplicated = deduplicateSelectedFiles(newSelection);
            setSelectedFiles(deduplicated);
            setSelectedFile(file);
          }
          setLastSelectedIndex(index);
          setAnchorIndex(index); // Ctrl点击设置新的锚点
        } else {
          // 单选 - 清除所有选择，选中当前文件
          setSelectedFiles([file]);
          setSelectedFile(file);
          setLastSelectedIndex(index);
          setAnchorIndex(index); // 单击设置锚点，为后续的Shift选择做准备
        }
      },
      [
        anchorIndex,
        displayFiles,
        isFileSelected,
        selectedFile,
        selectedFiles,
        deduplicateSelectedFiles,
      ],
    );

    // 获取当前选中的文件列表（用于批量操作）
    const getSelectedFiles = useCallback(() => {
      return selectedFiles.length > 0
        ? selectedFiles
        : selectedFile
          ? [selectedFile]
          : [];
    }, [selectedFiles, selectedFile]);

    const formatSelectedFilesSummary = useCallback(
      (files, previewCount = 6) => {
        const names = files
          .map((file) => file?.name)
          .filter((name) => typeof name === "string" && name.length > 0);

        if (names.length <= previewCount) {
          return names.join(", ");
        }

        return t("fileManager.messages.fileListSummary", {
          shown: names.slice(0, previewCount).join(", "),
          remaining: names.length - previewCount,
        });
      },
      [t],
    );

    // 处理批量操作确认 - 显示确认对话框
    const showBatchOperationConfirm = useCallback(
      (operation, files, onConfirm) => {
        const fileCount = files.length;
        const fileList = formatSelectedFilesSummary(files);
        const message = t("fileManager.batchOperationConfirm", {
          operation,
          count: fileCount,
          files: fileList,
        });
        setConfirmDialog({
          open: true,
          title: t("fileManager.confirmTitle"),
          message,
          onConfirm,
          confirmText: operation,
          confirmColor: "error",
        });
      },
      [formatSelectedFilesSummary, t],
    );

    const showDeleteConfirm = useCallback(
      (files, onConfirm) => {
        if (!Array.isArray(files) || files.length === 0) {
          return;
        }

        if (files.length === 1) {
          setConfirmDialog({
            open: true,
            title: t("fileManager.confirmTitle"),
            message: t("fileManager.messages.deleteConfirm", {
              name: files[0].name,
            }),
            onConfirm,
            confirmText: t("fileManager.delete"),
            confirmColor: "error",
          });
          return;
        }

        showBatchOperationConfirm(t("fileManager.delete"), files, onConfirm);
      },
      [showBatchOperationConfirm, t],
    );

    const buildCurrentFilePath = useCallback(
      (fileName) => {
        return currentPath ? joinPath(currentPath, fileName) : fileName;
      },
      [currentPath],
    );

    const handleContextMenuClose = useCallback(() => {
      setContextMenu(null);
    }, []);

    const deleteFileWithRetry = useCallback(
      async (targetPath, isDirectory) => {
        const maxRetries = 3;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await window.terminalAPI.deleteFile(
              tabId,
              targetPath,
              isDirectory,
            );

            if (response?.success) {
              return { success: true };
            }

            const responseError =
              response?.error || t("fileManager.errors.deleteFailed");
            const shouldRetry =
              responseError.includes("SFTP错误") && attempt < maxRetries;

            if (shouldRetry) {
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (attempt + 1)),
              );
              continue;
            }

            return { success: false, error: responseError };
          } catch (error) {
            if (attempt < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (attempt + 1)),
              );
              continue;
            }

            return {
              success: false,
              error: error?.message || t("fileManager.errors.unknownError"),
            };
          }
        }

        return {
          success: false,
          error: t("fileManager.errors.deleteFailed"),
        };
      },
      [t, tabId],
    );

    const createFolderWithRetry = useCallback(
      async (folderPath) => {
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await window.terminalAPI.createFolder(
              tabId,
              folderPath,
            );

            if (response?.success) {
              return { success: true };
            }

            const responseError =
              response?.error || t("fileManager.errors.createFolderFailed");
            const alreadyExists =
              responseError.includes("already exists") ||
              responseError.includes("已存在") ||
              responseError.includes("File exists");

            if (alreadyExists) {
              return { success: true };
            }

            if (responseError.includes("SFTP错误") && attempt < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 300 * (attempt + 1)),
              );
              continue;
            }

            return { success: false, error: responseError };
          } catch (error) {
            if (attempt < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 300 * (attempt + 1)),
              );
              continue;
            }

            return {
              success: false,
              error:
                error?.message || t("fileManager.errors.createFolderFailed"),
            };
          }
        }

        return {
          success: false,
          error: t("fileManager.errors.createFolderFailed"),
        };
      },
      [t, tabId],
    );

    const moveFileWithRetry = useCallback(
      async (sourcePath, targetPath) => {
        const maxRetries = 2;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await window.terminalAPI.moveFile(
              tabId,
              sourcePath,
              targetPath,
            );

            if (response?.success) {
              return { success: true };
            }

            const responseError =
              response?.error || t("fileManager.errors.deleteFailed");

            if (responseError.includes("SFTP错误") && attempt < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 300 * (attempt + 1)),
              );
              continue;
            }

            return { success: false, error: responseError };
          } catch (error) {
            if (attempt < maxRetries) {
              await new Promise((resolve) =>
                setTimeout(resolve, 300 * (attempt + 1)),
              );
              continue;
            }

            return {
              success: false,
              error: error?.message || t("fileManager.errors.deleteFailed"),
            };
          }
        }

        return {
          success: false,
          error: t("fileManager.errors.deleteFailed"),
        };
      },
      [t, tabId],
    );

    const executeDeleteFiles = useCallback(
      async (filesToDelete) => {
        if (!Array.isArray(filesToDelete) || filesToDelete.length === 0) {
          return;
        }

        setIsDeleting(true);
        setLoading(true);
        setError(null);

        const deletedFiles = [];
        const failedFiles = [];
        const stagedEntries = [];

        try {
          if (
            !window.terminalAPI ||
            !window.terminalAPI.deleteFile ||
            !window.terminalAPI.moveFile ||
            !window.terminalAPI.createFolder
          ) {
            showNotification(
              t("fileManager.errors.fileApiNotAvailable"),
              "error",
            );
            return;
          }

          const selectionNames = new Set(
            filesToDelete.map((file) => file?.name).filter(Boolean),
          );
          const parentPath = getParentPath(currentPath);
          let stagingFolderName = `.simpleshell-delete-staging-${Date.now().toString(36)}`;
          while (selectionNames.has(stagingFolderName)) {
            stagingFolderName = `.simpleshell-delete-staging-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
          }

          const stagingRootPath = joinPath(parentPath, stagingFolderName);
          const createStagingResult =
            await createFolderWithRetry(stagingRootPath);

          if (!createStagingResult.success) {
            showNotification(
              createStagingResult.error || t("fileManager.errors.deleteFailed"),
              "error",
              6000,
            );
            return;
          }

          for (const file of filesToDelete) {
            const sourcePath = buildCurrentFilePath(file.name);
            const stagedPath = joinPath(stagingRootPath, file.name);
            const stageResult = await moveFileWithRetry(sourcePath, stagedPath);

            if (!stageResult.success) {
              failedFiles.push({
                file,
                error:
                  stageResult.error ||
                  t("fileManager.messages.deleteRollbackStageFailed"),
                retainSelection: true,
              });
              continue;
            }

            stagedEntries.push({
              file,
              sourcePath,
              stagedPath,
            });
          }

          for (const stagedEntry of stagedEntries) {
            const result = await deleteFileWithRetry(
              stagedEntry.stagedPath,
              stagedEntry.file.isDirectory,
            );

            if (result.success) {
              deletedFiles.push(stagedEntry.file);
            } else {
              const rollbackResult = await moveFileWithRetry(
                stagedEntry.stagedPath,
                stagedEntry.sourcePath,
              );

              failedFiles.push({
                file: stagedEntry.file,
                retainSelection: rollbackResult.success,
                error: rollbackResult.success
                  ? result.error || t("fileManager.errors.deleteFailed")
                  : t("fileManager.messages.deleteRollbackRestoreFailed", {
                      name: stagedEntry.file.name,
                      error:
                        rollbackResult.error ||
                        t("fileManager.errors.deleteFailed"),
                    }),
              });
            }
          }

          await deleteFileWithRetry(stagingRootPath, true);

          if (stagedEntries.length > 0) {
            await loadDirectory(currentPath, 0, true);
          }

          if (failedFiles.length > 0) {
            const failedSelection = failedFiles
              .filter((item) => item.retainSelection !== false)
              .map((item) => item.file);

            if (failedSelection.length > 0) {
              setSelectedFiles(failedSelection);
              setSelectedFile(failedSelection[0] || null);
              setLastSelectedIndex(0);
              setAnchorIndex(0);
            } else {
              clearSelection();
            }
          } else {
            clearSelection();
          }

          if (failedFiles.length === 0) {
            showNotification(
              t("fileManager.messages.deleteSuccessCount", {
                count: deletedFiles.length,
              }),
              "success",
            );
            return;
          }

          const summaryMessage = t("fileManager.messages.deletePartialResult", {
            deleted: deletedFiles.length,
            failed: failedFiles.length,
          });
          const firstError = failedFiles[0]?.error;
          const rollbackMessage =
            deletedFiles.length > 0
              ? t("fileManager.messages.deleteRollbackApplied")
              : t("fileManager.messages.deleteRollbackKeptFiles");
          showNotification(
            firstError
              ? `${summaryMessage} ${rollbackMessage}：${firstError}`
              : `${summaryMessage} ${rollbackMessage}`,
            deletedFiles.length > 0 ? "warning" : "error",
            6000,
          );
        } catch (error) {
          showNotification(
            `${t("fileManager.errors.deleteFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
            "error",
            6000,
          );
        } finally {
          setLoading(false);
          setIsDeleting(false);
          handleContextMenuClose();
          setBlankContextMenu(null);
        }
      },
      [
        clearSelection,
        createFolderWithRetry,
        currentPath,
        deleteFileWithRetry,
        handleContextMenuClose,
        loadDirectory,
        moveFileWithRetry,
        buildCurrentFilePath,
        showNotification,
        t,
      ],
    );

    // 处理右键菜单 - 优化版本，立即显示菜单
    const handleContextMenu = useCallback(
      (event, file, index) => {
        if (loadingRef.current || isDeletingRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        // 先更新选中状态，再打开菜单，避免菜单内容/可用操作滞后一帧
        if (!isFileSelected(file)) {
          setSelectedFiles([file]);
        }
        setSelectedFile(file);
        setLastSelectedIndex(index);
        setAnchorIndex(index);

        // 尝试把“焦点”直接切到右键行，减少需要左键才能生效的体感
        try {
          const currentTarget = event.currentTarget;
          const focusTarget =
            currentTarget?.querySelector?.('[data-file-item="true"]') ||
            currentTarget;
          focusTarget?.focus?.();
        } catch (_) {
          // ignore
        }

        setContextMenu({
          mouseX: event.clientX,
          mouseY: event.clientY,
        });
      },
      [isFileSelected],
    );

    // 缓存菜单显示逻辑，避免每次渲染时重新计算
    const menuItems = useMemo(() => {
      const selected =
        selectedFiles.length > 0
          ? selectedFiles
          : selectedFile
            ? [selectedFile]
            : [];

      const hasFiles = selected.some((f) => !f.isDirectory);
      const hasFolders = selected.some((f) => f.isDirectory);
      const fileCount = selected.filter((f) => !f.isDirectory).length;
      const folderCount = selected.filter((f) => f.isDirectory).length;

      return {
        isSingleSelection: selected.length === 1,
        hasFiles,
        hasFolders,
        fileCount,
        folderCount,
        isDirectorySelected: selectedFile?.isDirectory,
        isDeleting,
      };
    }, [selectedFiles, selectedFile, isDeleting]);

    // 用户活动后的刷新函数，使用防抖优化
    const refreshAfterUserActivity = useMemo(
      () =>
        debounce(() => {
          if (currentPath && foregroundLoadCountRef.current === 0) {
            silentRefreshCurrentDirectory();
          }
        }, USER_ACTIVITY_REFRESH_DELAY),
      [currentPath, silentRefreshCurrentDirectory],
    );

    // 获取选中文件的完整路径
    const getFullPathForFile = useCallback(
      (file) => {
        if (!file) return "";
        const base = currentPath && currentPath.length > 0 ? currentPath : "/";
        if (base === "/") return `/${file.name}`;
        return `${base}/${file.name}`;
      },
      [currentPath],
    );

    const formatAbsoluteTime = useCallback(
      (timestamp) => {
        if (!Number.isFinite(timestamp) || timestamp <= 0) {
          return t("fileManager.propertiesDialog.notAvailable");
        }
        return new Date(timestamp).toLocaleString();
      },
      [t],
    );

    const formatPermissionMode = useCallback((mode) => {
      if (!Number.isFinite(mode)) {
        return "";
      }
      return (mode & 0o777).toString(8).padStart(3, "0");
    }, []);

    const normalizePropertiesData = useCallback(
      (file, fullPath) => {
        if (!file) return null;
        return {
          name: file.name || "",
          type: file.isDirectory
            ? t("fileManager.fileTypes.folder")
            : t("fileManager.fileTypes.file"),
          path: fullPath || "",
          size: Number.isFinite(file.size) ? file.size : null,
          modifyTime: Number.isFinite(file.modifyTime) ? file.modifyTime : null,
          accessTime: Number.isFinite(file.accessTime) ? file.accessTime : null,
          createTime: Number.isFinite(file.createTime) ? file.createTime : null,
          permissions: formatPermissionMode(file.mode),
          uid: Number.isFinite(file.uid) ? file.uid : null,
          gid: Number.isFinite(file.gid) ? file.gid : null,
          isDirectory: Boolean(file.isDirectory),
        };
      },
      [formatPermissionMode, t],
    );

    const handleOpenProperties = useCallback(async () => {
      if (!selectedFile) return;

      const fullPath = getFullPathForFile(selectedFile);
      setPropertiesData(normalizePropertiesData(selectedFile, fullPath));
      setShowPropertiesDialog(true);
      setPropertiesLoading(true);
      handleContextMenuClose();

      try {
        const [absolutePathResp, permissionResp] = await Promise.all([
          window.terminalAPI?.getAbsolutePath
            ? window.terminalAPI.getAbsolutePath(tabId, fullPath)
            : Promise.resolve(null),
          window.terminalAPI?.getFilePermissions
            ? window.terminalAPI.getFilePermissions(tabId, fullPath)
            : Promise.resolve(null),
        ]);

        setPropertiesData((prev) => {
          if (!prev) return prev;

          const mode =
            permissionResp?.stats?.mode ?? permissionResp?.mode ?? null;
          const uid = permissionResp?.stats?.uid ?? permissionResp?.uid;
          const gid = permissionResp?.stats?.gid ?? permissionResp?.gid;
          const statsSize = permissionResp?.stats?.size;
          const statsMtime = permissionResp?.stats?.mtime;
          const statsAtime = permissionResp?.stats?.atime;
          const statsCtime = permissionResp?.stats?.ctime;

          return {
            ...prev,
            path:
              absolutePathResp?.success && absolutePathResp?.path
                ? absolutePathResp.path
                : prev.path,
            permissions: formatPermissionMode(mode) || prev.permissions || "",
            uid: Number.isFinite(uid) ? uid : prev.uid,
            gid: Number.isFinite(gid) ? gid : prev.gid,
            size: Number.isFinite(statsSize) ? statsSize : prev.size,
            modifyTime: Number.isFinite(statsMtime)
              ? statsMtime * 1000
              : prev.modifyTime,
            accessTime: Number.isFinite(statsAtime)
              ? statsAtime * 1000
              : prev.accessTime,
            createTime: Number.isFinite(statsCtime)
              ? statsCtime * 1000
              : prev.createTime,
          };
        });
      } catch (e) {
        showNotification(
          e?.message || t("fileManager.propertiesDialog.loadFailed"),
          "warning",
          3000,
        );
      } finally {
        setPropertiesLoading(false);
      }
    }, [
      selectedFile,
      getFullPathForFile,
      normalizePropertiesData,
      handleContextMenuClose,
      tabId,
      formatPermissionMode,
      showNotification,
      t,
    ]);

    const handleClosePropertiesDialog = useCallback(() => {
      setShowPropertiesDialog(false);
      setPropertiesLoading(false);
      setPropertiesData(null);
    }, []);

    // 打开权限对话框
    const handleOpenPermissions = useCallback(async () => {
      if (!selectedFile) return;
      try {
        const fullPath = getFullPathForFile(selectedFile);
        // 默认权限
        const defaultPerm = selectedFile.isDirectory ? "755" : "644";
        setPermDialogPermissions(defaultPerm);
        setPermDialogOwner("");
        setPermDialogGroup("");
        setPermInitial({ permissions: defaultPerm, owner: "", group: "" });

        if (window.terminalAPI?.getFilePermissions) {
          const resp = await window.terminalAPI.getFilePermissions(
            tabId,
            fullPath,
          );
          if (resp?.success) {
            if (resp.permissions) {
              setPermDialogPermissions(resp.permissions);
            }
            // 预填 uid/gid（字符串），用户可改为名称
            const uid = resp.stats?.uid;
            const gid = resp.stats?.gid;
            const ownerStr =
              typeof uid === "number" || typeof uid === "string"
                ? String(uid)
                : "";
            const groupStr =
              typeof gid === "number" || typeof gid === "string"
                ? String(gid)
                : "";
            setPermDialogOwner(ownerStr);
            setPermDialogGroup(groupStr);
            setPermInitial({
              permissions: resp.permissions || defaultPerm,
              owner: ownerStr,
              group: groupStr,
            });
          }
        }
      } catch {
        // 忽略预取失败，使用默认
      }
      setShowPermissionDialog(true);
      handleContextMenuClose();
    }, [selectedFile, tabId, getFullPathForFile]);

    const handlePermissionDialogClose = useCallback(() => {
      setShowPermissionDialog(false);
    }, []);

    // 保存权限变更
    const handlePermissionDialogSubmit = useCallback(
      async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!selectedFile) return;
        const fullPath = getFullPathForFile(selectedFile);
        const ops = [];
        try {
          // 权限变更
          if (
            permDialogPermissions &&
            permDialogPermissions !== permInitial.permissions &&
            window.terminalAPI?.setFilePermissions
          ) {
            ops.push(
              window.terminalAPI.setFilePermissions(
                tabId,
                fullPath,
                permDialogPermissions,
              ),
            );
          }

          // 所有者/组变更
          const ownerChanged = permDialogOwner !== permInitial.owner;
          const groupChanged = permDialogGroup !== permInitial.group;
          if (
            (ownerChanged || groupChanged) &&
            window.terminalAPI?.setFileOwnership
          ) {
            ops.push(
              window.terminalAPI.setFileOwnership(
                tabId,
                fullPath,
                permDialogOwner || undefined,
                permDialogGroup || undefined,
              ),
            );
          }

          if (ops.length > 0) {
            setLoading(true);
            const results = await Promise.all(ops);
            const failed = results.find((r) => !r?.success);
            if (failed) {
              setError(
                failed.error || t("fileManager.errors.permissionSetFailed"),
              );
            } else {
              await loadDirectory(currentPath, 0, true);
            }
          }
        } catch (err) {
          setError(
            `${t("fileManager.errors.permissionSetFailed")}: ${
              err?.message || t("fileManager.errors.unknownError")
            }`,
          );
        } finally {
          setLoading(false);
          setShowPermissionDialog(false);
        }
      },
      [
        selectedFile,
        tabId,
        getFullPathForFile,
        permDialogPermissions,
        permDialogOwner,
        permDialogGroup,
        permInitial.permissions,
        permInitial.owner,
        permInitial.group,
        loadDirectory,
        currentPath,
        t,
      ],
    );

    // 处理批量删除
    const handleBatchDelete = useCallback(() => {
      if (isDeletingRef.current) return;
      const filesToDelete = getSelectedFiles();
      if (filesToDelete.length === 0) return;
      handleContextMenuClose();

      showDeleteConfirm(filesToDelete, () => executeDeleteFiles(filesToDelete));
    }, [
      executeDeleteFiles,
      getSelectedFiles,
      handleContextMenuClose,
      showDeleteConfirm,
      setBlankContextMenu,
    ]);

    // 处理删除
    const handleDelete = useCallback(() => {
      handleBatchDelete();
    }, [handleBatchDelete]);

    // 处理上传文件到当前目录
    // 辅助函数：正确拼接路径，避免重复斜杠
    const handleUploadFile = async () => {
      handleContextMenuClose();
      handleBlankContextMenuClose();

      if (!sshConnection) {
        showNotification(t("fileManager.errors.noConnection"), "warning");
        return;
      }

      setTransferCancelled(false);

      // 保存当前路径状态
      const savedCurrentPath = currentPath;
      const savedSelectedFile = selectedFile;
      let didForegroundRefresh = false;
      let activeUploadTransferId = null;

      try {
        let targetPath;
        // 使用保存的状态而非实时状态
        if (savedSelectedFile && savedSelectedFile.isDirectory) {
          targetPath = joinPath(savedCurrentPath, savedSelectedFile.name);
        } else {
          targetPath = savedCurrentPath;
        }

        if (window.terminalAPI && window.terminalAPI.uploadFile) {
          // 触发应用内状态提示（与拖拽上传保持一致）
          showNotification(
            t("fileManager.messages.preparingUpload"),
            "info",
            2000,
          );

          activeUploadTransferId = addTransferProgress({
            type: "upload-multifile",
            progress: 0,
            fileName: t("fileManager.messages.preparingUpload"),
            statusText: t("fileManager.transfer.status.preparingUpload"),
            currentFile: "",
            transferredBytes: 0,
            totalBytes: 0,
            transferSpeed: 0,
            remainingTime: 0,
            currentFileIndex: 0,
            processedFiles: 0,
            totalFiles: 1,
            transferKey: "",
            fileList: null,
          });

          // 使用progressCallback处理进度更新
          const result = await window.terminalAPI.uploadFile(
            tabId,
            targetPath,
            (
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              currentFileIndex,
              processedFiles,
              totalFiles,
              transferKey,
              fileList,
            ) => {
              // 验证并标准化进度数据
              const validProgress = Math.max(0, Math.min(100, progress || 0));
              const validTransferredBytes = Math.max(0, transferredBytes || 0);
              const validTotalBytes = Math.max(0, totalBytes || 0);
              const validTransferSpeed = Math.max(0, transferSpeed || 0);
              const validRemainingTime = Math.max(0, remainingTime || 0);
              const validCurrentFileIndex = Math.max(0, currentFileIndex || 0);
              const validProcessedFiles = Math.max(0, processedFiles || 0);
              const validTotalFiles = Math.max(0, totalFiles || 0);

              if (!activeUploadTransferId) {
                activeUploadTransferId = addTransferProgress({
                  type: "upload-multifile",
                  progress: validProgress,
                  fileName:
                    fileName || t("fileManager.messages.preparingUpload"),
                  statusText: t("fileManager.transfer.status.uploading"),
                  currentFile: fileName || "",
                  transferredBytes: validTransferredBytes,
                  totalBytes: validTotalBytes,
                  transferSpeed: validTransferSpeed,
                  remainingTime: validRemainingTime,
                  currentFileIndex: validCurrentFileIndex,
                  processedFiles: validProcessedFiles,
                  totalFiles: validTotalFiles || 1,
                  transferKey: transferKey || "",
                  fileList: fileList || null,
                });
              }

              updateTransferProgress(activeUploadTransferId, {
                progress: validProgress,
                fileName: fileName || t("fileManager.messages.preparingUpload"),
                statusText: t("fileManager.transfer.status.uploading"),
                currentFile: fileName || "",
                transferredBytes: validTransferredBytes,
                totalBytes: validTotalBytes,
                transferSpeed: validTransferSpeed,
                remainingTime: validRemainingTime,
                currentFileIndex: validCurrentFileIndex,
                processedFiles: validProcessedFiles,
                totalFiles: validTotalFiles,
                transferKey: transferKey || "",
                fileList: fileList || null,
              });
            },
          );

          if (isUserCancellationError(result)) {
            setTransferCancelled(true);
            if (activeUploadTransferId) {
              updateTransferProgress(activeUploadTransferId, {
                isCancelled: true,
                statusText: t("fileManager.transfer.status.transferCancelled"),
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
              storeScheduleTransferCleanup(activeUploadTransferId, 3000);
            }
          } else if (result?.success) {
            // 标记传输完成
            if (activeUploadTransferId) {
              updateTransferProgress(activeUploadTransferId, {
                progress: 100,
                fileName:
                  result.message || t("fileManager.messages.uploadComplete"),
                statusText: t("fileManager.transfer.status.completed"),
                currentFile: "",
                processedFiles: Math.max(
                  0,
                  result.successfulFiles ?? result.totalFiles ?? 0,
                ),
                currentFileIndex: Math.max(0, result.totalFiles || 0),
                totalFiles: Math.max(0, result.totalFiles || 0),
              });

              // 传输完成后延迟移除
              storeScheduleTransferCleanup(activeUploadTransferId, 3000);
            }

            // 如果是上传到选中的文件夹，刷新当前目录即可
            // 不需要切换到目标文件夹
            await loadDirectory(savedCurrentPath, 0, true); // 强制刷新当前目录
            didForegroundRefresh = true;

            // 如果有警告信息（部分文件上传失败），显示给用户
            if (result.partialSuccess && result.warning) {
              showNotification(result.warning, "warning", 6000);
            } else {
              showNotification(
                t("fileManager.messages.uploadSuccess"),
                "success",
                2000,
              );
            }
          } else if (!transferCancelled) {
            // 检查是否是取消操作相关的错误
            if (!isUserCancellationError(result)) {
              // 只有在不是用户主动取消的情况下才显示错误
              showNotification(
                result.error || t("fileManager.errors.uploadFailed"),
                "error",
                6000,
              );
              if (activeUploadTransferId) {
                updateTransferProgress(activeUploadTransferId, {
                  error: result.error || t("fileManager.errors.uploadFailed"),
                  statusText: t("fileManager.transfer.status.failed"),
                });
                storeScheduleTransferCleanup(activeUploadTransferId, 5000);
              }
            } else {
              setTransferCancelled(true);
              if (activeUploadTransferId) {
                updateTransferProgress(activeUploadTransferId, {
                  isCancelled: true,
                  statusText: t(
                    "fileManager.transfer.status.transferCancelled",
                  ),
                  cancelMessage: t("fileManager.errors.userCancelled"),
                });
                storeScheduleTransferCleanup(activeUploadTransferId, 3000);
              }
            }
          }

          // 上传没有前台刷新结果时，提交一次静默刷新同步列表
          if (!didForegroundRefresh) {
            refreshAfterUserActivity();
          }
        }
      } catch (error) {
        // 上传文件失败

        // 只有在不是用户主动取消的情况下才显示错误
        if (
          !transferCancelled &&
          !isUserCancellationError(error) &&
          !error?.message?.includes("reply was never sent")
        ) {
          showNotification(
            (error && (error.message || error.error)) ||
              t("fileManager.errors.uploadFailed"),
            "error",
            6000,
          );
          // 更新所有未完成的传输为错误状态
          const errorMessage =
            error?.message || t("fileManager.errors.unknownError");
          if (activeUploadTransferId) {
            updateTransferProgress(activeUploadTransferId, {
              error: errorMessage,
              statusText: t("fileManager.transfer.status.failed"),
            });
            storeScheduleTransferCleanup(activeUploadTransferId, 5000);
          } else {
            transferProgressList
              .filter(
                (transfer) => transfer.progress < 100 && !transfer.isCancelled,
              )
              .forEach((transfer) => {
                updateTransferProgress(transfer.transferId, {
                  error: errorMessage,
                });
                storeScheduleTransferCleanup(transfer.transferId, 5000);
              });
          }
        } else {
          setTransferCancelled(true);
          if (activeUploadTransferId) {
            updateTransferProgress(activeUploadTransferId, {
              isCancelled: true,
              statusText: t("fileManager.transfer.status.transferCancelled"),
              cancelMessage: t("fileManager.errors.userCancelled"),
            });
            storeScheduleTransferCleanup(activeUploadTransferId, 3000);
          } else {
            // 标记所有未完成的传输为取消状态
            transferProgressList
              .filter(
                (transfer) => transfer.progress < 100 && !transfer.isCancelled,
              )
              .forEach((transfer) => {
                updateTransferProgress(transfer.transferId, {
                  isCancelled: true,
                  cancelMessage: t("fileManager.errors.userCancelled"),
                });
              });
          }
        }

        // 异常分支如果尚未前台刷新，提交静默刷新同步列表
        if (!didForegroundRefresh) {
          refreshAfterUserActivity();
        }
      }
    };

    // 处理上传文件夹到当前目录
    const handleUploadFolder = async () => {
      handleContextMenuClose();
      handleBlankContextMenuClose();

      if (!sshConnection) {
        showNotification(t("fileManager.errors.noConnection"), "warning");
        return;
      }

      setTransferCancelled(false);

      // 保存当前路径状态
      const savedCurrentPath = currentPath;
      const savedSelectedFile = selectedFile;
      let didForegroundRefresh = false;
      let activeUploadTransferId = null;

      try {
        let targetPath;
        // 使用保存的状态而非实时状态
        if (savedSelectedFile && savedSelectedFile.isDirectory) {
          targetPath = joinPath(savedCurrentPath, savedSelectedFile.name);
        } else {
          targetPath = savedCurrentPath;
        }

        if (window.terminalAPI && window.terminalAPI.uploadFolder) {
          // 触发应用内状态提示（与拖拽上传保持一致）
          showNotification(
            t("fileManager.messages.preparingUpload"),
            "info",
            2000,
          );

          activeUploadTransferId = addTransferProgress({
            type: "upload-folder",
            progress: 0,
            fileName: t("fileManager.messages.preparingUpload"),
            statusText: t("fileManager.transfer.status.preparingUpload"),
            currentFile: "",
            transferredBytes: 0,
            totalBytes: 0,
            transferSpeed: 0,
            remainingTime: 0,
            processedFiles: 0,
            totalFiles: 1,
            transferKey: "",
            fileList: null,
          });

          // 使用progressCallback处理进度更新
          const result = await window.terminalAPI.uploadFolder(
            tabId,
            targetPath,
            (
              progress,
              fileName,
              currentFile,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              totalFiles,
              transferKey,
              fileList,
            ) => {
              // 验证并标准化进度数据
              const validProgress = Math.max(0, Math.min(100, progress || 0));
              const validTransferredBytes = Math.max(0, transferredBytes || 0);
              const validTotalBytes = Math.max(0, totalBytes || 0);
              const validTransferSpeed = Math.max(0, transferSpeed || 0);
              const validRemainingTime = Math.max(0, remainingTime || 0);
              const validProcessedFiles = Math.max(0, processedFiles || 0);
              const validTotalFiles = Math.max(0, totalFiles || 0);

              if (!activeUploadTransferId) {
                activeUploadTransferId = addTransferProgress({
                  type: "upload-folder",
                  progress: validProgress,
                  fileName:
                    fileName || t("fileManager.messages.preparingUpload"),
                  statusText: t("fileManager.transfer.status.uploading"),
                  currentFile: currentFile || "",
                  transferredBytes: validTransferredBytes,
                  totalBytes: validTotalBytes,
                  transferSpeed: validTransferSpeed,
                  remainingTime: validRemainingTime,
                  processedFiles: validProcessedFiles,
                  totalFiles: validTotalFiles,
                  transferKey: transferKey || "",
                  fileList: fileList || null,
                });
              }

              updateTransferProgress(activeUploadTransferId, {
                progress: validProgress,
                fileName: fileName || t("fileManager.messages.preparingUpload"),
                statusText: t("fileManager.transfer.status.uploading"),
                currentFile: currentFile || "",
                transferredBytes: validTransferredBytes,
                totalBytes: validTotalBytes,
                transferSpeed: validTransferSpeed,
                remainingTime: validRemainingTime,
                processedFiles: validProcessedFiles,
                totalFiles: validTotalFiles,
                transferKey: transferKey || "", // 添加transferKey到状态
                fileList: fileList || null,
              });
            },
          );

          if (isUserCancellationError(result)) {
            setTransferCancelled(true);
            if (activeUploadTransferId) {
              updateTransferProgress(activeUploadTransferId, {
                isCancelled: true,
                statusText: t("fileManager.transfer.status.transferCancelled"),
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
              storeScheduleTransferCleanup(activeUploadTransferId, 3000);
            }
          } else if (result?.success) {
            // 标记传输完成
            if (activeUploadTransferId) {
              updateTransferProgress(activeUploadTransferId, {
                progress: 100,
                fileName:
                  result.message || t("fileManager.messages.uploadComplete"),
                statusText: t("fileManager.transfer.status.completed"),
                currentFile: "",
              });

              // 传输完成后延迟移除
              storeScheduleTransferCleanup(activeUploadTransferId, 3000);
            }

            // 如果是上传到选中的文件夹，刷新当前目录即可
            // 不需要切换到目标文件夹
            await loadDirectory(savedCurrentPath, 0, true); // 强制刷新当前目录
            didForegroundRefresh = true;

            // 如果有警告信息（部分文件上传失败），显示给用户
            if (result.partialSuccess && result.warning) {
              showNotification(result.warning, "warning", 6000);
            } else {
              showNotification(
                t("fileManager.messages.uploadSuccess"),
                "success",
                2000,
              );
            }
          } else if (!transferCancelled) {
            // 检查是否是取消操作相关的错误
            if (!isUserCancellationError(result)) {
              // 只有在不是用户主动取消的情况下才显示错误
              showNotification(
                result.error || t("fileManager.errors.uploadFailed"),
                "error",
                6000,
              );
              if (activeUploadTransferId) {
                updateTransferProgress(activeUploadTransferId, {
                  error: result.error || t("fileManager.errors.uploadFailed"),
                  statusText: t("fileManager.transfer.status.failed"),
                });
                storeScheduleTransferCleanup(activeUploadTransferId, 5000);
              }
            } else {
              setTransferCancelled(true);
              if (activeUploadTransferId) {
                updateTransferProgress(activeUploadTransferId, {
                  isCancelled: true,
                  statusText: t(
                    "fileManager.transfer.status.transferCancelled",
                  ),
                  cancelMessage: t("fileManager.errors.userCancelled"),
                });
                storeScheduleTransferCleanup(activeUploadTransferId, 3000);
              }
            }
          }

          // 上传没有前台刷新结果时，提交一次静默刷新同步列表
          if (!didForegroundRefresh) {
            refreshAfterUserActivity();
          }
        }
      } catch (error) {
        // t("fileManager.errors.uploadFailed")

        // 只有在不是用户主动取消的情况下才显示错误
        if (
          !transferCancelled &&
          !isUserCancellationError(error) &&
          !error?.message?.includes("reply was never sent")
        ) {
          showNotification(
            (error && (error.message || error.error)) ||
              t("fileManager.errors.uploadFailed"),
            "error",
            6000,
          );
          if (activeUploadTransferId) {
            const errorMessage =
              error?.message || t("fileManager.errors.unknownError");
            updateTransferProgress(activeUploadTransferId, {
              error: errorMessage,
              statusText: t("fileManager.transfer.status.failed"),
            });
            storeScheduleTransferCleanup(activeUploadTransferId, 5000);
          }
        } else {
          setTransferCancelled(true);
          if (activeUploadTransferId) {
            updateTransferProgress(activeUploadTransferId, {
              isCancelled: true,
              statusText: t("fileManager.transfer.status.transferCancelled"),
              cancelMessage: t("fileManager.errors.userCancelled"),
            });
            storeScheduleTransferCleanup(activeUploadTransferId, 3000);
          }
        }

        // 异常分支如果尚未前台刷新，提交静默刷新同步列表
        if (!didForegroundRefresh) {
          refreshAfterUserActivity();
        }
      }
    };

    // 复制绝对路径
    const handleCopyAbsolutePath = async () => {
      const selectedItems = getSelectedFiles();
      if (selectedItems.length !== 1) {
        showNotification(t("fileManager.messages.copyPathError"), "warning");
        return;
      }
      const targetItem = selectedItems[0];

      try {
        const relativePath =
          currentPath === "/"
            ? "/" + targetItem.name
            : currentPath
              ? currentPath + "/" + targetItem.name
              : targetItem.name;

        if (window.terminalAPI && window.terminalAPI.getAbsolutePath) {
          const response = await window.terminalAPI.getAbsolutePath(
            tabId,
            relativePath,
          );
          if (response?.success && response.path) {
            await window.clipboardAPI.writeText(response.path);
          }
        }
      } catch (error) {
        setError(
          t("fileManager.errors.unknownError") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        );
      }
      handleContextMenuClose();
    };

    // 当搜索条件改变时重置选择状态
    useEffect(() => {
      // 重置所有选择状态
      clearSelection();
    }, [searchTerm, clearSelection]);

    // 确保selectedFiles没有重复项
    useEffect(() => {
      if (selectedFiles.length > 0) {
        const deduplicatedFiles = deduplicateSelectedFiles(selectedFiles);
        if (deduplicatedFiles.length !== selectedFiles.length) {
          setSelectedFiles(deduplicatedFiles);
        }
      }
    }, [selectedFiles, deduplicateSelectedFiles]);

    // 渲染文件列表
    const renderFileList = () => {
      if (loading) {
        return (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
              width: "100%",
            }}
          >
            <CircularProgress size={24} />
          </Box>
        );
      }

      if (error) {
        return (
          <Box
            sx={{
              padding: 2,
              color: "error.main",
              height: "100%",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography variant="body2">{error}</Typography>
          </Box>
        );
      }

      if (!displayFileRows || displayFileRows.length === 0) {
        // chunked/nonBlocking 目录加载：首批数据可能为空，但仍在持续接收分片
        // 这时应该显示加载动画，而不是“当前目录为空”
        if (!searchTerm && (isChunking || listToken)) {
          return (
            <Box
              sx={{
                height: "100%",
                width: "100%",
                padding: 1,
              }}
              onContextMenu={handleBlankContextMenu}
              onClick={handleBlankClick}
            >
              <FileManagerSkeleton />
            </Box>
          );
        }

        return (
          <Box
            sx={{
              height: "100%",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 2,
            }}
            onContextMenu={handleBlankContextMenu}
            onClick={handleBlankClick}
          >
            <Typography variant="body2" color="text.secondary">
              {searchTerm ? "未找到匹配的文件" : "当前目录为空"}
            </Typography>
          </Box>
        );
      }

      const shouldVirtualize =
        displayFileRows.length >= FILE_LIST_VIRTUALIZATION_THRESHOLD;

      return (
        <Box
          className="app-scrollbar"
          sx={{
            height: "100%",
            width: "100%",
            overflow: "auto",
          }}
          onContextMenu={handleBlankContextMenu}
          onClick={handleBlankClick}
        >
          {shouldVirtualize ? (
            <VirtualizedList
              className="file-manager-virtualized-list"
              style={{ height: "100%", width: "100%" }}
              rowCount={displayFileRows.length}
              rowHeight={FILE_LIST_ROW_HEIGHT}
              rowProps={{
                rows: displayFileRows,
                isFileSelected,
                onContextMenu: handleContextMenu,
                onSelect: handleFileSelect,
                onActivate: handleFileActivate,
                theme,
              }}
              overscanCount={FILE_LIST_OVERSCAN}
              rowComponent={VirtualizedFileRow}
            />
          ) : (
            <List dense disablePadding sx={{ py: 0.5, px: 0.5 }}>
              {displayFileRows.map(({ file, index, secondaryText }) => {
                const isSelected = isFileSelected(file);

                return (
                  <ListItem
                    key={`${file.name}-${file.modifyTime ?? index}`}
                    disablePadding
                    disableGutters
                    onContextMenu={(e) => handleContextMenu(e, file, index)}
                    sx={{
                      py: 0,
                      my: 0,
                      minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
                      height: FILE_LIST_ITEM_MIN_HEIGHT,
                      "&:not(:last-child)": {
                        mb: 0.5,
                      },
                    }}
                  >
                    <ListItemButton
                      data-file-item="true"
                      onClick={(e) => handleFileSelect(file, index, e)}
                      onDoubleClick={() => handleFileActivate(file)}
                      dense
                      selected={isSelected}
                      sx={{
                        minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
                        height: FILE_LIST_ITEM_MIN_HEIGHT,
                        px: 1.5,
                        py: 0.5,
                        borderRadius: 1,
                        transition:
                          "background-color 0.15s ease-in-out, border-color 0.15s ease-in-out",
                        userSelect: "none",
                        cursor: "default",
                        "&.Mui-selected": {
                          backgroundColor: alpha(
                            theme.palette.primary.main,
                            0.12,
                          ),
                          "&:hover": {
                            backgroundColor: alpha(
                              theme.palette.primary.main,
                              0.18,
                            ),
                          },
                        },
                        "&:hover": {
                          backgroundColor: theme.palette.action.hover,
                        },
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 24, mr: 0.75 }}>
                        {file.isDirectory ? (
                          <FolderIcon color="primary" sx={{ fontSize: 20 }} />
                        ) : (
                          <InsertDriveFileIcon sx={{ fontSize: 20 }} />
                        )}
                      </ListItemIcon>
                      <ListItemText
                        disableTypography
                        primary={
                          <OverflowTooltipText
                            variant="body2"
                            sx={FILE_LIST_NAME_SX}
                            tooltipTitle={file.name || ""}
                          >
                            {file.name || ""}
                          </OverflowTooltipText>
                        }
                        secondary={
                          <Box
                            component="span"
                            sx={FILE_LIST_SECONDARY_TEXT_SX}
                          >
                            {secondaryText}
                          </Box>
                        }
                        sx={FILE_LIST_TEXT_SX}
                      />
                    </ListItemButton>
                  </ListItem>
                );
              })}
            </List>
          )}
        </Box>
      );
    };

    // 处理路径输入更改
    const handlePathInputChange = (e) => {
      setPathInput(e.target.value);
    };

    // 处理路径输入提交
    const handlePathInputSubmit = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        loadDirectory(pathInput);
      }
    };

    // 处理取消传输

    // 处理空白区域右键菜单
    const handleBlankContextMenu = (event) => {
      if (loadingRef.current || isDeletingRef.current) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      // 确保不是针对列表项的右键点击
      if (event.target.closest("li")) {
        return;
      }

      // 重置选中文件，确保上传操作使用当前目录
      clearSelection();

      setBlankContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    };

    const handleBlankClick = useCallback(
      (event) => {
        if (
          event?.target instanceof Element &&
          event.target.closest('[data-file-item="true"]')
        ) {
          return;
        }

        if (!selectedFile && selectedFiles.length === 0) {
          return;
        }

        clearSelection();
      },
      [clearSelection, selectedFile, selectedFiles.length],
    );

    // 关闭空白区域右键菜单
    const handleBlankContextMenuClose = () => {
      setBlankContextMenu(null);
    };

    useEffect(() => {
      if (!contextMenu && !blankContextMenu) {
        return;
      }

      const getContextMenuRetargetElement = (event) => {
        const root = fileManagerRootRef.current;
        if (!root) {
          return null;
        }

        const rawTarget = event.target;
        if (
          rawTarget instanceof Element &&
          (rawTarget.closest('[data-file-manager-context-menu="true"]') ||
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
              !element.closest('[data-file-manager-context-menu="true"]') &&
              !element.closest('[role="menu"]'),
          ) || null
        );
      };

      const handleContextMenuRetarget = (event) => {
        if (contextMenuRedispatchingRef.current) {
          return;
        }

        const retargetElement = getContextMenuRetargetElement(event);
        if (!retargetElement) {
          return;
        }

        // 尽量把事件派发到“行级”元素，确保 React 的 onContextMenu 回调能稳定命中
        const itemEl =
          retargetElement.closest('[data-file-item="true"]') ||
          retargetElement.closest("li") ||
          retargetElement;

        if (!itemEl) return;

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
          setContextMenu(null);
          setBlankContextMenu(null);
        });

        if (!itemEl.isConnected) {
          return;
        }

        // 尝试把焦点交给对应行（避免需要左键才能更新“焦点态”）
        try {
          itemEl.focus?.();
        } catch (_) {
          // ignore
        }

        contextMenuRedispatchingRef.current = true;
        try {
          itemEl.dispatchEvent(new MouseEvent("contextmenu", mouseEventInit));
        } finally {
          contextMenuRedispatchingRef.current = false;
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
    }, [contextMenu, blankContextMenu]);

    // 处理创建文件夹
    const handleCreateFolder = () => {
      setNewFolderName("");
      setCreateFolderDialogError("");
      setCreateFolderSubmitting(false);
      setShowCreateFolderDialog(true);
      handleBlankContextMenuClose();
    };

    const handleCloseCreateFolderDialog = useCallback(() => {
      if (createFolderSubmitting) {
        return;
      }

      setShowCreateFolderDialog(false);
      setCreateFolderDialogError("");
    }, [createFolderSubmitting]);

    // 处理创建文件夹提交
    const handleCreateFolderSubmit = async (e) => {
      e.preventDefault();

      const folderName = newFolderName.trim();

      if (!folderName) {
        setCreateFolderDialogError(t("fileManager.errors.emptyName"));
        return;
      }

      if (!sshConnection) {
        setCreateFolderDialogError(t("fileManager.errors.noConnection"));
        return;
      }

      if (!window.terminalAPI || !window.terminalAPI.createFolder) {
        setCreateFolderDialogError(t("fileManager.errors.fileApiNotAvailable"));
        return;
      }

      const fullPath =
        currentPath === "/" ? "/" + folderName : currentPath + "/" + folderName;
      const maxRetries = 3;

      setCreateFolderSubmitting(true);
      setLoading(true);
      setError(null);
      setCreateFolderDialogError("");

      try {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const response = await window.terminalAPI.createFolder(
              tabId,
              fullPath,
            );

            if (response?.success) {
              await loadDirectory(currentPath, 0, true);
              setShowCreateFolderDialog(false);
              setNewFolderName("");
              return;
            }

            const responseError =
              response?.error || t("fileManager.errors.createFolderFailed");
            const shouldRetry =
              responseError.includes("SFTP错误") && attempt < maxRetries;

            if (shouldRetry) {
              setCreateFolderDialogError(
                t("fileManager.messages.createFolderFailedRetrying", {
                  current: attempt + 1,
                  max: maxRetries,
                }),
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (attempt + 1)),
              );
              continue;
            }

            setCreateFolderDialogError(responseError);
            return;
          } catch (error) {
            if (attempt < maxRetries) {
              setCreateFolderDialogError(
                t("fileManager.messages.createFolderFailedRetrying", {
                  current: attempt + 1,
                  max: maxRetries,
                }),
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (attempt + 1)),
              );
              continue;
            }

            setCreateFolderDialogError(
              t("fileManager.errors.createFolderFailed") +
                ": " +
                (error.message || t("fileManager.errors.unknownError")),
            );
            return;
          }
        }
      } finally {
        setLoading(false);
        setCreateFolderSubmitting(false);
      }
    };

    // 处理创建文件
    const handleCreateFile = () => {
      setNewFileName("");
      setCreateFileDialogError("");
      setCreateFileSubmitting(false);
      setShowCreateFileDialog(true);
      handleBlankContextMenuClose();
    };

    const handleCloseCreateFileDialog = useCallback(() => {
      if (createFileSubmitting) {
        return;
      }

      setShowCreateFileDialog(false);
      setCreateFileDialogError("");
    }, [createFileSubmitting]);

    // 处理创建文件提交
    const handleCreateFileSubmit = async (e) => {
      e.preventDefault();

      const fileName = newFileName.trim();

      if (!fileName) {
        setCreateFileDialogError(t("fileManager.errors.emptyName"));
        return;
      }

      if (!sshConnection) {
        setCreateFileDialogError(t("fileManager.errors.noConnection"));
        return;
      }

      if (!window.terminalAPI || !window.terminalAPI.createFile) {
        setCreateFileDialogError(t("fileManager.errors.fileApiNotAvailable"));
        return;
      }

      const fullPath =
        currentPath === "/" ? "/" + fileName : currentPath + "/" + fileName;

      setCreateFileSubmitting(true);
      setLoading(true);
      setError(null);
      setCreateFileDialogError("");

      try {
        const result = await window.terminalAPI.createFile(tabId, fullPath);
        if (result?.success) {
          await loadDirectory(currentPath, 0, true);
          setShowCreateFileDialog(false);
          setNewFileName("");
          return;
        }

        setCreateFileDialogError(
          `${t("fileManager.errors.createFileFailed")}: ${result?.error || t("fileManager.errors.unknownError")}`,
        );
      } catch (error) {
        setCreateFileDialogError(
          t("fileManager.errors.createFileFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        );
      } finally {
        setLoading(false);
        setCreateFileSubmitting(false);
      }
    };

    const getDroppedFileLocalPath = useCallback((file) => {
      if (!file) return "";

      if (window.terminalAPI?.getPathForFile) {
        try {
          const resolvedPath = window.terminalAPI.getPathForFile(file);
          if (typeof resolvedPath === "string" && resolvedPath) {
            return resolvedPath;
          }
        } catch {
          return "";
        }
      }

      return "";
    }, []);

    const getDropValidationMessage = useCallback(
      (rejectedItem) => {
        const name =
          rejectedItem?.name ||
          rejectedItem?.relativePath ||
          rejectedItem?.localPath ||
          t("fileManager.messages.unknownFile");

        if (rejectedItem?.reason === "missing-local-path") {
          return t("fileManager.errors.dragDropLocalPathRequired");
        }

        if (rejectedItem?.reason === "permission-denied") {
          return t("fileManager.errors.dragDropPermissionDenied", { name });
        }

        if (rejectedItem?.reason === "unsupported-file-type") {
          return t("fileManager.errors.dragDropUnsupportedItem", { name });
        }

        return t("fileManager.errors.dragDropValidationFailed", {
          reason: rejectedItem?.message || t("fileManager.errors.unknownError"),
        });
      },
      [t],
    );

    const confirmDroppedUploadConflicts = useCallback(
      async (conflicts) => {
        if (!Array.isArray(conflicts) || conflicts.length === 0) {
          return true;
        }

        const conflictItems = conflicts
          .slice(0, TRANSFER_CONFLICT_PREVIEW_LIMIT)
          .map((item) => item.remotePath || item.relativePath || item.name)
          .filter(Boolean);
        const remainingCount = Math.max(
          0,
          conflicts.length - conflictItems.length,
        );

        return showConfirmDialog({
          title: t("fileManager.messages.dragDropConflictTitle"),
          message: t("fileManager.messages.dragDropConflictMessage", {
            count: conflicts.length,
          }),
          detailItems: conflictItems,
          detailFooter: remainingCount > 0 ? `... +${remainingCount}` : "",
          confirmText: t("fileManager.messages.dragDropConflictConfirm"),
          cancelText: t("fileManager.messages.dragDropConflictCancel"),
          confirmColor: "warning",
          defaultAction: "cancel",
        });
      },
      [showConfirmDialog, t],
    );

    // 处理拖拽的文件和文件夹
    const handleDroppedItems = useCallback(
      async (entries) => {
        setTransferCancelled(false);

        let targetPath = currentPath;
        if (selectedFile && selectedFile.isDirectory) {
          if (currentPath === "/") {
            targetPath = "/" + selectedFile.name;
          } else if (currentPath === "~") {
            targetPath = "~/" + selectedFile.name;
          } else {
            targetPath = currentPath + "/" + selectedFile.name;
          }
        }

        if (
          !window.terminalAPI?.uploadDroppedFiles ||
          !window.terminalAPI?.validateDroppedItems ||
          !window.terminalAPI?.checkDroppedUploadConflicts
        ) {
          setNotification({
            message: t("fileManager.errors.dragDropNotSupported"),
            severity: "error",
          });
          return;
        }

        const transferId = addTransferProgress({
          type: "upload-multifile",
          progress: 0,
          fileName: t("fileManager.messages.preparingUpload"),
          statusText: t("fileManager.transfer.status.preparingUpload"),
          currentFile: "",
          transferredBytes: 0,
          totalBytes: 0,
          transferSpeed: 0,
          remainingTime: 0,
          currentFileIndex: 0,
          processedFiles: 0,
          totalFiles: Math.max(1, entries?.length || 1),
          transferKey: "",
          fileList: null,
        });
        let didForegroundRefresh = false;

        const droppedItems = [];

        const readEntry = async (entry, pathPrefix = "", localPath = "") => {
          if (!entry) return;
          const entryName = getDroppedEntryName(entry);

          if (entry.isFile) {
            if (!entryName) {
              droppedItems.push({
                name: "",
                relativePath: "",
                localPath,
                isFile: true,
              });
              return;
            }

            droppedItems.push({
              name: entryName,
              relativePath: `${pathPrefix}${entryName}`,
              localPath,
              isFile: true,
            });
            return;
          }

          if (!entry.isDirectory || typeof entry.createReader !== "function") {
            droppedItems.push({
              name: entryName,
              relativePath: entryName ? `${pathPrefix}${entryName}` : "",
              localPath: "",
            });
            return;
          }

          if (!entryName) {
            droppedItems.push({
              name: "",
              relativePath: "",
              localPath,
              isDirectory: true,
              directoryReadable: false,
            });
            return;
          }

          const directoryPrefix = `${pathPrefix}${entryName}/`;
          const directoryRelativePath = directoryPrefix.replace(/\/$/, "");
          const directoryLocalPath = localPath;
          const reader = entry.createReader();
          const childEntries = [];
          let directoryReadable = true;

          await new Promise((resolve) => {
            const readEntries = () => {
              reader.readEntries(
                (batch) => {
                  if (!batch || batch.length === 0) {
                    resolve();
                    return;
                  }
                  childEntries.push(...batch);
                  readEntries();
                },
                () => {
                  directoryReadable = false;
                  resolve();
                },
              );
            };
            readEntries();
          });

          droppedItems.push({
            name: entryName,
            relativePath: directoryRelativePath,
            localPath: directoryLocalPath,
            isDirectory: true,
            directoryReadable,
          });

          for (const childEntry of childEntries) {
            await readEntry(
              childEntry,
              directoryPrefix,
              joinDroppedLocalPath(directoryLocalPath, childEntry?.name),
            );
          }
        };

        for (const rootItem of entries) {
          await readEntry(rootItem.entry, "", rootItem.localPath);
        }

        if (droppedItems.length === 0) {
          const message = t("fileManager.errors.noFilesSelected");
          updateTransferProgress(transferId, {
            error: message,
            statusText: t("fileManager.transfer.status.failed"),
          });
          storeScheduleTransferCleanup(transferId, 3000);
          setNotification({
            message,
            severity: "warning",
          });
          return;
        }

        const validation =
          await window.terminalAPI.validateDroppedItems(droppedItems);
        if (!validation?.success || validation.rejected?.length > 0) {
          const message = getDropValidationMessage(validation?.rejected?.[0]);
          updateTransferProgress(transferId, {
            error: message,
            statusText: t("fileManager.transfer.status.failed"),
          });
          storeScheduleTransferCleanup(transferId, 5000);
          setNotification({
            message,
            severity: "error",
          });
          return;
        }

        const filesDataForUpload = (validation.files || []).map((item) => {
          return {
            name: item.name,
            relativePath: item.relativePath,
            size: item.size,
            lastModified: item.lastModified,
            localPath: item.localPath,
          };
        });

        const foldersForUpload = (validation.folders || [])
          .map((item) => ({
            name: item.name,
            relativePath: item.relativePath,
            lastModified: item.lastModified,
            localPath: item.localPath,
          }))
          .sort((left, right) =>
            String(left.relativePath || "").localeCompare(
              String(right.relativePath || ""),
            ),
          );

        if (filesDataForUpload.length === 0 && foldersForUpload.length === 0) {
          const message = t("fileManager.errors.noFilesSelected");
          updateTransferProgress(transferId, {
            error: message,
            statusText: t("fileManager.transfer.status.failed"),
          });
          storeScheduleTransferCleanup(transferId, 3000);
          setNotification({
            message,
            severity: "warning",
          });
          return;
        }

        const uploadData = {
          files: filesDataForUpload,
          folders: foldersForUpload,
        };
        const droppedDisplayName =
          buildTransferDisplayName(
            [
              ...filesDataForUpload.map((item) =>
                getTopLevelTransferItemName(item.relativePath || item.name),
              ),
              ...foldersForUpload.map((folder) =>
                getTopLevelTransferItemName(folder.relativePath || folder.name),
              ),
            ],
            "项目",
          ) || t("fileManager.messages.preparingUpload");

        updateTransferProgress(transferId, {
          fileName: droppedDisplayName,
          totalBytes: filesDataForUpload.reduce(
            (sum, item) => sum + Math.max(0, Number(item.size) || 0),
            0,
          ),
          totalFiles: Math.max(
            1,
            filesDataForUpload.length || foldersForUpload.length,
          ),
        });

        try {
          const conflictResult =
            await window.terminalAPI.checkDroppedUploadConflicts(
              tabId,
              targetPath,
              uploadData,
            );
          if (!conflictResult?.success) {
            throw new Error(
              t("fileManager.errors.dragDropValidationFailed", {
                reason:
                  conflictResult?.error || t("fileManager.errors.unknownError"),
              }),
            );
          }

          if (conflictResult.hasConflicts) {
            const confirmed = await confirmDroppedUploadConflicts(
              conflictResult.conflicts,
            );
            if (!confirmed) {
              updateTransferProgress(transferId, {
                isCancelled: true,
                statusText: t("fileManager.transfer.status.transferCancelled"),
                cancelMessage: t(
                  "fileManager.errors.dragDropConflictCancelled",
                ),
              });
              storeScheduleTransferCleanup(transferId, 3000);
              setNotification({
                message: t("fileManager.errors.dragDropConflictCancelled"),
                severity: "warning",
              });
              return;
            }
          }

          const result = await window.terminalAPI.uploadDroppedFiles(
            tabId,
            targetPath,
            uploadData,
            (
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              currentFileIndex,
              processedFiles,
              totalFiles,
              transferKey,
              operationComplete,
              fileList,
            ) => {
              const validProgress = Math.max(0, Math.min(100, progress || 0));
              const validTransferredBytes = Math.max(0, transferredBytes || 0);
              const validTotalBytes = Math.max(0, totalBytes || 0);
              const validTransferSpeed = Math.max(0, transferSpeed || 0);
              const validRemainingTime = Math.max(0, remainingTime || 0);
              const validCurrentFileIndex = Math.max(0, currentFileIndex || 0);
              const validProcessedFiles = Math.max(0, processedFiles || 0);
              const validTotalFiles = Math.max(0, totalFiles || 0);

              if (transferCancelled) {
                return;
              }

              updateTransferProgress(transferId, {
                progress: validProgress,
                fileName: fileName || droppedDisplayName,
                statusText: t("fileManager.transfer.status.uploading"),
                currentFile: fileName || "",
                transferredBytes: validTransferredBytes,
                totalBytes: validTotalBytes,
                transferSpeed: validTransferSpeed,
                remainingTime: validRemainingTime,
                currentFileIndex: validCurrentFileIndex,
                processedFiles: validProcessedFiles,
                totalFiles: validTotalFiles,
                transferKey: transferKey || "",
                isCompleted: operationComplete === true,
                fileList: fileList || null,
              });
            },
          );

          if (isUserCancellationError(result)) {
            setTransferCancelled(true);
            updateTransferProgress(transferId, {
              isCancelled: true,
              statusText: t("fileManager.transfer.status.transferCancelled"),
              cancelMessage: t("fileManager.errors.userCancelled"),
            });
            storeScheduleTransferCleanup(transferId, 3000);
          } else if (result?.success) {
            updateTransferProgress(transferId, {
              progress: 100,
              fileName:
                result.message || t("fileManager.messages.uploadComplete"),
              statusText: t("fileManager.transfer.status.completed"),
              currentFile: "",
              isCompleted: true,
              processedFiles: Math.max(
                0,
                result.uploadedCount ??
                  result.successfulFiles ??
                  result.totalFiles ??
                  0,
              ),
              currentFileIndex: Math.max(0, result.totalFiles || 0),
              totalFiles: Math.max(0, result.totalFiles || 0),
            });

            storeScheduleTransferCleanup(transferId, 3000);

            updateCurrentPath(targetPath);
            setPathInput(targetPath);
            await loadDirectory(targetPath, 0, true);
            didForegroundRefresh = true;

            if (result.partialSuccess && result.warning) {
              setNotification({
                message: result.warning,
                severity: "warning",
              });
            } else {
              setNotification({
                message: t("fileManager.messages.uploadSuccess"),
                severity: "success",
              });
            }

            if (!didForegroundRefresh) {
              refreshAfterUserActivity();
            }
          } else {
            throw new Error(
              result?.error || t("fileManager.errors.uploadFailed"),
            );
          }
        } catch (error) {
          const isCancellation = isUserCancellationError(error);
          const errorMessage =
            error?.message ||
            error?.toString?.() ||
            t("fileManager.errors.unknownError");

          updateTransferProgress(transferId, {
            error: isCancellation ? "" : errorMessage,
            isCancelled: isCancellation,
            statusText: isCancellation
              ? t("fileManager.transfer.status.transferCancelled")
              : t("fileManager.transfer.status.failed"),
            errorMessage,
          });

          if (!isCancellation) {
            setNotification({
              message: errorMessage || t("fileManager.errors.uploadFailed"),
              severity: "error",
            });
          }

          storeScheduleTransferCleanup(
            transferId,
            isCancellation ? 3000 : 5000,
          );

          if (!didForegroundRefresh) {
            refreshAfterUserActivity();
          }
        }
      },
      [
        currentPath,
        selectedFile,
        tabId,
        t,
        transferCancelled,
        addTransferProgress,
        updateTransferProgress,
        isUserCancellationError,
        refreshAfterUserActivity,
        setNotification,
        updateCurrentPath,
        setPathInput,
        loadDirectory,
        storeScheduleTransferCleanup,
        getDropValidationMessage,
        confirmDroppedUploadConflicts,
      ],
    );

    const handleDrop = useCallback(
      async (e) => {
        e.preventDefault();
        e.stopPropagation();

        setIsDragging(false);
        setDragCounter(0);

        if (!sshConnection) {
          setNotification({
            message: t("fileManager.errors.noConnection"),
            severity: "error",
          });
          return;
        }

        const items = e.dataTransfer.items;
        if (!items || items.length === 0) return;

        const itemsArray = Array.from(items);
        const nativeFiles = Array.from(e.dataTransfer.files || []);
        if (itemsArray.some((item) => item.kind === "string")) {
          setNotification({
            message: t("fileManager.errors.dragDropRemotePathUnsupported"),
            severity: "warning",
          });
          return;
        }

        if (nativeFiles.length !== itemsArray.length) {
          setNotification({
            message: t("fileManager.errors.dragDropRemotePathUnsupported"),
            severity: "warning",
          });
          return;
        }

        const nativePathByName = new Map();
        const duplicateNativeNames = new Set();
        let hasInvalidNativePath = false;
        for (const nativeFile of nativeFiles) {
          const localPath = getDroppedFileLocalPath(nativeFile);
          const localBaseName = getLocalPathBaseName(localPath);
          if (!localPath || !localBaseName) {
            hasInvalidNativePath = true;
            continue;
          }

          if (nativePathByName.has(localBaseName)) {
            duplicateNativeNames.add(localBaseName);
          }
          nativePathByName.set(localBaseName, localPath);
        }

        if (hasInvalidNativePath || duplicateNativeNames.size > 0) {
          setNotification({
            message: t("fileManager.errors.dragDropRemotePathUnsupported"),
            severity: "warning",
          });
          return;
        }

        const filesAndFolders = [];
        const rejectedItems = [];

        for (let index = 0; index < itemsArray.length; index += 1) {
          const item = itemsArray[index];
          if (item.kind !== "file") {
            rejectedItems.push(item);
            continue;
          }

          const entry = item.webkitGetAsEntry?.();
          const entryName = getDroppedEntryName(entry);
          const localPath = nativePathByName.get(entryName);

          if (entry && entryName && localPath) {
            filesAndFolders.push({ entry, localPath });
            continue;
          }

          rejectedItems.push(item);
        }

        if (rejectedItems.length > 0 || filesAndFolders.length === 0) {
          setNotification({
            message: t("fileManager.errors.dragDropRemotePathUnsupported"),
            severity: "warning",
          });
          return;
        }

        try {
          await handleDroppedItems(filesAndFolders);
        } catch (error) {
          setNotification({
            message:
              error?.message ||
              t("fileManager.errors.dragDropValidationFailed", {
                reason: t("fileManager.errors.unknownError"),
              }),
            severity: "error",
          });
        }
      },
      [
        sshConnection,
        t,
        handleDroppedItems,
        setNotification,
        getDroppedFileLocalPath,
      ],
    );

    useEffect(() => {
      if (!window.terminalAPI?.onExternalEditorEvent || !tabId) {
        externalEditorEventThrottles.current.clear();
        return undefined;
      }

      externalEditorEventThrottles.current.clear();

      const unsubscribe = window.terminalAPI.onExternalEditorEvent((event) => {
        if (!event || event.tabId !== tabId) {
          return;
        }

        const displayName =
          event.fileName ||
          event.remotePath ||
          t("fileManager.externalEditor.unknownFile");

        if (event.status === "opened") {
          showNotification(
            t("fileManager.externalEditor.opened", { name: displayName }),
            "info",
            2000,
          );
          return;
        }

        if (event.status === "success") {
          const throttleKey = `${event.tabId}::${event.remotePath || event.fileName || displayName}`;
          const now = Date.now();
          const last =
            externalEditorEventThrottles.current.get(throttleKey) || 0;
          if (now - last < 4000) {
            return;
          }
          externalEditorEventThrottles.current.set(throttleKey, now);
          showNotification(
            t("fileManager.externalEditor.synced", { name: displayName }),
            "success",
            2500,
          );
          refreshAfterUserActivity();
          return;
        }

        if (event.status === "error") {
          showNotification(
            t("fileManager.externalEditor.syncFailed", {
              name: displayName,
              error: event.error || t("fileManager.errors.unknownError"),
            }),
            "error",
            6000,
          );
        }
      });

      return () => {
        externalEditorEventThrottles.current.clear();
        if (typeof unsubscribe === "function") {
          unsubscribe();
        }
      };
    }, [tabId, showNotification, t, refreshAfterUserActivity]);

    // 在特定的回调函数中调用refreshAfterUserActivity

    const openFilePreview = useCallback(
      (file) => {
        if (!file || file.isDirectory) {
          return false;
        }

        const maxFileSize = 10 * 1024 * 1024;
        if (file.size && file.size > maxFileSize) {
          setError(
            t("fileManager.messages.fileSizeExceedsLimit", {
              name: file.name,
              size: formatFileSize(file.size, { t }),
            }),
          );
          return false;
        }

        setFilePreview(file);
        setShowPreview(true);
        refreshAfterUserActivity();
        return true;
      },
      [refreshAfterUserActivity, t],
    );

    // 处理文件激活（双击）
    const handleFileActivate = async (file) => {
      if (file.isDirectory) {
        const basePath =
          currentPath && currentPath.length > 0 ? currentPath : "/";
        const newPath =
          basePath === "/"
            ? `/${file.name}`
            : basePath.endsWith("/")
              ? `${basePath}${file.name}`
              : `${basePath}/${file.name}`;

        handleEnterDirectory(newPath);
        return;
      }

      if (
        !externalEditorEnabled ||
        !window.terminalAPI?.openFileInExternalEditor
      ) {
        openFilePreview(file);
        return;
      }

      if (!tabId) {
        showNotification(
          t("fileManager.externalEditor.missingSession"),
          "error",
          6000,
        );
        return;
      }

      const basePath =
        currentPath && currentPath.length > 0 ? currentPath : "/";
      let remotePath;
      if (basePath === "/") {
        remotePath = `/${file.name}`;
      } else if (basePath.endsWith("/")) {
        remotePath = `${basePath}${file.name}`;
      } else {
        remotePath = `${basePath}/${file.name}`;
      }

      try {
        const result = await window.terminalAPI.openFileInExternalEditor(
          tabId,
          remotePath,
        );
        if (!result?.success) {
          const errorMessage =
            result?.error || t("fileManager.errors.unknownError");
          showNotification(
            t("fileManager.externalEditor.launchFailed", {
              name: file.name,
              error: errorMessage,
            }),
            "error",
            6000,
          );
          openFilePreview(file);
          return;
        }
      } catch (error) {
        const errorMessage =
          (error && (error.message || error.error)) ||
          (typeof error === "string"
            ? error
            : t("fileManager.errors.unknownError"));

        if (
          typeof errorMessage === "string" &&
          errorMessage.toLowerCase().includes("disabled")
        ) {
          openFilePreview(file);
          return;
        }

        showNotification(
          t("fileManager.externalEditor.launchFailed", {
            name: file.name,
            error: errorMessage,
          }),
          "error",
          6000,
        );
        openFilePreview(file);
      }
    };

    // 关闭预览
    const handleClosePreview = () => {
      setShowPreview(false);
    };

    // 修改文件操作相关处理函数，在文件操作后调用refreshAfterUserActivity

    // 处理下载
    const handleDownload = async () => {
      const filesToDownload = getSelectedFiles().filter((f) => !f.isDirectory);
      if (filesToDownload.length === 0 || !sshConnection) return;

      setTransferCancelled(false);
      const savedCurrentPath = currentPath;

      if (filesToDownload.length === 1) {
        const savedSelectedFile = filesToDownload[0];
        let activeDownloadTransferId = null;

        try {
          const fullPath = joinPath(savedCurrentPath, savedSelectedFile.name);

          if (!window.terminalAPI?.downloadFile) {
            throw new Error(t("fileManager.errors.fileApiNotAvailable"));
          }

          showNotification(
            t("fileManager.messages.startDownloadNamed", {
              name: savedSelectedFile.name,
            }),
            "info",
            2000,
          );

          const transferId = addTransferProgress({
            type: "download",
            progress: 0,
            fileName: savedSelectedFile.name,
            statusText: t("fileManager.transfer.status.waitingForSaveLocation"),
            currentFile: savedSelectedFile.name,
            transferredBytes: 0,
            totalBytes: savedSelectedFile.size || 0,
            transferSpeed: 0,
            remainingTime: 0,
            processedFiles: 0,
            totalFiles: 1,
          });
          activeDownloadTransferId = transferId;

          const result = await window.terminalAPI.downloadFile(
            tabId,
            fullPath,
            (
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              totalFiles,
              transferKey,
            ) => {
              updateTransferProgress(transferId, {
                progress: Math.max(0, Math.min(100, progress || 0)),
                fileName: fileName || savedSelectedFile.name,
                statusText: t("fileManager.transfer.status.downloading"),
                currentFile: fileName || savedSelectedFile.name,
                transferredBytes: Math.max(0, transferredBytes || 0),
                totalBytes: Math.max(0, totalBytes || 0),
                transferSpeed: Math.max(0, transferSpeed || 0),
                remainingTime: Math.max(0, remainingTime || 0),
                processedFiles: Math.max(0, processedFiles || 0),
                totalFiles: Math.max(1, totalFiles || 1),
                transferKey: transferKey || "",
              });
            },
          );

          if (result?.cancelled || isUserCancellationError(result)) {
            setTransferCancelled(true);
            updateTransferProgress(transferId, {
              isCancelled: true,
              statusText: t("fileManager.transfer.status.downloadCancelled"),
              cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
            });
            storeScheduleTransferCleanup(transferId, 3000);
            showNotification(
              t("fileManager.errors.downloadCancelledByUser"),
              "info",
              3000,
            );
          } else if (result?.success) {
            updateTransferProgress(transferId, {
              progress: 100,
              fileName: savedSelectedFile.name,
              statusText: t("fileManager.transfer.status.completed"),
              currentFile: "",
              processedFiles: 1,
              totalFiles: 1,
              downloadPath: result.downloadPath || "",
            });
            storeScheduleTransferCleanup(transferId, 3000);
            void showDownloadedLocationNotification({
              itemName: savedSelectedFile.name,
              downloadPath: result.downloadPath,
              successMessage: t("fileManager.messages.downloadSavedToLocal", {
                name: savedSelectedFile.name,
              }),
            });
          } else {
            const errorMessage =
              result?.error || t("fileManager.errors.downloadFailed");
            updateTransferProgress(transferId, {
              error: errorMessage,
              statusText: t("fileManager.transfer.status.downloadFailed"),
            });
            storeScheduleTransferCleanup(transferId, 5000);
            showNotification(
              `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
              "error",
              6000,
            );
          }
        } catch (error) {
          const errorMessage =
            error?.message || t("fileManager.errors.unknownError");

          if (isUserCancellationError(error)) {
            setTransferCancelled(true);
            if (activeDownloadTransferId) {
              updateTransferProgress(activeDownloadTransferId, {
                isCancelled: true,
                statusText: t("fileManager.transfer.status.downloadCancelled"),
                cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
              });
              storeScheduleTransferCleanup(activeDownloadTransferId, 3000);
            }
            showNotification(
              t("fileManager.errors.downloadCancelledByUser"),
              "info",
              3000,
            );
          } else if (!errorMessage.includes("reply was never sent")) {
            if (activeDownloadTransferId) {
              updateTransferProgress(activeDownloadTransferId, {
                error: errorMessage,
                statusText: t("fileManager.transfer.status.downloadFailed"),
              });
              storeScheduleTransferCleanup(activeDownloadTransferId, 5000);
            }
            showNotification(
              `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
              "error",
              6000,
            );
          }
        }
      } else {
        let batchTransferId = null;

        try {
          showNotification(
            t("fileManager.messages.startDownload", {
              count: filesToDownload.length,
            }),
            "info",
          );

          if (!window.terminalAPI?.downloadFiles) {
            throw new Error(t("fileManager.errors.fileApiNotAvailable"));
          }

          const batchDisplayName =
            buildTransferDisplayName(
              filesToDownload.map((file) => file.name),
              "文件",
            ) ||
            t("fileManager.messages.batchDownloadTitle", {
              count: filesToDownload.length,
            });

          batchTransferId = addTransferProgress({
            type: "download",
            progress: 0,
            fileName: batchDisplayName,
            statusText: t("fileManager.transfer.status.waitingForTargetFolder"),
            currentFile: "",
            transferredBytes: 0,
            totalBytes: filesToDownload.reduce(
              (sum, file) => sum + (file.size || 0),
              0,
            ),
            transferSpeed: 0,
            remainingTime: 0,
            processedFiles: 0,
            totalFiles: filesToDownload.length,
          });

          const files = filesToDownload.map((file) => ({
            remotePath: joinPath(savedCurrentPath, file.name),
            fileName: file.name,
            size: file.size || 0,
          }));

          const result = await window.terminalAPI.downloadFiles(
            tabId,
            files,
            (
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              totalFiles,
              transferKey,
            ) => {
              updateTransferProgress(batchTransferId, {
                progress: Math.max(0, Math.min(100, progress || 0)),
                fileName: fileName || batchDisplayName,
                statusText: buildBatchDownloadStatusText({
                  processedFiles,
                  totalFiles,
                  currentFile: fileName,
                }),
                currentFile: fileName || "",
                transferredBytes: Math.max(0, transferredBytes || 0),
                totalBytes: Math.max(0, totalBytes || 0),
                transferSpeed: Math.max(0, transferSpeed || 0),
                remainingTime: Math.max(0, remainingTime || 0),
                processedFiles: Math.max(0, processedFiles || 0),
                totalFiles: Math.max(1, totalFiles || filesToDownload.length),
                transferKey: transferKey || "",
              });
            },
          );

          if (result?.cancelled || isUserCancellationError(result)) {
            setTransferCancelled(true);
            updateTransferProgress(batchTransferId, {
              isCancelled: true,
              statusText: t(
                "fileManager.transfer.status.batchDownloadCancelled",
              ),
              cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
            });
            storeScheduleTransferCleanup(batchTransferId, 3000);
            showNotification(
              t("fileManager.errors.downloadCancelledByUser"),
              "info",
              3000,
            );
          } else if (result?.partialSuccess) {
            const completedCount = Math.max(0, result.completed || 0);
            const failedCount = Math.max(0, result.failed || 0);
            const warningMessage = t(
              "fileManager.messages.partialDownloadCompleted",
              {
                completed: completedCount,
                total: completedCount + failedCount,
              },
            );
            updateTransferProgress(batchTransferId, {
              progress: 100,
              fileName: batchDisplayName,
              statusText: warningMessage,
              warning: warningMessage,
              currentFile: "",
              processedFiles: completedCount + failedCount,
              totalFiles: Math.max(1, filesToDownload.length),
            });
            storeScheduleTransferCleanup(batchTransferId, 6000);
            showNotification(warningMessage, "warning", 6000);
            void showDownloadedLocationNotification({
              itemName: t("fileManager.messages.batchDownloadItemName"),
              downloadPath: result.targetDir,
              successMessage: result.targetDir
                ? t("fileManager.messages.batchDownloadSavedToPath", {
                    path: result.targetDir,
                  })
                : warningMessage,
              severity: "warning",
            });
          } else if (result?.success) {
            const completedCount = Math.max(
              0,
              result.completed || filesToDownload.length,
            );
            updateTransferProgress(batchTransferId, {
              progress: 100,
              fileName: t("fileManager.messages.batchDownloadCompleteTitle", {
                count: completedCount,
              }),
              statusText: t(
                "fileManager.messages.batchDownloadCompletedSummary",
                {
                  completed: completedCount,
                  total: filesToDownload.length,
                },
              ),
              currentFile: "",
              processedFiles: completedCount,
              totalFiles: filesToDownload.length,
            });
            storeScheduleTransferCleanup(batchTransferId, 3000);
            showNotification(
              t("fileManager.messages.downloadSuccessCount", {
                count: completedCount,
              }),
              "success",
              3000,
            );
            void showDownloadedLocationNotification({
              itemName: t("fileManager.messages.batchDownloadItemName"),
              downloadPath: result.targetDir,
              successMessage: result.targetDir
                ? t("fileManager.messages.batchDownloadSavedToPath", {
                    path: result.targetDir,
                  })
                : t("fileManager.messages.downloadSuccessCount", {
                    count: completedCount,
                  }),
            });
          } else {
            const errorMessage =
              result?.error || t("fileManager.errors.batchDownloadFailed");
            updateTransferProgress(batchTransferId, {
              error: errorMessage,
              statusText: t("fileManager.transfer.status.batchDownloadFailed"),
            });
            storeScheduleTransferCleanup(batchTransferId, 5000);
            showNotification(
              `${t("fileManager.errors.batchDownloadFailed")}: ${errorMessage}`,
              "error",
              6000,
            );
          }
        } catch (error) {
          const errorMessage =
            error?.message || t("fileManager.errors.unknownError");

          if (isUserCancellationError(error)) {
            setTransferCancelled(true);
            if (batchTransferId) {
              updateTransferProgress(batchTransferId, {
                isCancelled: true,
                statusText: t(
                  "fileManager.transfer.status.batchDownloadCancelled",
                ),
                cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
              });
              storeScheduleTransferCleanup(batchTransferId, 3000);
            }
            showNotification(
              t("fileManager.errors.downloadCancelledByUser"),
              "info",
              3000,
            );
          } else if (!errorMessage.includes("reply was never sent")) {
            if (batchTransferId) {
              updateTransferProgress(batchTransferId, {
                error: errorMessage,
                statusText: t(
                  "fileManager.transfer.status.batchDownloadFailed",
                ),
              });
              storeScheduleTransferCleanup(batchTransferId, 5000);
            }
            showNotification(
              `${t("fileManager.errors.batchDownloadFailed")}: ${errorMessage}`,
              "error",
              6000,
            );
          }
        }
      }

      handleContextMenuClose();
    };

    // 显示通知的辅助函数，增强版
    // 关闭通知
    const handleCloseNotification = () => {
      setNotification(null);
    };

    // 修改 setError 的使用，使用通知系统
    useEffect(() => {
      if (error) {
        showNotification(error, "error");
      }
    }, [error]);

    // 处理下载文件夹
    const handleDownloadFolder = async () => {
      if (!sshConnection) {
        showNotification(t("fileManager.errors.noConnection"), "error");
        return;
      }

      const foldersToDownload = getSelectedFiles().filter((f) => f.isDirectory);
      if (foldersToDownload.length === 0) {
        showNotification(
          t("fileManager.messages.selectFolderToDownload"),
          "warning",
        );
        return;
      }

      // 保存当前路径状态
      const savedCurrentPath = currentPath;

      // 重置取消状态
      setTransferCancelled(false);

      const runSingleFolderDownload = async (folder, index = 0, total = 1) => {
        const displayName =
          total > 1 ? `${folder.name} (${index + 1}/${total})` : folder.name;
        const fullPath = joinPath(savedCurrentPath, folder.name);
        const transferId = addTransferProgress({
          type: "download-folder",
          progress: 0,
          fileName: displayName,
          statusText: t("fileManager.transfer.status.waitingForTargetFolder"),
          currentFile: "",
          transferredBytes: 0,
          totalBytes: 0,
          transferSpeed: 0,
          remainingTime: 0,
          processedFiles: 0,
          totalFiles: 0,
        });

        try {
          if (!window.terminalAPI?.downloadFolder) {
            throw new Error(t("fileManager.errors.fileApiNotAvailable"));
          }

          const result = await window.terminalAPI.downloadFolder(
            tabId,
            fullPath,
            (
              progress,
              currentFile,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              totalFiles,
              transferKey,
            ) => {
              updateTransferProgress(transferId, {
                progress: Math.max(0, Math.min(100, progress || 0)),
                fileName: displayName,
                statusText: buildFolderDownloadStatusText({
                  currentFile,
                  processedFiles,
                  totalFiles,
                }),
                currentFile: currentFile || "",
                transferredBytes: Math.max(0, transferredBytes || 0),
                totalBytes: Math.max(0, totalBytes || 0),
                transferSpeed: Math.max(0, transferSpeed || 0),
                remainingTime: Math.max(0, remainingTime || 0),
                processedFiles: Math.max(0, processedFiles || 0),
                totalFiles: Math.max(0, totalFiles || 0),
                transferKey: transferKey || "",
              });
            },
          );

          if (result?.cancelled || isUserCancellationError(result)) {
            updateTransferProgress(transferId, {
              isCancelled: true,
              statusText: t(
                "fileManager.transfer.status.folderDownloadCancelled",
              ),
              cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
            });
            storeScheduleTransferCleanup(transferId, 3000);
            return {
              state: "cancelled",
              transferId,
              result,
            };
          }

          if (result?.partialSuccess) {
            const completedCount = Math.max(0, result.completed || 0);
            const failedCount = Math.max(0, result.failed || 0);
            const warningMessage = t(
              "fileManager.messages.partialDownloadCompleted",
              {
                completed: completedCount,
                total: completedCount + failedCount,
              },
            );
            updateTransferProgress(transferId, {
              progress: 100,
              fileName: displayName,
              statusText: warningMessage,
              warning: warningMessage,
              currentFile: "",
              processedFiles: completedCount + failedCount,
              totalFiles: completedCount + failedCount,
              downloadPath: result.downloadPath || "",
            });
            storeScheduleTransferCleanup(transferId, 6000);
            return {
              state: "warning",
              transferId,
              result,
              message: warningMessage,
            };
          }

          if (result?.success) {
            const completedCount = Math.max(0, result.completed || 0);
            updateTransferProgress(transferId, {
              progress: 100,
              fileName: displayName,
              statusText: t("fileManager.transfer.status.completed"),
              currentFile: "",
              processedFiles: completedCount,
              totalFiles: completedCount,
              downloadPath: result.downloadPath || "",
            });
            storeScheduleTransferCleanup(transferId, 3000);
            return {
              state: "success",
              transferId,
              result,
            };
          }

          const errorMessage =
            result?.error || t("fileManager.messages.downloadFolderFailed");
          updateTransferProgress(transferId, {
            error: errorMessage,
            statusText: t("fileManager.transfer.status.folderDownloadFailed"),
          });
          storeScheduleTransferCleanup(transferId, 5000);
          return {
            state: "error",
            transferId,
            result,
            message: errorMessage,
          };
        } catch (error) {
          const errorMessage =
            error?.message || t("fileManager.errors.unknownError");

          if (isUserCancellationError(error)) {
            updateTransferProgress(transferId, {
              isCancelled: true,
              statusText: t(
                "fileManager.transfer.status.folderDownloadCancelled",
              ),
              cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
            });
            storeScheduleTransferCleanup(transferId, 3000);
            return {
              state: "cancelled",
              transferId,
              message: t("fileManager.errors.downloadCancelledByUser"),
            };
          }

          updateTransferProgress(transferId, {
            error: errorMessage,
            statusText: t("fileManager.transfer.status.folderDownloadFailed"),
          });
          storeScheduleTransferCleanup(transferId, 5000);
          return {
            state: "error",
            transferId,
            message: errorMessage,
          };
        }
      };

      if (foldersToDownload.length === 1) {
        const savedSelectedFile = foldersToDownload[0];
        if (!savedSelectedFile.isDirectory) {
          return handleDownload();
        }

        showNotification(
          t("fileManager.messages.startDownloadFolderNamed", {
            name: savedSelectedFile.name,
          }),
          "info",
        );
        const outcome = await runSingleFolderDownload(savedSelectedFile);

        if (outcome.state === "cancelled") {
          setTransferCancelled(true);
          showNotification(
            t("fileManager.errors.downloadCancelledByUser"),
            "info",
            3000,
          );
        } else if (outcome.state === "warning") {
          showNotification(outcome.message, "warning", 6000);
          void showDownloadedLocationNotification({
            itemName: savedSelectedFile.name,
            downloadPath: outcome.result?.downloadPath,
            successMessage: t(
              "fileManager.messages.folderPartialDownloadSavedToLocal",
              {
                name: savedSelectedFile.name,
              },
            ),
            severity: "warning",
          });
        } else if (outcome.state === "success") {
          void showDownloadedLocationNotification({
            itemName: savedSelectedFile.name,
            downloadPath: outcome.result?.downloadPath,
            successMessage: t(
              "fileManager.messages.folderDownloadSavedToLocal",
              {
                name: savedSelectedFile.name,
              },
            ),
          });
        } else if (outcome.message) {
          showNotification(
            `${t("fileManager.messages.downloadFolderFailed")}: ${outcome.message}`,
            "error",
            8000,
          );
        }
      } else {
        showNotification(
          t("fileManager.messages.startDownloadFolders", {
            count: foldersToDownload.length,
          }),
          "info",
        );

        let successfulFolders = 0;
        let warningFolders = 0;
        let failedFolders = 0;
        let cancelledFolders = 0;

        for (let index = 0; index < foldersToDownload.length; index += 1) {
          const folder = foldersToDownload[index];
          const outcome = await runSingleFolderDownload(
            folder,
            index,
            foldersToDownload.length,
          );

          if (outcome.state === "success") {
            successfulFolders += 1;
            continue;
          }

          if (outcome.state === "warning") {
            successfulFolders += 1;
            warningFolders += 1;
            continue;
          }

          if (outcome.state === "cancelled") {
            cancelledFolders += 1;
            setTransferCancelled(true);
            break;
          }

          failedFolders += 1;
          if (outcome.message) {
            showNotification(
              t("fileManager.messages.downloadFolderItemFailed", {
                name: folder.name,
                error: outcome.message,
              }),
              "error",
              6000,
            );
          }
        }

        if (cancelledFolders > 0 && successfulFolders === 0) {
          showNotification(
            t("fileManager.errors.downloadCancelledByUser"),
            "info",
            3000,
          );
        } else if (failedFolders === 0 && warningFolders === 0) {
          showNotification(
            t("fileManager.messages.downloadFoldersSuccessCount", {
              count: successfulFolders,
            }),
            "success",
            3000,
          );
        } else {
          showNotification(
            t("fileManager.messages.downloadFoldersSummary", {
              success: successfulFolders,
              warning: warningFolders,
              failed: failedFolders,
            }),
            failedFolders > 0 || warningFolders > 0 ? "warning" : "success",
            6000,
          );
        }
      }

      handleContextMenuClose();
    };

    const handleDownloadSelection = useCallback(async () => {
      const selectedItems = getSelectedFiles();

      if (selectedItems.length === 0) {
        showNotification(
          t("fileManager.messages.selectFileOrFolder"),
          "warning",
        );
        return;
      }

      if (!sshConnection) {
        showNotification(t("fileManager.errors.noConnection"), "error");
        return;
      }

      const hasFiles = selectedItems.some((file) => !file.isDirectory);
      const hasFolders = selectedItems.some((file) => file.isDirectory);

      if (hasFiles && hasFolders) {
        showNotification(
          t("fileManager.messages.mixedSelectionDownload"),
          "info",
          4000,
        );
        await handleDownload();
        await handleDownloadFolder();
        return;
      }

      if (hasFolders) {
        await handleDownloadFolder();
        return;
      }

      await handleDownload();
    }, [
      getSelectedFiles,
      handleDownload,
      handleDownloadFolder,
      showNotification,
      sshConnection,
      t,
    ]);

    // 处理重命名
    const handleRename = async () => {
      if (!selectedFile) return;
      setNewName(selectedFile.name);
      setRenameDialogError("");
      setRenameSubmitting(false);
      // 打开重命名对话框
      setShowRenameDialog(true);
      handleContextMenuClose();
    };

    const handleCloseRenameDialog = useCallback(() => {
      if (renameSubmitting) {
        return;
      }

      setShowRenameDialog(false);
      setRenameDialogError("");
    }, [renameSubmitting]);

    // 处理重命名提交
    const handleRenameSubmit = async (e) => {
      e.preventDefault();

      if (!selectedFile) return;

      if (!newName.trim()) {
        setRenameDialogError(t("fileManager.errors.emptyName"));
        return;
      }

      if (!sshConnection) {
        setRenameDialogError(t("fileManager.errors.noConnection"));
        return;
      }

      if (!window.terminalAPI || !window.terminalAPI.renameFile) {
        setRenameDialogError(t("fileManager.errors.fileApiNotAvailable"));
        return;
      }

      // 检查是否有更改
      const nameChanged = newName && newName !== selectedFile.name;
      if (!nameChanged) {
        handleCloseRenameDialog();
        return;
      }

      const oldPath =
        currentPath === "/"
          ? "/" + selectedFile.name
          : currentPath
            ? currentPath + "/" + selectedFile.name
            : selectedFile.name;
      const maxRetries = 3;

      setRenameSubmitting(true);
      setLoading(true);
      setError(null);
      setRenameDialogError("");

      try {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const renameResponse = await window.terminalAPI.renameFile(
              tabId,
              oldPath,
              newName,
            );

            if (renameResponse?.success) {
              await loadDirectory(currentPath, 0, true);
              setShowRenameDialog(false);
              return;
            }

            const responseError =
              renameResponse?.error || t("fileManager.errors.renameFailed");
            const shouldRetry =
              responseError.includes("SFTP错误") && attempt < maxRetries;

            if (shouldRetry) {
              setRenameDialogError(
                t("fileManager.messages.updateFailedRetrying", {
                  current: attempt + 1,
                  max: maxRetries,
                }),
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (attempt + 1)),
              );
              continue;
            }

            setRenameDialogError(responseError);
            return;
          } catch (error) {
            if (attempt < maxRetries) {
              setRenameDialogError(
                t("fileManager.messages.updateFailedRetrying", {
                  current: attempt + 1,
                  max: maxRetries,
                }),
              );
              await new Promise((resolve) =>
                setTimeout(resolve, 500 * (attempt + 1)),
              );
              continue;
            }

            setRenameDialogError(
              `${t("fileManager.errors.updateFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
            );
            return;
          }
        }
      } finally {
        setLoading(false);
        setRenameSubmitting(false);
      }
    };

    // 重命名不再处理权限变化

    // 处理键盘快捷键
    const handleKeyDown = useCallback(
      (event) => {
        // 只有当文件管理器打开时才处理键盘事件
        if (!open || showPreview) return;

        const targetElement = event.target || document.activeElement;
        if (
          targetElement &&
          typeof targetElement.closest === "function" &&
          targetElement.closest('[data-file-preview-dialog="true"]')
        ) {
          return;
        }

        // 防止在输入框中触发快捷键
        if (
          event.target.tagName === "INPUT" ||
          event.target.tagName === "TEXTAREA"
        ) {
          return;
        }

        const selectedFilesData = getSelectedFiles();

        // Ctrl+D: 下载文件/文件夹
        if (event.ctrlKey && event.key === "d") {
          event.preventDefault();
          handleDownloadSelection();
        }

        // Delete: 删除文件/文件夹
        if (event.key === "Delete") {
          event.preventDefault();
          if (selectedFilesData.length > 0) {
            handleDelete();
          } else {
            showNotification(
              t("fileManager.messages.selectFileOrFolderToDelete"),
              "warning",
            );
          }
        }

        // F2: 重命名
        if (event.key === "F2") {
          event.preventDefault();
          if (selectedFilesData.length === 1) {
            handleRename();
          } else if (selectedFilesData.length > 1) {
            showNotification(
              t("fileManager.messages.batchRenameError"),
              "warning",
            );
          } else {
            showNotification(
              t("fileManager.messages.selectFileToRename"),
              "warning",
            );
          }
        }

        // F3: 权限设置
        if (event.key === "F3") {
          event.preventDefault();
          if (selectedFilesData.length === 1) {
            handleOpenPermissions();
          } else if (selectedFilesData.length > 1) {
            showNotification(
              t("fileManager.messages.batchSetPermissionsError"),
              "warning",
            );
          } else {
            showNotification(
              t("fileManager.messages.selectFileOrFolderToSetPermissions"),
              "warning",
            );
          }
        }

        // F4: 文件属性
        if (event.key === "F4") {
          event.preventDefault();
          if (selectedFilesData.length === 1) {
            handleOpenProperties();
          } else if (selectedFilesData.length > 1) {
            showNotification(
              t("fileManager.messages.batchViewPropertiesError"),
              "warning",
            );
          } else {
            showNotification(
              t("fileManager.messages.selectFileOrFolderToViewProperties"),
              "warning",
            );
          }
        }

        // F5: 刷新
        if (event.key === "F5") {
          event.preventDefault();
          handleRefresh();
        }

        // Ctrl+A: 全选
        if (event.ctrlKey && event.key === "a") {
          event.preventDefault();
          setSelectedFiles([...displayFiles]);
          setSelectedFile(displayFiles[0] || null);
          setLastSelectedIndex(0);
          setAnchorIndex(0); // 设置锚点为第一个文件
        }

        // Escape: 取消选择
        if (event.key === "Escape") {
          event.preventDefault();
          setSelectedFiles([]);
          setSelectedFile(null);
          setLastSelectedIndex(-1);
          setAnchorIndex(-1);
        }

        // Ctrl+Shift+C: 复制绝对路径
        if (event.ctrlKey && event.shiftKey && event.key === "C") {
          event.preventDefault();
          handleCopyAbsolutePath();
        }

        // Ctrl+N: 创建文件
        if (event.ctrlKey && !event.shiftKey && event.key === "n") {
          event.preventDefault();
          handleCreateFile();
        }

        // Ctrl+Shift+N: 创建文件夹
        if (event.ctrlKey && event.shiftKey && event.key === "N") {
          event.preventDefault();
          handleCreateFolder();
        }

        // Ctrl+U: 上传文件
        if (event.ctrlKey && !event.shiftKey && event.key === "u") {
          event.preventDefault();
          handleUploadFile();
        }

        // Ctrl+Shift+U: 上传文件夹
        if (event.ctrlKey && event.shiftKey && event.key === "U") {
          event.preventDefault();
          handleUploadFolder();
        }
      },
      [
        open,
        showPreview,
        getSelectedFiles,
        handleDownloadSelection,
        handleDownloadFolder,
        handleDownload,
        handleDelete,
        handleRename,
        handleOpenPermissions,
        handleOpenProperties,
        handleRefresh,
        displayFiles,
        handleCopyAbsolutePath,
        handleCreateFile,
        handleCreateFolder,
        handleUploadFile,
        handleUploadFolder,
        showNotification,
        setSelectedFiles,
        setSelectedFile,
        setLastSelectedIndex,
        setAnchorIndex,
      ],
    );

    // 添加键盘事件监听器
    useEffect(() => {
      if (!open) return;

      const keydownHandler = (event) => {
        try {
          handleKeyDown(event);
        } catch {
          // Silently handle keyboard event errors
        }
      };

      window.addEventListener("keydown", keydownHandler);

      return () => {
        window.removeEventListener("keydown", keydownHandler);
      };
    }, [open, handleKeyDown]);

    // 每分钟更新一次"上次刷新时间"显示
    useEffect(() => {
      if (!open) return;

      // 设置定时器,每60秒触发一次更新
      const intervalId = setInterval(() => {
        forceUpdate((prev) => prev + 1);
      }, 60000);

      return () => {
        clearInterval(intervalId);
      };
    }, [open]);

    const performClose = useCallback(() => {
      if (isClosing) {
        return;
      }

      setIsClosing(true);

      try {
        Promise.resolve(onClose?.())
          .catch(() => {
            setIsClosing(false);
          })
          .finally(() => {
            addTimeout(() => {
              if (openRef.current) {
                setIsClosing(false);
              }
            }, 300);
          });
      } catch (error) {
        setIsClosing(false);
        throw error;
      }
    }, [addTimeout, isClosing, onClose]);

    // 处理关闭文件管理器
    const handleClose = () => {
      if (isClosing) {
        return;
      }

      // 检查是否有正在进行的传输
      const activeTransfers = transferProgressList.filter(
        (t) => t.progress < 100 && !t.isCancelled && !t.error,
      );

      if (activeTransfers.length > 0) {
        const hasUpload = activeTransfers.some(
          (t) => t.type === "upload" || t.type === "upload-folder",
        );
        const hasDownload = activeTransfers.some(
          (t) => t.type === "download" || t.type === "download-folder",
        );

        let transferType = "";
        if (hasUpload && hasDownload) {
          transferType = t("fileManager.transferType.uploadAndDownload");
        } else if (hasUpload) {
          transferType = t("fileManager.transferType.upload");
        } else {
          transferType = t("fileManager.transferType.download");
        }

        setConfirmDialog({
          open: true,
          title: t("fileManager.closeConfirmTitle"),
          message: t("fileManager.closeConfirmMessage", { transferType }),
          onConfirm: performClose,
          confirmText: t("common.confirm"),
          confirmColor: "primary",
        });
        return;
      }

      performClose();
    };

    // 处理上传菜单打开
    const handleCreateMenuOpen = (event) => {
      setCreateMenuAnchor(event.currentTarget);
    };

    const handleCreateMenuClose = () => {
      setCreateMenuAnchor(null);
    };

    const handleCreateFolderFromMenu = () => {
      handleCreateMenuClose();
      handleCreateFolder();
    };

    const handleCreateFileFromMenu = () => {
      handleCreateMenuClose();
      handleCreateFile();
    };

    const handleUploadMenuOpen = (event) => {
      setUploadMenuAnchor(event.currentTarget);
    };

    // 处理上传菜单关闭
    const handleUploadMenuClose = () => {
      setUploadMenuAnchor(null);
    };

    // 处理上传文件菜单项点击
    const handleUploadFileFromMenu = () => {
      handleUploadMenuClose();
      handleUploadFile();
    };

    // 处理上传文件夹菜单项点击
    const handleUploadFolderFromMenu = () => {
      handleUploadMenuClose();
      handleUploadFolder();
    };

    // 处理排序菜单打开
    const handleSortMenuOpen = (event) => {
      setSortMenuAnchor(event.currentTarget);
    };

    // 处理排序菜单关闭
    const handleSortMenuClose = () => {
      setSortMenuAnchor(null);
    };

    // 切换排序模式
    const handleSortModeChange = (mode) => {
      setSortMode(mode);
      handleSortMenuClose();
    };

    const confirmDialogColor = CONFIRM_DIALOG_COLORS.has(
      confirmDialog.confirmColor,
    )
      ? confirmDialog.confirmColor
      : "primary";
    const confirmDialogPalette =
      theme.palette[confirmDialogColor] || theme.palette.primary;
    const ConfirmDialogIcon =
      confirmDialogColor === "error"
        ? DeleteIcon
        : confirmDialogColor === "warning"
          ? WarningAmberIcon
          : InfoOutlinedIcon;
    const confirmDialogDefaultRef =
      confirmDialog.defaultAction === "confirm"
        ? confirmDialogConfirmButtonRef
        : confirmDialogCancelButtonRef;
    const confirmDialogDetailItems = Array.isArray(confirmDialog.detailItems)
      ? confirmDialog.detailItems
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      : [];
    const confirmDialogDetailText =
      typeof confirmDialog.detail === "string"
        ? confirmDialog.detail.trim()
        : "";

    return (
      <Paper
        ref={fileManagerRootRef}
        tabIndex={-1}
        onMouseDown={focusSidebarRoot}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        sx={{
          width: "100%",
          minWidth: 0,
          height: "100%",
          overflow: "hidden",
          borderLeft: `1px solid ${theme.palette.divider}`,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          borderRadius: 0,
          // 拖拽时的视觉反馈
          ...(isDragging && {
            backgroundColor: theme.palette.action.hover,
            border: `2px dashed ${theme.palette.primary.main}`,
            boxShadow: `0 0 20px ${theme.palette.primary.main}30`,
          }),
        }}
        elevation={4}
      >
        <Box sx={sidebarContentSx(theme, open)}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              px: 1.5,
              py: 1.25,
              borderBottom: `1px solid ${theme.palette.divider}`,
              flexShrink: 0,
              backgroundColor:
                theme.palette.mode === "dark"
                  ? alpha(theme.palette.background.paper, 0.8)
                  : theme.palette.background.default,
            }}
          >
            <Typography
              variant="subtitle1"
              sx={{ flexGrow: 1 }}
              fontWeight="medium"
            >
              {tabName
                ? `${t("fileManager.title")} - ${tabName}`
                : t("fileManager.title")}
            </Typography>
            <Tooltip title={t("common.close")}>
              <span>
                <IconButton
                  size="small"
                  onClick={handleClose}
                  edge="end"
                  disabled={isClosing}
                  aria-label={t("common.close")}
                >
                  <CloseIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 1,
              display: "flex",
              flexDirection: "column",
              borderBottom: `1px solid ${theme.palette.divider}`,
              gap: 0.5,
              flexShrink: 0,
              backgroundColor: theme.palette.background.paper,
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minWidth: 0,
                gap: 1,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Tooltip title={t("fileManager.back")}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleHistoryBack}
                      disabled={historyIndex <= 0}
                      aria-label={t("fileManager.back")}
                    >
                      <ArrowBackIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title={t("fileManager.nextPath")}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleGoToNextPath}
                      disabled={historyIndex >= pathHistory.length - 1}
                      aria-label={t("fileManager.nextPath")}
                    >
                      <ArrowForwardIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title={t("fileManager.upLevel")}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleGoUp}
                      disabled={!currentPath || currentPath === "/"}
                      aria-label={t("fileManager.upLevel")}
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>

                <Tooltip title={t("fileManager.home")}>
                  <IconButton
                    size="small"
                    onClick={handleGoHome}
                    aria-label={t("fileManager.home")}
                  >
                    <HomeIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Tooltip title={t("fileManager.refresh")}>
                  <IconButton
                    size="small"
                    onClick={handleRefresh}
                    aria-label={t("fileManager.refresh")}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>

              <Box
                component="span"
                sx={{
                  minWidth: 0,
                  fontSize: "0.75rem",
                  color: theme.palette.text.secondary,
                  opacity: 0.8,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "right",
                }}
              >
                {t("fileManager.statusBar.lastRefresh", {
                  time: formatLastRefreshTime(lastRefreshTime),
                })}
              </Box>
            </Box>

            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                minWidth: 0,
                gap: 1,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <Tooltip title={t("fileManager.createFileOrFolder")}>
                  <IconButton
                    size="small"
                    onClick={handleCreateMenuOpen}
                    aria-label={t("fileManager.createFileOrFolder")}
                  >
                    <NoteAddIcon fontSize="small" />
                  </IconButton>
                </Tooltip>

                <Tooltip title={t("fileManager.upload")}>
                  <IconButton
                    size="small"
                    onClick={handleUploadMenuOpen}
                    aria-label={t("fileManager.upload")}
                  >
                    <UploadFileIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  flex: 1,
                  gap: 0.5,
                  minWidth: 0,
                }}
              >
                {showSearch && (
                  <TextField
                    inputRef={searchInputRef}
                    size="small"
                    placeholder={t("fileManager.search")}
                    value={searchTerm}
                    onChange={handleSearchChange}
                    variant="outlined"
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon fontSize="small" />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <Tooltip title={t("common.clearSearch")}>
                            <IconButton
                              size="small"
                              onClick={() => {
                                if (searchTerm) {
                                  setSearchTerm("");
                                  return;
                                }
                                setShowSearch(false);
                              }}
                              edge="end"
                              aria-label={t("common.clearSearch")}
                            >
                              <ClearIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </InputAdornment>
                      ),
                    }}
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      ...getSearchFieldMotionSx(theme),
                    }}
                  />
                )}

                {!showSearch && (
                  <Tooltip title={t("fileManager.search")}>
                    <IconButton
                      size="small"
                      onClick={toggleSearch}
                      aria-label={t("fileManager.search")}
                    >
                      <SearchIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}

                <Tooltip title={t("fileManager.sort")}>
                  <IconButton
                    size="small"
                    onClick={handleSortMenuOpen}
                    aria-label={t("fileManager.sort")}
                  >
                    {sortMode === "time" ? (
                      <AccessTimeIcon fontSize="small" />
                    ) : (
                      <SortByAlphaIcon fontSize="small" />
                    )}
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </Box>

          <Box
            sx={{
              px: 1.5,
              py: 0.75,
              overflow: "hidden",
              borderBottom: `1px solid ${theme.palette.divider}`,
              zIndex: 1,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              backgroundColor: theme.palette.background.paper,
            }}
          >
            <TextField
              size="small"
              variant="outlined"
              value={pathInput}
              onChange={handlePathInputChange}
              onKeyDown={handlePathInputSubmit}
              placeholder={t("fileManager.enterPath")}
              InputProps={{
                style: { fontSize: "1.0rem" },
                startAdornment: (
                  <InputAdornment position="start">
                    <FolderIcon color="action" fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{
                flex: 1,
                minWidth: 0,
                "& .MuiOutlinedInput-root": {
                  borderRadius: 1.5,
                  "& fieldset": {
                    borderColor: theme.palette.divider,
                  },
                  "&:hover fieldset": {
                    borderColor: theme.palette.primary.main,
                  },
                  "&.Mui-focused fieldset": {
                    borderColor: theme.palette.primary.main,
                  },
                },
              }}
            />
          </Box>

          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              marginTop: 0, // 确保没有额外的边距
              display: "flex",
              flexDirection: "column",
              height: 0, // 确保flex布局正常工作
              position: "relative", // 创建新的定位上下文
            }}
            onContextMenu={handleBlankContextMenu} // 添加空白区域右键菜单
          >
            {connectionLoading ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  width: "100%",
                  gap: 1.5,
                  px: 2,
                }}
              >
                <CircularProgress size={24} />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ textAlign: "center" }}
                >
                  {connectionLoadingMessage || t("fileManager.loading")}
                </Typography>
              </Box>
            ) : loading ? (
              <FileManagerSkeleton />
            ) : (
              renderFileList()
            )}
          </Box>
        </Box>

        <Menu
          open={contextMenu !== null && !menuItems.isDeleting}
          onClose={handleContextMenuClose}
          anchorReference="anchorPosition"
          PaperProps={{
            "data-file-manager-context-menu": "true",
            sx: compactContextMenuPaperSx,
          }}
          anchorPosition={
            contextMenu !== null
              ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
              : undefined
          }
          transitionDuration={0}
          disableAutoFocusItem
          disableScrollLock
        >
          {contextMenu !== null && [
            // 下载操作：支持单选和多选
            menuItems.hasFiles && (
              <MenuItem key="download-files" onClick={handleDownload}>
                <ListItemIcon>
                  <DownloadIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  {menuItems.fileCount > 1
                    ? `下载 ${menuItems.fileCount} 个文件`
                    : "下载文件"}
                </ListItemText>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2 }}
                >
                  Ctrl+D
                </Typography>
              </MenuItem>
            ),

            menuItems.hasFolders && (
              <MenuItem key="download-folders" onClick={handleDownloadFolder}>
                <ListItemIcon>
                  <DownloadIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  {menuItems.folderCount > 1
                    ? `下载 ${menuItems.folderCount} 个文件夹`
                    : "下载文件夹"}
                </ListItemText>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2 }}
                >
                  Ctrl+D
                </Typography>
              </MenuItem>
            ),

            // 上传操作：仅在选中单个目录时显示
            menuItems.isSingleSelection && menuItems.isDirectorySelected && (
              <MenuItem key="upload-file" onClick={handleUploadFile}>
                <ListItemIcon>
                  <UploadFileIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("fileManager.uploadFile")}</ListItemText>
              </MenuItem>
            ),

            menuItems.isSingleSelection && menuItems.isDirectorySelected && (
              <MenuItem key="upload-folder" onClick={handleUploadFolder}>
                <ListItemIcon>
                  <CreateNewFolderIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("fileManager.uploadFolder")}</ListItemText>
              </MenuItem>
            ),

            menuItems.isSingleSelection && <Divider key="divider-1" />,

            // 仅在单选时显示复制路径
            menuItems.isSingleSelection && (
              <MenuItem key="copy-path" onClick={handleCopyAbsolutePath}>
                <ListItemIcon>
                  <LinkIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("fileManager.copyPath")}</ListItemText>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2 }}
                >
                  Ctrl+Shift+C
                </Typography>
              </MenuItem>
            ),

            // 仅在单选时显示重命名
            menuItems.isSingleSelection && (
              <MenuItem key="rename" onClick={handleRename}>
                <ListItemIcon>
                  <DriveFileRenameOutlineIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("fileManager.rename")}</ListItemText>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2 }}
                >
                  F2
                </Typography>
              </MenuItem>
            ),

            // 仅在单选时显示属性
            menuItems.isSingleSelection && (
              <MenuItem key="properties" onClick={handleOpenProperties}>
                <ListItemIcon>
                  <InfoOutlinedIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("fileManager.properties")}</ListItemText>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2 }}
                >
                  F4
                </Typography>
              </MenuItem>
            ),

            // 仅在单选时显示权限设置
            menuItems.isSingleSelection && (
              <MenuItem key="permissions" onClick={handleOpenPermissions}>
                <ListItemIcon>
                  <LockIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("fileManager.permissions")}</ListItemText>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ ml: 2 }}
                >
                  F3
                </Typography>
              </MenuItem>
            ),

            <Divider key="divider-2" />,

            // 删除操作：支持单选和多选
            <MenuItem
              key="delete"
              onClick={handleDelete}
              disabled={menuItems.isDeleting}
            >
              <ListItemIcon>
                <DeleteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                {menuItems.isDeleting
                  ? t("fileManager.messages.operationInProgress")
                  : selectedFiles.length > 1
                    ? `删除 ${selectedFiles.length} 个项目`
                    : "删除"}
              </ListItemText>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 2 }}
              >
                Delete
              </Typography>
            </MenuItem>,
          ]}
        </Menu>

        <Menu
          open={blankContextMenu !== null && !menuItems.isDeleting}
          onClose={handleBlankContextMenuClose}
          anchorReference="anchorPosition"
          PaperProps={{
            "data-file-manager-context-menu": "true",
            sx: compactContextMenuPaperSx,
          }}
          anchorPosition={
            blankContextMenu !== null
              ? { top: blankContextMenu.mouseY, left: blankContextMenu.mouseX }
              : undefined
          }
          transitionDuration={0}
          disableAutoFocusItem
          disableScrollLock
        >
          <MenuItem onClick={handleCreateFolder}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.createFolder")}</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+Shift+N
            </Typography>
          </MenuItem>

          <MenuItem onClick={handleCreateFile}>
            <ListItemIcon>
              <NoteAddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.createFile")}</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+N
            </Typography>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleUploadFile}>
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t("fileManager.uploadFileToCurrentFolder")}
            </ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+U
            </Typography>
          </MenuItem>

          <MenuItem onClick={handleUploadFolder}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t("fileManager.uploadFolderToCurrentFolder")}
            </ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+Shift+U
            </Typography>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleRefresh}>
            <ListItemIcon>
              <RefreshIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.refreshDirectory")}</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              F5
            </Typography>
          </MenuItem>
        </Menu>

        {showRenameDialog && (
          <Dialog
            open={showRenameDialog}
            onClose={handleCloseRenameDialog}
            maxWidth="sm"
            fullWidth
          >
            <Box component="form" onSubmit={handleRenameSubmit}>
              <DialogTitle>{t("fileManager.editFileOrFolder")}</DialogTitle>
              <DialogContent dividers>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {renameDialogError ? (
                    <Alert severity="error">{renameDialogError}</Alert>
                  ) : null}
                  <TextField
                    fullWidth
                    label={t("fileManager.newName")}
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                    variant="outlined"
                    size="small"
                  />
                </Box>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                  onClick={handleCloseRenameDialog}
                  color="inherit"
                  size="small"
                  disabled={renameSubmitting}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                  disabled={renameSubmitting}
                >
                  {t("common.save")}
                </Button>
              </DialogActions>
            </Box>
          </Dialog>
        )}

        {showPermissionDialog && (
          <Dialog
            open={showPermissionDialog}
            onClose={handlePermissionDialogClose}
            maxWidth="sm"
            fullWidth
          >
            <Box component="form" onSubmit={handlePermissionDialogSubmit}>
              <DialogTitle>{t("fileManager.permissions")}</DialogTitle>
              <DialogContent dividers>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <FilePermissionEditor
                    permissions={permDialogPermissions}
                    onChange={setPermDialogPermissions}
                  />

                  <Box sx={{ display: "flex", gap: 2 }}>
                    <TextField
                      fullWidth
                      label={t("fileManager.owner")}
                      value={permDialogOwner}
                      onChange={(e) => setPermDialogOwner(e.target.value)}
                      variant="outlined"
                      size="small"
                    />
                    <TextField
                      fullWidth
                      label={t("fileManager.group")}
                      value={permDialogGroup}
                      onChange={(e) => setPermDialogGroup(e.target.value)}
                      variant="outlined"
                      size="small"
                    />
                  </Box>
                </Box>
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                  onClick={handlePermissionDialogClose}
                  color="inherit"
                  size="small"
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                >
                  {t("common.save")}
                </Button>
              </DialogActions>
            </Box>
          </Dialog>
        )}

        {showPropertiesDialog && (
          <Dialog
            open={showPropertiesDialog}
            onClose={handleClosePropertiesDialog}
            maxWidth="sm"
            fullWidth
          >
            <DialogTitle>{t("fileManager.properties")}</DialogTitle>
            <DialogContent dividers>
              {propertiesLoading && (
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    mb: 2,
                  }}
                >
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    {t("fileManager.propertiesDialog.loading")}
                  </Typography>
                </Box>
              )}

              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: "120px minmax(0, 1fr)",
                  rowGap: 1,
                  columnGap: 1.5,
                  alignItems: "start",
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.name")}
                </Typography>
                <Typography variant="body2">
                  {propertiesData?.name ||
                    t("fileManager.propertiesDialog.notAvailable")}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.type")}
                </Typography>
                <Typography variant="body2">
                  {propertiesData?.type ||
                    t("fileManager.propertiesDialog.notAvailable")}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.path")}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ wordBreak: "break-all", whiteSpace: "pre-wrap" }}
                >
                  {propertiesData?.path ||
                    t("fileManager.propertiesDialog.notAvailable")}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.size")}
                </Typography>
                <Typography variant="body2">
                  {Number.isFinite(propertiesData?.size)
                    ? formatFileSize(propertiesData.size, { t })
                    : t("fileManager.propertiesDialog.notAvailable")}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.modifiedTime")}
                </Typography>
                <Typography variant="body2">
                  {formatAbsoluteTime(propertiesData?.modifyTime)}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.accessTime")}
                </Typography>
                <Typography variant="body2">
                  {formatAbsoluteTime(propertiesData?.accessTime)}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.createdTime")}
                </Typography>
                <Typography variant="body2">
                  {formatAbsoluteTime(propertiesData?.createTime)}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.permissions")}
                </Typography>
                <Typography variant="body2">
                  {propertiesData?.permissions ||
                    t("fileManager.propertiesDialog.notAvailable")}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.owner")}
                </Typography>
                <Typography variant="body2">
                  {Number.isFinite(propertiesData?.uid)
                    ? String(propertiesData.uid)
                    : t("fileManager.propertiesDialog.notAvailable")}
                </Typography>

                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.propertiesDialog.group")}
                </Typography>
                <Typography variant="body2">
                  {Number.isFinite(propertiesData?.gid)
                    ? String(propertiesData.gid)
                    : t("fileManager.propertiesDialog.notAvailable")}
                </Typography>
              </Box>
            </DialogContent>
            <DialogActions>
              <Button onClick={handleClosePropertiesDialog} color="primary">
                {t("common.cancel")}
              </Button>
            </DialogActions>
          </Dialog>
        )}

        {showCreateFolderDialog && (
          <Dialog
            open={showCreateFolderDialog}
            onClose={handleCloseCreateFolderDialog}
            maxWidth="xs"
            fullWidth
          >
            <Box component="form" onSubmit={handleCreateFolderSubmit}>
              <DialogTitle>{t("fileManager.createFolder")}</DialogTitle>
              <DialogContent dividers>
                {createFolderDialogError ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {createFolderDialogError}
                  </Alert>
                ) : null}
                <TextField
                  fullWidth
                  label={t("fileManager.createFolder")}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  variant="outlined"
                  size="small"
                />
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                  onClick={handleCloseCreateFolderDialog}
                  color="inherit"
                  size="small"
                  disabled={createFolderSubmitting}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                  disabled={createFolderSubmitting}
                >
                  {t("common.save")}
                </Button>
              </DialogActions>
            </Box>
          </Dialog>
        )}

        {showCreateFileDialog && (
          <Dialog
            open={showCreateFileDialog}
            onClose={handleCloseCreateFileDialog}
            maxWidth="xs"
            fullWidth
          >
            <Box component="form" onSubmit={handleCreateFileSubmit}>
              <DialogTitle>{t("fileManager.createFile")}</DialogTitle>
              <DialogContent dividers>
                {createFileDialogError ? (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {createFileDialogError}
                  </Alert>
                ) : null}
                <TextField
                  fullWidth
                  label={t("fileManager.createFile")}
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  autoFocus
                  variant="outlined"
                  size="small"
                />
              </DialogContent>
              <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button
                  onClick={handleCloseCreateFileDialog}
                  color="inherit"
                  size="small"
                  disabled={createFileSubmitting}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  color="primary"
                  size="small"
                  disabled={createFileSubmitting}
                >
                  {t("common.save")}
                </Button>
              </DialogActions>
            </Box>
          </Dialog>
        )}

        {showPreview && filePreview && (
          <FilePreview
            open={showPreview}
            onClose={handleClosePreview}
            file={filePreview}
            path={currentPath}
            tabId={tabId}
          />
        )}

        <Snackbar
          open={notification !== null}
          autoHideDuration={
            notification?.severity === "error"
              ? null
              : notification?.duration || 3000
          }
          onClose={handleCloseNotification}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          {notification && (
            <Alert
              onClose={handleCloseNotification}
              severity={notification.severity}
              sx={{ width: "100%" }}
              action={
                notification.showAction && notification.actionCallback ? (
                  <Button
                    color="inherit"
                    size="small"
                    onClick={() => {
                      if (typeof notification.actionCallback === "function") {
                        notification.actionCallback();
                      }
                      handleCloseNotification();
                    }}
                  >
                    打开位置
                  </Button>
                ) : null
              }
            >
              {notification.message}
            </Alert>
          )}
        </Snackbar>

        {/* TransferProgressFloat已移至全局底部栏,不再在侧边栏内显示 */}

        <Menu
          open={Boolean(createMenuAnchor)}
          onClose={handleCreateMenuClose}
          anchorEl={createMenuAnchor}
          anchorOrigin={{
            vertical: "bottom",
            horizontal: "left",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: "left",
          }}
        >
          <MenuItem onClick={handleCreateFileFromMenu}>
            <ListItemIcon>
              <NoteAddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.createFile")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleCreateFolderFromMenu}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.createFolder")}</ListItemText>
          </MenuItem>
        </Menu>

        <Menu
          open={Boolean(uploadMenuAnchor)}
          onClose={handleUploadMenuClose}
          anchorEl={uploadMenuAnchor}
          anchorOrigin={{
            vertical: "bottom",
            horizontal: "left",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: "left",
          }}
        >
          <MenuItem onClick={handleUploadFileFromMenu}>
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.uploadFile")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleUploadFolderFromMenu}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.uploadFolder")}</ListItemText>
          </MenuItem>
        </Menu>

        <Menu
          open={Boolean(sortMenuAnchor)}
          onClose={handleSortMenuClose}
          anchorEl={sortMenuAnchor}
          anchorOrigin={{
            vertical: "bottom",
            horizontal: "left",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: "left",
          }}
        >
          <MenuItem
            onClick={() => handleSortModeChange("name")}
            selected={sortMode === "name"}
          >
            <ListItemIcon>
              <SortByAlphaIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.sortByName")}</ListItemText>
          </MenuItem>
          <MenuItem
            onClick={() => handleSortModeChange("time")}
            selected={sortMode === "time"}
          >
            <ListItemIcon>
              <AccessTimeIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.sortByTime")}</ListItemText>
          </MenuItem>
        </Menu>

        {/* 确认对话框 */}
        <Dialog
          open={confirmDialog.open}
          onClose={handleConfirmDialogCancel}
          maxWidth="xs"
          fullWidth
          initialFocusRef={confirmDialogDefaultRef}
          defaultActionRef={confirmDialogDefaultRef}
          slotProps={{
            paper: {
              sx: {
                width: "min(404px, calc(100vw - 32px))",
                maxWidth: "calc(100vw - 32px)",
                maxHeight: "min(390px, calc(100vh - 32px))",
                display: "flex",
                flexDirection: "column",
                borderRadius: 1.5,
                border: `1px solid ${alpha(confirmDialogPalette.main, 0.22)}`,
                bgcolor: "background.paper",
                boxShadow:
                  theme.palette.mode === "dark"
                    ? "0 14px 42px rgba(0, 0, 0, 0.54)"
                    : "0 14px 42px rgba(15, 23, 42, 0.16)",
                overflow: "hidden",
              },
            },
            backdrop: {
              sx: {
                bgcolor: alpha(
                  theme.palette.common.black,
                  theme.palette.mode === "dark" ? 0.58 : 0.32,
                ),
                backdropFilter: "blur(2px)",
              },
            },
          }}
        >
          <DialogTitle
            sx={{
              display: "flex",
              alignItems: "flex-start",
              gap: 1,
              px: 2,
              pt: 1.5,
              pb: 1,
              flexShrink: 0,
            }}
          >
            <Box
              sx={{
                width: 28,
                height: 28,
                flex: "0 0 auto",
                borderRadius: 1,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                color: confirmDialogPalette.main,
                bgcolor: alpha(confirmDialogPalette.main, 0.12),
                border: `1px solid ${alpha(confirmDialogPalette.main, 0.2)}`,
              }}
            >
              <ConfirmDialogIcon fontSize="small" />
            </Box>
            <Typography
              component="span"
              variant="subtitle1"
              sx={{
                minWidth: 0,
                pt: 0.125,
                color: "text.primary",
                fontWeight: 600,
                lineHeight: 1.25,
              }}
            >
              {confirmDialog.title}
            </Typography>
          </DialogTitle>
          <DialogContent
            sx={{
              px: 2,
              pt: 0,
              pb: 1,
              overflowX: "hidden",
              overflowY: "auto",
              flex: "0 1 auto",
            }}
          >
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}
            >
              {confirmDialog.message}
            </Typography>
            {confirmDialogDetailItems.length > 0 ? (
              <Box
                sx={{
                  mt: 1,
                  maxHeight: 124,
                  overflowY: "auto",
                  borderRadius: 1,
                  border: `1px solid ${theme.palette.divider}`,
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.common.white, 0.035)
                      : alpha(theme.palette.common.black, 0.022),
                }}
              >
                {confirmDialogDetailItems.map((item, index) => (
                  <Tooltip
                    key={`${item}-${index}`}
                    title={item}
                    placement="top"
                    disableInteractive
                    enterDelay={500}
                  >
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "auto minmax(0, 1fr)",
                        alignItems: "center",
                        columnGap: 0.75,
                        minHeight: 24,
                        px: 1,
                        py: 0.25,
                        borderTop:
                          index === 0
                            ? "none"
                            : `1px solid ${theme.palette.divider}`,
                      }}
                    >
                      <Box
                        component="span"
                        sx={{
                          width: 4,
                          height: 4,
                          borderRadius: "50%",
                          bgcolor: alpha(confirmDialogPalette.main, 0.68),
                        }}
                      />
                      <Typography
                        component="span"
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{
                          minWidth: 0,
                          lineHeight: 1.35,
                        }}
                      >
                        {item}
                      </Typography>
                    </Box>
                  </Tooltip>
                ))}
                {confirmDialog.detailFooter ? (
                  <Box
                    sx={{
                      px: 1,
                      py: 0.5,
                      borderTop: `1px solid ${theme.palette.divider}`,
                      bgcolor: alpha(confirmDialogPalette.main, 0.06),
                    }}
                  >
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ lineHeight: 1.35 }}
                    >
                      {confirmDialog.detailFooter}
                    </Typography>
                  </Box>
                ) : null}
              </Box>
            ) : confirmDialogDetailText ? (
              <Box
                sx={{
                  mt: 1,
                  maxHeight: 124,
                  overflow: "auto",
                  borderRadius: 1,
                  border: `1px solid ${theme.palette.divider}`,
                  bgcolor:
                    theme.palette.mode === "dark"
                      ? alpha(theme.palette.common.white, 0.035)
                      : alpha(theme.palette.common.black, 0.022),
                  px: 1,
                  py: 0.75,
                }}
              >
                <Typography
                  component="pre"
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    m: 0,
                    fontFamily: "inherit",
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                  }}
                >
                  {confirmDialogDetailText}
                </Typography>
              </Box>
            ) : null}
          </DialogContent>
          <DialogActions
            sx={{
              px: 2,
              py: 1.25,
              gap: 0.75,
              flexShrink: 0,
              borderTop: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Button
              ref={confirmDialogCancelButtonRef}
              onClick={handleConfirmDialogCancel}
              color="inherit"
              variant="outlined"
              size="small"
              sx={{ minWidth: 72 }}
            >
              {confirmDialog.cancelText || t("common.cancel")}
            </Button>
            <Button
              ref={confirmDialogConfirmButtonRef}
              onClick={handleConfirmDialogConfirm}
              variant="contained"
              color={confirmDialogColor}
              size="small"
              sx={{ minWidth: 90 }}
            >
              {confirmDialog.confirmText || t("common.confirm")}
            </Button>
          </DialogActions>
        </Dialog>

        {/* 拖拽覆盖层 */}
        {isDragging && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(25, 118, 210, 0.08)",
              backdropFilter: "blur(2px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1500,
              pointerEvents: "none",
            }}
          >
            <Paper
              elevation={4}
              sx={{
                p: 3,
                backgroundColor: theme.palette.background.paper,
                border: `2px solid ${theme.palette.primary.main}`,
                borderRadius: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
              }}
            >
              <UploadFileIcon
                sx={{
                  fontSize: 48,
                  color: theme.palette.primary.main,
                }}
              />
              <Typography
                variant="h6"
                sx={{
                  color: theme.palette.primary.main,
                  fontWeight: "medium",
                }}
              >
                {t("fileManager.messages.dragDropMessage")}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  color: theme.palette.text.secondary,
                }}
              >
                {selectedFile && selectedFile.isDirectory
                  ? t("fileManager.messages.uploadToFolder", {
                      folder: selectedFile.name,
                    })
                  : t("fileManager.messages.uploadToCurrentFolder") +
                    `: ${currentPath}`}
              </Typography>
            </Paper>
          </Box>
        )}
      </Paper>
    );
  },
);

FileManager.displayName = "FileManager";

export default FileManager;
