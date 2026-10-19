import { useRef, useState } from "react";
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useTranslation } from "react-i18next";
import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import { compactContextMenuPaperSx } from "../../../shared/ui/contextMenuStyles";
import usePreviewDownload from "../hooks/usePreviewDownload.js";
import usePreviewNotification from "../hooks/usePreviewNotification.js";

export default function BinaryPreviewDialog({
  open,
  onClose,
  file,
  tabId,
  fullPath,
  loading,
  error,
  releaseCache,
  pdf = false,
  controls,
  children,
}) {
  const { t } = useTranslation();
  const setNotification = usePreviewNotification();
  const handleDownload = usePreviewDownload({
    file,
    tabId,
    fullPath,
    setNotification,
  });
  const [contextMenu, setContextMenu] = useState(null);
  const closingRef = useRef(false);
  const handleClose = async () => {
    if (closingRef.current) return;
    closingRef.current = true;
    try {
      await releaseCache();
      onClose();
    } finally {
      closingRef.current = false;
    }
  };
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={pdf ? "xl" : "lg"}
      fullWidth
      PaperProps={{
        "data-file-preview-dialog": "true",
        sx: {
          minHeight: pdf ? "85vh" : "70vh",
          maxHeight: pdf ? "95vh" : "85vh",
          minWidth: pdf ? "min(1024px, 95vw)" : "min(900px, 90vw)",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <DialogTitle sx={{ px: 2.5, py: 2 }}>
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1.5}
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" noWrap>
              {file.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {fullPath}
            </Typography>
          </Box>
          {file.size ? (
            <Chip
              size="small"
              label={formatFileSize(file.size)}
              variant="outlined"
            />
          ) : null}
        </Stack>
      </DialogTitle>
      <DialogContent
        dividers
        onContextMenu={(event) => {
          if (event.target.closest?.('button, [role="button"]')) return;
          event.preventDefault();
          event.stopPropagation();
          setContextMenu({ top: event.clientY - 6, left: event.clientX + 2 });
        }}
        sx={{
          flex: "1 1 auto",
          p: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          width: "100%",
          maxWidth: "100%",
        }}
      >
        {loading ? (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress size={40} />
          </Box>
        ) : error ? (
          <Typography sx={{ p: 2 }} color="error">
            {error}
          </Typography>
        ) : (
          children
        )}
      </DialogContent>
      <DialogActions
        sx={{
          px: 2.5,
          py: 1.5,
          gap: 1,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownload}
          disabled={loading}
        >
          {t("filePreview.download")}
        </Button>
        <Stack direction="row" spacing={1} alignItems="center">
          {controls}
          <Button size="small" onClick={handleClose}>
            {t("common.close")}
          </Button>
        </Stack>
      </DialogActions>
      <Menu
        open={Boolean(contextMenu)}
        onClose={() => setContextMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu || undefined}
        PaperProps={{
          "data-file-preview-context-menu": "true",
          sx: compactContextMenuPaperSx,
        }}
        transitionDuration={0}
        disableAutoFocusItem
        disableScrollLock
      >
        <MenuItem
          disabled={loading}
          onClick={() => {
            setContextMenu(null);
            handleDownload();
          }}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("filePreview.contextMenu.download")}</ListItemText>
        </MenuItem>
      </Menu>
    </Dialog>
  );
}
