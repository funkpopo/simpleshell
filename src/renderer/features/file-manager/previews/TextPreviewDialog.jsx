import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  CircularProgress,
  ButtonGroup,
  Stack,
  Chip,
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import PreviewContextMenu from "./PreviewContextMenu.jsx";

export default function TextPreviewDialog({
  open,
  handleClose,
  isTextPreview,
  file,
  modified,
  fullPath,
  syntaxHighlightState,
  pendingRestoreSnapshot,
  isEditing,
  savingFile,
  children,
  handleDownload,
  loading,
  handleOpenTextSearch,
  switchToPreviewMode,
  switchToEditMode,
  handleSaveFile,
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
  showCloseConfirm,
  setShowCloseConfirm,
  handleDiscardAndClose,
  handleSaveAndClose,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={"lg"}
      fullWidth
      PaperProps={{
        "data-file-preview-dialog": "true",
        sx: {
          minHeight: "70vh",
          maxHeight: "85vh",
          minWidth: isTextPreview ? "min(1180px, 96vw)" : "min(900px, 90vw)",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <DialogTitle sx={{ px: 2.5, py: 2 }}>
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={1.5}
          alignItems={{ xs: "flex-start", md: "center" }}
          justifyContent="space-between"
        >
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="h6" component="div" noWrap>
              {file?.name}
              {modified ? (
                <span style={{ color: theme.palette.warning.main }}> *</span>
              ) : null}
            </Typography>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                mt: 0.5,
                maxWidth: "100%",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {fullPath}
            </Typography>
          </Box>

          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            flexWrap="wrap"
            useFlexGap
          >
            {file?.size ? (
              <Chip
                size="small"
                label={formatFileSize(file.size)}
                variant="outlined"
              />
            ) : null}
            {isTextPreview && syntaxHighlightState.languageId ? (
              <Chip
                size="small"
                color={syntaxHighlightState.error ? "error" : "info"}
                label={
                  syntaxHighlightState.error
                    ? t("filePreview.syntaxHighlightFailed")
                    : syntaxHighlightState.loading
                      ? t("filePreview.syntaxHighlightLoading")
                      : t("filePreview.syntaxHighlightReady", {
                          language: syntaxHighlightState.languageId,
                        })
                }
                variant={syntaxHighlightState.loading ? "outlined" : "filled"}
              />
            ) : null}
            {isTextPreview ? (
              <Chip
                size="small"
                color={
                  pendingRestoreSnapshot
                    ? "info"
                    : modified
                      ? "warning"
                      : isEditing
                        ? "primary"
                        : "default"
                }
                label={
                  pendingRestoreSnapshot
                    ? t("filePreview.status.diff")
                    : modified
                      ? t("filePreview.status.modified")
                      : isEditing
                        ? t("filePreview.status.editing")
                        : t("filePreview.status.readOnly")
                }
                variant={
                  pendingRestoreSnapshot || modified || isEditing
                    ? "filled"
                    : "outlined"
                }
              />
            ) : null}
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent
        dividers
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
        {savingFile ? (
          <Box
            sx={{
              display: "flex",
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <CircularProgress size={40} />
            <Typography variant="body1" sx={{ ml: 2 }}>
              {t("filePreview.savingFile")}
            </Typography>
          </Box>
        ) : (
          children
        )}
      </DialogContent>
      <DialogActions
        sx={{
          px: 2.5,
          py: 1.5,
          gap: 1,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownload}
          disabled={loading || savingFile}
        >
          {t("filePreview.download")}
        </Button>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="flex-end"
          flexWrap="wrap"
          useFlexGap
          sx={{ minWidth: 0 }}
        >
          {isTextPreview ? (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SearchIcon />}
                onClick={handleOpenTextSearch}
                disabled={
                  loading ||
                  savingFile ||
                  Boolean(pendingRestoreSnapshot) ||
                  syntaxHighlightState.loading ||
                  Boolean(syntaxHighlightState.error)
                }
              >
                {t("filePreview.searchPanel.open")}
              </Button>
              <ButtonGroup size="small" variant="outlined">
                <Button
                  variant={!isEditing ? "contained" : "outlined"}
                  startIcon={<VisibilityIcon />}
                  onClick={switchToPreviewMode}
                  disabled={
                    loading ||
                    savingFile ||
                    Boolean(pendingRestoreSnapshot) ||
                    syntaxHighlightState.loading ||
                    Boolean(syntaxHighlightState.error)
                  }
                >
                  {t("filePreview.previewMode")}
                </Button>
                <Button
                  variant={isEditing ? "contained" : "outlined"}
                  startIcon={<EditIcon />}
                  onClick={switchToEditMode}
                  disabled={
                    loading ||
                    savingFile ||
                    Boolean(pendingRestoreSnapshot) ||
                    syntaxHighlightState.loading ||
                    Boolean(syntaxHighlightState.error)
                  }
                >
                  {t("filePreview.editMode")}
                </Button>
              </ButtonGroup>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveFile}
                disabled={
                  !modified ||
                  savingFile ||
                  loading ||
                  Boolean(pendingRestoreSnapshot) ||
                  syntaxHighlightState.loading ||
                  Boolean(syntaxHighlightState.error)
                }
              >
                {savingFile ? t("filePreview.saving") : t("common.save")}
              </Button>
            </>
          ) : null}
          {null}
          <Button size="small" onClick={handleClose} disabled={savingFile}>
            {t("common.close")}
          </Button>
        </Stack>
      </DialogActions>

      <PreviewContextMenu
        contextMenu={contextMenu}
        handleContextMenuClose={handleContextMenuClose}
        isEditorContextMenu={isEditorContextMenu}
        isTextContextMenu={isTextContextMenu}
        handleCutSelection={handleCutSelection}
        canEditFromContextMenu={canEditFromContextMenu}
        handleCopySelection={handleCopySelection}
        handlePasteText={handlePasteText}
        handleSelectAllContent={handleSelectAllContent}
        handleSearchFromContextMenu={handleSearchFromContextMenu}
        canSearchFromContextMenu={canSearchFromContextMenu}
        handleDownloadFromContextMenu={handleDownloadFromContextMenu}
        loading={loading}
        savingFile={savingFile}
      />

      <Dialog
        open={showCloseConfirm}
        onClose={() => {
          if (!savingFile) {
            setShowCloseConfirm(false);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("filePreview.unsavedTitle")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            {t("filePreview.unsavedMessage")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowCloseConfirm(false)}
            disabled={savingFile}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleDiscardAndClose}
            color="inherit"
            disabled={savingFile}
          >
            {t("filePreview.discardChanges")}
          </Button>
          <Button
            onClick={handleSaveAndClose}
            variant="contained"
            disabled={savingFile}
            startIcon={<SaveIcon />}
          >
            {savingFile
              ? t("filePreview.saving")
              : t("filePreview.saveAndClose")}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
