import React, { useState, useEffect } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  ListItemButton,
  Divider,
  CircularProgress,
  TextField,
  InputAdornment,
  Tooltip,
  Menu,
  MenuItem,
  Button,
  LinearProgress,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import FolderIcon from "@mui/icons-material/Folder";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
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
import CancelIcon from "@mui/icons-material/Cancel";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import FilePreview from "./FilePreview.jsx";

const FileManager = ({ open, onClose, sshConnection, tabId }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPath, setCurrentPath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [files, setFiles] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [showRenameDialog, setShowRenameDialog] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  // 新增状态
  const [blankContextMenu, setBlankContextMenu] = useState(null);
  const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showCreateFileDialog, setShowCreateFileDialog] = useState(false);
  const [newFileName2, setNewFileName2] = useState("");

  // 文件预览相关状态
  const [previewFile, setPreviewFile] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  // 传输进度相关状态
  const [transferProgress, setTransferProgress] = useState(null);
  const [transferCancelled, setTransferCancelled] = useState(false);

  // 目录内容缓存
  const [directoryCache, setDirectoryCache] = useState({});
  // 缓存过期时间（毫秒）
  const CACHE_EXPIRY_TIME = 10000; // 10秒

  // 自动刷新相关状态
  const [lastRefreshTime, setLastRefreshTime] = useState(Date.now());

  // 配置参数
  const USER_ACTIVITY_REFRESH_DELAY = 1000; // 用户活动后刷新延迟

  // 当SSH连接改变时，重置状态并加载目录
  useEffect(() => {
    if (open && sshConnection && tabId) {
      console.log("FileManager: Loading files for tab", tabId);

      // 先检查API是否可用
      if (!window.terminalAPI || !window.terminalAPI.listFiles) {
        console.error("FileManager: listFiles API not available");
        setError("文件管理API不可用");
        return;
      }

      // 清空缓存
      setDirectoryCache({});

      setCurrentPath("/");
      setPathInput("/");
      loadDirectory("/");
    }
  }, [open, sshConnection, tabId]);

  // 从缓存中获取目录内容
  const getDirectoryFromCache = (path) => {
    if (!directoryCache[path]) return null;

    const cacheEntry = directoryCache[path];
    const now = Date.now();

    // 检查缓存是否过期
    if (now - cacheEntry.timestamp > CACHE_EXPIRY_TIME) {
      // 缓存已过期
      console.log(`FileManager: Cache for ${path} expired`);
      return null;
    }

    console.log(`FileManager: Using cached data for ${path}`);
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
      console.log(`FileManager: Silent refreshing directory "${currentPath}"`);

      if (window.terminalAPI && window.terminalAPI.listFiles) {
        // 将~转换为空字符串，用于API调用
        const apiPath = currentPath === "~" ? "" : currentPath;

        // 使用可合并的目录读取操作
        const options = {
          type: "readdir",
          path: apiPath,
          canMerge: true,
          priority: "low", // 使用低优先级，避免阻塞用户主动操作
        };

        const response = await window.terminalAPI.listFiles(
          tabId,
          apiPath,
          options,
        );

        if (response?.success) {
          const fileData = response.data || [];

          // 检查数据是否有变化
          const currentFiles = JSON.stringify(files);
          const newFiles = JSON.stringify(fileData);

          if (currentFiles !== newFiles) {
            console.log(
              "FileManager: Directory content changed, updating view",
            );
            // 更新缓存
            updateDirectoryCache(currentPath, fileData);
            // 更新视图
            setFiles(fileData);
            // 加载新目录时重置选中文件
            setSelectedFile(null);
          } else {
            console.log("FileManager: Directory content unchanged");
          }

          // 记录刷新时间
          setLastRefreshTime(Date.now());
        } else {
          console.error("Silent refresh failed:", response?.error);
          // 静默刷新失败不显示错误，只记录日志
        }
      }
    } catch (error) {
      console.error("Silent refresh failed:", error);
      // 静默刷新失败不显示错误，只记录日志
    }
  };

  // 修改loadDirectory，添加刷新时间记录
  const loadDirectory = async (path, retryCount = 0, forceRefresh = false) => {
    if (!sshConnection || !tabId) {
      console.error("FileManager: Missing SSH connection or tabId");
      setError("缺少SSH连接信息");
      return;
    }

    // 如果不是强制刷新，尝试从缓存获取数据
    if (!forceRefresh) {
      const cachedData = getDirectoryFromCache(path);
      if (cachedData) {
        console.log(`FileManager: Using cached files for path "${path}"`);
        setFiles(cachedData);
        setCurrentPath(path);
        setPathInput(path);
        // 加载新目录时重置选中文件
        setSelectedFile(null);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      console.log(
        `FileManager: Listing files at path "${path}" for tab ${tabId}`,
      );
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
        console.log("FileManager: Got response", response);

        if (response?.success) {
          const fileData = response.data || [];

          // 更新缓存
          updateDirectoryCache(path, fileData);

          setFiles(fileData);
          setCurrentPath(path); // 保持UI中显示~
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
              // 增加到5次重试
              console.log(
                `FileManager: 连接错误，尝试重试 (${retryCount + 1}/5)`,
              );

              // 增加重试等待时间，指数退避算法
              const waitTime = Math.min(500 * Math.pow(1.5, retryCount), 5000); // 最长等待5秒

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
        console.error("FileManager: listFiles API not available");
        setError("文件管理API不可用");
      }
    } catch (error) {
      console.error("加载目录失败:", error);

      // 如果是异常错误且重试次数未达到上限，则进行重试
      if (retryCount < 5) {
        // 增加到5次重试
        console.log(`FileManager: 错误，尝试重试 (${retryCount + 1}/5)`);

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

  // 处理搜索
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

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

    setLoading(true);
    setError(null);
    let retryCount = 0;
    const maxRetries = 3;

    const attemptDelete = async () => {
      try {
        const fullPath =
          currentPath === "/"
            ? "/" + selectedFile.name
            : currentPath
              ? currentPath + "/" + selectedFile.name
              : selectedFile.name;

        if (window.terminalAPI && window.terminalAPI.deleteFile) {
          const response = await window.terminalAPI.deleteFile(
            tabId,
            fullPath,
            selectedFile.isDirectory,
          );

          if (response?.success) {
            // 成功删除，刷新目录
            await loadDirectory(currentPath);
            // 删除操作完成后设置定时器再次检查
            refreshAfterUserActivity();
            // 重置选中文件，避免使用已删除的文件夹作为上传目标
            setSelectedFile(null);
          } else if (
            response?.error?.includes("SFTP错误") &&
            retryCount < maxRetries
          ) {
            // SFTP错误，尝试重试
            retryCount++;
            console.log(`删除文件失败，尝试重试 (${retryCount}/${maxRetries})`);
            setError(`删除文件失败，正在重试 (${retryCount}/${maxRetries})...`);

            // 添加延迟后重试
            setTimeout(attemptDelete, 500 * retryCount);
            return;
          } else {
            // 其他错误或已达到最大重试次数
            setError(response?.error || "删除文件失败");
          }
        }
      } catch (error) {
        console.error("删除文件失败:", error);

        if (retryCount < maxRetries) {
          // 发生异常，尝试重试
          retryCount++;
          console.log(`删除文件失败，尝试重试 (${retryCount}/${maxRetries})`);
          setError(`删除文件失败，正在重试 (${retryCount}/${maxRetries})...`);

          // 添加延迟后重试
          setTimeout(attemptDelete, 500 * retryCount);
          return;
        }

        setError("删除文件失败: " + (error.message || "未知错误"));
      } finally {
        if (retryCount === 0 || retryCount >= maxRetries) {
          setLoading(false);
          handleContextMenuClose();
        }
      }
    };

    attemptDelete();
  };

  // 处理上传文件到当前目录
  const handleUploadFile = async () => {
    handleContextMenuClose();
    handleBlankContextMenuClose(); // 同时关闭空白区域菜单

    if (!sshConnection) return;

    // 重置取消状态
    setTransferCancelled(false);

    try {
      // 构建目标路径，确保路径格式正确
      let targetPath;

      // 只有当 selectedFile 不为 null 且为文件夹时才上传到选中的文件夹
      // 这确保了从空白区域菜单调用时使用当前目录
      if (selectedFile && selectedFile.isDirectory) {
        // 上传到选中的文件夹
        if (currentPath === "/") {
          targetPath = "/" + selectedFile.name;
        } else if (currentPath === "~") {
          targetPath = "~/" + selectedFile.name;
        } else {
          targetPath = currentPath + "/" + selectedFile.name;
        }
      } else {
        // 上传到当前文件夹
        targetPath = currentPath;
      }

      console.log(`Uploading to path: ${targetPath}`);

      if (window.terminalAPI && window.terminalAPI.uploadFile) {
        // 设置初始传输进度状态
        setTransferProgress({
          type: "upload",
          progress: 0,
          fileName: "",
          transferredBytes: 0,
          totalBytes: 0,
          transferSpeed: 0,
          remainingTime: 0,
          currentFileIndex: 0,
          totalFiles: 0,
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
          ) => {
            setTransferProgress({
              type: "upload",
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              currentFileIndex,
              totalFiles,
            });
          },
        );

        if (result.success) {
          // 上传完成后清除进度状态
          setTimeout(() => setTransferProgress(null), 1500);
          await loadDirectory(currentPath);
          // 上传文件操作完成后设置定时器再次检查
          refreshAfterUserActivity();

          // 如果有警告信息（部分文件上传失败），显示给用户
          if (result.partialSuccess && result.warning) {
            setError(result.warning);
          }
        } else if (!transferCancelled) {
          // 只有在不是用户主动取消的情况下才显示错误
          setError(result.error || "上传文件失败");
          setTransferProgress(null);
        }
      }
    } catch (error) {
      console.error("上传文件失败:", error);

      // 只有在不是用户主动取消的情况下才显示错误
      if (
        !transferCancelled &&
        !error.message?.includes("reply was never sent")
      ) {
        setError("上传文件失败: " + (error.message || "未知错误"));
      }

      setTransferProgress(null);
    }
  };

  // 处理上传文件夹到当前目录
  const handleUploadFolder = async () => {
    handleContextMenuClose();
    handleBlankContextMenuClose(); // 同时关闭空白区域菜单

    if (!sshConnection) return;

    // 重置取消状态
    setTransferCancelled(false);

    try {
      // 构建目标路径，确保路径格式正确
      let targetPath;

      // 只有当 selectedFile 不为 null 且为文件夹时才上传到选中的文件夹
      // 这确保了从空白区域菜单调用时使用当前目录
      if (selectedFile && selectedFile.isDirectory) {
        // 上传到选中的文件夹
        if (currentPath === "/") {
          targetPath = "/" + selectedFile.name;
        } else if (currentPath === "~") {
          targetPath = "~/" + selectedFile.name;
        } else {
          targetPath = currentPath + "/" + selectedFile.name;
        }
      } else {
        // 上传到当前文件夹
        targetPath = currentPath;
      }

      console.log(`Uploading folder to path: ${targetPath}`);

      if (window.terminalAPI && window.terminalAPI.uploadFolder) {
        // 设置初始传输进度状态
        setTransferProgress({
          type: "upload-folder",
          progress: 0,
          fileName: "",
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
          ) => {
            setTransferProgress({
              type: "upload-folder",
              progress,
              fileName,
              currentFile,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              totalFiles,
            });
          },
        );

        if (result.success) {
          // 上传完成后清除进度状态
          setTimeout(() => setTransferProgress(null), 1500);
          await loadDirectory(currentPath);
          // 上传文件夹操作完成后设置定时器再次检查
          refreshAfterUserActivity();
        } else if (!transferCancelled) {
          // 只有在不是用户主动取消的情况下才显示错误
          setError(result.error || "上传文件夹失败");
          setTransferProgress(null);
        }
      }
    } catch (error) {
      console.error("上传文件夹失败:", error);

      // 只有在不是用户主动取消的情况下才显示错误
      if (
        !transferCancelled &&
        !error.message?.includes("reply was never sent")
      ) {
        setError("上传文件夹失败: " + (error.message || "未知错误"));
      }

      setTransferProgress(null);
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
      console.error("复制路径失败:", error);
      setError("复制路径失败: " + (error.message || "未知错误"));
    }
    handleContextMenuClose();
  };

  // 过滤文件列表（根据搜索词）
  const filteredFiles = searchTerm
    ? files.filter((file) =>
        file.name.toLowerCase().includes(searchTerm.toLowerCase()),
      )
    : files;

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

    if (!filteredFiles.length) {
      return (
        <Box
          sx={{
            padding: 2,
            height: "100%",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onContextMenu={handleBlankContextMenu} // 添加空白区域右键菜单
        >
          <Typography variant="body2" color="text.secondary">
            {searchTerm ? "没有找到匹配的文件" : "此目录为空"}
          </Typography>
        </Box>
      );
    }

    // 先显示目录，然后是文件
    const sortedFiles = [...filteredFiles].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    return (
      <List
        dense
        sx={{ width: "100%", padding: 0 }}
        onContextMenu={handleBlankContextMenu} // 添加空白区域右键菜单
      >
        {sortedFiles.map((file) => (
          <ListItem
            key={file.name}
            disablePadding
            onContextMenu={(e) => handleContextMenu(e, file)}
          >
            <ListItemButton
              onDoubleClick={() => handleFileActivate(file)}
              dense
            >
              <ListItemIcon sx={{ minWidth: 36 }}>
                {file.isDirectory ? (
                  <FolderIcon color="primary" fontSize="small" />
                ) : (
                  <InsertDriveFileIcon fontSize="small" />
                )}
              </ListItemIcon>
              <ListItemText
                primary={file.name}
                secondary={
                  <>
                    {file.modifyTime && formatDate(new Date(file.modifyTime))}
                    {file.size &&
                      !file.isDirectory &&
                      ` • ${formatFileSize(file.size)}`}
                  </>
                }
                primaryTypographyProps={{ variant: "body2" }}
                secondaryTypographyProps={{ variant: "caption" }}
              />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
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

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
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

  // 格式化传输速度
  const formatTransferSpeed = (bytesPerSecond) => {
    if (!bytesPerSecond) return "0 B/s";
    const units = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(1024));
    return `${(bytesPerSecond / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  };

  // 格式化剩余时间
  const formatRemainingTime = (seconds) => {
    if (!seconds || !isFinite(seconds)) return "计算中...";
    if (seconds < 1) return "即将完成";

    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hrs > 0) {
      return `${hrs}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  // 处理取消传输
  const handleCancelTransfer = async () => {
    if (
      !transferProgress ||
      !window.terminalAPI ||
      !window.terminalAPI.cancelTransfer
    ) {
      return;
    }

    try {
      // 标记传输已取消，用于避免显示错误消息
      setTransferCancelled(true);

      // 确定传输类型
      let transferType;
      if (transferProgress.type === "upload") {
        transferType = "upload";
      } else if (transferProgress.type === "download") {
        transferType = "download";
      } else if (transferProgress.type === "upload-folder") {
        transferType = "upload-folder";
      } else if (transferProgress.type === "download-folder") {
        transferType = "download-folder";
      } else {
        return; // 未知类型，不处理
      }

      const result = await window.terminalAPI.cancelTransfer(
        tabId,
        transferType,
      );

      if (result.success) {
        // 更新UI以显示已取消
        setTransferProgress({
          ...transferProgress,
          progress: 0,
          isCancelled: true,
          cancelMessage: "传输已取消",
        });

        // 取消成功后刷新文件列表
        refreshAfterUserActivity();

        // 短暂延迟后移除进度条
        setTimeout(() => setTransferProgress(null), 1500);
      } else {
        // 即使取消失败也不要显示错误，因为原始传输可能已经取消
        console.log("取消传输失败: " + (result.error || "未知错误"));

        // 仍然更新UI以避免用户困惑
        setTransferProgress({
          ...transferProgress,
          progress: 0,
          isCancelled: true,
          cancelMessage: "传输已中断",
        });

        // 传输已中断后也刷新文件列表
        refreshAfterUserActivity();

        // 短暂延迟后移除进度条
        setTimeout(() => setTransferProgress(null), 1500);
      }
    } catch (error) {
      console.error("取消传输失败:", error);

      // 即使出现错误，也更新UI表明传输已中断
      setTransferProgress({
        ...transferProgress,
        progress: 0,
        isCancelled: true,
        cancelMessage: "传输已中断",
      });

      // 发生错误时也刷新文件列表
      refreshAfterUserActivity();

      // 短暂延迟后移除进度条
      setTimeout(() => setTransferProgress(null), 1500);
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
            console.log(
              `创建文件夹失败，尝试重试 (${retryCount}/${maxRetries})`,
            );
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
        console.error("创建文件夹失败:", error);

        if (retryCount < maxRetries) {
          // 发生异常，尝试重试
          retryCount++;
          console.log(`创建文件夹失败，尝试重试 (${retryCount}/${maxRetries})`);
          setError(`创建文件夹失败，正在重试 (${retryCount}/${maxRetries})...`);

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
    setNewFileName2("");
    setShowCreateFileDialog(true);
    handleBlankContextMenuClose();
  };

  // 处理创建文件提交
  const handleCreateFileSubmit = async (e) => {
    e.preventDefault();

    if (!newFileName2.trim() || !sshConnection) {
      setShowCreateFileDialog(false);
      return;
    }

    setLoading(true);

    try {
      const fullPath =
        currentPath === "/"
          ? "/" + newFileName2.trim()
          : currentPath + "/" + newFileName2.trim();

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
      console.error("创建文件失败:", error);
      setError("创建文件失败: " + (error.message || "未知错误"));
    } finally {
      setLoading(false);
      setShowCreateFileDialog(false);
    }
  };

  // 格式化显示上次刷新时间
  const formatLastRefreshTime = () => {
    const now = Date.now();
    const diff = now - lastRefreshTime;

    if (diff < 1000) return "刚刚";
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;

    const date = new Date(lastRefreshTime);
    return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
  };

  // 用户活动后的刷新函数
  const refreshAfterUserActivity = () => {
    console.log("FileManager: Scheduling refresh after user activity");

    // 添加短暂延迟，避免在操作完成前刷新
    setTimeout(() => {
      if (currentPath) {
        silentRefreshCurrentDirectory();
      }
    }, USER_ACTIVITY_REFRESH_DELAY);
  };

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
      setPreviewFile(file);
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

    try {
      const fullPath =
        currentPath === "/"
          ? "/" + selectedFile.name
          : currentPath
            ? currentPath + "/" + selectedFile.name
            : selectedFile.name;

      if (window.terminalAPI && window.terminalAPI.downloadFile) {
        // 设置初始传输进度状态
        setTransferProgress({
          type: "download",
          progress: 0,
          fileName: selectedFile.name,
          transferredBytes: 0,
          totalBytes: selectedFile.size || 0,
          transferSpeed: 0,
          remainingTime: 0,
        });

        // 使用progressCallback处理进度更新
        await window.terminalAPI.downloadFile(
          tabId,
          fullPath,
          (
            progress,
            fileName,
            transferredBytes,
            totalBytes,
            transferSpeed,
            remainingTime,
          ) => {
            setTransferProgress({
              type: "download",
              progress,
              fileName,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
            });
          },
        );

        // 下载完成后清除进度状态
        setTimeout(() => setTransferProgress(null), 1500);
      }
    } catch (error) {
      console.error("下载文件失败:", error);

      // 只有在不是用户主动取消的情况下才显示错误
      if (
        !transferCancelled &&
        !error.message?.includes("reply was never sent")
      ) {
        setError("下载文件失败: " + (error.message || "未知错误"));
      }

      setTransferProgress(null);
    }
    handleContextMenuClose();
  };

  // 处理下载文件夹
  const handleDownloadFolder = async () => {
    if (!selectedFile || !selectedFile.isDirectory || !sshConnection) return;

    // 重置取消状态
    setTransferCancelled(false);

    try {
      const fullPath =
        currentPath === "/"
          ? "/" + selectedFile.name
          : currentPath
            ? currentPath + "/" + selectedFile.name
            : selectedFile.name;

      if (window.terminalAPI && window.terminalAPI.downloadFolder) {
        // 设置初始传输进度状态
        setTransferProgress({
          type: "download-folder",
          progress: 0,
          fileName: selectedFile.name,
          currentFile: "",
          transferredBytes: 0,
          totalBytes: 0,
          transferSpeed: 0,
          remainingTime: 0,
          processedFiles: 0,
          totalFiles: 0,
        });

        // 使用progressCallback处理进度更新
        await window.terminalAPI.downloadFolder(
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
          ) => {
            setTransferProgress({
              type: "download-folder",
              progress,
              fileName: selectedFile.name,
              currentFile,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              totalFiles,
            });
          },
        );

        // 下载完成后清除进度状态
        setTimeout(() => setTransferProgress(null), 1500);
      }
    } catch (error) {
      console.error("下载文件夹失败:", error);

      // 只有在不是用户主动取消的情况下才显示错误
      if (
        !transferCancelled &&
        !error.message?.includes("reply was never sent")
      ) {
        setError("下载文件夹失败: " + (error.message || "未知错误"));
      }

      setTransferProgress(null);
    }
    handleContextMenuClose();
  };

  // 处理重命名
  const handleRename = () => {
    if (!selectedFile) return;
    setNewFileName(selectedFile.name);
    setShowRenameDialog(true);
    handleContextMenuClose();
  };

  // 处理重命名提交
  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    setShowRenameDialog(false);

    if (!selectedFile || !newFileName || newFileName === selectedFile.name)
      return;

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
            newFileName,
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
            console.log(`重命名失败，尝试重试 (${retryCount}/${maxRetries})`);
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
        console.error("重命名失败:", error);

        if (retryCount < maxRetries) {
          // 发生异常，尝试重试
          retryCount++;
          console.log(`重命名失败，尝试重试 (${retryCount}/${maxRetries})`);
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
    >
      {/* 标题栏 */}
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
          sx={{ flexGrow: 1, fontWeight: "bold" }}
        >
          文件管理
        </Typography>
        <IconButton size="small" onClick={onClose} edge="end">
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>

      {/* 路径导航和工具栏 */}
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
              上次刷新: {formatLastRefreshTime()}
            </Box>
          </Tooltip>
        </Box>

        <Box sx={{ flexGrow: 1 }} />

        <Tooltip title="搜索">
          <IconButton size="small" onClick={toggleSearch}>
            <SearchIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* 搜索框 */}
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

      {/* 当前路径 */}
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

      {/* 文件列表 */}
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

      {/* 文件传输进度 */}
      {transferProgress && (
        <Box
          sx={{
            p: 1.5,
            borderTop: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.background.paper,
            flexShrink: 0, // 不收缩
          }}
        >
          <Box
            sx={{
              mb: 0.5,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Typography variant="caption" noWrap sx={{ maxWidth: "60%" }}>
              {transferProgress.type === "upload"
                ? "上传: "
                : transferProgress.type === "upload-folder"
                  ? "上传文件夹: "
                  : transferProgress.type === "download-folder"
                    ? "下载文件夹: "
                    : "下载: "}
              {transferProgress.fileName}
              {transferProgress.totalFiles > 1 &&
                ` (${transferProgress.currentFileIndex || 0}/${transferProgress.totalFiles})`}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography variant="caption" sx={{ mr: 1 }}>
                {transferProgress.isCancelled
                  ? transferProgress.cancelMessage
                  : `${transferProgress.progress}%`}
              </Typography>
              <IconButton
                size="small"
                onClick={handleCancelTransfer}
                disabled={
                  transferProgress.isCancelled ||
                  transferProgress.progress === 100
                }
                sx={{ padding: 0.5 }}
              >
                <CancelIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>

          {/* 多文件上传时显示当前正在处理的文件 */}
          {transferProgress.type === "upload" &&
            transferProgress.totalFiles > 1 &&
            transferProgress.fileName && (
              <Typography
                variant="caption"
                noWrap
                sx={{ display: "block", mb: 0.5, color: "text.secondary" }}
              >
                当前文件: {transferProgress.fileName}
              </Typography>
            )}

          {/* 文件夹传输时显示当前正在处理的文件 */}
          {(transferProgress.type === "upload-folder" ||
            transferProgress.type === "download-folder") &&
            transferProgress.currentFile && (
              <Typography
                variant="caption"
                noWrap
                sx={{ display: "block", mb: 0.5, color: "text.secondary" }}
              >
                当前文件: {transferProgress.currentFile}
              </Typography>
            )}

          <LinearProgress
            variant="determinate"
            value={transferProgress.progress}
            sx={{
              mb: 0.5,
              ...(transferProgress.isCancelled && {
                "& .MuiLinearProgress-bar": {
                  backgroundColor: theme.palette.error.main,
                },
              }),
            }}
          />

          <Box sx={{ display: "flex", justifyContent: "space-between" }}>
            <Typography variant="caption">
              {formatFileSize(transferProgress.transferredBytes)} /{" "}
              {formatFileSize(transferProgress.totalBytes)}
            </Typography>
            <Typography variant="caption">
              {!transferProgress.isCancelled &&
                formatTransferSpeed(transferProgress.transferSpeed)}
            </Typography>
          </Box>

          {/* 显示文件数量信息 */}
          {transferProgress.type === "upload" &&
            transferProgress.totalFiles > 1 && (
              <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
                {transferProgress.currentFileIndex || 0} /{" "}
                {transferProgress.totalFiles} 个文件
              </Typography>
            )}

          {/* 文件夹传输时显示文件进度 */}
          {(transferProgress.type === "upload-folder" ||
            transferProgress.type === "download-folder") && (
            <Typography variant="caption" sx={{ display: "block", mt: 0.5 }}>
              {transferProgress.processedFiles} / {transferProgress.totalFiles}{" "}
              个文件
            </Typography>
          )}

          {!transferProgress.isCancelled && (
            <Typography
              variant="caption"
              sx={{ display: "block", textAlign: "right" }}
            >
              剩余: {formatRemainingTime(transferProgress.remainingTime)}
            </Typography>
          )}
        </Box>
      )}

      {/* 文件右键菜单 */}
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

      {/* 空白区域右键菜单 */}
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

      {/* 重命名对话框 */}
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

      {/* 创建文件夹对话框 */}
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

      {/* 创建文件对话框 */}
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
                value={newFileName2}
                onChange={(e) => setNewFileName2(e.target.value)}
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

      {/* 文件预览 */}
      {showPreview && previewFile && (
        <FilePreview
          open={showPreview}
          onClose={handleClosePreview}
          file={previewFile}
          path={currentPath}
          tabId={tabId}
        />
      )}
    </Paper>
  );
};

export default FileManager;
