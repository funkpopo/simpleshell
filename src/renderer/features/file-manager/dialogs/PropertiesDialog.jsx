import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import {
  Box,
  Typography,
  CircularProgress,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import { useTranslation } from "react-i18next";
export default function PropertiesDialog({
  showPropertiesDialog,
  handleClosePropertiesDialog,
  propertiesLoading,
  propertiesData,
  formatAbsoluteTime,
}) {
  const { t } = useTranslation();
  if (!showPropertiesDialog) return null;
  return (
    <Dialog
      open={showPropertiesDialog}
      onClose={handleClosePropertiesDialog}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>{t("fileManager.properties")}</DialogTitle>
      <DialogContent dividers>
        {propertiesLoading && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 2,
            }}
          >
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              {t("fileManager.propertiesDialog.loading")}
            </Typography>
          </Box>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "120px minmax(0, 1fr)",
            rowGap: 1,
            columnGap: 1.5,
            alignItems: "start",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.name")}
          </Typography>
          <Typography variant="body2">
            {propertiesData?.name ||
              t("fileManager.propertiesDialog.notAvailable")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.type")}
          </Typography>
          <Typography variant="body2">
            {propertiesData?.type ||
              t("fileManager.propertiesDialog.notAvailable")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.path")}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              wordBreak: "break-all",
              whiteSpace: "pre-wrap",
            }}
          >
            {propertiesData?.path ||
              t("fileManager.propertiesDialog.notAvailable")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.size")}
          </Typography>
          <Typography variant="body2">
            {Number.isFinite(propertiesData?.size)
              ? formatFileSize(propertiesData.size, {
                  t,
                })
              : t("fileManager.propertiesDialog.notAvailable")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.modifiedTime")}
          </Typography>
          <Typography variant="body2">
            {formatAbsoluteTime(propertiesData?.modifyTime)}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.accessTime")}
          </Typography>
          <Typography variant="body2">
            {formatAbsoluteTime(propertiesData?.accessTime)}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.createdTime")}
          </Typography>
          <Typography variant="body2">
            {formatAbsoluteTime(propertiesData?.createTime)}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.permissions")}
          </Typography>
          <Typography variant="body2">
            {propertiesData?.permissions ||
              t("fileManager.propertiesDialog.notAvailable")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.owner")}
          </Typography>
          <Typography variant="body2">
            {Number.isFinite(propertiesData?.uid)
              ? String(propertiesData.uid)
              : t("fileManager.propertiesDialog.notAvailable")}
          </Typography>

          <Typography variant="body2" color="text.secondary">
            {t("fileManager.propertiesDialog.group")}
          </Typography>
          <Typography variant="body2">
            {Number.isFinite(propertiesData?.gid)
              ? String(propertiesData.gid)
              : t("fileManager.propertiesDialog.notAvailable")}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClosePropertiesDialog} color="primary">
          {t("common.cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
