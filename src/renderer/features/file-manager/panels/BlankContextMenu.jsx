import {
  Typography,
  ListItemIcon,
  ListItemText,
  Divider,
  Menu,
  MenuItem,
} from "@mui/material";
import { compactContextMenuPaperSx } from "../../../shared/ui/contextMenuStyles";
import RefreshIcon from "@mui/icons-material/Refresh";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import { useTranslation } from "react-i18next";
export default function BlankContextMenu({
  blankContextMenu,
  menuItems,
  handleBlankContextMenuClose,
  handleCreateFolder,
  handleCreateFile,
  handleUploadFile,
  handleUploadFolder,
  handleRefresh,
  closeMenus,
}) {
  const { t } = useTranslation();
  return (
    <Menu
      open={blankContextMenu !== null && !menuItems.isDeleting}
      onClose={handleBlankContextMenuClose}
      anchorReference="anchorPosition"
      PaperProps={{
        "data-file-manager-context-menu": "true",
        sx: compactContextMenuPaperSx,
      }}
      anchorPosition={
        blankContextMenu !== null
          ? {
              top: blankContextMenu.mouseY,
              left: blankContextMenu.mouseX,
            }
          : undefined
      }
      transitionDuration={0}
      disableAutoFocusItem
      disableScrollLock
    >
      <MenuItem
        onClick={() => {
          closeMenus();
          return handleCreateFolder();
        }}
      >
        <ListItemIcon>
          <CreateNewFolderIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.createFolder")}</ListItemText>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            ml: 2,
          }}
        >
          Ctrl+Shift+N
        </Typography>
      </MenuItem>

      <MenuItem
        onClick={() => {
          closeMenus();
          return handleCreateFile();
        }}
      >
        <ListItemIcon>
          <NoteAddIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.createFile")}</ListItemText>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            ml: 2,
          }}
        >
          Ctrl+N
        </Typography>
      </MenuItem>

      <Divider />

      <MenuItem
        onClick={() => {
          closeMenus();
          return handleUploadFile();
        }}
      >
        <ListItemIcon>
          <UploadFileIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          {t("fileManager.uploadFileToCurrentFolder")}
        </ListItemText>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            ml: 2,
          }}
        >
          Ctrl+U
        </Typography>
      </MenuItem>

      <MenuItem
        onClick={() => {
          closeMenus();
          return handleUploadFolder();
        }}
      >
        <ListItemIcon>
          <CreateNewFolderIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          {t("fileManager.uploadFolderToCurrentFolder")}
        </ListItemText>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            ml: 2,
          }}
        >
          Ctrl+Shift+U
        </Typography>
      </MenuItem>

      <Divider />

      <MenuItem onClick={handleRefresh}>
        <ListItemIcon>
          <RefreshIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.refreshDirectory")}</ListItemText>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{
            ml: 2,
          }}
        >
          F5
        </Typography>
      </MenuItem>
    </Menu>
  );
}
