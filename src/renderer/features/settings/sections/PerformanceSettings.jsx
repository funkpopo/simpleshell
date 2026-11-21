import * as React from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Grid from "@mui/material/Grid";
import ImageIcon from "@mui/icons-material/Image";
import MemoryIcon from "@mui/icons-material/Memory";
import CachedIcon from "@mui/icons-material/Cached";
import DisplaySettingsIcon from "@mui/icons-material/DisplaySettings";
import { useTranslation } from "react-i18next";
import {
  sectionCardSx,
  SectionCardHeader,
  SettingsToggleRow,
} from "../components/SettingsSection.jsx";

export default function PerformanceSettings({ initialValues, open, ref }) {
  const { t } = useTranslation();

  const [imageSupported, setImageSupported] = React.useState(
    initialValues.imageSupported,
  );
  const [cacheEnabled, setCacheEnabled] = React.useState(
    initialValues.cacheEnabled,
  );
  const [prefetchEnabled, setPrefetchEnabled] = React.useState(
    initialValues.prefetchEnabled,
  );
  const [hardwareAccelerationEnabled, setHardwareAccelerationEnabled] =
    React.useState(initialValues.hardwareAccelerationEnabled);
  const [gpuInfo, setGpuInfo] = React.useState(initialValues.gpuInfo);
  const [gpuInfoLoading, setGpuInfoLoading] = React.useState(
    initialValues.gpuInfoLoading,
  );
  const [needsRestart, setNeedsRestart] = React.useState(
    initialValues.needsRestart,
  );
  const [originalPerformanceSettings] = React.useState(
    initialValues.originalPerformanceSettings,
  );
  const checkIfRestartNeeded = (newSettings) => {
    const current = {
      imageSupported,
      cacheEnabled,
      prefetchEnabled,
      webglEnabled: hardwareAccelerationEnabled,
      hardwareAcceleration: hardwareAccelerationEnabled,
      ...newSettings,
    };

    // 图像支持或硬件加速变更需要重启
    const needsRestartForImage =
      current.imageSupported !== originalPerformanceSettings.imageSupported;
    const needsRestartForGpu =
      current.hardwareAcceleration !==
      (originalPerformanceSettings.hardwareAcceleration !== false);

    return needsRestartForImage || needsRestartForGpu;
  };
  const handlePerformanceChange = (setting, value) => {
    const newSettings = { [setting]: value };

    switch (setting) {
      case "imageSupported":
        setImageSupported(value);
        break;
      case "cacheEnabled":
        setCacheEnabled(value);
        // 缓存设置可以实时生效
        if (window.terminalAPI?.configureRuntimeFileResource) {
          window.terminalAPI.configureRuntimeFileResource("file-cache", {
            enabled: value,
          });
        }
        break;
      case "prefetchEnabled":
        setPrefetchEnabled(value);
        // 预取设置可以实时生效
        if (window.terminalAPI?.updatePrefetchSettings) {
          window.terminalAPI.updatePrefetchSettings({ enabled: value });
        }
        break;
      case "hardwareAcceleration":
        setHardwareAccelerationEnabled(value);
        break;
    }

    // 检查是否需要重启
    setNeedsRestart(checkIfRestartNeeded(newSettings));
  };
  React.useEffect(() => {
    if (!open) return;
    if (!window.terminalAPI?.getGpuInfo) return;
    let cancelled = false;
    setGpuInfoLoading(true);
    window.terminalAPI
      .getGpuInfo()
      .then((info) => {
        if (!cancelled) setGpuInfo(info || null);
      })
      .catch(() => {
        if (!cancelled) setGpuInfo(null);
      })
      .finally(() => {
        if (!cancelled) setGpuInfoLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);
  React.useImperativeHandle(ref, () => ({
    getUISettings: () => ({
      performance: {
        imageSupported,
        cacheEnabled,
        prefetchEnabled,
        webglEnabled: hardwareAccelerationEnabled,
        hardwareAcceleration: hardwareAccelerationEnabled,
      },
    }),
  }));
  return (
    <Box>
      {needsRestart && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          <AlertTitle>{t("settings.restartRequired")}</AlertTitle>
          {t("settings.restartMessage")}
        </Alert>
      )}
      <Grid container spacing={1.5}>
        {/* 硬件加速 (全局 GPU 开关) */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <SectionCardHeader
              icon={DisplaySettingsIcon}
              iconColor="info.main"
              title={t("settings.hardwareAcceleration")}
              actions={
                hardwareAccelerationEnabled !==
                (originalPerformanceSettings.hardwareAcceleration !== false) ? (
                  <Chip
                    label={t("settings.needsRestart")}
                    size="small"
                    color="warning"
                  />
                ) : null
              }
            />
            <SettingsToggleRow
              id="settings-gpu-accel"
              noDivider
              label={t("settings.enableHardwareAcceleration")}
              description={t("settings.hardwareAccelerationDescription")}
              checked={hardwareAccelerationEnabled}
              onChange={(e) =>
                handlePerformanceChange(
                  "hardwareAcceleration",
                  e.target.checked,
                )
              }
            />

            {/* GPU 信息 */}
            <Box
              sx={{
                mt: 1.25,
                p: 1.25,
                borderRadius: "var(--radius-sm, 3px)",
                border: "1px solid",
                borderColor: "divider",
                bgcolor: "background.paper",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 1,
                  mb: 0.75,
                }}
              >
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ fontWeight: 600 }}
                >
                  {t("settings.gpuInfo")}
                </Typography>
                {!gpuInfoLoading && gpuInfo ? (
                  gpuInfo.softwareRendering ? (
                    <Chip
                      size="small"
                      color="warning"
                      label={t("settings.gpuSoftwareFallback")}
                    />
                  ) : (
                    <Chip
                      size="small"
                      color="success"
                      label={t("settings.gpuHardwareActive")}
                    />
                  )
                ) : null}
              </Box>
              {gpuInfoLoading && (
                <Typography variant="caption" color="text.secondary">
                  {t("settings.gpuInfoLoading")}
                </Typography>
              )}
              {!gpuInfoLoading && !gpuInfo && (
                <Typography variant="caption" color="text.secondary">
                  {t("settings.gpuInfoUnavailable")}
                </Typography>
              )}
              {!gpuInfoLoading && gpuInfo && (
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "auto minmax(0, 1fr)",
                    columnGap: 1.5,
                    rowGap: 0.35,
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {t("settings.gpuRenderer")}
                  </Typography>
                  <Typography variant="caption" sx={{ wordBreak: "break-all" }}>
                    {gpuInfo.displayRenderer ||
                      gpuInfo.activeGpu?.deviceString ||
                      t("settings.gpuUnknown")}
                  </Typography>
                  {gpuInfo.displayVendor && (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        {t("settings.gpuVendor")}
                      </Typography>
                      <Typography variant="caption">
                        {gpuInfo.displayVendor}
                      </Typography>
                    </>
                  )}
                  {gpuInfo.activeGpu &&
                    (gpuInfo.activeGpu.vendorId ||
                      gpuInfo.activeGpu.deviceId) && (
                      <>
                        <Typography variant="caption" color="text.secondary">
                          {t("settings.gpuDeviceId")}
                        </Typography>
                        <Typography variant="caption">
                          {gpuInfo.activeGpu.vendorId || "?"}/
                          {gpuInfo.activeGpu.deviceId || "?"}
                        </Typography>
                      </>
                    )}
                </Box>
              )}
            </Box>
          </Box>
        </Grid>

        {/* 图像支持 */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <SectionCardHeader
              icon={ImageIcon}
              iconColor="primary.main"
              title={t("settings.imageSupport")}
              actions={
                needsRestart &&
                imageSupported !==
                  originalPerformanceSettings.imageSupported ? (
                  <Chip
                    label={t("settings.needsRestart")}
                    size="small"
                    color="warning"
                  />
                ) : null
              }
            />
            <SettingsToggleRow
              id="settings-image-support"
              noDivider
              label={t("settings.enableImageSupport")}
              description={t("settings.imageDescription")}
              checked={imageSupported}
              onChange={(e) =>
                handlePerformanceChange("imageSupported", e.target.checked)
              }
            />
          </Box>
        </Grid>

        {/* 智能缓存 */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <SectionCardHeader
              icon={MemoryIcon}
              iconColor="success.main"
              title={t("settings.smartCache")}
              actions={
                <Chip
                  label={t("settings.realTime")}
                  size="small"
                  color="success"
                  variant="outlined"
                />
              }
            />
            <SettingsToggleRow
              id="settings-smart-cache"
              noDivider
              label={t("settings.enableCache")}
              description={t("settings.cacheDescription")}
              checked={cacheEnabled}
              onChange={(e) =>
                handlePerformanceChange("cacheEnabled", e.target.checked)
              }
            />
          </Box>
        </Grid>

        {/* 智能预取 */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <SectionCardHeader
              icon={CachedIcon}
              iconColor="success.main"
              title={t("settings.smartPrefetch")}
              actions={
                <Chip
                  label={t("settings.realTime")}
                  size="small"
                  color="success"
                  variant="outlined"
                />
              }
            />
            <SettingsToggleRow
              id="settings-smart-prefetch"
              noDivider
              label={t("settings.enablePrefetch")}
              description={t("settings.prefetchDescription")}
              checked={prefetchEnabled}
              onChange={(e) =>
                handlePerformanceChange("prefetchEnabled", e.target.checked)
              }
            />
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
