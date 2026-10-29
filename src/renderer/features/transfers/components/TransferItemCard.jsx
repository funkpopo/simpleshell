import { memo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import OverflowTooltipText from "../../../shared/ui/OverflowTooltipText.jsx";
import { formatFileSize, formatSpeed } from "../../../shared/lib/formatters.js";
import {
  getDisplayCompletedFileCount,
  getNormalizedTransferFileCount,
  getTransferFileListStats,
} from "../lib/transferCounts.js";
import { getTransferColor, getTransferIcon } from "../transferStatusStyles.jsx";
import { useTransferItemDerived } from "../lib/useTransferItemDerived.js";
import TransferItemProgress from "./TransferItemProgress.jsx";
import { TransferActiveFiles, TransferFileList } from "./TransferFileList.jsx";
import {
  TransferCancelButton,
  TransferDeleteButton,
  TransferExpandButton,
  TransferVerifyMenu,
} from "./TransferItemActions.jsx";

/** 格式化剩余时间（秒 → 本地化文本），float variant 底部详情用 */
const formatRemainingTime = (seconds, t) => {
  if (!seconds || seconds <= 0) return "";
  if (seconds < 60) {
    return t("fileManager.transfer.timeSeconds", {
      count: Math.round(seconds),
    });
  }
  if (seconds < 3600) {
    return t("fileManager.transfer.timeMinutes", {
      count: Math.round(seconds / 60),
    });
  }
  return t("fileManager.transfer.timeHours", {
    count: Math.round(seconds / 3600),
  });
};

/** 格式化时间戳为本地时分秒，sidebar variant 头部用 */
const formatTimestamp = (timestamp, locale) => {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString(locale || undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

/**
 * 传输条目卡片（GlobalTransferFloat / TransferSidebar 共用实现）。
 *
 * variant:
 * - "sidebar"：侧栏可展开卡片——时间戳、校验菜单、删除历史、展开文件列表、
 *   错误 Alert、状态 Chips、暂停按钮；isActive 区分活跃/历史（仅活跃可暂停/校验）
 * - "float"：浮窗详情卡片——圆形图标容器、百分比 Chip、删除/终止按钮、
 *   字节/速度/剩余时间详情行；多文件任务逐文件显示进度（100% 后自动收起），
 *   并可展开完整文件清单。isActive=false 表示浮窗中的历史记录（可删除）
 *
 * 回调签名统一为 (transfer) / (transfer, algorithm)。
 */
const TransferItemCard = memo(
  ({
    transfer,
    variant = "sidebar",
    isActive = true,
    onCancel,
    onDelete,
    onVerify,
  }) => {
    const theme = useTheme();
    const { t, i18n } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    const {
      type,
      fileName,
      progress = 0,
      transferredBytes = 0,
      totalBytes = 0,
      transferSpeed = 0,
      remainingTime = 0,
      currentFile,
    } = transfer;

    const {
      isCompleted,
      hasError,
      hasWarning,
      isCancelled,
      canCancel: canCancelBase,
      statusText,
      statusIcon,
      statusColor,
      statusTextColor,
      chipColors,
    } = useTransferItemDerived(theme, transfer, t, { iconSize: 16 });

    const isSidebar = variant === "sidebar";
    // 侧栏仅活跃任务可取消/校验；浮窗不做活跃区分
    const canCancel = isSidebar ? isActive && canCancelBase : canCancelBase;
    const canDeleteHistory = isSidebar && !isActive && onDelete;
    // 浮窗：失败、取消的任务以及历史记录可删除
    const canDeleteFloat =
      !isSidebar && (hasError || isCancelled || (!isActive && !!onDelete));
    const isFinished = isCompleted || hasError || isCancelled;

    const totalFiles = transfer.totalFiles || 0;
    const transferFileCount = getNormalizedTransferFileCount(transfer);
    const isMultiFile = transferFileCount > 1;
    const fileList = Array.isArray(transfer.fileList)
      ? transfer.fileList
      : null;
    const hasFileList = !!fileList && fileList.length > 0;
    const canExpand = isSidebar && (hasFileList || transferFileCount > 1);
    const displayCompleted = getDisplayCompletedFileCount(transfer);
    const failedFileCount = getTransferFileListStats(transfer)?.failed || 0;
    // 浮窗多文件：文件数只在计数行出现一次，当前文件由逐文件进度行展示；
    // 清单到达前（扫描/建目录阶段）仍显示准备状态文本
    const showFloatStatusText =
      !!statusText && (!isMultiFile || (!hasFileList && !isFinished));
    const showFloatCurrentFile =
      !isMultiFile &&
      !!currentFile &&
      currentFile !== fileName &&
      currentFile !== statusText;
    const canToggleFileList = !isSidebar && isMultiFile && hasFileList;

    const showVerifyMenu =
      isSidebar &&
      canCancel &&
      transfer.transferKey &&
      onVerify &&
      !transfer.algorithm &&
      !transfer.processedFiles;

    return (
      <Box
        sx={
          isSidebar
            ? {
                mx: 1,
                my: 0.5,
                p: 1,
                borderRadius: 1.5,
                backgroundColor:
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(0,0,0,0.03)",
                border: `1px solid ${theme.palette.divider}`,
              }
            : {
                m: 1,
                p: 1.5,
                borderRadius: 2,
                backgroundColor:
                  theme.palette.mode === "dark"
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(0,0,0,0.02)",
                border: `1px solid ${theme.palette.divider}`,
              }
        }
      >
        {/* 头部：图标 + 文件名 + 状态/操作 */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: isSidebar ? 1 : 0,
            mb: isSidebar ? 0 : 1,
          }}
        >
          {isSidebar ? (
            <Box sx={viewStyles.boxSx}>{getTransferIcon(type)}</Box>
          ) : (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                minWidth: 28,
                borderRadius: "50%",
                backgroundColor: alpha(getTransferColor(theme, type), 0.15),
                mr: 1.5,
                flexShrink: 0,
              }}
            >
              {getTransferIcon(type, { fontSize: 18 })}
            </Box>
          )}

          {isSidebar ? (
            <OverflowTooltipText
              variant="body2"
              sx={viewStyles.overflowTooltipTextSx}
              tooltipTitle={fileName || t("fileManager.transfer.fallbackName")}
            >
              {fileName || t("fileManager.transfer.fallbackName")}
            </OverflowTooltipText>
          ) : (
            <Box sx={viewStyles.boxSx2}>
              <Typography
                variant="subtitle2"
                sx={{
                  fontWeight: 600,
                  fontSize: "0.85rem",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: theme.palette.text.primary,
                }}
              >
                {fileName || t("fileManager.transfer.fallbackName")}
              </Typography>
              {showFloatStatusText && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: "0.75rem",
                    color: statusTextColor,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                >
                  {statusText}
                </Typography>
              )}
              {(isMultiFile || showFloatCurrentFile) && (
                <Typography
                  variant="caption"
                  sx={{
                    fontSize: "0.75rem",
                    color: theme.palette.text.secondary,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                >
                  {isMultiFile ? (
                    <>
                      {t("fileManager.transfer.completedFiles", {
                        completed: displayCompleted,
                        total: totalFiles || transferFileCount,
                      })}
                      {failedFileCount > 0 && (
                        <Box
                          component="span"
                          sx={{ color: theme.palette.error.main }}
                        >
                          {" • "}
                          {t("fileManager.transfer.failedFiles", {
                            count: failedFileCount,
                          })}
                        </Box>
                      )}
                    </>
                  ) : (
                    currentFile
                  )}
                </Typography>
              )}
            </Box>
          )}

          {isSidebar && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={viewStyles.boxSx}
            >
              {formatTimestamp(
                transfer.startTime || transfer.completedTime,
                i18n.language,
              )}
            </Typography>
          )}
          {isSidebar ? (
            <>
              {statusIcon}
              {showVerifyMenu && (
                <TransferVerifyMenu transfer={transfer} onVerify={onVerify} />
              )}
              {canDeleteHistory && (
                <TransferDeleteButton
                  transfer={transfer}
                  onDelete={onDelete}
                  sx={viewStyles.transferDeleteButtonSx}
                />
              )}
              {canExpand && (
                <TransferExpandButton
                  expanded={expanded}
                  onToggle={() => setExpanded(!expanded)}
                />
              )}
            </>
          ) : (
            /* 浮窗头部动作区：statusIcon → 百分比 Chip → 删除 → 终止 */
            <Box sx={viewStyles.boxSx3}>
              {statusIcon}
              <Chip
                label={`${Math.round(progress)}%`}
                size="small"
                sx={{
                  height: 24,
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  backgroundColor: chipColors.bgcolor,
                  color: chipColors.color,
                }}
              />
              {canDeleteFloat && (
                <TransferDeleteButton
                  transfer={transfer}
                  onDelete={onDelete}
                  variant={isActive ? "delete" : "record"}
                  size={28}
                  iconSize={16}
                />
              )}
              {canCancel && (
                <TransferCancelButton
                  transfer={transfer}
                  onCancel={onCancel}
                  variant="stop"
                  size={28}
                  iconSize={16}
                />
              )}
            </Box>
          )}
        </Box>

        {/* 侧栏：完整性状态行 */}
        {isSidebar && statusText && (
          <Typography
            variant="caption"
            sx={{
              display: "block",
              mt: 0.5,
              color: statusTextColor,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {statusText}
          </Typography>
        )}

        {/* 侧栏：错误 Alert */}
        {isSidebar && transfer.error && (
          <Alert severity="error" sx={viewStyles.alertSx}>
            {transfer.error}
          </Alert>
        )}

        {/* 进度条：侧栏仅活跃任务显示；浮窗始终显示 */}
        {isSidebar ? (
          canCancel && (
            <TransferItemProgress
              transfer={transfer}
              size="sm"
              showPercent
              sx={viewStyles.transferItemProgressSx}
            />
          )
        ) : (
          <TransferItemProgress
            transfer={transfer}
            size="md"
            barColor={statusColor}
            sx={viewStyles.transferItemProgressSx2}
          />
        )}

        {/* 浮窗多文件：逐文件进度（任务结束后整体收起） */}
        {!isSidebar && isMultiFile && hasFileList && (
          <Collapse in={!isFinished} timeout={300} unmountOnExit>
            <TransferActiveFiles fileList={fileList} barColor={statusColor} />
          </Collapse>
        )}

        {/* 侧栏：详情 Chips + 暂停按钮 */}
        {isSidebar && (
          <Box sx={viewStyles.boxSx4}>
            <Box sx={viewStyles.boxSx5}>
              {totalBytes > 0 && (
                <Chip
                  label={formatFileSize(totalBytes, 1)}
                  size="small"
                  variant="outlined"
                  sx={viewStyles.chipSx}
                />
              )}
              {transferSpeed > 0 && isActive && (
                <Chip
                  label={`${formatFileSize(transferSpeed, 1)}/s`}
                  size="small"
                  variant="outlined"
                  sx={viewStyles.chipSx}
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
                  sx={viewStyles.chipSx}
                />
              )}
              {hasError && (
                <Chip
                  label={t("fileManager.transfer.status.failedShort")}
                  size="small"
                  color="error"
                  sx={viewStyles.chipSx}
                />
              )}
              {hasWarning && (
                <Chip
                  label={t("fileManager.transfer.status.partialShort")}
                  size="small"
                  color="warning"
                  sx={viewStyles.chipSx}
                />
              )}
              {isCancelled && (
                <Chip
                  label={t("fileManager.transfer.status.cancelledShort")}
                  size="small"
                  color="warning"
                  sx={viewStyles.chipSx}
                />
              )}
            </Box>
            {canCancel && (
              <TransferCancelButton
                transfer={transfer}
                onCancel={onCancel}
                variant="pause"
              />
            )}
          </Box>
        )}

        {/* 浮窗：字节/速度/最终状态详情行 */}
        {!isSidebar && (
          <Box sx={viewStyles.boxSx6}>
            <Typography
              variant="caption"
              sx={{
                fontSize: "0.75rem",
                color: theme.palette.text.secondary,
              }}
            >
              {formatFileSize(transferredBytes)} / {formatFileSize(totalBytes)}
            </Typography>

            {!isCancelled && !hasError && transferSpeed > 0 && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.75rem",
                  color: theme.palette.text.secondary,
                }}
              >
                {formatSpeed(transferSpeed)}
                {remainingTime > 0 &&
                  ` • ${formatRemainingTime(remainingTime, t)}`}
              </Typography>
            )}

            {(hasError || hasWarning || isCancelled || isCompleted) && (
              <Typography
                variant="caption"
                sx={{
                  fontSize: "0.75rem",
                  fontWeight: 500,
                  color: statusColor,
                }}
              >
                {hasError
                  ? t("fileManager.transfer.status.failed")
                  : hasWarning
                    ? t("fileManager.transfer.status.partial")
                    : isCancelled
                      ? t("fileManager.transfer.status.cancelled")
                      : t("fileManager.transfer.status.completed")}
              </Typography>
            )}
          </Box>
        )}

        {/* 浮窗：完整文件清单（传输中与完成后均可查看） */}
        {canToggleFileList && (
          <>
            <Button
              size="small"
              variant="text"
              onClick={() => setExpanded(!expanded)}
              endIcon={
                expanded ? (
                  <ExpandLessIcon sx={{ fontSize: 16 }} />
                ) : (
                  <ExpandMoreIcon sx={{ fontSize: 16 }} />
                )
              }
              aria-expanded={expanded}
              sx={viewStyles.fileListToggleSx}
            >
              {expanded
                ? t("fileManager.transfer.hideFileList")
                : t("fileManager.transfer.viewFileList", {
                    count: fileList.length,
                  })}
            </Button>
            <Collapse in={expanded} timeout="auto" unmountOnExit>
              <Box sx={viewStyles.fileListSx}>
                <TransferFileList
                  fileList={fileList}
                  transferCancelled={isCancelled}
                />
              </Box>
            </Collapse>
          </>
        )}

        {/* 侧栏：文件列表展开区域 */}
        {isSidebar && canExpand && (
          <Collapse in={expanded} timeout="auto" unmountOnExit>
            <Box
              sx={{
                mt: 1,
                pt: 1,
                borderTop: `1px dashed ${theme.palette.divider}`,
              }}
            >
              {hasFileList ? (
                <TransferFileList
                  fileList={fileList}
                  transferCancelled={isCancelled}
                />
              ) : totalFiles > 0 ? (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={viewStyles.typographySx}
                >
                  {t("fileManager.transfer.fileCount", { count: totalFiles })}
                </Typography>
              ) : null}
            </Box>
          </Collapse>
        )}
      </Box>
    );
  },
);

TransferItemCard.displayName = "TransferItemCard";

export default TransferItemCard;

// Stable declarations shared by row renders. Dynamic styles stay with their owner.
const viewStyles = {
  boxSx: { flexShrink: 0 },
  overflowTooltipTextSx: { flex: 1, minWidth: 0, fontWeight: 500 },
  boxSx2: { flexGrow: 1, minWidth: 0 },
  transferDeleteButtonSx: { p: 0 },
  boxSx3: { display: "flex", alignItems: "center", gap: 1 },
  alertSx: { mt: 1, overflowWrap: "anywhere" },
  transferItemProgressSx: { mt: 0.5 },
  transferItemProgressSx2: { mb: 0.5 },
  boxSx4: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    mt: 0.5,
  },
  boxSx5: { display: "flex", gap: 0.5, flexWrap: "wrap" },
  chipSx: { height: 18, fontSize: "0.65rem" },
  boxSx6: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  typographySx: { px: 1 },
  fileListToggleSx: {
    mt: 0.5,
    px: 0.5,
    minWidth: 0,
    fontSize: "0.72rem",
    textTransform: "none",
  },
  fileListSx: {
    mt: 0.5,
    pt: 0.5,
    borderTop: "1px dashed",
    borderColor: "divider",
  },
};
