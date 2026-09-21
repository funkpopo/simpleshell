import { useEffect, useState } from "react";

// Owned by the app, so all file panels use one persisted global preference.
export function useSftpFollowSetting() {
  // Do not navigate before a saved opt-out has finished loading.
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let disposed = false;
    let changed = false;
    const onSettingsChanged = ({ detail }) => {
      if (typeof detail?.sftpFollowTerminalDirectory !== "boolean") return;
      changed = true;
      setEnabled(detail.sftpFollowTerminalDirectory);
    };
    window.addEventListener("settingsChanged", onSettingsChanged);
    Promise.resolve()
      .then(() => window.terminalAPI?.loadUISettings?.())
      .then((settings) => {
        if (!disposed && !changed) {
          setEnabled(settings?.sftpFollowTerminalDirectory !== false);
        }
      })
      .catch(() => {
        // A failed read must not override a potentially saved opt-out.
      });
    return () => {
      disposed = true;
      window.removeEventListener("settingsChanged", onSettingsChanged);
    };
  }, []);
  return enabled;
}
