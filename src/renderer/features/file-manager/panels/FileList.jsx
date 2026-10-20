import { memo, useMemo } from "react";
import {
  Box,
  Typography,
  ListItemIcon,
  ListItemText,
  CircularProgress,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";
import { FileManagerSkeleton } from "../../../shared/ui/SkeletonLoader.jsx";
import FolderIcon from "@mui/icons-material/Folder";
import OverflowTooltipText from "../../../shared/ui/OverflowTooltipText.jsx";
import { List, ListItem, ListItemButton } from "@mui/material";
import { List as VirtualizedList } from "react-window";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { formatFileSize, formatDate } from "../../../shared/lib/formatters.js";
import { useTranslation } from "react-i18next";
const FILE_LIST_ROW_HEIGHT = 44;
const FILE_LIST_VIRTUALIZATION_THRESHOLD = 200;
const FILE_LIST_OVERSCAN = 12;
// 双行文本（primary 16.8 + 2 margin + secondary 13.2 ≈ 32px）+ 按钮 py:0.5(8px) ≈ 40px
const FILE_LIST_ITEM_MIN_HEIGHT = 40;
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
const formatSecondaryText = (file, t) => {
  if (!file) return "";
  const date = file.modifyTime
    ? formatDate(new Date(file.modifyTime), { t })
    : "";
  const size =
    file.size && !file.isDirectory ? formatFileSize(file.size, { t }) : "";
  return [date, size].filter(Boolean).join(" · ");
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
  const { t } = useTranslation();
  const rowStyle = useMemo(
    () => ({ ...style, boxSizing: "border-box", padding: "2px 4px" }),
    [style],
  );
  const file = rows[index];
  const secondaryText = useMemo(() => formatSecondaryText(file, t), [file, t]);
  if (!file) return null;
  const isSelected = isFileSelected(file);
  return (
    <div style={rowStyle}>
      <ListItem
        disablePadding
        disableGutters
        onContextMenu={(e) => onContextMenu(e, file, index)}
        sx={viewStyles.listItemSx}
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
            overflow: "hidden",
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
          <ListItemIcon sx={viewStyles.listItemIconSx}>
            {file.isDirectory ? (
              <FolderIcon color="primary" sx={viewStyles.folderIconSx} />
            ) : (
              <InsertDriveFileIcon sx={viewStyles.folderIconSx} />
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
  const theme = useTheme();
  const { t } = useTranslation();
  if (loading) {
    return (
      <Box sx={viewStyles.boxSx}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (error) {
    return (
      <Box sx={viewStyles.boxSx2}>
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
          sx={viewStyles.boxSx3}
          onContextMenu={handleBlankContextMenu}
          onClick={handleBlankClick}
        >
          <FileManagerSkeleton />
        </Box>
      );
    }
    return (
      <Box
        sx={viewStyles.boxSx4}
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
      sx={viewStyles.boxSx5}
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
            onContextMenu: handleContextMenu,
            onSelect: handleFileSelect,
            onActivate: handleFileActivate,
            theme,
          }}
          overscanCount={FILE_LIST_OVERSCAN}
          rowComponent={VirtualizedFileRow}
        />
      ) : (
        <List dense disablePadding sx={viewStyles.listSx}>
          {displayFiles.map((file, index) => {
            const secondaryText = formatSecondaryText(file, t);
            const isSelected = isFileSelected(file);
            return (
              <ListItem
                key={`${file.name}-${file.modifyTime ?? index}`}
                disablePadding
                disableGutters
                onContextMenu={(e) => handleContextMenu(e, file, index)}
                sx={viewStyles.listItemSx2}
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
                    overflow: "hidden",
                    transition:
                      "background-color 0.15s ease-in-out, border-color 0.15s ease-in-out",
                    userSelect: "none",
                    cursor: "default",
                    "&.Mui-selected": {
                      backgroundColor: alpha(theme.palette.primary.main, 0.12),
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
                  <ListItemIcon sx={viewStyles.listItemIconSx2}>
                    {file.isDirectory ? (
                      <FolderIcon
                        color="primary"
                        sx={viewStyles.folderIconSx2}
                      />
                    ) : (
                      <InsertDriveFileIcon sx={viewStyles.folderIconSx2} />
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
          })}
        </List>
      )}
    </Box>
  );
}

// Stable declarations shared by row renders. Dynamic styles stay with their owner.
const viewStyles = {
  listItemSx: {
    py: 0,
    my: 0,
    minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
    height: FILE_LIST_ITEM_MIN_HEIGHT,
  },
  listItemIconSx: {
    minWidth: 24,
    mr: 0.75,
  },
  folderIconSx: {
    fontSize: 20,
  },
  boxSx: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100%",
    width: "100%",
  },
  boxSx2: {
    padding: 2,
    color: "error.main",
    height: "100%",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  boxSx3: {
    height: "100%",
    width: "100%",
    padding: 1,
  },
  boxSx4: {
    height: "100%",
    width: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 2,
  },
  boxSx5: {
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
  listItemSx2: {
    py: 0,
    my: 0,
    minHeight: FILE_LIST_ITEM_MIN_HEIGHT,
    height: FILE_LIST_ITEM_MIN_HEIGHT,
    "&:not(:last-child)": {
      mb: 0.5,
    },
  },
  listItemIconSx2: {
    minWidth: 24,
    mr: 0.75,
  },
  folderIconSx2: {
    fontSize: 20,
  },
};
