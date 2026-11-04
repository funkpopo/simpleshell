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

// 叠在 AI 设置对话框之上的二次确认对话框（删除配置、放弃未保存的规则等）。
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}) {
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
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{message}</Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={onCancel} color="inherit">
          {t("common.cancel")}
        </Button>
        <Button onClick={onConfirm} variant="contained" color="error">
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
