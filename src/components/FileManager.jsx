import React, {
  useState,
  useEffect,
  memo,
  useCallback,
  useMemo,
  useRef,
} from "react";
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
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { FileManagerSkeleton } from "./SkeletonLoader.jsx";
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
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import LinkIcon from "@mui/icons-material/Link";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import LockIcon from "@mui/icons-material/Lock";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import FilePreview from "./FilePreview.jsx";
import TransferProgressFloat from "./TransferProgressFloat.jsx";
import FilePermissionEditor from "./FilePermissionEditor.jsx";
import {
  List,
  ListItem,
  ListItemButton,
} from "@mui/material";
import { InsertDriveFile as InsertDriveFileIcon } from "@mui/icons-material";
import { formatLastRefreshTime } from "../core/utils/formatters.js";
import { debounce } from "../core/utils/performance.js";
import { useTranslation } from "react-i18next";
import { useSftpTransfers } from "../store/sftpTransferStore.js";

// 格式化文件大小
const formatFileSize = (bytes, t) => {
  if (bytes === 0) return `0 ${t("fileManager.units.bytes")}`;
  const k = 1024;
  const sizes = [
    t("fileManager.units.bytes"),
    t("fileManager.units.kb"),
    t("fileManager.units.mb"),
    t("fileManager.units.gb"),
    t("fileManager.units.tb"),
  ];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const FileManager = memo(
  ({
    open,
    onClose,
    sshConnection,
    tabId,
    tabName,
    initialPath = "/",
    onPathChange,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const [currentPath, setCurrentPath] = useState("/");
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastRefreshTime, setLastRefreshTime] = useState(null);
    const directoryCacheRef = useRef(new Map());
    const [contextMenu, setContextMenu] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const searchInputRef = useRef(null);
    const [showSearch, setShowSearch] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState([]); // 多选文件列表
    const [lastSelectedIndex, setLastSelectedIndex] = useState(-1); // 用于Shift范围选择
    const [anchorIndex, setAnchorIndex] = useState(-1); // Shift选择的锚点索引
    const [showRenameDialog, setShowRenameDialog] = useState(false);
    const [newName, setNewName] = useState("");
    const [blankContextMenu, setBlankContextMenu] = useState(null);
    const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
    const [newFolderName, setNewFolderName] = useState("");
    const [showCreateFileDialog, setShowCreateFileDialog] = useState(false);
    const [newFileName, setNewFileName] = useState("");
    const [filePreview, setFilePreview] = useState(null);
    const [showPreview, setShowPreview] = useState(false);
    const [pathInput, setPathInput] = useState("");
    const [transferCancelled, setTransferCancelled] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [notification, setNotification] = useState(null);
    const [uploadMenuAnchor, setUploadMenuAnchor] = useState(null);
    const [externalEditorEnabled, setExternalEditorEnabled] = useState(false);
    const [sortMode, setSortMode] = useState("name"); // "name" or "time"
    const [sortMenuAnchor, setSortMenuAnchor] = useState(null);
    const [pathHistory, setPathHistory] = useState([]); // 路径历史记录
    const [historyIndex, setHistoryIndex] = useState(-1); // 当前在历史记录中的位置
    const [isDragging, setIsDragging] = useState(false); // 拖拽状态
    const [dragCounter, setDragCounter] = useState(0); // 拖拽计数器，用于处理子元素的dragenter/dragleave

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

    const clearSelection = useCallback(() => {
      setSelectedFiles([]);
      setSelectedFile(null);
      setLastSelectedIndex(-1);
      setAnchorIndex(-1);
    }, []);

    // 用于存储延迟移除定时器的引用

    // 拖拽事件处理函数
    // 增量加载优化：状态与缓冲
    const [isChunking, setIsChunking] = useState(false);
    const chunkBufferRef = useRef([]);
    const flushTimerRef = useRef(null);
    const filesRef = useRef(files);
    useEffect(() => {
      filesRef.current = files;
    }, [files]);
    const externalEditorEventThrottles = useRef(new Map());

    // Fallback: 自动结束增量状态的定时器
    const chunkingResetTimerRef = useRef(null);
    const scheduleChunkingReset = useCallback(() => {
      try {
        if (chunkingResetTimerRef.current)
          clearTimeout(chunkingResetTimerRef.current);
      } catch (_) {}
      chunkingResetTimerRef.current = setTimeout(() => {
        setIsChunking(false);
      }, 800);
    }, []);
    useEffect(
      () => () => {
        try {
          if (chunkingResetTimerRef.current)
            clearTimeout(chunkingResetTimerRef.current);
        } catch (_) {}
      },
      [],
    );

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

    // 键盘快捷键处理
    useEffect(() => {
      const handleKeyDown = (e) => {
        // 只在文件管理器打开时处理快捷键
        if (!open || showPreview) return;

        const targetElement = e.target || document.activeElement;
        if (
          targetElement &&
          typeof targetElement.closest === "function" &&
          targetElement.closest('[data-file-preview-dialog=\"true\"]')
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

        // Ctrl+/ 聚焦到搜索框
        if (e.ctrlKey && e.key === "/") {
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
        } catch (error) {
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
      // eslint-disable-next-line consistent-return
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
      removeTransferProgress: storeRemoveTransferProgress,
      clearCompletedTransfers: storeClearCompletedTransfers,
      clearAllTransfers: storeClearAllTransfers,
      scheduleTransferCleanup: storeScheduleTransferCleanup,
    } = useSftpTransfers(tabId);

    const transferProgressList = transferList;

    // 缓存过期时间（毫秒）
    const CACHE_EXPIRY_TIME = 10000; // 10秒

    // 自动刷新相关参数
    const USER_ACTIVITY_REFRESH_DELAY = 300; // 将用户活动后刷新延迟从1000ms减少到300ms

    // 传输进度管理函数
    // 添加新的传输任务
    const addTransferProgress = (transferData) => {
      return storeAddTransferProgress(transferData);
    };

    // 更新传输进度
    const updateTransferProgress = (transferId, updateData) => {
      storeUpdateTransferProgress(transferId, updateData);
    };

    // 移除传输任务
    const removeTransferProgress = (transferId) => {
      storeRemoveTransferProgress(transferId);
    };

    // 清理已完成的传输任务
    const clearCompletedTransfers = () => {
      storeClearCompletedTransfers();
    };

    // 清理所有传输任务
    const clearAllTransfers = () => {
      storeClearAllTransfers();
    };

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
      setCurrentPath(newPath);
      if (onPathChange && tabId) {
        onPathChange(tabId, newPath);
      }

      // 只有在非历史导航时才添加到历史记录
      if (!isHistoryNavigation) {
        addToHistory(newPath);
      }
    };

    // 当SSH连接改变时，重置状态并加载目录
    useEffect(() => {
      if (open && sshConnection && tabId) {
        // 先检查API是否可用
        if (!window.terminalAPI || !window.terminalAPI.listFiles) {
          setError(t("fileManager.errors.fileApiNotAvailable"));
          return;
        }

        // 清空缓存
        directoryCacheRef.current.clear();

        // 使用记忆的路径或默认路径
        const pathToLoad = initialPath || "/";
        updateCurrentPath(pathToLoad);
        setPathInput(pathToLoad);
        loadDirectory(pathToLoad);
      }
    }, [open, sshConnection, tabId, initialPath]);

    // 从缓存中获取目录内容
    // 增量目录加载 token（listFiles 首批响应返回）
    const [listToken, setListToken] = useState(null);

    const getDirectoryFromCache = (path) => {
      // 优先使用全局缓存（跨次打开可复用）
      try {
        const globalCached = dirCache.get(tabId, path, CACHE_EXPIRY_TIME);
        if (globalCached) return globalCached;
      } catch (_) {}
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
      // 写入全局缓存
      try {
        dirCache.set(tabId, path, data);
      } catch (_) {}
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
          if (!open) return;
          const apiPath = currentPath === "~" ? "" : currentPath;
          if (
            !payload ||
            payload.tabId !== tabId ||
            payload.path !== apiPath ||
            !payload.token ||
            payload.token !== listToken
          ) {
            return;
          }

          if (Array.isArray(payload.items) && payload.items.length > 0) {
            setIsChunking(true);
            if (typeof scheduleChunkingReset === "function")
              scheduleChunkingReset();
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
            } catch (_) {
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
            updateDirectoryCache(currentPath, filesRef.current || []);
            setListToken(null);
            setIsChunking(false);
          }

          if (payload.done) {
            // 完成后，刷新缓存
            updateDirectoryCache(
              currentPath,
              (files || []).concat(payload.items || []),
            );
          }
        } catch (_) {
          // ignore
        }
      });

      return () => {
        if (typeof unsubscribe === "function") unsubscribe();
      };
    }, [tabId, currentPath, listToken, open]);

    // 静默刷新当前目录（不显示加载指示器）
    const silentRefreshCurrentDirectory = async () => {
      // 若侧边栏未打开或缺少必要信息则跳过
      if (!open || !sshConnection || !tabId || !currentPath) return;
      // 若正在进行显式加载，避免并发触发静默刷新
      if (loading) return;
      // 避免在一次完整刷新刚完成后立即再次刷新，减少竞态
      try {
        if (lastRefreshTime && Date.now() - lastRefreshTime < 700) {
          return;
        }
      } catch (_) {}

      try {
        if (window.terminalAPI && window.terminalAPI.listFiles) {
          // 将~转换为空字符串，用于API调用
          const apiPath = currentPath === "~" ? "" : currentPath;

          // 使用可合并的目录读取操作
          const options = {
            type: "readdir",
            path: apiPath,
            canMerge: true,
            priority: "low", // 使用低优先级，避免阻塞用户主动操作
            nonBlocking: true, // 添加非阻塞标志，确保不会阻塞UI
          };

          // 使用Promise.race和超时保证即使API响应慢也不会阻塞UI
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error(t("fileManager.errors.refreshTimeout"))),
              3000,
            ),
          );

          try {
            const response = await Promise.race([
              window.terminalAPI.listFiles(tabId, apiPath, options),
              timeoutPromise,
            ]);

            if (response?.success) {
              const fileData = response.data || [];
              if (response.chunked && response.token) {
                setListToken(response.token);
                setIsChunking(true);
                scheduleChunkingReset();
              } else {
                setListToken(null);
                setIsChunking(false);
              }

              // 检查数据是否有变化
              const currentFiles = JSON.stringify(files);
              const newFiles = JSON.stringify(fileData);

              if (currentFiles !== newFiles) {
                // 更新缓存
                updateDirectoryCache(currentPath, fileData);
                // 更新视图
                setFiles(fileData);
                // 加载新目录时重置选中文件
                setSelectedFile(null);
                setSelectedFiles([]);
                setLastSelectedIndex(-1);
                setAnchorIndex(-1);
              }

              // 记录刷新时间
              setLastRefreshTime(Date.now());
            } else {
              // 静默刷新失败不显示错误，只记录日志
            }
          } catch (error) {
            // 超时或其他错误，静默处理
            // 避免在UI上显示错误信息
          }
        }
      } catch (error) {
        // 静默刷新失败不显示错误，只记录日志
      }
    };

    // 添加路径到历史记录
    const addToHistory = (path) => {
      setPathHistory((prev) => {
        // 如果当前不在历史记录的末尾，删除后面的记录
        const newHistory =
          historyIndex >= 0 ? prev.slice(0, historyIndex + 1) : [];

        // 避免连续重复的路径
        if (
          newHistory.length === 0 ||
          newHistory[newHistory.length - 1] !== path
        ) {
          newHistory.push(path);
        }

        // 限制历史记录长度为50
        if (newHistory.length > 50) {
          newHistory.shift();
        }

        return newHistory;
      });

      setHistoryIndex((prev) => {
        const newHistory = pathHistory.slice(0, historyIndex + 1);
        if (
          newHistory.length === 0 ||
          newHistory[newHistory.length - 1] !== path
        ) {
          return newHistory.length;
        }
        return prev;
      });
    };

    // 返回先前路径
    const handleGoToPreviousPath = () => {
      if (historyIndex > 0) {
        const previousPath = pathHistory[historyIndex - 1];
        setHistoryIndex(historyIndex - 1);
        loadDirectory(previousPath, 0, false, true); // 最后一个参数表示是历史导航
      }
    };

    // 前进到下一个路径
    const handleGoToNextPath = () => {
      if (historyIndex < pathHistory.length - 1) {
        const nextPath = pathHistory[historyIndex + 1];
        setHistoryIndex(historyIndex + 1);
        loadDirectory(nextPath, 0, false, true); // 最后一个参数表示是历史导航
      }
    };

    // 修改loadDirectory，添加刷新时间记录
    const loadDirectory = async (
      path,
      retryCount = 0,
      forceRefresh = false,
      isHistoryNavigation = false,
    ) => {
      if (!sshConnection || !tabId) {
        setError(t("fileManager.errors.missingConnectionInfo"));
        return;
      }

      // 如果不是强制刷新，尝试从缓存获取数据
      if (!forceRefresh) {
        const cachedData = getDirectoryFromCache(path);
        if (cachedData) {
          setFiles(cachedData);
          updateCurrentPath(path, isHistoryNavigation);
          setPathInput(path);
          // 加载新目录时重置选中文件
          setSelectedFile(null);
          return;
        }
      }

      setLoading(true);
      setError(null);

      try {
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

          if (response?.success) {
            const fileData = response.data || [];
            if (response.chunked && response.token) {
              setListToken(response.token);
              setIsChunking(true);
              scheduleChunkingReset();
            } else {
              setListToken(null);
              setIsChunking(false);
            }

            // 更新缓存
            updateDirectoryCache(path, fileData);

            setFiles(fileData);
            updateCurrentPath(path, isHistoryNavigation); // 保持UI中显示~
            setPathInput(path);
            // 加载新目录时重置选中文件
            setSelectedFile(null);
            setSelectedFiles([]);
            setLastSelectedIndex(-1);
            setAnchorIndex(-1);

            // 记录刷新时间
            setLastRefreshTime(Date.now());
          } else {
            // 处理错误，检查是否需要重试
            if (
              response?.error?.includes("SFTP错误") ||
              response?.error?.includes("Channel open failure") ||
              response?.error?.includes("SSH连接尚未就绪") ||
              response?.error?.includes("ECONNRESET")
            ) {
              // 如果是SFTP通道错误或SSH连接未就绪，且重试次数未达到上限，则进行重试
              if (retryCount < 5) {
                // 增加重试等待时间，指数退避算法
                const waitTime = Math.min(
                  500 * Math.pow(1.5, retryCount),
                  5000,
                ); // 最长等待5秒

                setError(
                  t("fileManager.messages.retrying", {
                    current: retryCount + 1,
                    max: 5,
                  }),
                );

                // 添加延迟，避免立即重试
                setTimeout(() => {
                  loadDirectory(path, retryCount + 1, forceRefresh);
                }, waitTime);
                return;
              }
            }

            // 重试失败或其他错误
            setError(
              response?.error || t("fileManager.errors.loadDirectoryFailed"),
            );
          }
        } else {
          setError(t("fileManager.errors.fileApiNotAvailable"));
        }
      } catch (error) {
        // 加载目录失败

        // 如果是异常错误且重试次数未达到上限，则进行重试
        if (retryCount < 5) {
          // 增加重试等待时间，指数退避算法
          const waitTime = Math.min(500 * Math.pow(1.5, retryCount), 5000); // 最长等待5秒

          setError(
            t("fileManager.messages.retrying", {
              current: retryCount + 1,
              max: 5,
            }),
          );

          // 添加延迟，避免立即重试
          setTimeout(() => {
            loadDirectory(path, retryCount + 1, forceRefresh);
          }, waitTime);
          return;
        }

        setError(
          t("fileManager.errors.loadDirectoryFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        );
      } finally {
        if (retryCount === 0 || retryCount >= 5) {
          // 更新重试次数
          // 只有在初始尝试或重试结束后才设置loading为false
          setLoading(false);
        }
      }
    };

    // 刷新目录（强制从服务器重新加载）
    const refreshDirectory = (path) => {
      loadDirectory(path, 0, true);
    };

    // 节流函数，用于限制连续的目录加载操作
    const throttleLoadDirectory = (() => {
      let lastExecution = 0;
      let timeoutId = null;

      return (path, forceRefresh = false) => {
        const now = Date.now();
        const timeSinceLastCall = now - lastExecution;

        // 如果上次调用在300ms内，则防止立即执行
        if (timeSinceLastCall < 300) {
          // 取消之前的定时器
          if (timeoutId) {
            clearTimeout(timeoutId);
          }

          // 安排新的定时器
          timeoutId = setTimeout(() => {
            lastExecution = Date.now();
            loadDirectory(path, 0, forceRefresh);
          }, 300 - timeSinceLastCall);
        } else {
          // 如果距离上次调用超过300ms，则立即执行
          lastExecution = now;
          loadDirectory(path, 0, forceRefresh);
        }
      };
    })();

    // 进入目录
    const handleEnterDirectory = (path) => {
      throttleLoadDirectory(path);
    };

    // 返回上级目录
    const handleGoBack = () => {
      // 如果当前在家目录，返回到根目录
      if (currentPath === "~") {
        throttleLoadDirectory("/");
        return;
      }

      // 如果当前路径为空或根目录，不执行任何操作
      if (!currentPath || currentPath === "/") return;

      const lastSlashIndex = currentPath.lastIndexOf("/");
      let parentPath = "";

      if (lastSlashIndex > 0) {
        parentPath = currentPath.substring(0, lastSlashIndex);
      } else {
        // 如果没有找到斜杠，或斜杠在开头位置，返回根目录
        parentPath = "/";
      }

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
    const toggleSearch = () => {
      setShowSearch(!showSearch);
      if (showSearch) {
        setSearchTerm("");
      }
    };

    // 多选文件管理函数
    const isFileSelected = useCallback(
      (file) => {
        return selectedFiles.some(
          (selectedFile) =>
            selectedFile.name === file.name &&
            selectedFile.modifyTime === file.modifyTime,
        );
      },
      [selectedFiles],
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

    // 过滤和排序文件列表（根据搜索词） - 优化版本，使用useMemo缓存

    // 搜索过滤

    // 排序：按名称时目录在前，按时间时不区分文件类型

    // 按时间排序（最新的在前），不区分文件夹和文件

    // 按名称排序时，目录在前

    const handleFileSelect = useCallback(
      (file, index, event) => {
        // 只在需要时阻止默认行为
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
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
            rangeFiles.forEach(rangeFile => {
              // 只添加未选中的文件
              if (!newSelection.some(f =>
                f.name === rangeFile.name && f.modifyTime === rangeFile.modifyTime
              )) {
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

    // 处理批量操作确认
    const handleBatchOperationConfirm = useCallback((operation, files) => {
      const fileCount = files.length;
      const fileList = files.map((f) => f.name).join(", ");
      const message = `确认${operation} ${fileCount} 个文件？\n${fileList}`;
      return window.confirm(message);
    }, []);

    // 处理右键菜单
    const handleContextMenu = (event, file, index) => {
      event.preventDefault();

      // 如果右键点击的文件没有被选中，则单选该文件
      if (!isFileSelected(file)) {
        setSelectedFiles([file]);
        setSelectedFile(file);
        setLastSelectedIndex(index);
      }

      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    };

    // 关闭右键菜单
    const handleContextMenuClose = () => {
      setContextMenu(null);
    };

    // 用户活动后的刷新函数，使用防抖优化
    const refreshAfterUserActivity = useMemo(
      () =>
        debounce(() => {
          if (currentPath) {
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
      } catch (e) {
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
          if ((ownerChanged || groupChanged) && window.terminalAPI?.setFileOwnership) {
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
              await loadDirectory(currentPath);
              refreshAfterUserActivity();
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
        refreshAfterUserActivity,
        t,
      ],
    );

    // 处理批量删除
    const handleBatchDelete = async () => {
      const filesToDelete = getSelectedFiles();
      if (filesToDelete.length === 0) return;

      if (
        !handleBatchOperationConfirm(t("fileManager.delete"), filesToDelete)
      ) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        for (const file of filesToDelete) {
          const fullPath =
            currentPath === "/"
              ? "/" + file.name
              : currentPath
                ? currentPath + "/" + file.name
                : file.name;

          if (window.terminalAPI && window.terminalAPI.deleteFile) {
            const response = await window.terminalAPI.deleteFile(
              tabId,
              fullPath,
              file.isDirectory,
            );

            if (!response?.success) {
              setError(
                `${t("fileManager.errors.deleteFailed")} ${file.name}: ${response?.error || t("fileManager.errors.unknownError")}`,
              );
              break;
            }
          }
        }

        // 清除选择状态
        setSelectedFile(null);
        setSelectedFiles([]);
        setLastSelectedIndex(-1);
        setAnchorIndex(-1);

        // 刷新目录
        await loadDirectory(currentPath);
        refreshAfterUserActivity();
      } catch (error) {
        setError(
          t("fileManager.errors.deleteFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        );
      } finally {
        setLoading(false);
        handleContextMenuClose();
      }
    };

    // 处理删除
    const handleDelete = async () => {
      const filesToDelete = getSelectedFiles();
      if (filesToDelete.length === 0) return;

      if (filesToDelete.length > 1) {
        return handleBatchDelete();
      }

      const fileToDelete = filesToDelete[0];

      // 创建一个标识符，用于跟踪当前的删除操作
      const deleteOperationId = Date.now();

      setLoading(true);
      setError(null);
      let retryCount = 0;
      const maxRetries = 3;

      const attemptDelete = async () => {
        try {
          const fullPath =
            currentPath === "/"
              ? "/" + fileToDelete.name
              : currentPath
                ? currentPath + "/" + fileToDelete.name
                : fileToDelete.name;

          if (window.terminalAPI && window.terminalAPI.deleteFile) {
            const response = await window.terminalAPI.deleteFile(
              tabId,
              fullPath,
              fileToDelete.isDirectory,
            );

            if (response?.success) {
              // 成功删除后立即重置选中文件，避免使用已删除的文件夹作为上传目标
              setSelectedFile(null);
              setSelectedFiles([]);
              setLastSelectedIndex(-1);
              setAnchorIndex(-1);

              // 成功删除，刷新目录
              await loadDirectory(currentPath);

              // 删除操作完成后，必要时触发一次静默刷新以校验目录
              try {
                if (!lastRefreshTime || Date.now() - lastRefreshTime > 700) {
                  refreshAfterUserActivity();
                }
              } catch (_) {
                // 兜底触发
                refreshAfterUserActivity();
              }
            } else if (
              response?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              // SFTP错误，尝试重试
              retryCount++;
              setError(
                t("fileManager.messages.retrying", {
                  current: retryCount,
                  max: maxRetries,
                }),
              );

              // 添加延迟后重试
              setTimeout(attemptDelete, 500 * retryCount);
              return;
            } else {
              // 其他错误或已达到最大重试次数
              setError(response?.error || t("fileManager.errors.deleteFailed"));
              // 即使删除失败也重置选中文件状态
              setSelectedFile(null);
              setSelectedFiles([]);
              setLastSelectedIndex(-1);
              setAnchorIndex(-1);
            }
          }
        } catch (error) {
          // 删除文件失败

          if (retryCount < maxRetries) {
            // 发生异常，尝试重试
            retryCount++;
            setError(
              t("fileManager.messages.retrying", {
                current: retryCount,
                max: maxRetries,
              }),
            );

            // 添加延迟后重试
            setTimeout(attemptDelete, 500 * retryCount);
            return;
          }

          setError(
            t("fileManager.errors.deleteFailed") +
              ": " +
              (error.message || t("fileManager.errors.unknownError")),
          );
          // 即使删除失败也重置选中文件状态
          setSelectedFile(null);
          setSelectedFiles([]);
          setLastSelectedIndex(-1);
          setAnchorIndex(-1);
        } finally {
          if (retryCount === 0 || retryCount >= maxRetries) {
            // 确保无论成功失败都重置loading状态
            setLoading(false);
            handleContextMenuClose();

            // 确保状态完全重置，允许新的删除操作
            setTimeout(() => {
              // 这个空的setTimeout确保状态更新在UI渲染循环中完成
            }, 10);
          }
        }
      };

      attemptDelete();
    };

    // 处理上传文件到当前目录
    const handleUploadFile = async () => {
      handleContextMenuClose();
      handleBlankContextMenuClose();

      if (!sshConnection) return;

      setTransferCancelled(false);

      // 保存当前路径状态
      const savedCurrentPath = currentPath;
      const savedSelectedFile = selectedFile;

      try {
        let targetPath;
        // 使用保存的状态而非实时状态
        if (savedSelectedFile && savedSelectedFile.isDirectory) {
          if (savedCurrentPath === "/") {
            targetPath = "/" + savedSelectedFile.name;
          } else if (savedCurrentPath === "~") {
            targetPath = "~/" + savedSelectedFile.name;
          } else {
            targetPath = savedCurrentPath + "/" + savedSelectedFile.name;
          }
        } else {
          targetPath = savedCurrentPath;
        }

        if (window.terminalAPI && window.terminalAPI.uploadFile) {
          // 创建新的传输任务
          const transferId = addTransferProgress({
            type: "upload-multifile", // Always use upload-multifile for file uploads
            progress: 0,
            fileName: t("fileManager.messages.preparingUpload"),
            transferredBytes: 0,
            totalBytes: 0,
            transferSpeed: 0,
            remainingTime: 0,
            currentFileIndex: 0,
            totalFiles: 1,
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
              totalFiles,
              transferKey,
            ) => {
              // 验证并标准化进度数据
              const validProgress = Math.max(0, Math.min(100, progress || 0));
              const validTransferredBytes = Math.max(0, transferredBytes || 0);
              const validTotalBytes = Math.max(0, totalBytes || 0);
              const validTransferSpeed = Math.max(0, transferSpeed || 0);
              const validRemainingTime = Math.max(0, remainingTime || 0);
              const validCurrentFileIndex = Math.max(0, currentFileIndex || 0);
              const validTotalFiles = Math.max(0, totalFiles || 0);

              updateTransferProgress(transferId, {
                progress: validProgress,
                fileName: fileName || "",
                transferredBytes: validTransferredBytes,
                totalBytes: validTotalBytes,
                transferSpeed: validTransferSpeed,
                remainingTime: validRemainingTime,
                currentFileIndex: validCurrentFileIndex,
                totalFiles: validTotalFiles,
                transferKey: transferKey || "",
              });
            },
          );

          if (result?.success) {
            // 标记传输完成
            updateTransferProgress(transferId, {
              progress: 100,
              fileName:
                result.message || t("fileManager.messages.uploadComplete"),
            });

            // 传输完成后延迟移除
            storeScheduleTransferCleanup(transferId, 3000);

            // 切换到上传的目标路径
            updateCurrentPath(targetPath);
            setPathInput(targetPath);
            loadDirectory(targetPath, 0, true); // 强制刷新目标目录

            // 如果有警告信息（部分文件上传失败），显示给用户
            if (result.partialSuccess && result.warning) {
              setError(result.warning);
            }

            // 检查是否是用户取消操作
            if (isUserCancellationError(result)) {
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
            }
          } else if (!transferCancelled) {
            // 检查是否是取消操作相关的错误
            if (!isUserCancellationError(result)) {
              // 只有在不是用户主动取消的情况下才显示错误
              setError(result.error || t("fileManager.errors.uploadFailed"));
              updateTransferProgress(transferId, {
                error: result.error || t("fileManager.errors.uploadFailed"),
              });
            } else {
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
            }
          }

          // 无论上传结果如何，必要时刷新文件列表，避免与显式刷新竞态
          try {
            if (!lastRefreshTime || Date.now() - lastRefreshTime > 700) {
              refreshAfterUserActivity();
            }
          } catch (_) {
            refreshAfterUserActivity();
          }
        }
      } catch (error) {
        // 上传文件失败

        // 只有在不是用户主动取消的情况下才显示错误
        if (
          !transferCancelled &&
          !isUserCancellationError(error) &&
          !error.message?.includes("reply was never sent")
        ) {
          setError(
            t("fileManager.errors.uploadFailed") +
              ": " +
              (error.message || t("fileManager.errors.unknownError")),
          );
          // 更新所有未完成的传输为错误状态
          const errorMessage =
            error.message || t("fileManager.errors.unknownError");
          transferProgressList
            .filter(
              (transfer) =>
                transfer.progress < 100 && !transfer.isCancelled,
            )
            .forEach((transfer) => {
              updateTransferProgress(transfer.transferId, {
                error: errorMessage,
              });
            });
        } else {
          setTransferCancelled(true);
          // 标记所有未完成的传输为取消状态
          transferProgressList
            .filter(
              (transfer) =>
                transfer.progress < 100 && !transfer.isCancelled,
            )
            .forEach((transfer) => {
              updateTransferProgress(transfer.transferId, {
                isCancelled: true,
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
            });
        }

        // 无论上传结果如何，必要时刷新文件列表，避免与显式刷新竞态
        try {
          if (!lastRefreshTime || Date.now() - lastRefreshTime > 700) {
            refreshAfterUserActivity();
          }
        } catch (_) {
          refreshAfterUserActivity();
        }
      }
    };

    // 处理上传文件夹到当前目录
    const handleUploadFolder = async () => {
      handleContextMenuClose();
      handleBlankContextMenuClose();

      if (!sshConnection) return;

      setTransferCancelled(false);

      // 保存当前路径状态
      const savedCurrentPath = currentPath;
      const savedSelectedFile = selectedFile;

      try {
        let targetPath;
        // 使用保存的状态而非实时状态
        if (savedSelectedFile && savedSelectedFile.isDirectory) {
          if (savedCurrentPath === "/") {
            targetPath = "/" + savedSelectedFile.name;
          } else if (savedCurrentPath === "~") {
            targetPath = "~/" + savedSelectedFile.name;
          } else {
            targetPath = savedCurrentPath + "/" + savedSelectedFile.name;
          }
        } else {
          targetPath = savedCurrentPath;
        }

        if (window.terminalAPI && window.terminalAPI.uploadFolder) {
          // 创建新的文件夹传输任务
          const transferId = addTransferProgress({
            type: "upload-folder",
            progress: 0,
            fileName: t("fileManager.messages.preparingUpload"),
            currentFile: "",
            transferredBytes: 0,
            totalBytes: 0,
            transferSpeed: 0,
            remainingTime: 0,
            processedFiles: 0,
            totalFiles: 0,
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
            ) => {
              // 验证并标准化进度数据
              const validProgress = Math.max(0, Math.min(100, progress || 0));
              const validTransferredBytes = Math.max(0, transferredBytes || 0);
              const validTotalBytes = Math.max(0, totalBytes || 0);
              const validTransferSpeed = Math.max(0, transferSpeed || 0);
              const validRemainingTime = Math.max(0, remainingTime || 0);
              const validProcessedFiles = Math.max(0, processedFiles || 0);
              const validTotalFiles = Math.max(0, totalFiles || 0);

              updateTransferProgress(transferId, {
                progress: validProgress,
                fileName: fileName || "",
                currentFile: currentFile || "",
                transferredBytes: validTransferredBytes,
                totalBytes: validTotalBytes,
                transferSpeed: validTransferSpeed,
                remainingTime: validRemainingTime,
                processedFiles: validProcessedFiles,
                totalFiles: validTotalFiles,
                transferKey: transferKey || "", // 添加transferKey到状态
              });
            },
          );

          if (result?.success) {
            // 标记传输完成
            updateTransferProgress(transferId, {
              progress: 100,
              fileName: result.message || "文件夹上传完成",
            });

            // 传输完成后延迟移除
            storeScheduleTransferCleanup(transferId, 3000);

            // 切换到上传的目标路径
            updateCurrentPath(targetPath);
            setPathInput(targetPath);
            loadDirectory(targetPath, 0, true); // 强制刷新目标目录

            // 如果有警告信息（部分文件上传失败），显示给用户
            if (result.partialSuccess && result.warning) {
              setError(result.warning);
            }

            // 检查是否是用户取消操作
            if (isUserCancellationError(result)) {
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
            }
          } else if (!transferCancelled) {
            // 检查是否是取消操作相关的错误
            if (!isUserCancellationError(result)) {
              // 只有在不是用户主动取消的情况下才显示错误
              setError(result.error || t("fileManager.errors.uploadFailed"));
              updateTransferProgress(transferId, {
                error: result.error || t("fileManager.errors.uploadFailed"),
              });
            } else {
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: t("fileManager.errors.userCancelled"),
              });
            }
          }

          // 无论上传结果如何，都刷新文件列表
          refreshAfterUserActivity();
        }
      } catch (error) {
        // t("fileManager.errors.uploadFailed")

        // 只有在不是用户主动取消的情况下才显示错误
        if (
          !transferCancelled &&
          !isUserCancellationError(error) &&
          !error.message?.includes("reply was never sent")
        ) {
          setError(
            t("fileManager.errors.uploadFailed") +
              ": " +
              (error.message || t("fileManager.errors.unknownError")),
          );
        } else {
          setTransferCancelled(true);
        }

        // 无论上传结果如何，都刷新文件列表
        refreshAfterUserActivity();
      }
    };

    // 复制绝对路径
    const handleCopyAbsolutePath = async () => {
      if (!selectedFile) return;

      try {
        const relativePath =
          currentPath === "/"
            ? "/" + selectedFile.name
            : currentPath
              ? currentPath + "/" + selectedFile.name
              : selectedFile.name;

        if (window.terminalAPI && window.terminalAPI.getAbsolutePath) {
          const response = await window.terminalAPI.getAbsolutePath(
            tabId,
            relativePath,
          );
          if (response?.success && response.path) {
            // 使用navigator.clipboard API复制到剪贴板
            await navigator.clipboard.writeText(response.path);
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

      // 渲染简单文件列表（替代虚拟化列表）
      if (!displayFiles || displayFiles.length === 0) {
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

      return (
        <Box
          sx={{
            height: "100%",
            width: "100%",
            overflow: "auto",
            "&::-webkit-scrollbar": {
              width: 8,
            },
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
          onContextMenu={handleBlankContextMenu}
          onClick={handleBlankClick}
        >
          <List dense disablePadding sx={{ py: 0 }}>
            {displayFiles.map((file, index) => {
              const isSelected = isFileSelected
                ? isFileSelected(file)
                : selectedFiles.some(
                    (f) =>
                      f.name === file.name && f.modifyTime === file.modifyTime
                  );

              const formattedDate = file?.modifyTime
                ? formatDate(new Date(file.modifyTime))
                : "";
              const formattedSize =
                file?.size && !file?.isDirectory
                  ? formatFileSize(file.size, t)
                  : "";
              const secondaryText = [formattedDate, formattedSize]
                .filter(Boolean)
                .join(" · ");

              return (
                <ListItem
                  key={`${file.name}-${index}`}
                  disablePadding
                  disableGutters
                  onContextMenu={(e) => handleContextMenu(e, file, index)}
                  sx={{
                    py: 0,
                    my: 0,
                    minHeight: 28,
                    height: 28,
                    '&:not(:last-child)': {
                      mb: 0.25,
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
                      minHeight: 28,
                      height: 28,
                      px: 1.25,
                      py: 0.25,
                      borderRadius: 0.5,
                      transition: "all 0.1s ease-in-out",
                      userSelect: 'none', // 禁用文本选择
                      cursor: 'pointer',
                      '&.Mui-selected': {
                        backgroundColor: theme.palette.action.selected,
                        '&:hover': {
                          backgroundColor: theme.palette.action.hover,
                        },
                      },
                      '&:hover': {
                        backgroundColor: theme.palette.action.hover,
                      },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 20, mr: 0.5 }}>
                      {file.isDirectory ? (
                        <FolderIcon color="primary" sx={{ fontSize: 18 }} />
                      ) : (
                        <InsertDriveFileIcon sx={{ fontSize: 18 }} />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      primary={file.name || ""}
                      secondary={secondaryText}
                      sx={{
                        my: 0,
                        "& .MuiListItemText-primary": {
                          fontSize: "0.8125rem",
                          lineHeight: 1.05,
                          marginBottom: "1px",
                        },
                        "& .MuiListItemText-secondary": {
                          fontSize: "0.6875rem",
                          lineHeight: 0.95,
                          marginTop: 0,
                        },
                      }}
                      primaryTypographyProps={{
                        variant: "body2",
                        noWrap: true,
                      }}
                      secondaryTypographyProps={{
                        variant: "caption",
                        color: "text.secondary",
                        noWrap: true,
                      }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        </Box>
      );
    };

    // 格式化日期函数
    const formatDate = (date) => {
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
    const handleCancelTransfer = async (transferId) => {
      if (!window.terminalAPI) {
        return;
      }

      // 如果没有提供transferId，取消所有活跃传输
      const transfersToCancel = transferId
        ? transferProgressList.filter((t) => t.transferId === transferId)
        : transferProgressList.filter(
            (t) => t.progress < 100 && !t.isCancelled && !t.error,
          );

      if (transfersToCancel.length === 0) {
        return;
      }

      try {
        // 标记传输已取消，用于避免显示错误消息
        setTransferCancelled(true);

        for (const transfer of transfersToCancel) {
          const transferKey = transfer.transferKey;

          // 显示取消中状态
          updateTransferProgress(transfer.transferId, {
            cancelInProgress: true,
            cancelMessage: "正在取消传输...",
          });

          // 调用取消API传递transferKey
          if (window.terminalAPI.cancelTransfer && transferKey) {
            try {
              const result = await window.terminalAPI.cancelTransfer(
                tabId,
                transferKey,
              );

              if (result.success) {
                // 更新UI以显示已取消
                updateTransferProgress(transfer.transferId, {
                  progress: 0,
                  isCancelled: true,
                  cancelMessage: "传输已取消",
                });
              } else {
                // 仍然更新UI以避免用户困惑
                updateTransferProgress(transfer.transferId, {
                  progress: 0,
                  isCancelled: true,
                  cancelMessage: t("fileManager.errors.transferCancelled"),
                });
              }
            } catch (apiError) {
              // API调用失败，但仍标记为取消
              updateTransferProgress(transfer.transferId, {
                progress: 0,
                isCancelled: true,
                cancelMessage: t("fileManager.errors.transferCancelled"),
              });
            }
          } else {
            // API不可用，直接标记为取消
            updateTransferProgress(transfer.transferId, {
              progress: 0,
              isCancelled: true,
              cancelMessage: t("fileManager.errors.transferCancelled"),
            });
          }
        }

        // 添加额外延迟，确保取消操作完成后再刷新
        addTimeout(() => {
          // 无论是否成功取消传输，都刷新文件列表
          refreshAfterUserActivity();

          // 也执行一次强制刷新
          loadDirectory(currentPath, 0, true);
        }, 800); // 延迟800ms等待后端处理完成
      } catch (error) {
        // 即使出现错误，也标记相关传输为已中断
        transfersToCancel.forEach((transfer) => {
          updateTransferProgress(transfer.transferId, {
            progress: 0,
            isCancelled: true,
            cancelMessage: t("fileManager.errors.transferCancelled"),
          });
        });

        // 发生错误时也刷新文件列表，确保UI状态一致
        addTimeout(() => {
          refreshAfterUserActivity();
          loadDirectory(currentPath, 0, true);
        }, 800);
      }
    };

    // 处理空白区域右键菜单
    const handleBlankContextMenu = (event) => {
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

    const handleBlankClick = useCallback(() => {
      if (!selectedFile && selectedFiles.length === 0) {
        return;
      }

      clearSelection();
    }, [clearSelection, selectedFile, selectedFiles.length]);

    // 关闭空白区域右键菜单
    const handleBlankContextMenuClose = () => {
      setBlankContextMenu(null);
    };

    // 处理创建文件夹
    const handleCreateFolder = () => {
      setNewFolderName("");
      setShowCreateFolderDialog(true);
      handleBlankContextMenuClose();
    };

    // 处理创建文件夹提交
    const handleCreateFolderSubmit = async (e) => {
      e.preventDefault();

      if (!newFolderName.trim() || !sshConnection) {
        setShowCreateFolderDialog(false);
        return;
      }

      setLoading(true);
      setError(null);
      let retryCount = 0;
      const maxRetries = 3;

      const attemptCreateFolder = async () => {
        try {
          const fullPath =
            currentPath === "/"
              ? "/" + newFolderName.trim()
              : currentPath + "/" + newFolderName.trim();

          if (window.terminalAPI && window.terminalAPI.createFolder) {
            const response = await window.terminalAPI.createFolder(
              tabId,
              fullPath,
            );

            if (response?.success) {
              // 成功创建文件夹，刷新目录
              await loadDirectory(currentPath);
              setShowCreateFolderDialog(false);
              // 创建文件夹操作完成后选择性触发静默刷新，避免与显式刷新竞态
              try {
                if (!lastRefreshTime || Date.now() - lastRefreshTime > 700) {
                  refreshAfterUserActivity();
                }
              } catch (_) {
                refreshAfterUserActivity();
              }
            } else if (
              response?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              // SFTP错误，尝试重试
              retryCount++;
              setError(
                t("fileManager.messages.createFolderFailedRetrying", {
                  current: retryCount,
                  max: maxRetries,
                }),
              );

              // 添加延迟后重试
              setTimeout(attemptCreateFolder, 500 * retryCount);
              return;
            } else {
              // 其他错误或已达到最大重试次数
              setError(
                response?.error || t("fileManager.errors.createFolderFailed"),
              );
              setShowCreateFolderDialog(false);
            }
          } else {
            setError(t("fileManager.errors.fileApiNotAvailable"));
            setShowCreateFolderDialog(false);
          }
        } catch (error) {
          // t("fileManager.errors.createFolderFailed")

          if (retryCount < maxRetries) {
            // 发生异常，尝试重试
            retryCount++;
            setError(
              t("fileManager.messages.createFolderFailedRetrying", {
                current: retryCount,
                max: maxRetries,
              }),
            );

            // 添加延迟后重试
            setTimeout(attemptCreateFolder, 500 * retryCount);
            return;
          }

          setError(
            t("fileManager.errors.createFolderFailed") +
              ": " +
              (error.message || t("fileManager.errors.unknownError")),
          );
          setShowCreateFolderDialog(false);
        } finally {
          if (retryCount === 0 || retryCount >= maxRetries) {
            setLoading(false);
          }
        }
      };

      attemptCreateFolder();
    };

    // 处理创建文件
    const handleCreateFile = () => {
      setNewFileName("");
      setShowCreateFileDialog(true);
      handleBlankContextMenuClose();
    };

    // 处理创建文件提交
    const handleCreateFileSubmit = async (e) => {
      e.preventDefault();

      if (!newFileName.trim() || !sshConnection) {
        setShowCreateFileDialog(false);
        return;
      }

      setLoading(true);

      try {
        const fullPath =
          currentPath === "/"
            ? "/" + newFileName.trim()
            : currentPath + "/" + newFileName.trim();

        if (window.terminalAPI && window.terminalAPI.createFile) {
          const result = await window.terminalAPI.createFile(tabId, fullPath);
          if (result.success) {
            await loadDirectory(currentPath);
            // 创建文件操作完成后选择性触发静默刷新，避免与显式刷新竞态
            try {
              if (!lastRefreshTime || Date.now() - lastRefreshTime > 700) {
                refreshAfterUserActivity();
              }
            } catch (_) {
              refreshAfterUserActivity();
            }
          } else {
            setError(
              `${t("fileManager.errors.createFolderFailed")}: ${result.error || t("fileManager.errors.unknownError")}`,
            );
          }
        } else {
          setError(t("fileManager.errors.fileApiNotAvailable"));
        }
      } catch (error) {
        setError(
          t("fileManager.errors.createFolderFailed") +
            ": " +
            (error.message || t("fileManager.errors.unknownError")),
        );
      } finally {
        setLoading(false);
        setShowCreateFileDialog(false);
      }
    };

    

    // 处理拖拽的文件和文件夹
    const handleDroppedItems = useCallback(
      async (entries) => {
        setTransferCancelled(false);

        // 确定目标路径
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

        // 收集所有文件信息
        const allFiles = [];
        const folderStructure = new Set();

        // 递归读取文件夹内容
        const readEntry = async (entry, path = "") => {
          if (entry.isFile) {
            return new Promise((resolve) => {
              entry.file(
                (file) => {
                  const relativePath = path + file.name;
                  allFiles.push({
                    file: file,
                    relativePath: relativePath,
                  });

                  // 记录文件夹结构
                  if (path) {
                    const parts = path.split("/");
                    for (let i = 1; i <= parts.length; i++) {
                      const folderPath = parts.slice(0, i).join("/");
                      if (folderPath) {
                        folderStructure.add(folderPath.replace(/\/$/, ""));
                      }
                    }
                  }
                  resolve();
                },
                () => {
                  // Error reading file - silently skip
                  resolve();
                },
              );
            });
          } else if (entry.isDirectory) {
            const dirPath = path + entry.name;
            folderStructure.add(dirPath);

            const reader = entry.createReader();
            return new Promise((resolve) => {
              const allEntries = [];
              const readEntries = () => {
                reader.readEntries(
                  async (entries) => {
                    if (entries.length === 0) {
                      // 处理所有收集的条目
                      for (const childEntry of allEntries) {
                        await readEntry(childEntry, dirPath + "/");
                      }
                      resolve();
                      return;
                    }
                    allEntries.push(...entries);
                    readEntries();
                  },
                  () => {
                    // Error reading directory - silently skip
                    resolve();
                  },
                );
              };
              readEntries();
            });
          }
        };

        // 读取所有拖拽的项目
        for (const entry of entries) {
          await readEntry(entry);
        }

        if (allFiles.length === 0) {
          setNotification({
            message: t("fileManager.errors.noFilesSelected"),
            severity: "warning",
          });
          return;
        }

        // 使用与右键菜单上传相同的逻辑
        if (window.terminalAPI && window.terminalAPI.uploadDroppedFiles) {
          // 创建新的传输任务 - 与 handleUploadFile 保持一致
          const transferId = addTransferProgress({
            type: "upload-multifile",
            progress: 0,
            fileName: t("fileManager.messages.preparingUpload"),
            transferredBytes: 0,
            totalBytes: 0,
            transferSpeed: 0,
            remainingTime: 0,
            currentFileIndex: 0,
            totalFiles: allFiles.length,
          });

          try {
            // 准备文件数据供IPC传输
            const filesDataForUpload = [];
            const foldersToCreate = Array.from(folderStructure).sort();

            for (const item of allFiles) {
              // 读取文件内容为ArrayBuffer
              const arrayBuffer = await item.file.arrayBuffer();

              // 对于大文件，分块处理以避免 "Invalid array length" 错误
              const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunks
              const chunks = [];

              if (arrayBuffer.byteLength > CHUNK_SIZE) {
                // 大文件分块
                for (
                  let offset = 0;
                  offset < arrayBuffer.byteLength;
                  offset += CHUNK_SIZE
                ) {
                  const end = Math.min(
                    offset + CHUNK_SIZE,
                    arrayBuffer.byteLength,
                  );
                  const chunk = new Uint8Array(arrayBuffer.slice(offset, end));
                  chunks.push(chunk);
                }
              } else {
                // 小文件直接转换
                chunks.push(new Uint8Array(arrayBuffer));
              }

              filesDataForUpload.push({
                name: item.file.name,
                relativePath: item.relativePath,
                size: item.file.size,
                type: item.file.type,
                lastModified: item.file.lastModified,
                chunks: chunks,
                isChunked: chunks.length > 1,
              });
            }

            // 调用主进程的上传方法，与 handleUploadFile 保持一致的进度处理
            const result = await window.terminalAPI.uploadDroppedFiles(
              tabId,
              targetPath,
              {
                files: filesDataForUpload,
                folders: foldersToCreate,
              },
              (
                progress,
                fileName,
                transferredBytes,
                totalBytes,
                transferSpeed,
                remainingTime,
                currentFileIndex,
                totalFiles,
                transferKey,
                operationComplete,
              ) => {
                // 与 handleUploadFile 保持一致的进度处理
                const validProgress = Math.max(0, Math.min(100, progress || 0));
                const validTransferredBytes = Math.max(
                  0,
                  transferredBytes || 0,
                );
                const validTotalBytes = Math.max(0, totalBytes || 0);
                const validTransferSpeed = Math.max(0, transferSpeed || 0);
                const validRemainingTime = Math.max(0, remainingTime || 0);
                const validCurrentFileIndex = Math.max(
                  0,
                  currentFileIndex || 0,
                );
                const validTotalFiles = Math.max(0, totalFiles || 0);

                // 检查是否已取消
                if (transferCancelled) {
                  return;
                }

                // 更新传输进度
                updateTransferProgress(transferId, {
                  progress: validProgress,
                  fileName: fileName || t("fileManager.messages.unknownFile"),
                  transferredBytes: validTransferredBytes,
                  totalBytes: validTotalBytes,
                  transferSpeed: validTransferSpeed,
                  remainingTime: validRemainingTime,
                  currentFileIndex: validCurrentFileIndex,
                  totalFiles: validTotalFiles,
                  transferKey: transferKey || "",
                  isCompleted: operationComplete === true,
                });
              },
            );

            // 与 handleUploadFile 保持一致的结果处理
            if (result?.success) {
              // 标记传输完成
              updateTransferProgress(transferId, {
                progress: 100,
                fileName:
                  result.message || t("fileManager.messages.uploadComplete"),
                isCompleted: true,
              });

              // 传输完成后延迟移除
              storeScheduleTransferCleanup(transferId, 3000);

              // 切换到上传的目标路径
              updateCurrentPath(targetPath);
              setPathInput(targetPath);
              loadDirectory(targetPath, 0, true); // 强制刷新目标目录

              // 如果有警告信息（部分文件上传失败），显示给用户
              if (result.partialSuccess && result.warning) {
                setError(result.warning);
              } else {
                // 显示成功通知
                setNotification({
                  message: t("fileManager.messages.uploadSuccess"),
                  severity: "success",
                });
              }

              // 刷新文件列表
              refreshAfterUserActivity();
            } else {
              throw new Error(
                result.error || t("fileManager.errors.uploadFailed"),
              );
            }
          } catch (error) {
            // Upload error - display in notification if not user cancellation

            // 检查是否为用户取消操作
            const isCancellation = isUserCancellationError(error);

            // 更新传输进度为错误或取消
            updateTransferProgress(transferId, {
              error: !isCancellation,
              isCancelled: isCancellation,
              errorMessage: error.message || error.toString(),
            });

            if (!isCancellation) {
              setNotification({
                message: error.message || t("fileManager.errors.uploadFailed"),
                severity: "error",
              });
            }

            // 延迟移除错误的传输
            addTimeout(() => {
              removeTransferProgress(transferId);
            }, 3000);
          }
        } else {
          // 如果没有专门的拖拽上传API，显示错误
          setNotification({
            message:
              t("fileManager.errors.dragDropNotSupported") ||
              "拖拽上传功能暂不可用",
            severity: "error",
          });
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
        removeTransferProgress,
        addTimeout,
        isUserCancellationError,
        refreshAfterUserActivity,
        setNotification,
        updateCurrentPath,
        setPathInput,
        loadDirectory,
        setError,
      ],
    );

    const handleDrop = useCallback(
      async (e) => {
        e.preventDefault();
        e.stopPropagation();

        // 重置拖拽状态
        setIsDragging(false);
        setDragCounter(0);

        if (!sshConnection) {
          setNotification({
            message: t("fileManager.errors.noConnection"),
            severity: "error",
          });
          return;
        }

        // 获取拖拽的文件和文件夹
        const items = e.dataTransfer.items;
        if (!items || items.length === 0) return;

        // 将 DataTransferItemList 转换为数组
        const itemsArray = Array.from(items);

        // 收集所有的文件和文件夹
        const filesAndFolders = [];

        for (const item of itemsArray) {
          if (item.kind === "file") {
            const entry = item.webkitGetAsEntry
              ? item.webkitGetAsEntry()
              : item.getAsEntry?.();
            if (entry) {
              filesAndFolders.push(entry);
            } else {
              // 如果不支持 getAsEntry，回退到 getAsFile
              const file = item.getAsFile();
              if (file) {
                filesAndFolders.push({
                  isFile: true,
                  isDirectory: false,
                  file: () => Promise.resolve(file),
                  name: file.name,
                });
              }
            }
          }
        }

        if (filesAndFolders.length === 0) return;

        // 处理文件和文件夹上传
        await handleDroppedItems(filesAndFolders);
      },
      [sshConnection, t, handleDroppedItems, setNotification],
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
          const last = externalEditorEventThrottles.current.get(throttleKey) || 0;
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

    // 处理文件激活（双击）
    const handleFileActivate = async (file) => {
      if (file.isDirectory) {
        const basePath = currentPath && currentPath.length > 0 ? currentPath : "/";
        const newPath =
          basePath === "/"
            ? `/${file.name}`
            : basePath.endsWith("/")
              ? `${basePath}${file.name}`
              : `${basePath}/${file.name}`;

        handleEnterDirectory(newPath);
        return;
      }

      const openInPreview = () => {
        const maxFileSize = 10 * 1024 * 1024;
        if (file.size && file.size > maxFileSize) {
          setError(
            t("fileManager.messages.fileSizeExceedsLimit", {
              name: file.name,
              size: formatFileSize(file.size, t),
            }),
          );
          return false;
        }

        setFilePreview(file);
        setShowPreview(true);
        refreshAfterUserActivity();
        return true;
      };

      if (!externalEditorEnabled || !window.terminalAPI?.openFileInExternalEditor) {
        openInPreview();
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

      const basePath = currentPath && currentPath.length > 0 ? currentPath : "/";
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
          openInPreview();
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
          openInPreview();
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
        openInPreview();
      }
    };    // 关闭预览
    const handleClosePreview = () => {
      setShowPreview(false);
    };

    // 修改文件操作相关处理函数，在文件操作后调用refreshAfterUserActivity

    // 处理下载
    const handleDownload = async () => {
      const filesToDownload = getSelectedFiles().filter((f) => !f.isDirectory);
      if (filesToDownload.length === 0 || !sshConnection) return;

      // 重置取消状态
      setTransferCancelled(false);

      // 保存当前路径状态
      const savedCurrentPath = currentPath;

      if (filesToDownload.length === 1) {
        // 单文件下载 - 保持原有逻辑
        const savedSelectedFile = filesToDownload[0];

        try {
          const fullPath =
            savedCurrentPath === "/"
              ? "/" + savedSelectedFile.name
              : savedCurrentPath
                ? savedCurrentPath + "/" + savedSelectedFile.name
                : savedSelectedFile.name;

          if (window.terminalAPI && window.terminalAPI.downloadFile) {
            // 创建新的下载传输任务
            const transferId = addTransferProgress({
              type: "download",
              progress: 0,
              fileName: savedSelectedFile.name,
              transferredBytes: 0,
              totalBytes: savedSelectedFile.size || 0,
              transferSpeed: 0,
              remainingTime: 0,
              processedFiles: 0,
              totalFiles: 1,
            });

            // 使用progressCallback处理进度更新
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
                  progress,
                  fileName,
                  transferredBytes,
                  totalBytes,
                  transferSpeed,
                  remainingTime,
                  processedFiles: processedFiles || 0,
                  totalFiles: totalFiles || 1,
                  transferKey, // 添加transferKey到进度状态
                });
              },
            );

            // 处理下载结果
            if (result?.success) {
              updateTransferProgress(transferId, {
                progress: 100,
                fileName: result.message || "下载完成",
              });
              storeScheduleTransferCleanup(transferId, 3000);
            } else if (result?.error) {
              updateTransferProgress(transferId, {
                error: result.error,
              });
            }
          }
        } catch (error) {
          // 下载文件失败

          // 只有在不是用户主动取消的情况下才显示错误
          if (
            !transferCancelled &&
            !error.message?.includes("reply was never sent")
          ) {
            setError(
              t("fileManager.errors.downloadFailed") +
                ": " +
                (error.message || t("fileManager.errors.unknownError")),
            );
            // 更新所有未完成的传输为错误状态
            const errorMessage =
              error.message || t("fileManager.errors.unknownError");
            transferProgressList
              .filter(
                (transfer) =>
                  transfer.progress < 100 && !transfer.isCancelled,
              )
              .forEach((transfer) => {
                updateTransferProgress(transfer.transferId, {
                  error: errorMessage,
                });
              });
          }
        }
      } else {
        // 多文件下载
        try {
          showNotification(`开始下载 ${filesToDownload.length} 个文件`, "info");

          // 创建总体进度跟踪
          const batchTransferId = addTransferProgress({
            type: "download",
            progress: 0,
            fileName: `批量下载 (${filesToDownload.length} 个文件)`,
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

          let completedFiles = 0;
          let totalTransferredBytes = 0;
          const totalBytes = filesToDownload.reduce(
            (sum, file) => sum + (file.size || 0),
            0,
          );

          // 逐个下载文件
          for (const file of filesToDownload) {
            if (transferCancelled) break;

            const fullPath =
              savedCurrentPath === "/"
                ? "/" + file.name
                : savedCurrentPath
                  ? savedCurrentPath + "/" + file.name
                  : file.name;

            if (window.terminalAPI && window.terminalAPI.downloadFile) {
              const result = await window.terminalAPI.downloadFile(
                tabId,
                fullPath,
                (progress, fileName, transferredBytes, fileBytes) => {
                  // 更新批量进度
                  const currentFileBytes = Math.min(
                    transferredBytes || 0,
                    file.size || 0,
                  );
                  const batchProgress =
                    totalBytes > 0
                      ? Math.round(
                          ((totalTransferredBytes + currentFileBytes) /
                            totalBytes) *
                            100,
                        )
                      : 0;

                  updateTransferProgress(batchTransferId, {
                    progress: batchProgress,
                    fileName: `正在下载: ${fileName} (${completedFiles + 1}/${filesToDownload.length})`,
                    transferredBytes: totalTransferredBytes + currentFileBytes,
                    totalBytes,
                    processedFiles: completedFiles,
                    totalFiles: filesToDownload.length,
                  });
                },
              );

              if (result?.success) {
                completedFiles++;
                totalTransferredBytes += file.size || 0;

                // 更新总体进度
                updateTransferProgress(batchTransferId, {
                  progress: Math.round(
                    (completedFiles / filesToDownload.length) * 100,
                  ),
                  fileName: `已完成: ${completedFiles}/${filesToDownload.length} 个文件`,
                  processedFiles: completedFiles,
                  totalFiles: filesToDownload.length,
                  transferredBytes: totalTransferredBytes,
                });
              } else if (result?.error) {
                showNotification(
                  `文件 ${file.name} 下载失败: ${result.error}`,
                  "error",
                );
              }
            }
          }

          // 完成批量下载
          if (completedFiles === filesToDownload.length) {
            updateTransferProgress(batchTransferId, {
              progress: 100,
              fileName: `批量下载完成 (${completedFiles} 个文件)`,
            });
            showNotification(`成功下载 ${completedFiles} 个文件`, "success");
          } else {
            updateTransferProgress(batchTransferId, {
              error: `部分下载失败，已完成 ${completedFiles}/${filesToDownload.length} 个文件`,
            });
            showNotification(
              `部分下载失败，已完成 ${completedFiles}/${filesToDownload.length} 个文件`,
              "warning",
            );
          }

          storeScheduleTransferCleanup(batchTransferId, 3000);
        } catch (error) {
          if (
            !transferCancelled &&
            !error.message?.includes("reply was never sent")
          ) {
            setError(
              t("fileManager.errors.downloadFailed") +
                ": " +
                (error.message || t("fileManager.errors.unknownError")),
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
        showNotification("SSH连接不可用", "error");
        return;
      }

      const foldersToDownload = getSelectedFiles().filter((f) => f.isDirectory);
      if (foldersToDownload.length === 0) {
        showNotification("请先选择要下载的文件夹", "warning");
        return;
      }

      // 保存当前路径状态
      const savedCurrentPath = currentPath;

      // 重置取消状态
      setTransferCancelled(false);

      if (foldersToDownload.length === 1) {
        // 单文件夹下载 - 保持原有逻辑
        const savedSelectedFile = foldersToDownload[0];

        if (!savedSelectedFile.isDirectory) {
          return handleDownload();
        }

        try {
          // 构建完整路径，确保处理各种路径情况
          const fullPath = (() => {
            if (savedCurrentPath === "/") {
              return "/" + savedSelectedFile.name;
            } else if (savedCurrentPath === "~") {
              return "~/" + savedSelectedFile.name;
            } else {
              return savedCurrentPath + "/" + savedSelectedFile.name;
            }
          })();

          if (window.terminalAPI && window.terminalAPI.downloadFolder) {
            // 创建新的文件夹下载传输任务
            const transferId = addTransferProgress({
              type: "download-folder",
              progress: 0,
              fileName: savedSelectedFile.name,
              currentFile: "",
              transferredBytes: 0,
              totalBytes: 0,
              transferSpeed: 0,
              remainingTime: 0,
              processedFiles: 0,
              totalFiles: 0,
            });

            // 使用progressCallback处理进度更新
            try {
              const downloadResult = await window.terminalAPI.downloadFolder(
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
                    progress,
                    fileName: savedSelectedFile.name,
                    currentFile,
                    transferredBytes,
                    totalBytes,
                    transferSpeed,
                    remainingTime,
                    processedFiles,
                    totalFiles,
                    transferKey, // 添加transferKey到状态
                  });
                },
              );

              // 标记传输完成
              updateTransferProgress(transferId, {
                progress: 100,
                fileName: "文件夹下载完成",
              });

              // 下载完成后延迟移除
              addTimeout(() => {
                removeTransferProgress(transferId);

                // 显示详细的成功通知
                if (downloadResult && downloadResult.downloadPath) {
                  const normalizedPath = downloadResult.downloadPath.replace(
                    /\//g,
                    "\\",
                  );
                  // 验证路径存在
                  window.terminalAPI
                    .checkPathExists?.(normalizedPath)
                    .then((exists) => {
                      if (exists) {
                        // 显示包含下载路径的成功消息
                        showNotification(
                          `文件夹 ${savedSelectedFile.name} 已下载到: ${normalizedPath}`,
                          "success",
                          15000, // 显示更长时间
                          true, // 提供打开选项
                          () => {
                            // 尝试使用window.shell打开文件夹位置
                            if (
                              window.terminalAPI &&
                              window.terminalAPI.openExternal
                            ) {
                              const folderUrl = `file://${normalizedPath}`;
                              window.terminalAPI
                                .openExternal(folderUrl)
                                .catch((e) => {
                                  // 无法打开文件夹，尝试替代方法
                                  window.terminalAPI
                                    .showItemInFolder?.(normalizedPath)
                                    .catch(() => {
                                      showNotification(
                                        `无法自动打开文件夹，位置: ${normalizedPath}`,
                                        "warning",
                                      );
                                    });
                                });
                            }
                          },
                        );
                      } else {
                        showNotification(
                          `文件夹下载可能未完成，无法在 ${normalizedPath} 找到文件`,
                          "warning",
                          10000,
                        );
                      }
                    })
                    .catch(() => {
                      // 如果无法验证，仍然显示成功消息
                      showNotification(
                        `文件夹 ${savedSelectedFile.name} 下载已完成，但无法验证路径: ${normalizedPath}`,
                        "success",
                        10000,
                      );
                    });
                } else {
                  // 基本成功通知
                  showNotification(
                    `文件夹 ${savedSelectedFile.name} 下载成功`,
                    "success",
                  );
                }

                setError(null); // 清除可能存在的错误信息
              }, 1500);
            } catch (downloadError) {
              // 文件夹下载过程中出错
              throw downloadError; // 重新抛出错误，让外层 catch 处理
            }
          } else {
            throw new Error("下载文件夹API不可用");
          }
        } catch (error) {
          // 下载文件夹失败

          // 处理各种错误情况
          if (transferCancelled) {
            showNotification(
              t("fileManager.errors.downloadCancelledByUser"),
              "info",
            );
          } else if (error.message?.includes("reply was never sent")) {
            showNotification(
              t("fileManager.errors.downloadProcessInterrupted"),
              "warning",
              8000,
            );
          } else if (
            error.message?.includes(t("fileManager.errors.userCancelled"))
          ) {
            // 特别处理这个可能误报的情况，提供更详细的解释
            showNotification(
              "下载路径选择有问题，请重试并确保正确选择下载文件夹",
              "warning",
              10000,
              true,
              () => {
                addTimeout(() => handleDownloadFolder(), 500);
              },
            );
          } else if (error.message?.includes("无法创建本地文件夹结构")) {
            showNotification(
              `下载失败: 无法创建本地文件夹。请检查您的磁盘空间及权限。`,
              "error",
              10000,
            );
          } else if (
            error.message?.includes("权限不足") ||
            error.message?.includes("拒绝访问") ||
            error.message?.includes("Access denied")
          ) {
            showNotification(
              `下载失败: 权限不足。请尝试以管理员身份运行或选择其他下载位置。`,
              "error",
              10000,
            );
          } else if (
            error.message?.includes("网络") ||
            error.message?.includes("Network") ||
            error.message?.includes("timeout")
          ) {
            showNotification(
              `下载失败: 网络连接问题。请检查您的网络连接并重试。`,
              "error",
              10000,
            );
          } else if (
            error.message?.includes("路径无效") ||
            error.message?.includes("选择的下载路径无效")
          ) {
            showNotification(
              `下载失败: 您选择的下载路径无效或不可访问。请选择其他位置。`,
              "error",
              10000,
            );
          } else {
            // 通用错误处理
            showNotification(
              `${t("fileManager.messages.downloadFolderFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
              "error",
              10000,
            );
          }

          // 提供重试选项
          if (
            error &&
            !transferCancelled &&
            !error.message?.includes(t("fileManager.errors.userCancelled"))
          ) {
            addTimeout(() => {
              showNotification(
                "您可以尝试重新下载文件夹",
                "info",
                8000,
                true,
                () => handleDownloadFolder(),
              );
            }, 3000);
          }

          // 标记所有未完成的传输为错误状态
          const errorMessage =
            error.message || t("fileManager.errors.unknownError");
          transferProgressList
            .filter(
              (transfer) =>
                transfer.progress < 100 && !transfer.isCancelled,
            )
            .forEach((transfer) => {
              updateTransferProgress(transfer.transferId, {
                error: errorMessage,
              });
            });
        }
      } else {
        // 多文件夹下载
        try {
          showNotification(
            `开始下载 ${foldersToDownload.length} 个文件夹`,
            "info",
          );

          let completedFolders = 0;

          // 逐个下载文件夹
          for (const folder of foldersToDownload) {
            if (transferCancelled) break;

            const fullPath = (() => {
              if (savedCurrentPath === "/") {
                return "/" + folder.name;
              } else if (savedCurrentPath === "~") {
                return "~/" + folder.name;
              } else {
                return savedCurrentPath + "/" + folder.name;
              }
            })();

            if (window.terminalAPI && window.terminalAPI.downloadFolder) {
              // 创建单个文件夹下载传输任务
              const transferId = addTransferProgress({
                type: "download-folder",
                progress: 0,
                fileName: `${folder.name} (${completedFolders + 1}/${foldersToDownload.length})`,
                currentFile: "",
                transferredBytes: 0,
                totalBytes: 0,
                transferSpeed: 0,
                remainingTime: 0,
                processedFiles: 0,
                totalFiles: 0,
              });

              try {
                const downloadResult = await window.terminalAPI.downloadFolder(
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
                      progress,
                      fileName: `${folder.name} (${completedFolders + 1}/${foldersToDownload.length})`,
                      currentFile,
                      transferredBytes,
                      totalBytes,
                      transferSpeed,
                      remainingTime,
                      processedFiles,
                      totalFiles,
                      transferKey,
                    });
                  },
                );

                // 标记单个文件夹完成
                updateTransferProgress(transferId, {
                  progress: 100,
                  fileName: `${folder.name} 下载完成`,
                });

                completedFolders++;

                storeScheduleTransferCleanup(transferId, 2000);
              } catch (folderError) {
                updateTransferProgress(transferId, {
                  error: `${folder.name} 下载失败: ${folderError.message}`,
                });
                showNotification(
                  `文件夹 ${folder.name} 下载失败: ${folderError.message}`,
                  "error",
                );
                storeScheduleTransferCleanup(transferId, 5000);
              }
            }
          }

          // 批量下载完成通知
          if (completedFolders === foldersToDownload.length) {
            showNotification(
              `成功下载 ${completedFolders} 个文件夹`,
              "success",
            );
          } else {
            showNotification(
              `部分下载失败，已完成 ${completedFolders}/${foldersToDownload.length} 个文件夹`,
              "warning",
            );
          }
        } catch (error) {
          if (
            !transferCancelled &&
            !error.message?.includes("reply was never sent")
          ) {
            showNotification(
              `${t("fileManager.messages.batchDownloadFolderFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
              "error",
              10000,
            );
          }
        }
      }
      handleContextMenuClose();
    };

    // 处理重命名
    const handleRename = async () => {
      if (!selectedFile) return;
      setNewName(selectedFile.name);
      // 打开重命名对话框
      setShowRenameDialog(true);
      handleContextMenuClose();
    };

    // 处理重命名提交
    const handleRenameSubmit = async (e) => {
      e.preventDefault();
      setShowRenameDialog(false);

      if (!selectedFile) return;

      // 检查是否有更改
      const nameChanged = newName && newName !== selectedFile.name;
      if (!nameChanged) return;

      setLoading(true);
      setError(null);
      let retryCount = 0;
      const maxRetries = 3;

      const attemptUpdate = async () => {
        try {
          const oldPath =
            currentPath === "/"
              ? "/" + selectedFile.name
              : currentPath
                ? currentPath + "/" + selectedFile.name
                : selectedFile.name;

          let finalPath = oldPath;

          // 如果需要重命名
          if (
            nameChanged &&
            window.terminalAPI &&
            window.terminalAPI.renameFile
          ) {
            const renameResponse = await window.terminalAPI.renameFile(
              tabId,
              oldPath,
              newName,
            );

            if (renameResponse?.success) {
              // 重命名成功，更新最终路径
              const dirPath = currentPath === "/" ? "/" : currentPath || "/";
              finalPath =
                dirPath === "/" ? `/${newName}` : `${dirPath}/${newName}`;
            } else if (
              renameResponse?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              // SFTP错误，尝试重试
              retryCount++;
              setError(
                t("fileManager.messages.updateFailedRetrying", {
                  current: retryCount,
                  max: maxRetries,
                }),
              );
              setTimeout(attemptUpdate, 500 * retryCount);
              return;
            } else {
              // 重命名失败
              setError(renameResponse?.error || "重命名失败");
              return;
            }
          }

          // 重命名窗口中不再处理权限变更

          // 操作成功，刷新目录
          await loadDirectory(currentPath);
          refreshAfterUserActivity();
        } catch (error) {
          // 操作失败
          if (retryCount < maxRetries) {
            // 发生异常，尝试重试
            retryCount++;
            setError(
              t("fileManager.messages.updateFailedRetrying", {
                current: retryCount,
                max: maxRetries,
              }),
            );
            setTimeout(attemptUpdate, 500 * retryCount);
            return;
          }

          setError(
            `${t("fileManager.errors.updateFailed")}: ${error.message || t("fileManager.errors.unknownError")}`,
          );
        } finally {
          if (retryCount === 0 || retryCount >= maxRetries) {
            setLoading(false);
          }
        }
      };

      attemptUpdate();
    };

    // 重命名不再处理权限变化

    // 处理键盘快捷键
    const handleKeyDown = useCallback((event) => {
      // 只有当文件管理器打开时才处理键盘事件
      if (!open || showPreview) return;

      const targetElement = event.target || document.activeElement;
      if (
        targetElement &&
        typeof targetElement.closest === "function" &&
        targetElement.closest('[data-file-preview-dialog=\"true\"]')
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
        if (selectedFilesData.length > 0) {
          if (selectedFilesData.some((f) => f.isDirectory)) {
            handleDownloadFolder();
          } else {
            handleDownload();
          }
        } else {
          showNotification("请先选择要下载的文件或文件夹", "warning");
        }
      }

      // Delete: 删除文件/文件夹
      if (event.key === "Delete") {
        event.preventDefault();
        if (selectedFilesData.length > 0) {
          handleDelete();
        } else {
          showNotification("请先选择要删除的文件或文件夹", "warning");
        }
      }

      // F2: 重命名
      if (event.key === "F2") {
        event.preventDefault();
        if (selectedFilesData.length === 1) {
          handleRename();
        } else if (selectedFilesData.length > 1) {
          showNotification("无法批量重命名，请选择单个文件", "warning");
        } else {
          showNotification("请先选择要重命名的文件", "warning");
        }
      }

      // F3: 权限设置
      if (event.key === "F3") {
        event.preventDefault();
        if (selectedFilesData.length === 1) {
          handleOpenPermissions();
        } else if (selectedFilesData.length > 1) {
          showNotification(
            "暂不支持批量权限设置，请选择单个文件/文件夹",
            "warning",
          );
        } else {
          showNotification(
            "请先选择要设置权限的文件/文件夹",
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
        if (selectedFilesData.length === 1) {
          handleCopyAbsolutePath();
        } else {
          showNotification("只能复制单个文件的路径", "warning");
        }
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
    }, [
      open,
      showPreview,
      getSelectedFiles,
      handleDownloadFolder,
      handleDownload,
      handleDelete,
      handleRename,
      handleOpenPermissions,
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
    ]);

    // 添加键盘事件监听器
    useEffect(() => {
      if (!open) return;

      const keydownHandler = (event) => {
        try {
          handleKeyDown(event);
        } catch (error) {
          // Silently handle keyboard event errors
        }
      };

      window.addEventListener('keydown', keydownHandler);

      return () => {
        window.removeEventListener('keydown', keydownHandler);
      };
    }, [open, handleKeyDown]);

    // 处理关闭文件管理器
    const handleClose = () => {
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

        let transferTypeDescription = "";
        if (hasUpload && hasDownload) {
          transferTypeDescription = "上传和下载";
        } else if (hasUpload) {
          transferTypeDescription = "上传";
        } else {
          transferTypeDescription = "下载";
        }

        const shouldClose = window.confirm(
          `有正在进行的${transferTypeDescription}任务，收起窗口不会中断传输，确定继续吗？`,
        );

        if (!shouldClose) {
          return;
        }
      }

      onClose();
    };

    // 处理上传菜单打开
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

    return (
      <Paper
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        sx={{
          width: open ? 300 : 0,
          height: "100%",
          overflow: "hidden",
          transition: (theme) =>
            theme.transitions.create("width", {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
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
        tabIndex={0} // 使得Paper元素可以接收键盘事件
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            p: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
            flexShrink: 0, // 不收缩
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
          <IconButton
            size="small"
            onClick={handleClose}
            edge="end"
            disabled={isClosing} // 禁用关闭按钮当正在关闭时
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        <Box
          sx={{
            p: 1,
            display: "flex",
            alignItems: "center",
            borderBottom: `1px solid ${theme.palette.divider}`,
            gap: 0.5,
            flexShrink: 0, // 不收缩
          }}
        >
          <Tooltip title={t("fileManager.back")}>
            <span>
              <IconButton
                size="small"
                onClick={handleGoBack}
                disabled={
                  !currentPath || (currentPath === "/" && currentPath !== "~")
                }
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
              >
                <ArrowForwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={t("fileManager.home")}>
            <IconButton size="small" onClick={handleGoHome}>
              <HomeIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t("fileManager.refresh")}>
            <IconButton size="small" onClick={handleRefresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              ml: 1,
              fontSize: "0.75rem",
              color: theme.palette.text.secondary,
            }}
          >
            <Tooltip title={t("fileManager.statusBar.lastRefresh")}>
              <Box component="span" sx={{ fontSize: "0.75rem", opacity: 0.8 }}>
                {t("fileManager.statusBar.lastRefresh", {
                  time: formatLastRefreshTime(lastRefreshTime),
                })}
              </Box>
            </Tooltip>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title={t("fileManager.search")}>
            <IconButton size="small" onClick={toggleSearch}>
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t("fileManager.upload")}>
            <IconButton size="small" onClick={handleUploadMenuOpen}>
              <UploadFileIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {showSearch && (
          <Box
            sx={{
              p: 1,
              borderBottom: `1px solid ${theme.palette.divider}`,
              flexShrink: 0, // 不收缩
            }}
          >
            <TextField
              inputRef={searchInputRef}
              size="small"
              fullWidth
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
                endAdornment: searchTerm && (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => setSearchTerm("")}
                      edge="end"
                    >
                      <ClearIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{
                "& .MuiOutlinedInput-root": {
                  borderRadius: 2,
                },
              }}
            />
          </Box>
        )}

        <Box
          sx={{
            px: 1,
            py: 0.5,
            overflow: "hidden",
            borderBottom: `1px solid ${theme.palette.divider}`,
            zIndex: 1, // 确保路径输入框显示在上层
            flexShrink: 0, // 不收缩
            display: "flex",
            alignItems: "center",
            gap: 0.5,
          }}
        >
          <TextField
            fullWidth
            size="small"
            variant="outlined"
            value={pathInput}
            onChange={handlePathInputChange}
            onKeyDown={handlePathInputSubmit}
            placeholder={t("fileManager.enterPath")}
            InputProps={{
              style: { fontSize: "0.75rem" },
              startAdornment: (
                <InputAdornment position="start">
                  <FolderIcon color="action" fontSize="small" />
                </InputAdornment>
              ),
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                "& fieldset": {
                  borderColor: theme.palette.divider,
                },
                "&:hover fieldset": {
                  borderColor: theme.palette.primary.main,
                },
              },
            }}
          />
          <Tooltip title="排序方式">
            <IconButton
              size="small"
              onClick={handleSortMenuOpen}
              sx={{
                ml: 0.5,
                color: theme.palette.text.secondary,
                "&:hover": {
                  color: theme.palette.primary.main,
                },
              }}
            >
              {sortMode === "time" ? (
                <AccessTimeIcon fontSize="small" />
              ) : (
                <SortByAlphaIcon fontSize="small" />
              )}
              <ArrowDropDownIcon fontSize="small" sx={{ ml: -0.5 }} />
            </IconButton>
          </Tooltip>
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
          {loading ? <FileManagerSkeleton /> : renderFileList()}
        </Box>

        <Menu
          open={contextMenu !== null}
          onClose={handleContextMenuClose}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu !== null
              ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
              : undefined
          }
        >
          {/* 仅在单选时显示重命名 */}
          {selectedFiles.length <= 1 && (
            <MenuItem onClick={handleRename}>
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
          )}

          {/* 仅在单选时显示权限设置 */}
          {selectedFiles.length <= 1 && (
            <MenuItem onClick={handleOpenPermissions}>
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
          )}

          {/* 仅在单选时显示复制路径 */}
          {selectedFiles.length <= 1 && (
            <MenuItem onClick={handleCopyAbsolutePath}>
              <ListItemIcon>
                <LinkIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("fileManager.copy")}</ListItemText>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 2 }}
              >
                Ctrl+Shift+C
              </Typography>
            </MenuItem>
          )}

          {selectedFiles.length <= 1 && <Divider />}

          {/* 上传操作：仅在选中单个目录时显示 */}
          {selectedFiles.length === 1 && selectedFile?.isDirectory && (
            <MenuItem onClick={handleUploadFile}>
              <ListItemIcon>
                <UploadFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("fileManager.upload")}</ListItemText>
            </MenuItem>
          )}

          {selectedFiles.length === 1 && selectedFile?.isDirectory && (
            <MenuItem onClick={handleUploadFolder}>
              <ListItemIcon>
                <UploadFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("fileManager.upload")}</ListItemText>
            </MenuItem>
          )}

          {/* 下载操作：支持单选和多选 */}
          {getSelectedFiles().some((f) => !f.isDirectory) && (
            <MenuItem onClick={handleDownload}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                {selectedFiles.length > 1
                  ? `下载 ${selectedFiles.filter((f) => !f.isDirectory).length} 个文件`
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
          )}

          {getSelectedFiles().some((f) => f.isDirectory) && (
            <MenuItem onClick={handleDownloadFolder}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                {selectedFiles.length > 1
                  ? `下载 ${selectedFiles.filter((f) => f.isDirectory).length} 个文件夹`
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
          )}

          <Divider />

          {/* 删除操作：支持单选和多选 */}
          <MenuItem onClick={handleDelete}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {selectedFiles.length > 1
                ? `删除 ${selectedFiles.length} 个项目`
                : "删除"}
            </ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Delete
            </Typography>
          </MenuItem>
        </Menu>

        <Menu
          open={blankContextMenu !== null}
          onClose={handleBlankContextMenuClose}
          anchorReference="anchorPosition"
          anchorPosition={
            blankContextMenu !== null
              ? { top: blankContextMenu.mouseY, left: blankContextMenu.mouseX }
              : undefined
          }
        >
          <MenuItem onClick={handleCreateFolder}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>创建文件夹</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+Shift+N
            </Typography>
          </MenuItem>

          <MenuItem onClick={handleCreateFile}>
            <ListItemIcon>
              <NoteAddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>创建文件</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+N
            </Typography>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleUploadFile}>
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>上传文件至当前文件夹</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+U
            </Typography>
          </MenuItem>

          <MenuItem onClick={handleUploadFolder}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>上传文件夹至当前文件夹</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+Shift+U
            </Typography>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleRefresh}>
            <ListItemIcon>
              <RefreshIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>刷新目录</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              F5
            </Typography>
          </MenuItem>
        </Menu>

        {showRenameDialog && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1300,
            }}
          >
            <Paper
              sx={{
                width: "90%",
                maxWidth: 600,
                maxHeight: "80vh",
                p: 3,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "auto",
              }}
            >
              <Typography variant="subtitle1">编辑文件/文件夹</Typography>
              <form onSubmit={handleRenameSubmit}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <TextField
                    fullWidth
                    label="新名称"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    autoFocus
                    variant="outlined"
                    size="small"
                  />

                  {/* 权限设置已从重命名窗口剥离 */}

                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "flex-end",
                      mt: 2,
                      gap: 1,
                    }}
                  >
                    <Button
                      onClick={() => setShowRenameDialog(false)}
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
                  </Box>
                </Box>
              </form>
            </Paper>
          </Box>
        )}

        {showPermissionDialog && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1300,
            }}
          >
            <Paper
              sx={{
                width: "90%",
                maxWidth: 600,
                maxHeight: "80vh",
                p: 3,
                display: "flex",
                flexDirection: "column",
                gap: 2,
                overflow: "auto",
              }}
            >
              <Typography variant="subtitle1">
                {t("fileManager.permissions")}
              </Typography>
              <form onSubmit={handlePermissionDialogSubmit}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <FilePermissionEditor
                    permissions={permDialogPermissions}
                    onChange={setPermDialogPermissions}
                  />

                  <Box sx={{ display: "flex", gap: 2 }}>
                    <TextField
                      fullWidth
                      label="用户"
                      value={permDialogOwner}
                      onChange={(e) => setPermDialogOwner(e.target.value)}
                      variant="outlined"
                      size="small"
                    />
                    <TextField
                      fullWidth
                      label="用户组"
                      value={permDialogGroup}
                      onChange={(e) => setPermDialogGroup(e.target.value)}
                      variant="outlined"
                      size="small"
                    />
                  </Box>

                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "flex-end",
                      mt: 2,
                      gap: 1,
                    }}
                  >
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
                  </Box>
                </Box>
              </form>
            </Paper>
          </Box>
        )}

        {showCreateFolderDialog && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1300,
            }}
          >
            <Paper
              sx={{
                width: "80%",
                maxWidth: 400,
                p: 2,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <Typography variant="subtitle1">
                {t("fileManager.createFolder")}
              </Typography>
              <form onSubmit={handleCreateFolderSubmit}>
                <TextField
                  fullWidth
                  label={t("fileManager.createFolder")}
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  variant="outlined"
                  size="small"
                />
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "flex-end",
                    mt: 2,
                    gap: 1,
                  }}
                >
                  <Button
                    onClick={() => setShowCreateFolderDialog(false)}
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
                </Box>
              </form>
            </Paper>
          </Box>
        )}

        {showCreateFileDialog && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1300,
            }}
          >
            <Paper
              sx={{
                width: "80%",
                maxWidth: 400,
                p: 2,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <Typography variant="subtitle1">
                {t("fileManager.createFile")}
              </Typography>
              <form onSubmit={handleCreateFileSubmit}>
                <TextField
                  fullWidth
                  label={t("fileManager.createFile")}
                  value={newFileName}
                  onChange={(e) => setNewFileName(e.target.value)}
                  autoFocus
                  variant="outlined"
                  size="small"
                />
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "flex-end",
                    mt: 2,
                    gap: 1,
                  }}
                >
                  <Button
                    onClick={() => setShowCreateFileDialog(false)}
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
                </Box>
              </form>
            </Paper>
          </Box>
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

        <TransferProgressFloat
          transferList={transferProgressList}
          onCancelTransfer={handleCancelTransfer}
          onClose={() => {
            clearCompletedTransfers();
          }}
        />

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

