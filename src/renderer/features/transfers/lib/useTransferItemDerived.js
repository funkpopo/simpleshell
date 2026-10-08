import {
  getIntegrityStatusText,
  getStatusIcon,
  getTransferStatusChipColors,
  getTransferStatusColor,
  getTransferStatusTextColor,
} from "../transferStatusStyles.jsx";

/**
 * TransferTag / TransferItemCard 共享的派生值计算（纯函数，无 React 依赖，
 * 命名 use* 仅为调用方语义一致）。
 *
 * 三处传输条目实现此前各自重复计算这些布尔/颜色/图标，统一到这里避免漂移。
 * canCancel 是基础判断（未完成 && 无错误 && 未取消），
 * 需要"仅活跃任务可取消"的调用方自行 && isActive。
 */
export const useTransferItemDerived = (
  theme,
  transfer,
  t,
  { iconSize = 16 } = {},
) => {
  const isCompleted = (transfer?.progress ?? 0) >= 100;
  const hasError = Boolean(transfer?.error);
  const hasWarning = Boolean(transfer?.warning);
  const isCancelled = Boolean(transfer?.isCancelled);
  const canCancel = !isCompleted && !hasError && !isCancelled;

  return {
    isCompleted,
    hasError,
    hasWarning,
    isCancelled,
    canCancel,
    statusText: getIntegrityStatusText(transfer, t),
    statusIcon: getStatusIcon(transfer, iconSize),
    statusColor: getTransferStatusColor(theme, transfer),
    statusTextColor: getTransferStatusTextColor(theme, transfer),
    chipColors: getTransferStatusChipColors(theme, transfer),
  };
};

export default useTransferItemDerived;
