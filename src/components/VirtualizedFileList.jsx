import React, {
  memo,
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";
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

// 单个文件项组件
const FileItem = memo(({ index, style, data }) => {
  const theme = useTheme();
  const { files, onFileActivate, onContextMenu, selectedFile } = data;
  const file = files[index];

  const handleFileActivate = useCallback(() => {
    onFileActivate(file);
  }, [file, onFileActivate]);

  const handleContextMenu = useCallback(
    (e) => {
      onContextMenu(e, file);
    },
    [file, onContextMenu],
  );

  const isSelected = selectedFile && selectedFile.name === file.name;

  // 直接始终渲染完整内容（含时间戳）
  return (
    <div style={style}>
      <ListItem
        disablePadding
        onContextMenu={handleContextMenu}
        sx={{
          backgroundColor: isSelected
            ? theme.palette.action.selected
            : "transparent",
          "&:hover": {
            backgroundColor: theme.palette.action.hover,
          },
        }}
      >
        <ListItemButton
          onDoubleClick={handleFileActivate}
          dense
          sx={{
            minHeight: 48,
            px: 2,
          }}
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
    </div>
  );
});

FileItem.displayName = "FileItem";

// 滚动位置存储 - 使用目录路径作为键
const scrollPositionCache = new Map();

// 计算动态overscan值的函数
const calculateOverscan = (listSize, devicePerformance = 'medium') => {
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
  switch(devicePerformance) {
    case 'low':
      performanceMultiplier = 0.7;
      break;
    case 'high':
      performanceMultiplier = 1.3;
      break;
    case 'medium':
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
  selectedFile,
  height = 400,
  itemHeight = 48,
  searchTerm = "",
  onBlankContextMenu,
  enableVirtualization = true, // 允许禁用虚拟化作为降级选项
  currentPath = "", // 添加当前路径属性用于滚动位置记忆
  devicePerformance = 'medium', // 设备性能等级: 'low', 'medium', 'high'
}) => {
  const theme = useTheme();
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

    // 监听窗口大小变化
    let resizeObserver;
    try {
      resizeObserver = new ResizeObserver(updateHeight);
      if (containerRef.current) {
        resizeObserver.observe(containerRef.current);
      }
    } catch (error) {
      // ResizeObserver 不可用，降级到传统渲染
      setVirtualizationError(true);
    }

    return () => {
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, []);

  // 过滤和排序文件 - 确保在使用前定义
  const processedFiles = useMemo(() => {
    let filteredFiles = files;

    // 搜索过滤
    if (searchTerm) {
      filteredFiles = files.filter((file) =>
        file.name.toLowerCase().includes(searchTerm.toLowerCase()),
      );
    }

    // 排序：目录在前，然后按名称排序
    return [...filteredFiles].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
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
      
      window.scrollingTimeout = setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    },
    [currentPath]
  );

  // itemData useMemo移除isScrolling
  const itemData = useMemo(
    () => ({
      files: processedFiles,
      onFileActivate,
      onContextMenu,
      selectedFile,
    }),
    [processedFiles, onFileActivate, onContextMenu, selectedFile],
  );

  // 计算实际使用的高度
  const actualHeight = height === "100%" ? containerHeight : height;
  
  // 计算动态的overscan值
  const dynamicOverscan = useMemo(
    () => calculateOverscan(processedFiles.length, devicePerformance),
    [processedFiles.length, devicePerformance]
  );

  // 如果没有文件，显示空状态
  if (processedFiles.length === 0) {
    return (
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
      >
        <Typography variant="body2" color="text.secondary">
          {searchTerm ? "没有找到匹配的文件" : "此目录为空"}
        </Typography>
      </Box>
    );
  }

  // 降级到传统列表渲染
  const renderFallbackList = () => (
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
            selectedFile,
          }}
        />
      ))}
    </Box>
  );

  // 如果虚拟化被禁用或出现错误，使用降级渲染
  if (
    !enableVirtualization ||
    virtualizationError ||
    processedFiles.length < 50
  ) {
    return renderFallbackList();
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
