import React, { useCallback } from "react";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemButton,
  alpha,
  Divider,
  Chip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { countries } from "countries-list";

const WelcomePage = ({ connections, topConnections, onOpenConnection }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const handleOpenConnection = useCallback(
    (connection) => {
      if (onOpenConnection) {
        onOpenConnection(connection);
      }
    },
    [onOpenConnection],
  );

  const renderTopConnectionItem = (connection) => (
    <ListItem key={connection.id} disablePadding sx={{ mb: 0.5 }}>
      <ListItemButton
        onClick={() => handleOpenConnection(connection)}
        sx={{
          py: 1,
          px: 1.5,
          borderRadius: 1.5,
          border: "1px solid",
          borderColor: "divider",
          backgroundColor: alpha(theme.palette.background.paper, 0.8),
          minHeight: 48,
          maxHeight: 48,
          transition: "all 0.2s ease",
          "&:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.08),
            borderColor: "primary.main",
            boxShadow: `0 2px 8px ${alpha(theme.palette.primary.main, 0.1)}`,
          },
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            flexGrow: 1,
            minWidth: 0,
            justifyContent: "center",
          }}
        >
          <Typography
            variant="body2"
            sx={{
              fontWeight: 600,
              color: "text.primary",
              mb: 0.2,
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
              fontSize: "0.875rem",
              lineHeight: 1.2,
            }}
          >
            {connection.name || connection.host}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
              fontSize: "0.7rem",
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
              lineHeight: 1.1,
            }}
          >
            {connection.username
              ? `${connection.username}@${connection.host}`
              : connection.host}
          </Typography>
        </Box>

        <Box
          sx={{
            ml: 1.5,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.5,
            flexWrap: "nowrap",
            justifyContent: "flex-end",
          }}
        >
          {connection.protocol && (
            <Chip
              label={connection.protocol?.toUpperCase() || "SSH"}
              size="small"
              variant="filled"
              sx={{
                backgroundColor:
                  connection.protocol === "ssh"
                    ? alpha(theme.palette.success.main, 0.1)
                    : alpha(theme.palette.warning.main, 0.1),
                color:
                  connection.protocol === "ssh"
                    ? theme.palette.success.main
                    : theme.palette.warning.main,
                fontWeight: 600,
                fontSize: "0.65rem",
                height: 18,
              }}
            />
          )}

          {connection.os && (
            <Chip
              label={connection.os}
              size="small"
              variant="outlined"
              sx={{
                borderColor: alpha(theme.palette.info.main, 0.3),
                color: theme.palette.info.main,
                fontSize: "0.65rem",
                height: 18,
              }}
            />
          )}

          {connection.connectionType && (
            <Chip
              label={connection.connectionType}
              size="small"
              variant="outlined"
              sx={{
                borderColor: alpha(theme.palette.secondary.main, 0.4),
                color: theme.palette.secondary.main,
                fontSize: "0.65rem",
                height: 18,
              }}
            />
          )}

          {connection.country && countries[connection.country] && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.3,
                backgroundColor: alpha(theme.palette.background.paper, 0.8),
                borderRadius: 0.5,
                px: 0.4,
                py: 0.1,
                border: `1px solid ${alpha(theme.palette.divider, 0.3)}`,
              }}
            >
              <span
                className={`fi fi-${connection.country.toLowerCase()}`}
                title={countries[connection.country].name}
                style={{
                  fontSize: "0.8rem",
                  borderRadius: "1px",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                }}
              />
            </Box>
          )}
        </Box>
      </ListItemButton>
    </ListItem>
  );

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
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 4,
          borderRadius: 2,
          width: "100%",
          maxWidth: 400,
          bgcolor: "background.paper",
          boxShadow: `0 8px 32px 0 ${theme.palette.primary.main}20`,
          border: `1px solid ${theme.palette.divider}`,
          maxHeight: "100%",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Typography
          variant="h4"
          gutterBottom
          sx={{
            fontWeight: "bold",
            textAlign: "center",
            mb: 3,
            background: `linear-gradient(120deg, ${theme.palette.primary.main}, ${theme.palette.text.primary})`,
            backgroundSize: "200% auto",
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            flexShrink: 0,
          }}
        >
          SimpleShell
        </Typography>
        <Box sx={{ overflow: "auto", flexGrow: 1 }}>
          {topConnections && topConnections.length > 0 ? (
            <>
              <Box
                sx={{
                  mb: 3,
                  px: 2,
                  display: "flex",
                  alignItems: "center",
                  gap: 2,
                }}
              >
                <Box
                  sx={{
                    width: 4,
                    height: 24,
                    backgroundColor: theme.palette.primary.main,
                    borderRadius: 2,
                    flexShrink: 0,
                  }}
                />
                <Typography
                  variant="h6"
                  sx={{
                    fontWeight: 700,
                    color: "text.primary",
                    fontSize: "1.1rem",
                    letterSpacing: "0.5px",
                  }}
                >
                  {t("welcome.lastConnectedServers")}
                </Typography>
                <Box
                  sx={{
                    flexGrow: 1,
                    height: 1,
                    backgroundColor: alpha(theme.palette.primary.main, 0.2),
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{
                    color: "text.secondary",
                    fontSize: "0.75rem",
                    fontWeight: 500,
                    backgroundColor: alpha(theme.palette.primary.main, 0.1),
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}`,
                  }}
                >
                  {topConnections.length}
                </Typography>
              </Box>
              <List sx={{ px: 1 }}>
                {topConnections.map((conn) => renderTopConnectionItem(conn))}
              </List>
            </>
          ) : (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                textAlign: "center",
                py: 5,
              }}
            >
              <Typography
                variant="h5"
                gutterBottom
                sx={{ fontWeight: "bold", mb: 2 }}
              >
                {t("welcome.title")}
              </Typography>
              <Typography variant="body1" sx={{ mb: 4, lineHeight: 1.8 }}>
                {t("welcome.description")}
              </Typography>
            </Box>
          )}
        </Box>
      </Paper>
    </Box>
  );
};

export default WelcomePage;
