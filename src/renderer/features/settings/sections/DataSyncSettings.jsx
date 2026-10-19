import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Grid from "@mui/material/Grid";
import TerminalIcon from "@mui/icons-material/Terminal";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import BackupIcon from "@mui/icons-material/Backup";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import CloudDownloadIcon from "@mui/icons-material/CloudDownload";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import RestoreIcon from "@mui/icons-material/Restore";
import { useTranslation } from "react-i18next";
import OpenSSHImportDialog from "../../connections/components/OpenSSHImportDialog.jsx";
import {
  sectionCardSx,
  SectionCardHeader,
} from "../components/SettingsSection.jsx";
import useConfigSync from "../hooks/useConfigSync.js";

export default function DataSyncSettings({ initialValues, open }) {
  const { t } = useTranslation();
  const {
    configTransferBusy,
    setSshImportOpen,
    exportPassword,
    setExportPassword,
    exportConfirmPassword,
    setExportConfirmPassword,
    rememberExportPassword,
    handleRememberExportPasswordChange,
    handleExportConfig,
    handlePickImportFile,
    importFilePath,
    importPassword,
    setImportPassword,
    importMode,
    setImportMode,
    handleImportConfig,
    webdavUrl,
    setWebdavUrl,
    webdavUsername,
    setWebdavUsername,
    webdavPassword,
    setWebdavPassword,
    webdavFileName,
    setWebdavFileName,
    handleWebdavTest,
    handleWebdavUpload,
    handleWebdavDownload,
    autoSyncEnabled,
    handleToggleAutoSync,
    autoSyncOnStartup,
    setAutoSyncOnStartup,
    handleAutoSyncOptionChange,
    autoSyncIntervalMinutes,
    setAutoSyncIntervalMinutes,
    handleSyncPullNow,
    autoSyncStatus,
    getAutoSyncStatusMessage,
    handleCloseSshImport,
    sshImportOpen,
  } = useConfigSync({ initialValues, open });
  return (
    <>
      <Box>
        <Box sx={{ ...sectionCardSx, mb: 1.5 }}>
          <SectionCardHeader
            icon={TerminalIcon}
            title={t("settings.dataSync.sshImportTitle")}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("settings.dataSync.sshImportDescription")}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RestoreIcon />}
            disabled={configTransferBusy !== ""}
            onClick={() => setSshImportOpen(true)}
          >
            {t("connectionManager.sshImport")}
          </Button>
        </Box>

        {/* 导出加密包 */}
        <Box sx={sectionCardSx}>
          <SectionCardHeader
            icon={BackupIcon}
            title={t("settings.dataSync.export.title")}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("settings.dataSync.export.description")}
          </Typography>
          <Grid container spacing={1}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label={t("settings.dataSync.export.password")}
                value={exportPassword}
                onChange={(e) => setExportPassword(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label={t("settings.dataSync.export.confirmPassword")}
                value={exportConfirmPassword}
                onChange={(e) => setExportConfirmPassword(e.target.value)}
              />
            </Grid>
          </Grid>
          <FormControlLabel
            control={
              <Switch
                checked={rememberExportPassword}
                onChange={(e) =>
                  handleRememberExportPasswordChange(e.target.checked)
                }
                size="small"
              />
            }
            label={
              <Typography variant="body2">
                {t("settings.dataSync.autoSync.rememberPassword")}
              </Typography>
            }
          />
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<BackupIcon />}
              disabled={configTransferBusy !== ""}
              onClick={handleExportConfig}
            >
              {configTransferBusy === "export"
                ? t("settings.dataSync.working")
                : t("settings.dataSync.export.button")}
            </Button>
          </Box>
        </Box>

        {/* 导入配置包 */}
        <Box sx={{ ...sectionCardSx, mt: 1.5 }}>
          <SectionCardHeader
            icon={RestoreIcon}
            title={t("settings.dataSync.import.title")}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("settings.dataSync.import.description")}
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 1,
            }}
          >
            <Button
              variant="outlined"
              size="small"
              startIcon={<FolderOpenIcon />}
              onClick={handlePickImportFile}
            >
              {t("settings.dataSync.import.pickFile")}
            </Button>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {importFilePath || t("settings.dataSync.import.noFile")}
            </Typography>
          </Box>
          <Grid container spacing={1}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label={t("settings.dataSync.import.password")}
                value={importPassword}
                onChange={(e) => setImportPassword(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t("settings.dataSync.import.mode")}</InputLabel>
                <Select
                  value={importMode}
                  label={t("settings.dataSync.import.mode")}
                  onChange={(e) => setImportMode(e.target.value)}
                >
                  <MenuItem value="merge">
                    {t("settings.dataSync.import.modeMerge")}
                  </MenuItem>
                  <MenuItem value="replace">
                    {t("settings.dataSync.import.modeReplace")}
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>
          </Grid>
          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<RestoreIcon />}
              disabled={configTransferBusy !== "" || !importFilePath}
              onClick={handleImportConfig}
            >
              {configTransferBusy === "import"
                ? t("settings.dataSync.working")
                : t("settings.dataSync.import.button")}
            </Button>
          </Box>
        </Box>

        {/* WebDAV 多机同步 */}
        <Box sx={{ ...sectionCardSx, mt: 1.5 }}>
          <SectionCardHeader
            icon={CloudSyncIcon}
            title={t("settings.dataSync.webdav.title")}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("settings.dataSync.webdav.description")}
          </Typography>
          <TextField
            fullWidth
            size="small"
            label={t("settings.dataSync.webdav.url")}
            placeholder={t("settings.dataSync.webdav.urlPlaceholder")}
            value={webdavUrl}
            onChange={(e) => setWebdavUrl(e.target.value)}
            sx={{ mb: 1 }}
          />
          <Grid container spacing={1}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                label={t("settings.dataSync.webdav.username")}
                value={webdavUsername}
                onChange={(e) => setWebdavUsername(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                type="password"
                label={t("settings.dataSync.webdav.password")}
                value={webdavPassword}
                onChange={(e) => setWebdavPassword(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                size="small"
                label={t("settings.dataSync.webdav.fileName")}
                value={webdavFileName}
                onChange={(e) => setWebdavFileName(e.target.value)}
              />
            </Grid>
          </Grid>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: "block", mt: 0.75, mb: 1 }}
          >
            {t("settings.dataSync.webdav.hint")}
          </Typography>
          <Box
            sx={{
              display: "flex",
              gap: 0.75,
              flexWrap: "wrap",
            }}
          >
            <Button
              variant="outlined"
              size="small"
              disabled={configTransferBusy !== "" || !webdavUrl.trim()}
              onClick={handleWebdavTest}
            >
              {configTransferBusy === "webdav-test"
                ? t("settings.dataSync.working")
                : t("settings.dataSync.webdav.test")}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudUploadIcon />}
              disabled={configTransferBusy !== "" || !webdavUrl.trim()}
              onClick={() => handleWebdavUpload(false)}
            >
              {configTransferBusy === "webdav-upload"
                ? t("settings.dataSync.working")
                : t("settings.dataSync.webdav.upload")}
            </Button>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudDownloadIcon />}
              disabled={
                configTransferBusy !== "" ||
                !webdavUrl.trim() ||
                !importPassword
              }
              onClick={handleWebdavDownload}
            >
              {configTransferBusy === "webdav-download"
                ? t("settings.dataSync.working")
                : t("settings.dataSync.webdav.download")}
            </Button>
          </Box>
        </Box>

        {/* 自动同步 */}
        <Box sx={{ ...sectionCardSx, mt: 1.5 }}>
          <SectionCardHeader
            icon={CloudSyncIcon}
            title={t("settings.dataSync.autoSync.title")}
            actions={
              <FormControlLabel
                control={
                  <Switch
                    checked={autoSyncEnabled}
                    onChange={(e) => handleToggleAutoSync(e.target.checked)}
                    disabled={configTransferBusy !== ""}
                    size="small"
                  />
                }
                label={
                  <Typography variant="body2">
                    {t("settings.dataSync.autoSync.enable")}
                  </Typography>
                }
              />
            }
          />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t("settings.dataSync.autoSync.description")}
          </Typography>

          {autoSyncEnabled && (
            <>
              <FormControlLabel
                control={
                  <Switch
                    checked={autoSyncOnStartup}
                    onChange={(e) => {
                      setAutoSyncOnStartup(e.target.checked);
                      handleAutoSyncOptionChange({
                        autoSyncOnStartup: e.target.checked,
                      });
                    }}
                    size="small"
                  />
                }
                label={
                  <Typography variant="body2">
                    {t("settings.dataSync.autoSync.onStartup")}
                  </Typography>
                }
              />
              <FormControl fullWidth size="small" sx={{ mt: 0.5 }}>
                <InputLabel>
                  {t("settings.dataSync.autoSync.interval")}
                </InputLabel>
                <Select
                  value={autoSyncIntervalMinutes}
                  label={t("settings.dataSync.autoSync.interval")}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setAutoSyncIntervalMinutes(value);
                    handleAutoSyncOptionChange({
                      autoSyncIntervalMinutes: value,
                    });
                  }}
                >
                  {[5, 15, 30, 60, 180, 360, 720, 1440].map((minutes) => (
                    <MenuItem key={minutes} value={minutes}>
                      {minutes < 60
                        ? t("settings.dataSync.autoSync.intervalMinutes", {
                            n: minutes,
                          })
                        : t("settings.dataSync.autoSync.intervalHours", {
                            n: minutes / 60,
                          })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </>
          )}

          <Box sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              size="small"
              startIcon={<CloudDownloadIcon />}
              disabled={configTransferBusy !== ""}
              onClick={handleSyncPullNow}
            >
              {configTransferBusy === "sync-pull"
                ? t("settings.dataSync.working")
                : t("settings.dataSync.autoSync.pullNow")}
            </Button>
          </Box>

          {autoSyncStatus && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.75 }}
            >
              {t("settings.dataSync.autoSync.lastCheck")}
              {": "}
              {autoSyncStatus.lastCheckAt
                ? new Date(autoSyncStatus.lastCheckAt).toLocaleString()
                : "—"}
              {" · "}
              {t("settings.dataSync.autoSync.lastSync")}
              {": "}
              {autoSyncStatus.lastSyncAt
                ? new Date(autoSyncStatus.lastSyncAt).toLocaleString()
                : "—"}
              {" · "}
              {getAutoSyncStatusMessage(autoSyncStatus.lastSyncStatus)}
              {autoSyncEnabled && autoSyncStatus.nextRunAt
                ? ` · ${t("settings.dataSync.autoSync.nextCheck")}: ${new Date(
                    autoSyncStatus.nextRunAt,
                  ).toLocaleTimeString()}`
                : ""}
            </Typography>
          )}
        </Box>
      </Box>
      {open && sshImportOpen && (
        <OpenSSHImportDialog onClose={handleCloseSshImport} />
      )}
    </>
  );
}
