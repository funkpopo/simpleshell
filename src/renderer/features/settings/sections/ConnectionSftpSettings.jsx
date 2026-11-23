import * as React from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Grid from "@mui/material/Grid";
import { useTranslation } from "react-i18next";
import {
  DIRECTORY_WATCH_INTERVAL_OPTIONS,
  FILE_MANAGER_SORT_MODE_OPTIONS,
  NETWORK_LATENCY_INTERVAL_OPTIONS,
} from "../../../../shared/settings/uiSettingsDefaults.js";
import {
  sectionCardSx,
  compactFieldSx,
  subSectionLabelSx,
  SettingsToggleRow,
} from "../components/SettingsSection.jsx";

function clampBoundedInt(value, min, max, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export default function ConnectionSftpSettings({ initialValues, ref }) {
  const { t } = useTranslation();

  const [sshKeepaliveIntervalSeconds, setSshKeepaliveIntervalSeconds] =
    React.useState(initialValues.sshKeepaliveIntervalSeconds);
  const [sshKeepaliveCountMax, setSshKeepaliveCountMax] = React.useState(
    initialValues.sshKeepaliveCountMax,
  );
  const [sshReadyTimeoutSeconds, setSshReadyTimeoutSeconds] = React.useState(
    initialValues.sshReadyTimeoutSeconds,
  );
  const [sshConnectionTimeoutSeconds, setSshConnectionTimeoutSeconds] =
    React.useState(initialValues.sshConnectionTimeoutSeconds);
  const [sshIdleTimeoutMinutes, setSshIdleTimeoutMinutes] = React.useState(
    initialValues.sshIdleTimeoutMinutes,
  );

  const [reconnectMaxRetries, setReconnectMaxRetries] = React.useState(
    initialValues.reconnectMaxRetries,
  );
  const [reconnectInitialDelayMs, setReconnectInitialDelayMs] = React.useState(
    initialValues.reconnectInitialDelayMs,
  );
  const [reconnectTotalTimeCapSeconds, setReconnectTotalTimeCapSeconds] =
    React.useState(initialValues.reconnectTotalTimeCapSeconds);
  const [reconnectFastReconnectEnabled, setReconnectFastReconnectEnabled] =
    React.useState(initialValues.reconnectFastReconnectEnabled);

  const [
    networkLatencyCheckIntervalSeconds,
    setNetworkLatencyCheckIntervalSeconds,
  ] = React.useState(initialValues.networkLatencyCheckIntervalSeconds);

  const [sftpParallelUploads, setSftpParallelUploads] = React.useState(
    initialValues.sftpParallelUploads,
  );
  const [sftpParallelDownloads, setSftpParallelDownloads] = React.useState(
    initialValues.sftpParallelDownloads,
  );
  const [sftpMaxRetries, setSftpMaxRetries] = React.useState(
    initialValues.sftpMaxRetries,
  );
  const [sftpSessionIdleTimeoutMinutes, setSftpSessionIdleTimeoutMinutes] =
    React.useState(initialValues.sftpSessionIdleTimeoutMinutes);

  const [fileManagerDefaultSortMode, setFileManagerDefaultSortMode] =
    React.useState(initialValues.fileManagerDefaultSortMode);
  const [fileManagerShowHiddenFiles, setFileManagerShowHiddenFiles] =
    React.useState(initialValues.fileManagerShowHiddenFiles);
  const [
    fileManagerDirectoryWatchIntervalMs,
    setFileManagerDirectoryWatchIntervalMs,
  ] = React.useState(initialValues.fileManagerDirectoryWatchIntervalMs);
  const [
    fileManagerDirectoryCacheTtlSeconds,
    setFileManagerDirectoryCacheTtlSeconds,
  ] = React.useState(initialValues.fileManagerDirectoryCacheTtlSeconds);
  const [fileManagerMaxPreviewSizeMB, setFileManagerMaxPreviewSizeMB] =
    React.useState(initialValues.fileManagerMaxPreviewSizeMB);

  const [storageFileCacheMaxMB, setStorageFileCacheMaxMB] = React.useState(
    initialValues.storageFileCacheMaxMB,
  );
  const [storageFileCacheMaxAgeMinutes, setStorageFileCacheMaxAgeMinutes] =
    React.useState(initialValues.storageFileCacheMaxAgeMinutes);
  const [storageSnapshotMaxPerFile, setStorageSnapshotMaxPerFile] =
    React.useState(initialValues.storageSnapshotMaxPerFile);
  const [storageSnapshotRetentionDays, setStorageSnapshotRetentionDays] =
    React.useState(initialValues.storageSnapshotRetentionDays);

  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({
      ssh: {
        keepaliveIntervalSeconds: clampBoundedInt(
          sshKeepaliveIntervalSeconds,
          5,
          120,
          10,
        ),
        keepaliveCountMax: clampBoundedInt(sshKeepaliveCountMax, 3, 30, 9),
        readyTimeoutSeconds: clampBoundedInt(
          sshReadyTimeoutSeconds,
          10,
          180,
          30,
        ),
        connectionTimeoutSeconds: clampBoundedInt(
          sshConnectionTimeoutSeconds,
          5,
          60,
          15,
        ),
        idleTimeoutMinutes: clampBoundedInt(sshIdleTimeoutMinutes, 5, 240, 30),
      },
      reconnect: {
        maxRetries: clampBoundedInt(reconnectMaxRetries, 0, 30, 10),
        initialDelayMs: clampBoundedInt(
          reconnectInitialDelayMs,
          500,
          10000,
          1500,
        ),
        totalTimeCapSeconds: clampBoundedInt(
          reconnectTotalTimeCapSeconds,
          30,
          600,
          120,
        ),
        fastReconnectEnabled: Boolean(reconnectFastReconnectEnabled),
      },
      networkLatency: {
        checkIntervalSeconds: NETWORK_LATENCY_INTERVAL_OPTIONS.includes(
          Number(networkLatencyCheckIntervalSeconds),
        )
          ? Number(networkLatencyCheckIntervalSeconds)
          : 60,
      },
      sftp: {
        parallelUploads: clampBoundedInt(sftpParallelUploads, 1, 8, 4),
        parallelDownloads: clampBoundedInt(sftpParallelDownloads, 1, 8, 6),
        maxRetries: clampBoundedInt(sftpMaxRetries, 0, 5, 2),
        sessionIdleTimeoutMinutes: clampBoundedInt(
          sftpSessionIdleTimeoutMinutes,
          1,
          120,
          10,
        ),
      },
      fileManager: {
        defaultSortMode: FILE_MANAGER_SORT_MODE_OPTIONS.includes(
          fileManagerDefaultSortMode,
        )
          ? fileManagerDefaultSortMode
          : "name",
        showHiddenFiles: Boolean(fileManagerShowHiddenFiles),
        directoryWatchIntervalMs: DIRECTORY_WATCH_INTERVAL_OPTIONS.includes(
          Number(fileManagerDirectoryWatchIntervalMs),
        )
          ? Number(fileManagerDirectoryWatchIntervalMs)
          : 1500,
        directoryCacheTtlSeconds: clampBoundedInt(
          fileManagerDirectoryCacheTtlSeconds,
          0,
          300,
          10,
        ),
        maxPreviewSizeMB: clampBoundedInt(
          fileManagerMaxPreviewSizeMB,
          1,
          50,
          10,
        ),
      },
      storage: {
        fileCacheMaxMB: clampBoundedInt(storageFileCacheMaxMB, 32, 2048, 128),
        fileCacheMaxAgeMinutes: clampBoundedInt(
          storageFileCacheMaxAgeMinutes,
          10,
          1440,
          60,
        ),
        snapshotMaxPerFile: clampBoundedInt(
          storageSnapshotMaxPerFile,
          5,
          200,
          50,
        ),
        snapshotRetentionDays: clampBoundedInt(
          storageSnapshotRetentionDays,
          1,
          365,
          30,
        ),
      },
    }),
  }));

  return (
    <Grid container spacing={2}>
      {/* Left: SSH & Reconnect & Latency */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.connectionSftp.sshTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 5, max: 120, step: 1 },
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
              label={t("settings.connectionSftp.keepaliveInterval")}
              value={sshKeepaliveIntervalSeconds}
              onChange={(e) => setSshKeepaliveIntervalSeconds(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 3, max: 30, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.keepaliveCountMax")}
              value={sshKeepaliveCountMax}
              onChange={(e) => setSshKeepaliveCountMax(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 10, max: 180, step: 1 },
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
              label={t("settings.connectionSftp.readyTimeout")}
              value={sshReadyTimeoutSeconds}
              onChange={(e) => setSshReadyTimeoutSeconds(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 5, max: 60, step: 1 },
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
              label={t("settings.connectionSftp.connectionTimeout")}
              value={sshConnectionTimeoutSeconds}
              onChange={(e) => setSshConnectionTimeoutSeconds(e.target.value)}
            />
          </Box>
          <Box>
            <TextField
              slotProps={{
                htmlInput: { min: 5, max: 240, step: 1 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.minutesShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.idleTimeout")}
              value={sshIdleTimeoutMinutes}
              onChange={(e) => setSshIdleTimeoutMinutes(e.target.value)}
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.connectionSftp.reconnectTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 0, max: 30, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.reconnectMaxRetries")}
              value={reconnectMaxRetries}
              onChange={(e) => setReconnectMaxRetries(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 500, max: 10000, step: 100 },
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
              label={t("settings.connectionSftp.reconnectInitialDelay")}
              value={reconnectInitialDelayMs}
              onChange={(e) => setReconnectInitialDelayMs(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 30, max: 600, step: 5 },
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
              label={t("settings.connectionSftp.reconnectTotalTimeCap")}
              value={reconnectTotalTimeCapSeconds}
              onChange={(e) => setReconnectTotalTimeCapSeconds(e.target.value)}
            />
          </Box>
          <SettingsToggleRow
            id="settings-reconnect-fast"
            noDivider
            label={t("settings.connectionSftp.fastReconnectEnabled")}
            checked={reconnectFastReconnectEnabled}
            onChange={(e) => setReconnectFastReconnectEnabled(e.target.checked)}
          />
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.connectionSftp.latencyTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Typography variant="subtitle2" gutterBottom>
            {t("settings.connectionSftp.latencyCheckInterval")}
          </Typography>
          <FormControl fullWidth variant="outlined" size="small">
            <Select
              value={networkLatencyCheckIntervalSeconds}
              onChange={(e) =>
                setNetworkLatencyCheckIntervalSeconds(Number(e.target.value))
              }
            >
              {NETWORK_LATENCY_INTERVAL_OPTIONS.map((seconds) => (
                <MenuItem key={seconds} value={seconds}>
                  {seconds === 0
                    ? t("settings.connectionSftp.latencyIntervalPaused")
                    : t("settings.units.seconds", { count: seconds })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Grid>

      {/* Right: SFTP & File Manager & Storage */}
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography sx={subSectionLabelSx}>
          {t("settings.connectionSftp.sftpTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 1, max: 8, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.sftpParallelUploads")}
              value={sftpParallelUploads}
              onChange={(e) => setSftpParallelUploads(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 1, max: 8, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.sftpParallelDownloads")}
              value={sftpParallelDownloads}
              onChange={(e) => setSftpParallelDownloads(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 0, max: 5, step: 1 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.sftpMaxRetries")}
              value={sftpMaxRetries}
              onChange={(e) => setSftpMaxRetries(e.target.value)}
            />
          </Box>
          <Box>
            <TextField
              slotProps={{
                htmlInput: { min: 1, max: 120, step: 1 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.minutesShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.sftpSessionIdleTimeout")}
              value={sftpSessionIdleTimeoutMinutes}
              onChange={(e) => setSftpSessionIdleTimeoutMinutes(e.target.value)}
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.connectionSftp.fileManagerTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.connectionSftp.defaultSortMode")}
            </Typography>
            <FormControl fullWidth variant="outlined" size="small">
              <Select
                value={fileManagerDefaultSortMode}
                onChange={(e) => setFileManagerDefaultSortMode(e.target.value)}
              >
                <MenuItem value="name">
                  {t("settings.connectionSftp.sortByName")}
                </MenuItem>
                <MenuItem value="time">
                  {t("settings.connectionSftp.sortByTime")}
                </MenuItem>
              </Select>
            </FormControl>
          </Box>
          <Box sx={compactFieldSx}>
            <SettingsToggleRow
              id="settings-fm-show-hidden"
              noDivider
              label={t("settings.connectionSftp.showHiddenFiles")}
              checked={fileManagerShowHiddenFiles}
              onChange={(e) => setFileManagerShowHiddenFiles(e.target.checked)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <Typography variant="subtitle2" gutterBottom>
              {t("settings.connectionSftp.directoryWatchInterval")}
            </Typography>
            <FormControl fullWidth variant="outlined" size="small">
              <Select
                value={fileManagerDirectoryWatchIntervalMs}
                onChange={(e) =>
                  setFileManagerDirectoryWatchIntervalMs(Number(e.target.value))
                }
              >
                {DIRECTORY_WATCH_INTERVAL_OPTIONS.map((ms) => (
                  <MenuItem key={ms} value={ms}>
                    {ms === 0
                      ? t("settings.connectionSftp.directoryWatchDisabled")
                      : t("settings.units.milliseconds", { count: ms })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 0, max: 300, step: 1 },
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
              label={t("settings.connectionSftp.directoryCacheTtl")}
              value={fileManagerDirectoryCacheTtlSeconds}
              onChange={(e) =>
                setFileManagerDirectoryCacheTtlSeconds(e.target.value)
              }
            />
          </Box>
          <Box>
            <TextField
              slotProps={{
                htmlInput: { min: 1, max: 50, step: 1 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.megabytesShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.maxPreviewSize")}
              value={fileManagerMaxPreviewSizeMB}
              onChange={(e) => setFileManagerMaxPreviewSizeMB(e.target.value)}
            />
          </Box>
        </Box>

        <Typography sx={subSectionLabelSx}>
          {t("settings.connectionSftp.storageTitle")}
        </Typography>
        <Box sx={sectionCardSx}>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 32, max: 2048, step: 16 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.megabytesShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.fileCacheMaxMB")}
              value={storageFileCacheMaxMB}
              onChange={(e) => setStorageFileCacheMaxMB(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{
                htmlInput: { min: 10, max: 1440, step: 10 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.minutesShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.fileCacheMaxAgeMinutes")}
              value={storageFileCacheMaxAgeMinutes}
              onChange={(e) => setStorageFileCacheMaxAgeMinutes(e.target.value)}
            />
          </Box>
          <Box sx={compactFieldSx}>
            <TextField
              slotProps={{ htmlInput: { min: 5, max: 200, step: 5 } }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.snapshotMaxPerFile")}
              value={storageSnapshotMaxPerFile}
              onChange={(e) => setStorageSnapshotMaxPerFile(e.target.value)}
            />
          </Box>
          <Box>
            <TextField
              slotProps={{
                htmlInput: { min: 1, max: 365, step: 1 },
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t("settings.units.daysShort")}
                    </InputAdornment>
                  ),
                },
              }}
              fullWidth
              size="small"
              type="number"
              label={t("settings.connectionSftp.snapshotRetentionDays")}
              value={storageSnapshotRetentionDays}
              onChange={(e) => setStorageSnapshotRetentionDays(e.target.value)}
            />
          </Box>
        </Box>
      </Grid>
    </Grid>
  );
}
