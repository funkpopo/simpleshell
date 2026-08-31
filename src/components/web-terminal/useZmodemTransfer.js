import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useGlobalTransfers } from "../../store/globalTransferStore.js";
import { normalizeTransferProgress } from "../../utils/transferTaskHelpers.js";
import { processCache } from "../../modules/terminal/controller/terminalSessionStore.js";

// 完成/失败后任务在全局传输 UI 中的保留时长（与 SFTP 传输一致）
const DONE_CLEANUP_DELAY_MS = 3000;
const ERROR_CLEANUP_DELAY_MS = 5000;

const matchesTab = (payload, tabId) => {
  if (payload?.tabId) {
    return String(payload.tabId) === String(tabId);
  }
  const cachedProcessId = processCache[tabId];
  if (cachedProcessId !== undefined && cachedProcessId !== null) {
    return String(payload?.processId) === String(cachedProcessId);
  }
  return false;
};

const createSessionState = () => ({
  transferId: null,
  processId: null,
  direction: "download",
  bytesDone: 0,
  bytesTotal: 0,
  currentSize: 0,
  currentTransferred: 0,
  filesDone: 0,
  filesTotal: 0,
  lastSpeedSample: null,
  speed: 0,
});

/**
 * ZMODEM（rz/sz）传输进度：订阅主进程 zmodem:event 事件，把传输会话
 * 写入全局传输状态（globalTransferStore），与 SFTP 传输共用
 * GlobalTransferBar / GlobalTransferFloat / TransferSidebar 的展示与取消入口，
 * 不引入额外的 ZMODEM 专属传输 UI。
 */
export function useZmodemTransfer({ tabId }) {
  const { t } = useTranslation();
  const {
    addTransferProgress,
    updateTransferProgress,
    scheduleTransferCleanup,
  } = useGlobalTransfers(tabId);

  const sessionRef = useRef(null);
  const helpersRef = useRef({
    addTransferProgress,
    updateTransferProgress,
    scheduleTransferCleanup,
    t,
  });
  helpersRef.current = {
    addTransferProgress,
    updateTransferProgress,
    scheduleTransferCleanup,
    t,
  };

  const handleEvent = useCallback((payload) => {
    const session = sessionRef.current;
    const {
      addTransferProgress: add,
      updateTransferProgress: update,
      scheduleTransferCleanup: schedule,
      t: translate,
    } = helpersRef.current;
    const type = payload?.type;

    // start：新建全局传输任务
    if (type === "start") {
      const direction = payload.direction === "upload" ? "upload" : "download";
      const nextSession = createSessionState();
      nextSession.processId = payload.processId;
      nextSession.direction = direction;
      nextSession.filesTotal = payload.filesTotal || 0;
      sessionRef.current = nextSession;

      nextSession.transferId = add({
        type: direction,
        progress: 0,
        fileName: "",
        statusText:
          direction === "upload"
            ? translate("fileManager.transfer.status.preparingUpload")
            : translate("fileManager.transfer.status.downloading"),
        currentFile: "",
        transferredBytes: 0,
        totalBytes: 0,
        transferSpeed: 0,
        remainingTime: 0,
        processedFiles: 0,
        totalFiles: nextSession.filesTotal,
        // 通过现有 cancelTransfer 通道路由到 ZMODEM 取消（见 fileHandlers）
        transferKey: `zmodem:${payload.processId}`,
      });
      return;
    }

    if (!session || !session.transferId) {
      return;
    }

    if (type === "offer") {
      if (payload.batchSummary) {
        // 上传：文件选择完成，汇总信息（总大小 / 总文件数 / 文件名列表）
        session.filesTotal = payload.filesTotal || session.filesTotal;
        session.bytesTotal = payload.fileSize || session.bytesTotal;
        update(session.transferId, {
          fileName: payload.fileName || "",
          totalBytes: session.bytesTotal,
          totalFiles: session.filesTotal,
          statusText: translate("fileManager.transfer.status.uploading"),
        });
        return;
      }

      // 逐文件 offer：FileStart（下载）或开始发送某个文件（上传）
      session.currentSize = payload.fileSize || 0;
      session.currentTransferred = 0;
      if (session.direction === "download") {
        // 下载时对端逐个声明文件，总大小 = 已完成 + 当前文件
        session.bytesTotal = session.bytesDone + session.currentSize;
      }
      update(
        session.transferId,
        normalizeTransferProgress({
          fileName: payload.fileName || "",
          currentFile: payload.fileName || "",
          totalBytes: session.bytesTotal,
          totalFiles: session.filesTotal,
        }),
      );
      return;
    }

    if (type === "progress") {
      session.currentTransferred = payload.transferred || 0;
      const transferredBytes = session.bytesDone + session.currentTransferred;
      const totalBytes =
        session.direction === "upload"
          ? session.bytesTotal
          : session.bytesDone + session.currentSize;

      // 平滑速率（EMA）
      const now = Date.now();
      const sample = session.lastSpeedSample;
      if (sample && now > sample.at && transferredBytes >= sample.transferred) {
        const instant =
          ((transferredBytes - sample.transferred) / (now - sample.at)) * 1000;
        session.speed = session.speed
          ? session.speed * 0.6 + instant * 0.4
          : instant;
      }
      session.lastSpeedSample = { at: now, transferred: transferredBytes };

      const progress =
        totalBytes > 0
          ? Math.min(99, Math.round((transferredBytes / totalBytes) * 100))
          : 0;
      const speed = session.speed || 0;
      update(
        session.transferId,
        normalizeTransferProgress({
          progress,
          transferredBytes,
          totalBytes,
          transferSpeed: Math.round(speed),
          remainingTime:
            speed > 0 && totalBytes > transferredBytes
              ? (totalBytes - transferredBytes) / speed
              : 0,
        }),
      );
      return;
    }

    if (type === "file-done") {
      session.filesDone = payload.filesDone ?? session.filesDone + 1;
      session.bytesDone += session.currentSize || payload.transferred || 0;
      session.currentSize = 0;
      session.currentTransferred = 0;
      update(
        session.transferId,
        normalizeTransferProgress({
          processedFiles: session.filesDone,
          currentFile: "",
        }),
      );
      return;
    }

    if (type === "end") {
      const status = payload.status || "complete";
      if (status === "complete") {
        update(
          session.transferId,
          normalizeTransferProgress({
            progress: 100,
            processedFiles: session.filesTotal || session.filesDone,
            currentFile: "",
          }),
        );
        schedule(session.transferId, DONE_CLEANUP_DELAY_MS);
      } else if (status === "cancelled") {
        update(session.transferId, {
          isCancelled: true,
          statusText: translate("fileManager.transfer.status.cancelled"),
          cancelMessage: translate(
            "fileManager.transfer.status.transferCancelled",
          ),
        });
        // globalTransferStore 会自动调度已取消任务的延迟移除
      } else {
        update(session.transferId, {
          error:
            payload.error || translate("fileManager.transfer.status.failed"),
        });
        schedule(session.transferId, ERROR_CLEANUP_DELAY_MS);
      }
      sessionRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!window.terminalAPI?.onZmodemEvent) {
      return undefined;
    }

    let disposed = false;

    const cleanup = window.terminalAPI.onZmodemEvent((payload) => {
      if (disposed || !payload || !matchesTab(payload, tabId)) {
        return;
      }
      handleEvent(payload);
    });

    return () => {
      disposed = true;
      if (typeof cleanup === "function") {
        cleanup();
      }
    };
  }, [handleEvent, tabId]);

  useEffect(() => {
    return () => {
      sessionRef.current = null;
    };
  }, []);
}

export default useZmodemTransfer;
