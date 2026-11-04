import React from "react";
import {
  TextField,
  Button,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  Chip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ProxyIcon from "@mui/icons-material/SettingsEthernet";
import SaveIcon from "@mui/icons-material/Save";
import { useTranslation } from "react-i18next";
import { Z_INDEX } from "../../../shared/constants/zIndex.js";

// AI 请求代理配置（可展开面板）：启用开关、类型/主机/端口、认证与保存。
export default function AIProxySettingsPanel({
  proxyConfig,
  proxySaving,
  proxyExpanded,
  setProxyExpanded,
  onProxyChange,
  onSaveProxy,
}) {
  const { t } = useTranslation();

  return (
    <Accordion
      expanded={proxyExpanded}
      onChange={(event, expanded) => setProxyExpanded(expanded)}
      variant="outlined"
    >
      <AccordionSummary
        expandIcon={<ExpandMoreIcon />}
        sx={{
          "& .MuiAccordionSummary-content": {
            alignItems: "center",
            gap: 1.5,
          },
        }}
      >
        <ProxyIcon fontSize="small" color="primary" />
        <Typography variant="subtitle1" fontWeight="medium">
          {t("aiSettings.proxyConfig")}
        </Typography>
        <Chip
          label={
            proxyConfig.enabled
              ? t("aiSettings.proxyEnabled")
              : t("aiSettings.proxyDisabled")
          }
          size="small"
          color={proxyConfig.enabled ? "primary" : "default"}
          variant={proxyConfig.enabled ? "filled" : "outlined"}
        />
      </AccordionSummary>
      <AccordionDetails>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("aiSettings.proxyConfigHelp")}
        </Typography>
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <FormControlLabel
            control={
              <Switch
                checked={proxyConfig.enabled}
                onChange={(e) => onProxyChange("enabled", e.target.checked)}
              />
            }
            label={t("aiSettings.proxyEnable")}
          />
          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl sx={{ minWidth: 150 }} variant="outlined">
              <InputLabel>{t("aiSettings.proxyType")}</InputLabel>
              <Select
                value={proxyConfig.type}
                onChange={(e) => onProxyChange("type", e.target.value)}
                label={t("aiSettings.proxyType")}
                disabled={!proxyConfig.enabled}
                MenuProps={{
                  sx: {
                    zIndex: Z_INDEX.modalPopup,
                  },
                }}
              >
                <MenuItem value="http">HTTP</MenuItem>
                <MenuItem value="https">HTTPS</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label={t("aiSettings.proxyHost")}
              value={proxyConfig.host}
              onChange={(e) => onProxyChange("host", e.target.value)}
              disabled={!proxyConfig.enabled}
              fullWidth
              placeholder="127.0.0.1"
              variant="outlined"
            />
            <TextField
              label={t("aiSettings.proxyPort")}
              value={proxyConfig.port}
              onChange={(e) => onProxyChange("port", e.target.value)}
              disabled={!proxyConfig.enabled}
              sx={{ width: 140 }}
              placeholder="7890"
              variant="outlined"
              inputProps={{ inputMode: "numeric" }}
            />
          </Box>
          <Box sx={{ display: "flex", gap: 2 }}>
            <TextField
              label={t("aiSettings.proxyUsername")}
              value={proxyConfig.username}
              onChange={(e) => onProxyChange("username", e.target.value)}
              disabled={!proxyConfig.enabled}
              fullWidth
              variant="outlined"
            />
            <TextField
              label={t("aiSettings.proxyPassword")}
              value={proxyConfig.password}
              onChange={(e) => onProxyChange("password", e.target.value)}
              disabled={!proxyConfig.enabled}
              fullWidth
              type="password"
              variant="outlined"
              helperText={
                proxyConfig.hasProxyPassword && !proxyConfig.password
                  ? t("aiSettings.keyStoredInMain")
                  : undefined
              }
            />
          </Box>
          <Box
            sx={{
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              variant="contained"
              startIcon={<SaveIcon />}
              onClick={onSaveProxy}
              disabled={proxySaving}
            >
              {proxySaving
                ? t("aiSettings.proxySaving")
                : t("aiSettings.proxySave")}
            </Button>
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}
