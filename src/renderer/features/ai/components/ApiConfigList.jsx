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
          mb: 1.5,
        }}
      >
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {t("aiSettings.apiList")}
        </Typography>
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
        <Box
          sx={{
            textAlign: "center",
            py: 4,
            borderRadius: "var(--radius-md, 6px)",
            border: "1px dashed",
            borderColor: "divider",
            bgcolor: "background.default",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            {t("aiSettings.noApiConfigs")}
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          {apiConfigs.map((apiConfig) => (
            <Card
              key={apiConfig.id}
              variant="outlined"
              sx={{
                borderRadius: "var(--radius-md, 6px)",
                borderColor:
                  currentApiId === apiConfig.id ? "primary.main" : "divider",
                bgcolor: "background.default",
                transition: "border-color 160ms cubic-bezier(0.2, 0, 0, 1)",
              }}
            >
              <CardContent sx={{ p: 1.5, pb: 1 }}>
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        mb: 0.75,
                      }}
                    >
                      <Typography sx={{ fontWeight: 600 }} variant="subtitle2">
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
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", mb: 0.25 }}
                    >
                      {t("aiSettings.providerType")}:{" "}
                      {(apiConfig.provider || "openai").toUpperCase()}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: "block", wordBreak: "break-all" }}
                    >
                      {t("aiSettings.apiUrl")}: {apiConfig.apiUrl}
                    </Typography>
                  </Box>
                </Box>
              </CardContent>
              <CardActions
                sx={{
                  px: 1.5,
                  pt: 0,
                  pb: 1,
                  justifyContent: "flex-end",
                  gap: 0.5,
                }}
              >
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
