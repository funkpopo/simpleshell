import { Z_INDEX } from "../../../shared/constants/zIndex.js";
import React, { useEffect, useState } from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { buildReconnectBadgeTooltip } from "../model/reconnectTabStatus.js";

export default function WebTerminalConnectionNotice({
  status,
  inputBlocked,
  onRetry,
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (status?.state !== "pending") return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [status]);

  if (!status && !inputBlocked) return null;
  const canRetry =
    !status || ["failed", "abandoned", "paused"].includes(status.state);
  return (
    <Box
      role="status"
      sx={{
        position: "absolute",
        right: 12,
        bottom: 12,
        zIndex: Z_INDEX.terminalNotice,
        display: "flex",
        alignItems: "center",
        gap: 1.25,
        px: 1.5,
        py: 0.875,
        borderRadius: 1,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        boxShadow: 2,
        maxWidth: "min(420px, calc(100% - 24px))",
        animation: "ss-notice-in 180ms cubic-bezier(0.2, 0, 0, 1)",
        "@keyframes ss-notice-in": {
          from: { opacity: 0, transform: "translateY(6px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "@media (prefers-reduced-motion: reduce)": {
          animation: "none",
        },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" component="div">
          {buildReconnectBadgeTooltip(t, status, now) ||
            t("webTerminal.connection.disconnected")}
        </Typography>
        <Typography variant="caption" color="text.secondary" component="div">
          {t("webTerminal.connection.inputPaused")}
        </Typography>
      </Box>
      {canRetry ? (
        <Button size="small" onClick={onRetry} sx={{ flexShrink: 0 }}>
          {t("webTerminal.connection.retry")}
        </Button>
      ) : null}
    </Box>
  );
}

WebTerminalConnectionNotice.propTypes = {
  status: PropTypes.object,
  inputBlocked: PropTypes.bool,
  onRetry: PropTypes.func.isRequired,
};
