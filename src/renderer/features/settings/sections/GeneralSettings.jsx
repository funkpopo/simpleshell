import * as React from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import { useTranslation } from "react-i18next";
import {
  sectionCardSx,
  compactFieldSx,
  subSectionLabelSx,
  SettingsToggleRow,
} from "../components/SettingsSection.jsx";

export default function GeneralSettings({ initialValues, ref }) {
  const { t } = useTranslation();

  const languages = [
    { code: "zh-CN", name: t("languages.zh-CN") },
    { code: "en-US", name: t("languages.en-US") },
  ];
  const fontSizes = [
    { value: 12, label: t("settings.fontSizeLabels.small") },
    { value: 14, label: t("settings.fontSizeLabels.medium") },
    { value: 16, label: t("settings.fontSizeLabels.large") },
    { value: 18, label: t("settings.fontSizeLabels.xlarge") },
  ];
  const [language, setLanguage] = React.useState(initialValues.language);
  const [fontSize, setFontSize] = React.useState(initialValues.fontSize);
  const [darkMode, setDarkMode] = React.useState(initialValues.darkMode);
  const [externalEditorEnabled, setExternalEditorEnabled] = React.useState(
    initialValues.externalEditorEnabled,
  );
  const [externalEditorCommand, setExternalEditorCommand] = React.useState(
    initialValues.externalEditorCommand,
  );
  const [diskAlertEnabled, setDiskAlertEnabled] = React.useState(
    initialValues.diskAlertEnabled,
  );
  const [diskAlertThreshold, setDiskAlertThreshold] = React.useState(
    initialValues.diskAlertThreshold,
  );
  const [diskAlertIntervalSeconds, setDiskAlertIntervalSeconds] =
    React.useState(initialValues.diskAlertIntervalSeconds);
  const [resourceMonitorDisplayMode, setResourceMonitorDisplayMode] =
    React.useState(initialValues.resourceMonitorDisplayMode);
  const [dndEnabled, setDndEnabled] = React.useState(initialValues.dndEnabled);
  const [dndAutoScroll, setDndAutoScroll] = React.useState(
    initialValues.dndAutoScroll,
  );
  const [dndCompactPreview, setDndCompactPreview] = React.useState(
    initialValues.dndCompactPreview,
  );
  const [trayEnabled, setTrayEnabled] = React.useState(
    initialValues.trayEnabled,
  );
  const [closeToTray, setCloseToTray] = React.useState(
    initialValues.closeToTray,
  );
  const [transferBarMode, setTransferBarMode] = React.useState(
    initialValues.transferBarMode,
  );
  const [transferIntegrity, setTransferIntegrity] = React.useState(
    initialValues.transferIntegrity,
  );
  const [sftpFollowTerminalDirectory, setSftpFollowTerminalDirectory] =
    React.useState(initialValues.sftpFollowTerminalDirectory);
  const handleLanguageChange = (event) => {
    setLanguage(event.target.value);
  };
  const handleFontSizeChange = (event, newValue) => {
    setFontSize(newValue);
  };
  const handleDarkModeChange = (event) => {
    setDarkMode(event.target.value === "dark");
  };
  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({
      language,
      fontSize,
      darkMode,
      dnd: {
        enabled: dndEnabled,
        autoScroll: dndAutoScroll,
        compactDragPreview: dndCompactPreview,
      },
      desktopIntegration: {
        trayEnabled,
        closeToTray: trayEnabled && closeToTray,
      },
      transferBarMode,
      transferIntegrity,
      sftpFollowTerminalDirectory,
      externalEditor: {
        enabled: externalEditorEnabled,
        command: externalEditorCommand.trim(),
      },
      diskAlert: {
        enabled: diskAlertEnabled,
        thresholdPercent: Math.min(
          99,
          Math.max(50, Math.floor(Number(diskAlertThreshold) || 90)),
        ),
        intervalSeconds: Math.min(
          3600,
          Math.max(30, Math.floor(Number(diskAlertIntervalSeconds) || 60)),
        ),
      },
      resourceMonitor: {
        displayMode:
          resourceMonitorDisplayMode === "trend" ? "trend" : "independent",
      },
    }),
  }));
  return (
    <Grid container spacing={2}>
      {/* Left: Appearance + file management */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.appearance")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.language")}
            </Typography>
            <FormControl fullWidth variant="outlined" size="small">
              <Select value={language} onChange={handleLanguageChange}>
                {languages.map((lang) => (
                  <MenuItem key={lang.code} value={lang.code}>
                    {lang.name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.theme")}
            </Typography>
            <FormControl fullWidth variant="outlined" size="small">
              <Select
                value={darkMode ? "dark" : "light"}
                onChange={handleDarkModeChange}
              >
                <MenuItem value="light">{t("settings.themeLight")}</MenuItem>
                <MenuItem value="dark">{t("settings.themeDark")}</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box sx={compactFieldSx}>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.fontSize")}
            </Typography>
            <Box sx={{ px: 1 }}>
              <Slider
                value={fontSize}
                onChange={handleFontSizeChange}
                step={null}
                marks={fontSizes.map((size) => ({
                  value: size.value,
                  label: size.label,
                }))}
                min={12}
                max={18}
                size="small"
              />
            </Box>
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.fileManagement")}
        </Typography>
        <Box
          sx={{
            ...sectionCardSx,
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.transferDisplay")}
            </Typography>
            <FormControl fullWidth variant="outlined" size="small">
              <Select
                value={transferBarMode}
                onChange={(e) => setTransferBarMode(e.target.value)}
              >
                <MenuItem value="bottom">
                  {t("settings.transferDisplayBottom")}
                </MenuItem>
                <MenuItem value="sidebar">
                  {t("settings.transferDisplaySidebar")}
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
          <SettingsToggleRow
            id="settings-transfer-integrity"
            label={t("settings.transferIntegrity")}
            description={t("settings.transferIntegrityHelp")}
            checked={transferIntegrity}
            onChange={(event) => setTransferIntegrity(event.target.checked)}
          />
          <SettingsToggleRow
            id="settings-follow-terminal"
            label={t("settings.sftpFollowTerminalDirectory")}
            description={t("settings.sftpFollowTerminalDirectoryHelp")}
            checked={sftpFollowTerminalDirectory}
            onChange={(event) =>
              setSftpFollowTerminalDirectory(event.target.checked)
            }
          />
        </Box>
      </Grid>

      {/* Right: DnD + Desktop + Editor */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.dnd.title")}
        </Typography>
        <Box sx={{ ...sectionCardSx, mb: 1.5 }}>
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={dndEnabled}
                  onChange={(e) => setDndEnabled(e.target.checked)}
                  size="small"
                />
              }
              label={
                <Typography variant="body2">
                  {t("settings.dnd.enable")}
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={dndAutoScroll}
                  onChange={(e) => setDndAutoScroll(e.target.checked)}
                  disabled={!dndEnabled}
                  size="small"
                />
              }
              label={
                <Typography variant="body2">
                  {t("settings.dnd.autoScroll")}
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={dndCompactPreview}
                  onChange={(e) => setDndCompactPreview(e.target.checked)}
                  disabled={!dndEnabled}
                  size="small"
                />
              }
              label={
                <Typography variant="body2">
                  {t("settings.dnd.compactPreview")}
                </Typography>
              }
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.desktopIntegration.title")}
        </Typography>
        <Box sx={{ ...sectionCardSx, mb: 1.5 }}>
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            <FormControlLabel
              control={
                <Switch
                  checked={trayEnabled}
                  onChange={(e) => {
                    setTrayEnabled(e.target.checked);
                    if (!e.target.checked) {
                      setCloseToTray(false);
                    }
                  }}
                  size="small"
                />
              }
              label={
                <Typography variant="body2">
                  {t("settings.desktopIntegration.trayEnabled")}
                </Typography>
              }
            />
            <FormControlLabel
              control={
                <Switch
                  checked={closeToTray}
                  onChange={(e) => setCloseToTray(e.target.checked)}
                  disabled={!trayEnabled}
                  size="small"
                />
              }
              label={
                <Typography variant="body2">
                  {t("settings.desktopIntegration.closeToTray")}
                </Typography>
              }
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.externalEditor.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <FormControlLabel
            control={
              <Switch
                checked={externalEditorEnabled}
                onChange={(e) => setExternalEditorEnabled(e.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                {t("settings.externalEditor.enable")}
              </Typography>
            }
            sx={{ mb: 0.75 }}
          />
          <TextField
            fullWidth
            size="small"
            placeholder={t("settings.externalEditor.commandPlaceholder")}
            value={externalEditorCommand}
            onChange={(e) => setExternalEditorCommand(e.target.value)}
            disabled={!externalEditorEnabled}
          />
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.diskAlert.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <FormControlLabel
            control={
              <Switch
                checked={diskAlertEnabled}
                onChange={(e) => setDiskAlertEnabled(e.target.checked)}
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                {t("settings.diskAlert.enable")}
              </Typography>
            }
            sx={{ mb: 1 }}
          />
          <Box
            sx={{
              display: "flex",
              gap: 1.5,
              flexWrap: "wrap",
              opacity: diskAlertEnabled ? 1 : 0.5,
              pointerEvents: diskAlertEnabled ? "auto" : "none",
            }}
          >
            <TextField
              size="small"
              type="number"
              label={t("settings.diskAlert.threshold")}
              value={diskAlertThreshold}
              onChange={(e) => setDiskAlertThreshold(e.target.value)}
              inputProps={{ min: 50, max: 99 }}
              sx={{ flex: "1 1 140px", minWidth: 140 }}
            />
            <TextField
              size="small"
              select
              label={t("settings.diskAlert.interval")}
              value={diskAlertIntervalSeconds}
              onChange={(e) =>
                setDiskAlertIntervalSeconds(Number(e.target.value))
              }
              sx={{ flex: "1 1 140px", minWidth: 140 }}
            >
              {[30, 60, 120, 300, 600].map((seconds) => (
                <MenuItem key={seconds} value={seconds}>
                  {t("settings.diskAlert.intervalSeconds", {
                    seconds,
                  })}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.resourceMonitor.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <FormControl fullWidth variant="outlined" size="small">
            <Select
              value={resourceMonitorDisplayMode}
              onChange={(e) => setResourceMonitorDisplayMode(e.target.value)}
            >
              <MenuItem value="independent">
                {t("settings.resourceMonitor.modeIndependent")}
              </MenuItem>
              <MenuItem value="trend">
                {t("settings.resourceMonitor.modeTrend")}
              </MenuItem>
            </Select>
          </FormControl>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ mt: 0.75, display: "block" }}
          >
            {t("settings.resourceMonitor.modeHint")}
          </Typography>
        </Box>
      </Grid>
    </Grid>
  );
}
