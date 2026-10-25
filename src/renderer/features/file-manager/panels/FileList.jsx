import { memo, useMemo } from "react";
import {
  Box,
  Typography,
  ListItemIcon,
  ListItemText,
  List,
  ListItem,
  ListItemButton,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { FileManagerSkeleton } from "../../../shared/ui/SkeletonLoader.jsx";
import FolderIcon from "@mui/icons-material/Folder";
import OverflowTooltipText from "../../../shared/ui/OverflowTooltipText.jsx";
import { List as VirtualizedList } from "react-window";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { formatFileSize, formatDate } from "../../../shared/lib/formatters.js";
import { useTranslation } from "react-i18next";
import useStableCallback from "../../../shared/hooks/useStableCallback.js";
import { SIDEBAR_ROW_GAP_PX } from "../../../shared/ui/sidebarItemStyles";

// 双行文本（primary 16.8 + 2 margin + secondary 13.2 ≈ 32px）+ 按钮 py:0.5(8px) ≈ 40px
const FILE_LIST_ITEM_MIN_HEIGHT = 40;
// 虚拟化行距 = 行高 + 行间距（行容器上下各 2px），与非虚拟化列表的 mb 保持一致
const FILE_LIST_ROW_HEIGHT = FILE_LIST_ITEM_MIN_HEIGHT + SIDEBAR_ROW_GAP_PX;
const FILE_LIST_VIRTUALIZATION_THRESHOLD = 200;
const FILE_LIST_OVERSCAN = 12;
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
// 选中/悬停配色通过主题回调取值：样式对象全局唯一，行渲染不再逐行拼装
const FILE_ROW_BUTTON_SX = {
  minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
  height: FILE_LIST_ITEM_MIN_HEIGHT,
  px: 1.5,
  py: 0.5,
  borderRadius: 1,
  overflow: "hidden",
  transition:
    "background-color 0.15s ease-in-out, border-color 0.15s ease-in-out",
  userSelect: "none",
  cursor: "default",
  "&.Mui-selected": {
    backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.12),
    "&:hover": {
      backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.18),
    },
  },
  "&:hover": {
    backgroundColor: "action.hover",
  },
};
const formatSecondaryText = (file, t) => {
  if (!file) return "";
  const date = file.modifyTime
    ? formatDate(new Date(file.modifyTime), { t })
    : "";
  const size =
    file.size && !file.isDirectory ? formatFileSize(file.size, { t }) : "";
  return [date, size].filter(Boolean).join(" · ");
};

/**
 * 文件行：虚拟化与非虚拟化列表共用。只接收标量与稳定回调，
 * 选中状态变化时只有选中/取消选中的行重渲染。
 */
const FileRow = memo(function FileRow({
  file,
  index,
  selected,
  sx,
  onContextMenu,
  onSelect,
  onActivate,
}) {
  const { t } = useTranslation();
  const secondaryText = useMemo(() => formatSecondaryText(file, t), [file, t]);
  return (
    <ListItem
      disablePadding
      disableGutters
      onContextMenu={(e) => onContextMenu(e, file, index)}
      sx={sx}
    >
      <ListItemButton
        data-file-item="true"
        onClick={(e) => onSelect(file, index, e)}
        onDoubleClick={() => onActivate(file)}
        dense
        selected={selected}
        sx={FILE_ROW_BUTTON_SX}
      >
        <ListItemIcon sx={viewStyles.listItemIconSx}>
          {file.isDirectory ? (
            <FolderIcon color="primary" sx={viewStyles.fileIconSx} />
          ) : (
            <InsertDriveFileIcon sx={viewStyles.fileIconSx} />
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
  );
});

const VirtualizedFileRow = memo(function VirtualizedFileRow({
  index,
  style,
  rows,
  isFileSelected,
  onContextMenu,
  onSelect,
  onActivate,
}) {
  const rowStyle = useMemo(
    () => ({ ...style, boxSizing: "border-box", padding: "2px 4px" }),
    [style],
  );
  const file = rows[index];
  if (!file) return null;
  return (
    <div style={rowStyle}>
      <FileRow
        file={file}
        index={index}
        selected={isFileSelected(file)}
        sx={viewStyles.virtualizedItemSx}
        onContextMenu={onContextMenu}
        onSelect={onSelect}
        onActivate={onActivate}
      />
    </div>
  );
});

export default function FileList({
  displayFiles,
  loading,
  error,
  searchTerm,
  isChunking,
  listToken,
  handleBlankContextMenu,
  handleBlankClick,
  isFileSelected,
  handleContextMenu,
  handleFileSelect,
  handleFileActivate,
}) {
  const { t } = useTranslation();
  // 上游处理函数每次渲染都会重建；转成稳定引用后行组件的 memo 才能生效
  const onContextMenu = useStableCallback(handleContextMenu);
  const onSelect = useStableCallback(handleFileSelect);
  const onActivate = useStableCallback(handleFileActivate);

  if (loading) {
    return <FileManagerSkeleton />;
  }
  if (error) {
    return (
      <Box sx={viewStyles.errorSx}>
        <Typography variant="body2">{error}</Typography>
      </Box>
    );
  }
  if (!displayFiles || displayFiles.length === 0) {
    // chunked/nonBlocking 目录加载：首批数据可能为空，但仍在持续接收分片
    // 这时应该显示加载动画，而不是“当前目录为空”
    if (!searchTerm && (isChunking || listToken)) {
      return (
        <Box
          sx={viewStyles.fillSx}
          onContextMenu={handleBlankContextMenu}
          onClick={handleBlankClick}
        >
          <FileManagerSkeleton />
        </Box>
      );
    }
    return (
      <Box
        sx={viewStyles.emptySx}
        onContextMenu={handleBlankContextMenu}
        onClick={handleBlankClick}
      >
        <Typography variant="body2" color="text.secondary">
          {searchTerm
            ? t("fileManager.noSearchResults")
            : t("fileManager.emptyDirectory")}
        </Typography>
      </Box>
    );
  }
  const shouldVirtualize =
    displayFiles.length >= FILE_LIST_VIRTUALIZATION_THRESHOLD;
  return (
    <Box
      className="app-scrollbar"
      sx={viewStyles.scrollSx}
      onContextMenu={handleBlankContextMenu}
      onClick={handleBlankClick}
    >
      {shouldVirtualize ? (
        <VirtualizedList
          className="file-manager-virtualized-list app-scrollbar"
          style={viewStyles.virtualizedListStyle}
          rowCount={displayFiles.length}
          rowHeight={FILE_LIST_ROW_HEIGHT}
          rowProps={{
            rows: displayFiles,
            isFileSelected,
            onContextMenu,
            onSelect,
            onActivate,
          }}
          overscanCount={FILE_LIST_OVERSCAN}
          rowComponent={VirtualizedFileRow}
        />
      ) : (
        <List dense disablePadding sx={viewStyles.listSx}>
          {displayFiles.map((file, index) => (
            <FileRow
              key={`${file.name}-${file.modifyTime ?? index}`}
              file={file}
              index={index}
              selected={isFileSelected(file)}
              sx={viewStyles.listItemSx}
              onContextMenu={onContextMenu}
              onSelect={onSelect}
              onActivate={onActivate}
            />
          ))}
        </List>
      )}
    </Box>
  );
}

// Stable declarations shared by row renders. Dynamic styles stay with their owner.
const viewStyles = {
  virtualizedItemSx: {
    py: 0,
    my: 0,
    minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
    height: FILE_LIST_ITEM_MIN_HEIGHT,
  },
  listItemSx: {
    py: 0,
    my: 0,
    minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
    height: FILE_LIST_ITEM_MIN_HEIGHT,
    "&:not(:last-child)": {
      mb: `${SIDEBAR_ROW_GAP_PX}px`,
    },
  },
  listItemIconSx: {
    minWidth: 24,
    mr: 0.75,
  },
  fileIconSx: {
    fontSize: 20,
  },
  errorSx: {
    padding: 2,
    color: "error.main",
    height: "100%",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  fillSx: {
    height: "100%",
    width: "100%",
  },
  emptySx: {
    height: "100%",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  scrollSx: {
    height: "100%",
    width: "100%",
    overflow: "auto",
  },
  virtualizedListStyle: {
    height: "100%",
    width: "100%",
  },
  listSx: {
    py: 0.5,
    px: 0.5,
  },
};
