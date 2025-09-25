import { useSyncExternalStore, useMemo, useCallback } from "react";

// Global transfer state keyed by tabId so we can persist progress while the
// File Manager sidebar is hidden.
const transferState = new Map();
const listeners = new Map();
const autoRemovalTimers = new Map();
const EMPTY_TRANSFER_LIST = Object.freeze([]);

const generateTransferId = () =>
  `transfer_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

const notify = (tabId) => {
  const tabListeners = listeners.get(tabId);
  if (!tabListeners) return;

  for (const listener of tabListeners) {
    try {
      listener();
    } catch (error) {
      console.error(
        "sftpTransferStore: listener execution failed",
        error,
      );
    }
  }
};

const getTransfersInternal = (tabId) =>
  transferState.get(tabId) ?? EMPTY_TRANSFER_LIST;

const setTransfersInternal = (tabId, transfers) => {
  if (!transfers || transfers.length === 0) {
    transferState.delete(tabId);
  } else {
    transferState.set(tabId, transfers);
  }
  notify(tabId);
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
    // Removing transfer triggers listeners so guard against missing tab.
    removeTransfer(tabId, transferId);
  }, Math.max(0, delayMs));

  autoRemovalTimers.set(transferId, { timer, tabId });
};

const addTransfer = (tabId, transferData) => {
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
  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  const { autoRemoveDelay, ...rest } = updateData || {};

  const next = transfers.map((transfer) =>
    transfer.transferId === transferId ? { ...transfer, ...rest } : transfer,
  );

  setTransfersInternal(tabId, next);

  if (typeof autoRemoveDelay === "number") {
    scheduleAutoRemoval(tabId, transferId, autoRemoveDelay);
  } else if (rest && rest.isCancelled) {
    scheduleAutoRemoval(tabId, transferId, 1000);
  }
};

const removeTransfer = (tabId, transferId) => {
  clearAutoRemovalTimer(transferId);

  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  const next = transfers.filter((transfer) => transfer.transferId !== transferId);
  setTransfersInternal(tabId, next);
};

const clearCompletedTransfers = (tabId) => {
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
  const transfers = getTransfersInternal(tabId);
  if (transfers.length === 0) return;

  for (const transfer of transfers) {
    clearAutoRemovalTimer(transfer.transferId);
  }

  transferState.delete(tabId);
  notify(tabId);
};

const scheduleTransferCleanup = (tabId, transferId, delayMs) => {
  scheduleAutoRemoval(tabId, transferId, delayMs);
};

const subscribe = (tabId, listener) => {
  if (!listeners.has(tabId)) {
    listeners.set(tabId, new Set());
  }

  const tabListeners = listeners.get(tabId);
  tabListeners.add(listener);

  return () => {
    tabListeners.delete(listener);
    if (tabListeners.size === 0) {
      listeners.delete(tabId);
    }
  };
};

const getSnapshot = (tabId) => getTransfersInternal(tabId);

export const useSftpTransfers = (tabId) => {
  const subscribeToStore = useCallback(
    (listener) => subscribe(tabId, listener),
    [tabId],
  );

  const getCurrentSnapshot = useCallback(() => getSnapshot(tabId), [tabId]);

  const transferList = useSyncExternalStore(
    subscribeToStore,
    getCurrentSnapshot,
    getCurrentSnapshot,
  );

  const helpers = useMemo(() => {
    return {
      addTransferProgress: (transferData) => addTransfer(tabId, transferData),
      updateTransferProgress: (transferId, updateData) =>
        updateTransfer(tabId, transferId, updateData),
      removeTransferProgress: (transferId) =>
        removeTransfer(tabId, transferId),
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

export const __sftpTransferStoreInternals = {
  // Only exposed for testing.
  _getTransfersInternal: getTransfersInternal,
  _clearAll: () => {
    for (const timer of autoRemovalTimers.values()) {
      clearTimeout(timer.timer);
    }
    autoRemovalTimers.clear();
    transferState.clear();
    listeners.clear();
  },
};

