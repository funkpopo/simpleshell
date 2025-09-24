import React, { memo } from "react";
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RefreshIcon from "@mui/icons-material/Refresh";
import HomeIcon from "@mui/icons-material/Home";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import SearchIcon from "@mui/icons-material/Search";
import CloseIcon from "@mui/icons-material/Close";
import ClearIcon from "@mui/icons-material/Clear";
import { formatLastRefreshTime } from "../../core/utils/formatters.js";
import { useTranslation } from "react-i18next";

const FileManagerToolbar = memo(
  ({
    tabName,
    isClosing,
    currentPath,
    historyIndex,
    pathHistory,
    lastRefreshTime,
    showSearch,
    searchTerm,
    searchInputRef,
    pathInput,
    onClose,
    onGoBack,
    onGoToNextPath,
    onGoHome,
    onRefresh,
    onToggleSearch,
    onUploadMenuOpen,
    onSearchChange,
    onPathInputChange,
    onPathInputSubmit,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();

    return (
      <>
        {/* 标题栏 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            p: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
            flexShrink: 0,
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
            onClick={onClose}
            edge="end"
            disabled={isClosing}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* 工具栏 */}
        <Box
          sx={{
            p: 1,
            display: "flex",
            alignItems: "center",
            borderBottom: `1px solid ${theme.palette.divider}`,
            gap: 0.5,
            flexShrink: 0,
          }}
        >
          <Tooltip title={t("fileManager.back")}>
            <span>
              <IconButton
                size="small"
                onClick={onGoBack}
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
                onClick={onGoToNextPath}
                disabled={historyIndex >= pathHistory.length - 1}
              >
                <ArrowForwardIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>

          <Tooltip title={t("fileManager.home")}>
            <IconButton size="small" onClick={onGoHome}>
              <HomeIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t("fileManager.refresh")}>
            <IconButton size="small" onClick={onRefresh}>
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
            <IconButton size="small" onClick={onToggleSearch}>
              <SearchIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Tooltip title={t("fileManager.upload")}>
            <IconButton size="small" onClick={onUploadMenuOpen}>
              <UploadFileIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>

        {/* 搜索栏 */}
        {showSearch && (
          <Box
            sx={{
              p: 1,
              borderBottom: `1px solid ${theme.palette.divider}`,
              flexShrink: 0,
            }}
          >
            <TextField
              inputRef={searchInputRef}
              size="small"
              fullWidth
              placeholder={t("fileManager.search")}
              value={searchTerm}
              onChange={onSearchChange}
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
                      onClick={() => onSearchChange({ target: { value: "" } })}
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

        {/* 路径输入栏 */}
        <Box
          sx={{
            px: 1,
            py: 0.5,
            overflow: "hidden",
            borderBottom: `1px solid ${theme.palette.divider}`,
            zIndex: 1,
            flexShrink: 0,
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
            onChange={onPathInputChange}
            onKeyDown={onPathInputSubmit}
            placeholder={t("fileManager.enterPath")}
            InputProps={{
              style: { fontSize: "0.75rem" },
            }}
            sx={{
              "& .MuiOutlinedInput-root": {
                height: 28,
                borderRadius: 1,
              },
            }}
          />
        </Box>
      </>
    );
  },
);

FileManagerToolbar.displayName = "FileManagerToolbar";

export default FileManagerToolbar;
