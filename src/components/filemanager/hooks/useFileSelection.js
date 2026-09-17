import { useState, useEffect, useCallback, useMemo, useRef } from "react";

/** Owns search, sorting and selection; exposes selection commands instead of individual setters. */
export default function useFileSelection({
  files,
  isChunking,
  selectionResetKey,
}) {
  const [searchTerm, setSearchTerm] = useState("");

  const searchInputRef = useRef(null);

  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    if (!showSearch) {
      return;
    }

    const timeoutId = setTimeout(() => {
      searchInputRef.current?.focus();
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [showSearch]);

  const [selectedFile, setSelectedFile] = useState(null);

  const [selectedFiles, setSelectedFiles] = useState([]);

  const [, setLastSelectedIndex] = useState(-1);

  const [anchorIndex, setAnchorIndex] = useState(-1);

  const [sortMode, setSortMode] = useState("name");

  const selectedFileRef = useRef(selectedFile);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const selectedFilesRef = useRef(selectedFiles);

  useEffect(() => {
    selectedFilesRef.current = selectedFiles;
  }, [selectedFiles]);

  const clearSelection = useCallback(() => {
    setSelectedFiles([]);
    setSelectedFile(null);
    setLastSelectedIndex(-1);
    setAnchorIndex(-1);
  }, []);

  const getSelectionIdentity = useCallback((file) => {
    if (!file || typeof file.name !== "string") {
      return "";
    }
    return `${file.isDirectory ? "dir" : "file"}:${file.name}`;
  }, []);

  const reconcileSelectionWithNextList = useCallback(
    (nextList) => {
      if (!Array.isArray(nextList) || nextList.length === 0) {
        clearSelection();
        return;
      }

      const nextEntriesByKey = new Map();
      nextList.forEach((file, index) => {
        nextEntriesByKey.set(getSelectionIdentity(file), { file, index });
      });

      const seenKeys = new Set();
      const nextSelectedFiles = [];
      selectedFilesRef.current.forEach((file) => {
        const key = getSelectionIdentity(file);
        const match = nextEntriesByKey.get(key);
        if (key && match && !seenKeys.has(key)) {
          seenKeys.add(key);
          nextSelectedFiles.push(match.file);
        }
      });

      const currentSelectedKey = getSelectionIdentity(selectedFileRef.current);
      const currentSelectedMatch = currentSelectedKey
        ? nextEntriesByKey.get(currentSelectedKey)
        : null;
      const preservedSelected = nextSelectedFiles[0] || null;
      const nextSelectedFile = currentSelectedMatch?.file || preservedSelected;
      const nextAnchorIndex = currentSelectedMatch
        ? currentSelectedMatch.index
        : nextSelectedFile
          ? nextList.findIndex(
              (file) =>
                getSelectionIdentity(file) ===
                getSelectionIdentity(nextSelectedFile),
            )
          : -1;

      setSelectedFiles(nextSelectedFiles);
      setSelectedFile(nextSelectedFile);
      setLastSelectedIndex(nextAnchorIndex);
      setAnchorIndex(nextAnchorIndex);
    },
    [clearSelection, getSelectionIdentity],
  );

  const handleSearchChange = useCallback((e) => {
    setSearchTerm(e.target.value);
  }, []);

  const toggleSearch = useCallback(() => {
    setShowSearch((prev) => {
      if (prev) {
        setSearchTerm("");
      }
      return !prev;
    });
  }, []);

  const handleSearchBlur = useCallback(() => {
    if (!searchTerm) {
      setShowSearch(false);
    }
  }, [searchTerm]);

  const selectedFilesSet = useMemo(() => {
    const set = new Set();
    selectedFiles.forEach((file) => {
      set.add(`${file.name}-${file.modifyTime}`);
    });
    return set;
  }, [selectedFiles]);

  const isFileSelected = useCallback(
    (file) => {
      return selectedFilesSet.has(`${file.name}-${file.modifyTime}`);
    },
    [selectedFilesSet],
  );

  const deduplicateSelectedFiles = useCallback((files) => {
    const seen = new Set();
    return files.filter((file) => {
      const key = `${file.name}-${file.modifyTime}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    // removed legacy block
  }, []);

  const displayFiles = useMemo(() => {
    let processed = files;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      processed = files.filter(
        (f) => f.name && f.name.toLowerCase().includes(term),
      );
    }
    if (isChunking) return processed;
    return [...processed].sort((a, b) => {
      if (sortMode === "time") {
        const aTime = Number.isFinite(a?.mtimeMs)
          ? a.mtimeMs
          : new Date(a?.modifyTime || 0).getTime();
        const bTime = Number.isFinite(b?.mtimeMs)
          ? b.mtimeMs
          : new Date(b?.modifyTime || 0).getTime();
        return bTime - aTime;
      }
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "", undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [files, searchTerm, sortMode, isChunking]);

  const handleFileSelect = useCallback(
    (file, index, event) => {
      event.stopPropagation();

      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }

      const isMultiSelect = event.ctrlKey || event.metaKey;
      const isRangeSelect = event.shiftKey;

      if (isRangeSelect && anchorIndex !== -1) {
        // Shift范围选择 - 使用排序后的文件列表
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        const rangeFiles = displayFiles.slice(start, end + 1);

        // 如果同时按住Ctrl+Shift，则添加到现有选择
        if (isMultiSelect) {
          // 合并现有选择和范围选择
          const newSelection = [...selectedFiles];
          rangeFiles.forEach((rangeFile) => {
            // 只添加未选中的文件
            if (
              !newSelection.some(
                (f) =>
                  f.name === rangeFile.name &&
                  f.modifyTime === rangeFile.modifyTime,
              )
            ) {
              newSelection.push(rangeFile);
            }
          });
          const deduplicated = deduplicateSelectedFiles(newSelection);
          setSelectedFiles(deduplicated);
        } else {
          // 直接设置范围内的文件为选中状态（完全替换之前的选择）
          const deduplicated = deduplicateSelectedFiles(rangeFiles);
          setSelectedFiles(deduplicated);
        }

        setSelectedFile(file);
        setLastSelectedIndex(index);
        // 保持锚点不变，这样连续的Shift选择都从同一个起点开始
      } else if (isMultiSelect) {
        // Ctrl多选
        const isCurrentlySelected = isFileSelected(file);

        if (isCurrentlySelected) {
          // 取消选择 - 从当前选择中移除该文件
          const newSelectedFiles = selectedFiles.filter(
            (f) => !(f.name === file.name && f.modifyTime === file.modifyTime),
          );
          setSelectedFiles(newSelectedFiles);

          // 如果取消选择的是当前的selectedFile，更新selectedFile
          if (
            selectedFile &&
            selectedFile.name === file.name &&
            selectedFile.modifyTime === file.modifyTime
          ) {
            setSelectedFile(
              newSelectedFiles.length > 0 ? newSelectedFiles[0] : null,
            );
          }
        } else {
          // 添加到选择 - 防止重复添加
          const newSelection = [...selectedFiles, file];
          const deduplicated = deduplicateSelectedFiles(newSelection);
          setSelectedFiles(deduplicated);
          setSelectedFile(file);
        }
        setLastSelectedIndex(index);
        setAnchorIndex(index); // Ctrl点击设置新的锚点
      } else {
        // 单选 - 清除所有选择，选中当前文件
        setSelectedFiles([file]);
        setSelectedFile(file);
        setLastSelectedIndex(index);
        setAnchorIndex(index); // 单击设置锚点，为后续的Shift选择做准备
      }
    },
    [
      anchorIndex,
      displayFiles,
      isFileSelected,
      selectedFile,
      selectedFiles,
      deduplicateSelectedFiles,
    ],
  );

  const getSelectedFiles = useCallback(() => {
    return selectedFiles.length > 0
      ? selectedFiles
      : selectedFile
        ? [selectedFile]
        : [];
  }, [selectedFiles, selectedFile]);

  useEffect(() => {
    // 重置所有选择状态
    clearSelection();
  }, [searchTerm, clearSelection]);

  useEffect(() => {
    if (selectedFiles.length > 0) {
      const deduplicatedFiles = deduplicateSelectedFiles(selectedFiles);
      if (deduplicatedFiles.length !== selectedFiles.length) {
        setSelectedFiles(deduplicatedFiles);
      }
    }
  }, [selectedFiles, deduplicateSelectedFiles]);
  const previousResetKeyRef = useRef(selectionResetKey);
  useEffect(() => {
    if (previousResetKeyRef.current !== selectionResetKey) {
      previousResetKeyRef.current = selectionResetKey;
      clearSelection();
    } else {
      reconcileSelectionWithNextList(files);
    }
  }, [
    files,
    selectionResetKey,
    clearSelection,
    reconcileSelectionWithNextList,
  ]);
  const replaceSelection = useCallback((nextFiles, index = 0) => {
    setSelectedFiles(nextFiles);
    setSelectedFile(nextFiles[0] || null);
    setLastSelectedIndex(nextFiles.length ? index : -1);
    setAnchorIndex(nextFiles.length ? index : -1);
  }, []);
  const selectForContextMenu = useCallback(
    (file, index) => {
      if (!isFileSelected(file)) setSelectedFiles([file]);
      setSelectedFile(file);
      setLastSelectedIndex(index);
      setAnchorIndex(index);
    },
    [isFileSelected],
  );
  const selectAll = useCallback(
    () => replaceSelection([...displayFiles]),
    [replaceSelection, displayFiles],
  );
  return {
    searchTerm,
    setSearchTerm,
    searchInputRef,
    showSearch,
    setShowSearch,
    selectedFile,
    selectedFiles,
    sortMode,
    setSortMode,
    clearSelection,
    handleSearchChange,
    toggleSearch,
    handleSearchBlur,
    isFileSelected,
    displayFiles,
    handleFileSelect,
    getSelectedFiles,
    replaceSelection,
    selectForContextMenu,
    selectAll,
  };
}
