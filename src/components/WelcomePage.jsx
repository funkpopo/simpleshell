import React, { useCallback } from "react";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  alpha,
  Divider,
  Chip,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";
import { useTranslation } from "react-i18next";
import { countries } from "countries-list";

const WelcomePage = ({ connections, topConnections, onOpenConnection }) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const handleOpenConnection = useCallback((connection) => {
    if (onOpenConnection) {
      onOpenConnection(connection);
    }
  }, [onOpenConnection]);

  const renderTopConnectionItem = (connection) => (
    <ListItem
      key={connection.id}
      disablePadding
      sx={{ mb: 1 }}
    >
      <ListItemButton
        onClick={() => handleOpenConnection(connection)}
        sx={{
          py: 0.1,
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          backgroundColor: alpha(theme.palette.background.paper, 0.7),
          "&:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
            borderColor: 'primary.main',
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 40 }}>
          <ComputerIcon />
        </ListItemIcon>
        <ListItemText
          primary={connection.name || connection.host}
          primaryTypographyProps={{ variant: "body1", fontWeight: "medium" }}
        />
        <Box sx={{ ml: 2, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {connection.os && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {connection.os}
            </Typography>
          )}
          {connection.country && countries[connection.country] && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <span
                    className={`fi fi-${connection.country.toLowerCase()}`}
                    title={countries[connection.country].name}
                ></span>
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
          width: '100%',
          maxWidth: 400,
          bgcolor: "background.paper",
          boxShadow: `0 8px 32px 0 ${theme.palette.primary.main}20`,
          border: `1px solid ${theme.palette.divider}`,
          maxHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
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
        <Box sx={{ overflow: 'auto', flexGrow: 1 }}>
          {topConnections && topConnections.length > 0 ? (
            <>
              <Typography variant="h6" sx={{ mb: 2, px: 2, fontWeight: 'medium' }}>
                {t('上一次连接的服务器')}
              </Typography>
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
              <ComputerIcon
                sx={{
                  fontSize: 60,
                  color: "primary.main",
                  mb: 2,
                  filter: `drop-shadow(0 4px 6px ${theme.palette.primary.main}30)`,
                }}
              />
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
