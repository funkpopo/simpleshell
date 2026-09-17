import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import NoteAddIcon from "@mui/icons-material/NoteAdd";
import { useTranslation } from "react-i18next";
export default function CreateMenu({
  createMenuAnchor,
  handleCreateMenuClose,
  handleCreateFileFromMenu,
  handleCreateFolderFromMenu,
}) {
  const { t } = useTranslation();
  return (
    <Menu
      open={Boolean(createMenuAnchor)}
      onClose={handleCreateMenuClose}
      anchorEl={createMenuAnchor}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      transformOrigin={{
        vertical: "top",
        horizontal: "left",
      }}
    >
      <MenuItem onClick={handleCreateFileFromMenu}>
        <ListItemIcon>
          <NoteAddIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.createFile")}</ListItemText>
      </MenuItem>
      <MenuItem onClick={handleCreateFolderFromMenu}>
        <ListItemIcon>
          <CreateNewFolderIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.createFolder")}</ListItemText>
      </MenuItem>
    </Menu>
  );
}
