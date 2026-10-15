import { useCallback, useEffect, useRef, useState } from "react";
import { useCleanupManager } from "../../shared/hooks/useAutoCleanup.js";

/**
 * 标签栏滚动/溢出检测/激活标签滚动入视图。
 * 从 AppShell 渐进拆分出的独立模块（progressive split），行为不变：
 * - handleTabsWheel：垂直滚轮转水平滚动（在 MuiTabs-scroller 上监听）
 * - hasTabOverflow：溢出检测（ResizeObserver + resize），控制 scrollButtons
 * - scrollActiveTabIntoView：激活标签滚动入视图（tabCount/currentTab 变化时）
 */
export default function useTabBarScroll({ tabCount, currentTab }) {
  const eventManager = useCleanupManager();
  const tabsRef = useRef(null);
  const [hasTabOverflow, setHasTabOverflow] = useState(false);

  const handleTabsWheel = useCallback((event) => {
    const scroller = event.currentTarget;
    if (!scroller) {
      return;
    }
    const maxScrollLeft = scroller.scrollWidth - scroller.clientWidth;
    if (maxScrollLeft <= 0) {
      return;
    }
    const dominantDelta =
      Math.abs(event.deltaY) > Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    if (dominantDelta === 0) {
      return;
    }
    scroller.scrollLeft = Math.min(
      Math.max(scroller.scrollLeft + dominantDelta, 0),
      maxScrollLeft,
    );
    event.preventDefault();
  }, []);

  // 监听 tabs 滚轮事件（需要在 scroller 元素上监听）
  useEffect(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return undefined;
    }
    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    if (!scroller) {
      return undefined;
    }

    // 使用 eventManager 统一管理事件监听
    const removeListener = eventManager.addEventListener(
      scroller,
      "wheel",
      handleTabsWheel,
      {
        passive: false,
      },
    );
    return removeListener;
  }, [handleTabsWheel, eventManager]);

  useEffect(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return undefined;
    }
    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    if (!scroller) {
      return undefined;
    }
    const checkOverflow = () => {
      const nextHasOverflow = scroller.scrollWidth - scroller.clientWidth > 1;
      setHasTabOverflow((prev) =>
        prev === nextHasOverflow ? prev : nextHasOverflow,
      );
    };
    checkOverflow();
    const rafId = requestAnimationFrame(checkOverflow);
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(checkOverflow)
        : null;
    resizeObserver?.observe(scroller);
    window.addEventListener("resize", checkOverflow);
    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", checkOverflow);
    };
  }, [tabCount]);

  const scrollActiveTabIntoView = useCallback(() => {
    const tabsRoot = tabsRef.current;
    if (!tabsRoot) {
      return;
    }
    const scroller = tabsRoot.querySelector(".MuiTabs-scroller");
    const selectedTab = tabsRoot.querySelector(
      'button[role="tab"][aria-selected="true"]',
    );
    if (!scroller || !selectedTab) {
      return;
    }
    const scrollerRect = scroller.getBoundingClientRect();
    const tabRect = selectedTab.getBoundingClientRect();
    const EXTRA_PADDING = 16;
    if (tabRect.left < scrollerRect.left) {
      scroller.scrollLeft -= scrollerRect.left - tabRect.left + EXTRA_PADDING;
    } else if (tabRect.right > scrollerRect.right) {
      scroller.scrollLeft += tabRect.right - scrollerRect.right + EXTRA_PADDING;
    }
  }, []);

  useEffect(() => {
    scrollActiveTabIntoView();
  }, [scrollActiveTabIntoView, currentTab, tabCount]);

  return { tabsRef, hasTabOverflow, scrollActiveTabIntoView };
}
