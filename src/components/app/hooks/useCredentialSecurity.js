import * as React from "react";
import { useCallback } from "react";
// Import i18n configuration
import { useTranslation } from "react-i18next";
import { useCleanupManager } from "../../../hooks/useAutoCleanup.js";
import { useNotification } from "../../../contexts/NotificationContext.jsx";

export default function useCredentialSecurity() {
  const { showError, showInfo } = useNotification();
  const eventManager = useCleanupManager();
  const { t } = useTranslation();
  const [credentialSecurityStatus, setCredentialSecurityStatus] =
    React.useState({
      loading: true,
      masterPasswordEnabled: false,
      unlocked: true,
      requiresUnlock: false,
    });

  const [masterPasswordError, setMasterPasswordError] = React.useState("");

  const [unlockingCredentialStore, setUnlockingCredentialStore] =
    React.useState(false);

  const securityRevisionRef = React.useRef(0);
  React.useEffect(
    () => () => {
      securityRevisionRef.current += 1;
    },
    [],
  );
  const refreshCredentialSecurityStatus = useCallback(async () => {
    const revision = ++securityRevisionRef.current;
    if (!window.terminalAPI?.getCredentialSecurityStatus) {
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: false,
        unlocked: true,
        requiresUnlock: false,
      });
      return;
    }

    try {
      const response = await window.terminalAPI.getCredentialSecurityStatus();
      if (revision !== securityRevisionRef.current) return;
      const status = response?.success ? response.status : response;
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: status?.masterPasswordEnabled === true,
        unlocked: status?.unlocked !== false,
        requiresUnlock: status?.requiresUnlock === true,
      });
    } catch {
      if (revision !== securityRevisionRef.current) return;
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: false,
        unlocked: true,
        requiresUnlock: false,
      });
    }
  }, []);

  React.useEffect(() => {
    refreshCredentialSecurityStatus();
  }, [refreshCredentialSecurityStatus]);

  React.useEffect(() => {
    const handleCredentialSecurityChanged = (event) => {
      const status = event?.detail?.status;
      if (!status) {
        refreshCredentialSecurityStatus();
        return;
      }

      securityRevisionRef.current += 1;
      setMasterPasswordError("");
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: status?.masterPasswordEnabled === true,
        unlocked: status?.unlocked !== false,
        requiresUnlock: status?.requiresUnlock === true,
      });
    };

    const removeListener = eventManager.addEventListener(
      window,
      "credentialSecurityChanged",
      handleCredentialSecurityChanged,
    );

    return () => {
      removeListener();
    };
  }, [eventManager, refreshCredentialSecurityStatus]);

  const handleUnlockCredentialStore = useCallback(
    async (masterPassword) => {
      if (!window.terminalAPI?.unlockCredentialStore) {
        return;
      }

      securityRevisionRef.current += 1;
      setUnlockingCredentialStore(true);
      setMasterPasswordError("");

      try {
        const response =
          await window.terminalAPI.unlockCredentialStore(masterPassword);
        if (response?.success === false) {
          setMasterPasswordError(
            response.error === "Invalid master password"
              ? t("masterPassword.invalidPassword")
              : response.error || t("masterPassword.unlockFailed"),
          );
          return;
        }

        const nextStatus = response?.status || {
          masterPasswordEnabled: true,
          unlocked: true,
          requiresUnlock: false,
        };

        setCredentialSecurityStatus({
          loading: false,
          masterPasswordEnabled: nextStatus?.masterPasswordEnabled === true,
          unlocked: nextStatus?.unlocked !== false,
          requiresUnlock: nextStatus?.requiresUnlock === true,
        });
      } catch {
        setMasterPasswordError(t("masterPassword.unlockFailed"));
      } finally {
        setUnlockingCredentialStore(false);
      }
    },
    [t],
  );

  const handleLockApp = useCallback(async () => {
    if (!window.terminalAPI?.lockCredentialStore) {
      return;
    }
    try {
      const response = await window.terminalAPI.lockCredentialStore();
      if (response?.success === false) {
        showError(response.error || t("masterPassword.unlockFailed"));
        return;
      }
      const nextStatus = response?.status || {
        masterPasswordEnabled: true,
        unlocked: false,
        requiresUnlock: true,
      };
      setMasterPasswordError("");
      setCredentialSecurityStatus({
        loading: false,
        masterPasswordEnabled: nextStatus?.masterPasswordEnabled === true,
        unlocked: nextStatus?.unlocked !== false,
        requiresUnlock: nextStatus?.requiresUnlock === true,
      });
      showInfo(t("menu.lockAppSuccess"));
    } catch {
      showError(t("masterPassword.unlockFailed"));
    }
  }, [showError, showInfo, t]);
  return {
    credentialSecurityStatus,
    masterPasswordError,
    unlockingCredentialStore,
    handleUnlockCredentialStore,
    handleLockApp,
  };
}
