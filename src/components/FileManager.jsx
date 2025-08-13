import React, { useState, useEffect, memo, useCallback, useMemo } from "react";
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
import FolderIcon from "@mui/icons-material/Folder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RefreshIcon from "@mui/icons-material/Refresh";
import HomeIcon from "@mui/icons-material/Home";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import LinkIcon from "@mui/icons-material/Link";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import FilePreview from "./FilePreview.jsx";
import VirtualizedFileList from "./VirtualizedFileList.jsx";
import TransferProgressFloat from "./TransferProgressFloat.jsx";
import { formatLastRefreshTime } from "../core/utils/formatters.js";
import { debounce } from "../core/utils/performance.js";

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
    const [currentPath, setCurrentPath] = useState("/");
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [lastRefreshTime, setLastRefreshTime] = useState(null);
    const [directoryCache, setDirectoryCache] = useState({});
    const [contextMenu, setContextMenu] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [showSearch, setShowSearch] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
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
    const [transferProgressList, setTransferProgressList] = useState([]);
    const [transferCancelled, setTransferCancelled] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [notification, setNotification] = useState(null);
    const [uploadMenuAnchor, setUploadMenuAnchor] = useState(null);

    // 用于存储延迟移除定时器的引用
    const [autoRemoveTimers, setAutoRemoveTimers] = useState(new Map());

    // 缓存过期时间（毫秒）
    const CACHE_EXPIRY_TIME = 10000; // 10秒

    // 自动刷新相关参数
    const USER_ACTIVITY_REFRESH_DELAY = 300; // 将用户活动后刷新延迟从1000ms减少到300ms

    // 传输进度管理函数
    const generateTransferId = () => {
      return `transfer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    };

    // 添加新的传输任务
    const addTransferProgress = (transferData) => {
      const transferId = transferData.transferId || generateTransferId();
      const newTransfer = {
        transferId,
        ...transferData,
        startTime: Date.now(),
      };

      setTransferProgressList((prev) => [...prev, newTransfer]);
      return transferId;
    };

    // 更新传输进度
    const updateTransferProgress = (transferId, updateData) => {
      setTransferProgressList((prev) =>
        prev.map((transfer) =>
          transfer.transferId === transferId
            ? { ...transfer, ...updateData }
            : transfer,
        ),
      );

      // 如果传输被标记为取消，启动延迟移除定时器
      if (updateData.isCancelled) {
        // 清除已存在的定时器（如果有）
        setAutoRemoveTimers((prev) => {
          const newTimers = new Map(prev);
          const existingTimer = newTimers.get(transferId);
          if (existingTimer) {
            clearTimeout(existingTimer);
          }

          // 设置新的延迟移除定时器
          const timer = setTimeout(() => {
            removeTransferProgress(transferId);
            // 清理定时器引用
            setAutoRemoveTimers((current) => {
              const updated = new Map(current);
              updated.delete(transferId);
              return updated;
            });
          }, 1000); // 1秒延迟

          newTimers.set(transferId, timer);
          return newTimers;
        });
      }
    };

    // 移除传输任务
    const removeTransferProgress = (transferId) => {
      setTransferProgressList((prev) =>
        prev.filter((transfer) => transfer.transferId !== transferId),
      );

      // 清理对应的定时器
      setAutoRemoveTimers((prev) => {
        const newTimers = new Map(prev);
        const timer = newTimers.get(transferId);
        if (timer) {
          clearTimeout(timer);
          newTimers.delete(transferId);
        }
        return newTimers;
      });
    };

    // 清理已完成的传输任务
    const clearCompletedTransfers = () => {
      setTransferProgressList((prev) =>
        prev.filter(
          (transfer) =>
            transfer.progress < 100 && !transfer.isCancelled && !transfer.error,
        ),
      );
    };

    // 清理所有传输任务
    const clearAllTransfers = () => {
      setTransferProgressList([]);
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
          error.includes("用户已取消") ||
          error.includes("用户取消") ||
          error.includes("已中断")
        );
      }

      // 如果是带有message属性的错误对象
      if (error.message) {
        return (
          error.message.includes("cancel") ||
          error.message.includes("abort") ||
          error.message.includes("用户已取消") ||
          error.message.includes("用户取消") ||
          error.message.includes("已中断")
        );
      }

      // 如果是API响应对象
      if (error.error) {
        return (
          error.error.includes("cancel") ||
          error.error.includes("abort") ||
          error.error.includes("用户已取消") ||
          error.error.includes("用户取消") ||
          error.error.includes("已中断") ||
          error.userCancelled ||
          error.cancelled
        );
      }

      // 检查特殊标志
      return error.userCancelled || error.cancelled;
    };

    // 确保组件有logToFile函数
    const logToFile = (message, type) => {
      if (window.terminalAPI && window.terminalAPI.log) {
        window.terminalAPI.log(message, type);
      } else {
      }
    };

    // 更新当前路径并通知父组件
    const updateCurrentPath = (newPath) => {
      setCurrentPath(newPath);
      if (onPathChange && tabId) {
        onPathChange(tabId, newPath);
      }
    };

    // 当SSH连接改变时，重置状态并加载目录
    useEffect(() => {
      if (open && sshConnection && tabId) {
        // 先检查API是否可用
        if (!window.terminalAPI || !window.terminalAPI.listFiles) {
          setError("文件管理API不可用");
          return;
        }

        // 清空缓存
        setDirectoryCache({});

        // 使用记忆的路径或默认路径
        const pathToLoad = initialPath || "/";
        updateCurrentPath(pathToLoad);
        setPathInput(pathToLoad);
        loadDirectory(pathToLoad);
      }
    }, [open, sshConnection, tabId, initialPath]);

    // 从缓存中获取目录内容
    const getDirectoryFromCache = (path) => {
      if (!directoryCache[path]) return null;

      const cacheEntry = directoryCache[path];
      const now = Date.now();

      // 检查缓存是否过期
      if (now - cacheEntry.timestamp > CACHE_EXPIRY_TIME) {
        return null;
      }
      return cacheEntry.data;
    };

    // 更新目录缓存
    const updateDirectoryCache = (path, data) => {
      setDirectoryCache((prevCache) => ({
        ...prevCache,
        [path]: {
          data,
          timestamp: Date.now(),
        },
      }));
    };

    // 静默刷新当前目录（不显示加载指示器）
    const silentRefreshCurrentDirectory = async () => {
      if (!sshConnection || !tabId || !currentPath) return;

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
            setTimeout(() => reject(new Error('刷新超时')), 3000)
          );
          
          try {
            const response = await Promise.race([
              window.terminalAPI.listFiles(tabId, apiPath, options),
              timeoutPromise
            ]);

            if (response?.success) {
              const fileData = response.data || [];

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

    // 修改loadDirectory，添加刷新时间记录
    const loadDirectory = async (
      path,
      retryCount = 0,
      forceRefresh = false,
    ) => {
      if (!sshConnection || !tabId) {
        setError("缺少SSH连接信息");
        return;
      }

      // 如果不是强制刷新，尝试从缓存获取数据
      if (!forceRefresh) {
        const cachedData = getDirectoryFromCache(path);
        if (cachedData) {
          setFiles(cachedData);
          updateCurrentPath(path);
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
          };

          const response = await window.terminalAPI.listFiles(
            tabId,
            apiPath,
            options,
          );

          if (response?.success) {
            const fileData = response.data || [];

            // 更新缓存
            updateDirectoryCache(path, fileData);

            setFiles(fileData);
            updateCurrentPath(path); // 保持UI中显示~
            setPathInput(path);
            // 加载新目录时重置选中文件
            setSelectedFile(null);

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

                setError(`加载目录失败，正在重试 (${retryCount + 1}/5)...`);

                // 添加延迟，避免立即重试
                setTimeout(() => {
                  loadDirectory(path, retryCount + 1, forceRefresh);
                }, waitTime);
                return;
              }
            }

            // 重试失败或其他错误
            setError(response?.error || "加载目录失败");
          }
        } else {
          setError("文件管理API不可用");
        }
      } catch (error) {
        // 加载目录失败

        // 如果是异常错误且重试次数未达到上限，则进行重试
        if (retryCount < 5) {
          // 增加重试等待时间，指数退避算法
          const waitTime = Math.min(500 * Math.pow(1.5, retryCount), 5000); // 最长等待5秒

          setError(`加载目录失败，正在重试 (${retryCount + 1}/5)...`);

          // 添加延迟，避免立即重试
          setTimeout(() => {
            loadDirectory(path, retryCount + 1, forceRefresh);
          }, waitTime);
          return;
        }

        setError("加载目录失败：" + (error.message || "未知错误"));
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

    // 处理右键菜单
    const handleContextMenu = (event, file) => {
      event.preventDefault();
      setSelectedFile(file);
      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    };

    // 关闭右键菜单
    const handleContextMenuClose = () => {
      setContextMenu(null);
    };

    // 处理删除
    const handleDelete = async () => {
      if (!selectedFile || !sshConnection) return;

      // 立即保存当前选中的文件信息，避免状态变化导致问题
      const fileToDelete = { ...selectedFile };
      
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
              
              // 成功删除，刷新目录
              await loadDirectory(currentPath);
              
              // 删除操作完成后设置定时器再次检查
              refreshAfterUserActivity();
            } else if (
              response?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              // SFTP错误，尝试重试
              retryCount++;
              setError(
                `删除文件失败，正在重试 (${retryCount}/${maxRetries})...`,
              );

              // 添加延迟后重试
              setTimeout(attemptDelete, 500 * retryCount);
              return;
            } else {
              // 其他错误或已达到最大重试次数
              setError(response?.error || "删除文件失败");
              // 即使删除失败也重置选中文件状态
              setSelectedFile(null);
            }
          }
        } catch (error) {
          // 删除文件失败

          if (retryCount < maxRetries) {
            // 发生异常，尝试重试
            retryCount++;
            setError(`删除文件失败，正在重试 (${retryCount}/${maxRetries})...`);

            // 添加延迟后重试
            setTimeout(attemptDelete, 500 * retryCount);
            return;
          }

          setError("删除文件失败: " + (error.message || "未知错误"));
          // 即使删除失败也重置选中文件状态
          setSelectedFile(null);
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
            fileName: "准备上传...",
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
              fileName: result.message || "上传完成",
            });

            // 传输完成后延迟移除
            setTimeout(() => removeTransferProgress(transferId), 3000);

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
              logToFile("FileManager: 上传被用户取消，跳过错误显示", "INFO");
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: "用户已取消",
              });
            }
          } else if (!transferCancelled) {
            // 检查是否是取消操作相关的错误
            if (!isUserCancellationError(result)) {
              // 只有在不是用户主动取消的情况下才显示错误
              setError(result.error || "上传文件失败");
              updateTransferProgress(transferId, {
                error: result.error || "上传文件失败",
              });
            } else {
              logToFile(
                "FileManager: 检测到用户取消操作，跳过错误显示",
                "INFO",
              );
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: "用户已取消",
              });
            }
          }

          // 无论上传结果如何，都刷新文件列表
          refreshAfterUserActivity();
        }
      } catch (error) {
        // 上传文件失败

        // 只有在不是用户主动取消的情况下才显示错误
        if (
          !transferCancelled &&
          !isUserCancellationError(error) &&
          !error.message?.includes("reply was never sent")
        ) {
          setError("上传文件失败: " + (error.message || "未知错误"));
          // 更新所有未完成的传输为错误状态
          setTransferProgressList((prev) =>
            prev.map((transfer) =>
              transfer.progress < 100 && !transfer.isCancelled
                ? { ...transfer, error: error.message || "未知错误" }
                : transfer,
            ),
          );
        } else {
          logToFile(
            `FileManager: 跳过取消操作错误显示: ${error.message}`,
            "INFO",
          );
          setTransferCancelled(true);
          // 标记所有未完成的传输为取消状态
          setTransferProgressList((prev) =>
            prev.map((transfer) =>
              transfer.progress < 100 && !transfer.isCancelled
                ? {
                    ...transfer,
                    isCancelled: true,
                    cancelMessage: "用户已取消",
                  }
                : transfer,
            ),
          );
        }

        // 无论上传结果如何，都刷新文件列表
        refreshAfterUserActivity();
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
            fileName: "准备上传文件夹...",
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
            setTimeout(() => removeTransferProgress(transferId), 3000);

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
              logToFile(
                "FileManager: 上传文件夹被用户取消，跳过错误显示",
                "INFO",
              );
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: "用户已取消",
              });
            }
          } else if (!transferCancelled) {
            // 检查是否是取消操作相关的错误
            if (!isUserCancellationError(result)) {
              // 只有在不是用户主动取消的情况下才显示错误
              setError(result.error || "上传文件夹失败");
              updateTransferProgress(transferId, {
                error: result.error || "上传文件夹失败",
              });
            } else {
              logToFile(
                "FileManager: 检测到用户取消操作，跳过错误显示",
                "INFO",
              );
              setTransferCancelled(true);
              updateTransferProgress(transferId, {
                isCancelled: true,
                cancelMessage: "用户已取消",
              });
            }
          }

          // 无论上传结果如何，都刷新文件列表
          refreshAfterUserActivity();
        }
      } catch (error) {
        // 上传文件夹失败

        // 只有在不是用户主动取消的情况下才显示错误
        if (
          !transferCancelled &&
          !isUserCancellationError(error) &&
          !error.message?.includes("reply was never sent")
        ) {
          setError("上传文件夹失败: " + (error.message || "未知错误"));
        } else {
          logToFile(
            `FileManager: 跳过文件夹上传取消操作错误显示: ${error.message}`,
            "INFO",
          );
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
        setError("复制路径失败: " + (error.message || "未知错误"));
      }
      handleContextMenuClose();
    };

  // 过滤文件列表（根据搜索词） - 优化版本，使用useMemo缓存
  const filteredFiles = useMemo(() => {
    if (!searchTerm) return files;
    
    const searchTermLower = searchTerm.toLowerCase();
    return files.filter((file) =>
      file.name.toLowerCase().includes(searchTermLower),
    );
  }, [files, searchTerm]);

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

      // 使用虚拟化文件列表组件
      return (
        <VirtualizedFileList
          files={files}
          onFileActivate={handleFileActivate}
          onContextMenu={handleContextMenu}
          selectedFile={selectedFile}
          height="100%"
          itemHeight={48}
          searchTerm={searchTerm}
          onBlankContextMenu={handleBlankContextMenu}
        />
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

                // 记录取消成功
                logToFile(
                  `FileManager: 传输 ${transferKey} 已成功取消`,
                  "INFO",
                );
              } else {
                // 仍然更新UI以避免用户困惑
                updateTransferProgress(transfer.transferId, {
                  progress: 0,
                  isCancelled: true,
                  cancelMessage: "传输已中断",
                });

                // 记录取消失败但显示为成功
                logToFile(
                  `FileManager: 传输取消API返回失败，但界面仍显示已取消: ${result.error || "未知错误"}`,
                  "WARN",
                );
              }
            } catch (apiError) {
              // API调用失败，但仍标记为取消
              updateTransferProgress(transfer.transferId, {
                progress: 0,
                isCancelled: true,
                cancelMessage: "传输已中断",
              });

              logToFile(
                `FileManager: 取消传输API调用失败: ${apiError.message}`,
                "ERROR",
              );
            }
          } else {
            // API不可用，直接标记为取消
            updateTransferProgress(transfer.transferId, {
              progress: 0,
              isCancelled: true,
              cancelMessage: "传输已中断",
            });

            logToFile(
              "FileManager: 取消API不可用，直接标记传输为已取消",
              "INFO",
            );
          }
        }

        // 添加额外延迟，确保取消操作完成后再刷新
        setTimeout(() => {
          // 无论是否成功取消传输，都刷新文件列表
          refreshAfterUserActivity();

          // 也执行一次强制刷新
          loadDirectory(currentPath, 0, true);
        }, 800); // 延迟800ms等待后端处理完成
      } catch (error) {
        // 取消传输失败
        logToFile(
          `FileManager: 取消传输过程中发生错误: ${error.message}`,
          "ERROR",
        );

        // 即使出现错误，也标记相关传输为已中断
        transfersToCancel.forEach((transfer) => {
          updateTransferProgress(transfer.transferId, {
            progress: 0,
            isCancelled: true,
            cancelMessage: "传输已中断",
          });
        });

        // 发生错误时也刷新文件列表，确保UI状态一致
        setTimeout(() => {
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
      setSelectedFile(null);

      setBlankContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    };

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
              // 创建文件夹操作完成后设置定时器再次检查
              refreshAfterUserActivity();
            } else if (
              response?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              // SFTP错误，尝试重试
              retryCount++;
              setError(
                `创建文件夹失败，正在重试 (${retryCount}/${maxRetries})...`,
              );

              // 添加延迟后重试
              setTimeout(attemptCreateFolder, 500 * retryCount);
              return;
            } else {
              // 其他错误或已达到最大重试次数
              setError(response?.error || "创建文件夹失败");
              setShowCreateFolderDialog(false);
            }
          } else {
            setError("创建文件夹API不可用");
            setShowCreateFolderDialog(false);
          }
        } catch (error) {
          // 创建文件夹失败

          if (retryCount < maxRetries) {
            // 发生异常，尝试重试
            retryCount++;
            setError(
              `创建文件夹失败，正在重试 (${retryCount}/${maxRetries})...`,
            );

            // 添加延迟后重试
            setTimeout(attemptCreateFolder, 500 * retryCount);
            return;
          }

          setError("创建文件夹失败: " + (error.message || "未知错误"));
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
            // 创建文件操作完成后设置定时器再次检查
            refreshAfterUserActivity();
          } else {
            setError(`创建文件失败: ${result.error || "未知错误"}`);
          }
        } else {
          setError("创建文件API不可用");
        }
      } catch (error) {
        setError("创建文件失败: " + (error.message || "未知错误"));
      } finally {
        setLoading(false);
        setShowCreateFileDialog(false);
      }
    };

    // 用户活动后的刷新函数，使用防抖优化
    const refreshAfterUserActivity = debounce(() => {
      if (currentPath) {
        silentRefreshCurrentDirectory();
      }
    }, USER_ACTIVITY_REFRESH_DELAY);

    // 在特定的回调函数中调用refreshAfterUserActivity

    // 处理文件激活（双击）
    const handleFileActivate = (file) => {
      if (file.isDirectory) {
        // 如果是目录，进入该目录
        const newPath =
          currentPath === "/" ? "/" + file.name : currentPath + "/" + file.name;

        handleEnterDirectory(newPath);
      } else {
        // 如果是文件，打开预览
        setFilePreview(file);
        setShowPreview(true);

        // 文件查看后延迟刷新，检测是否有变化
        refreshAfterUserActivity();
      }
    };

    // 关闭预览
    const handleClosePreview = () => {
      setShowPreview(false);
    };

    // 修改文件操作相关处理函数，在文件操作后调用refreshAfterUserActivity

    // 处理下载
    const handleDownload = async () => {
      if (!selectedFile || !sshConnection) return;

      // 重置取消状态
      setTransferCancelled(false);

      // 保存当前路径状态
      const savedCurrentPath = currentPath;
      const savedSelectedFile = selectedFile;

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
            setTimeout(() => removeTransferProgress(transferId), 3000);
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
          setError("下载文件失败: " + (error.message || "未知错误"));
          // 更新所有未完成的传输为错误状态
          setTransferProgressList((prev) =>
            prev.map((transfer) =>
              transfer.progress < 100 && !transfer.isCancelled
                ? { ...transfer, error: error.message || "未知错误" }
                : transfer,
            ),
          );
        }
      }
      handleContextMenuClose();
    };

    // 显示通知的辅助函数，增强版
    const showNotification = (
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

      // 自动关闭通知（除非是错误或指定了更长的持续时间）
      if (severity !== "error" && duration > 0) {
        setTimeout(() => setNotification(null), duration);
      }
    };

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

      // 确保有选中的文件夹
      if (!selectedFile) {
        showNotification("请先选择要下载的文件夹", "warning");
        return;
      }

      // 保存当前路径状态
      const savedCurrentPath = currentPath;
      const savedSelectedFile = selectedFile;

      if (!savedSelectedFile.isDirectory) {
        return handleDownload();
      }

      // 重置取消状态
      setTransferCancelled(false);

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
            setTimeout(() => {
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
          showNotification("下载已被用户取消", "info");
        } else if (error.message?.includes("reply was never sent")) {
          showNotification("下载进程异常中断，请重试", "warning", 8000);
        } else if (error.message?.includes("用户取消下载")) {
          // 特别处理这个可能误报的情况，提供更详细的解释
          showNotification(
            "下载路径选择有问题，请重试并确保正确选择下载文件夹",
            "warning",
            10000,
            true,
            () => {
              setTimeout(() => handleDownloadFolder(), 500);
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
            "下载文件夹失败: " + (error.message || "未知错误"),
            "error",
            10000,
          );
        }

        // 提供重试选项
        if (
          error &&
          !transferCancelled &&
          !error.message?.includes("用户取消下载")
        ) {
          setTimeout(() => {
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
        setTransferProgressList((prev) =>
          prev.map((transfer) =>
            transfer.progress < 100 && !transfer.isCancelled
              ? { ...transfer, error: error.message || "未知错误" }
              : transfer,
          ),
        );
      }
      handleContextMenuClose();
    };

    // 处理重命名
    const handleRename = () => {
      if (!selectedFile) return;
      setNewName(selectedFile.name);
      setShowRenameDialog(true);
      handleContextMenuClose();
    };

    // 处理重命名提交
    const handleRenameSubmit = async (e) => {
      e.preventDefault();
      setShowRenameDialog(false);

      if (!selectedFile || !newName || newName === selectedFile.name) return;

      setLoading(true);
      setError(null);
      let retryCount = 0;
      const maxRetries = 3;

      const attemptRename = async () => {
        try {
          const oldPath =
            currentPath === "/"
              ? "/" + selectedFile.name
              : currentPath
                ? currentPath + "/" + selectedFile.name
                : selectedFile.name;

          if (window.terminalAPI && window.terminalAPI.renameFile) {
            const response = await window.terminalAPI.renameFile(
              tabId,
              oldPath,
              newName,
            );

            if (response?.success) {
              // 成功重命名，刷新目录
              await loadDirectory(currentPath);
              // 重命名操作完成后设置定时器再次检查
              refreshAfterUserActivity();
            } else if (
              response?.error?.includes("SFTP错误") &&
              retryCount < maxRetries
            ) {
              // SFTP错误，尝试重试
              retryCount++;
              setError(`重命名失败，正在重试 (${retryCount}/${maxRetries})...`);

              // 添加延迟后重试
              setTimeout(attemptRename, 500 * retryCount);
              return;
            } else {
              // 其他错误或已达到最大重试次数
              setError(response?.error || "重命名失败");
            }
          }
        } catch (error) {
          // 重命名失败

          if (retryCount < maxRetries) {
            // 发生异常，尝试重试
            retryCount++;
            setError(`重命名失败，正在重试 (${retryCount}/${maxRetries})...`);

            // 添加延迟后重试
            setTimeout(attemptRename, 500 * retryCount);
            return;
          }

          setError("重命名失败: " + (error.message || "未知错误"));
        } finally {
          if (retryCount === 0 || retryCount >= maxRetries) {
            setLoading(false);
          }
        }
      };

      attemptRename();
    };

    // 处理键盘快捷键
    const handleKeyDown = (event) => {
      // 只有当文件管理器打开时才处理键盘事件
      if (!open) return;

      // Ctrl+D: 下载文件/文件夹
      if (event.ctrlKey && event.key === "d") {
        event.preventDefault(); // 阻止默认行为

        // 如果有选中的文件/文件夹，则触发下载
        if (selectedFile) {
          if (selectedFile.isDirectory) {
            handleDownloadFolder();
          } else {
            handleDownload();
          }
        } else {
          showNotification("请先选择要下载的文件或文件夹", "warning");
        }
      }
    };

    // 添加和移除键盘事件监听器
    useEffect(() => {
      if (open) {
        window.addEventListener("keydown", handleKeyDown);
      }

      // 清理函数
      return () => {
        window.removeEventListener("keydown", handleKeyDown);
      };
    }, [open, selectedFile, handleDownload, handleDownloadFolder]); // 添加所有需要的依赖项

    // 处理关闭文件管理器
    const handleClose = () => {
      // 检查是否有正在进行的传输
      const activeTransfers = transferProgressList.filter(
        (t) => t.progress < 100 && !t.isCancelled && !t.error,
      );

      if (activeTransfers.length > 0) {
        // 构建传输类型描述
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

        // 显示确认对话框，询问用户是否确定要取消传输
        const isConfirmed = window.confirm(
          `有正在进行的${transferTypeDescription}任务，关闭窗口将中断传输。是否继续？`,
        );

        if (isConfirmed) {
          // 先禁用关闭按钮防止用户多次点击
          setIsClosing(true);

          // 标记所有传输为取消中状态
          activeTransfers.forEach((transfer) => {
            updateTransferProgress(transfer.transferId, {
              cancelMessage: "正在取消传输...",
            });
          });

          // 执行取消传输操作
          handleCancelTransfer()
            .then(() => {
              // 添加短暂延迟确保取消操作完成
              setTimeout(() => {
                logToFile &&
                  logToFile(
                    "FileManager: Closing window after cancelling transfer",
                    "INFO",
                  );
                onClose();
              }, 300);
            })
            .catch((error) => {
              // 取消传输失败，即使取消失败也关闭窗口，但添加延迟确保取消请求被发送
              setTimeout(() => {
                logToFile &&
                  logToFile(
                    "FileManager: Closing window after transfer cancel error",
                    "WARN",
                  );
                onClose();
              }, 300);
            });
        }
        // 如果用户选择不关闭，则不执行任何操作
      } else {
        // 没有传输或传输已完成/已取消，直接关闭
        onClose();
      }
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

    // 组件卸载时清理所有定时器
    useEffect(() => {
      return () => {
        // 清理所有延迟移除定时器
        autoRemoveTimers.forEach((timer) => {
          clearTimeout(timer);
        });
      };
    }, [autoRemoveTimers]);

    return (
      <Paper
        sx={{
          width: open ? 300 : 0,
          height: "100%",
          overflow: "hidden",
          transition: (theme) =>
            theme.transitions.create("width", {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          display: "flex",
          flexDirection: "column",
          position: "relative",
          borderTopRightRadius: 0,
          borderBottomRightRadius: 0,
        }}
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
            {tabName ? `文件管理 - ${tabName}` : "文件管理"}
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
          <Tooltip title="返回上级目录">
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

          <Tooltip title="主目录">
            <IconButton size="small" onClick={handleGoHome}>
              <HomeIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="刷新">
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
            <Tooltip title="上次刷新时间">
              <Box component="span" sx={{ fontSize: "0.75rem", opacity: 0.8 }}>
                上次刷新: {formatLastRefreshTime(lastRefreshTime)}
              </Box>
            </Tooltip>
          </Box>

          <Box sx={{ flexGrow: 1 }} />

          <Tooltip title="搜索">
            <IconButton size="small" onClick={toggleSearch}>
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title="上传">
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
              size="small"
              fullWidth
              placeholder="搜索文件..."
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
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
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
          }}
        >
          <TextField
            fullWidth
            size="small"
            variant="outlined"
            value={pathInput}
            onChange={handlePathInputChange}
            onKeyDown={handlePathInputSubmit}
            placeholder="输入路径..."
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
          {renderFileList()}
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
          <MenuItem onClick={handleRename}>
            <ListItemIcon>
              <DriveFileRenameOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>重命名</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleCopyAbsolutePath}>
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>复制绝对路径</ListItemText>
          </MenuItem>

          <Divider />

          {selectedFile?.isDirectory && (
            <MenuItem onClick={handleUploadFile}>
              <ListItemIcon>
                <UploadFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>上传文件到此文件夹</ListItemText>
            </MenuItem>
          )}

          {selectedFile?.isDirectory && (
            <MenuItem onClick={handleUploadFolder}>
              <ListItemIcon>
                <UploadFileIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>上传文件夹到此文件夹</ListItemText>
            </MenuItem>
          )}

          {!selectedFile?.isDirectory && (
            <MenuItem onClick={handleDownload}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>下载文件</ListItemText>
            </MenuItem>
          )}

          {selectedFile?.isDirectory && (
            <MenuItem onClick={handleDownloadFolder}>
              <ListItemIcon>
                <DownloadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>下载文件夹</ListItemText>
            </MenuItem>
          )}

          <MenuItem onClick={handleDelete}>
            <ListItemIcon>
              <DeleteIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>删除</ListItemText>
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
          </MenuItem>

          <MenuItem onClick={handleCreateFile}>
            <ListItemIcon>
              <NoteAddIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>创建文件</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleUploadFile}>
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>上传文件至当前文件夹</ListItemText>
          </MenuItem>

          <MenuItem onClick={handleUploadFolder}>
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>上传文件夹至当前文件夹</ListItemText>
          </MenuItem>

          <Divider />

          <MenuItem onClick={handleRefresh}>
            <ListItemIcon>
              <RefreshIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>刷新目录</ListItemText>
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
                width: "80%",
                maxWidth: 400,
                p: 2,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <Typography variant="subtitle1">重命名</Typography>
              <form onSubmit={handleRenameSubmit}>
                <TextField
                  fullWidth
                  label="新名称"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
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
                    onClick={() => setShowRenameDialog(false)}
                    color="inherit"
                    size="small"
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    size="small"
                  >
                    确定
                  </Button>
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
              <Typography variant="subtitle1">创建文件夹</Typography>
              <form onSubmit={handleCreateFolderSubmit}>
                <TextField
                  fullWidth
                  label="文件夹名称"
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
                    取消
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    size="small"
                  >
                    确定
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
              <Typography variant="subtitle1">创建文件</Typography>
              <form onSubmit={handleCreateFileSubmit}>
                <TextField
                  fullWidth
                  label="文件名称"
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
                    取消
                  </Button>
                  <Button
                    type="submit"
                    variant="contained"
                    color="primary"
                    size="small"
                  >
                    确定
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
          onClose={() => {clearCompletedTransfers();
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
            <ListItemText>上传文件</ListItemText>
          </MenuItem>
          <MenuItem onClick={handleUploadFolderFromMenu}>
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>上传文件夹</ListItemText>
          </MenuItem>
        </Menu>
      </Paper>
    );
  },
);

FileManager.displayName = "FileManager";

export default FileManager;
