import React from "react";
import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { Z_INDEX } from "../../../shared/constants/zIndex.js";

// 删除 API 配置的二次确认对话框（叠在 AI 设置对话框之上）。
export default function DeleteApiConfirmDialog({ open, onCancel, onConfirm }) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      sx={{
        zIndex: Z_INDEX.modalPopup,
        pointerEvents: "auto",
        "& .MuiDialog-container": {
          pointerEvents: "auto",
        },
      }}
      slotProps={{
        paper: {
          sx: {
            borderRadius: 2,
          },
        },
      }}
    >
      <DialogTitle>{t("aiSettings.deleteConfirmTitle")}</DialogTitle>
      <DialogContent>
        <Typography>{t("aiSettings.deleteConfirm")}</Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={onCancel} color="inherit">
          {t("common.cancel")}
        </Button>
        <Button onClick={onConfirm} variant="contained" color="error">
          {t("common.delete")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
