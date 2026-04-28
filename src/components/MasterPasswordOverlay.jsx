import * as React from "react";
import Backdrop from "@mui/material/Backdrop";
import Paper from "@mui/material/Paper";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Alert from "@mui/material/Alert";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import CloseIcon from "@mui/icons-material/Close";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

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

    React.useEffect(() => {
      if (!open) {
        setPassword("");
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

    const handleClose = React.useCallback(() => {
      if (typeof onClose === "function") {
        onClose();
      }
    }, [onClose]);

    return (
      <Backdrop
        open={open}
        sx={{
          zIndex: (theme) => theme.zIndex.modal + 20,
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
          elevation={12}
          sx={{
            width: "min(92vw, 420px)",
            px: 3,
            py: 3.5,
            borderRadius: 3,
            border: "1px solid",
            borderColor: (theme) => alpha(theme.palette.primary.main, 0.18),
            backgroundColor: (theme) =>
              alpha(
                theme.palette.background.paper,
                theme.palette.mode === "dark" ? 0.94 : 0.96,
              ),
            boxShadow: (theme) =>
              theme.palette.mode === "dark"
                ? `0 24px 60px ${alpha("#000000", 0.45)}`
                : `0 20px 44px ${alpha(theme.palette.primary.dark, 0.16)}`,
            position: "relative",
            overflow: "hidden",
            "&::before": {
              content: '""',
              position: "absolute",
              inset: 0,
              background: (theme) =>
                `linear-gradient(180deg, ${alpha(
                  theme.palette.primary.main,
                  theme.palette.mode === "dark" ? 0.16 : 0.08,
                )}, transparent 42%)`,
              pointerEvents: "none",
            },
          }}
        >
          <IconButton
            aria-label={t("common.close", "关闭")}
            size="small"
            onClick={handleClose}
            sx={{
              position: "absolute",
              top: 10,
              right: 10,
              zIndex: 2,
              color: "text.secondary",
              bgcolor: (theme) => alpha(theme.palette.background.paper, 0.45),
              "&:hover": {
                color: "text.primary",
                bgcolor: (theme) => alpha(theme.palette.action.hover, 0.75),
              },
            }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>

          <Box
            sx={{
              width: 52,
              height: 52,
              borderRadius: "50%",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: (theme) =>
                alpha(
                  theme.palette.primary.main,
                  theme.palette.mode === "dark" ? 0.2 : 0.12,
                ),
              color: "primary.main",
              border: "1px solid",
              borderColor: (theme) => alpha(theme.palette.primary.main, 0.22),
              mb: 2,
              position: "relative",
              zIndex: 1,
            }}
          >
            <LockOutlinedIcon />
          </Box>

          <Typography
            variant="h6"
            sx={{ mb: 1, position: "relative", zIndex: 1 }}
          >
            {loading
              ? t("masterPassword.loadingTitle")
              : t("masterPassword.title")}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mb: 2.5, position: "relative", zIndex: 1 }}
          >
            {loading
              ? t("masterPassword.loadingDescription")
              : t("masterPassword.description")}
          </Typography>

          {error ? (
            <Alert
              severity="error"
              sx={{ mb: 2, position: "relative", zIndex: 1 }}
            >
              {error}
            </Alert>
          ) : null}

          {loading ? null : (
            <>
              <TextField
                fullWidth
                inputRef={inputRef}
                label={t("masterPassword.passwordLabel")}
                type="password"
                value={password}
                disabled={isSubmitting}
                sx={{ position: "relative", zIndex: 1 }}
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
                sx={{ mt: 2.5, py: 1.1, position: "relative", zIndex: 1 }}
                disabled={!password || isSubmitting}
                onClick={handleSubmit}
              >
                {isSubmitting
                  ? t("masterPassword.unlocking")
                  : t("masterPassword.unlock")}
              </Button>
            </>
          )}
        </Paper>
      </Backdrop>
    );
  },
);

MasterPasswordOverlay.displayName = "MasterPasswordOverlay";

export default MasterPasswordOverlay;
