import { memo } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutlineOutlined";
import OverflowTooltipText from "../../../shared/ui/OverflowTooltipText.jsx";
import WindowedSidebarList from "../../../shared/ui/WindowedSidebarList.jsx";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import { getProgressTrackColor } from "../transferStatusStyles.jsx";

/** 正在传输的文件最多显示的行数，其余以「还有 N 个文件等待传输」概括 */
const ACTIVE_FILE_LIMIT = 5;
/** 文件到达 100% 后保留的时长（含收起动画），之后从活动列表移除 */
const COMPLETED_LINGER_MS = 1500;
/** 文件到达 100% 后先停留展示完成态，再开始收起 */
const COLLAPSE_DELAY_MS = 500;
const FILE_LIST_ROW_HEIGHT = 28;

const isFileCompleted = (item) =>
  item?.status === "completed" || item?.completed === true;

const getFilePercent = (item) => {
  if (isFileCompleted(item)) return 100;
  const size = Number(item?.size) || 0;
  if (size <= 0) return 0;
  return Math.min(100, ((Number(item.transferredBytes) || 0) / size) * 100);
};

/** 单文件状态：已取消的任务中未完成的文件统一视为已取消 */
const getFileStatus = (item, transferCancelled) => {
  if (isFileCompleted(item)) return "completed";
  if (item?.status === "failed") return "failed";
  if (transferCancelled) return "cancelled";
  return item?.status === "transferring" ? "transferring" : "pending";
};

const getFileStatusLabel = (status, t) => {
  switch (status) {
    case "completed":
      return t("fileManager.transfer.fileStatus.completed");
    case "failed":
      return t("fileManager.transfer.fileStatus.failed");
    case "cancelled":
      return t("fileManager.transfer.fileStatus.cancelled");
    case "transferring":
      return t("fileManager.transfer.fileStatus.transferring");
    default:
      return t("fileManager.transfer.fileStatus.pending");
  }
};

const FileStatusIcon = ({ status, percent }) => {
  if (status === "completed") {
    return <CheckCircleIcon sx={{ fontSize: 14, color: "success.main" }} />;
  }
  if (status === "failed") {
    return <ErrorIcon sx={{ fontSize: 14, color: "error.main" }} />;
  }
  if (status === "cancelled") {
    return (
      <RemoveCircleOutlineIcon sx={{ fontSize: 14, color: "warning.main" }} />
    );
  }
  if (status === "transferring") {
    return (
      <CircularProgress
        variant="determinate"
        value={Math.max(percent, 5)}
        size={12}
        thickness={6}
      />
    );
  }
  return (
    <RadioButtonUncheckedIcon sx={{ fontSize: 14, color: "text.disabled" }} />
  );
};

/** 活动区单个文件：文件名 + 百分比 + 独立进度条，100% 后延迟收起 */
const ActiveFileRow = memo(({ item, barColor }) => {
  const theme = useTheme();
  const completed = isFileCompleted(item);
  const percent = getFilePercent(item);

  return (
    <Collapse
      in={!completed}
      appear
      timeout={250}
      style={{ transitionDelay: completed ? `${COLLAPSE_DELAY_MS}ms` : "0ms" }}
    >
      <Box sx={styles.activeRow} data-testid="transfer-active-file">
        <Box sx={styles.activeRowHeader}>
          <FileStatusIcon
            status={completed ? "completed" : "transferring"}
            percent={percent}
          />
          <OverflowTooltipText
            variant="caption"
            sx={styles.fileName}
            tooltipTitle={item.name || ""}
          >
            {item.name || ""}
          </OverflowTooltipText>
          <Typography variant="caption" sx={styles.percent}>
            {Math.floor(percent)}%
          </Typography>
        </Box>
        <LinearProgress
          variant="determinate"
          value={percent}
          sx={{
            height: 3,
            borderRadius: 1.5,
            backgroundColor: getProgressTrackColor(theme),
            "& .MuiLinearProgress-bar": {
              borderRadius: 1.5,
              ...(completed
                ? { backgroundColor: theme.palette.success.main }
                : barColor
                  ? { backgroundColor: barColor }
                  : {}),
            },
          }}
        />
      </Box>
    </Collapse>
  );
});
ActiveFileRow.displayName = "ActiveFileRow";

/**
 * 多文件任务中正在传输的文件列表：每个文件独立显示进度，
 * 到达 100% 后短暂停留并自动收起。
 */
export const TransferActiveFiles = memo(({ fileList, barColor }) => {
  const { t } = useTranslation();
  if (!Array.isArray(fileList) || fileList.length === 0) return null;

  const now = Date.now();
  const transferring = [];
  const lingering = [];
  let pendingCount = 0;
  for (const item of fileList) {
    if (item.status === "transferring") {
      transferring.push(item);
    } else if (
      isFileCompleted(item) &&
      item.finishedAt &&
      now - item.finishedAt < COMPLETED_LINGER_MS
    ) {
      lingering.push(item);
    } else if (item.status === "pending") {
      pendingCount += 1;
    }
  }
  const hiddenTransferring = Math.max(
    0,
    transferring.length - ACTIVE_FILE_LIMIT,
  );
  const rows = [...transferring.slice(0, ACTIVE_FILE_LIMIT), ...lingering].sort(
    (a, b) => a.index - b.index,
  );
  const queuedCount = pendingCount + hiddenTransferring;

  if (rows.length === 0 && queuedCount === 0) return null;

  return (
    <Box sx={styles.activeList}>
      {rows.map((item) => (
        <ActiveFileRow key={item.index} item={item} barColor={barColor} />
      ))}
      {queuedCount > 0 && (
        <Typography variant="caption" sx={styles.queued}>
          {t("fileManager.transfer.pendingFiles", { count: queuedCount })}
        </Typography>
      )}
    </Box>
  );
});
TransferActiveFiles.displayName = "TransferActiveFiles";

const FileListRow = memo(({ item, transferCancelled }) => {
  const { t } = useTranslation();
  const status = getFileStatus(item, transferCancelled);
  const percent = getFilePercent(item);
  const statusLabel = getFileStatusLabel(status, t);
  const detail =
    status === "transferring"
      ? `${Math.floor(percent)}%`
      : formatFileSize(item.size, 1);

  return (
    <Box sx={styles.listRow}>
      <Tooltip
        title={item.error ? `${statusLabel}: ${item.error}` : statusLabel}
        placement="left"
      >
        <Box
          component="span"
          sx={styles.listRowIcon}
          role="img"
          aria-label={statusLabel}
        >
          <FileStatusIcon status={status} percent={percent} />
        </Box>
      </Tooltip>
      <OverflowTooltipText
        variant="caption"
        sx={{
          ...styles.fileName,
          color: status === "failed" ? "error.main" : "text.primary",
        }}
        tooltipTitle={item.name || ""}
      >
        {item.name || ""}
      </OverflowTooltipText>
      <Typography variant="caption" sx={styles.percent}>
        {detail}
      </Typography>
    </Box>
  );
});
FileListRow.displayName = "FileListRow";

/** 完整文件清单（虚拟化），侧栏与浮窗共用 */
export const TransferFileList = memo(({ fileList, transferCancelled }) => {
  if (!Array.isArray(fileList) || fileList.length === 0) return null;
  const windowed = fileList.length >= 30;

  return (
    <Box
      className="app-scrollbar"
      sx={{ maxHeight: 200, overflowY: windowed ? "hidden" : "auto" }}
    >
      <Box
        sx={{
          height: windowed ? 196 : undefined,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <WindowedSidebarList
          items={fileList}
          className="transfer-files-virtualized-list app-scrollbar"
          rowHeight={FILE_LIST_ROW_HEIGHT}
          getItemKey={(file, index) => file.index ?? index}
          renderItem={(file) => (
            <FileListRow item={file} transferCancelled={transferCancelled} />
          )}
        />
      </Box>
    </Box>
  );
});
TransferFileList.displayName = "TransferFileList";

const styles = {
  activeList: { display: "flex", flexDirection: "column", mt: 0.5, mb: 0.5 },
  activeRow: { py: 0.5 },
  activeRowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 0.75,
    mb: 0.25,
  },
  fileName: { flex: 1, minWidth: 0, fontSize: "0.72rem" },
  percent: {
    flexShrink: 0,
    fontSize: "0.68rem",
    color: "text.secondary",
    fontVariantNumeric: "tabular-nums",
  },
  queued: {
    display: "block",
    fontSize: "0.7rem",
    color: "text.secondary",
    pt: 0.25,
  },
  listRow: {
    display: "flex",
    alignItems: "center",
    gap: 0.75,
    height: FILE_LIST_ROW_HEIGHT,
    px: 0.5,
    boxSizing: "border-box",
  },
  listRowIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    flexShrink: 0,
  },
};
