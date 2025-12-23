import * as React from "react";
import { memo } from "react";
import { styled } from "@mui/material/styles";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
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
import BoltIcon from "@mui/icons-material/Bolt";
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
  },
}));

// Custom styled dialog title
const BootstrapDialogTitle = memo((props) => {
  const { t } = useTranslation();
  const { children, onClose, ...other } = props;

  return (
    <DialogTitle sx={{ m: 0, p: 2 }} {...other}>
      {children}
      {onClose ? (
        <IconButton
          aria-label={t("about.close")}
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

  const terminalFontLabelMap = {
    "Fira Code": t("settings.fonts.fira-code"),
    "Space Mono": t("settings.fonts.space-mono"),
    Consolas: t("settings.fonts.consolas"),
  };

  const terminalFontDescriptionMap = {
    "Fira Code": t("settings.terminalFonts.firaCodeDescription"),
    "Space Mono": t("settings.terminalFonts.spaceMonoDescription"),
    Consolas: t("settings.terminalFonts.consolasDescription"),
  };

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
  const [darkMode, setDarkMode] = React.useState(true);
  const [externalEditorEnabled, setExternalEditorEnabled] = React.useState(false);
  const [externalEditorCommand, setExternalEditorCommand] = React.useState("");
  const [logLevel, setLogLevel] = React.useState("WARN");
  const [maxFileSize, setMaxFileSize] = React.useState(5);
  const [cleanupIntervalDays, setCleanupIntervalDays] = React.useState(7);
  const [isLoading, setIsLoading] = React.useState(true);

  // 性能设置状态
  const [imageSupported, setImageSupported] = React.useState(true);
  const [cacheEnabled, setCacheEnabled] = React.useState(true);
  const [prefetchEnabled, setPrefetchEnabled] = React.useState(true);
  const [terminalWebglEnabled, setTerminalWebglEnabled] = React.useState(true);

  // DnD settings
  const [dndEnabled, setDndEnabled] = React.useState(true);
  const [dndAutoScroll, setDndAutoScroll] = React.useState(true);
  const [dndCompactPreview, setDndCompactPreview] = React.useState(false);

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
            };
            // DnD settings
            const dnd = settings.dnd || {};
            setDndEnabled(dnd.enabled !== false);
            setDndAutoScroll(dnd.autoScroll !== false);
            setDndCompactPreview(dnd.compactDragPreview === true);

            // 传输栏显示模式
            setTransferBarMode(settings.transferBarMode || "bottom");

            setImageSupported(performanceSettings.imageSupported !== false);
            setCacheEnabled(performanceSettings.cacheEnabled !== false);
            setPrefetchEnabled(performanceSettings.prefetchEnabled !== false);
            setTerminalWebglEnabled(performanceSettings.webglEnabled !== false);

            // 保存原始设置用于比较
            setOriginalPerformanceSettings(performanceSettings);
          }
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
      } catch (error) {
      } finally {
        setIsLoading(false);
      }
    };

    if (open) {
      loadSettings();
    }
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

  // Handle cleanup interval days change
  const handleCleanupIntervalDaysChange = (event) => {
    const value = event.target.value;
    // 确保输入的是数字，且大于0
    if (!isNaN(value) && Number(value) > 0) {
      setCleanupIntervalDays(Number(value));
    }
  };

  // 检查性能设置是否需要重启
  const checkIfRestartNeeded = (newSettings) => {
    const current = {
      imageSupported,
      cacheEnabled,
      prefetchEnabled,
      webglEnabled: terminalWebglEnabled,
      ...newSettings,
    };

    // 图像支持的变更需要重启
    const needsRestartForImage =
      current.imageSupported !== originalPerformanceSettings.imageSupported;

    return needsRestartForImage;
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
        if (window.terminalAPI?.updateCacheSettings) {
          window.terminalAPI.updateCacheSettings({ enabled: value });
        }
        break;
      case "prefetchEnabled":
        setPrefetchEnabled(value);
        // 预取设置可以实时生效
        if (window.terminalAPI?.updatePrefetchSettings) {
          window.terminalAPI.updatePrefetchSettings({ enabled: value });
        }
        break;
      case "webglEnabled":
        setTerminalWebglEnabled(value);
        break;
    }

    // 检查是否需要重启
    setNeedsRestart(checkIfRestartNeeded(newSettings));
  };

  // Save settings
  const handleSave = async () => {
    try {
      // 保存UI设置
      if (window.terminalAPI?.saveUISettings) {
        const settings = {
          language,
          fontSize,
          editorFont: "system", // 保持editorFont字段
          terminalFont,
          terminalFontSize,
          terminalFontWeight,
          darkMode,
          performance: {
            imageSupported,
            cacheEnabled,
            prefetchEnabled,
            webglEnabled: terminalWebglEnabled,
          },
          dnd: {
            enabled: dndEnabled,
            autoScroll: dndAutoScroll,
            compactDragPreview: dndCompactPreview,
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
            darkMode,
            performance: {
              imageSupported,
              cacheEnabled,
              prefetchEnabled,
              webglEnabled: terminalWebglEnabled,
            },
            dnd: {
              enabled: dndEnabled,
              autoScroll: dndAutoScroll,
              compactDragPreview: dndCompactPreview,
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
      showError(t("settings.saveError"));
    }
  };

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      aria-labelledby="settings-dialog-title"
      maxWidth="sm"
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
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t("settings.language")}
              </Typography>
              <FormControl fullWidth variant="outlined" size="small">
                <InputLabel id="language-select-label">
                  {t("settings.language")}
                </InputLabel>
                <Select
                  labelId="language-select-label"
                  id="language-select"
                  value={language}
                  onChange={handleLanguageChange}
                  label={t("settings.language")}
                >
                  {languages.map((lang) => (
                    <MenuItem key={lang.code} value={lang.code}>
                      {lang.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t("settings.dnd.title")}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={dndEnabled}
                    onChange={(e) => setDndEnabled(e.target.checked)}
                  />
                }
                label={t("settings.dnd.enable")}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={dndAutoScroll}
                    onChange={(e) => setDndAutoScroll(e.target.checked)}
                    disabled={!dndEnabled}
                  />
                }
                label={t("settings.dnd.autoScroll")}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={dndCompactPreview}
                    onChange={(e) => setDndCompactPreview(e.target.checked)}
                    disabled={!dndEnabled}
                  />
                }
                label={t("settings.dnd.compactPreview")}
              />
            </Box>

            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                文件传输显示
              </Typography>
              <FormControl fullWidth variant="outlined" size="small">
                <InputLabel id="transfer-bar-mode-label">显示模式</InputLabel>
                <Select
                  labelId="transfer-bar-mode-label"
                  id="transfer-bar-mode-select"
                  value={transferBarMode}
                  onChange={(e) => setTransferBarMode(e.target.value)}
                  label="显示模式"
                >
                  <MenuItem value="bottom">底部栏模式</MenuItem>
                  <MenuItem value="sidebar">侧边栏模式</MenuItem>
                </Select>
              </FormControl>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                {transferBarMode === "bottom"
                  ? "在应用底部显示传输进度条"
                  : "通过侧边栏按钮查看传输状态，按钮带有进度环显示"}
              </Typography>
            </Box>

            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t("settings.externalEditor.title")}
              </Typography>
              <FormControlLabel
                control={
                  <Switch
                    checked={externalEditorEnabled}
                    onChange={(e) =>
                      setExternalEditorEnabled(e.target.checked)
                    }
                  />
                }
                label={t("settings.externalEditor.enable")}
              />
              <TextField
                fullWidth
                size="small"
                label={t("settings.externalEditor.commandLabel")}
                placeholder={t("settings.externalEditor.commandPlaceholder")}
                value={externalEditorCommand}
                onChange={(e) => setExternalEditorCommand(e.target.value)}
                helperText={t("settings.externalEditor.commandHelper")}
                disabled={!externalEditorEnabled}
              />
            </Box>


            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t("settings.theme")}
              </Typography>
              <FormControl fullWidth variant="outlined" size="small">
                <InputLabel id="theme-select-label">
                  {t("settings.theme")}
                </InputLabel>
                <Select
                  labelId="theme-select-label"
                  id="theme-select"
                  value={darkMode ? "dark" : "light"}
                  onChange={handleDarkModeChange}
                  label={t("settings.theme")}
                >
                  <MenuItem value="light">{t("settings.themeLight")}</MenuItem>
                  <MenuItem value="dark">{t("settings.themeDark")}</MenuItem>
                </Select>
              </FormControl>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t("settings.fontSize")}
              </Typography>
              <Box sx={{ px: 2, pt: 1 }}>
                <Slider
                  value={fontSize}
                  onChange={handleFontSizeChange}
                  aria-labelledby="font-size-slider"
                  step={null}
                  marks={fontSizes.map((size) => ({
                    value: size.value,
                    label: size.label,
                  }))}
                  min={12}
                  max={18}
                />
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {"终端字体设置"}
              </Typography>

              <Box sx={{ mb: 2 }}>
                <FormControl fullWidth variant="outlined" size="small">
                  <InputLabel id="terminal-font-select-label">
                    {"终端字体族"}
                  </InputLabel>
                  <Select
                    labelId="terminal-font-select-label"
                    id="terminal-font-select"
                    value={terminalFont}
                    onChange={handleTerminalFontChange}
                    label={"终端字体族"}
                  >
                    {terminalFonts.map((font) => (
                      <MenuItem key={font.value} value={font.value}>
                        <Box>
                          <Typography
                            component="span"
                            style={{ fontFamily: font.value }}
                            sx={{ display: "block" }}
                          >
                            {font.label}
                          </Typography>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            {font.description}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" gutterBottom>
                  {"终端字体大小"}
                </Typography>
                <Box sx={{ px: 2, pt: 1 }}>
                  <Slider
                    value={terminalFontSize}
                    onChange={handleTerminalFontSizeChange}
                    aria-labelledby="terminal-font-size-slider"
                    step={null}
                    marks={fontSizes.map((size) => ({
                      value: size.value,
                      label: size.label,
                    }))}
                    min={12}
                    max={18}
                  />
                </Box>
              </Box>

              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" gutterBottom>
                  {"终端字体粗细"}
                </Typography>
                <Box sx={{ px: 2, pt: 1, display: "flex", alignItems: "center", gap: 2 }}>
                  <Slider
                    value={terminalFontWeight}
                    onChange={handleTerminalFontWeightChange}
                    aria-labelledby="terminal-font-weight-slider"
                    min={300}
                    max={1000}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    value={terminalFontWeight}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setTerminalFontWeight(val);
                      }
                    }}
                    onBlur={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (isNaN(val) || val < 300) {
                        setTerminalFontWeight(300);
                      } else if (val > 1000) {
                        setTerminalFontWeight(1000);
                      }
                    }}
                    size="small"
                    type="number"
                    inputProps={{ min: 300, max: 1000 }}
                    sx={{ width: 80 }}
                  />
                </Box>
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" gutterBottom>
                {t("settings.logSettingsTitle")}
              </Typography>

              <Box sx={{ mb: 2 }}>
                <FormControl fullWidth variant="outlined" size="small">
                  <InputLabel id="log-level-select-label">
                    {t("settings.logLevelLabel")}
                  </InputLabel>
                  <Select
                    labelId="log-level-select-label"
                    id="log-level-select"
                    value={logLevel}
                    onChange={handleLogLevelChange}
                    label={t("settings.logLevelLabel")}
                  >
                    {logLevels.map((level) => (
                      <MenuItem key={level.value} value={level.value}>
                        {level.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ mb: 2 }}>
                <TextField
                  fullWidth
                  label={t("settings.logFileSizeLimitLabel")}
                  variant="outlined"
                  size="small"
                  type="number"
                  value={maxFileSize}
                  onChange={handleMaxFileSizeChange}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">MB</InputAdornment>
                    ),
                  }}
                  inputProps={{
                    min: 1,
                    step: 1,
                  }}
                />
              </Box>

              <Box>
                <TextField
                  fullWidth
                  label={t("settings.logCleanupIntervalLabel")}
                  variant="outlined"
                  size="small"
                  type="number"
                  value={cleanupIntervalDays}
                  onChange={handleCleanupIntervalDaysChange}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">{t("settings.days")}</InputAdornment>
                    ),
                  }}
                  inputProps={{
                    min: 1,
                    step: 1,
                  }}
                  helperText={t("settings.logCleanupIntervalHelper")}
                />
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* 性能设置 */}
            <Box sx={{ mb: 3 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <TuneIcon sx={{ mr: 1, color: "primary.main" }} />
                <Typography variant="subtitle1">
                  {t("settings.performanceSettings", "性能设置")}
                </Typography>
              </Box>

              {/* 重启提示 */}
              {needsRestart && (
                <Alert severity="warning" sx={{ mb: 2 }}>
                  <AlertTitle>
                    {t("settings.restartRequired", "需要重启")}
                  </AlertTitle>
                  {t(
                    "settings.restartMessage",
                    "某些性能设置需要重启应用程序才能生效。保存设置后请重启应用。",
                  )}
                </Alert>
              )}

              <Grid container spacing={2}>
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
                          {t("settings.imageSupport", "图像支持")}
                        </Typography>
                        {needsRestart &&
                          imageSupported !==
                            originalPerformanceSettings.imageSupported && (
                            <Chip
                              label={t("settings.needsRestart", "需重启")}
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
                        label={t("settings.enableImageSupport", "启用图像支持")}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t(
                          "settings.imageDescription",
                          "支持在终端中显示Sixel和iTerm图像协议",
                        )}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

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
                        <BoltIcon sx={{ mr: 1, color: "warning.main" }} />
                        <Typography variant="h6" component="div">
                          {t("settings.webglRenderer", "WebGL 渲染")}
                        </Typography>
                        <Chip
                          label={t("settings.realTime", "实时生效")}
                          size="small"
                          color="success"
                          sx={{ ml: 1 }}
                        />
                      </Box>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={terminalWebglEnabled}
                            onChange={(e) =>
                              handlePerformanceChange(
                                "webglEnabled",
                                e.target.checked,
                              )
                            }
                            color="primary"
                          />
                        }
                        label={t(
                          "settings.enableWebglRenderer",
                          "启用 WebGL 渲染器",
                        )}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t(
                          "settings.webglDescription",
                          "使用 GPU 加速的渲染器提升长文本滚动性能",
                        )}
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
                          {t("settings.smartCache", "智能缓存")}
                        </Typography>
                        <Chip
                          label={t("settings.realTime", "实时生效")}
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
                        label={t("settings.enableCache", "启用多级缓存")}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t(
                          "settings.cacheDescription",
                          "L1/L2缓存提升文件列表加载速度40-60%",
                        )}
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
                          {t("settings.smartPrefetch", "智能预取")}
                        </Typography>
                        <Chip
                          label={t("settings.realTime", "实时生效")}
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
                        label={t("settings.enablePrefetch", "启用预测性预取")}
                      />
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mt: 1 }}
                      >
                        {t(
                          "settings.prefetchDescription",
                          "基于访问模式智能预加载数据，减少等待时间",
                        )}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">
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
