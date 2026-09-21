import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import { useTranslation } from "react-i18next";
export default function UploadMenu({
  uploadMenuAnchor,
  handleUploadMenuClose,
  handleUploadFileFromMenu,
  handleUploadFolderFromMenu,
}) {
  const { t } = useTranslation();
  return (
    <Menu
      open={Boolean(uploadMenuAnchor)}
      onClose={handleUploadMenuClose}
      anchorEl={uploadMenuAnchor}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      transformOrigin={{
        vertical: "top",
        horizontal: "left",
      }}
    >
      <MenuItem onClick={handleUploadFileFromMenu}>
        <ListItemIcon>
          <UploadFileIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.uploadFile")}</ListItemText>
      </MenuItem>
      <MenuItem onClick={handleUploadFolderFromMenu}>
        <ListItemIcon>
          <CreateNewFolderIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.uploadFolder")}</ListItemText>
      </MenuItem>
    </Menu>
  );
}
