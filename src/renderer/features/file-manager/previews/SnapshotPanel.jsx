import React from "react";
import {
  Button,
  Typography,
  Box,
  CircularProgress,
  Divider,
  Stack,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import RestoreIcon from "@mui/icons-material/Restore";
import { useTheme, alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import { formatSnapshotDate } from "../lib/snapshotDiff.js";

export default function SnapshotPanel({
  refreshSnapshots,
  loadingSnapshots,
  creatingSnapshot,
  visibleSnapshots,
  pendingRestoreSnapshot,
  handleSelectSnapshot,
  restoringSnapshotId,
  handleRestoreSnapshot,
  savingFile,
  loadingSelectedSnapshot,
  snapshotDiffData,
  handleClearSnapshotSelection,
}) {
  const theme = useTheme();
  const { t } = useTranslation();

  return (
    <Box
      sx={{
        minWidth: 0,
        minHeight: { xs: 220, lg: "100%" },
        display: "flex",
        flexDirection: "column",
        borderTop: {
          xs: `1px solid ${theme.palette.divider}`,
          lg: "none",
        },
        borderLeft: {
          xs: "none",
          lg: `1px solid ${theme.palette.divider}`,
        },
        backgroundColor:
          theme.palette.mode === "dark"
            ? alpha(theme.palette.background.default, 0.35)
            : alpha(theme.palette.background.default, 0.55),
      }}
    >
      <Box
        sx={{
          px: 1.5,
          py: 1.25,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={1}
        >
          <Typography variant="subtitle2">
            {t("filePreview.savedVersions")}
          </Typography>
          <Button
            size="small"
            onClick={refreshSnapshots}
            disabled={loadingSnapshots || creatingSnapshot}
          >
            {t("common.refresh")}
          </Button>
        </Stack>
      </Box>

      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        {loadingSnapshots ? (
          <Box
            sx={{
              height: "100%",
              minHeight: 180,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress size={24} />
          </Box>
        ) : (
          <List dense disablePadding>
            {visibleSnapshots.map((snapshot, index) => {
              const isSelected = pendingRestoreSnapshot?.id === snapshot.id;

              return (
                <React.Fragment key={snapshot.id}>
                  <ListItemButton
                    alignItems="flex-start"
                    onClick={() => handleSelectSnapshot(snapshot)}
                    selected={isSelected}
                    disabled={Boolean(restoringSnapshotId)}
                    sx={{
                      px: 1.5,
                      py: 1.25,
                      alignItems: "flex-start",
                    }}
                  >
                    <ListItemText
                      primary={
                        snapshot.label || t("filePreview.snapshotFallbackLabel")
                      }
                      secondary={
                        <Box
                          component="span"
                          sx={{
                            mt: 0.5,
                            display: "flex",
                            flexDirection: "column",
                            gap: 0.25,
                          }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {formatSnapshotDate(snapshot.createdAt)}
                          </Typography>
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {formatFileSize(snapshot.size || 0)}
                          </Typography>
                        </Box>
                      }
                      primaryTypographyProps={{
                        variant: "body2",
                        fontWeight: 600,
                      }}
                    />
                  </ListItemButton>
                  {isSelected ? (
                    <Box
                      sx={{
                        px: 1.5,
                        pt: 0.25,
                        pb: 1.25,
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.75,
                      }}
                    >
                      <Button
                        size="small"
                        color="warning"
                        variant="contained"
                        startIcon={<RestoreIcon />}
                        onClick={handleRestoreSnapshot}
                        disabled={
                          Boolean(restoringSnapshotId) ||
                          savingFile ||
                          loadingSelectedSnapshot ||
                          Boolean(
                            snapshotDiffData && !snapshotDiffData.hasChanges,
                          )
                        }
                      >
                        {restoringSnapshotId
                          ? t("filePreview.restoring")
                          : loadingSelectedSnapshot
                            ? t("filePreview.loadingDiff")
                            : t("filePreview.restoreVersion")}
                      </Button>
                      <Button
                        size="small"
                        onClick={handleClearSnapshotSelection}
                        disabled={
                          Boolean(restoringSnapshotId) ||
                          loadingSelectedSnapshot
                        }
                      >
                        {t("filePreview.clearSelection")}
                      </Button>
                    </Box>
                  ) : null}
                  {index < visibleSnapshots.length - 1 ? <Divider /> : null}
                </React.Fragment>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
}
