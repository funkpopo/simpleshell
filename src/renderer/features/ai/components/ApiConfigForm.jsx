import React from "react";
import {
  TextField,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  CircularProgress,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTranslation } from "react-i18next";
import { hasConfiguredApiKey } from "../lib/aiKeyUtils.js";
import { PROVIDER_TYPES } from "../lib/aiSettingsModel.js";
import { Z_INDEX } from "../../../shared/constants/zIndex.js";

// API 配置编辑表单（编辑模式）：渠道、Base URL、密钥、模型（可拉取列表）、流式开关。
export default function ApiConfigForm({
  config,
  editingConfig,
  availableModels,
  fetchingModels,
  firstInputRef,
  onConfigChange,
  onFetchModels,
}) {
  const { t } = useTranslation();

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Box>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            mb: 2,
          }}
        >
          <Typography variant="h6">
            {editingConfig ? t("aiSettings.editApi") : t("aiSettings.addApi")}
          </Typography>
        </Box>
      </Box>
      <FormControl fullWidth variant="outlined">
        <InputLabel>{t("aiSettings.providerType")}</InputLabel>
        <Select
          value={config.provider}
          onChange={(e) => onConfigChange("provider", e.target.value)}
          label={t("aiSettings.providerType")}
          MenuProps={{
            sx: {
              zIndex: Z_INDEX.modalPopup,
            },
          }}
        >
          <MenuItem value={PROVIDER_TYPES.OPENAI}>OpenAI</MenuItem>
          <MenuItem value={PROVIDER_TYPES.ANTHROPIC}>Anthropic</MenuItem>
          <MenuItem value={PROVIDER_TYPES.GEMINI}>Gemini</MenuItem>
        </Select>
      </FormControl>
      <TextField
        inputRef={firstInputRef}
        label={t("aiSettings.apiUrl")}
        value={config.apiUrl}
        onChange={(e) => onConfigChange("apiUrl", e.target.value)}
        fullWidth
        placeholder={t("aiSettings.placeholders.baseUrl")}
        variant="outlined"
        required
        helperText={t("aiSettings.apiUrlHelp")}
      />
      <TextField
        label={t("aiSettings.apiKey")}
        value={config.apiKey}
        onChange={(e) => onConfigChange("apiKey", e.target.value)}
        fullWidth
        type="password"
        placeholder={t("aiSettings.placeholders.apiKey")}
        variant="outlined"
        required
        helperText={
          config.hasApiKey && !config.apiKey
            ? t("aiSettings.keyStoredInMain")
            : undefined
        }
      />
      <Box
        sx={{
          display: "flex",
          gap: 1,
          alignItems: "flex-start",
        }}
      >
        <FormControl fullWidth variant="outlined" required>
          <InputLabel id="ai-settings-model-label" shrink>
            {t("aiSettings.model")}
          </InputLabel>
          <Select
            labelId="ai-settings-model-label"
            value={config.model}
            onChange={(e) => onConfigChange("model", e.target.value)}
            label={t("aiSettings.model")}
            displayEmpty
            renderValue={(selected) =>
              selected || t("aiSettings.modelSelectPlaceholder")
            }
            sx={{
              "& .MuiSelect-select": {
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              },
            }}
            MenuProps={{
              sx: {
                zIndex: Z_INDEX.modalPopup,
              },
            }}
          >
            <MenuItem value="" disabled>
              {t("aiSettings.modelSelectPlaceholder")}
            </MenuItem>
            {availableModels.map((model) => (
              <MenuItem key={model} value={model}>
                {model}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title={t("aiSettings.fetchModels")}>
          <IconButton
            onClick={onFetchModels}
            disabled={
              fetchingModels ||
              !config.apiUrl.trim() ||
              !hasConfiguredApiKey(config)
            }
            sx={{ mt: 1 }}
            aria-label={t("aiSettings.fetchModels")}
          >
            {fetchingModels ? <CircularProgress size={20} /> : <RefreshIcon />}
          </IconButton>
        </Tooltip>
      </Box>
      <FormControlLabel
        control={
          <Switch
            checked={config.streamEnabled}
            onChange={(e) => onConfigChange("streamEnabled", e.target.checked)}
          />
        }
        label={t("aiSettings.streamEnabled")}
      />
    </Box>
  );
}
