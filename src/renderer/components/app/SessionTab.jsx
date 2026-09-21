import { useTranslation } from "react-i18next";
import CustomTab from "../CustomTab.jsx";
import {
  useDragSelector,
  useTerminalSelector,
  useReconnectSelector,
} from "../../store/AppContext.jsx";
import { shallowEqual } from "../../store/subscriptionStore.js";
import {
  buildReconnectBadgeTooltip,
  getReconnectStatusColor,
} from "../../modules/terminal/reconnectTabStatus.js";
import { DISK_ALERT_TAB_COLOR } from "./appShellUtils.js";

export default function SessionTab({
  tab,
  index,
  splitLayouts,
  paneRegistry,
  diskAlert,
  ...props
}) {
  const { t } = useTranslation();
  const configs = useTerminalSelector(
    (instances) =>
      [tab.id, ...(splitLayouts[tab.id]?.panes || [])].map(
        (id) => instances[`${id}-config`],
      ),
    shallowEqual,
  );
  const tabReconnectStatusValue = useReconnectSelector(
    (state) => state.reconnectStateByTabId[tab.id],
  );
  const dragProps = useDragSelector(
    (state) => ({
      isDragSource: state.draggedTabIndex === index,
      dragSessionActive: state.draggedTabIndex !== null,
      isDraggedOver:
        state.draggedTabIndex !== null &&
        state.dragOverTabIndex === index &&
        state.draggedTabIndex !== index,
      dragInsertPosition:
        state.draggedTabIndex !== null && state.dragOverTabIndex === index
          ? state.dragInsertPosition
          : null,
    }),
    shallowEqual,
  );
  // 窗格标题：连接名 / host / 拖入时的原标签名 / 序号兑底
  const buildPaneLabel = (tab, paneId) => {
    if (paneId === tab.id) return tab.label;
    const registry = paneRegistry[paneId];
    if (registry?.label) return registry.label;
    const config =
      configs[1 + (splitLayouts[tab.id]?.panes || []).indexOf(paneId)];
    if (config?.name) return config.name;
    if (config?.host) {
      return `${config.username ? `${config.username}@` : ""}${config.host}`;
    }
    const layout = splitLayouts[tab.id];
    const paneIndex = layout ? layout.panes.indexOf(paneId) : -1;
    return t("terminal.pane.default", {
      n: Math.max(1, paneIndex + 1),
    });
  };

  const tabConfig = configs[0] || {};
  const persistedLabel = [tab.label, tab.title, tabConfig.name, tabConfig.host]
    .map((candidate) => (typeof candidate === "string" ? candidate.trim() : ""))
    .find(Boolean);
  // 分屏宿主标签：加宽显示，拼接所有窗格的连接名
  const tabPaneLayout = splitLayouts[tab.id];
  const isSplitHost = Boolean(tabPaneLayout && tabPaneLayout.panes.length > 1);
  const mergedPaneLabel = isSplitHost
    ? tabPaneLayout.panes
        .map((paneId) => buildPaneLabel(tab, paneId))
        .join(" + ")
    : null;
  const label =
    index === 0
      ? t("terminal.welcome")
      : mergedPaneLabel ||
        persistedLabel ||
        (tab.type === "local"
          ? t("common.componentNames.localTerminal")
          : t("common.componentNames.terminal"));
  const tabReconnectStatus = tabReconnectStatusValue;
  const tabReconnectColor = getReconnectStatusColor(tabReconnectStatus?.state);
  const tabReconnectTooltip = buildReconnectBadgeTooltip(t, tabReconnectStatus);
  // 磁盘空间告警：标签变黄（重连状态优先展示）
  const tabDiskAlert = diskAlert;
  const tabDiskAlertColor = tabDiskAlert ? DISK_ALERT_TAB_COLOR : null;
  const tabDiskAlertSummary = tabDiskAlert
    ? (tabDiskAlert.mounts || [])
        .map((m) => `${m.mount} ${m.usedPercent}%`)
        .join(", ")
    : "";

  return (
    <CustomTab
      {...props}
      {...dragProps}
      index={index}
      tabId={tab.id}
      label={label}
      mergedLabel={isSplitHost}
      statusColor={tabReconnectColor || tabDiskAlertColor || null}
      statusTooltip={
        tabReconnectTooltip ||
        (tabDiskAlert
          ? t("diskAlert.tabTooltip", { summary: tabDiskAlertSummary })
          : null)
      }
    />
  );
}
