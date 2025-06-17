import React from "react";
import { Box, Typography, Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";

import { useTranslation } from "react-i18next";

const WelcomePage = () => {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        width: "100%",
        p: 3,
        bgcolor: "background.default",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 5,
          borderRadius: 2,
          maxWidth: 800,
          width: "100%",
          textAlign: "center",
          bgcolor: "background.paper",
          position: "relative",
          zIndex: 1,
          boxShadow: `0 8px 32px 0 ${theme.palette.primary.main}30`,
          backdropFilter: "blur(8px)",
          border: `1px solid ${theme.palette.primary.main}20`,

          "& *::selection": {
            backgroundColor: `${theme.palette.primary.main}30`,
          },
        }}
      >
        <Box
          sx={{
            mb: 4,
            display: "flex",
            justifyContent: "center",
            position: "relative",
            "&::after": {
              content: '""',
              position: "absolute",
              bottom: "-10px",
              left: "50%",
              transform: "translateX(-50%)",
              width: "40%",
              height: "1px",
              background: `linear-gradient(90deg, transparent, ${theme.palette.primary.main}50, transparent)`,
            },
          }}
        >
          <ComputerIcon
            sx={{
              fontSize: 80,
              color: "primary.main",
              mb: 2,
              filter: `drop-shadow(0 4px 6px ${theme.palette.primary.main}40)`,
            }}
          />
        </Box>

        <Typography
          variant="h4"
          gutterBottom
          sx={{
            fontWeight: "bold",
            mb: 3,
            background: `linear-gradient(120deg, ${theme.palette.primary.main}, ${theme.palette.primary.dark} 50%, ${theme.palette.primary.main})`,
            backgroundSize: "200% auto",
            backgroundClip: "text",
            textFillColor: "transparent",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          {t("welcome.title")}
        </Typography>

        <Typography variant="body1" sx={{ mb: 4, lineHeight: 1.8 }}>
          SimpleShell
          {t("welcome.description")}
        </Typography>
      </Paper>
    </Box>
  );
};

export default WelcomePage;
