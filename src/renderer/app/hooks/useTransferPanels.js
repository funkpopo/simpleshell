import { useCallback, useEffect, useState } from "react";
import { applySftpTransferState } from "../../features/transfers/state/globalTransferStore.js";

/**
 * 传输面板（侧栏 + 底部栏浮动窗）与浮窗层级状态。
 * 从 AppShell 渐进拆分出的独立模块（progressive split），行为不变：
 * - transferSidebarOpen / resumableTransferCount：传输侧栏
 * - transferFloatOpen / transferFloatInitialTransfer：传输进度浮动窗
 * - lastActiveFloatWindow：最后激活的浮动窗口（"ai" | "transfer"，控制 z-index 层叠顺序）
 */
export default function useTransferPanels() {
  const [transferFloatOpen, setTransferFloatOpen] = useState(false);
  const [transferFloatInitialTransfer, setTransferFloatInitialTransfer] =
    useState(null);
  const [transferSidebarOpen, setTransferSidebarOpen] = useState(false);
  const [resumableTransferCount, setResumableTransferCount] = useState(0);
  const [lastActiveFloatWindow, setLastActiveFloatWindow] = useState("ai");

  // 传输状态推送 → 全局传输 store（订阅只装一次）
  useEffect(
    () => window.terminalAPI.onSftpTransferState(applySftpTransferState),
    [],
  );

  // 打开全局传输浮动窗口（与传输侧栏定位重叠，互斥打开）
  const handleOpenTransferFloat = useCallback((transfer) => {
    setTransferSidebarOpen(false);
    setTransferFloatInitialTransfer(transfer);
    setTransferFloatOpen(true);
  }, []);

  // 关闭全局传输浮动窗口
  const handleCloseTransferFloat = useCallback(() => {
    setTransferFloatOpen(false);
    setTransferFloatInitialTransfer(null);
  }, []);

  // 切换全局传输浮动窗口
  const handleToggleTransferFloat = useCallback(
    (transfer) => {
      if (transferFloatOpen) {
        handleCloseTransferFloat();
      } else {
        handleOpenTransferFloat(transfer);
      }
    },
    [transferFloatOpen, handleCloseTransferFloat, handleOpenTransferFloat],
  );

  // 侧栏按钮点击（与浮动窗互斥；同时更新浮窗层级）
  const handleToggleTransferSidebar = useCallback(() => {
    const next = !transferSidebarOpen;
    setTransferSidebarOpen(next);
    if (next) {
      handleCloseTransferFloat();
      setLastActiveFloatWindow("transfer");
    }
  }, [transferSidebarOpen, handleCloseTransferFloat]);

  return {
    transferFloatOpen,
    transferFloatInitialTransfer,
    setTransferFloatOpen,
    transferSidebarOpen,
    setTransferSidebarOpen,
    resumableTransferCount,
    setResumableTransferCount,
    lastActiveFloatWindow,
    setLastActiveFloatWindow,
    handleOpenTransferFloat,
    handleCloseTransferFloat,
    handleToggleTransferFloat,
    handleToggleTransferSidebar,
  };
}
