import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  ListItemButton,
  Collapse,
  alpha,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import ComputerIcon from "@mui/icons-material/Computer";
import FolderIcon from "@mui/icons-material/Folder";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import { useTranslation } from "react-i18next";

const WelcomePage = ({ connections, onOpenConnection }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [internalConnections, setInternalConnections] = useState(connections || []);

  useEffect(() => {
    // 当从props接收的connections更新时，同步到内部状态
    setInternalConnections(connections || []);
  }, [connections]);

  const handleToggleGroup = useCallback((groupId) => {
    const toggle = (items) => {
      return items.map((item) => {
        if (item.id === groupId && item.type === "group") {
          return { ...item, expanded: !item.expanded };
        }
        if (item.type === "group" && item.items) {
          return { ...item, items: toggle(item.items) };
        }
        return item;
      });
    };
    setInternalConnections((prevConnections) => toggle(prevConnections));
  }, []);

  const handleOpenConnection = useCallback((connection) => {
    if (onOpenConnection) {
      onOpenConnection(connection);
    }
  }, [onOpenConnection]);

  const renderConnectionItem = (connection, level = 0) => (
    <ListItem key={connection.id} disablePadding>
      <ListItemButton
        onClick={() => handleOpenConnection(connection)}
        sx={{
          pl: 2 + level * 2,
          "&:hover": {
            backgroundColor: alpha(theme.palette.primary.main, 0.1),
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 36 }}>
          <ComputerIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText
          primary={connection.name || connection.host}
          primaryTypographyProps={{ variant: "body2" }}
        />
      </ListItemButton>
    </ListItem>
  );

  const renderGroup = (group, level = 0) => (
    <React.Fragment key={group.id}>
      <ListItem disablePadding>
        <ListItemButton
          onClick={() => handleToggleGroup(group.id)}
          sx={{
            pl: 2 + level * 2,
            "&:hover": {
              backgroundColor: alpha(theme.palette.primary.main, 0.05),
            },
          }}
        >
          <ListItemIcon sx={{ minWidth: 36 }}>
            {group.expanded ? (
              <FolderOpenIcon fontSize="small" />
            ) : (
              <FolderIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText
            primary={group.name}
            primaryTypographyProps={{
              fontWeight: "medium",
              variant: "body2",
            }}
          />
        </ListItemButton>
      </ListItem>
      <Collapse in={group.expanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {group.items && group.items.map((item) =>
            item.type === "group"
              ? renderGroup(item, level + 1)
              : renderConnectionItem(item, level + 1)
          )}
        </List>
      </Collapse>
    </React.Fragment>
  );

  const renderTree = (items) => {
    return items.map((item) => {
      if (item.type === "group") {
        return renderGroup(item, 0);
      }
      return renderConnectionItem(item, 0);
    });
  };

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
          maxWidth: 600,
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
          {connections.length > 0 ? (
            <List>{renderTree(internalConnections)}</List>
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
