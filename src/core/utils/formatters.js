export const formatFileSize = (bytes, options = {}) => {
  const { decimals = 2, t = null } =
    typeof options === "number" ? { decimals: options } : options;

  const defaultSizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const sizes = t
    ? [
        t("fileManager.units.bytes"),
        t("fileManager.units.kb"),
        t("fileManager.units.mb"),
        t("fileManager.units.gb"),
        t("fileManager.units.tb"),
        "PB",
      ]
    : defaultSizes;

  if (!bytes || bytes === 0) return `0 ${sizes[0]}`;

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
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

export const formatNumber = (num) => {
  if (typeof num !== "number" || isNaN(num)) return "0";

  return num.toLocaleString();
};
