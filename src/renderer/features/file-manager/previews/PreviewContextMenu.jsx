import {
  Typography,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DownloadIcon from "@mui/icons-material/Download";
import SearchIcon from "@mui/icons-material/Search";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import { useTranslation } from "react-i18next";
import { compactContextMenuPaperSx } from "../../../shared/ui/contextMenuStyles";

export default function PreviewContextMenu({
  contextMenu,
  handleContextMenuClose,
  isEditorContextMenu,
  isTextContextMenu,
  handleCutSelection,
  canEditFromContextMenu,
  handleCopySelection,
  handlePasteText,
  handleSelectAllContent,
  handleSearchFromContextMenu,
  canSearchFromContextMenu,
  handleDownloadFromContextMenu,
  loading,
  savingFile,
}) {
  const { t } = useTranslation();
  return (
    <Menu
      open={Boolean(contextMenu)}
      onClose={handleContextMenuClose}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu
          ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
          : undefined
      }
      PaperProps={{
        "data-file-preview-context-menu": "true",
        sx: compactContextMenuPaperSx,
      }}
      transitionDuration={0}
      disableAutoFocusItem
      disableScrollLock
    >
      {isEditorContextMenu ? (
        <>
          {isTextContextMenu ? (
            <MenuItem
              onClick={handleCutSelection}
              disabled={!canEditFromContextMenu || !contextMenu?.canCopy}
            >
              <ListItemIcon>
                <ContentCutIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("filePreview.contextMenu.cut")}</ListItemText>
              <Typography variant="caption" color="text.secondary">
                Ctrl+X
              </Typography>
            </MenuItem>
          ) : null}
          <MenuItem
            onClick={handleCopySelection}
            disabled={!contextMenu?.canCopy}
          >
            <ListItemIcon>
              <ContentCopyIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("filePreview.contextMenu.copy")}</ListItemText>
            <Typography variant="caption" color="text.secondary">
              Ctrl+C
            </Typography>
          </MenuItem>
          {isTextContextMenu ? (
            <MenuItem
              onClick={handlePasteText}
              disabled={!canEditFromContextMenu}
            >
              <ListItemIcon>
                <ContentPasteIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("filePreview.contextMenu.paste")}</ListItemText>
              <Typography variant="caption" color="text.secondary">
                Ctrl+V
              </Typography>
            </MenuItem>
          ) : null}
          <Divider />
          <MenuItem onClick={handleSelectAllContent}>
            <ListItemIcon>
              <SelectAllIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {t("filePreview.contextMenu.selectAll")}
            </ListItemText>
            <Typography variant="caption" color="text.secondary">
              Ctrl+A
            </Typography>
          </MenuItem>
          {isTextContextMenu ? (
            <MenuItem
              onClick={handleSearchFromContextMenu}
              disabled={!canSearchFromContextMenu}
            >
              <ListItemIcon>
                <SearchIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("filePreview.contextMenu.search")}</ListItemText>
              <Typography variant="caption" color="text.secondary">
                Ctrl+F
              </Typography>
            </MenuItem>
          ) : null}
          <Divider />
        </>
      ) : null}
      <MenuItem
        onClick={handleDownloadFromContextMenu}
        disabled={loading || savingFile}
      >
        <ListItemIcon>
          <DownloadIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("filePreview.contextMenu.download")}</ListItemText>
      </MenuItem>
    </Menu>
  );
}
