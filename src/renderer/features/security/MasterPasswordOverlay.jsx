import * as React from "react";
import Backdrop from "@mui/material/Backdrop";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Alert from "@mui/material/Alert";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { Z_INDEX } from "../../shared/constants/zIndex.js";

const AUTO_UNLOCK_DELAY_MS = 300;

const MasterPasswordOverlay = React.memo(
  ({
    open,
    loading = false,
    isSubmitting = false,
    error = "",
    onUnlock,
    onClose,
  }) => {
    const { t } = useTranslation();
    const [password, setPassword] = React.useState("");
    const inputRef = React.useRef(null);
    const lastAutoSubmittedPasswordRef = React.useRef("");

    React.useEffect(() => {
      if (!open) {
        setPassword("");
        lastAutoSubmittedPasswordRef.current = "";
        return;
      }

      const timer = window.setTimeout(() => {
        inputRef.current?.focus();
      }, 60);

      return () => window.clearTimeout(timer);
    }, [open]);

    const handleSubmit = React.useCallback(() => {
      if (!password || isSubmitting || typeof onUnlock !== "function") {
        return;
      }

      onUnlock(password);
    }, [isSubmitting, onUnlock, password]);

    React.useEffect(() => {
      if (
        !open ||
        loading ||
        isSubmitting ||
        !password ||
        password === lastAutoSubmittedPasswordRef.current ||
        typeof onUnlock !== "function"
      ) {
        return undefined;
      }

      const timer = window.setTimeout(() => {
        lastAutoSubmittedPasswordRef.current = password;
        onUnlock(password);
      }, AUTO_UNLOCK_DELAY_MS);

      return () => window.clearTimeout(timer);
    }, [isSubmitting, loading, onUnlock, open, password]);

    const handleClose = React.useCallback(() => {
      if (typeof onClose === "function") {
        onClose();
      }
    }, [onClose]);

    return (
      <Backdrop
        open={open}
        sx={{
          zIndex: Z_INDEX.lockscreen,
          background: (theme) => {
            const start = alpha(
              theme.palette.background.default,
              theme.palette.mode === "dark" ? 0.82 : 0.7,
            );
            const end = alpha(
              theme.palette.primary.main,
              theme.palette.mode === "dark" ? 0.24 : 0.14,
            );
            return `linear-gradient(155deg, ${start}, ${end})`;
          },
          backdropFilter: "blur(12px)",
        }}
      >
        <Paper
          elevation={0}
          sx={{
            width: "min(92vw, 400px)",
            px: 3,
            py: 3,
            borderRadius: "var(--radius-lg, 10px)",
            border: "1px solid var(--color-border)",
            backgroundColor: (theme) =>
              alpha(
                theme.palette.background.paper,
                theme.palette.mode === "dark" ? 0.94 : 0.96,
              ),
            boxShadow: "var(--float-shadow)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <Tooltip title={t("common.close")}>
            <IconButton
              aria-label={t("common.close")}
              size="small"
              onClick={handleClose}
              sx={{
                position: "absolute",
                top: 12,
                right: 12,
                zIndex: Z_INDEX.control,
                color: "text.secondary",
              }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Box sx={{ position: "relative", zIndex: Z_INDEX.raised }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: "var(--radius-md, 6px)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: (theme) =>
                  alpha(
                    theme.palette.primary.main,
                    theme.palette.mode === "dark" ? 0.12 : 0.08,
                  ),
                color: "primary.main",
                border: "1px solid",
                borderColor: "divider",
                mb: 2,
              }}
            >
              <LockOutlinedIcon fontSize="small" />
            </Box>

            <Typography variant="h6" sx={{ mb: 0.75 }}>
              {loading
                ? t("masterPassword.loadingTitle")
                : t("masterPassword.title")}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.25 }}>
              {loading
                ? t("masterPassword.loadingDescription")
                : t("masterPassword.description")}
            </Typography>

            {error ? (
              <Alert severity="error" variant="outlined" sx={{ mb: 2 }}>
                {error}
              </Alert>
            ) : null}

            {loading ? null : (
              <>
                <TextField
                  fullWidth
                  size="small"
                  inputRef={inputRef}
                  label={t("masterPassword.passwordLabel")}
                  type="password"
                  value={password}
                  disabled={isSubmitting}
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      handleSubmit();
                    }
                  }}
                />

                <Button
                  fullWidth
                  variant="contained"
                  sx={{ mt: 2, py: 1 }}
                  disabled={!password || isSubmitting}
                  onClick={handleSubmit}
                >
                  {isSubmitting
                    ? t("masterPassword.unlocking")
                    : t("masterPassword.unlock")}
                </Button>
              </>
            )}
          </Box>
        </Paper>
      </Backdrop>
    );
  },
);

MasterPasswordOverlay.displayName = "MasterPasswordOverlay";

export default MasterPasswordOverlay;
