import {
  Box,
  IconButton,
  TextField,
  InputAdornment,
  Tooltip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RefreshIcon from "@mui/icons-material/Refresh";
import HomeIcon from "@mui/icons-material/Home";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import { formatLastRefreshTime } from "../../../core/utils/formatters.js";
import { useTranslation } from "react-i18next";
import { getSearchFieldMotionSx } from "../../../utils/searchFieldStyles";
export default function FileToolbar({
  handleHistoryBack,
  historyIndex,
  handleGoToNextPath,
  pathHistory,
  handleGoUp,
  currentPath,
  handleGoHome,
  handleRefresh,
  lastRefreshTime,
  handleCreateMenuOpen,
  handleUploadMenuOpen,
  showSearch,
  searchInputRef,
  searchTerm,
  handleSearchChange,
  handleSearchBlur,
  setSearchTerm,
  setShowSearch,
  toggleSearch,
  handleSortMenuOpen,
  sortMode,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
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
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
          }}
        >
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
            time: formatLastRefreshTime(lastRefreshTime, {
              t,
            }),
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
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 0.5,
          }}
        >
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
              onBlur={handleSearchBlur}
              variant="outlined"
              slotProps={{
                input: {
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
                          // 阻止 mousedown 抢占焦点，避免输入框先失焦收起导致点击落空
                          onMouseDown={(event) => event.preventDefault()}
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
                },
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
  );
}
