import { memo, useRef } from "react";
import useAutoCleanup from "../../hooks/useAutoCleanup";
import { Box, Paper, Typography, CircularProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { FileManagerSkeleton } from "../SkeletonLoader.jsx";
import { useTranslation } from "react-i18next";
import { sidebarContentSx, sidebarPaperSx } from "../sidebarItemStyles";
import { SidebarTitleBar } from "../SidebarPanel.jsx";
import useSidebarPanel from "../../hooks/useSidebarPanel";
import useFileNotifications from "./hooks/useFileNotifications.js";
import useConfirmDialog from "./hooks/useConfirmDialog.js";
import useFileNav from "./hooks/useFileNav.js";
import useFileSelection from "./hooks/useFileSelection.js";
import useFileOps from "./hooks/useFileOps.js";
import useTransferTasks from "./hooks/useTransferTasks.js";
import useFileMenus from "./hooks/useFileMenus.js";
import useFileKeyboard from "./hooks/useFileKeyboard.js";
import useFileManagerClose from "./hooks/useFileManagerClose.js";
import useDragDrop from "./hooks/useDragDrop.js";
import FileToolbar from "./panels/FileToolbar.jsx";
import Breadcrumbs from "./panels/Breadcrumbs.jsx";
import FileContextMenus from "./panels/FileContextMenus.jsx";
import BlankContextMenu from "./panels/BlankContextMenu.jsx";
import CreateMenu from "./panels/CreateMenu.jsx";
import UploadMenu from "./panels/UploadMenu.jsx";
import SortMenu from "./panels/SortMenu.jsx";
import ConfirmDialog from "./dialogs/ConfirmDialog.jsx";
import RenameDialog from "./dialogs/RenameDialog.jsx";
import PermissionDialog from "./dialogs/PermissionDialog.jsx";
import PropertiesDialog from "./dialogs/PropertiesDialog.jsx";
import CreateFolderDialog from "./dialogs/CreateFolderDialog.jsx";
import CreateFileDialog from "./dialogs/CreateFileDialog.jsx";
import PreviewDialog from "./dialogs/PreviewDialog.jsx";
import DragOverlay from "./panels/DragOverlay.jsx";
import FileList from "./panels/FileList.jsx";
const FileManagerContainer = memo(
  ({
    open,
    onClose,
    sshConnection,
    tabId,
    tabName,
    initialPath = "/",
    navigationState,
    onPathChange,
    onNavigationStateChange,
    sessionContext = null,
    followTerminalDirectory = false,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const fileManagerRootRef = useRef(null);
    // 使用自动清理Hook
    const { addTimeout } = useAutoCleanup();
    const { showNotification, setNotification } = useFileNotifications();
    const {
      confirmDialog,
      confirmAction,
      confirmDialogCancelButtonRef,
      confirmDialogConfirmButtonRef,
      showConfirmDialog,
      handleConfirmDialogCancel,
      handleConfirmDialogConfirm,
    } = useConfirmDialog();
    const {
      selectionResetKey,
      currentPath,
      files,
      loading,
      error,
      connectionLoading,
      connectionLoadingMessage,
      lastRefreshTime,
      pathInput,
      pathHistory,
      historyIndex,
      isChunking,
      listToken,
      loadDirectory,
      handleHistoryBack,
      handleGoToNextPath,
      handleEnterDirectory,
      handleGoUp,
      handleRefresh,
      handleGoHome,
      refreshAfterUserActivity,
      handlePathInputChange,
      pathInputSubmitOnCompositionEndRef,
      handlePathInputSubmit,
      handlePathInputCompositionEnd,
    } = useFileNav({
      open,
      initialPath,
      navigationState,
      tabId,
      onNavigationStateChange,
      onPathChange,
      sshConnection,
      showNotification,
      followTerminalDirectory,
    });
    const {
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
      selectAll,
      selectForContextMenu,
    } = useFileSelection({
      files,
      isChunking,
      selectionResetKey,
    });
    const {
      isDeleting,
      showRenameDialog,
      newName,
      setNewName,
      renameDialogError,
      renameSubmitting,
      showCreateFolderDialog,
      newFolderName,
      setNewFolderName,
      createFolderDialogError,
      createFolderSubmitting,
      showCreateFileDialog,
      newFileName,
      setNewFileName,
      createFileDialogError,
      createFileSubmitting,
      filePreview,
      showPreview,
      showPropertiesDialog,
      propertiesLoading,
      propertiesData,
      showPermissionDialog,
      permDialogPermissions,
      setPermDialogPermissions,
      permDialogOwner,
      setPermDialogOwner,
      permDialogGroup,
      setPermDialogGroup,
      formatAbsoluteTime,
      handleOpenProperties,
      handleClosePropertiesDialog,
      handleOpenPermissions,
      handlePermissionDialogClose,
      handlePermissionDialogSubmit,
      handleDelete,
      handleCopyAbsolutePath,
      handleCreateFolder,
      handleCloseCreateFolderDialog,
      handleCreateFolderSubmit,
      handleCreateFile,
      handleCloseCreateFileDialog,
      handleCreateFileSubmit,
      handleFileActivate,
      handleClosePreview,
      handleRename,
      handleCloseRenameDialog,
      handleRenameSubmit,
    } = useFileOps({
      showNotification,
      confirmAction,
      currentPath,
      tabId,
      loadDirectory,
      replaceSelection,
      clearSelection,
      selectedFile,
      getSelectedFiles,
      sshConnection,
      refreshAfterUserActivity,
      handleEnterDirectory,
    });
    const {
      getTransferList,
      handleUploadFile,
      handleUploadFolder,
      handleDroppedItems,
      handleDownload,
      handleDownloadFolder,
      handleDownloadSelection,
    } = useTransferTasks({
      tabId,
      showNotification,
      sshConnection,
      currentPath,
      selectedFile,
      loadDirectory,
      refreshAfterUserActivity,
      showConfirmDialog,
      setNotification,
      getSelectedFiles,
    });
    const {
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
    } = useFileMenus({
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
      selectForContextMenu,
      busy: loading || isDeleting,
    });
    useFileKeyboard({
      open,
      showPreview,
      getSelectedFiles,
      handleDownloadSelection,
      handleDelete,
      showNotification,
      handleRename,
      handleOpenPermissions,
      handleOpenProperties,
      handleRefresh,
      handleCopyAbsolutePath,
      handleCreateFile,
      handleCreateFolder,
      handleUploadFile,
      handleUploadFolder,
      handleDownloadFolder,
      handleDownload,
      selectAll,
      clearSelection,
    });
    const { isClosing, handleClose } = useFileManagerClose({
      open,
      onClose,
      addTimeout,
      getTransferList,
      confirmAction,
    });
    const {
      isDragging,
      handleDragEnter,
      handleDragLeave,
      handleDragOver,
      handleDrop,
    } = useDragDrop({
      sshConnection,
      setNotification,
      handleDroppedItems,
    });
    const focusSidebarRoot = (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }
      const focusableTarget = event.target.closest(
        'input, textarea, select, button, [role="button"], [tabindex]',
      );
      if (focusableTarget && focusableTarget !== fileManagerRootRef.current) {
        return;
      }
      fileManagerRootRef.current?.focus({
        preventScroll: true,
      });
    };

    // 键盘快捷键处理（Ctrl+/ 与 Ctrl+F 聚焦搜索框）
    useSidebarPanel({
      open,
      rootRef: fileManagerRootRef,
      shouldIgnoreKeydown: (e) => {
        if (showPreview) return true;
        const targetElement = e.target || document.activeElement;
        return Boolean(
          targetElement &&
          typeof targetElement.closest === "function" &&
          targetElement.closest('[data-file-preview-dialog="true"]'),
        );
      },
      onSearchShortcut: () => {
        if (!showSearch) {
          setShowSearch(true);
        }
        // 等待一帧后聚焦，确保输入框已渲染
        setTimeout(() => {
          if (searchInputRef.current) {
            searchInputRef.current.focus();
          }
        }, 0);
      },
    });

    // 使用自动清理Hook
    return (
      <Paper
        ref={fileManagerRootRef}
        tabIndex={-1}
        onMouseDown={focusSidebarRoot}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        sx={{
          ...sidebarPaperSx(theme),
          position: "relative",
          // 拖拽时的视觉反馈（不可用半透明色覆盖背景，否则 Paper 会变透明透出底层深色背景）
          ...(isDragging && {
            backgroundColor: "background.paper",
            border: `2px dashed ${theme.palette.primary.main}`,
            boxShadow: `0 0 20px ${theme.palette.primary.main}30`,
          }),
        }}
        elevation={theme.palette.mode === "dark" ? 1 : 0}
      >
        <Box sx={sidebarContentSx(theme, open)}>
          <SidebarTitleBar
            title={
              tabName
                ? `${t("fileManager.title")} - ${tabName}`
                : t("fileManager.title")
            }
            titleSx={{
              flexGrow: 1,
            }}
            onClose={handleClose}
            closeDisabled={isClosing}
            sessionContext={
              sessionContext ||
              (tabName
                ? {
                    host: tabName,
                    protocol: "SSH",
                  }
                : null)
            }
          />

          <FileToolbar
            handleHistoryBack={handleHistoryBack}
            historyIndex={historyIndex}
            handleGoToNextPath={handleGoToNextPath}
            pathHistory={pathHistory}
            handleGoUp={handleGoUp}
            currentPath={currentPath}
            handleGoHome={handleGoHome}
            handleRefresh={handleRefresh}
            lastRefreshTime={lastRefreshTime}
            handleCreateMenuOpen={handleCreateMenuOpen}
            handleUploadMenuOpen={handleUploadMenuOpen}
            showSearch={showSearch}
            searchInputRef={searchInputRef}
            searchTerm={searchTerm}
            handleSearchChange={handleSearchChange}
            handleSearchBlur={handleSearchBlur}
            setSearchTerm={setSearchTerm}
            setShowSearch={setShowSearch}
            toggleSearch={toggleSearch}
            handleSortMenuOpen={handleSortMenuOpen}
            sortMode={sortMode}
          />

          <Breadcrumbs
            pathInput={pathInput}
            handlePathInputChange={handlePathInputChange}
            handlePathInputSubmit={handlePathInputSubmit}
            pathInputSubmitOnCompositionEndRef={
              pathInputSubmitOnCompositionEndRef
            }
            handlePathInputCompositionEnd={handlePathInputCompositionEnd}
          />

          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              marginTop: 0,
              // 确保没有额外的边距
              display: "flex",
              flexDirection: "column",
              height: 0,
              // 确保flex布局正常工作
              position: "relative", // 创建新的定位上下文
            }}
            onContextMenu={handleBlankContextMenu} // 添加空白区域右键菜单
          >
            {connectionLoading ? (
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  height: "100%",
                  width: "100%",
                  gap: 1.5,
                  px: 2,
                }}
              >
                <CircularProgress size={24} />
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    textAlign: "center",
                  }}
                >
                  {connectionLoadingMessage || t("fileManager.loading")}
                </Typography>
              </Box>
            ) : loading ? (
              <FileManagerSkeleton />
            ) : (
              <FileList
                displayFiles={displayFiles}
                loading={loading || isDeleting}
                error={error}
                searchTerm={searchTerm}
                isChunking={isChunking}
                listToken={listToken}
                handleBlankContextMenu={handleBlankContextMenu}
                handleBlankClick={handleBlankClick}
                isFileSelected={isFileSelected}
                handleContextMenu={handleContextMenu}
                handleFileSelect={handleFileSelect}
                handleFileActivate={handleFileActivate}
              />
            )}
          </Box>
        </Box>

        <FileContextMenus
          contextMenu={contextMenu}
          menuItems={menuItems}
          handleContextMenuClose={handleContextMenuClose}
          handleDownload={handleDownload}
          handleDownloadFolder={handleDownloadFolder}
          handleUploadFile={handleUploadFile}
          handleUploadFolder={handleUploadFolder}
          handleCopyAbsolutePath={handleCopyAbsolutePath}
          handleRename={handleRename}
          handleOpenProperties={handleOpenProperties}
          handleOpenPermissions={handleOpenPermissions}
          handleDelete={handleDelete}
          selectedFiles={selectedFiles}
          closeMenus={closeMenus}
        />

        <BlankContextMenu
          blankContextMenu={blankContextMenu}
          menuItems={menuItems}
          handleBlankContextMenuClose={handleBlankContextMenuClose}
          handleCreateFolder={handleCreateFolder}
          handleCreateFile={handleCreateFile}
          handleUploadFile={handleUploadFile}
          handleUploadFolder={handleUploadFolder}
          handleRefresh={handleRefresh}
          closeMenus={closeMenus}
        />

        {
          <RenameDialog
            showRenameDialog={showRenameDialog}
            handleCloseRenameDialog={handleCloseRenameDialog}
            handleRenameSubmit={handleRenameSubmit}
            newName={newName}
            setNewName={setNewName}
            renameDialogError={renameDialogError}
            renameSubmitting={renameSubmitting}
          />
        }

        {
          <PermissionDialog
            showPermissionDialog={showPermissionDialog}
            handlePermissionDialogClose={handlePermissionDialogClose}
            handlePermissionDialogSubmit={handlePermissionDialogSubmit}
            permDialogPermissions={permDialogPermissions}
            setPermDialogPermissions={setPermDialogPermissions}
            permDialogOwner={permDialogOwner}
            setPermDialogOwner={setPermDialogOwner}
            permDialogGroup={permDialogGroup}
            setPermDialogGroup={setPermDialogGroup}
          />
        }

        {
          <PropertiesDialog
            showPropertiesDialog={showPropertiesDialog}
            handleClosePropertiesDialog={handleClosePropertiesDialog}
            propertiesLoading={propertiesLoading}
            propertiesData={propertiesData}
            formatAbsoluteTime={formatAbsoluteTime}
          />
        }

        {
          <CreateFolderDialog
            showCreateFolderDialog={showCreateFolderDialog}
            handleCloseCreateFolderDialog={handleCloseCreateFolderDialog}
            handleCreateFolderSubmit={handleCreateFolderSubmit}
            newFolderName={newFolderName}
            setNewFolderName={setNewFolderName}
            createFolderDialogError={createFolderDialogError}
            createFolderSubmitting={createFolderSubmitting}
          />
        }

        {
          <CreateFileDialog
            showCreateFileDialog={showCreateFileDialog}
            handleCloseCreateFileDialog={handleCloseCreateFileDialog}
            handleCreateFileSubmit={handleCreateFileSubmit}
            newFileName={newFileName}
            setNewFileName={setNewFileName}
            createFileDialogError={createFileDialogError}
            createFileSubmitting={createFileSubmitting}
          />
        }

        {
          <PreviewDialog
            showPreview={showPreview}
            handleClosePreview={handleClosePreview}
            filePreview={filePreview}
            currentPath={currentPath}
            tabId={tabId}
          />
        }

        {/* TransferProgressFloat已移至全局底部栏,不再在侧边栏内显示 */}

        <CreateMenu
          createMenuAnchor={createMenuAnchor}
          handleCreateMenuClose={handleCreateMenuClose}
          handleCreateFileFromMenu={handleCreateFileFromMenu}
          handleCreateFolderFromMenu={handleCreateFolderFromMenu}
          closeMenus={closeMenus}
        />

        <UploadMenu
          uploadMenuAnchor={uploadMenuAnchor}
          handleUploadMenuClose={handleUploadMenuClose}
          handleUploadFileFromMenu={handleUploadFileFromMenu}
          handleUploadFolderFromMenu={handleUploadFolderFromMenu}
          closeMenus={closeMenus}
        />

        <SortMenu
          sortMenuAnchor={sortMenuAnchor}
          handleSortMenuClose={handleSortMenuClose}
          handleSortModeChange={handleSortModeChange}
          sortMode={sortMode}
          closeMenus={closeMenus}
        />

        {/* 确认对话框 */}
        <ConfirmDialog
          confirmDialog={confirmDialog}
          confirmDialogConfirmButtonRef={confirmDialogConfirmButtonRef}
          confirmDialogCancelButtonRef={confirmDialogCancelButtonRef}
          handleConfirmDialogCancel={handleConfirmDialogCancel}
          handleConfirmDialogConfirm={handleConfirmDialogConfirm}
        />

        {/* 拖拽覆盖层：提示尺寸随侧栏自适应，避免窄宽度/长路径溢出 */}
        <DragOverlay
          isDragging={isDragging}
          selectedFile={selectedFile}
          currentPath={currentPath}
        />
      </Paper>
    );
  },
);
FileManagerContainer.displayName = "FileManagerContainer";
export default FileManagerContainer;
