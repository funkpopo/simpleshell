import React, { useState, useEffect, memo } from "react";
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Fade,
  Tooltip,
  Tabs,
  Tab,
} from "@mui/material";
import Close from "@mui/icons-material/Close";
import Minimize from "@mui/icons-material/Minimize";
import ExpandMore from "@mui/icons-material/ExpandMore";
import ExpandLess from "@mui/icons-material/ExpandLess";
import SwapVert from "@mui/icons-material/SwapVert";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  useAllGlobalTransfers,
  useTransferHistory,
  cancelTransferWithNotice,
} from "./state/globalTransferStore.js";
import { Z_INDEX } from "../../shared/constants/zIndex.js";
import { sumTransferFileCount } from "./lib/transferCounts.js";
import { RADIUS } from "../../theme";
import TransferItemCard from "./components/TransferItemCard.jsx";

/** 浮窗「最近完成」区最多展示的历史记录数 */
const RECENT_HISTORY_LIMIT = 20;

/**
 * 全局传输进度浮动窗口
 * 以全局浮动窗口形式显示所有传输任务的详细进度；
 * 任务结束后进入「最近完成」区，仍可在小窗内查看其文件清单
 */
const GlobalTransferFloat = ({ open, onClose, initialTransfer }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const { allTransfers, removeTransferProgress } = useAllGlobalTransfers();
  const { history, removeHistoryItemById } = useTransferHistory();
  const [isMinimized, setIsMinimized] = useState(false);
  const [selectedTabId, setSelectedTabId] = useState(null);
  const [recentExpanded, setRecentExpanded] = useState(true);

  // 按tabId分组传输任务
  const transfersByTab = React.useMemo(() => {
    const grouped = new Map();
    allTransfers.forEach((transfer) => {
      const tabId = transfer.tabId;
      if (!grouped.has(tabId)) {
        grouped.set(tabId, []);
      }
      grouped.get(tabId).push(transfer);
    });
    return grouped;
  }, [allTransfers]);

  // 初始化选中的tabId
  useEffect(() => {
    if (open && initialTransfer && initialTransfer.tabId) {
      // 只在 tabId 不同时才更新，避免不必要的重新渲染
      if (selectedTabId !== initialTransfer.tabId) {
        setSelectedTabId(initialTransfer.tabId);
      }
    } else if (open && transfersByTab.size > 0 && !selectedTabId) {
      // 默认选择第一个tab
      setSelectedTabId([...transfersByTab.keys()][0]);
    }
  }, [open, initialTransfer, transfersByTab.size, selectedTabId]);

  // 如果窗口关闭,重置状态
  useEffect(() => {
    if (!open) {
      setIsMinimized(false);
    }
  }, [open]);

  // 既无传输任务也无可查看的完成记录时，自动关闭窗口
  useEffect(() => {
    if (open && allTransfers.length === 0 && history.length === 0) {
      onClose();
    }
  }, [open, allTransfers.length, history.length, onClose]);

  const handleMinimizeToggle = () => {
    setIsMinimized(!isMinimized);
  };

  const handleTabChange = (event, newValue) => {
    setSelectedTabId(newValue);
  };

  // TransferItemCard 回调签名统一为 (transfer)
  const handleCancelTransfer = (transfer) => {
    const tabId = transfer?.tabId ?? selectedTabId;
    if (tabId && transfer) {
      cancelTransferWithNotice(
        tabId,
        transfer,
        t("fileManager.transfer.status.transferCancelled"),
        { resetProgress: true },
      );
    }
  };

  const handleDeleteTransfer = (transfer) => {
    const tabId = transfer?.tabId ?? selectedTabId;
    if (tabId && transfer?.transferId) {
      removeTransferProgress(tabId, transfer.transferId);
    }
  };

  const handleDeleteHistory = (transfer) => {
    removeHistoryItemById(transfer?.historyId);
  };

  if (!open) {
    return null;
  }

  // 获取当前选中tab的传输列表
  const currentTransfers = selectedTabId
    ? transfersByTab.get(selectedTabId) || []
    : [];
  // 多标签页时最近完成记录跟随当前标签页筛选
  const showTabBar = transfersByTab.size > 1;
  const recentTransfers = (
    showTabBar
      ? history.filter((item) => item.tabId === selectedTabId)
      : history
  ).slice(0, RECENT_HISTORY_LIMIT);
  const activeTaskCount = allTransfers.filter(
    (item) => item.progress < 100 && !item.isCancelled && !item.error,
  ).length;

  return (
    <Fade in={open}>
      <Paper
        elevation={16}
        sx={{
          position: "fixed",
          bottom: 64, // 在底部栏上方，留出足够空间
          right: 24,
          // 视口钳制：小窗口下不溢出视口
          width: isMinimized
            ? "min(280px, calc(100vw - 48px))"
            : "min(360px, calc(100vw - 48px))",
          // 最小化时需容纳标题栏(约38px)+摘要行(约33px)，60px 会裁掉摘要
          maxHeight: isMinimized ? 72 : "min(500px, calc(100vh - 80px))",
          zIndex: Z_INDEX.floatWindow, // 低于模态对话框
          overflow: "hidden",
          borderRadius: `${RADIUS.LG}px`,
          backgroundColor: theme.palette.background.paper,
          border: `1px solid ${theme.palette.divider}`,
          transition: "all 0.3s ease-in-out",
          boxShadow: theme.shadows[16],
        }}
      >
        {/* 标题栏 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 1.5,
            py: 1,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <SwapVert color="primary" sx={{ fontSize: 20 }} />
            <Typography
              variant="subtitle2"
              sx={{
                fontWeight: 600,
                fontSize: "0.9rem",
              }}
            >
              {t("fileManager.transfer.title")}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            {/* 最小化/展开按钮 */}
            <Tooltip
              title={
                isMinimized
                  ? t("fileManager.transfer.expand")
                  : t("fileManager.transfer.minimize")
              }
            >
              <IconButton
                size="small"
                onClick={handleMinimizeToggle}
                sx={{ width: 24, height: 24 }}
                aria-label={
                  isMinimized
                    ? t("fileManager.transfer.expand")
                    : t("fileManager.transfer.minimize")
                }
              >
                {isMinimized ? (
                  <ExpandMore sx={{ fontSize: 18 }} />
                ) : (
                  <Minimize sx={{ fontSize: 14 }} />
                )}
              </IconButton>
            </Tooltip>

            {/* 关闭按钮 */}
            <Tooltip title={t("common.close")}>
              <IconButton
                size="small"
                onClick={onClose}
                sx={{ width: 24, height: 24 }}
                aria-label={t("common.close")}
              >
                <Close sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Tab切换栏（如果有多个tab） */}
        {!isMinimized && showTabBar && (
          <Box
            sx={{
              borderBottom: `1px solid ${theme.palette.divider}`,
              backgroundColor: theme.palette.background.default,
            }}
          >
            <Tabs
              value={selectedTabId}
              onChange={handleTabChange}
              variant="scrollable"
              scrollButtons="auto"
              sx={{
                minHeight: 40,
                "& .MuiTab-root": {
                  minHeight: 40,
                  fontSize: "0.8rem",
                  textTransform: "none",
                },
              }}
            >
              {[...transfersByTab.keys()].map((tabId) => {
                const transfers = transfersByTab.get(tabId) || [];
                const activeTransfers = transfers.filter(
                  (t) => t.progress < 100 && !t.isCancelled && !t.error,
                );
                const activeFileCount = sumTransferFileCount(activeTransfers);
                return (
                  <Tab
                    key={tabId}
                    label={`Tab ${tabId} (${activeFileCount})`}
                    value={tabId}
                  />
                );
              })}
            </Tabs>
          </Box>
        )}

        {/* 传输列表内容 */}
        {!isMinimized && (
          <Box
            className="app-scrollbar app-scrollbar-compact"
            sx={{
              maxHeight: 380,
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {/* 直接渲染传输项列表，不使用TransferProgressFloat的外层容器 */}
            {currentTransfers.length === 0 && recentTransfers.length === 0 ? (
              <Box sx={{ p: 3, textAlign: "center" }}>
                <Typography variant="body2" color="text.secondary">
                  {t("fileManager.transfer.noTransfers")}
                </Typography>
              </Box>
            ) : (
              currentTransfers.map((transfer) => (
                <TransferItemCard
                  key={transfer.transferId}
                  variant="float"
                  transfer={transfer}
                  onCancel={handleCancelTransfer}
                  onDelete={handleDeleteTransfer}
                />
              ))
            )}

            {/* 最近完成：已结束的任务（含多文件任务的文件清单） */}
            {recentTransfers.length > 0 && (
              <>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setRecentExpanded((value) => !value)}
                  aria-expanded={recentExpanded}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    px: 1.5,
                    py: 0.75,
                    border: 0,
                    borderTop:
                      currentTransfers.length > 0
                        ? `1px solid ${theme.palette.divider}`
                        : 0,
                    backgroundColor: "transparent",
                    color: theme.palette.text.secondary,
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: "0.75rem",
                    fontWeight: 600,
                    "&:hover": { color: theme.palette.text.primary },
                  }}
                >
                  {t("fileManager.transfer.recentSection", {
                    count: recentTransfers.length,
                  })}
                  {recentExpanded ? (
                    <ExpandLess sx={{ fontSize: 16 }} />
                  ) : (
                    <ExpandMore sx={{ fontSize: 16 }} />
                  )}
                </Box>
                {recentExpanded &&
                  recentTransfers.map((transfer) => (
                    <TransferItemCard
                      key={transfer.historyId}
                      variant="float"
                      transfer={transfer}
                      isActive={false}
                      onDelete={handleDeleteHistory}
                    />
                  ))}
              </>
            )}
          </Box>
        )}

        {/* 最小化时的简略显示 */}
        {isMinimized && (
          <Box sx={{ px: 2, py: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {t("fileManager.transfer.taskCount", {
                count: activeTaskCount,
              })}
            </Typography>
          </Box>
        )}
      </Paper>
    </Fade>
  );
};

export default memo(GlobalTransferFloat);
