import * as React from "react";
import { retainLiveSessionEntries } from "../../features/terminal/model/paneLayout.js";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../shared/notifications/NotificationContext.jsx";

export default function useShellNotices({ liveSessionKeys }) {
  const { t } = useTranslation();
  const { showInfo, showWarning } = useNotification();
  const [diskAlertsByTabId, setDiskAlertsByTabId] = React.useState({});
  React.useEffect(() => {
    if (!window.terminalAPI?.onDiskAlertEvent) return undefined;
    const formatMounts = (mounts = []) =>
      Array.isArray(mounts)
        ? mounts.map((m) => `${m.mount} ${m.usedPercent}%`).join(", ")
        : "";
    const formatHost = (payload) =>
      payload.isLocal ? t("diskAlert.localHost") : payload.host || "SSH";
    const handleDiskAlertEvent = (payload) => {
      if (!payload || !payload.targetKey) return;
      if (payload.kind === "alert") {
        if (payload.tabId) {
          const tabKey = String(payload.tabId);
          setDiskAlertsByTabId((previous) => ({
            ...previous,
            [tabKey]: {
              host: payload.host,
              isLocal: payload.isLocal === true,
              threshold: payload.threshold,
              mounts: Array.isArray(payload.mounts) ? payload.mounts : [],
              updatedAt: payload.timestamp || Date.now(),
            },
          }));
        }
        showWarning(
          t("diskAlert.alertToast", {
            host: formatHost(payload),
            mounts: formatMounts(payload.mounts),
          }),
        );
      } else if (payload.kind === "clear") {
        if (payload.tabId) {
          const tabKey = String(payload.tabId);
          setDiskAlertsByTabId((previous) => {
            if (!previous[tabKey]) return previous;
            const next = {
              ...previous,
            };
            delete next[tabKey];
            return next;
          });
        }
        showInfo(
          t("diskAlert.clearToast", {
            host: formatHost(payload),
            mounts: formatMounts(payload.mounts),
          }),
        );
      }
    };
    return window.terminalAPI.onDiskAlertEvent(handleDiskAlertEvent);
  }, [t, showWarning, showInfo]);
  React.useEffect(() => {
    const lastNoticeAt = {
      "member-unreachable": 0,
      "concurrent-input": 0,
    };
    const THROTTLE_MS = {
      "member-unreachable": 2000,
      "concurrent-input": 3000,
    };
    const handleSyncGroupNotice = (event) => {
      const detail = event.detail || {};
      const throttle = THROTTLE_MS[detail.kind];
      if (!throttle) {
        return;
      }
      const now = Date.now();
      if (now - lastNoticeAt[detail.kind] < throttle) {
        return;
      }
      lastNoticeAt[detail.kind] = now;
      if (detail.kind === "member-unreachable") {
        const count =
          Array.isArray(detail.tabIds) && detail.tabIds.length > 0
            ? detail.tabIds.length
            : 1;
        showWarning(
          t("syncGroupNotice.memberUnreachable", {
            count,
          }),
        );
      } else if (detail.kind === "concurrent-input") {
        showWarning(t("syncGroupNotice.concurrentInput"));
      }
    };
    window.addEventListener("syncGroupNotice", handleSyncGroupNotice);
    return () =>
      window.removeEventListener("syncGroupNotice", handleSyncGroupNotice);
  }, [showWarning, t]);
  React.useEffect(() => {
    const activeTabIds = new Set(liveSessionKeys);
    const retain = (previous) =>
      retainLiveSessionEntries(previous, activeTabIds);
    setDiskAlertsByTabId(retain);
  }, [liveSessionKeys]);
  return { diskAlertsByTabId };
}
