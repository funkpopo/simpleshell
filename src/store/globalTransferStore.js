import { useSyncExternalStore, useMemo, useCallback } from "react";

/**
 * 全局传输状态管理
 * 用于管理所有SFTP传输任务的状态，支持底部栏显示和浮动窗口查看
 */

// 全局传输状态，按tabId组织
const transferState = new Map();
// 监听器集合
const listeners = new Set();
// 自动移除定时器
const autoRemovalTimers = new Map();
// 空传输列表常量
const EMPTY_TRANSFER_LIST = Object.freeze([]);
// 快照缓存
const snapshotCache = new Map();

const generateTransferId = () =>
  `transfer_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

const notify = () => {
  // 清除快照缓存，强制重新计算
  snapshotCache.clear();

  for (const listener of listeners) {
    try {
      listener();
    } catch (error) {
      console.error("globalTransferStore: listener execution failed", error);
    }
  }
};

const getTransfersInternal = (tabId) => {
  if (!tabId) return EMPTY_TRANSFER_LIST;
  return transferState.get(tabId) ?? EMPTY_TRANSFER_LIST;
};

const getAllTransfersInternal = () => {
  const allTransfers = [];
  for (const [tabId, transfers] of transferState.entries()) {
    allTransfers.push(
      ...transfers.map((t) => ({
        ...t,
        tabId,
      }))
    );
  }
  return allTransfers;
};

const setTransfersInternal = (tabId, transfers) => {
  if (!tabId) return;

  if (!transfers || transfers.length === 0) {
    transferState.delete(tabId);
  } else {
    transferState.set(tabId, transfers);
  }
  notify();
};

const clearAutoRemovalTimer = (transferId) => {
  const timerRef = autoRemovalTimers.get(transferId);
  if (timerRef) {
    clearTimeout(timerRef.timer);
    autoRemovalTimers.delete(transferId);
  }
};

const scheduleAutoRemoval = (tabId, transferId, delayMs = 1000) => {
  clearAutoRemovalTimer(transferId);

  const timer = setTimeout(() => {
    autoRemovalTimers.delete(transferId);
    removeTransfer(tabId, transferId);
  }, Math.max(0, delayMs));

  autoRemovalTimers.set(transferId, { timer, tabId });
};

const addTransfer = (tabId, transferData) => {
  if (!tabId) return null;

  const transferId = transferData.transferId || generateTransferId();
  const transfers = getTransfersInternal(tabId);

  const newTransfer = {
    transferId,
    ...transferData,
    startTime: transferData.startTime || Date.now(),
  };

  setTransfersInternal(tabId, [...transfers, newTransfer]);
  return transferId;
};

const updateTransfer = (tabId, transferId, updateData = {}) => {
  if (!tabId) return;

  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  const { autoRemoveDelay, ...rest } = updateData || {};

  const next = transfers.map((transfer) =>
    transfer.transferId === transferId ? { ...transfer, ...rest } : transfer
  );

  setTransfersInternal(tabId, next);

  if (typeof autoRemoveDelay === "number") {
    scheduleAutoRemoval(tabId, transferId, autoRemoveDelay);
  } else if (rest && rest.isCancelled) {
    scheduleAutoRemoval(tabId, transferId, 1000);
  }
};

const removeTransfer = (tabId, transferId) => {
  if (!tabId) return;

  clearAutoRemovalTimer(transferId);

  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  const next = transfers.filter((transfer) => transfer.transferId !== transferId);
  setTransfersInternal(tabId, next);
};

const clearCompletedTransfers = (tabId) => {
  if (!tabId) return;

  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  const remaining = transfers.filter((transfer) => {
    const isDone =
      transfer.progress >= 100 || transfer.isCancelled || transfer.error;
    if (isDone) {
      clearAutoRemovalTimer(transfer.transferId);
    }
    return !isDone;
  });

  setTransfersInternal(tabId, remaining);
};

const clearAllTransfers = (tabId) => {
  if (!tabId) return;

  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  for (const transfer of transfers) {
    clearAutoRemovalTimer(transfer.transferId);
  }

  transferState.delete(tabId);
  notify();
};

const scheduleTransferCleanup = (tabId, transferId, delayMs) => {
  if (!tabId) return;
  scheduleAutoRemoval(tabId, transferId, delayMs);
};

const subscribe = (listener) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (tabId) => {
  const key = tabId || '__all__';

  if (tabId) {
    const transfers = getTransfersInternal(tabId);
    // 检查是否有变化
    const cached = snapshotCache.get(key);
    if (cached && JSON.stringify(cached) === JSON.stringify(transfers)) {
      return cached;
    }
    snapshotCache.set(key, transfers);
    return transfers;
  }

  const allTransfers = getAllTransfersInternal();
  const cached = snapshotCache.get(key);
  if (cached && JSON.stringify(cached) === JSON.stringify(allTransfers)) {
    return cached;
  }
  snapshotCache.set(key, allTransfers);
  return allTransfers;
};

/**
 * React Hook - 获取特定tabId的传输列表
 */
export const useGlobalTransfers = (tabId) => {
  const subscribeToStore = useCallback(
    (listener) => subscribe(listener),
    []
  );

  const getCurrentSnapshot = useCallback(() => getSnapshot(tabId), [tabId]);

  const transferList = useSyncExternalStore(
    subscribeToStore,
    getCurrentSnapshot,
    getCurrentSnapshot
  );

  const helpers = useMemo(() => {
    return {
      addTransferProgress: (transferData) => addTransfer(tabId, transferData),
      updateTransferProgress: (transferId, updateData) =>
        updateTransfer(tabId, transferId, updateData),
      removeTransferProgress: (transferId) => removeTransfer(tabId, transferId),
      clearCompletedTransfers: () => clearCompletedTransfers(tabId),
      clearAllTransfers: () => clearAllTransfers(tabId),
      scheduleTransferCleanup: (transferId, delayMs) =>
        scheduleTransferCleanup(tabId, transferId, delayMs),
    };
  }, [tabId]);

  return {
    transferList,
    ...helpers,
  };
};

/**
 * React Hook - 获取所有传输任务（用于全局底部栏）
 */
export const useAllGlobalTransfers = () => {
  const subscribeToStore = useCallback(
    (listener) => subscribe(listener),
    []
  );

  const getCurrentSnapshot = useCallback(() => getSnapshot(null), []);

  const allTransfers = useSyncExternalStore(
    subscribeToStore,
    getCurrentSnapshot,
    getCurrentSnapshot
  );

  const helpers = useMemo(() => {
    return {
      addTransferProgress: (tabId, transferData) => addTransfer(tabId, transferData),
      updateTransferProgress: (tabId, transferId, updateData) =>
        updateTransfer(tabId, transferId, updateData),
      removeTransferProgress: (tabId, transferId) =>
        removeTransfer(tabId, transferId),
      clearCompletedTransfers: (tabId) => clearCompletedTransfers(tabId),
      clearAllTransfers: (tabId) => clearAllTransfers(tabId),
      scheduleTransferCleanup: (tabId, transferId, delayMs) =>
        scheduleTransferCleanup(tabId, transferId, delayMs),
    };
  }, []);

  return {
    allTransfers,
    ...helpers,
  };
};

/**
 * 内部测试API（仅用于测试）
 */
export const __globalTransferStoreInternals = {
  _getTransfersInternal: getTransfersInternal,
  _getAllTransfersInternal: getAllTransfersInternal,
  _clearAll: () => {
    for (const timer of autoRemovalTimers.values()) {
      clearTimeout(timer.timer);
    }
    autoRemovalTimers.clear();
    transferState.clear();
    listeners.clear();
  },
};
