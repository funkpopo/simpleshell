import React, { useMemo } from "react";
import {
  DialogTitle,
  IconButton,
  Box,
  Typography,
  Tooltip,
  Menu,
  MenuItem,
  Chip,
  Divider,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import MinimizeIcon from "@mui/icons-material/Minimize";
import SettingsIcon from "@mui/icons-material/Settings";
import DeleteIcon from "@mui/icons-material/Delete";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTranslation } from "react-i18next";
import AIIcon from "../AIIcon";
import { aiClassName } from "../lib/aiClassName.js";
import { Z_INDEX } from "../../../shared/constants/zIndex.js";

// AI 浮窗标题栏：标题与连接信息、模型切换 Chip + 菜单、清空/最小化/关闭。
export default function ChatHeader({
  sessionKey,
  connectionInfo,
  zIndex,
  currentApi,
  availableApis,
  apiMenuAnchor,
  onOpenApiMenu,
  onCloseApiMenu,
  onApiChange,
  onOpenSettingsFromMenu,
  onClearChat,
  onMinimize,
  onClose,
}) {
  const { t } = useTranslation();

  const modelChipLabel = useMemo(() => {
    if (!currentApi) {
      return t("ai.selectModel");
    }
    return currentApi.model || currentApi.name || t("ai.selectModel");
  }, [currentApi, t]);

  const apiMenuZIndex = (Number(zIndex) || Z_INDEX.modal) + Z_INDEX.popupOffset;
  const showModelChip = Boolean(currentApi) || availableApis.length > 0;

  return (
    <DialogTitle
      className={aiClassName("ai-chat-header")}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
      }}
    >
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
      >
        <Tooltip title={t("aiAssistant.minimize")}>
          <IconButton
            size="small"
            onClick={onMinimize}
            className={aiClassName("ai-chat-header-btn")}
            aria-label={t("aiAssistant.minimize")}
          >
            <AIIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            className={aiClassName("ai-chat-title")}
            variant="h6"
            noWrap
          >
            {t("ai.title")}
          </Typography>
          {connectionInfo && (
            <Typography
              data-ai-session={sessionKey}
              variant="caption"
              color="text.secondary"
              noWrap
              title={`${connectionInfo.type} · ${connectionInfo.host}`}
            >
              {`${connectionInfo.type} · ${connectionInfo.username ? `${connectionInfo.username}@` : ""}${connectionInfo.host}${connectionInfo.port ? `:${connectionInfo.port}` : ""}`}
            </Typography>
          )}
        </Box>
      </Box>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.35,
          flexShrink: 0,
        }}
      >
        {showModelChip && (
          <Tooltip title={t("ai.switchModel")}>
            <Chip
              label={
                <Box
                  component="span"
                  className={aiClassName("ai-chat-model-chip-content")}
                >
                  <Box
                    component="span"
                    className={aiClassName("ai-chat-model-chip-text")}
                  >
                    {modelChipLabel}
                  </Box>
                  <ExpandMoreIcon
                    className={aiClassName(
                      `ai-chat-model-chip-caret${
                        apiMenuAnchor ? " ai-chat-model-chip-caret-open" : ""
                      }`,
                    )}
                    aria-hidden
                  />
                </Box>
              }
              size="small"
              clickable
              onClick={onOpenApiMenu}
              onMouseDown={(event) => event.stopPropagation()}
              className={aiClassName("ai-chat-model-chip")}
              aria-label={t("ai.switchModel")}
              aria-haspopup="menu"
              aria-expanded={Boolean(apiMenuAnchor)}
            />
          </Tooltip>
        )}
        <Menu
          anchorEl={apiMenuAnchor}
          open={Boolean(apiMenuAnchor)}
          onClose={onCloseApiMenu}
          disableScrollLock
          // 浮动窗 z-index 为 1300/1310，菜单需更高才能显示在其上方
          sx={{ zIndex: apiMenuZIndex }}
          anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
          transformOrigin={{ vertical: "top", horizontal: "right" }}
          slotProps={{
            paper: {
              className: aiClassName("ai-chat-model-menu"),
              sx: {
                borderRadius: "var(--radius-md)",
                mt: 0.5,
                minWidth: 168,
                maxWidth: 280,
                overflow: "hidden",
              },
            },
          }}
        >
          {availableApis.length === 0 ? (
            <MenuItem disabled dense>
              {t("ai.noApiConfigured")}
            </MenuItem>
          ) : (
            availableApis.map((api) => {
              const itemLabel = api.model || api.name || t("ai.selectModel");
              const isSelected = currentApi?.id === api.id;
              return (
                <MenuItem
                  key={api.id}
                  onClick={() => onApiChange(api)}
                  selected={isSelected}
                  dense
                >
                  <Box
                    component="span"
                    sx={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      minWidth: 0,
                      width: "100%",
                    }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      sx={{
                        width: "100%",
                        fontWeight: isSelected ? 600 : 500,
                      }}
                    >
                      {itemLabel}
                    </Typography>
                    {api.provider ? (
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        noWrap
                        sx={{ width: "100%", lineHeight: 1.2 }}
                      >
                        {api.provider}
                      </Typography>
                    ) : null}
                  </Box>
                </MenuItem>
              );
            })
          )}
          <Divider />
          <MenuItem onClick={onOpenSettingsFromMenu} dense>
            <SettingsIcon fontSize="small" sx={{ mr: 1 }} />
            {t("ai.manageApis")}
          </MenuItem>
        </Menu>
        <Tooltip title={t("ai.clearChat")}>
          <IconButton
            size="small"
            onClick={onClearChat}
            className={aiClassName("ai-chat-header-btn")}
            aria-label={t("ai.clearChat")}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("aiAssistant.minimize")}>
          <IconButton
            size="small"
            onClick={onMinimize}
            className={aiClassName("ai-chat-header-btn")}
            aria-label={t("aiAssistant.minimize")}
          >
            <MinimizeIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("aiAssistant.close")}>
          <IconButton
            size="small"
            onClick={onClose}
            className={aiClassName("ai-chat-header-btn ai-chat-close-btn")}
            aria-label={t("aiAssistant.close")}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
    </DialogTitle>
  );
}
