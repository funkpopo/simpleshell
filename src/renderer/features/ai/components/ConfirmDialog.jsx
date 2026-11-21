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
            borderRadius: "var(--radius-md, 6px)",
          },
        },
      }}
    >
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button
          onClick={onCancel}
          color="inherit"
          variant="outlined"
          size="small"
        >
          {t("common.cancel")}
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          color="error"
          size="small"
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
