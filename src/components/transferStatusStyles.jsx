import { alpha } from "@mui/material/styles";
import FileUploadIcon from "@mui/icons-material/FileUpload";
import FileDownloadIcon from "@mui/icons-material/FileDownload";
import FolderIcon from "@mui/icons-material/Folder";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import ErrorIcon from "@mui/icons-material/Error";
import CancelIcon from "@mui/icons-material/Cancel";

/**
 * 传输组件（GlobalTransferBar / GlobalTransferFloat / TransferSidebar）共享的
 * 状态配色与图标。全部取自 theme.palette，深浅色模式均可读。
 */

const isDownloadType = (type) =>
  type === "download" || type === "download-folder";

const isFolderType = (type) =>
  type === "upload-folder" || type === "download-folder";

/** 传输类型对应的 palette key：上传=info（蓝），下载=success（绿） */
export const getTransferPaletteKey = (type) =>
  isDownloadType(type) ? "success" : "info";

/** 传输类型主色 */
export const getTransferColor = (theme, type) =>
  theme.palette[getTransferPaletteKey(type)].main;

/** 传输类型图标（颜色跟随 palette，可用 sx 覆盖大小等） */
export const getTransferIcon = (type, sx) => {
  const color = `${getTransferPaletteKey(type)}.main`;
  const iconSx = { color, ...sx };
  if (isFolderType(type)) {
    return <FolderIcon sx={iconSx} />;
  }
  if (isDownloadType(type)) {
    return <FileDownloadIcon sx={iconSx} />;
  }
  return <FileUploadIcon sx={iconSx} />;
};

/** 状态图标：错误/部分完成/已取消/已完成，进行中返回 null */
export const getStatusIcon = (transfer, fontSize = 16) => {
  const { progress, isCancelled, error, warning } = transfer;
  if (error) {
    return <ErrorIcon sx={{ fontSize, color: "error.main" }} />;
  }
  if (warning) {
    return <WarningAmberIcon sx={{ fontSize, color: "warning.main" }} />;
  }
  if (isCancelled) {
    return <CancelIcon sx={{ fontSize, color: "warning.main" }} />;
  }
  if (progress >= 100) {
    return <CheckCircleIcon sx={{ fontSize, color: "success.main" }} />;
  }
  return null;
};

/** 状态主色：错误>警告/取消>完成>进行中（按类型着色） */
export const getTransferStatusColor = (theme, transfer) => {
  const { progress, isCancelled, error, warning, type } = transfer;
  if (error) return theme.palette.error.main;
  if (warning || isCancelled) return theme.palette.warning.main;
  if (progress >= 100) return theme.palette.success.main;
  return getTransferColor(theme, type);
};

/** 状态文本颜色：错误=error，警告/取消=warning，否则次级文字色 */
export const getTransferStatusTextColor = (theme, transfer) =>
  transfer?.error
    ? theme.palette.error.main
    : transfer?.warning || transfer?.isCancelled
      ? theme.palette.warning.main
      : theme.palette.text.secondary;

/**
 * 状态标签（Chip 等）的配色：半透明 tint 背景 + 主色文字，
 * 替代原先仅适配浅色模式的粉彩硬编码背景。
 */
export const getTransferStatusChipColors = (theme, transfer) => {
  const main = getTransferStatusColor(theme, transfer);
  return {
    color: main,
    bgcolor: alpha(main, theme.palette.mode === "dark" ? 0.16 : 0.12),
    hoverBgcolor: alpha(main, theme.palette.mode === "dark" ? 0.26 : 0.2),
  };
};

/** 进度条轨道色：跟随文字色的半透明，两种模式下都可见 */
export const getProgressTrackColor = (theme) =>
  alpha(
    theme.palette.text.primary,
    theme.palette.mode === "dark" ? 0.12 : 0.08,
  );

/** 删除/终止等危险操作按钮的 hover 反馈 */
export const getDangerHoverSx = (theme) => ({
  "&:hover": {
    color: theme.palette.error.main,
    backgroundColor: alpha(theme.palette.error.main, 0.12),
  },
});
