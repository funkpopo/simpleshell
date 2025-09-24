import React, { memo, useCallback } from "react";
import { Box, Typography, CircularProgress } from "@mui/material";
import VirtualizedFileList from "../VirtualizedFileList.jsx";
import { useTranslation } from "react-i18next";
import { sortFiles, filterFiles } from "./utils.js";

const FileList = memo(
  ({
    files,
    loading,
    error,
    searchTerm,
    sortMode,
    selectedFiles,
    currentPath,
    onFileSelect,
    onFileActivate,
    onContextMenu,
    onBlankContextMenu,
  }) => {
    const { t } = useTranslation();

    // 处理文件排序和过滤
    const processedFiles = useCallback(() => {
      let result = [...files];

      // 应用搜索过滤
      if (searchTerm) {
        result = filterFiles(result, searchTerm);
      }

      // 应用排序
      const sortBy = sortMode === "time" ? "modifiedTime" : "name";
      result = sortFiles(result, sortBy, "asc");

      return result;
    }, [files, searchTerm, sortMode]);

    // 渲染加载状态
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

    // 渲染错误状态
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

    // 渲染空状态
    const filteredFiles = processedFiles();
    if (!filteredFiles || filteredFiles.length === 0) {
      return (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            width: "100%",
            color: "text.secondary",
          }}
          onContextMenu={onBlankContextMenu}
        >
          <Typography variant="body2">
            {searchTerm
              ? t("fileManager.noSearchResults")
              : t("fileManager.emptyFolder")}
          </Typography>
        </Box>
      );
    }

    // 渲染文件列表
    return (
      <VirtualizedFileList
        files={filteredFiles}
        selectedFiles={selectedFiles}
        currentPath={currentPath}
        onFileSelect={onFileSelect}
        onFileActivate={onFileActivate}
        onContextMenu={onContextMenu}
        onBlankContextMenu={onBlankContextMenu}
      />
    );
  },
);

FileList.displayName = "FileList";

export default FileList;
