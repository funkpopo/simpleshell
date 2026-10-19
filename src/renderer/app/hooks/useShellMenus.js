import * as React from "react";
import { useCallback } from "react";
import { useAppDispatch } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import { useTranslation } from "react-i18next";
import {
  openLogDirectory,
  exportDiagnostics,
  openFeedbackIssue,
} from "../../features/diagnostics/diagnosticsActions.js";
import { useNotification } from "../../shared/notifications/NotificationContext.jsx";
import {
  UPDATE_REMINDER_STORAGE_KEY,
  UPDATE_REMINDER_DELAY_MS,
} from "../appShellUtils.js";

export default function useShellMenus({ open }) {
  const dispatch = useAppDispatch();
  const { t } = useTranslation();
  const { showError, showInfo, showSuccess } = useNotification();
  const [aboutUpdateCheckSignal, setAboutUpdateCheckSignal] = React.useState(0);
  const [updateReminderAt, setUpdateReminderAt] = React.useState(() => {
    try {
      const storedValue = Number(
        window.localStorage?.getItem(UPDATE_REMINDER_STORAGE_KEY),
      );
      return Number.isFinite(storedValue) && storedValue > 0 ? storedValue : 0;
    } catch {
      return 0;
    }
  });
  const handleMenu = useCallback(
    (event) => {
      dispatch(actions.setAnchorEl(event.currentTarget));
    },
    [dispatch],
  );
  const handleClose = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
  }, [dispatch]);
  const handleTopBarInteraction = useCallback(
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const isInteractiveTarget = Boolean(
        target.closest(
          'button,[role="button"],input,textarea,select,a,[contenteditable="true"],.MuiTabs-root,.MuiMenu-root,#menu-appbar',
        ),
      );
      if (
        event.button === 0 &&
        event.detail === 2 &&
        !isInteractiveTarget &&
        window.terminalAPI?.toggleMaximizeWindow
      ) {
        window.terminalAPI.toggleMaximizeWindow();
        return;
      }
      if (!open) {
        return;
      }
      if (target.closest("#menu-appbar")) {
        return;
      }
      if (target.closest('[data-main-menu-button="true"]')) {
        return;
      }
      handleClose();
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    [open, handleClose],
  );
  const handleOpenAbout = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
    dispatch(actions.setAboutDialogOpen(true));
  }, [dispatch]);
  const handleCloseAbout = useCallback(() => {
    dispatch(actions.setAboutDialogOpen(false));
  }, [dispatch]);
  const handleOpenSettings = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
    dispatch(actions.setSettingsDialogOpen(true));
  }, [dispatch]);
  const handleCloseSettings = useCallback(() => {
    dispatch(actions.setSettingsDialogOpen(false));
  }, [dispatch]);
  const handleCheckForUpdates = useCallback(() => {
    dispatch(actions.setAnchorEl(null));
    dispatch(actions.setAboutDialogOpen(true));
    setAboutUpdateCheckSignal((value) => value + 1);
  }, [dispatch]);
  const handleRemindUpdateLater = useCallback(() => {
    const reminderAt = Date.now() + UPDATE_REMINDER_DELAY_MS;
    try {
      window.localStorage?.setItem(
        UPDATE_REMINDER_STORAGE_KEY,
        String(reminderAt),
      );
    } catch {
      // Local reminder persistence is best-effort.
    }
    setUpdateReminderAt(reminderAt);
    dispatch(actions.setAboutDialogOpen(false));
    showInfo(
      t("update.reminderScheduled", {
        hours: Math.round(UPDATE_REMINDER_DELAY_MS / 60 / 60 / 1000),
      }),
    );
  }, [dispatch, showInfo, t]);
  React.useEffect(() => {
    if (!updateReminderAt) {
      return undefined;
    }
    const delay = Math.max(updateReminderAt - Date.now(), 0);
    const timer = window.setTimeout(() => {
      try {
        window.localStorage?.removeItem(UPDATE_REMINDER_STORAGE_KEY);
      } catch {
        // Ignore reminder persistence cleanup failures.
      }
      setUpdateReminderAt(0);
      showInfo(t("update.reminderDue"));
      handleCheckForUpdates();
    }, delay);
    return () => {
      window.clearTimeout(timer);
    };
  }, [handleCheckForUpdates, showInfo, t, updateReminderAt]);
  const handleOpenLogDirectory = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    await openLogDirectory({
      t,
      showSuccess,
      showError,
    });
  }, [dispatch, showError, showSuccess, t]);
  const handleExportDiagnostics = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    await exportDiagnostics({
      t,
      showSuccess,
      showError,
    });
  }, [dispatch, showError, showSuccess, t]);
  const handleOpenFeedbackIssue = useCallback(async () => {
    dispatch(actions.setAnchorEl(null));
    await openFeedbackIssue({
      t,
      showSuccess,
      showError,
      source: "main-menu",
      confirmButtonLabel: t("menu.feedback"),
    });
  }, [dispatch, showError, showSuccess, t]);
  const handleSystemMenuAction = useCallback(
    (payload) => {
      const action = payload?.action;
      if (action === "about") {
        handleOpenAbout();
        return;
      }
      if (action === "settings") {
        handleOpenSettings();
        return;
      }
      if (action === "check-for-updates") {
        handleCheckForUpdates();
        return;
      }
      if (action === "open-log-directory") {
        void handleOpenLogDirectory();
        return;
      }
      if (action === "export-diagnostics") {
        void handleExportDiagnostics();
        return;
      }
      if (action === "feedback-issue") {
        void handleOpenFeedbackIssue();
      }
    },
    [
      handleCheckForUpdates,
      handleExportDiagnostics,
      handleOpenFeedbackIssue,
      handleOpenAbout,
      handleOpenLogDirectory,
      handleOpenSettings,
    ],
  );
  React.useEffect(() => {
    if (!window.terminalAPI?.onMenuAction) {
      return undefined;
    }
    return window.terminalAPI.onMenuAction(handleSystemMenuAction);
  }, [handleSystemMenuAction]);
  const handleDesktopOpenFiles = useCallback(
    (payload) => {
      const filePaths = Array.isArray(payload?.filePaths)
        ? payload.filePaths
            .map((filePath) =>
              typeof filePath === "string" ? filePath.trim() : "",
            )
            .filter(Boolean)
        : [];
      if (filePaths.length === 0) {
        return;
      }
      showInfo(
        t("app.openFilesReceived", {
          count: filePaths.length,
          firstPath: filePaths[0],
        }),
      );
    },
    [showInfo, t],
  );
  React.useEffect(() => {
    if (!window.terminalAPI?.onOpenFiles) {
      return undefined;
    }
    return window.terminalAPI.onOpenFiles(handleDesktopOpenFiles);
  }, [handleDesktopOpenFiles]);
  const handleExit = useCallback(() => {
    if (window.terminalAPI && window.terminalAPI.closeApp) {
      window.terminalAPI.closeApp();
    }
    dispatch(actions.setAnchorEl(null));
  }, [dispatch]);
  return {
    handleTopBarInteraction,
    handleMenu,
    handleClose,
    handleOpenSettings,
    handleOpenLogDirectory,
    handleExportDiagnostics,
    handleOpenFeedbackIssue,
    handleOpenAbout,
    handleExit,
    handleCloseAbout,
    aboutUpdateCheckSignal,
    handleRemindUpdateLater,
    handleCloseSettings,
  };
}
