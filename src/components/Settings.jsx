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
  // Define available languages
  const languages = [
    { code: "zh-CN", name: "简体中文" },
    { code: "en-US", name: "English" },
  ];

  // Define font size options
  const fontSizes = [
    { value: 12, label: "小" },
    { value: 14, label: "中" },
    { value: 16, label: "大" },
    { value: 18, label: "特大" },
  ];

  // Initial states
  const [language, setLanguage] = React.useState("zh-CN");
  const [fontSize, setFontSize] = React.useState(14);
  const [isLoading, setIsLoading] = React.useState(true);

  // Load settings from config.json via API
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          if (settings) {
            setLanguage(settings.language || "zh-CN");
            setFontSize(settings.fontSize || 14);
          }
        }
      } catch (error) {
        console.error("Failed to load UI settings:", error);
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

  // Save settings
  const handleSave = async () => {
    try {
      // Save to config.json via API
      if (window.terminalAPI?.saveUISettings) {
        const settings = { language, fontSize };
        await window.terminalAPI.saveUISettings(settings);
      }

      // Notify app to apply changes
      window.dispatchEvent(
        new CustomEvent("settingsChanged", {
          detail: { language, fontSize },
        })
      );

      onClose();
    } catch (error) {
      console.error("Failed to save UI settings:", error);
      alert("保存设置失败，请重试。");
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      aria-labelledby="settings-dialog-title"
      maxWidth="sm"
      fullWidth
    >
      <BootstrapDialogTitle id="settings-dialog-title" onClose={onClose}>
        设置
      </BootstrapDialogTitle>
      <DialogContent dividers>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle1" gutterBottom>
            语言设置
          </Typography>
          <FormControl fullWidth variant="outlined" size="small">
            <InputLabel id="language-select-label">界面语言</InputLabel>
            <Select
              labelId="language-select-label"
              id="language-select"
              value={language}
              onChange={handleLanguageChange}
              label="界面语言"
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

        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" gutterBottom>
            界面字号
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="primary">
          取消
        </Button>
        <Button onClick={handleSave} color="primary" variant="contained">
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default Settings; 