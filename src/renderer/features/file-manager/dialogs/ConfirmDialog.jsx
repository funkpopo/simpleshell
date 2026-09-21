import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import {
  Box,
  Typography,
  Tooltip,
  Button,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { alpha } from "@mui/material/styles";
import DeleteIcon from "@mui/icons-material/Delete";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useTranslation } from "react-i18next";
const CONFIRM_DIALOG_COLORS = new Set([
  "primary",
  "secondary",
  "success",
  "error",
  "info",
  "warning",
]);
export default function ConfirmDialog({
  confirmDialog,
  confirmDialogConfirmButtonRef,
  confirmDialogCancelButtonRef,
  handleConfirmDialogCancel,
  handleConfirmDialogConfirm,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const confirmDialogColor = CONFIRM_DIALOG_COLORS.has(
    confirmDialog.confirmColor,
  )
    ? confirmDialog.confirmColor
    : "primary";
  const confirmDialogPalette =
    theme.palette[confirmDialogColor] || theme.palette.primary;
  const ConfirmDialogIcon =
    confirmDialogColor === "error"
      ? DeleteIcon
      : confirmDialogColor === "warning"
        ? WarningAmberIcon
        : InfoOutlinedIcon;
  const confirmDialogDefaultRef =
    confirmDialog.defaultAction === "confirm"
      ? confirmDialogConfirmButtonRef
      : confirmDialogCancelButtonRef;
  const confirmDialogDetailItems = Array.isArray(confirmDialog.detailItems)
    ? confirmDialog.detailItems
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
  const confirmDialogDetailText =
    typeof confirmDialog.detail === "string" ? confirmDialog.detail.trim() : "";
  return (
    <Dialog
      open={confirmDialog.open}
      onClose={handleConfirmDialogCancel}
      maxWidth="xs"
      fullWidth
      initialFocusRef={confirmDialogDefaultRef}
      defaultActionRef={confirmDialogDefaultRef}
      slotProps={{
        paper: {
          sx: {
            width: "min(404px, calc(100vw - 32px))",
            maxWidth: "calc(100vw - 32px)",
            maxHeight: "min(390px, calc(100vh - 32px))",
            display: "flex",
            flexDirection: "column",
            borderRadius: 1.5,
            border: `1px solid ${alpha(confirmDialogPalette.main, 0.22)}`,
            bgcolor: "background.paper",
            boxShadow:
              theme.palette.mode === "dark"
                ? "0 14px 42px rgba(0, 0, 0, 0.54)"
                : "0 14px 42px rgba(15, 23, 42, 0.16)",
            overflow: "hidden",
          },
        },
        backdrop: {
          sx: {
            bgcolor: alpha(
              theme.palette.common.black,
              theme.palette.mode === "dark" ? 0.58 : 0.32,
            ),
            backdropFilter: "blur(2px)",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          px: 2,
          pt: 1.5,
          pb: 1,
          flexShrink: 0,
        }}
      >
        <Box
          sx={{
            width: 28,
            height: 28,
            flex: "0 0 auto",
            borderRadius: 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: confirmDialogPalette.main,
            bgcolor: alpha(confirmDialogPalette.main, 0.12),
            border: `1px solid ${alpha(confirmDialogPalette.main, 0.2)}`,
          }}
        >
          <ConfirmDialogIcon fontSize="small" />
        </Box>
        <Typography
          component="span"
          variant="subtitle1"
          sx={{
            minWidth: 0,
            pt: 0.125,
            color: "text.primary",
            fontWeight: 600,
            lineHeight: 1.25,
          }}
        >
          {confirmDialog.title}
        </Typography>
      </DialogTitle>
      <DialogContent
        sx={{
          px: 2,
          pt: 0,
          pb: 1,
          overflowX: "hidden",
          overflowY: "auto",
          flex: "0 1 auto",
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            whiteSpace: "pre-wrap",
            lineHeight: 1.5,
          }}
        >
          {confirmDialog.message}
        </Typography>
        {confirmDialogDetailItems.length > 0 ? (
          <Box
            sx={{
              mt: 1,
              maxHeight: 124,
              overflowY: "auto",
              borderRadius: 1,
              border: `1px solid ${theme.palette.divider}`,
              bgcolor:
                theme.palette.mode === "dark"
                  ? alpha(theme.palette.common.white, 0.035)
                  : alpha(theme.palette.common.black, 0.022),
            }}
          >
            {confirmDialogDetailItems.map((item, index) => (
              <Tooltip
                key={`${item}-${index}`}
                title={item}
                placement="top"
                disableInteractive
                enterDelay={500}
              >
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "auto minmax(0, 1fr)",
                    alignItems: "center",
                    columnGap: 0.75,
                    minHeight: 24,
                    px: 1,
                    py: 0.25,
                    borderTop:
                      index === 0
                        ? "none"
                        : `1px solid ${theme.palette.divider}`,
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      width: 4,
                      height: 4,
                      borderRadius: "50%",
                      bgcolor: alpha(confirmDialogPalette.main, 0.68),
                    }}
                  />
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{
                      minWidth: 0,
                      lineHeight: 1.35,
                    }}
                  >
                    {item}
                  </Typography>
                </Box>
              </Tooltip>
            ))}
            {confirmDialog.detailFooter ? (
              <Box
                sx={{
                  px: 1,
                  py: 0.5,
                  borderTop: `1px solid ${theme.palette.divider}`,
                  bgcolor: alpha(confirmDialogPalette.main, 0.06),
                }}
              >
                <Typography
                  component="span"
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    lineHeight: 1.35,
                  }}
                >
                  {confirmDialog.detailFooter}
                </Typography>
              </Box>
            ) : null}
          </Box>
        ) : confirmDialogDetailText ? (
          <Box
            sx={{
              mt: 1,
              maxHeight: 124,
              overflow: "auto",
              borderRadius: 1,
              border: `1px solid ${theme.palette.divider}`,
              bgcolor:
                theme.palette.mode === "dark"
                  ? alpha(theme.palette.common.white, 0.035)
                  : alpha(theme.palette.common.black, 0.022),
              px: 1,
              py: 0.75,
            }}
          >
            <Typography
              component="pre"
              variant="caption"
              color="text.secondary"
              sx={{
                m: 0,
                fontFamily: "inherit",
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {confirmDialogDetailText}
            </Typography>
          </Box>
        ) : null}
      </DialogContent>
      <DialogActions
        sx={{
          px: 2,
          py: 1.25,
          gap: 0.75,
          flexShrink: 0,
          borderTop: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Button
          ref={confirmDialogCancelButtonRef}
          onClick={handleConfirmDialogCancel}
          color="inherit"
          variant="outlined"
          size="small"
          sx={{
            minWidth: 72,
          }}
        >
          {confirmDialog.cancelText || t("common.cancel")}
        </Button>
        <Button
          ref={confirmDialogConfirmButtonRef}
          onClick={handleConfirmDialogConfirm}
          variant="contained"
          color={confirmDialogColor}
          size="small"
          sx={{
            minWidth: 90,
          }}
        >
          {confirmDialog.confirmText || t("common.confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
