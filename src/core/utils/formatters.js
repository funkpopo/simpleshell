export const formatFileSize = (bytes, decimals = 2) => {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

export const formatTransferSpeed = (bytesPerSecond) => {
  if (!bytesPerSecond || bytesPerSecond < 0.1) return "0 B/s";

  const units = ["B/s", "KB/s", "MB/s", "GB/s", "TB/s"];

  let i = 0;
  let unitValue = bytesPerSecond;

  // 找到合适的单位
  while (unitValue >= 1024 && i < units.length - 1) {
    unitValue /= 1024;
    i++;
  }

  // 根据值的大小调整小数点位数
  let decimals = 2;
  if (unitValue >= 100) {
    decimals = 0; // 大于100时不显示小数
  } else if (unitValue >= 10) {
    decimals = 1; // 10-100之间显示1位小数
  }

  return `${unitValue.toFixed(decimals)} ${units[i]}`;
};

export const formatRemainingTime = (seconds) => {
  if (!seconds || !isFinite(seconds)) return "计算中...";
  if (seconds < 1) return "即将完成";

  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hrs > 0) {
    return `${hrs}h ${mins}m ${secs}s`;
  } else if (mins > 0) {
    return `${mins}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
};

export const formatDate = (date, options = {}) => {
  const { showTime = true, showWeekday = true, relative = true } = options;

  if (!date || !(date instanceof Date)) return "";

  const now = new Date();
  const diff = now - date;
  const day = 24 * 60 * 60 * 1000;

  // 相对时间显示
  if (relative) {
    // 如果是今天的文件，显示时间
    if (diff < day && date.getDate() === now.getDate()) {
      return showTime
        ? date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : "今天";
    }

    // 如果是最近一周的文件，显示星期几
    if (showWeekday && diff < 7 * day) {
      const days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
      return days[date.getDay()];
    }
  }

  // 其他情况显示年-月-日
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export const formatLastRefreshTime = (timestamp) => {
  if (!timestamp) return "未知";

  const now = Date.now();
  const diff = now - timestamp;

  if (diff < 1000) return "刚刚";
  if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;

  const date = new Date(timestamp);
  return `${date.getHours()}:${date.getMinutes().toString().padStart(2, "0")}`;
};

export const formatPercentage = (value, decimals = 1) => {
  if (typeof value !== "number" || isNaN(value)) return "0%";

  const clampedValue = Math.max(0, Math.min(100, value));
  return `${clampedValue.toFixed(decimals)}%`;
};

export const formatNumber = (num) => {
  if (typeof num !== "number" || isNaN(num)) return "0";

  return num.toLocaleString();
};

export const formatMemoryUsage = (bytes, showPercentage = false, total = 0) => {
  const formatted = formatFileSize(bytes);

  if (showPercentage && total > 0) {
    const percentage = (bytes / total) * 100;
    return `${formatted} (${formatPercentage(percentage)})`;
  }

  return formatted;
};

export const formatCpuUsage = (usage) => {
  return formatPercentage(usage, 1);
};

export const formatNetworkSpeed = (bytesPerSecond, direction = "") => {
  const speed = formatTransferSpeed(bytesPerSecond);
  const arrow = direction === "up" ? "↑" : direction === "down" ? "↓" : "";
  return `${arrow}${speed}`;
};

export const formatDiskUsage = (used, total) => {
  const usedFormatted = formatFileSize(used);
  const totalFormatted = formatFileSize(total);
  const percentage = total > 0 ? (used / total) * 100 : 0;

  return {
    used: usedFormatted,
    total: totalFormatted,
    percentage: formatPercentage(percentage),
    free: formatFileSize(total - used),
    summary: `${usedFormatted} / ${totalFormatted} (${formatPercentage(percentage)})`,
  };
};
