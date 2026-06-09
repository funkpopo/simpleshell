import * as React from "react";
import Dialog from "./AccessibleDialog.jsx";
import { memo } from "react";
import { styled } from "@mui/material/styles";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import Typography from "@mui/material/Typography";
import Box from "@mui/material/Box";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Slider from "@mui/material/Slider";
import Divider from "@mui/material/Divider";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import AlertTitle from "@mui/material/AlertTitle";
import Grid from "@mui/material/Grid";
import TuneIcon from "@mui/icons-material/Tune";
import ImageIcon from "@mui/icons-material/Image";
import MemoryIcon from "@mui/icons-material/Memory";
import CachedIcon from "@mui/icons-material/Cached";
import DisplaySettingsIcon from "@mui/icons-material/DisplaySettings";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import BugReportIcon from "@mui/icons-material/BugReport";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import FeedbackIcon from "@mui/icons-material/Feedback";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "../i18n/i18n";
import { SettingsSkeleton } from "./SkeletonLoader.jsx";
import { useNotification } from "../contexts/NotificationContext";

// 自定义磨砂玻璃效果的Dialog组件
const GlassDialog = styled(Dialog)(({ theme }) => ({
  "& .MuiDialog-paper": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(40, 44, 52, 0.75)"
        : "rgba(255, 255, 255, 0.75)",
    backdropFilter: "blur(10px)",
    boxShadow:
      theme.palette.mode === "dark"
        ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
        : "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
    maxHeight: "70vh",
  },
}));

const sectionCardSx = {
  p: 2,
  borderRadius: 2,
  border: "1px solid",
  borderColor: "divider",
  bgcolor: (theme) =>
    theme.palette.mode === "dark"
      ? "rgba(255, 255, 255, 0.03)"
      : "rgba(17, 24, 39, 0.025)",
};

const sectionTitleRowSx = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  mb: 1.5,
};

const compactFieldSx = {
  mb: 1.75,
};

// Custom styled dialog title
const BootstrapDialogTitle = memo((props) => {
  const { t } = useTranslation();
  const { children, onClose, ...other } = props;

  return (
    <DialogTitle sx={{ m: 0, p: 2 }} {...other}>
      {children}
      {onClose ? (
        <Tooltip title={t("common.close")}>
          <IconButton
            aria-label={t("common.close")}
            onClick={onClose}
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      ) : null}
    </DialogTitle>
  );
});

BootstrapDialogTitle.displayName = "BootstrapDialogTitle";

const Settings = memo(({ open, onClose }) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess } = useNotification();

  // Define available languages
  const languages = [
    { code: "zh-CN", name: t("languages.zh-CN") },
    { code: "en-US", name: t("languages.en-US") },
  ];

  // Define font size options
  const fontSizes = [
    { value: 12, label: t("settings.fontSizeLabels.small") },
    { value: 14, label: t("settings.fontSizeLabels.medium") },
    { value: 16, label: t("settings.fontSizeLabels.large") },
    { value: 18, label: t("settings.fontSizeLabels.xlarge") },
  ];

  // Define terminal font family options (only fonts available in /src/assets/fonts)
  const terminalFonts = [
    {
      value: "Fira Code",
      label: "Fira Code",
      description: "支持编程连字的等宽字体",
    },
    {
      value: "Space Mono",
      label: "Space Mono",
      description: "简洁的等宽字体",
    },
    { value: "Consolas", label: "Consolas", description: "系统默认字体" },
  ];

  // Define log level options
  const logLevels = [
    { value: "DEBUG", label: t("settings.logLevels.debug") },
    { value: "INFO", label: t("settings.logLevels.info") },
    { value: "WARN", label: t("settings.logLevels.warn") },
    { value: "ERROR", label: t("settings.logLevels.error") },
  ];

  // Initial states
  const [language, setLanguage] = React.useState("");
  const [fontSize, setFontSize] = React.useState(14);
  const [terminalFont, setTerminalFont] = React.useState("Fira Code");
  const [terminalFontSize, setTerminalFontSize] = React.useState(14);
  const [terminalFontWeight, setTerminalFontWeight] = React.useState(500);
  const [terminalScrollbackLines, setTerminalScrollbackLines] =
    React.useState(50000);
  const [darkMode, setDarkMode] = React.useState(true);
  const [externalEditorEnabled, setExternalEditorEnabled] =
    React.useState(false);
  const [externalEditorCommand, setExternalEditorCommand] = React.useState("");
  const [logLevel, setLogLevel] = React.useState("WARN");
  const [maxFileSize, setMaxFileSize] = React.useState(5);
  const [cleanupIntervalDays, setCleanupIntervalDays] = React.useState(7);
  const [errorReportingEnabled, setErrorReportingEnabled] =
    React.useState(false);
  const [includeDiagnosticsInFeedback, setIncludeDiagnosticsInFeedback] =
    React.useState(false);
  const [crashReporterStatus, setCrashReporterStatus] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [masterPasswordEnabled, setMasterPasswordEnabled] =
    React.useState(false);
  const [initialMasterPasswordEnabled, setInitialMasterPasswordEnabled] =
    React.useState(false);
  const [masterPassword, setMasterPassword] = React.useState("");
  const [confirmMasterPassword, setConfirmMasterPassword] = React.useState("");

  // 性能设置状态
  const [imageSupported, setImageSupported] = React.useState(true);
  const [cacheEnabled, setCacheEnabled] = React.useState(true);
  const [prefetchEnabled, setPrefetchEnabled] = React.useState(true);
  const [hardwareAccelerationEnabled, setHardwareAccelerationEnabled] =
    React.useState(true);
  const [gpuInfo, setGpuInfo] = React.useState(null);
  const [gpuInfoLoading, setGpuInfoLoading] = React.useState(false);

  // DnD settings
  const [dndEnabled, setDndEnabled] = React.useState(true);
  const [dndAutoScroll, setDndAutoScroll] = React.useState(true);
  const [dndCompactPreview, setDndCompactPreview] = React.useState(false);
  const [trayEnabled, setTrayEnabled] = React.useState(false);
  const [closeToTray, setCloseToTray] = React.useState(false);

  // 传输栏显示模式: "bottom" | "sidebar"
  const [transferBarMode, setTransferBarMode] = React.useState("bottom");

  // 需要重启的设置变更标志
  const [needsRestart, setNeedsRestart] = React.useState(false);
  const [originalPerformanceSettings, setOriginalPerformanceSettings] =
    React.useState({});

  // Load settings from config.json via API
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);

        // 加载UI设置
        if (window.terminalAPI?.loadUISettings) {
          const response = await window.terminalAPI.loadUISettings();
          // 检查响应结构 - IPC handler 返回 { success: true, settings: {...} }
          const settings = response?.success ? response.settings : response;
          if (settings) {
            setLanguage(settings.language || "zh-CN");
            setFontSize(settings.fontSize || 14);
            setTerminalFont(settings.terminalFont || "Fira Code");
            setTerminalFontSize(settings.terminalFontSize || 14);
            setTerminalFontWeight(settings.terminalFontWeight || 500);
            const rawSb = Number(settings.terminalScrollbackLines);
            setTerminalScrollbackLines(
              Number.isFinite(rawSb)
                ? Math.min(500000, Math.max(1000, Math.floor(rawSb)))
                : 50000,
            );
            setDarkMode(
              settings.darkMode !== undefined ? settings.darkMode : true,
            );

            // 加载性能设置
            const externalEditorSettings = settings.externalEditor || {};
            setExternalEditorEnabled(
              externalEditorSettings.enabled === true ||
                settings.externalEditorEnabled === true,
            );
            setExternalEditorCommand(
              externalEditorSettings.command ||
                settings.externalEditorCommand ||
                "",
            );
            const performanceSettings = settings.performance || {
              imageSupported: true,
              cacheEnabled: true,
              prefetchEnabled: true,
              webglEnabled: true,
              hardwareAcceleration: true,
            };
            // DnD settings
            const dnd = settings.dnd || {};
            setDndEnabled(dnd.enabled !== false);
            setDndAutoScroll(dnd.autoScroll !== false);
            setDndCompactPreview(dnd.compactDragPreview === true);
            const desktopIntegration = settings.desktopIntegration || {};
            setTrayEnabled(desktopIntegration.trayEnabled === true);
            setCloseToTray(
              desktopIntegration.trayEnabled === true &&
                desktopIntegration.closeToTray === true,
            );

            // 传输栏显示模式
            setTransferBarMode(settings.transferBarMode || "bottom");

            setImageSupported(performanceSettings.imageSupported !== false);
            setCacheEnabled(performanceSettings.cacheEnabled !== false);
            setPrefetchEnabled(performanceSettings.prefetchEnabled !== false);
            const hardwareAcceleration =
              performanceSettings.hardwareAcceleration !== false;
            setHardwareAccelerationEnabled(hardwareAcceleration);

            // 保存原始设置用于比较
            setOriginalPerformanceSettings(performanceSettings);
          }
        }

        if (window.terminalAPI?.getCredentialSecurityStatus) {
          const response =
            await window.terminalAPI.getCredentialSecurityStatus();
          const securityStatus = response?.success ? response.status : response;
          const enabled = securityStatus?.masterPasswordEnabled === true;
          setMasterPasswordEnabled(enabled);
          setInitialMasterPasswordEnabled(enabled);
          setMasterPassword("");
          setConfirmMasterPassword("");
        }

        // 加载日志设置
        if (window.terminalAPI?.loadLogSettings) {
          const response = await window.terminalAPI.loadLogSettings();
          // 检查响应结构 - IPC handler 返回 { success: true, settings: {...} }
          const logSettings = response?.success ? response.settings : response;
          if (logSettings) {
            setLogLevel(logSettings.level || "WARN");
            // 将字节转换为MB
            setMaxFileSize(
              logSettings.maxFileSize
                ? Math.round(logSettings.maxFileSize / (1024 * 1024))
                : 5,
            );
            setCleanupIntervalDays(logSettings.cleanupIntervalDays || 7);
          }
        }

        if (window.terminalAPI?.getErrorReportingSettings) {
          const response = await window.terminalAPI.getErrorReportingSettings();
          if (response?.success !== false) {
            const settings = response?.settings || {};
            setErrorReportingEnabled(settings.enabled === true);
            setIncludeDiagnosticsInFeedback(
              settings.includeDiagnosticsInFeedback === true,
            );
            setCrashReporterStatus(response?.crashReporter || null);
          }
        }
      } catch {
        /* intentionally ignored */
      } finally {
        setIsLoading(false);
      }
    };

    if (open) {
      loadSettings();
    }
  }, [open]);

  // 加载 GPU 信息（用于验证集显/独显是否生效）
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

  // Handle language change
  const handleLanguageChange = (event) => {
    setLanguage(event.target.value);
  };

  // Handle font size change
  const handleFontSizeChange = (event, newValue) => {
    setFontSize(newValue);
  };

  // Handle terminal font change
  const handleTerminalFontChange = (event) => {
    setTerminalFont(event.target.value);
  };

  // Handle terminal font size change
  const handleTerminalFontSizeChange = (event, newValue) => {
    setTerminalFontSize(newValue);
  };

  // Handle terminal font weight change
  const handleTerminalFontWeightChange = (event, newValue) => {
    setTerminalFontWeight(newValue);
  };

  // Handle theme mode change
  const handleDarkModeChange = (event) => {
    setDarkMode(event.target.value === "dark");
  };

  // Handle log level change
  const handleLogLevelChange = (event) => {
    setLogLevel(event.target.value);
  };

  // Handle max file size change
  const handleMaxFileSizeChange = (event) => {
    const value = event.target.value;
    // 确保输入的是数字，且大于0
    if (!isNaN(value) && Number(value) > 0) {
      setMaxFileSize(Number(value));
    }
  };

  const handleOpenLogDirectory = async () => {
    try {
      const result = await window.terminalAPI?.openLogDirectory?.();
      if (result?.success === false) {
        throw new Error(result.error || t("settings.openLogDirectoryFailed"));
      }
      showSuccess(t("settings.logDirectoryOpened"));
    } catch (error) {
      showError(error?.message || t("settings.openLogDirectoryFailed"));
    }
  };

  const handleExportDiagnostics = async () => {
    try {
      const result = await window.terminalAPI?.exportDiagnostics?.();
      if (result?.success === false) {
        throw new Error(result.error || t("settings.exportDiagnosticsFailed"));
      }
      showSuccess(
        t("settings.diagnosticsExported", {
          path: result?.filePath || "",
        }),
      );
    } catch (error) {
      showError(error?.message || t("settings.exportDiagnosticsFailed"));
    }
  };

  const handleCopyDiagnosticPackage = async () => {
    try {
      const result = await window.terminalAPI?.copyDiagnosticPackage?.({
        source: "settings",
        title: t("settings.feedback.defaultTitle"),
      });
      if (result?.success === false) {
        throw new Error(
          result.error || t("settings.feedback.copyPackageFailed"),
        );
      }
      showSuccess(t("settings.feedback.packageCopied"));
    } catch (error) {
      showError(error?.message || t("settings.feedback.copyPackageFailed"));
    }
  };

  const handleOpenFeedbackIssue = async () => {
    try {
      if (!window.dialogAPI?.showMessageBox) {
        throw new Error(t("settings.feedback.dialogUnavailable"));
      }

      const confirmation = await window.dialogAPI.showMessageBox({
        type: "info",
        buttons: [
          t("settings.feedback.cancel"),
          t("settings.feedback.openIssue"),
        ],
        defaultId: 1,
        cancelId: 0,
        title: t("settings.feedback.confirmTitle"),
        message: t("settings.feedback.confirmMessage"),
        detail: t("settings.feedback.confirmDetail"),
        noLink: true,
      });

      if (confirmation?.response !== 1) {
        return;
      }

      const result = await window.terminalAPI?.openFeedbackIssue?.({
        source: "settings",
        title: t("settings.feedback.defaultTitle"),
      });
      if (result?.success === false) {
        throw new Error(result.error || t("settings.feedback.openIssueFailed"));
      }
      showSuccess(t("settings.feedback.issueOpened"));
    } catch (error) {
      showError(error?.message || t("settings.feedback.openIssueFailed"));
    }
  };

  // 检查性能设置是否需要重启
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

  // Handle performance settings change
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

  // Save settings
  const handleSave = async () => {
    try {
      const shouldUpdateCredentialSecurity =
        masterPasswordEnabled !== initialMasterPasswordEnabled ||
        (masterPasswordEnabled && masterPassword.trim() !== "");

      if (shouldUpdateCredentialSecurity) {
        if (
          masterPasswordEnabled &&
          !initialMasterPasswordEnabled &&
          !masterPassword.trim()
        ) {
          showError(t("settings.security.passwordRequired"));
          return;
        }

        if (masterPasswordEnabled && masterPassword.trim()) {
          if (masterPassword !== confirmMasterPassword) {
            showError(t("settings.security.passwordMismatch"));
            return;
          }
        }

        if (window.terminalAPI?.updateCredentialSecurity) {
          const securityResponse =
            await window.terminalAPI.updateCredentialSecurity({
              masterPasswordEnabled,
              masterPassword: masterPasswordEnabled ? masterPassword : "",
            });

          if (securityResponse?.success === false) {
            throw new Error(
              securityResponse.error || t("settings.security.updateFailed"),
            );
          }

          const securityStatus = securityResponse?.status ||
            securityResponse?.data || {
              masterPasswordEnabled,
              unlocked: true,
              requiresUnlock: false,
            };

          window.dispatchEvent(
            new CustomEvent("credentialSecurityChanged", {
              detail: { status: securityStatus },
            }),
          );

          setInitialMasterPasswordEnabled(masterPasswordEnabled);
          setMasterPassword("");
          setConfirmMasterPassword("");
        }
      }

      // 保存UI设置
      if (window.terminalAPI?.saveUISettings) {
        const settings = {
          language,
          fontSize,
          editorFont: "system", // 保持editorFont字段
          terminalFont,
          terminalFontSize,
          terminalFontWeight,
          terminalScrollbackLines: Math.min(
            500000,
            Math.max(
              1000,
              Math.floor(Number(terminalScrollbackLines)) || 50000,
            ),
          ),
          darkMode,
          performance: {
            imageSupported,
            cacheEnabled,
            prefetchEnabled,
            webglEnabled: hardwareAccelerationEnabled,
            hardwareAcceleration: hardwareAccelerationEnabled,
          },
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
          externalEditor: {
            enabled: externalEditorEnabled,
            command: externalEditorCommand.trim(),
          },
        };
        await window.terminalAPI.saveUISettings(settings);
      }

      // 保存日志设置
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

      if (window.terminalAPI?.saveErrorReportingSettings) {
        const response = await window.terminalAPI.saveErrorReportingSettings({
          enabled: errorReportingEnabled,
          prompted: true,
          includeDiagnosticsInFeedback:
            errorReportingEnabled && includeDiagnosticsInFeedback,
        });
        if (response?.success === false) {
          throw new Error(response.error || t("settings.feedback.saveFailed"));
        }
        setCrashReporterStatus(response?.crashReporter || null);
      }

      // Apply language change
      if (language && i18n.language !== language) {
        changeLanguage(language);
      }

      // Notify app to apply changes
      window.dispatchEvent(
        new CustomEvent("settingsChanged", {
          detail: {
            language,
            fontSize,
            terminalFont,
            terminalFontSize,
            terminalFontWeight,
            terminalScrollbackLines: Math.min(
              500000,
              Math.max(
                1000,
                Math.floor(Number(terminalScrollbackLines)) || 50000,
              ),
            ),
            darkMode,
            performance: {
              imageSupported,
              cacheEnabled,
              prefetchEnabled,
              webglEnabled: hardwareAccelerationEnabled,
              hardwareAcceleration: hardwareAccelerationEnabled,
            },
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
            externalEditor: {
              enabled: externalEditorEnabled,
              command: externalEditorCommand.trim(),
            },
          },
        }),
      );

      // 显示成功提示
      showSuccess(t("settings.saveSuccess"));

      // 延迟关闭对话框，让用户能看到成功提示
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (error) {
      showError(error?.message || t("settings.saveError"));
    }
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      aria-labelledby="settings-dialog-title"
      maxWidth="md"
      fullWidth
    >
      <BootstrapDialogTitle id="settings-dialog-title" onClose={onClose}>
        {t("settings.title")}
      </BootstrapDialogTitle>
      <DialogContent dividers>
        {isLoading ? (
          <SettingsSkeleton />
        ) : (
          <>
            <Grid container spacing={2.25}>
              {/* 左列 */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Box sx={sectionCardSx}>
                  <Box sx={sectionTitleRowSx}>
                    <Typography variant="subtitle1">
                      {t("settings.title")}
                    </Typography>
                    <Chip
                      size="small"
                      color="primary"
                      variant="outlined"
                      label={t("settings.language")}
                    />
                  </Box>
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
                        <MenuItem value="light">
                          {t("settings.themeLight")}
                        </MenuItem>
                        <MenuItem value="dark">
                          {t("settings.themeDark")}
                        </MenuItem>
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

                  <Box sx={{ mb: 0 }}>
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
                </Box>
              </Grid>

              {/* 右列 */}
              <Grid size={{ xs: 12, md: 6 }}>
                <Box sx={sectionCardSx}>
                  <Box sx={sectionTitleRowSx}>
                    <Typography variant="subtitle1">
                      {t("settings.dnd.title")}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", mb: 1 }}>
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
                          onChange={(e) =>
                            setDndCompactPreview(e.target.checked)
                          }
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

                  <Divider sx={{ my: 1.25 }} />

                  <Typography variant="subtitle2" gutterBottom>
                    {t("settings.desktopIntegration.title")}
                  </Typography>
                  <Box sx={{ display: "flex", flexDirection: "column", mb: 1 }}>
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

                  <Divider sx={{ my: 1.25 }} />

                  <Typography variant="subtitle2" gutterBottom>
                    {t("settings.externalEditor.title")}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={externalEditorEnabled}
                        onChange={(e) =>
                          setExternalEditorEnabled(e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {t("settings.externalEditor.enable")}
                      </Typography>
                    }
                  />
                  <TextField
                    fullWidth
                    size="small"
                    placeholder={t(
                      "settings.externalEditor.commandPlaceholder",
                    )}
                    value={externalEditorCommand}
                    onChange={(e) => setExternalEditorCommand(e.target.value)}
                    disabled={!externalEditorEnabled}
                  />
                </Box>

                <Box sx={{ ...sectionCardSx, mt: 2.25 }}>
                  <Box sx={sectionTitleRowSx}>
                    <Typography variant="subtitle1">
                      {t("settings.security.title")}
                    </Typography>
                  </Box>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mb: 1.5 }}
                  >
                    {t("settings.security.description")}
                  </Typography>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={masterPasswordEnabled}
                        onChange={(e) =>
                          setMasterPasswordEnabled(e.target.checked)
                        }
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {t("settings.security.enable")}
                      </Typography>
                    }
                  />

                  {masterPasswordEnabled ? (
                    <Box sx={{ mt: 1.25 }}>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: "block", mb: 1.25 }}
                      >
                        {initialMasterPasswordEnabled
                          ? t("settings.security.changeHint")
                          : t("settings.security.createHint")}
                      </Typography>
                      <TextField
                        fullWidth
                        size="small"
                        type="password"
                        label={t("settings.security.password")}
                        value={masterPassword}
                        onChange={(e) => setMasterPassword(e.target.value)}
                        sx={{ mb: 1.25 }}
                      />
                      <TextField
                        fullWidth
                        size="small"
                        type="password"
                        label={t("settings.security.confirmPassword")}
                        value={confirmMasterPassword}
                        onChange={(e) =>
                          setConfirmMasterPassword(e.target.value)
                        }
                      />
                    </Box>
                  ) : (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mt: 0.75 }}
                    >
                      {t("settings.security.disableHint")}
                    </Typography>
                  )}
                </Box>
              </Grid>
            </Grid>

            <Box sx={{ ...sectionCardSx, mt: 2.25 }}>
              <Box sx={sectionTitleRowSx}>
                <Typography variant="subtitle1">
                  {t("settings.terminalAndLogs")}
                </Typography>
              </Box>

              <Grid container spacing={2} sx={{ mb: 1 }}>
                <Grid size={{ xs: 12, md: 6 }}>
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
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Typography variant="body2" sx={{ minWidth: 60 }}>
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
                      inputProps={{ min: 300, max: 1000 }}
                      sx={{ width: 70 }}
                    />
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <TextField
                    fullWidth
                    size="small"
                    type="number"
                    label={t("settings.terminalScrollbackLines")}
                    helperText={t("settings.terminalScrollbackHelper")}
                    value={terminalScrollbackLines}
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      if (Number.isFinite(v)) {
                        setTerminalScrollbackLines(v);
                      }
                    }}
                    inputProps={{ min: 1000, max: 500000, step: 1000 }}
                  />
                </Grid>
              </Grid>
              <Grid container spacing={2}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="body2" gutterBottom>
                    {t("settings.terminalFontSizeLabel")}
                  </Typography>
                  <Box sx={{ px: 1 }}>
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
                    />
                  </Box>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <Typography variant="body2" gutterBottom>
                    {t("settings.logSettingsTitle")}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <FormControl
                      variant="outlined"
                      size="small"
                      sx={{ flex: 1 }}
                    >
                      <Select value={logLevel} onChange={handleLogLevelChange}>
                        {logLevels.map((level) => (
                          <MenuItem key={level.value} value={level.value}>
                            {level.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                    <TextField
                      size="small"
                      type="number"
                      value={maxFileSize}
                      onChange={handleMaxFileSizeChange}
                      InputProps={{
                        endAdornment: (
                          <InputAdornment position="end">MB</InputAdornment>
                        ),
                      }}
                      inputProps={{ min: 1 }}
                      sx={{ width: 100 }}
                    />
                  </Box>
                  <Box
                    sx={{
                      display: "flex",
                      gap: 1,
                      mt: 1.5,
                      flexWrap: "wrap",
                    }}
                  >
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
                </Grid>
              </Grid>
            </Box>

            <Box sx={{ ...sectionCardSx, mt: 2.25 }}>
              <Box sx={sectionTitleRowSx}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <BugReportIcon sx={{ color: "error.main" }} />
                  <Typography variant="subtitle1">
                    {t("settings.feedback.title")}
                  </Typography>
                </Box>
                <Chip
                  size="small"
                  color={crashReporterStatus?.started ? "success" : "warning"}
                  variant="outlined"
                  label={
                    crashReporterStatus?.started
                      ? t("settings.feedback.localCrashCaptureOn")
                      : t("settings.feedback.localCrashCaptureOff")
                  }
                />
              </Box>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {t("settings.feedback.description")}
              </Typography>
              <Grid container spacing={1.5}>
                <Grid size={{ xs: 12, md: 6 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={errorReportingEnabled}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setErrorReportingEnabled(checked);
                          if (!checked) {
                            setIncludeDiagnosticsInFeedback(false);
                          } else {
                            setIncludeDiagnosticsInFeedback(true);
                          }
                        }}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {t("settings.feedback.enable")}
                      </Typography>
                    }
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.25 }}
                  >
                    {t("settings.feedback.enableHelper")}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12, md: 6 }}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={
                          errorReportingEnabled && includeDiagnosticsInFeedback
                        }
                        onChange={(e) =>
                          setIncludeDiagnosticsInFeedback(e.target.checked)
                        }
                        disabled={!errorReportingEnabled}
                        size="small"
                      />
                    }
                    label={
                      <Typography variant="body2">
                        {t("settings.feedback.includeDiagnostics")}
                      </Typography>
                    }
                  />
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: "block", mt: 0.25 }}
                  >
                    {t("settings.feedback.includeDiagnosticsHelper")}
                  </Typography>
                </Grid>
              </Grid>
              {crashReporterStatus?.crashDirectory ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    mt: 1,
                    wordBreak: "break-all",
                    fontFamily: "monospace",
                  }}
                >
                  {t("settings.feedback.crashDirectory")}:{" "}
                  {crashReporterStatus.crashDirectory}
                </Typography>
              ) : null}
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  mt: 1.5,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={handleCopyDiagnosticPackage}
                >
                  {t("settings.feedback.copyPackage")}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<BugReportIcon />}
                  onClick={handleExportDiagnostics}
                >
                  {t("settings.exportDiagnostics")}
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<FeedbackIcon />}
                  onClick={handleOpenFeedbackIssue}
                >
                  {t("settings.feedback.openIssue")}
                </Button>
              </Box>
            </Box>

            {/* 性能设置 */}
            <Box sx={{ ...sectionCardSx, mt: 2.25, mb: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <TuneIcon sx={{ mr: 1, color: "primary.main" }} />
                <Typography variant="subtitle1">
                  {t("settings.performanceSettings")}
                </Typography>
              </Box>

              {/* 重启提示 */}
              {needsRestart && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <AlertTitle>{t("settings.restartRequired")}</AlertTitle>
                  {t("settings.restartMessage")}
                </Alert>
              )}

              <Grid container spacing={2}>
                {/* 硬件加速 (全局 GPU 开关) */}
                <Grid
                  size={{
                    xs: 12,
                    md: 6,
                  }}
                >
                  <Card variant="outlined" sx={{ height: "100%" }}>
                    <CardContent sx={{ p: 2, "&:last-child": { pb: 2 } }}>
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 1,
                        }}
                      >
                        <DisplaySettingsIcon sx={{ color: "info.main" }} />
                        <Typography variant="subtitle1" component="div">
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
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 0.5 }}
                      >
                        {t("settings.hardwareAccelerationDescription")}
                      </Typography>

                      {/* GPU 信息 */}
                      <Box
                        sx={{
                          mt: 1.5,
                          p: 1.25,
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
                          sx={{ display: "block", mb: 0.5 }}
                        >
                          {t("settings.gpuInfo")}
                        </Typography>
                        {gpuInfoLoading && (
                          <Typography variant="body2" color="text.secondary">
                            {t("settings.gpuInfoLoading")}
                          </Typography>
                        )}
                        {!gpuInfoLoading && !gpuInfo && (
                          <Typography variant="body2" color="text.secondary">
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
                                  <Typography
                                    variant="caption"
                                    component="span"
                                  >
                                    {gpuInfo.activeGpu.vendorId || "?"}/
                                    {gpuInfo.activeGpu.deviceId || "?"}
                                  </Typography>
                                </Box>
                              )}
                            <Box sx={{ mt: 0.5 }}>
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
                    </CardContent>
                  </Card>
                </Grid>

                {/* 图像支持 */}
                <Grid
                  size={{
                    xs: 12,
                    sm: 6,
                  }}
                >
                  <Card variant="outlined" sx={{ height: "100%" }}>
                    <CardContent>
                      <Box
                        sx={{ display: "flex", alignItems: "center", mb: 1 }}
                      >
                        <ImageIcon sx={{ mr: 1, color: "primary.main" }} />
                        <Typography variant="h6" component="div">
                          {t("settings.imageSupport")}
                        </Typography>
                        {needsRestart &&
                          imageSupported !==
                            originalPerformanceSettings.imageSupported && (
                            <Chip
                              label={t("settings.needsRestart")}
                              size="small"
                              color="warning"
                              sx={{ ml: 1 }}
                            />
                          )}
                      </Box>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={imageSupported}
                            onChange={(e) =>
                              handlePerformanceChange(
                                "imageSupported",
                                e.target.checked,
                              )
                            }
                            color="primary"
                          />
                        }
                        label={t("settings.enableImageSupport")}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t("settings.imageDescription")}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                {/* 智能缓存 */}
                <Grid
                  size={{
                    xs: 12,
                    sm: 6,
                  }}
                >
                  <Card variant="outlined" sx={{ height: "100%" }}>
                    <CardContent>
                      <Box
                        sx={{ display: "flex", alignItems: "center", mb: 1 }}
                      >
                        <MemoryIcon sx={{ mr: 1, color: "success.main" }} />
                        <Typography variant="h6" component="div">
                          {t("settings.smartCache")}
                        </Typography>
                        <Chip
                          label={t("settings.realTime")}
                          size="small"
                          color="success"
                          sx={{ ml: 1 }}
                        />
                      </Box>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={cacheEnabled}
                            onChange={(e) =>
                              handlePerformanceChange(
                                "cacheEnabled",
                                e.target.checked,
                              )
                            }
                            color="primary"
                          />
                        }
                        label={t("settings.enableCache")}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t("settings.cacheDescription")}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                {/* 智能预取 */}
                <Grid
                  size={{
                    xs: 12,
                    sm: 6,
                  }}
                >
                  <Card variant="outlined" sx={{ height: "100%" }}>
                    <CardContent>
                      <Box
                        sx={{ display: "flex", alignItems: "center", mb: 1 }}
                      >
                        <CachedIcon sx={{ mr: 1, color: "success.main" }} />
                        <Typography variant="h6" component="div">
                          {t("settings.smartPrefetch")}
                        </Typography>
                        <Chip
                          label={t("settings.realTime")}
                          size="small"
                          color="success"
                          sx={{ ml: 1 }}
                        />
                      </Box>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={prefetchEnabled}
                            onChange={(e) =>
                              handlePerformanceChange(
                                "prefetchEnabled",
                                e.target.checked,
                              )
                            }
                            color="primary"
                          />
                        }
                        label={t("settings.enablePrefetch")}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t("settings.prefetchDescription")}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 1.5, gap: 1 }}>
        <Button onClick={onClose} color="primary" variant="outlined">
          {t("settings.cancel")}
        </Button>
        <Button onClick={handleSave} color="primary" variant="contained">
          {t("settings.save")}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
});

Settings.displayName = "Settings";

export default Settings;
