import React, {
  memo,
  useMemo,
  useCallback,
  useRef,
  useState,
  useEffect,
} from "react";
import useAutoCleanup from "../hooks/useAutoCleanup";
import { List } from "react-window";
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

// 文件大小格式化工具函数
const formatFileSize = (bytes) => {
  if (!bytes || bytes === 0) return "";
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
};

// 日期时间格式化工具函数
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

// 每个路径对应一个滚动位置缓存
const scrollPositionCache = new Map();

// 根据列表大小和设备性能动态计算 overscan
const calculateOverscan = (listSize, devicePerformance = "medium") => {
  // 基础 overscan 行数
  const baseOverscan = 15;

  // 根据列表长度调整 overscan 倍数
  let sizeMultiplier = 1;
  if (listSize > 1000) {
    sizeMultiplier = 0.8; // 非常大的列表降低 overscan 减少渲染压力
  } else if (listSize > 500) {
    sizeMultiplier = 0.9;
  } else if (listSize < 100) {
    sizeMultiplier = 1.2; // 小列表可以稍微多渲染几行
  }

  // 根据设备性能调整 overscan 倍数
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

// 单条文件行组件 - 负责渲染一行文件
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
  if (!file) return null;

  // 计算当前文件是否被选中（优先使用自定义 isFileSelected）
  const isCurrentFileSelected = useMemo(() => {
    if (!file) return false;
    if (isFileSelected) {
      return !!isFileSelected(file);
    }

    // 如果没有传 isFileSelected，则回退到 selectedFiles / selectedFile
    if (Array.isArray(selectedFiles) && selectedFiles.length > 0) {
      return selectedFiles.some(
        (f) => f.name === file.name && f.modifyTime === file.modifyTime,
      );
    }

    return (
      !!selectedFile &&
      selectedFile.name === file.name &&
      selectedFile.modifyTime === file.modifyTime
    );
  }, [file, isFileSelected, selectedFiles, selectedFile]);

  // 使用 useMemo 缓存文件显示信息，避免重复计算
  const fileInfo = useMemo(
    () => ({
      formattedDate: file?.modifyTime
        ? formatDate(new Date(file.modifyTime))
        : "",
      formattedSize:
        file?.size && !file?.isDirectory ? formatFileSize(file.size) : "",
      isSelected: isCurrentFileSelected,
    }),
    [file?.modifyTime, file?.size, file?.isDirectory, isCurrentFileSelected],
  );

  const handleFileActivate = useCallback(() => {
    if (!file || !onFileActivate) return;
    onFileActivate(file);
  }, [file, onFileActivate]);

  const handleContextMenu = useCallback(
    (e) => {
      if (!file || !onContextMenu) return;
      onContextMenu(e, file, index);
    },
    [file, onContextMenu, index],
  );

  const handleFileClick = useCallback(
    (e) => {
      if (!file || !onFileSelect) return;
      onFileSelect(file, index, e);
    },
    [file, index, onFileSelect],
  );

  // 拼接副标题（修改时间 + 文件大小）
  const secondaryText = useMemo(() => {
    const parts = [];
    if (fileInfo.formattedDate) parts.push(fileInfo.formattedDate);
    if (fileInfo.formattedSize) parts.push(fileInfo.formattedSize);
    return parts.join(" · ");
  }, [fileInfo.formattedDate, fileInfo.formattedSize]);

  // 行内按钮样式
  const buttonSx = useMemo(
    () => ({
      minHeight: 36,
      maxHeight: 36,
      px: 2,
      py: 0, // 让点击区域垂直居中
      height: "100%", // 填满整行高度，避免选中区域错位
      backgroundColor: fileInfo.isSelected
        ? theme.palette.action.selected
        : "transparent",
      "&:hover": {
        backgroundColor: fileInfo.isSelected
          ? theme.palette.action.selected
          : theme.palette.action.hover,
      },
      // 统一按钮圆角和过渡效果
      borderRadius: 1, // 统一的圆角大小
      transition: "all 0.1s ease-in-out", // 提升 hover/选中时的过渡体验
    }),
    [
      fileInfo.isSelected,
      theme.palette.action.selected,
      theme.palette.action.hover,
    ],
  );

  // 渲染单行文件条目
  return (
    <div style={style}>
      <ListItem
        disablePadding
        onContextMenu={handleContextMenu}
        sx={{
          py: 0, // 去掉 ListItem 默认上下内边距
          my: 0, // 去掉 ListItem 默认上下外边距
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
            {file.isDirectory ? (
              <FolderIcon color="primary" fontSize="small" />
            ) : (
              <InsertDriveFileIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={file.name || ""}
            secondary={secondaryText}
            sx={{
              my: 0, // 去掉 ListItemText 默认垂直间距
              "& .MuiListItemText-primary": {
                fontSize: "0.875rem", // 主标题字体稍大一点
                lineHeight: 1.2,
              },
              "& .MuiListItemText-secondary": {
                fontSize: "0.75rem", // 副标题字体稍小一点
                lineHeight: 1.1,
              },
            }}
            primaryTypographyProps={{
              variant: "body2",
              noWrap: true,
              sx: { lineHeight: 1.2, mb: 0 }, // 主标题行高/间距微调
            }}
            secondaryTypographyProps={{
              variant: "caption",
              color: "text.secondary",
              noWrap: true,
              sx: { lineHeight: 1.1, mt: 0 }, // 副标题行高/间距微调
            }}
          />
        </ListItemButton>
      </ListItem>
    </div>
  );
});

FileItem.displayName = "FileItem";

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
  enableVirtualization = true, // 是否启用虚拟滚动（性能优化）
  currentPath = "", // 当前展示的目录路径，用于记忆滚动位置
  devicePerformance = "medium", // 设备性能预估: 'low' | 'medium' | 'high'
}) => {
  const theme = useTheme();
  const { addResizeObserver, addTimeout } = useAutoCleanup();
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(
    typeof height === "number" ? height : 400,
  );
  const [virtualizationError, setVirtualizationError] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [initialScrollOffset, setInitialScrollOffset] = useState(0);

  // 自适应容器高度，兼容高度为 100% 的场景
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
        // 出现异常时关闭虚拟列表，使用回退渲染
        setVirtualizationError(true);
      }
    };

    updateHeight(); // 首次计算一次高度

    if (containerRef.current) {
      // 使用 addResizeObserver 监听容器尺寸变化
      // addResizeObserver 返回资源ID，我们不需要在 useEffect 中返回它
      addResizeObserver(updateHeight, containerRef.current);
    }
    // useEffect 不应该返回 addResizeObserver 的返回值
    // eslint-disable-next-line consistent-return
  }, [addResizeObserver, height]);

  // 根据搜索关键字过滤文件列表
  const processedFiles = useMemo(() => {
    if (!Array.isArray(files)) return [];

    // 有 searchTerm 时仅返回匹配的文件名
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      return files.filter((file) =>
        (file.name || "").toLowerCase().includes(lower),
      );
    }

    // 否则返回完整文件列表
    return files;
  }, [files, searchTerm]);

  // 根据当前路径恢复上次的滚动位置
  useEffect(() => {
    if (!currentPath) return;

    const savedPosition = scrollPositionCache.get(currentPath);
    const top =
      typeof savedPosition === "number" && Number.isFinite(savedPosition)
        ? savedPosition
        : 0;

    setInitialScrollOffset(top);

    // 非虚拟化模式下手动恢复容器滚动位置
    if (
      !enableVirtualization ||
      virtualizationError ||
      processedFiles.length < 50
    ) {
      const element = containerRef.current;
      if (!element) return;
      try {
        if (typeof element.scrollTo === "function") {
          element.scrollTo({ top });
        } else {
          element.scrollTop = top;
        }
      } catch {
        // ignore
      }
    }
  }, [
    currentPath,
    enableVirtualization,
    virtualizationError,
    processedFiles.length,
  ]);

  // 处理列表滚动事件并缓存滚动位置
  const handleScroll = useCallback(
    (eventOrData) => {
      try {
        let scrollOffset = 0;

        // react-window onScroll 回调: { scrollOffset, scrollDirection, ... }
        if (
          eventOrData &&
          typeof eventOrData === "object" &&
          typeof eventOrData.scrollOffset === "number"
        ) {
          scrollOffset = eventOrData.scrollOffset;
        } else {
          const target = eventOrData?.currentTarget;
          scrollOffset =
            target && typeof target.scrollTop === "number"
              ? target.scrollTop
              : 0;
        }

        if (currentPath) {
          scrollPositionCache.set(currentPath, scrollOffset);
        }

        // 短时间内标记为正在滚动，防止频繁重渲染
        setIsScrolling(true);

        // 使用防抖计时器在停止滚动后恢复状态
        if (window.scrollingTimeout) {
          clearTimeout(window.scrollingTimeout);
        }

        window.scrollingTimeout = addTimeout(() => {
          setIsScrolling(false);
        }, 150);
      } catch {
        // ignore scroll errors
      }
    },
    [currentPath, addTimeout],
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

  // 将列表相关数据通过 useMemo 传给虚拟行
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

  // 真实可视高度（百分比高度时使用容器高度）
  const actualHeight = height === "100%" ? containerHeight : height;

  // 动态计算 overscan 行数
  const dynamicOverscan = useMemo(
    () => calculateOverscan(processedFiles.length, devicePerformance),
    [processedFiles.length, devicePerformance],
  );

  // 空列表展示状态（支持搜索结果为空）
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
          {searchTerm ? "未找到匹配的文件" : "当前目录为空"}
        </Typography>
      </Box>
    ),
    [height, searchTerm, onBlankContextMenu, handleContainerClick],
  );

  // 回退渲染：当虚拟化不可用时使用普通列表
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
        onScroll={handleScroll}
      >
        {processedFiles.map((file, index) => (
          <FileItem
            key={file.name}
            index={index}
            style={{ height: itemHeight }}
            data={itemData}
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
      handleContainerClick,
      handleScroll,
      itemData,
    ],
  );

  // 空列表时直接渲染 EmptyStateComponent，避免后续 hooks
  if (processedFiles.length === 0) {
    return EmptyStateComponent;
  }

  // 当禁用虚拟化或出现错误 / 列表太小时使用回退列表
  if (
    !enableVirtualization ||
    virtualizationError ||
    processedFiles.length < 50
  ) {
    return FallbackListComponent;
  }

  // 虚拟化渲染大文件列表
  return (
    <Box
      ref={containerRef}
      sx={{
        height: height === "100%" ? "100%" : height,
        width: "100%",
        "& .react-window-list": {
          // 自定义虚拟列表滚动条样式
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
          overscanCount={dynamicOverscan} // 动态 overscan 行数
          width="100%"
          initialScrollOffset={initialScrollOffset}
          onScroll={handleScroll}
          onItemsRendered={({ visibleStartIndex, visibleStopIndex }) => {
            // 调试：在本地输出可见行区间
            if (
              typeof window !== "undefined" &&
              window.location?.hostname === "localhost"
            ) {
              console.debug(
                `可见行区间: ${visibleStartIndex}-${visibleStopIndex} / ${processedFiles.length}`,
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

