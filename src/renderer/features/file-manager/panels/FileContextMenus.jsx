import {
  Typography,
  ListItemIcon,
  ListItemText,
  Divider,
  Menu,
  MenuItem,
} from "@mui/material";
import { compactContextMenuPaperSx } from "../../../shared/ui/contextMenuStyles";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import DeleteIcon from "@mui/icons-material/Delete";
import DownloadIcon from "@mui/icons-material/Download";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import LinkIcon from "@mui/icons-material/Link";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import LockIcon from "@mui/icons-material/Lock";
import { useTranslation } from "react-i18next";
export default function FileContextMenus({
  contextMenu,
  menuItems,
  handleContextMenuClose,
  handleDownload,
  handleDownloadFolder,
  handleUploadFile,
  handleUploadFolder,
  handleCopyAbsolutePath,
  handleRename,
  handleOpenProperties,
  handleOpenPermissions,
  handleDelete,
  selectedFiles,
  closeMenus,
}) {
  const { t } = useTranslation();
  return (
    <Menu
      open={contextMenu !== null && !menuItems.isDeleting}
      onClose={handleContextMenuClose}
      anchorReference="anchorPosition"
      PaperProps={{
        "data-file-manager-context-menu": "true",
        sx: compactContextMenuPaperSx,
      }}
      anchorPosition={
        contextMenu !== null
          ? {
              top: contextMenu.mouseY,
              left: contextMenu.mouseX,
            }
          : undefined
      }
      transitionDuration={0}
      disableAutoFocusItem
      disableScrollLock
    >
      {contextMenu !== null && [
        // 下载操作：支持单选和多选
        menuItems.hasFiles && (
          <MenuItem
            key="download-files"
            onClick={() => {
              closeMenus();
              return handleDownload();
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {menuItems.fileCount > 1
                ? t("fileManager.downloadFiles", {
                    count: menuItems.fileCount,
                  })
                : t("fileManager.downloadFile")}
            </ListItemText>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                ml: 2,
              }}
            >
              Ctrl+D
            </Typography>
          </MenuItem>
        ),
        menuItems.hasFolders && (
          <MenuItem
            key="download-folders"
            onClick={() => {
              closeMenus();
              return handleDownloadFolder();
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {menuItems.folderCount > 1
                ? t("fileManager.downloadFolders", {
                    count: menuItems.folderCount,
                  })
                : t("fileManager.downloadFolder")}
            </ListItemText>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                ml: 2,
              }}
            >
              Ctrl+D
            </Typography>
          </MenuItem>
        ),
        // 上传操作：仅在选中单个目录时显示
        menuItems.isSingleSelection && menuItems.isDirectorySelected && (
          <MenuItem
            key="upload-file"
            onClick={() => {
              closeMenus();
              return handleUploadFile();
            }}
          >
            <ListItemIcon>
              <UploadFileIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.uploadFile")}</ListItemText>
          </MenuItem>
        ),
        menuItems.isSingleSelection && menuItems.isDirectorySelected && (
          <MenuItem
            key="upload-folder"
            onClick={() => {
              closeMenus();
              return handleUploadFolder();
            }}
          >
            <ListItemIcon>
              <CreateNewFolderIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.uploadFolder")}</ListItemText>
          </MenuItem>
        ),
        menuItems.isSingleSelection && <Divider key="divider-1" />,
        // 仅在单选时显示复制路径
        menuItems.isSingleSelection && (
          <MenuItem
            key="copy-path"
            onClick={() => {
              closeMenus();
              return handleCopyAbsolutePath();
            }}
          >
            <ListItemIcon>
              <LinkIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.copyPath")}</ListItemText>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                ml: 2,
              }}
            >
              Ctrl+Shift+C
            </Typography>
          </MenuItem>
        ),
        // 仅在单选时显示重命名
        menuItems.isSingleSelection && (
          <MenuItem
            key="rename"
            onClick={() => {
              closeMenus();
              return handleRename();
            }}
          >
            <ListItemIcon>
              <DriveFileRenameOutlineIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.rename")}</ListItemText>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                ml: 2,
              }}
            >
              F2
            </Typography>
          </MenuItem>
        ),
        // 仅在单选时显示属性
        menuItems.isSingleSelection && (
          <MenuItem
            key="properties"
            onClick={() => {
              closeMenus();
              return handleOpenProperties();
            }}
          >
            <ListItemIcon>
              <InfoOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.properties")}</ListItemText>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                ml: 2,
              }}
            >
              F4
            </Typography>
          </MenuItem>
        ),
        // 仅在单选时显示权限设置
        menuItems.isSingleSelection && (
          <MenuItem
            key="permissions"
            onClick={() => {
              closeMenus();
              return handleOpenPermissions();
            }}
          >
            <ListItemIcon>
              <LockIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("fileManager.permissions")}</ListItemText>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                ml: 2,
              }}
            >
              F3
            </Typography>
          </MenuItem>
        ),
        <Divider key="divider-2" />,
        // 删除操作：支持单选和多选
        <MenuItem
          key="delete"
          onClick={() => {
            closeMenus();
            return handleDelete();
          }}
          disabled={menuItems.isDeleting}
        >
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>
            {menuItems.isDeleting
              ? t("fileManager.messages.operationInProgress")
              : selectedFiles.length > 1
                ? t("fileManager.deleteItems", {
                    count: selectedFiles.length,
                  })
                : t("fileManager.delete")}
          </ListItemText>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              ml: 2,
            }}
          >
            Delete
          </Typography>
        </MenuItem>,
      ]}
    </Menu>
  );
}
