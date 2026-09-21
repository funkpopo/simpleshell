import { useState, useCallback, useMemo } from "react";
import useContextMenuRetarget from "../../../shared/hooks/useContextMenuRetarget";

/** Owns menu anchors and routes menu interactions to file and selection commands. */
export default function useFileMenus({
  selectForContextMenu,
  busy,
  selectedFiles,
  selectedFile,
  isDeleting,
  clearSelection,
  fileManagerRootRef,
  handleCreateFolder,
  handleCreateFile,
  handleUploadFile,
  handleUploadFolder,
  setSortMode,
}) {
  const [contextMenu, setContextMenu] = useState(null);

  const [blankContextMenu, setBlankContextMenu] = useState(null);

  const [createMenuAnchor, setCreateMenuAnchor] = useState(null);

  const [uploadMenuAnchor, setUploadMenuAnchor] = useState(null);

  const [sortMenuAnchor, setSortMenuAnchor] = useState(null);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback(
    (event, file, index) => {
      if (busy) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      // 先更新选中状态，再打开菜单，避免菜单内容/可用操作滞后一帧
      selectForContextMenu(file, index);

      // 尝试把“焦点”直接切到右键行，减少需要左键才能生效的体感
      try {
        const currentTarget = event.currentTarget;
        const focusTarget =
          currentTarget?.querySelector?.('[data-file-item="true"]') ||
          currentTarget;
        focusTarget?.focus?.();
      } catch (_) {
        // ignore
      }

      setContextMenu({
        mouseX: event.clientX,
        mouseY: event.clientY,
      });
    },
    [selectForContextMenu, busy],
  );

  const menuItems = useMemo(() => {
    const selected =
      selectedFiles.length > 0
        ? selectedFiles
        : selectedFile
          ? [selectedFile]
          : [];

    const hasFiles = selected.some((f) => !f.isDirectory);
    const hasFolders = selected.some((f) => f.isDirectory);
    const fileCount = selected.filter((f) => !f.isDirectory).length;
    const folderCount = selected.filter((f) => f.isDirectory).length;

    return {
      isSingleSelection: selected.length === 1,
      hasFiles,
      hasFolders,
      fileCount,
      folderCount,
      isDirectorySelected: selectedFile?.isDirectory,
      isDeleting,
    };
  }, [selectedFiles, selectedFile, isDeleting]);

  const handleBlankContextMenu = (event) => {
    if (busy) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // 确保不是针对列表项的右键点击
    if (event.target.closest("li")) {
      return;
    }

    // 重置选中文件，确保上传操作使用当前目录
    clearSelection();

    setBlankContextMenu({
      mouseX: event.clientX,
      mouseY: event.clientY,
    });
  };

  const handleBlankClick = useCallback(
    (event) => {
      if (
        event?.target instanceof Element &&
        event.target.closest('[data-file-item="true"]')
      ) {
        return;
      }

      if (!selectedFile && selectedFiles.length === 0) {
        return;
      }

      clearSelection();
    },
    [clearSelection, selectedFile, selectedFiles.length],
  );

  const handleBlankContextMenuClose = () => {
    setBlankContextMenu(null);
  };

  useContextMenuRetarget({
    enabled: Boolean(contextMenu || blankContextMenu),
    rootRef: fileManagerRootRef,
    menuSelector: '[data-file-manager-context-menu="true"]',
    mode: "redispatch",
    // 尽量把事件派发到"行级"元素，确保 React 的 onContextMenu 回调能稳定命中
    resolveItemElement: (retargetElement) =>
      retargetElement.closest('[data-file-item="true"]') ||
      retargetElement.closest("li") ||
      retargetElement,
    onCloseMenus: () => {
      setContextMenu(null);
      setBlankContextMenu(null);
    },
  });

  const handleCreateMenuOpen = (event) => {
    setCreateMenuAnchor(event.currentTarget);
  };

  const handleCreateMenuClose = () => {
    setCreateMenuAnchor(null);
  };

  const handleCreateFolderFromMenu = () => {
    handleCreateMenuClose();
    handleCreateFolder();
  };

  const handleCreateFileFromMenu = () => {
    handleCreateMenuClose();
    handleCreateFile();
  };

  const handleUploadMenuOpen = (event) => {
    setUploadMenuAnchor(event.currentTarget);
  };

  const handleUploadMenuClose = () => {
    setUploadMenuAnchor(null);
  };

  const handleUploadFileFromMenu = () => {
    handleUploadMenuClose();
    handleUploadFile();
  };

  const handleUploadFolderFromMenu = () => {
    handleUploadMenuClose();
    handleUploadFolder();
  };

  const handleSortMenuOpen = (event) => {
    setSortMenuAnchor(event.currentTarget);
  };

  const handleSortMenuClose = () => {
    setSortMenuAnchor(null);
  };

  const handleSortModeChange = (mode) => {
    setSortMode(mode);
    handleSortMenuClose();
  };
  const closeMenus = useCallback(() => {
    setContextMenu(null);
    setBlankContextMenu(null);
  }, []);
  return {
    contextMenu,
    blankContextMenu,
    createMenuAnchor,
    uploadMenuAnchor,
    sortMenuAnchor,
    handleContextMenuClose,
    handleContextMenu,
    menuItems,
    handleBlankContextMenu,
    handleBlankClick,
    handleBlankContextMenuClose,
    handleCreateMenuOpen,
    handleCreateMenuClose,
    handleCreateFolderFromMenu,
    handleCreateFileFromMenu,
    handleUploadMenuOpen,
    handleUploadMenuClose,
    handleUploadFileFromMenu,
    handleUploadFolderFromMenu,
    handleSortMenuOpen,
    handleSortMenuClose,
    handleSortModeChange,
    closeMenus,
  };
}
