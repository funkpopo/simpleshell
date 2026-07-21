import React, { memo, useMemo, useCallback, useState } from "react";
import { createFloatingDialog } from "./styledDialogs.jsx";
import {
  Box,
  Typography,
  IconButton,
  LinearProgress,
  Chip,
  Divider,
  Button,
  Tooltip,
  Collapse,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { RADIUS } from "../theme";
import CloseIcon from "@mui/icons-material/Close";
import MinimizeIcon from "@mui/icons-material/Minimize";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import StopIcon from "@mui/icons-material/Stop";
import SwapVertIcon from "@mui/icons-material/SwapVert";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import {
  useAllGlobalTransfers,
  useTransferHistory,
  cancelTransferWithNotice,
  clearCompletedTransfersForAllTabs,
} from "../store/globalTransferStore.js";
import { createAnchoredTransition } from "../utils/launchAnimation.js";
import useDragResize from "../hooks/useDragResize.js";
import {
  getNormalizedTransferFileCount,
  sumTransferFileCount,
  getDisplayCompletedFileCount,
} from "../utils/transferCounts.js";
import { useTranslation } from "react-i18next";
import OverflowTooltipText from "./OverflowTooltipText.jsx";
import {
  sidebarTitleBarSx,
  sidebarTitleIconButtonSx,
} from "./sidebarItemStyles";
import {
  getTransferIcon,
  getStatusIcon,
  getDangerHoverSx,
  getTransferStatusTextColor,
} from "./transferStatusStyles.jsx";

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
  maxHeight: "70vh",
  borderRadius: RADIUS.LG,
});

/**
 * 格式化文件大小
 */
const formatSize = (bytes) => {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

/**
 * 格式化时间
 */
const formatTime = (timestamp, locale) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString(locale || undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/**
 * 单个传输项组件
 */
const TransferItem = memo(({ transfer, isActive, onCancel, onDelete }) => {
  const theme = useTheme();
  const { t, i18n } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const statusIcon = getStatusIcon(transfer);
  const isCompleted = transfer.progress >= 100;
  const hasError = !!transfer.error;
  const hasWarning = !!transfer.warning;
  const isCancelled = transfer.isCancelled;
  const canCancel = isActive && !isCompleted && !hasError && !isCancelled;
  const canDeleteHistory = !isActive && typeof onDelete === "function";

  // 判断是否有文件列表可展开（单文件也允许展开）
  const hasFileList = transfer.fileList && transfer.fileList.length > 0;
  const transferFileCount = getNormalizedTransferFileCount(transfer);
  const isMultiFile = transferFileCount > 1;
  const canExpand = hasFileList || transferFileCount > 1;

  const totalFiles = transfer.totalFiles || 0;
  const displayCompleted = getDisplayCompletedFileCount(transfer);

  return (
    <Box
      sx={{
        mx: 1,
        my: 0.5,
        p: 1,
        borderRadius: 1.5,
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(255,255,255,0.05)"
            : "rgba(0,0,0,0.03)",
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      {/* 头部：图标 + 文件名 + 时间 + 状态 */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Box sx={{ flexShrink: 0 }}>{getTransferIcon(transfer.type)}</Box>
        <OverflowTooltipText
          variant="body2"
          sx={{
            flex: 1,
            minWidth: 0,
            fontWeight: 500,
          }}
          tooltipTitle={
            transfer.fileName || t("fileManager.transfer.fallbackName")
          }
        >
          {transfer.fileName || t("fileManager.transfer.fallbackName")}
        </OverflowTooltipText>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ flexShrink: 0 }}
        >
          {formatTime(
            transfer.startTime || transfer.completedTime,
            i18n.language,
          )}
        </Typography>
        {statusIcon}
        {/* 删除历史记录按钮 */}
        {canDeleteHistory && (
          <Tooltip title={t("fileManager.transfer.deleteRecord")}>
            <IconButton
              size="small"
              onClick={() => onDelete?.(transfer)}
              sx={{
                width: 20,
                height: 20,
                p: 0,
                color: theme.palette.text.secondary,
                ...getDangerHoverSx(theme),
              }}
              aria-label={t("fileManager.transfer.deleteRecord")}
            >
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {/* 展开/折叠按钮 */}
        {canExpand && (
          <Tooltip
            title={
              expanded
                ? t("fileManager.transfer.collapseDetails")
                : t("fileManager.transfer.viewDetails")
            }
          >
            <IconButton
              size="small"
              onClick={() => setExpanded(!expanded)}
              aria-label={
                expanded
                  ? t("fileManager.transfer.collapseDetails")
                  : t("fileManager.transfer.viewDetails")
              }
              sx={{ width: 20, height: 20, p: 0 }}
            >
              {expanded ? (
                <ExpandLessIcon sx={{ fontSize: 16 }} />
              ) : (
                <ExpandMoreIcon sx={{ fontSize: 16 }} />
              )}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {(transfer.statusText || transfer.currentFile) && (
        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 0.5,
            color: getTransferStatusTextColor(theme, transfer),
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {transfer.statusText || transfer.currentFile}
        </Typography>
      )}

      {/* 进度条 - 仅活跃传输显示 */}
      {canCancel && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.5 }}>
          <LinearProgress
            variant="determinate"
            value={transfer.progress || 0}
            sx={{ flex: 1, height: 4, borderRadius: 2 }}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ minWidth: 35 }}
          >
            {Math.round(transfer.progress || 0)}%
          </Typography>
        </Box>
      )}

      {/* 传输详情 + 终止按钮 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          mt: 0.5,
        }}
      >
        <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
          {transfer.totalBytes > 0 && (
            <Chip
              label={formatSize(transfer.totalBytes)}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {transfer.transferSpeed > 0 && isActive && (
            <Chip
              label={`${formatSize(transfer.transferSpeed)}/s`}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {isMultiFile && totalFiles > 0 && (
            <Chip
              label={t("fileManager.transfer.completedFiles", {
                completed: displayCompleted,
                total: totalFiles,
              })}
              size="small"
              variant="outlined"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {hasError && (
            <Chip
              label={t("fileManager.transfer.status.failedShort")}
              size="small"
              color="error"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {hasWarning && (
            <Chip
              label={t("fileManager.transfer.status.partialShort")}
              size="small"
              color="warning"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
          {isCancelled && (
            <Chip
              label={t("fileManager.transfer.status.cancelledShort")}
              size="small"
              color="warning"
              sx={{ height: 18, fontSize: "0.65rem" }}
            />
          )}
        </Box>
        {canCancel && onCancel && (
          <Tooltip title={t("fileManager.transfer.stop")}>
            <IconButton
              size="small"
              onClick={() => onCancel(transfer)}
              sx={{
                width: 20,
                height: 20,
                color: theme.palette.text.secondary,
                ...getDangerHoverSx(theme),
              }}
              aria-label={t("fileManager.transfer.stop")}
            >
              <StopIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* 文件列表展开区域 */}
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <Box
          className="app-scrollbar"
          sx={{
            mt: 1,
            pt: 1,
            borderTop: `1px dashed ${theme.palette.divider}`,
            maxHeight: 200,
            overflowY: "auto",
          }}
        >
          {hasFileList ? (
            <List dense disablePadding>
              {transfer.fileList.map((file, index) => (
                <ListItem
                  key={file.index ?? index}
                  disablePadding
                  sx={{ py: 0.25, px: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    {file.completed ? (
                      <CheckCircleIcon
                        sx={{ fontSize: 14, color: "success.main" }}
                      />
                    ) : (
                      <InsertDriveFileIcon
                        sx={{ fontSize: 14, color: "text.secondary" }}
                      />
                    )}
                  </ListItemIcon>
                  <ListItemText
                    secondary={formatSize(file.size)}
                    sx={{ minWidth: 0 }}
                    primary={
                      <OverflowTooltipText
                        variant="caption"
                        sx={{ fontSize: "0.7rem" }}
                        tooltipTitle={file.name || ""}
                      >
                        {file.name || ""}
                      </OverflowTooltipText>
                    }
                    primaryTypographyProps={{
                      component: "div",
                    }}
                    secondaryTypographyProps={{
                      variant: "caption",
                      noWrap: true,
                      sx: { fontSize: "0.6rem" },
                    }}
                  />
                </ListItem>
              ))}
            </List>
          ) : totalFiles > 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
              {t("fileManager.transfer.fileCount", { count: totalFiles })}
            </Typography>
          ) : null}
        </Box>
      </Collapse>
    </Box>
  );
});

TransferItem.displayName = "TransferItem";

/**
 * 传输浮动窗口组件
 */
const TransferSidebar = memo(
  ({ open, onClose, onMinimize, zIndex, onFocus, anchorEl }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    const { allTransfers } = useAllGlobalTransfers();
    const { history, clearHistory, removeHistoryItemAt } = useTransferHistory();
    const [windowWidth, setWindowWidth] = useState(DEFAULT_WIDTH);
    const [isResizing, setIsResizing] = useState(false);

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

    // 取消传输
    const handleCancelTransfer = useCallback(
      (transfer) => {
        cancelTransferWithNotice(
          transfer.tabId,
          transfer,
          t("fileManager.transfer.status.transferCancelled"),
        );
      },
      [t],
    );

    // 清除所有已完成的传输
    const handleClearCompleted = useCallback(() => {
      clearCompletedTransfersForAllTabs();
    }, []);

    // 拖拽调整宽度的处理（左侧手柄）
    const startResize = useDragResize({
      getStart: () => ({ width: windowWidth }),
      getBounds: () => ({ minWidth: MIN_WIDTH, maxWidth: MAX_WIDTH }),
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
            zIndex: 1,
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
            overflowY: "auto",
            overflowX: "hidden",
          }}
        >
          {/* 活跃传输 */}
          {activeTransfers.length > 0 && (
            <>
              <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("fileManager.transfer.activeSection", {
                    count: activeFileCount,
                  })}
                </Typography>
              </Box>
              <Box>
                {activeTransfers.map((transfer) => (
                  <TransferItem
                    key={`${transfer.tabId}-${transfer.transferId}`}
                    transfer={transfer}
                    isActive={true}
                    onCancel={handleCancelTransfer}
                  />
                ))}
              </Box>
            </>
          )}

          {/* 已完成传输（当前会话） */}
          {completedTransfers.length > 0 && (
            <>
              <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("fileManager.transfer.completedSection", {
                    count: completedFileCount,
                  })}
                </Typography>
              </Box>
              <Box>
                {completedTransfers.map((transfer) => (
                  <TransferItem
                    key={`${transfer.tabId}-${transfer.transferId}`}
                    transfer={transfer}
                    isActive={false}
                  />
                ))}
              </Box>
            </>
          )}

          {/* 历史记录 */}
          {history.length > 0 && (
            <>
              <Divider />
              <Box sx={{ px: 2, py: 1, bgcolor: "action.hover" }}>
                <Typography variant="caption" color="text.secondary">
                  {t("fileManager.transfer.historySection", {
                    count: historyFileCount,
                  })}
                </Typography>
              </Box>
              <Box>
                {history.map((transfer, index) => (
                  <TransferItem
                    key={`history-${transfer.historyId ?? transfer.transferId}-${transfer.completedTime ?? index}`}
                    transfer={transfer}
                    isActive={false}
                    onDelete={() => removeHistoryItemAt(index)}
                  />
                ))}
              </Box>
            </>
          )}

          {/* 空状态 */}
          {activeTransfers.length === 0 &&
            completedTransfers.length === 0 &&
            history.length === 0 && (
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
