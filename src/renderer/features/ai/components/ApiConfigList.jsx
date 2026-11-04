import React from "react";
import {
  Button,
  Box,
  Typography,
  IconButton,
  Chip,
  Tooltip,
  Card,
  CardContent,
  CardActions,
} from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import { useTranslation } from "react-i18next";

// API 配置列表（列表模式）：新增入口、当前配置标记、设为当前 / 编辑 / 删除。
export default function ApiConfigList({
  apiConfigs,
  currentApiId,
  onAddApi,
  onSetCurrent,
  onEditApi,
  onDeleteApi,
}) {
  const { t } = useTranslation();

  return (
    <Box>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6">{t("aiSettings.apiList")}</Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={onAddApi}
          size="small"
          data-testid="add-api-button"
        >
          {t("aiSettings.addApi")}
        </Button>
      </Box>
      {apiConfigs.length === 0 ? (
        <Box sx={{ textAlign: "center", py: 4 }}>
          <Typography color="text.secondary">
            {t("aiSettings.noApiConfigs")}
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {apiConfigs.map((apiConfig) => (
            <Card key={apiConfig.id} variant="outlined">
              <CardContent sx={{ pb: 1 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <Box sx={{ flex: 1 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 1,
                      }}
                    >
                      <Typography
                        sx={{ fontWeight: "medium" }}
                        variant="subtitle1"
                      >
                        {apiConfig.model || apiConfig.name}
                      </Typography>
                      {currentApiId === apiConfig.id && (
                        <Chip
                          label={t("aiSettings.currentApi")}
                          size="small"
                          color="primary"
                          icon={<CheckCircleIcon />}
                        />
                      )}
                    </Box>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ mb: 0.5 }}
                    >
                      {t("aiSettings.providerType")}:{" "}
                      {(apiConfig.provider || "openai").toUpperCase()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t("aiSettings.apiUrl")}: {apiConfig.apiUrl}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
              <CardActions sx={{ pt: 0, justifyContent: "flex-end" }}>
                <Box>
                  {currentApiId !== apiConfig.id && (
                    <Button
                      size="small"
                      onClick={() => onSetCurrent(apiConfig.id)}
                      sx={{ mr: 1 }}
                    >
                      {t("aiSettings.setAsCurrent")}
                    </Button>
                  )}
                  <Tooltip title={t("aiSettings.editApi")}>
                    <IconButton
                      size="small"
                      onClick={() => onEditApi(apiConfig)}
                      aria-label={t("aiSettings.editApi")}
                    >
                      <EditIcon />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t("aiSettings.deleteApi")}>
                    <IconButton
                      size="small"
                      onClick={() => onDeleteApi(apiConfig.id)}
                      color="error"
                      aria-label={t("aiSettings.deleteApi")}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Tooltip>
                </Box>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}
