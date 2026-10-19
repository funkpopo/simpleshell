import * as React from "react";
import { useCallback, useRef } from "react";
import { useAppStore, useAppDispatch } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import {
  getParentTabId,
  MAX_PANES,
} from "../../features/terminal/model/paneLayout.js";
import { useTranslation } from "react-i18next";
import { useCleanupManager } from "../../shared/hooks/useAutoCleanup.js";
import { useNotification } from "../../shared/notifications/NotificationContext.jsx";
import {
  disposeTerminalSession,
  processCache as sessionProcessCache,
} from "../../features/terminal/runtime/terminalSessionStore.js";
import { notifyTerminalResize } from "../appShellUtils.js";

export default function useSessionDragDrop({
  splitLayoutsRef,
  latestTabsForActionsRef,
  handleCloseTabRef,
  currentTab,
  paneRegistryRef,
  refreshTerminalSession,
  tabs,
}) {
  const dispatch = useAppDispatch();
  const appStore = useAppStore();
  const eventManager = useCleanupManager();
  const { t } = useTranslation();
  const { showWarning } = useNotification();
  const dragRafRef = React.useRef(null);
  const pendingDragStateRef = React.useRef(null);
  const setPaneDropZone = useCallback(
    (zone) => dispatch(actions.setPaneDropZone(zone)),
    [dispatch],
  );
  const setPaneDragId = useCallback(
    (id) => dispatch(actions.setPaneDragId(id)),
    [dispatch],
  );
  const setPaneDragOverId = useCallback(
    (id) => dispatch(actions.setPaneDragOverId(id)),
    [dispatch],
  );
  const teardownPaneSession = useCallback(
    (paneId) => {
      const processId = sessionProcessCache[paneId];
      if (processId)
        window.terminalAPI
          .killProcess(processId)
          .catch((error) => console.warn(error));
      disposeTerminalSession(paneId);
      dispatch(actions.forgetSessions([paneId]));
    },
    [dispatch],
  );
  const cleanupDragStateRef = useRef(null);
  const handleClosePane = useCallback(
    (tabId, paneId) => {
      const layout = splitLayoutsRef.current[tabId];
      if (!layout) {
        const index = latestTabsForActionsRef.current.findIndex(
          (tab) => tab.id === tabId,
        );
        if (index >= 0 && tabId === paneId) handleCloseTabRef.current(index);
        return;
      }
      if (!layout.panes.includes(paneId)) return;
      dispatch(actions.removePane(tabId, paneId));
      teardownPaneSession(paneId);
      notifyTerminalResize();
    },
    [dispatch, teardownPaneSession],
  );
  const handleCloseOtherPanes = useCallback(
    (tabId, paneId) => {
      const layout = splitLayoutsRef.current[tabId];
      if (!layout?.panes.includes(paneId)) return;
      // 根窗格最后移除，使前面的删除始终使用同一宿主。
      const closing = layout.panes.filter(
        (id) => id !== paneId && id !== tabId,
      );
      if (paneId !== tabId) closing.push(tabId);
      closing.forEach((id) => {
        dispatch(actions.removePane(tabId, id));
        teardownPaneSession(id);
      });
      notifyTerminalResize();
    },
    [dispatch, teardownPaneSession],
  );
  const handleFocusPane = useCallback(
    (tabId, paneId) => {
      dispatch(actions.focusPane(tabId, paneId));
    },
    [dispatch],
  );
  const handleSetRatios = useCallback(
    (tabId, ratios) => {
      dispatch(actions.setRatios(tabId, ratios));
    },
    [dispatch],
  );
  const adoptTabAsPane = useCallback(
    (targetTabId, sourceTab, zone) => {
      if (!targetTabId || !sourceTab || sourceTab.id === targetTabId) return;
      if (sourceTab.id === "welcome") return;
      const targetLayout = splitLayoutsRef.current[targetTabId] || null;
      const currentPanes = targetLayout
        ? [...targetLayout.panes]
        : [targetTabId];
      if (currentPanes.includes(sourceTab.id)) return;
      if (currentPanes.length >= MAX_PANES) {
        showWarning(t("terminal.pane.maxReached"));
        return;
      }
      if (splitLayoutsRef.current[sourceTab.id]) {
        showWarning(t("terminal.pane.splitSourceBlocked"));
        return;
      }
      dispatch(actions.adoptTab(targetTabId, sourceTab.id, zone));
      notifyTerminalResize();
    },
    [currentTab, dispatch, showWarning, t],
  );
  const handleTerminalAreaDragOver = useCallback(
    (e) => {
      const { draggedTabIndex, paneDropZone } = appStore.getState();
      if (draggedTabIndex === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const rect = e.currentTarget.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const edge = 0.25;
      let zone = "center";
      if (relX < edge) zone = "left";
      else if (relX > 1 - edge) zone = "right";
      else if (relY < edge) zone = "top";
      else if (relY > 1 - edge) zone = "bottom";
      if (paneDropZone !== zone) {
        setPaneDropZone(zone);
      }
    },
    [appStore, setPaneDropZone],
  );
  const handleTerminalAreaDragLeave = useCallback((e) => {
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setPaneDropZone(null);
    }
  }, []);
  const handleTerminalAreaDrop = useCallback(
    (e) => {
      e.preventDefault();
      const { draggedTabIndex, paneDropZone } = appStore.getState();
      const zone = paneDropZone || "center";
      setPaneDropZone(null);
      if (draggedTabIndex === null) return;
      const sourceTab = latestTabsForActionsRef.current[draggedTabIndex];
      const targetTab = latestTabsForActionsRef.current[currentTab];
      cleanupDragStateRef.current?.();
      if (!sourceTab || !targetTab || sourceTab.id === targetTab.id) return;
      if (sourceTab.id === "welcome" || targetTab.id === "welcome") return;
      adoptTabAsPane(targetTab.id, sourceTab, zone);
    },
    [adoptTabAsPane, currentTab, appStore, setPaneDropZone],
  );
  const handlePaneDragStart = useCallback((e, paneId) => {
    setPaneDragId(paneId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData(
      "application/json",
      JSON.stringify({
        type: "pane",
        paneId,
      }),
    );
  }, []);
  const handlePaneDragOver = useCallback(
    (e, paneId) => {
      const { paneDragId, paneDragOverId } = appStore.getState();
      if (paneDragId === null || paneDragId === paneId) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = "move";
      if (paneDragOverId !== paneId) {
        setPaneDragOverId(paneId);
      }
    },
    [appStore, setPaneDragOverId],
  );
  const handlePaneDrop = useCallback(
    (e, targetPaneId) => {
      const { paneDragId } = appStore.getState();
      if (paneDragId === null || paneDragId === targetPaneId) return;
      e.preventDefault();
      e.stopPropagation();
      const sourceSessionKey = paneDragId;
      setPaneDragId(null);
      setPaneDragOverId(null);
      const tabId = getParentTabId(sourceSessionKey, paneRegistryRef.current);
      dispatch(actions.swapPanes(tabId, sourceSessionKey, targetPaneId));
      notifyTerminalResize();
    },
    [dispatch, appStore, setPaneDragId, setPaneDragOverId],
  );
  const handlePaneDragEnd = useCallback(() => {
    setPaneDragId(null);
    setPaneDragOverId(null);
  }, []);
  const handlePaneShortcutRef = useRef(() => {});
  handlePaneShortcutRef.current = (action) => {
    const tab = latestTabsForActionsRef.current[currentTab];
    if (!tab || tab.id === "welcome") return;
    const layout = splitLayoutsRef.current[tab.id];
    const sessionKey = layout?.focusedPaneId || tab.id;
    if (action === "close") {
      handleClosePane(tab.id, sessionKey);
    }
  };
  const paneActionHandlerRef = useRef(() => {});
  paneActionHandlerRef.current = (detail) => {
    if (!detail?.sessionKey) return;
    const tabId = getParentTabId(detail.sessionKey, paneRegistryRef.current);
    switch (detail.action) {
      case "closePane":
        handleClosePane(tabId, detail.sessionKey);
        break;
      case "closeOtherPanes":
        handleCloseOtherPanes(tabId, detail.sessionKey);
        break;
      case "reconnect":
        void refreshTerminalSession(detail.sessionKey);
        break;
      case "createSyncGroup":
        dispatch(actions.createSyncGroup(detail.sessionKey));
        break;
      case "joinSyncGroup":
        if (detail.groupId) {
          dispatch(actions.joinSyncGroup(detail.sessionKey, detail.groupId));
        }
        break;
      case "leaveSyncGroup":
        dispatch(actions.removeTabFromSyncGroups(detail.sessionKey));
        break;
      default:
        break;
    }
  };
  React.useEffect(() => {
    const handler = (event) => paneActionHandlerRef.current(event.detail);
    const remove = eventManager.addEventListener(
      window,
      "terminalPaneAction",
      handler,
    );
    return () => remove();
  }, [eventManager]);
  const handleDragStart = useCallback(
    (e, index) => {
      // 不允许拖动欢迎标签
      if (tabs[index].id === "welcome") {
        e.preventDefault();
        return;
      }
      dispatch(actions.setDraggedTab(index));
      // 设置一些拖动时的数据
      e.dataTransfer.effectAllowed = "move";
    },
    [tabs, dispatch],
  );
  const handleDragOver = useCallback(
    (e, index) => {
      e.preventDefault();
      // 不允许放置到欢迎页
      if (index === 0) return;
      // 忽略无效拖拽或拖拽到自身
      const { draggedTabIndex, dragOverTabIndex } = appStore.getState();
      if (draggedTabIndex === null || draggedTabIndex === index) {
        // 清除悬停状态
        if (dragOverTabIndex !== null) {
          dispatch(actions.setDragOverTab(null));
          dispatch(actions.setDragInsertPosition(null));
        }
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const tabWidth = rect.width;
      // 两侧 30% 为排序插入区（before/after），中段为「叠加合并」区：
      // 拖拽标签页叠加到目标标签上，合并为目标标签的分屏窗格
      const relX = tabWidth > 0 ? mouseX / tabWidth : 0.5;
      const position = relX < 0.3 ? "before" : relX > 0.7 ? "after" : "merge";
      e.dataTransfer.dropEffect = "move";

      // 记录待更新状态
      pendingDragStateRef.current = {
        index,
        position,
      };
      if (!dragRafRef.current) {
        dragRafRef.current = requestAnimationFrame(() => {
          const pending = pendingDragStateRef.current;
          dragRafRef.current = null;
          if (!pending) return;
          const { dragOverTabIndex, dragInsertPosition, draggedTabIndex } =
            appStore.getState();
          if (draggedTabIndex === null) return;
          if (
            pending.index !== dragOverTabIndex ||
            pending.position !== dragInsertPosition
          ) {
            dispatch(actions.setDragOverTab(pending.index));
            dispatch(actions.setDragInsertPosition(pending.position));
          }
        });
      }
    },
    [appStore, dispatch],
  );
  const handleDragLeave = useCallback(
    (e) => {
      if (!e.currentTarget.contains(e.relatedTarget)) {
        dispatch(actions.setDragOverTab(null));
        dispatch(actions.setDragInsertPosition(null));
      }
    },
    [dispatch],
  );
  const cleanupDragState = useCallback(() => {
    if (dragRafRef.current) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    pendingDragStateRef.current = null;
    dispatch(actions.resetDragState());
  }, [dispatch]);
  cleanupDragStateRef.current = cleanupDragState;
  const reorderTab = useCallback(
    (sourceIndex, targetIndex, position) => {
      // 验证参数
      if (sourceIndex === null || targetIndex === null) return;
      if (!tabs[sourceIndex]) return;
      if (tabs[sourceIndex].id === "welcome") return;
      if (targetIndex === 0) return; // 不能放到欢迎页之前

      // 计算最终插入位置
      // 如果位置是 "after"，最终位置应该是 targetIndex + 1
      // 如果位置是 "before"，最终位置就是 targetIndex
      let finalInsertIndex =
        position === "after" ? targetIndex + 1 : targetIndex;

      // 确保不会插入到欢迎页之前
      if (finalInsertIndex < 1) finalInsertIndex = 1;

      // 如果源标签在目标位置之前，移除源标签后，后面的索引都会减1
      // 所以需要调整最终插入位置
      const adjustedInsertIndex =
        sourceIndex < finalInsertIndex
          ? finalInsertIndex - 1
          : finalInsertIndex;

      // 如果调整后的插入位置等于源位置，不需要移动
      if (adjustedInsertIndex === sourceIndex) return;

      // 执行排序
      const newTabs = [...tabs];
      const [draggedTab] = newTabs.splice(sourceIndex, 1);
      newTabs.splice(adjustedInsertIndex, 0, draggedTab);
      dispatch(actions.setTabs(newTabs));

      // 更新当前选中标签页的索引
      let newCurrentTab = currentTab;
      if (currentTab === sourceIndex) {
        // 被拖拽的标签是当前选中的标签
        newCurrentTab = adjustedInsertIndex;
      } else if (
        sourceIndex < currentTab &&
        adjustedInsertIndex >= currentTab
      ) {
        // 源在当前之前，目标在当前或之后 -> 当前标签索引减1
        newCurrentTab = currentTab - 1;
      } else if (
        sourceIndex > currentTab &&
        adjustedInsertIndex <= currentTab
      ) {
        // 源在当前之后，目标在当前或之前 -> 当前标签索引加1
        newCurrentTab = currentTab + 1;
      }
      if (newCurrentTab !== currentTab) {
        dispatch(actions.setCurrentTab(newCurrentTab));
      }
    },
    [tabs, currentTab, dispatch],
  );
  const handleDrop = useCallback(
    (e, targetIndex) => {
      e.preventDefault();
      e.stopPropagation();

      // 不允许放置到欢迎页
      if (targetIndex === 0) {
        cleanupDragState();
        return;
      }
      const { draggedTabIndex, dragInsertPosition } = appStore.getState();
      let sourceIndex = draggedTabIndex;

      // 如果状态中没有源索引，尝试从 dataTransfer 获取
      if (sourceIndex === null) {
        try {
          const raw = e.dataTransfer?.getData("application/json");
          if (raw) {
            const payload = JSON.parse(raw);
            if (
              payload?.type === "tab" &&
              typeof payload.tabIndex === "number"
            ) {
              sourceIndex = payload.tabIndex;
            }
          }
        } catch (error) {
          console.warn("Failed to parse drag payload", error);
        }
      }

      // 验证源索引
      if (sourceIndex === null || sourceIndex === targetIndex) {
        cleanupDragState();
        return;
      }

      // 确定放置位置
      const rect = e.currentTarget?.getBoundingClientRect();
      let position = dragInsertPosition;
      if (!position && rect) {
        const relX = (e.clientX - rect.left) / rect.width;
        position = relX < 0.3 ? "before" : relX > 0.7 ? "after" : "merge";
      }
      if (!position) {
        position = "after";
      }

      // 中段叠加合并：把拖拽标签并入目标标签的分屏（会话保留，不迁移缓存）
      if (position === "merge") {
        const sourceTab = tabs[sourceIndex];
        const targetTab = tabs[targetIndex];
        cleanupDragState();
        if (
          !sourceTab ||
          !targetTab ||
          sourceTab.id === targetTab.id ||
          sourceTab.id === "welcome" ||
          targetTab.id === "welcome"
        ) {
          return;
        }
        adoptTabAsPane(targetTab.id, sourceTab, "center");
        return;
      }

      // 执行排序
      reorderTab(sourceIndex, targetIndex, position);
      cleanupDragState();
    },
    [appStore, cleanupDragState, reorderTab, tabs, adoptTabAsPane],
  );
  const handleDragEnd = useCallback(() => {
    cleanupDragState();
  }, [cleanupDragState]);
  return {
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    handleTerminalAreaDragOver,
    handleTerminalAreaDragLeave,
    handleTerminalAreaDrop,
    handleFocusPane,
    handleClosePane,
    handleSetRatios,
    handlePaneDragStart,
    handlePaneDragOver,
    handlePaneDrop,
    handlePaneDragEnd,
    handlePaneShortcutRef,
  };
}
