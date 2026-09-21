import React from "react";
import PropTypes from "prop-types";
import Dialog from "./AccessibleDialog.jsx";
import {
  Alert,
  Box,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { useTranslation } from "react-i18next";

// 通用"输入名称"对话框：重命名 / 新建文件夹 / 新建文件共用同一结构
const NameInputDialog = ({
  open,
  onClose,
  onSubmit,
  title,
  label,
  value,
  onValueChange,
  errorText = "",
  submitting = false,
  maxWidth = "xs",
}) => {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth>
      <Box component="form" onSubmit={onSubmit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {errorText ? <Alert severity="error">{errorText}</Alert> : null}
            <TextField
              fullWidth
              label={label}
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              autoFocus
              variant="outlined"
              size="small"
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={onClose}
            color="inherit"
            size="small"
            disabled={submitting}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            size="small"
            disabled={submitting}
          >
            {t("common.save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
};

NameInputDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  title: PropTypes.node.isRequired,
  label: PropTypes.node.isRequired,
  value: PropTypes.string.isRequired,
  onValueChange: PropTypes.func.isRequired,
  errorText: PropTypes.string,
  submitting: PropTypes.bool,
  maxWidth: PropTypes.string,
};

export default NameInputDialog;
