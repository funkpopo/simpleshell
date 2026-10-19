import * as React from "react";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Grid from "@mui/material/Grid";
import ImageIcon from "@mui/icons-material/Image";
import MemoryIcon from "@mui/icons-material/Memory";
import CachedIcon from "@mui/icons-material/Cached";
import DisplaySettingsIcon from "@mui/icons-material/DisplaySettings";
import { useTranslation } from "react-i18next";
import { sectionCardSx } from "../components/SettingsSection.jsx";

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
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.75,
                mb: 0.75,
              }}
            >
              <DisplaySettingsIcon sx={{ color: "info.main", fontSize: 20 }} />
              <Typography variant="subtitle2" component="div">
                {t("settings.hardwareAcceleration")}
              </Typography>
              {hardwareAccelerationEnabled !==
                (originalPerformanceSettings.hardwareAcceleration !==
                  false) && (
                <Chip
                  label={t("settings.needsRestart")}
                  size="small"
                  color="warning"
                />
              )}
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={hardwareAccelerationEnabled}
                  onChange={(e) =>
                    handlePerformanceChange(
                      "hardwareAcceleration",
                      e.target.checked,
                    )
                  }
                  color="primary"
                />
              }
              label={t("settings.enableHardwareAcceleration")}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.5 }}
            >
              {t("settings.hardwareAccelerationDescription")}
            </Typography>

            {/* GPU 信息 */}
            <Box
              sx={{
                mt: 1,
                p: 1,
                borderRadius: 1,
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.04)"
                    : "rgba(0,0,0,0.03)",
                fontFamily: "monospace",
                fontSize: 12,
              }}
            >
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: "block", mb: 0.25 }}
              >
                {t("settings.gpuInfo")}
              </Typography>
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
                <Box>
                  <Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      component="span"
                    >
                      {t("settings.gpuRenderer")}:{" "}
                    </Typography>
                    <Typography
                      variant="caption"
                      component="span"
                      sx={{ wordBreak: "break-all" }}
                    >
                      {gpuInfo.displayRenderer ||
                        gpuInfo.activeGpu?.deviceString ||
                        t("settings.gpuUnknown")}
                    </Typography>
                  </Box>
                  {gpuInfo.displayVendor && (
                    <Box>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        component="span"
                      >
                        {t("settings.gpuVendor")}:{" "}
                      </Typography>
                      <Typography variant="caption" component="span">
                        {gpuInfo.displayVendor}
                      </Typography>
                    </Box>
                  )}
                  {gpuInfo.activeGpu &&
                    (gpuInfo.activeGpu.vendorId ||
                      gpuInfo.activeGpu.deviceId) && (
                      <Box>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          component="span"
                        >
                          {t("settings.gpuDeviceId")}:{" "}
                        </Typography>
                        <Typography variant="caption" component="span">
                          {gpuInfo.activeGpu.vendorId || "?"}/
                          {gpuInfo.activeGpu.deviceId || "?"}
                        </Typography>
                      </Box>
                    )}
                  <Box sx={{ mt: 0.25 }}>
                    {gpuInfo.softwareRendering ? (
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
                    )}
                  </Box>
                </Box>
              )}
            </Box>
          </Box>
        </Grid>

        {/* 图像支持 */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 0.75,
              }}
            >
              <ImageIcon
                sx={{
                  mr: 0.75,
                  color: "primary.main",
                  fontSize: 20,
                }}
              />
              <Typography variant="subtitle2" component="div">
                {t("settings.imageSupport")}
              </Typography>
              {needsRestart &&
                imageSupported !==
                  originalPerformanceSettings.imageSupported && (
                  <Chip
                    label={t("settings.needsRestart")}
                    size="small"
                    color="warning"
                    sx={{ ml: 0.5 }}
                  />
                )}
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={imageSupported}
                  onChange={(e) =>
                    handlePerformanceChange("imageSupported", e.target.checked)
                  }
                  color="primary"
                />
              }
              label={t("settings.enableImageSupport")}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.5 }}
            >
              {t("settings.imageDescription")}
            </Typography>
          </Box>
        </Grid>

        {/* 智能缓存 */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 0.75,
              }}
            >
              <MemoryIcon
                sx={{
                  mr: 0.75,
                  color: "success.main",
                  fontSize: 20,
                }}
              />
              <Typography variant="subtitle2" component="div">
                {t("settings.smartCache")}
              </Typography>
              <Chip
                label={t("settings.realTime")}
                size="small"
                color="success"
                sx={{ ml: 0.5 }}
              />
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={cacheEnabled}
                  onChange={(e) =>
                    handlePerformanceChange("cacheEnabled", e.target.checked)
                  }
                  color="primary"
                />
              }
              label={t("settings.enableCache")}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.5 }}
            >
              {t("settings.cacheDescription")}
            </Typography>
          </Box>
        </Grid>

        {/* 智能预取 */}
        <Grid size={{ xs: 12 }}>
          <Box sx={{ ...sectionCardSx, height: "100%" }}>
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                mb: 0.75,
              }}
            >
              <CachedIcon
                sx={{
                  mr: 0.75,
                  color: "success.main",
                  fontSize: 20,
                }}
              />
              <Typography variant="subtitle2" component="div">
                {t("settings.smartPrefetch")}
              </Typography>
              <Chip
                label={t("settings.realTime")}
                size="small"
                color="success"
                sx={{ ml: 0.5 }}
              />
            </Box>
            <FormControlLabel
              control={
                <Switch
                  checked={prefetchEnabled}
                  onChange={(e) =>
                    handlePerformanceChange("prefetchEnabled", e.target.checked)
                  }
                  color="primary"
                />
              }
              label={t("settings.enablePrefetch")}
            />
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: "block", mt: 0.5 }}
            >
              {t("settings.prefetchDescription")}
            </Typography>
          </Box>
        </Grid>
      </Grid>
    </Box>
  );
}
