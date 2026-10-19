import useAppNotifications from "../hooks/useAppNotifications.js";
import * as React from "react";
import { useCallback } from "react";
import { useAppDispatch, useShellSelector } from "../state/AppContext.jsx";
import {
  AboutDialogWithSuspense as AboutDialog,
  FirstRunDialogWithSuspense as FirstRunDialog,
  SettingsWithSuspense as Settings,
} from "../LazyComponents.jsx";
import { shallowEqual } from "../state/subscriptionStore.js";
import SSHAuthDialog from "../../features/connections/SSHAuthDialog.jsx";
import MasterPasswordOverlay from "../../features/security/MasterPasswordOverlay.jsx";
import { useTranslation } from "react-i18next";
import ErrorNotification from "../../shared/ui/ErrorNotification.jsx";
import { useNotification } from "../../shared/notifications/NotificationContext.jsx";
import useSSHAuthentication from "../hooks/useSSHAuthentication.js";

export default function DialogsLayer({
  connectionsRef,
  terminalInstancesRef,
  liveSessionKeysRef,
  liveSessionKeys,
  uiSettingsLoaded,
  connectionsLoaded,
  uiSettingsSnapshot,
  setUiSettingsSnapshot,
  credentialSecurityStatus,
  handleCloseAbout,
  aboutUpdateCheckSignal,
  handleRemindUpdateLater,
  handleCloseSettings,
  unlockingCredentialStore,
  masterPasswordError,
  handleUnlockCredentialStore,
  handleExit,
}) {
  const dispatch = useAppDispatch();
  const { showSuccess } = useNotification();
  const { t } = useTranslation();
  const { aboutDialogOpen, settingsDialogOpen, connections } = useShellSelector(
    (state) => ({
      aboutDialogOpen: state.aboutDialogOpen,
      settingsDialogOpen: state.settingsDialogOpen,
      connections: state.connections,
    }),
    shallowEqual,
  );
  const { appError, errorNotificationOpen, handleCloseErrorNotification } =
    useAppNotifications({ showSuccess, t });
  const [firstRunDialogOpen, setFirstRunDialogOpen] = React.useState(false);
  const {
    sshAuthDialogOpen,
    sshAuthData,
    sshAuthConnectionConfig,
    handleSSHAuthConfirm,
    handleSSHAuthClose,
  } = useSSHAuthentication({
    connectionsRef,
    terminalInstancesRef,
    dispatch,
    liveSessionKeysRef,
    liveSessionKeys,
  });
  React.useEffect(() => {
    if (!uiSettingsLoaded || !connectionsLoaded) {
      return;
    }
    const onboardingCompleted =
      uiSettingsSnapshot?.onboarding?.completed === true;
    const hasExistingConnections =
      Array.isArray(connections) && connections.length > 0;
    if (!onboardingCompleted && !hasExistingConnections) {
      setFirstRunDialogOpen(true);
    }
  }, [connections, connectionsLoaded, uiSettingsLoaded, uiSettingsSnapshot]);
  const handleFirstRunComplete = useCallback((settings) => {
    setUiSettingsSnapshot(settings || null);
    setFirstRunDialogOpen(false);
  }, []);
  return (
    <>
      {firstRunDialogOpen && (
        <FirstRunDialog
          open={firstRunDialogOpen}
          initialSettings={uiSettingsSnapshot}
          credentialSecurityStatus={credentialSecurityStatus}
          onComplete={handleFirstRunComplete}
        />
      )}
      {/* 关于对话框 */}
      {aboutDialogOpen && (
        <AboutDialog
          open={aboutDialogOpen}
          onClose={handleCloseAbout}
          checkUpdateSignal={aboutUpdateCheckSignal}
          onRemindLater={handleRemindUpdateLater}
        />
      )}
      {/* SSH 认证对话框 */}
      <SSHAuthDialog
        open={sshAuthDialogOpen}
        onClose={handleSSHAuthClose}
        onConfirm={handleSSHAuthConfirm}
        authData={sshAuthData}
        connectionConfig={sshAuthConnectionConfig}
      />
      {/* 设置对话框 */}
      <Settings open={settingsDialogOpen} onClose={handleCloseSettings} />
      <MasterPasswordOverlay
        open={
          credentialSecurityStatus.loading ||
          credentialSecurityStatus.requiresUnlock
        }
        loading={credentialSecurityStatus.loading}
        isSubmitting={unlockingCredentialStore}
        error={masterPasswordError}
        onUnlock={handleUnlockCredentialStore}
        onClose={handleExit}
      />
      {/* 错误通知 */}
      <ErrorNotification
        error={appError}
        open={errorNotificationOpen}
        onClose={handleCloseErrorNotification}
      />
    </>
  );
}
