import * as React from "react";
import {
  MAX_TERMINAL_SCROLLBACK_LINES,
  MIN_TERMINAL_SCROLLBACK_LINES,
  normalizeTerminalScrollbackLines,
} from "../../terminal/model/terminalScrollback.js";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Grid from "@mui/material/Grid";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import BugReportIcon from "@mui/icons-material/BugReport";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  openLogDirectory,
  exportDiagnostics,
} from "../../diagnostics/diagnosticsActions.js";
import {
  sectionCardSx,
  compactFieldSx,
  sliderLabelSx,
  subSectionLabelSx,
} from "../components/SettingsSection.jsx";

export default function TerminalSettings({ initialValues, ref }) {
  const { t } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const fontSizes = [
    { value: 12, label: t("settings.fontSizeLabels.small") },
    { value: 14, label: t("settings.fontSizeLabels.medium") },
    { value: 16, label: t("settings.fontSizeLabels.large") },
    { value: 18, label: t("settings.fontSizeLabels.xlarge") },
  ];
  const terminalFonts = [
    {
      value: "Fira Code",
      label: t("settings.fonts.fira-code"),
      description: t("settings.terminalFonts.firaCodeDescription"),
    },
    {
      value: "Space Mono",
      label: t("settings.fonts.space-mono"),
      description: t("settings.terminalFonts.spaceMonoDescription"),
    },
    {
      value: "Consolas",
      label: t("settings.fonts.consolas"),
      description: t("settings.terminalFonts.consolasDescription"),
    },
  ];
  const logLevels = [
    { value: "DEBUG", label: t("settings.logLevels.debug") },
    { value: "INFO", label: t("settings.logLevels.info") },
    { value: "WARN", label: t("settings.logLevels.warn") },
    { value: "ERROR", label: t("settings.logLevels.error") },
  ];
  const [editorFont] = React.useState(initialValues.editorFont);
  const [terminalFont, setTerminalFont] = React.useState(
    initialValues.terminalFont,
  );
  const [terminalFontSize, setTerminalFontSize] = React.useState(
    initialValues.terminalFontSize,
  );
  const [terminalFontWeight, setTerminalFontWeight] = React.useState(
    initialValues.terminalFontWeight,
  );
  const [terminalLineHeight, setTerminalLineHeight] = React.useState(
    initialValues.terminalLineHeight,
  );
  const [terminalScrollbackLines, setTerminalScrollbackLines] = React.useState(
    initialValues.terminalScrollbackLines,
  );
  const [logLevel, setLogLevel] = React.useState(initialValues.logLevel);
  const [maxFileSize, setMaxFileSize] = React.useState(
    initialValues.maxFileSize,
  );
  const [cleanupIntervalDays, setCleanupIntervalDays] = React.useState(
    initialValues.cleanupIntervalDays,
  );
  const [backupRetentionDays, setBackupRetentionDays] = React.useState(
    initialValues.backupRetentionDays,
  );
  const handleTerminalFontChange = (event) => {
    setTerminalFont(event.target.value);
  };
  const handleTerminalFontSizeChange = (event, newValue) => {
    setTerminalFontSize(newValue);
  };
  const handleTerminalFontWeightChange = (event, newValue) => {
    setTerminalFontWeight(newValue);
  };
  const handleLogLevelChange = (event) => {
    setLogLevel(event.target.value);
  };
  const handleMaxFileSizeChange = (event) => {
    const value = event.target.value;
    // 确保输入的是数字，且大于0
    if (!isNaN(value) && Number(value) > 0) {
      setMaxFileSize(Number(value));
    }
  };
  const handleOpenLogDirectory = () =>
    openLogDirectory({ t, showSuccess, showError });
  const handleExportDiagnostics = () =>
    exportDiagnostics({ t, showSuccess, showError });
  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({
      editorFont,
      terminalFont,
      terminalFontSize,
      terminalFontWeight,
      terminalLineHeight: Math.min(
        1.4,
        Math.max(
          1.0,
          Math.round((Number(terminalLineHeight) || 1.0) * 100) / 100,
        ),
      ),
      terminalScrollbackLines: normalizeTerminalScrollbackLines(
        terminalScrollbackLines,
      ),
      backupRetentionDays,
    }),
    saveLogs: async () => {
      if (window.terminalAPI?.saveLogSettings) {
        const logSettings = {
          level: logLevel,
          // 将MB转换为字节
          maxFileSize: maxFileSize * 1024 * 1024,
          // 保留其他设置默认值
          maxFiles: 5,
          compressOldLogs: true,
          cleanupIntervalDays: cleanupIntervalDays,
        };
        await window.terminalAPI.saveLogSettings(logSettings);
      }
    },
  }));
  return (
    <Grid container spacing={2}>
      {/* Left: Terminal */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.terminalFontSectionTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <InputLabel>{t("settings.terminalFontFamily")}</InputLabel>
              <Select
                value={terminalFont}
                onChange={handleTerminalFontChange}
                label={t("settings.terminalFontFamily")}
              >
                {terminalFonts.map((font) => (
                  <MenuItem key={font.value} value={font.value}>
                    <Typography style={{ fontFamily: font.value }}>
                      {font.label}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
              }}
            >
              <Typography variant="body2" sx={sliderLabelSx}>
                {t("settings.terminalFontSizeLabel")}
              </Typography>
              <Slider
                value={terminalFontSize}
                onChange={handleTerminalFontSizeChange}
                step={null}
                marks={fontSizes.map((size) => ({
                  value: size.value,
                  label: size.label,
                }))}
                min={12}
                max={18}
                size="small"
                sx={{ flex: 1 }}
              />
            </Box>
          </Box>

          <Box sx={compactFieldSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
              }}
            >
              <Typography variant="body2" sx={sliderLabelSx}>
                {t("settings.fontWeight")}
              </Typography>
              <Slider
                value={terminalFontWeight}
                onChange={handleTerminalFontWeightChange}
                min={300}
                max={1000}
                size="small"
                sx={{ flex: 1 }}
              />
              <TextField
                value={terminalFontWeight}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val)) setTerminalFontWeight(val);
                }}
                size="small"
                type="number"
                inputProps={{
                  min: 300,
                  max: 1000,
                  style: { textAlign: "center" },
                }}
                sx={{ width: 64 }}
              />
            </Box>
          </Box>

          <Box sx={compactFieldSx}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
              }}
            >
              <Typography variant="body2" sx={sliderLabelSx}>
                {t("settings.terminalLineHeight")}
              </Typography>
              <Slider
                value={terminalLineHeight}
                onChange={(_event, value) => {
                  const next = Array.isArray(value) ? value[0] : value;
                  setTerminalLineHeight(Math.round(Number(next) * 100) / 100);
                }}
                min={1.0}
                max={1.4}
                step={0.05}
                marks={[
                  { value: 1.0, label: "1.0" },
                  { value: 1.2, label: "1.2" },
                  { value: 1.4, label: "1.4" },
                ]}
                size="small"
                sx={{ flex: 1 }}
                valueLabelDisplay="auto"
              />
            </Box>
          </Box>

          <Box>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t("settings.terminalScrollbackLines")}
              value={terminalScrollbackLines}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (Number.isFinite(v)) {
                  setTerminalScrollbackLines(v);
                }
              }}
              inputProps={{
                min: MIN_TERMINAL_SCROLLBACK_LINES,
                max: MAX_TERMINAL_SCROLLBACK_LINES,
                step: 1000,
              }}
            />
          </Box>
        </Box>
      </Grid>

      {/* Right: Logs */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.logSettingsTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <FormControl fullWidth variant="outlined" size="small">
              <Select value={logLevel} onChange={handleLogLevelChange}>
                {logLevels.map((level) => (
                  <MenuItem key={level.value} value={level.value}>
                    {level.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t("settings.logFileSizeLimitLabel")}
              value={maxFileSize}
              onChange={handleMaxFileSizeChange}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">MB</InputAdornment>
                ),
              }}
              inputProps={{ min: 1 }}
            />
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t("settings.logCleanupIntervalLabel")}
              value={cleanupIntervalDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) {
                  setCleanupIntervalDays(v);
                }
              }}
              inputProps={{ min: 1 }}
            />
          </Box>

          <Box sx={compactFieldSx}>
            <TextField
              fullWidth
              size="small"
              type="number"
              label={t("settings.backupRetentionLabel")}
              value={backupRetentionDays}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) {
                  setBackupRetentionDays(v);
                }
              }}
              inputProps={{ min: 1, max: 365 }}
            />
          </Box>

          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<FolderOpenIcon />}
              onClick={handleOpenLogDirectory}
            >
              {t("settings.openLogDirectory")}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<BugReportIcon />}
              onClick={handleExportDiagnostics}
            >
              {t("settings.exportDiagnostics")}
            </Button>
          </Box>
        </Box>
      </Grid>
    </Grid>
  );
}
