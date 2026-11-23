import * as React from "react";
import { useAppDispatch, useAppStore } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import { notifyTerminalResize } from "../appShellUtils.js";
import { normalizeRestoreSessionOnStartup } from "../../../shared/settings/uiSettingsDefaults.js";
import {
  clearWorkspaceSnapshot,
  createWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  resolveWorkspaceRestorePlan,
  saveWorkspaceSnapshot,
} from "../lib/workspaceSnapshot.js";

const SNAPSHOT_DEBOUNCE_MS = 300;

export default function useWorkspaceRestore({
  tabs,
  currentTab,
  splitLayouts,
  panes,
  connections,
  connectionsLoaded,
  uiSettingsLoaded,
  uiSettingsSnapshot,
  credentialSecurityStatus,
  markSessionConnecting,
}) {
  const dispatch = useAppDispatch();
  const appStore = useAppStore();
  const restoreAttemptedRef = React.useRef(false);
  const [startupRestoreDone, setStartupRestoreDone] = React.useState(false);

  const restoreEnabled = normalizeRestoreSessionOnStartup(uiSettingsSnapshot);
  const isUnlocked =
    !credentialSecurityStatus?.loading &&
    !credentialSecurityStatus?.requiresUnlock;

  // Startup restoration: deferred until connections, uiSettings, and unlock gate clear.
  React.useEffect(() => {
    if (restoreAttemptedRef.current) {
      return;
    }
    if (!uiSettingsLoaded || !connectionsLoaded || !isUnlocked) {
      return;
    }
    restoreAttemptedRef.current = true;

    if (!restoreEnabled) {
      setStartupRestoreDone(true);
      return;
    }

    const currentState = appStore.getState();
    if ((currentState.tabs?.length || 0) > 1) {
      setStartupRestoreDone(true);
      return;
    }

    const snapshot = loadWorkspaceSnapshot();
    const plan = resolveWorkspaceRestorePlan(snapshot, connections, {
      welcomeTab: currentState.tabs?.[0],
    });
    if (plan && plan.tabs.length > 1) {
      dispatch(
        actions.restoreWorkspace({
          tabs: plan.tabs,
          currentTab: plan.currentTab,
          splitLayouts: plan.splitLayouts,
          panes: plan.panes,
          terminalInstances: plan.terminalInstances,
        }),
      );
      plan.sshSessions.forEach(({ tabId, config }) => {
        markSessionConnecting?.(tabId, config);
      });
      notifyTerminalResize();
    }
    setStartupRestoreDone(true);
  }, [
    appStore,
    connections,
    connectionsLoaded,
    dispatch,
    isUnlocked,
    markSessionConnecting,
    restoreEnabled,
    uiSettingsLoaded,
  ]);

  // Debounced workspace snapshot persistence after startup gate settles.
  React.useEffect(() => {
    if (!startupRestoreDone || !isUnlocked) {
      return undefined;
    }

    if (!restoreEnabled) {
      clearWorkspaceSnapshot();
      return undefined;
    }

    const persistNow = () => {
      const state = appStore.getState();
      const snapshot = createWorkspaceSnapshot({
        ...state,
        tabs,
        currentTab,
        splitLayouts,
        panes,
      });
      saveWorkspaceSnapshot(snapshot);
    };

    const timer = window.setTimeout(persistNow, SNAPSHOT_DEBOUNCE_MS);
    window.addEventListener("beforeunload", persistNow);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("beforeunload", persistNow);
    };
  }, [
    appStore,
    currentTab,
    isUnlocked,
    panes,
    restoreEnabled,
    splitLayouts,
    startupRestoreDone,
    tabs,
  ]);

  return { startupRestoreDone };
}
