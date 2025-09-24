import React, {
  memo,
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";
import useAutoCleanup from "../hooks/useAutoCleanup";
import { FixedSizeList as List } from "react-window";
import {
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Box,
  Typography,
  useTheme,
} from "@mui/material";
import {
  Folder as FolderIcon,
  InsertDriveFile as InsertDriveFileIcon,
} from "@mui/icons-material";

// 文件大小格式化函数
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

// 日期格式化函数
const formatDate = (date) => {
  if (!date) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

// 单个文件项组件 - 优化版本
const FileItem = memo(({ index, style, data }) => {
  const theme = useTheme();
  const {
    files,
    onFileActivate,
    onContextMenu,
    onFileSelect,
    selectedFile,
    selectedFiles,
    isFileSelected,
  } = data;
  const file = files[index];

  // 确保文件存在
  if (!file) return null;

  // 检查文件是否被选中 - 优先使用传入的isFileSelected函数
  const isCurrentFileSelected = useMemo(() => {
    if (isFileSelected) {
      return isFileSelected(file);
    }
    // 备用逻辑：检查是否在selectedFiles中或者是当前selectedFile
    if (selectedFiles && selectedFiles.length > 0) {
      return selectedFiles.some(
        (f) => f.name === file.name && f.modifyTime === file.modifyTime,
      );
    }
    return (
      selectedFile &&
      selectedFile.name === file.name &&
      selectedFile.modifyTime === file.modifyTime
    );
  }, [file, isFileSelected, selectedFiles, selectedFile]);

  // 使用useMemo缓存文件的格式化信息，避免每次渲染都计算
  const fileInfo = useMemo(
    () => ({
      formattedDate: file.modifyTime
        ? formatDate(new Date(file.modifyTime))
        : "",
      formattedSize:
        file.size && !file.isDirectory ? formatFileSize(file.size) : "",
      isSelected: isCurrentFileSelected,
    }),
    [file.modifyTime, file.size, file.isDirectory, isCurrentFileSelected],
  );

  const handleFileActivate = useCallback(() => {
    onFileActivate(file);
  }, [file, onFileActivate]);

  const handleContextMenu = useCallback(
    (e) => {
      onContextMenu(e, file, index);
    },
    [file, onContextMenu, index],
  );

  const handleFileClick = useCallback(
    (e) => {
      if (onFileSelect) {
        onFileSelect(file, index, e);
      }
    },
    [file, index, onFileSelect],
  );

  // 缓存的二级文本内容，避免每次渲染都重新组合
  const secondaryText = useMemo(() => {
    const parts = [];
    if (fileInfo.formattedDate) parts.push(fileInfo.formattedDate);
    if (fileInfo.formattedSize) parts.push(fileInfo.formattedSize);
    return parts.join(" • ");
  }, [fileInfo.formattedDate, fileInfo.formattedSize]);

  // 缓存按钮样式对象
  const buttonSx = useMemo(
    () => ({
      minHeight: 36,
      maxHeight: 36,
      px: 2,
      py: 0, // 移除垂直内边距以节省空间
      height: "100%", // Fill row height to avoid selection overlap
      backgroundColor: fileInfo.isSelected
        ? theme.palette.action.selected
        : "transparent",
      "&:hover": {
        backgroundColor: fileInfo.isSelected
          ? theme.palette.action.selected
          : theme.palette.action.hover,
      },
      // 确保选中状态的边界清晰
      borderRadius: 1, // 添加轻微圆角
      transition: "all 0.1s ease-in-out", // 平滑过渡效果
    }),
    [
      fileInfo.isSelected,
      theme.palette.action.selected,
      theme.palette.action.hover,
    ],
  );

  // 直接始终渲染完整内容（含时间戳）
  return (
    <div style={style}>
      <ListItem
        disablePadding
        onContextMenu={handleContextMenu}
        sx={{
          py: 0, // 移除ListItem的垂直内边距
          my: 0, // 移除ListItem的垂直外边距
        }}
      >
        <ListItemButton
          data-file-item="true"
          onClick={handleFileClick}
          onDoubleClick={handleFileActivate}
          dense
          sx={buttonSx}
        >
          <ListItemIcon sx={{ minWidth: 28, mr: 1 }}>
            {" "}
            {/* 进一步减少图标宽度并添加右边距 */}
            {file.isDirectory ? (
              <FolderIcon color="primary" fontSize="small" />
            ) : (
              <InsertDriveFileIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={file.name}
            secondary={secondaryText}
            sx={{
              my: 0, // 移除ListItemText的垂直边距
              "& .MuiListItemText-primary": {
                fontSize: "0.875rem", // 稍微减小主文本字体
                lineHeight: 1.2,
              },
              "& .MuiListItemText-secondary": {
                fontSize: "0.75rem", // 减小副文本字体
                lineHeight: 1.1,
              },
            }}
            primaryTypographyProps={{
              variant: "body2",
              noWrap: true,
              sx: { lineHeight: 1.2, mb: 0 }, // 更紧密的行高和无底边距
            }}
            secondaryTypographyProps={{
              variant: "caption",
              color: "text.secondary",
              noWrap: true,
              sx: { lineHeight: 1.1, mt: 0 }, // 更紧密的行高和无顶边距
            }}
          />
        </ListItemButton>
      </ListItem>
    </div>
  );
});

FileItem.displayName = "FileItem";

// 滚动位置存储 - 使用目录路径作为键
const scrollPositionCache = new Map();

// 计算动态overscan值的函数
const calculateOverscan = (listSize, devicePerformance = "medium") => {
  // 基础overscan值
  const baseOverscan = 15;

  // 根据列表大小动态调整
  let sizeMultiplier = 1;
  if (listSize > 1000) {
    sizeMultiplier = 0.8; // 对于非常大的列表，稍微减小以避免内存压力
  } else if (listSize > 500) {
    sizeMultiplier = 0.9;
  } else if (listSize < 100) {
    sizeMultiplier = 1.2; // 对于小列表，可以增加预渲染数量
  }

  // 根据设备性能调整
  let performanceMultiplier = 1;
  switch (devicePerformance) {
    case "low":
      performanceMultiplier = 0.7;
      break;
    case "high":
      performanceMultiplier = 1.3;
      break;
    case "medium":
    default:
      performanceMultiplier = 1;
  }

  return Math.floor(baseOverscan * sizeMultiplier * performanceMultiplier);
};

// 虚拟化文件列表组件
const VirtualizedFileList = ({
  files = [],
  onFileActivate,
  onContextMenu,
  onFileSelect,
  selectedFile,
  selectedFiles,
  isFileSelected,
  height = 400,
  itemHeight = 36,
  searchTerm = "",
  onBlankContextMenu,
  onBlankClick,
  enableVirtualization = true, // 允许禁用虚拟化作为降级选项
  currentPath = "", // 添加当前路径属性用于滚动位置记忆
  devicePerformance = "medium", // 设备性能等级: 'low', 'medium', 'high'
}) => {
  const theme = useTheme();
  const { addResizeObserver, addTimeout } = useAutoCleanup();
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [virtualizationError, setVirtualizationError] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);

  // 动态计算容器高度
  useEffect(() => {
    const updateHeight = () => {
      try {
        if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          if (rect.height > 0) {
            setContainerHeight(rect.height);
          }
        }
      } catch (error) {
        // 虚拟化列表高度计算失败
        setVirtualizationError(true);
      }
    };

    // 初始计算
    updateHeight();

    // 使用 addResizeObserver 自动管理观察器，组件卸载时自动清理
    if (containerRef.current) {
      addResizeObserver(updateHeight, containerRef.current);
    }
  }, [addResizeObserver]);

  // 过滤文件（如果还有额外的搜索过滤需求）
  const processedFiles = useMemo(() => {
    // 如果有searchTerm，进行额外过滤（虽然通常在父组件已经处理）
    if (searchTerm) {
      return files.filter((file) =>
        file.name.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }
    // 直接返回已经排序和过滤的文件列表
    return files;
  }, [files, searchTerm]);

  // 恢复滚动位置 - 现在processedFiles已定义
  useEffect(() => {
    if (currentPath && listRef.current && processedFiles.length > 0) {
      const savedPosition = scrollPositionCache.get(currentPath);
      if (savedPosition !== undefined) {
        listRef.current.scrollTo(savedPosition);
      } else {
        listRef.current.scrollTo(0);
      }
    }
  }, [currentPath, processedFiles]);

  // 保存滚动位置的函数
  const handleScroll = useCallback(
    ({ scrollOffset, scrollDirection, scrollUpdateWasRequested }) => {
      if (!scrollUpdateWasRequested && currentPath) {
        scrollPositionCache.set(currentPath, scrollOffset);
      }

      // 更新滚动状态以优化渲染
      setIsScrolling(true);

      // 使用防抖清除滚动状态
      if (window.scrollingTimeout) {
        clearTimeout(window.scrollingTimeout);
      }

      window.scrollingTimeout = addTimeout(() => {
        setIsScrolling(false);
      }, 150);
    },
    [currentPath],
  );

  const handleContainerClick = useCallback(
    (event) => {
      if (!onBlankClick) {
        return;
      }

      const element = event?.target;
      if (
        element &&
        typeof element.closest === "function" &&
        element.closest('[data-file-item="true"]')
      ) {
        return;
      }

      onBlankClick(event);
    },
    [onBlankClick],
  );

  // itemData useMemo移除isScrolling
  const itemData = useMemo(
    () => ({
      files: processedFiles,
      onFileActivate,
      onContextMenu,
      onFileSelect,
      selectedFile,
      selectedFiles,
      isFileSelected,
    }),
    [
      processedFiles,
      onFileActivate,
      onContextMenu,
      onFileSelect,
      selectedFile,
      selectedFiles,
      isFileSelected,
    ],
  );

  // 计算实际使用的高度
  const actualHeight = height === "100%" ? containerHeight : height;

  // 计算动态的overscan值
  const dynamicOverscan = useMemo(
    () => calculateOverscan(processedFiles.length, devicePerformance),
    [processedFiles.length, devicePerformance],
  );

  // 优化的空状态组件 - 缓存以避免不必要的重新渲染
  const EmptyStateComponent = useMemo(
    () => (
      <Box
        ref={containerRef}
        sx={{
          height: height === "100%" ? "100%" : height,
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
        }}
        onContextMenu={onBlankContextMenu}
        onClick={handleContainerClick}
      >
        <Typography variant="body2" color="text.secondary">
          {searchTerm ? "没有找到匹配的文件" : "此目录为空"}
        </Typography>
      </Box>
    ),
    [
      height,
      searchTerm,
      onBlankContextMenu,
      handleContainerClick,
      containerRef,
    ],
  );

  // 如果没有文件，显示空状态
  if (processedFiles.length === 0) {
    return EmptyStateComponent;
  }

  // 降级到传统列表渲染 - 优化版本，使用useMemo缓存
  const FallbackListComponent = useMemo(
    () => (
      <Box
        ref={containerRef}
        sx={{
          height: height === "100%" ? "100%" : height,
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
        onContextMenu={onBlankContextMenu}
        onClick={handleContainerClick}
      >
        {processedFiles.map((file, index) => (
          <FileItem
            key={file.name}
            index={index}
            style={{ height: itemHeight }}
            data={{
              files: processedFiles,
              onFileActivate,
              onContextMenu,
              onFileSelect,
              selectedFile,
              selectedFiles,
              isFileSelected,
            }}
          />
        ))}
      </Box>
    ),
    [
      containerRef,
      height,
      theme.palette.action.hover,
      theme.palette.action.disabled,
      theme.palette.action.focus,
      onBlankContextMenu,
      processedFiles,
      itemHeight,
      onFileActivate,
      onContextMenu,
      onFileSelect,
      selectedFile,
      selectedFiles,
      isFileSelected,
      handleContainerClick,
    ],
  );

  // 降级到传统列表渲染的函数
  const renderFallbackList = useCallback(
    () => FallbackListComponent,
    [FallbackListComponent],
  );

  // 如果虚拟化被禁用或出现错误，使用降级渲染
  if (
    !enableVirtualization ||
    virtualizationError ||
    processedFiles.length < 50
  ) {
    return FallbackListComponent;
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        height: height === "100%" ? "100%" : height,
        width: "100%",
        "& .react-window-list": {
          // 自定义滚动条样式
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
        },
      }}
      onContextMenu={onBlankContextMenu}
      onClick={handleContainerClick}
    >
      {actualHeight > 0 && (
        <List
          ref={listRef}
          className="react-window-list"
          height={actualHeight}
          itemCount={processedFiles.length}
          itemSize={itemHeight}
          itemData={itemData}
          overscanCount={dynamicOverscan} // 使用动态计算的overscan值
          width="100%"
          onScroll={handleScroll}
          useIsScrolling={true}
          onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
            // 性能监控：记录可见项目范围
            if (
              typeof window !== "undefined" &&
              window.location?.hostname === "localhost"
            ) {
              console.debug(
                `虚拟化列表渲染: ${visibleStartIndex}-${visibleStopIndex} / ${processedFiles.length}`,
              );
            }
          }}
        >
          {FileItem}
        </List>
      )}
    </Box>
  );
};

export default memo(VirtualizedFileList);
