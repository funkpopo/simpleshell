import * as React from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Grid from "@mui/material/Grid";
import { useTranslation } from "react-i18next";
import {
  RESOURCE_MAX_PROCESSES_OPTIONS,
  RESOURCE_PROCESS_REFRESH_OPTIONS,
  RESOURCE_SYSTEM_REFRESH_OPTIONS,
  UPDATE_REMINDER_INTERVAL_OPTIONS,
} from "../../../../shared/settings/uiSettingsDefaults.js";
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
  const [updatesAutoCheckOnStartup, setUpdatesAutoCheckOnStartup] =
    React.useState(initialValues.updatesAutoCheckOnStartup);
  const [updatesReminderIntervalHours, setUpdatesReminderIntervalHours] =
    React.useState(initialValues.updatesReminderIntervalHours);
  const [notificationDurationSeconds, setNotificationDurationSeconds] =
    React.useState(initialValues.notificationDurationSeconds);
  const [recentConnectionsLimit, setRecentConnectionsLimit] = React.useState(
    initialValues.recentConnectionsLimit,
  );
  const [
    externalEditorAutoUploadDebounceMs,
    setExternalEditorAutoUploadDebounceMs,
  ] = React.useState(initialValues.externalEditorAutoUploadDebounceMs);
  const [
    resourceMonitorSystemRefreshSeconds,
    setResourceMonitorSystemRefreshSeconds,
  ] = React.useState(initialValues.resourceMonitorSystemRefreshSeconds);
  const [
    resourceMonitorProcessRefreshSeconds,
    setResourceMonitorProcessRefreshSeconds,
  ] = React.useState(initialValues.resourceMonitorProcessRefreshSeconds);
  const [
    resourceMonitorMaxVisibleProcesses,
    setResourceMonitorMaxVisibleProcesses,
  ] = React.useState(initialValues.resourceMonitorMaxVisibleProcesses);
  const [restoreSessionOnStartup, setRestoreSessionOnStartup] = React.useState(
    initialValues.restoreSessionOnStartup !== false,
  );
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
      restoreSessionOnStartup: Boolean(restoreSessionOnStartup),
      updates: {
        autoCheckOnStartup: Boolean(updatesAutoCheckOnStartup),
        reminderIntervalHours: UPDATE_REMINDER_INTERVAL_OPTIONS.includes(
          Number(updatesReminderIntervalHours),
        )
          ? Number(updatesReminderIntervalHours)
          : 4,
      },
      notificationDurationSeconds: Math.min(
        15,
        Math.max(2, Math.round(Number(notificationDurationSeconds) || 5)),
      ),
      recentConnectionsLimit: (() => {
        const parsed = Number.parseInt(recentConnectionsLimit, 10);
        if (!Number.isFinite(parsed)) return 5;
        return Math.min(20, Math.max(0, parsed));
      })(),
      externalEditor: {
        enabled: externalEditorEnabled,
        command: externalEditorCommand.trim(),
        autoUploadDebounceMs: Math.min(
          5000,
          Math.max(
            200,
            Math.round(Number(externalEditorAutoUploadDebounceMs) || 700),
          ),
        ),
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
        systemRefreshSeconds: RESOURCE_SYSTEM_REFRESH_OPTIONS.includes(
          Number(resourceMonitorSystemRefreshSeconds),
        )
          ? Number(resourceMonitorSystemRefreshSeconds)
          : 5,
        processRefreshSeconds: RESOURCE_PROCESS_REFRESH_OPTIONS.includes(
          Number(resourceMonitorProcessRefreshSeconds),
        )
          ? Number(resourceMonitorProcessRefreshSeconds)
          : 15,
        maxVisibleProcesses: RESOURCE_MAX_PROCESSES_OPTIONS.includes(
          Number(resourceMonitorMaxVisibleProcesses),
        )
          ? Number(resourceMonitorMaxVisibleProcesses)
          : 50,
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

        <Typography sx={subSectionLabelSx}>
          {t("settings.updatesAndNotificationsTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <SettingsToggleRow
            id="settings-updates-auto-check"
            noDivider
            label={t("settings.updates.autoCheckOnStartup")}
            checked={updatesAutoCheckOnStartup}
            onChange={(e) => setUpdatesAutoCheckOnStartup(e.target.checked)}
          />
          <Box sx={{ ...compactFieldSx, mt: 1 }}>
            <TextField
              size="small"
              select
              fullWidth
              label={t("settings.updates.reminderInterval")}
              value={updatesReminderIntervalHours}
              onChange={(e) =>
                setUpdatesReminderIntervalHours(Number(e.target.value))
              }
            >
              {UPDATE_REMINDER_INTERVAL_OPTIONS.map((hours) => (
                <MenuItem key={hours} value={hours}>
                  {t("settings.units.hours", { count: hours })}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 2, max: 15, step: 1 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.secondsShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.notificationDurationLabel")}
              value={notificationDurationSeconds}
              onChange={(e) => setNotificationDurationSeconds(e.target.value)}
            />
          </Box>
          <Box>
            <TextField
              slotProps={{ htmlInput: { min: 0, max: 20, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.recentConnectionsLimitLabel")}
              value={recentConnectionsLimit}
              onChange={(e) => setRecentConnectionsLimit(e.target.value)}
            />
          </Box>
        </Box>
      </Grid>

      {/* Right: DnD + Desktop + Editor */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.dnd.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <SettingsToggleRow
            id="settings-dnd-enable"
            noDivider
            label={t("settings.dnd.enable")}
            checked={dndEnabled}
            onChange={(e) => setDndEnabled(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-dnd-autoscroll"
            label={t("settings.dnd.autoScroll")}
            checked={dndAutoScroll}
            disabled={!dndEnabled}
            onChange={(e) => setDndAutoScroll(e.target.checked)}
          />
          <SettingsToggleRow
            id="settings-dnd-compact"
            label={t("settings.dnd.compactPreview")}
            checked={dndCompactPreview}
            disabled={!dndEnabled}
            onChange={(e) => setDndCompactPreview(e.target.checked)}
          />
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.desktopIntegration.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <SettingsToggleRow
            id="settings-tray-enable"
            noDivider
            label={t("settings.desktopIntegration.trayEnabled")}
            checked={trayEnabled}
            onChange={(e) => {
              setTrayEnabled(e.target.checked);
              if (!e.target.checked) {
                setCloseToTray(false);
              }
            }}
          />
          <SettingsToggleRow
            id="settings-close-to-tray"
            label={t("settings.desktopIntegration.closeToTray")}
            checked={closeToTray}
            disabled={!trayEnabled}
            onChange={(e) => setCloseToTray(e.target.checked)}
          />
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("workspaceRestore.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <SettingsToggleRow
            id="settings-restore-session-on-startup"
            noDivider
            label={t("settings.restoreSessionOnStartup")}
            description={t("settings.restoreSessionOnStartupHelp")}
            checked={restoreSessionOnStartup}
            onChange={(e) => setRestoreSessionOnStartup(e.target.checked)}
          />
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.externalEditor.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <SettingsToggleRow
            id="settings-external-editor-enable"
            noDivider
            label={t("settings.externalEditor.enable")}
            checked={externalEditorEnabled}
            onChange={(e) => setExternalEditorEnabled(e.target.checked)}
          />
          <TextField
            fullWidth
            size="small"
            placeholder={t("settings.externalEditor.commandPlaceholder")}
            value={externalEditorCommand}
            onChange={(e) => setExternalEditorCommand(e.target.value)}
            disabled={!externalEditorEnabled}
            sx={{ mt: 1 }}
          />
          <TextField
            slotProps={{
              htmlInput: { min: 200, max: 5000, step: 50 },
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    {t("settings.units.millisecondsShort")}
                  </InputAdornment>
                ),
              },
            }}
            fullWidth
            size="small"
            type="number"
            label={t("settings.externalEditor.autoUploadDebounce")}
            value={externalEditorAutoUploadDebounceMs}
            onChange={(e) =>
              setExternalEditorAutoUploadDebounceMs(e.target.value)
            }
            disabled={!externalEditorEnabled}
            sx={{ mt: 1.5 }}
          />
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.diskAlert.title")}
        </Typography>
        <Box sx={sectionCardSx}>
          <SettingsToggleRow
            id="settings-disk-alert-enable"
            noDivider
            label={t("settings.diskAlert.enable")}
            checked={diskAlertEnabled}
            onChange={(e) => setDiskAlertEnabled(e.target.checked)}
          />
          <Box
            sx={{
              mt: 1,
              display: "flex",
              gap: 1.5,
              flexWrap: "wrap",
              opacity: diskAlertEnabled ? 1 : 0.5,
              pointerEvents: diskAlertEnabled ? "auto" : "none",
              transition: "opacity 160ms ease",
            }}
          >
            <TextField
              slotProps={{ htmlInput: { min: 50, max: 99 } }}
              size="small"
              type="number"
              label={t("settings.diskAlert.threshold")}
              value={diskAlertThreshold}
              onChange={(e) => setDiskAlertThreshold(e.target.value)}
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
            sx={{ mt: 0.75, display: "block", lineHeight: 1.5 }}
          >
            {t("settings.resourceMonitor.modeHint")}
          </Typography>
          <Box
            sx={{
              mt: 1.5,
              display: "flex",
              gap: 1.5,
              flexWrap: "wrap",
            }}
          >
            <TextField
              size="small"
              select
              label={t("settings.resourceMonitor.systemRefreshInterval")}
              value={resourceMonitorSystemRefreshSeconds}
              onChange={(e) =>
                setResourceMonitorSystemRefreshSeconds(Number(e.target.value))
              }
              sx={{ flex: "1 1 130px", minWidth: 130 }}
            >
              {RESOURCE_SYSTEM_REFRESH_OPTIONS.map((seconds) => (
                <MenuItem key={seconds} value={seconds}>
                  {t("settings.units.seconds", { count: seconds })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label={t("settings.resourceMonitor.processRefreshInterval")}
              value={resourceMonitorProcessRefreshSeconds}
              onChange={(e) =>
                setResourceMonitorProcessRefreshSeconds(Number(e.target.value))
              }
              sx={{ flex: "1 1 130px", minWidth: 130 }}
            >
              {RESOURCE_PROCESS_REFRESH_OPTIONS.map((seconds) => (
                <MenuItem key={seconds} value={seconds}>
                  {t("settings.units.seconds", { count: seconds })}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label={t("settings.resourceMonitor.maxVisibleProcesses")}
              value={resourceMonitorMaxVisibleProcesses}
              onChange={(e) =>
                setResourceMonitorMaxVisibleProcesses(Number(e.target.value))
              }
              sx={{ flex: "1 1 130px", minWidth: 130 }}
            >
              {RESOURCE_MAX_PROCESSES_OPTIONS.map((count) => (
                <MenuItem key={count} value={count}>
                  {count}
                </MenuItem>
              ))}
            </TextField>
          </Box>
        </Box>
      </Grid>
    </Grid>
  );
}
