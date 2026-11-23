import * as React from "react";
import PropTypes from "prop-types";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useTranslation } from "react-i18next";

export default function RenameTabDialog({
  open,
  initialTitle = "",
  onClose,
  onConfirm,
}) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(initialTitle || "");
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    setValue(initialTitle || "");
    const timer = window.setTimeout(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, initialTitle]);

  const handleSubmit = (event) => {
    event?.preventDefault?.();
    onConfirm?.(value);
    onClose?.();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      initialFocusRef={inputRef}
      maxWidth="xs"
      fullWidth
      aria-labelledby="rename-tab-dialog-title"
    >
      <DialogTitle id="rename-tab-dialog-title">
        {t("tabs.renameDialogTitle")}
      </DialogTitle>
      <form onSubmit={handleSubmit}>
        <DialogContent sx={{ pt: 1 }}>
          <TextField
            inputRef={inputRef}
            fullWidth
            size="small"
            autoFocus
            label={t("tabs.renamePlaceholder")}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            helperText={t("tabs.renameResetHint")}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} color="inherit">
            {t("common.cancel")}
          </Button>
          <Button type="submit" variant="contained">
            {t("common.save")}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

RenameTabDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  initialTitle: PropTypes.string,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
};
