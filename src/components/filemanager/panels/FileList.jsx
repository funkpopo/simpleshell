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
import { FileManagerSkeleton } from "../../SkeletonLoader.jsx";
import FolderIcon from "@mui/icons-material/Folder";
import OverflowTooltipText from "../../OverflowTooltipText.jsx";
import { List, ListItem, ListItemButton } from "@mui/material";
import { List as VirtualizedList } from "react-window";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import { formatFileSize, formatDate } from "../../../core/utils/formatters.js";
import { useTranslation } from "react-i18next";
const FILE_LIST_ROW_HEIGHT = 36;
const FILE_LIST_VIRTUALIZATION_THRESHOLD = 200;
const FILE_LIST_OVERSCAN = 12;
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
          <ListItemIcon
            sx={{
              minWidth: 24,
              mr: 0.75,
            }}
          >
            {file.isDirectory ? (
              <FolderIcon
                color="primary"
                sx={{
                  fontSize: 20,
                }}
              />
            ) : (
              <InsertDriveFileIcon
                sx={{
                  fontSize: 20,
                }}
              />
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
  const displayFileRows = useMemo(() => {
    return displayFiles.map((file, index) => {
      const formattedDate = file?.modifyTime
        ? formatDate(new Date(file.modifyTime), {
            t,
          })
        : "";
      const formattedSize =
        file?.size && !file?.isDirectory
          ? formatFileSize(file.size, {
              t,
            })
          : "";
      return {
        file,
        index,
        secondaryText: [formattedDate, formattedSize]
          .filter(Boolean)
          .join(" · "),
      };
    });
  }, [displayFiles, t]);
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
          {searchTerm
            ? t("fileManager.noSearchResults")
            : t("fileManager.emptyDirectory")}
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
          style={{
            height: "100%",
            width: "100%",
          }}
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
        <List
          dense
          disablePadding
          sx={{
            py: 0.5,
            px: 0.5,
          }}
        >
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
                  <ListItemIcon
                    sx={{
                      minWidth: 24,
                      mr: 0.75,
                    }}
                  >
                    {file.isDirectory ? (
                      <FolderIcon
                        color="primary"
                        sx={{
                          fontSize: 20,
                        }}
                      />
                    ) : (
                      <InsertDriveFileIcon
                        sx={{
                          fontSize: 20,
                        }}
                      />
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
