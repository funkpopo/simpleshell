import { memo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import { alpha, useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import OverflowTooltipText from "../../../shared/ui/OverflowTooltipText.jsx";
import { formatFileSize, formatSpeed } from "../../../shared/lib/formatters.js";
import {
  getDisplayCompletedFileCount,
  getNormalizedTransferFileCount,
} from "../lib/transferCounts.js";
import { getTransferColor, getTransferIcon } from "../transferStatusStyles.jsx";
import { useTransferItemDerived } from "../lib/useTransferItemDerived.js";
import TransferItemProgress from "./TransferItemProgress.jsx";
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
 *   字节/速度/剩余时间详情行
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
    // 浮窗：失败或取消的任务可删除记录
    const canDeleteFloat = !isSidebar && (hasError || isCancelled);

    const totalFiles = transfer.totalFiles || 0;
    const transferFileCount = getNormalizedTransferFileCount(transfer);
    const isMultiFile = transferFileCount > 1;
    const hasFileList = transfer.fileList && transfer.fileList.length > 0;
    const canExpand = isSidebar && (hasFileList || transferFileCount > 1);
    const displayCompleted = getDisplayCompletedFileCount(transfer);
    const displayFileProgress = getDisplayCompletedFileCount(transfer, {
      multiFileUsesCurrentIndex: true,
    });

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
            <Box sx={{ flexShrink: 0 }}>{getTransferIcon(type)}</Box>
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
              sx={{ flex: 1, minWidth: 0, fontWeight: 500 }}
              tooltipTitle={fileName || t("fileManager.transfer.fallbackName")}
            >
              {fileName || t("fileManager.transfer.fallbackName")}
            </OverflowTooltipText>
          ) : (
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
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
              {statusText && (
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
              {(totalFiles > 1 || currentFile) && (
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
                  {totalFiles > 1 && (
                    <span>
                      {t("fileManager.transfer.completedFiles", {
                        completed: displayFileProgress,
                        total: totalFiles,
                      })}
                    </span>
                  )}
                  {currentFile && (
                    <span>
                      {totalFiles > 1 ? " • " : ""}
                      {currentFile}
                    </span>
                  )}
                </Typography>
              )}
            </Box>
          )}

          {isSidebar && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flexShrink: 0 }}
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
                  sx={{ p: 0 }}
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
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
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
                  variant="delete"
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
          <Alert severity="error" sx={{ mt: 1, overflowWrap: "anywhere" }}>
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
              sx={{ mt: 0.5 }}
            />
          )
        ) : (
          <TransferItemProgress
            transfer={transfer}
            size="md"
            barColor={statusColor}
            sx={{ mb: 0.5 }}
          />
        )}

        {/* 侧栏：详情 Chips + 暂停按钮 */}
        {isSidebar && (
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mt: 0.5,
            }}
          >
            <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
              {totalBytes > 0 && (
                <Chip
                  label={formatFileSize(totalBytes, 1)}
                  size="small"
                  variant="outlined"
                  sx={{ height: 18, fontSize: "0.65rem" }}
                />
              )}
              {transferSpeed > 0 && isActive && (
                <Chip
                  label={`${formatFileSize(transferSpeed, 1)}/s`}
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
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
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

        {/* 侧栏：文件列表展开区域 */}
        {isSidebar && canExpand && (
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
                        secondary={formatFileSize(file.size, 1)}
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
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ px: 1 }}
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
