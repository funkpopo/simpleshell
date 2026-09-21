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
        left: 8,
        bottom: 8,
        zIndex: 1200,
        display: "flex",
        alignItems: "center",
        gap: 1,
        px: 1.25,
        py: 0.75,
        borderRadius: 1,
        bgcolor: "background.paper",
        border: "1px solid",
        borderColor: "divider",
        boxShadow: 2,
        maxWidth: "min(420px, calc(100% - 16px))",
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
