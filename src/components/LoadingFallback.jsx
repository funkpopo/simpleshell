import React, { memo } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

const LoadingFallback = ({ message, size = 40, showMessage = true }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const displayMessage =
    typeof message === "string" && message.trim()
      ? message
      : t("common.skeleton.loading");

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        height: "100%",
        width: "100%",
        minHeight: "200px",
        backgroundColor: theme.palette.background.paper,
        color: theme.palette.text.secondary,
        gap: 2,
      }}
    >
      <CircularProgress
        size={size}
        color="primary"
        sx={{
          animation: "pulse 1.5s ease-in-out infinite",
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
          },
          "@keyframes pulse": {
            "0%": {
              opacity: 1,
            },
            "50%": {
              opacity: 0.5,
            },
            "100%": {
              opacity: 1,
            },
          },
        }}
      />
      {showMessage && (
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            textAlign: "center",
            fontWeight: 400,
          }}
        >
          {displayMessage}
        </Typography>
      )}
    </Box>
  );
};

export default memo(LoadingFallback);
