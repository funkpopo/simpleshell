import * as React from "react";
import { GlassDialog } from "../../shared/ui/styledDialogs.jsx";
import { memo } from "react";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import CloseIcon from "@mui/icons-material/Close";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import TuneIcon from "@mui/icons-material/Tune";
import SettingsIcon from "@mui/icons-material/Settings";
import TerminalIcon from "@mui/icons-material/Terminal";
import LockIcon from "@mui/icons-material/Lock";
import BugReportIcon from "@mui/icons-material/BugReport";
import CloudSyncIcon from "@mui/icons-material/CloudSync";
import { useTranslation } from "react-i18next";
import { changeLanguage } from "../../i18n/i18n";
import { SettingsSkeleton } from "../../shared/ui/SkeletonLoader.jsx";
import { useNotification } from "../../shared/notifications/NotificationContext";
import loadSettingsSnapshot from "./lib/loadSettingsSnapshot.js";
import GeneralSettings from "./sections/GeneralSettings.jsx";
import TerminalSettings from "./sections/TerminalSettings.jsx";
import PerformanceSettings from "./sections/PerformanceSettings.jsx";
import SecuritySettings from "./sections/SecuritySettings.jsx";
import DataSyncSettings from "./sections/DataSyncSettings.jsx";
import FeedbackSettings from "./sections/FeedbackSettings.jsx";

const BootstrapDialogTitle = memo((props) => {
  const { t } = useTranslation();
  const { children, onClose, ...other } = props;

  return (
    <DialogTitle sx={{ m: 0, p: 2 }} {...other}>
      {children}
      {onClose ? (
        <Tooltip title={t("common.close")}>
          <IconButton
            aria-label={t("common.close")}
            onClick={onClose}
            sx={{
              position: "absolute",
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </Tooltip>
      ) : null}
    </DialogTitle>
  );
});

BootstrapDialogTitle.displayName = "BootstrapDialogTitle";
const Settings = memo(({ open, onClose }) => {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [activeTab, setActiveTab] = React.useState(0);
  const [initialValues, setInitialValues] = React.useState(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const savePendingRef = React.useRef(null);
  const revisionRef = React.useRef(0);
  const generalRef = React.useRef(null),
    terminalRef = React.useRef(null),
    performanceRef = React.useRef(null),
    securityRef = React.useRef(null),
    feedbackRef = React.useRef(null);
  const sectionRefs = [
    generalRef,
    terminalRef,
    performanceRef,
    securityRef,
    null,
    feedbackRef,
  ];
  const closeTimerRef = React.useRef(null);
  React.useEffect(() => {
    revisionRef.current += 1;
    savePendingRef.current = null;
    setSaving(false);
    if (!open) {
      setInitialValues(null);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    loadSettingsSnapshot()
      .then((values) => {
        if (!cancelled) {
          setInitialValues(values);
          setIsLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          showError(error?.message || t("settings.saveError"));
        }
      });
    return () => {
      cancelled = true;
      revisionRef.current += 1;
      clearTimeout(closeTimerRef.current);
    };
  }, [open]);
  const handleSave = async () => {
    if (isLoading || savePendingRef.current || !initialValues) return;
    const request = {};
    const revision = revisionRef.current;
    const isCurrent = () => revisionRef.current === revision;
    const security = securityRef.current;
    const terminal = terminalRef.current;
    const feedback = feedbackRef.current;
    const settings = Object.assign(
      {},
      ...sectionRefs
        .filter(Boolean)
        .map((section) => section.current.getUISettings()),
    );
    savePendingRef.current = request;
    setSaving(true);
    try {
      if ((await security.save()) === false) return;
      const response = await window.terminalAPI?.saveUISettings?.(settings);
      if (response === false || response?.success === false)
        throw new Error(response?.error || t("settings.saveError"));
      await terminal.saveLogs();
      await feedback.saveFeedback();
      if (settings.language && i18n.language !== settings.language)
        changeLanguage(settings.language);
      window.dispatchEvent(
        new CustomEvent("settingsChanged", { detail: settings }),
      );
      if (isCurrent()) {
        showSuccess(t("settings.saveSuccess"));
        closeTimerRef.current = setTimeout(onClose, 500);
      }
    } catch (error) {
      if (isCurrent()) showError(error?.message || t("settings.saveError"));
    } finally {
      if (savePendingRef.current === request) savePendingRef.current = null;
      if (isCurrent()) setSaving(false);
    }
  };

  const sidebarItems = [
    {
      id: 0,
      label: t("settings.general"),
      icon: <SettingsIcon fontSize="small" />,
    },
    {
      id: 1,
      label: t("settings.terminalAndLogs"),
      icon: <TerminalIcon fontSize="small" />,
    },
    {
      id: 2,
      label: t("settings.performanceSettings"),
      icon: <TuneIcon fontSize="small" />,
    },
    {
      id: 3,
      label: t("settings.security.title"),
      icon: <LockIcon fontSize="small" />,
    },
    {
      id: 4,
      label: t("settings.dataSync.title"),
      icon: <CloudSyncIcon fontSize="small" />,
    },
    {
      id: 5,
      label: t("settings.feedback.title"),
      icon: <BugReportIcon fontSize="small" />,
    },
  ];

  return (
    <GlassDialog
      open={open}
      onClose={onClose}
      aria-labelledby="settings-dialog-title"
      maxWidth="md"
      fullWidth
      paperMaxHeight="80vh"
    >
      <BootstrapDialogTitle id="settings-dialog-title" onClose={onClose}>
        {t("settings.title")}
      </BootstrapDialogTitle>
      <DialogContent dividers sx={{ p: 0, overflow: "hidden" }}>
        {isLoading || !initialValues ? (
          <SettingsSkeleton />
        ) : (
          <Box
            sx={{
              display: "flex",
              minHeight: "min(420px, 100%)",
              maxHeight: "65vh",
            }}
          >
            {/* Sidebar */}
            <Box
              sx={{
                width: { xs: 128, sm: 160 },
                flexShrink: 0,
                borderRight: 1,
                borderColor: "divider",
                overflowY: "auto",
              }}
            >
              <List dense component="nav" sx={{ pt: 1, pb: 1 }}>
                {sidebarItems.map((item) => (
                  <ListItemButton
                    key={item.id}
                    selected={activeTab === item.id}
                    onClick={() => setActiveTab(item.id)}
                    sx={{ px: { xs: 1, sm: 2 } }}
                  >
                    <ListItemIcon sx={{ minWidth: { xs: 28, sm: 36 } }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText
                      primary={item.label}
                      slotProps={{
                        primary: {
                          variant: "body2",
                          sx: { overflowWrap: "anywhere" },
                        },
                      }}
                    />
                  </ListItemButton>
                ))}
              </List>
            </Box>

            {/* Content Panel */}
            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                overflowY: "auto",
                p: { xs: 1.5, sm: 2 },
              }}
            >
              {/* Tab 0: General */}
              <Box hidden={activeTab !== 0}>
                <GeneralSettings
                  initialValues={initialValues}
                  open={open}
                  ref={sectionRefs[0]}
                />
              </Box>

              {/* Tab 1: Terminal & Logs */}
              <Box hidden={activeTab !== 1}>
                <TerminalSettings
                  initialValues={initialValues}
                  open={open}
                  ref={sectionRefs[1]}
                />
              </Box>

              {/* Tab 2: Performance */}
              <Box hidden={activeTab !== 2}>
                <PerformanceSettings
                  initialValues={initialValues}
                  open={open}
                  ref={sectionRefs[2]}
                />
              </Box>

              {/* Tab 3: Security */}
              <Box hidden={activeTab !== 3}>
                <SecuritySettings
                  initialValues={initialValues}
                  open={open}
                  ref={sectionRefs[3]}
                />
              </Box>

              {/* Tab 4: Data & Sync */}
              <Box hidden={activeTab !== 4}>
                <DataSyncSettings initialValues={initialValues} open={open} />
              </Box>

              {/* Tab 5: Feedback */}
              <Box hidden={activeTab !== 5}>
                <FeedbackSettings
                  initialValues={initialValues}
                  open={open}
                  ref={sectionRefs[5]}
                />
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 2, py: 1, gap: 0.75 }}>
        <Button onClick={onClose} color="primary" variant="outlined">
          {t("settings.cancel")}
        </Button>
        <Button
          onClick={handleSave}
          disabled={isLoading || saving}
          color="primary"
          variant="contained"
        >
          {t("settings.save")}
        </Button>
      </DialogActions>
    </GlassDialog>
  );
});

Settings.displayName = "Settings";

export default Settings;
