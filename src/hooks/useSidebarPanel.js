import { useEffect, useRef, useState } from "react";
import useAutoCleanup from "./useAutoCleanup";

/**
 * 侧边栏面板通用行为 Hook。
 *
 * 封装各侧边栏组件重复实现的两个能力：
 * 1. 键盘快捷键：Ctrl+/ 全局聚焦搜索框；Ctrl+F 仅在焦点位于侧边栏内时接管浏览器查找
 * 2. （可选）容器高度测量：用于虚拟化列表，随容器尺寸变化自动更新
 *
 * @param {object} params
 * @param {boolean} params.open 侧边栏是否打开（关闭时快捷键不生效）
 * @param {object} params.rootRef 侧边栏根元素 ref（用于判断焦点是否在侧边栏内）
 * @param {object} [params.searchInputRef] 搜索输入框 ref（默认快捷键行为：聚焦它）
 * @param {Function} [params.onSearchShortcut] 自定义快捷键行为（替代默认聚焦搜索框）
 * @param {Function} [params.shouldIgnoreKeydown] 返回 true 时忽略此次按键（在终端焦点检查之前调用）
 * @param {boolean} [params.measureHeight] 是否启用容器高度测量
 * @returns {{ containerRef: object, containerHeight: number }}
 */
export default function useSidebarPanel({
  open,
  rootRef,
  searchInputRef,
  onSearchShortcut,
  shouldIgnoreKeydown,
  measureHeight = false,
} = {}) {
  const onSearchShortcutRef = useRef(onSearchShortcut);
  const shouldIgnoreKeydownRef = useRef(shouldIgnoreKeydown);
  onSearchShortcutRef.current = onSearchShortcut;
  shouldIgnoreKeydownRef.current = shouldIgnoreKeydown;

  // 键盘快捷键处理
  useEffect(() => {
    const handleKeyDown = (e) => {
      // 只在侧边栏打开时处理快捷键
      if (!open) return;

      if (shouldIgnoreKeydownRef.current && shouldIgnoreKeydownRef.current(e)) {
        return;
      }

      // 检查当前焦点是否在终端区域内，如果是则不处理侧边栏快捷键
      const activeElement = document.activeElement;
      const isInTerminal =
        activeElement &&
        (activeElement.classList.contains("xterm-helper-textarea") ||
          activeElement.classList.contains("xterm-screen"));

      // 如果焦点在终端的输入区域内，则不处理侧边栏的快捷键
      if (isInTerminal) return;

      const isFocusInSidebar =
        activeElement && rootRef?.current?.contains(activeElement);

      // Ctrl+/ 全局聚焦搜索框；Ctrl+F 仅在焦点位于侧边栏内时接管浏览器查找
      if (
        e.ctrlKey &&
        (e.key === "/" || (e.key.toLowerCase() === "f" && isFocusInSidebar))
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (onSearchShortcutRef.current) {
          onSearchShortcutRef.current();
        } else if (searchInputRef?.current) {
          searchInputRef.current.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, rootRef, searchInputRef]);

  // 可选能力：动态计算容器高度（虚拟化列表使用）
  const { addResizeObserver } = useAutoCleanup();
  const containerRef = useRef(null);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    if (!measureHeight) {
      return;
    }

    const updateHeight = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        if (rect.height > 0) {
          setContainerHeight(rect.height);
        }
      }
    };

    updateHeight();

    // 使用 addResizeObserver 自动管理观察器，组件卸载时自动清理
    if (containerRef.current) {
      addResizeObserver(updateHeight, containerRef.current);
    }
  }, [open, addResizeObserver, measureHeight]);

  return { containerRef, containerHeight };
}
