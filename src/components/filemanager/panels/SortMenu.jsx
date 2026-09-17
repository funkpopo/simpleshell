import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import SortByAlphaIcon from "@mui/icons-material/SortByAlpha";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { useTranslation } from "react-i18next";
export default function SortMenu({
  sortMenuAnchor,
  handleSortMenuClose,
  handleSortModeChange,
  sortMode,
}) {
  const { t } = useTranslation();
  return (
    <Menu
      open={Boolean(sortMenuAnchor)}
      onClose={handleSortMenuClose}
      anchorEl={sortMenuAnchor}
      anchorOrigin={{
        vertical: "bottom",
        horizontal: "left",
      }}
      transformOrigin={{
        vertical: "top",
        horizontal: "left",
      }}
    >
      <MenuItem
        onClick={() => handleSortModeChange("name")}
        selected={sortMode === "name"}
      >
        <ListItemIcon>
          <SortByAlphaIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.sortByName")}</ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => handleSortModeChange("time")}
        selected={sortMode === "time"}
      >
        <ListItemIcon>
          <AccessTimeIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("fileManager.sortByTime")}</ListItemText>
      </MenuItem>
    </Menu>
  );
}
