import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Slider,
  Alert,
  CircularProgress,
  IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";

const AISettings = ({ open, onClose }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  // AI配置状态
  const [config, setConfig] = useState({
    apiUrl: "",
    apiKey: "",
    model: "",
    maxTokens: 2000,
    temperature: 0.7,
    streamEnabled: true,
  });

  // 加载AI设置
  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    setLoading(true);
    setError("");
    try {
      if (window.terminalAPI?.loadAISettings) {
        const settings = await window.terminalAPI.loadAISettings();
        if (settings && settings.current) {
          setConfig({
            apiUrl: settings.current.apiUrl || "",
            apiKey: settings.current.apiKey || "",
            model: settings.current.model || "",
            maxTokens: settings.current.maxTokens || 2000,
            temperature: settings.current.temperature || 0.7,
            streamEnabled: settings.current.streamEnabled !== false,
          });
        }
      }
    } catch (err) {
      setError(t("aiSettings.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleConfigChange = (field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
    setError("");
    setSuccess("");
  };

  const validateConfig = () => {
    if (!config.apiUrl.trim()) {
      setError(t("aiSettings.apiUrlRequired"));
      return false;
    }
    if (!config.apiKey.trim()) {
      setError(t("aiSettings.apiKeyRequired"));
      return false;
    }
    if (!config.model.trim()) {
      setError(t("aiSettings.modelRequired"));
      return false;
    }
    
    // 验证URL格式
    try {
      new URL(config.apiUrl);
    } catch {
      setError(t("aiSettings.invalidUrl"));
      return false;
    }
    
    // 验证温度范围
    if (config.temperature < 0 || config.temperature > 2) {
      setError(t("aiSettings.temperatureRange"));
      return false;
    }
    
    // 验证最大令牌数范围
    if (config.maxTokens < 1 || config.maxTokens > 32000) {
      setError(t("aiSettings.maxTokensRange"));
      return false;
    }
    
    return true;
  };

  const handleSave = async () => {
    if (!validateConfig()) return;
    
    setLoading(true);
    setError("");
    try {
      if (window.terminalAPI?.saveAISettings) {
        const settings = {
          current: config,
          configs: [{ ...config, id: Date.now().toString(), name: "Default" }]
        };
        
        const result = await window.terminalAPI.saveAISettings(settings);
        if (result) {
          setSuccess(t("aiSettings.configSaved"));
          setTimeout(() => {
            onClose();
          }, 1500);
        } else {
          setError(t("aiSettings.configSaveFailed"));
        }
      }
    } catch (err) {
      setError(t("aiSettings.configSaveFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleTest = async () => {
    if (!validateConfig()) return;
    
    setTesting(true);
    setError("");
    setSuccess("");
    
    try {
      if (window.terminalAPI?.sendAPIRequest) {
        const requestData = {
          url: config.apiUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages: [{ role: "user", content: "Hello" }]
        };
        
        const result = await window.terminalAPI.sendAPIRequest(requestData, false);
        if (result && !result.error) {
          setSuccess(t("aiSettings.testSuccess"));
        } else {
          setError(t("aiSettings.testFailed") + ": " + (result?.error || "Unknown error"));
        }
      }
    } catch (err) {
      setError(t("aiSettings.testFailed") + ": " + err.message);
    } finally {
      setTesting(false);
    }
  };

  const handleClose = () => {
    setError("");
    setSuccess("");
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          backdropFilter: "blur(10px)",
        }
      }}
    >
      <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="h6">{t("aiSettings.title")}</Typography>
        <IconButton onClick={handleClose} size="small">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      
      <DialogContent dividers>
        {loading && (
          <Box display="flex" justifyContent="center" p={2}>
            <CircularProgress />
          </Box>
        )}
        
        {!loading && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {success && <Alert severity="success">{success}</Alert>}
            
            <TextField
              label={t("aiSettings.apiUrl")}
              value={config.apiUrl}
              onChange={(e) => handleConfigChange("apiUrl", e.target.value)}
              fullWidth
              placeholder="https://api.openai.com/v1/chat/completions"
              variant="outlined"
            />
            
            <TextField
              label={t("aiSettings.apiKey")}
              value={config.apiKey}
              onChange={(e) => handleConfigChange("apiKey", e.target.value)}
              fullWidth
              type="password"
              placeholder="sk-..."
              variant="outlined"
            />
            
            <TextField
              label={t("aiSettings.model")}
              value={config.model}
              onChange={(e) => handleConfigChange("model", e.target.value)}
              fullWidth
              placeholder="gpt-3.5-turbo"
              variant="outlined"
            />
            
            <Box>
              <Typography gutterBottom>{t("aiSettings.maxTokens")}: {config.maxTokens}</Typography>
              <Slider
                value={config.maxTokens}
                onChange={(e, value) => handleConfigChange("maxTokens", value)}
                min={100}
                max={32000}
                step={100}
                marks={[
                  { value: 1000, label: "1000" },
                  { value: 4000, label: "4000" },
                  { value: 8000, label: "8000" },
                  { value: 12000, label: "12000" },
                  { value: 16000, label: "16000" },
                  { value: 32000, label: "32000" },
                ]}
              />
            </Box>
            
            <Box>
              <Typography gutterBottom>{t("aiSettings.temperature")}: {config.temperature}</Typography>
              <Slider
                value={config.temperature}
                onChange={(e, value) => handleConfigChange("temperature", value)}
                min={0}
                max={2}
                step={0.1}
                marks={[
                  { value: 0, label: "0" },
                  { value: 0.5, label: "0.5" },
                  { value: 0.7, label: "0.7" },
                  { value: 1, label: "1" },
                  { value: 2, label: "2" },
                ]}
              />
            </Box>
            
            <FormControlLabel
              control={
                <Switch
                  checked={config.streamEnabled}
                  onChange={(e) => handleConfigChange("streamEnabled", e.target.checked)}
                />
              }
              label={t("aiSettings.streamEnabled")}
            />
          </Box>
        )}
      </DialogContent>
      
      <DialogActions sx={{ p: 2, gap: 1 }}>
        <Button onClick={handleTest} disabled={loading || testing} variant="outlined">
          {testing ? t("aiSettings.testing") : t("aiSettings.test")}
        </Button>
        <Button onClick={handleClose} disabled={loading}>
          {t("aiSettings.cancel")}
        </Button>
        <Button onClick={handleSave} disabled={loading} variant="contained">
          {t("aiSettings.save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default AISettings;
