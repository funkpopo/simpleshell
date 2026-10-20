import { Z_INDEX } from "../../shared/constants/zIndex.js";
import React, { memo, useMemo, useCallback, useState, useEffect } from "react";
import { createFloatingDialog } from "../../shared/ui/styledDialogs.jsx";
import {
  Box,
  Typography,
  IconButton,
  Button,
  Tooltip,
  Alert,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { RADIUS } from "../../theme";
import CloseIcon from "@mui/icons-material/Close";
import MinimizeIcon from "@mui/icons-material/Minimize";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import {
  useAllGlobalTransfers,
  useTransferHistory,
  cancelTransferWithNotice,
  clearCompletedTransfersForAllTabs,
} from "./state/globalTransferStore.js";
import { createAnchoredTransition } from "../../app/lib/launchAnimation.js";
import useDragResize from "../../shared/hooks/useDragResize.js";
import { sumTransferFileCount } from "./lib/transferCounts.js";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../shared/lib/formatters.js";
import {
  sidebarTitleBarSx,
  sidebarTitleIconButtonSx,
} from "../../shared/ui/sidebarItemStyles";
import TransferItemCard from "./components/TransferItemCard.jsx";
import WindowedSidebarList from "../../shared/ui/WindowedSidebarList.jsx";

// 默认和限制宽度
const DEFAULT_WIDTH = 320;
const MIN_WIDTH = 280;
const MAX_WIDTH = 500;

// 浮动窗口对话框样式（参考 AIChatWindow）
const FloatingDialog = createFloatingDialog({
  right: 50,
  bottom: 20,
  width: DEFAULT_WIDTH,
  maxWidth: "90vw",
  height: 500,
  // 极矮窗口下保留可用下限，同时不超过 maxHeight
  minHeight: "min(280px, 70vh)",
  maxHeight: "70vh",
  borderRadius: RADIUS.LG,
});

/**
 * 格式化文件大小（统一走共享 formatFileSize，1 位小数保持原有显示习惯）
 */
const formatSize = (bytes) => formatFileSize(bytes, 1);

/**
 * 传输浮动窗口组件
 */
const TransferSidebar = memo(
  ({
    open,
    onClose,
    onMinimize,
    zIndex,
    onFocus,
    anchorEl,
    onRecoveryCount,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const { allTransfers } = useAllGlobalTransfers();
    const { history, clearHistory, removeHistoryItemAt } = useTransferHistory();
    const [windowWidth, setWindowWidth] = useState(DEFAULT_WIDTH);
    const [isResizing, setIsResizing] = useState(false);
    const [resumable, setResumable] = useState([]);
    const [resumeError, setResumeError] = useState("");
    const [busyIds, setBusyIds] = useState(new Set());
    const refreshResumable = useCallback(async () => {
      const result = await window.terminalAPI.listResumableTransfers();
      if (!result.success) throw new Error(result.error);
      setResumable(result.tasks);
      onRecoveryCount?.(result.tasks.length);
    }, [onRecoveryCount]);
    useEffect(() => {
      let disposed = false;
      const refresh = () =>
        refreshResumable().catch((error) => {
          if (!disposed) setResumeError(error.message);
        });
      refresh();
      const timer = setInterval(refresh, 5000);
      return () => {
        disposed = true;
        clearInterval(timer);
      };
    }, [refreshResumable]);
    const recoveryAction = useCallback(
      async (task, action, algorithm) => {
        setBusyIds((ids) => new Set(ids).add(task.id));
        setResumeError("");
        try {
          const result =
            action === "discard"
              ? await window.terminalAPI.discardResumableTransfer(
                  task.tabId,
                  task.id,
                )
              : await window.terminalAPI.resumeTransfer(task.tabId, task.id, {
                  restart: action === "restart",
                  algorithm,
                });
          if (!result.success && !result.cancelled)
            throw new Error(result.error);
        } catch (error) {
          setResumeError(error.message);
        } finally {
          setBusyIds((ids) => {
            const next = new Set(ids);
            next.delete(task.id);
            return next;
          });
          await refreshResumable().catch((error) =>
            setResumeError(error.message),
          );
        }
      },
      [refreshResumable],
    );
    const handleVerify = useCallback(async (transfer, algorithm) => {
      try {
        const result = await window.terminalAPI.setTransferIntegrity(
          transfer.tabId,
          transfer.transferKey,
          algorithm,
        );
        if (!result.success) throw new Error(result.error);
      } catch (error) {
        setResumeError(error.message);
      }
    }, []);

    // 分离活跃传输和已完成传输
    const { activeTransfers, completedTransfers } = useMemo(() => {
      const active = [];
      const completed = [];

      if (allTransfers) {
        allTransfers.forEach((t) => {
          if (t.progress >= 100 || t.isCancelled || t.error) {
            completed.push(t);
          } else {
            active.push(t);
          }
        });
      }

      return { activeTransfers: active, completedTransfers: completed };
    }, [allTransfers]);

    const activeFileCount = useMemo(
      () => sumTransferFileCount(activeTransfers),
      [activeTransfers],
    );
    const completedFileCount = useMemo(
      () => sumTransferFileCount(completedTransfers),
      [completedTransfers],
    );
    const historyFileCount = useMemo(
      () => sumTransferFileCount(history),
      [history],
    );

    const transferRows = useMemo(() => {
      const rows = [];
      const addSection = (type, transfers, label) => {
        if (!transfers.length) return;
        rows.push({ type: "heading", key: `heading-${type}`, label });
        transfers.forEach((transfer, index) =>
          rows.push({
            type,
            transfer,
            index,
            key: `${type}-${transfer.historyId ?? transfer.id ?? `${transfer.tabId}-${transfer.transferId}`}`,
          }),
        );
      };
      addSection(
        "resumable",
        resumable,
        t("fileManager.transfer.resumableTasks", { count: resumable.length }),
      );
      addSection(
        "active",
        activeTransfers,
        t("fileManager.transfer.activeSection", { count: activeFileCount }),
      );
      addSection(
        "completed",
        completedTransfers,
        t("fileManager.transfer.completedSection", {
          count: completedFileCount,
        }),
      );
      addSection(
        "history",
        history,
        t("fileManager.transfer.historySection", { count: historyFileCount }),
      );
      return rows;
    }, [
      resumable,
      activeTransfers,
      completedTransfers,
      history,
      activeFileCount,
      completedFileCount,
      historyFileCount,
      t,
    ]);

    // 取消传输
    const handleCancelTransfer = useCallback(
      (transfer) => {
        cancelTransferWithNotice(
          transfer.tabId,
          transfer,
          t("fileManager.transfer.paused"),
        );
      },
      [t],
    );

    // 清除所有已完成的传输
    const handleClearCompleted = useCallback(() => {
      clearCompletedTransfersForAllTabs();
    }, []);

    // 拖拽调整宽度的处理（左侧手柄）
    // 上限与 FloatingDialog 的 maxWidth: 90vw 对齐，避免小视口下 min/max 冲突
    const startResize = useDragResize({
      getStart: () => ({ width: windowWidth }),
      getBounds: () => ({
        minWidth: Math.min(MIN_WIDTH, Math.floor(window.innerWidth * 0.9)),
        maxWidth: Math.min(MAX_WIDTH, Math.floor(window.innerWidth * 0.9)),
      }),
      onResize: ({ width }) => setWindowWidth(width),
      onStateChange: (mode) => setIsResizing(mode !== null),
    });
    const handleResizeStart = useMemo(
      () => startResize("width"),
      [startResize],
    );

    return (
      <FloatingDialog
        open={open}
        hideBackdrop
        disableEnforceFocus
        disableAutoFocus
        customwidth={windowWidth}
        customzindex={zIndex}
        onMouseDown={onFocus}
        {...createAnchoredTransition(anchorEl)}
      >
        {/* 左侧拖动调整宽度手柄 */}
        <Box
          onMouseDown={handleResizeStart}
          sx={{
            position: "absolute",
            left: -4,
            top: 0,
            bottom: 0,
            width: 8,
            cursor: "ew-resize",
            zIndex: Z_INDEX.raised,
            "&:hover": {
              backgroundColor: "primary.main",
              opacity: 0.3,
            },
            ...(isResizing && {
              backgroundColor: "primary.main",
              opacity: 0.5,
            }),
          }}
        />

        {/* 标题栏 */}
        <Box sx={sidebarTitleBarSx(theme)}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SwapVertIcon color="primary" />
            <Typography variant="subtitle1" fontWeight="medium">
              {t("fileManager.transfer.panelTitle")}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {onMinimize && (
              <Tooltip title={t("fileManager.transfer.minimize")}>
                <IconButton
                  onClick={onMinimize}
                  size="small"
                  aria-label={t("fileManager.transfer.minimize")}
                  sx={sidebarTitleIconButtonSx}
                >
                  <MinimizeIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t("common.close")}>
              <IconButton
                onClick={onClose}
                size="small"
                aria-label={t("common.close")}
                sx={sidebarTitleIconButtonSx}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* 工具栏 */}
        <Box
          sx={{
            display: "flex",
            gap: 1,
            p: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Button
            size="small"
            variant="outlined"
            startIcon={<DeleteSweepIcon />}
            onClick={handleClearCompleted}
            disabled={completedTransfers.length === 0}
            sx={{ fontSize: "0.75rem" }}
          >
            {t("fileManager.transfer.clearCompleted")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={clearHistory}
            disabled={history.length === 0}
            sx={{ fontSize: "0.75rem" }}
          >
            {t("fileManager.transfer.clearHistory")}
          </Button>
        </Box>

        {/* 内容区域 */}
        <Box
          className="app-scrollbar"
          sx={{
            flex: 1,
            minHeight: 0,
            display: "flex",
            flexDirection: "column",
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* 活跃传输 */}
          {resumeError && (
            <Alert severity="error" onClose={() => setResumeError("")}>
              {resumeError}
            </Alert>
          )}
          <WindowedSidebarList
            items={transferRows}
            className="transfer-virtualized-list app-scrollbar"
            estimatedRowHeight={128}
            getItemKey={(row) => row.key}
            renderItem={(row) => {
              if (row.type === "heading") {
                return (
                  <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
                    <Typography variant="caption" color="text.secondary">
                      {row.label}
                    </Typography>
                  </Box>
                );
              }
              if (row.type === "resumable") {
                const task = row.transfer;
                return (
                  <Box
                    key={task.id}
                    sx={{
                      my: 1,
                      p: 1,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                    }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {task.fileName}
                    </Typography>
                    <Typography variant="caption" display="block">
                      {task.username}@{task.host} ·{" "}
                      {formatSize(task.totalBytes)}
                    </Typography>
                    <Typography
                      variant="caption"
                      display="block"
                      sx={{ overflowWrap: "anywhere" }}
                    >
                      {task.direction === "download"
                        ? task.localPath
                        : task.remotePath}
                    </Typography>
                    {!task.tabId && (
                      <Typography variant="caption" color="warning.main">
                        {t("fileManager.transfer.connectToResume")}
                      </Typography>
                    )}
                    {task.error && (
                      <Typography variant="caption" color="error.main">
                        {task.error}
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      <Button
                        size="small"
                        disabled={
                          !task.tabId || !!task.error || busyIds.has(task.id)
                        }
                        onClick={() => recoveryAction(task, "resume")}
                      >
                        {t("fileManager.transfer.resume")}
                      </Button>
                      <Button
                        size="small"
                        disabled={!task.tabId || busyIds.has(task.id)}
                        onClick={() => recoveryAction(task, "restart")}
                      >
                        {t("fileManager.transfer.restart")}
                      </Button>
                      <Button
                        size="small"
                        disabled={
                          !task.tabId || !!task.error || busyIds.has(task.id)
                        }
                        onClick={() => recoveryAction(task, "resume", "sha256")}
                      >
                        {t("fileManager.transfer.resumeAndVerify")}
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={
                          (task.direction === "upload" && !task.tabId) ||
                          busyIds.has(task.id)
                        }
                        onClick={() => recoveryAction(task, "discard")}
                      >
                        {t("fileManager.transfer.cleanRetained")}
                      </Button>
                    </Box>
                  </Box>
                );
              }
              return (
                <TransferItemCard
                  variant="sidebar"
                  transfer={row.transfer}
                  isActive={row.type === "active"}
                  onCancel={
                    row.type === "active" ? handleCancelTransfer : undefined
                  }
                  onVerify={row.type === "active" ? handleVerify : undefined}
                  onDelete={
                    row.type === "history"
                      ? () => removeHistoryItemAt(row.index)
                      : undefined
                  }
                />
              );
            }}
          />

          {/* 空状态 */}
          {transferRows.length === 0 && (
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                color: "text.secondary",
                p: 4,
              }}
            >
              <SwapVertIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
              <Typography variant="body2">
                {t("fileManager.transfer.noTransfers")}
              </Typography>
            </Box>
          )}
        </Box>
      </FloatingDialog>
    );
  },
);

TransferSidebar.displayName = "TransferSidebar";

export default TransferSidebar;
