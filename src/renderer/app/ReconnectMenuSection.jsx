import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import PauseCircleOutlinedIcon from "@mui/icons-material/PauseCircleOutlined";
import PlayCircleOutlinedIcon from "@mui/icons-material/PlayCircleOutlined";
import { useReconnectSelector } from "./state/AppContext.jsx";
import {
  buildReconnectStatusTitle,
  canPauseReconnectStatus,
  getReconnectStatusColor,
} from "../features/terminal/model/reconnectTabStatus.js";
import { getReconnectFailureReasonLabel } from "./appShellUtils.js";
import useReconnectCountdown from "./hooks/useReconnectCountdown.js";

export default function ReconnectMenuSection({
  tabId,
  open,
  onPause,
  onResume,
}) {
  const { t } = useTranslation();
  const contextMenuReconnectStatus = useReconnectSelector((state) =>
    open ? state.reconnectStateByTabId[tabId] : null,
  );
  const isReconnectActionPending = useReconnectSelector(
    (state) => open && state.reconnectActionTabId === tabId,
  );
  const reconnectNow = useReconnectCountdown(contextMenuReconnectStatus, open);
  const reconnectStatusTitle = buildReconnectStatusTitle(
    t,
    contextMenuReconnectStatus,
    reconnectNow,
  );
  const reconnectStatusColor = getReconnectStatusColor(
    contextMenuReconnectStatus?.state,
  );
  const reconnectFailureReasonLabel = getReconnectFailureReasonLabel(
    t,
    contextMenuReconnectStatus?.failureReason,
  );
  return (
    <>
      {contextMenuReconnectStatus && <Divider />}

      {contextMenuReconnectStatus && (
        <Box
          sx={{
            px: 2,
            py: 1.25,
            maxWidth: 320,
            WebkitAppRegion: "no-drag",
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              display: "block",
              mb: 0.75,
            }}
          >
            {t("tabMenu.reconnectStatus")}
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              mb: 0.75,
            }}
          >
            <Box
              sx={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: reconnectStatusColor || "text.disabled",
                flexShrink: 0,
              }}
            />
            <Typography variant="body2">{reconnectStatusTitle}</Typography>
          </Box>
          {Number.isFinite(Number(contextMenuReconnectStatus?.attempts)) &&
            Number.isFinite(Number(contextMenuReconnectStatus?.maxAttempts)) &&
            Number(contextMenuReconnectStatus?.maxAttempts) > 0 && (
              <Typography
                variant="caption"
                sx={{
                  color: "text.secondary",
                  display: "block",
                }}
              >
                {t("tabMenu.retryAttempts", {
                  attempts: Number(contextMenuReconnectStatus.attempts),
                  maxAttempts: Number(contextMenuReconnectStatus.maxAttempts),
                })}
              </Typography>
            )}
          {reconnectFailureReasonLabel && (
            <Typography
              variant="caption"
              sx={{
                color: "text.secondary",
                display: "block",
              }}
            >
              {t("tabMenu.failureReasonLabel", {
                reason: reconnectFailureReasonLabel,
              })}
            </Typography>
          )}
          {contextMenuReconnectStatus?.error && (
            <Typography
              variant="caption"
              sx={{
                color: "error.main",
                display: "block",
                mt: 0.75,
                wordBreak: "break-word",
              }}
            >
              {t("tabMenu.lastError", {
                error: contextMenuReconnectStatus.error,
              })}
            </Typography>
          )}
        </Box>
      )}

      {canPauseReconnectStatus(contextMenuReconnectStatus) && (
        <MenuItem onClick={onPause} disabled={isReconnectActionPending}>
          <PauseCircleOutlinedIcon
            fontSize="small"
            sx={{
              mr: 1,
            }}
          />
          {t("tabMenu.pauseReconnect")}
        </MenuItem>
      )}

      {contextMenuReconnectStatus?.state === "paused" && (
        <MenuItem onClick={onResume} disabled={isReconnectActionPending}>
          <PlayCircleOutlinedIcon
            fontSize="small"
            sx={{
              mr: 1,
            }}
          />
          {t("tabMenu.resumeReconnect")}
        </MenuItem>
      )}
    </>
  );
}
