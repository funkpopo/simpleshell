import Dialog from "../../AccessibleDialog.jsx";
import {
  Box,
  TextField,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
// TransferProgressFloat 已移至全局显示,不再导入
import FilePermissionEditor from "../../FilePermissionEditor.jsx";
import { useTranslation } from "react-i18next";
export default function PermissionDialog({
  showPermissionDialog,
  handlePermissionDialogClose,
  handlePermissionDialogSubmit,
  permDialogPermissions,
  setPermDialogPermissions,
  permDialogOwner,
  setPermDialogOwner,
  permDialogGroup,
  setPermDialogGroup,
  permissionSubmitting = false,
}) {
  const { t } = useTranslation();
  if (!showPermissionDialog) return null;
  return (
    <Dialog
      open={showPermissionDialog}
      onClose={handlePermissionDialogClose}
      maxWidth="sm"
      fullWidth
    >
      <Box component="form" onSubmit={handlePermissionDialogSubmit}>
        <DialogTitle>{t("fileManager.permissions")}</DialogTitle>
        <DialogContent dividers>
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <FilePermissionEditor
              permissions={permDialogPermissions}
              onChange={setPermDialogPermissions}
            />

            <Box
              sx={{
                display: "flex",
                gap: 2,
              }}
            >
              <TextField
                fullWidth
                label={t("fileManager.owner")}
                value={permDialogOwner}
                onChange={(e) => setPermDialogOwner(e.target.value)}
                variant="outlined"
                size="small"
              />
              <TextField
                fullWidth
                label={t("fileManager.group")}
                value={permDialogGroup}
                onChange={(e) => setPermDialogGroup(e.target.value)}
                variant="outlined"
                size="small"
              />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            pb: 2,
          }}
        >
          <Button
            onClick={handlePermissionDialogClose}
            disabled={permissionSubmitting}
            color="inherit"
            size="small"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            disabled={permissionSubmitting}
            variant="contained"
            color="primary"
            size="small"
          >
            {t("common.save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
