import * as React from "react";
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
import { useTranslation } from "react-i18next";
import { changeLanguage } from "../i18n/i18n";

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
const BootstrapDialogTitle = (props) => {
  const { children, onClose, ...other } = props;

  return (
    <DialogTitle sx={{ m: 0, p: 2 }} {...other}>
      {children}
      {onClose ? (
        <IconButton
          aria-label="close"
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
};

const Settings = ({ open, onClose }) => {
  const { t, i18n } = useTranslation();

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

  // Define log level options
  const logLevels = [
    { value: "DEBUG", label: "DEBUG" },
    { value: "INFO", label: "INFO" },
    { value: "WARN", label: "WARN" },
    { value: "ERROR", label: "ERROR" },
  ];

  // Initial states
  const [language, setLanguage] = React.useState("");
  const [fontSize, setFontSize] = React.useState(14);
  const [darkMode, setDarkMode] = React.useState(true);
  const [logLevel, setLogLevel] = React.useState("WARN");
  const [maxFileSize, setMaxFileSize] = React.useState(5);
  const [isLoading, setIsLoading] = React.useState(true);

  // Load settings from config.json via API
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        setIsLoading(true);

        // 加载UI设置
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          if (settings) {
            setLanguage(settings.language || "zh-CN");
            setFontSize(settings.fontSize || 14);
            setDarkMode(
              settings.darkMode !== undefined ? settings.darkMode : true,
            );
          }
        }

        // 加载日志设置
        if (window.terminalAPI?.loadLogSettings) {
          const logSettings = await window.terminalAPI.loadLogSettings();
          if (logSettings) {
            setLogLevel(logSettings.level || "WARN");
            // 将字节转换为MB
            setMaxFileSize(
              logSettings.maxFileSize
                ? Math.round(logSettings.maxFileSize / (1024 * 1024))
                : 5,
            );
          }
        }
      } catch (error) {
        console.error("Failed to load settings:", error);
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

  // Save settings
  const handleSave = async () => {
    try {
      // 保存UI设置
      if (window.terminalAPI?.saveUISettings) {
        const settings = { language, fontSize, darkMode };
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
          detail: { language, fontSize, darkMode },
        }),
      );

      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
      alert(t("settings.saveError"));
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

          <Box>
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
        </Box>
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
};

export default Settings;
