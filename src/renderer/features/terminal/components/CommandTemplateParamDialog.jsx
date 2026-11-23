import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import Dialog from "../../../shared/ui/AccessibleDialog.jsx";
import { resolveCommandTemplate } from "../model/commandTemplates.js";

/**
 * Modal prompt for filling parameterized shortcut/snippet template variables
 * (`{{var}}` / `{{var=default}}`) with live command preview and Run/Insert mode.
 */
export default function CommandTemplateParamDialog({
  open,
  command,
  promptVariables = [],
  initialValues = {},
  templateContext = {},
  defaultMode = "run",
  onClose,
  onConfirm,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const firstInputRef = useRef(null);
  const [values, setValues] = useState(() => ({ ...(initialValues || {}) }));
  const [mode, setMode] = useState(() =>
    defaultMode === "insert" ? "insert" : "run",
  );
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setValues({ ...(initialValues || {}) });
    setMode(defaultMode === "insert" ? "insert" : "run");
    setAttempted(false);
  }, [open, command, initialValues, defaultMode]);

  const handleValueChange = useCallback((name, value) => {
    setValues((prev) => ({
      ...prev,
      [name]: value,
    }));
  }, []);

  const handleModeChange = useCallback((_event, nextMode) => {
    if (!nextMode) return;
    setMode(nextMode);
  }, []);

  const resolvedResult = useMemo(() => {
    if (!open) return null;
    return resolveCommandTemplate(
      command?.command || "",
      values,
      templateContext,
    );
  }, [open, command?.command, values, templateContext]);

  const handleSubmit = useCallback(
    (event) => {
      event?.preventDefault?.();
      if (!resolvedResult) return;
      if (!resolvedResult.valid) {
        setAttempted(true);
        return;
      }
      onConfirm?.(resolvedResult.resolved, { execute: mode !== "insert" });
    },
    [mode, onConfirm, resolvedResult],
  );

  const missingSet = new Set(resolvedResult?.missingVariables || []);
  const isInsertMode = mode === "insert";

  return (
    <Dialog
      open={Boolean(open)}
      onClose={onClose}
      initialFocusRef={firstInputRef}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        {command?.name
          ? `${t("shortcutCommands.templateDialogTitle")}: ${command.name}`
          : t("shortcutCommands.templateDialogTitle")}
      </DialogTitle>
      <Box component="form" onSubmit={handleSubmit}>
        <DialogContent sx={{ pt: 1 }}>
          {promptVariables.map((variable, index) => {
            const value = values?.[variable.name] ?? "";
            const isError = attempted && missingSet.has(variable.name);
            const helperText = isError
              ? t("shortcutCommands.templateRequired")
              : variable.hasDefault
                ? t("shortcutCommands.templateDefaultHint", {
                    value: variable.defaultValue,
                  })
                : variable.isBuiltin
                  ? t("shortcutCommands.templateBuiltinTag")
                  : t("shortcutCommands.templateRequired");
            return (
              <TextField
                key={variable.name}
                slotProps={
                  index === 0
                    ? { htmlInput: { ref: firstInputRef } }
                    : undefined
                }
                autoFocus={index === 0}
                margin="dense"
                size="small"
                fullWidth
                required={!variable.hasDefault}
                error={isError}
                label={variable.name}
                value={value}
                helperText={helperText}
                onChange={(e) =>
                  handleValueChange(variable.name, e.target.value)
                }
                sx={{ mb: 1.5 }}
              />
            );
          })}

          <Box sx={{ mt: 1, mb: 1.5 }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mb: 0.5 }}
            >
              {t("shortcutCommands.templatePreviewLabel")}
            </Typography>
            <Box
              sx={{
                px: 1.25,
                py: 1,
                borderRadius: 1,
                border: `1px solid ${theme.palette.divider}`,
                bgcolor: "action.hover",
                fontFamily: "monospace",
                fontSize: "0.82rem",
                wordBreak: "break-all",
                whiteSpace: "pre-wrap",
              }}
            >
              {resolvedResult?.resolved || ""}
            </Box>
            {attempted && !resolvedResult?.valid && (
              <Typography
                variant="caption"
                color="error"
                sx={{ display: "block", mt: 0.5 }}
              >
                {t("shortcutCommands.templateMissingRequired", {
                  names: (resolvedResult?.missingVariables || []).join(", "),
                })}
              </Typography>
            )}
          </Box>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
              flexWrap: "wrap",
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {t("shortcutCommands.templateModeLabel")}
            </Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={mode}
              onChange={handleModeChange}
            >
              <ToggleButton value="run">
                {t("shortcutCommands.templateModeRun")}
              </ToggleButton>
              <ToggleButton value="insert">
                {t("shortcutCommands.templateModeInsert")}
              </ToggleButton>
            </ToggleButtonGroup>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            type="submit"
            variant="contained"
            color="primary"
            disabled={!resolvedResult?.valid}
          >
            {isInsertMode
              ? t("shortcutCommands.templateConfirmInsert")
              : t("shortcutCommands.templateConfirmRun")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
