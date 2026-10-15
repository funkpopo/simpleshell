import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatLastRefreshTime } from "../../../shared/lib/formatters.js";

/**
 * 自更新"最后刷新时间"文本。
 * 拥有独立的 60s interval，仅重渲染本组件，
 * 避免 FileManager 整树（Breadcrumbs/Toolbar/Preview）每 60s 无效重渲染。
 */
export default function LastRefreshTimeLabel({ lastRefreshTime }) {
  const { t } = useTranslation();
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!lastRefreshTime) return undefined;
    const intervalId = setInterval(() => {
      setTick((prev) => prev + 1);
    }, 60000);
    return () => {
      clearInterval(intervalId);
    };
  }, [lastRefreshTime]);

  return t("fileManager.statusBar.lastRefresh", {
    time: formatLastRefreshTime(lastRefreshTime, { t }),
  });
}
