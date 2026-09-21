import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";

/**
 * 右键菜单"重定位"通用 Hook。
 *
 * 当组件的自定义右键菜单已经打开时，用户在菜单外的列表项上再次右键，
 * 浏览器事件会先命中已打开的菜单/遮罩。此 Hook 在捕获阶段监听 document
 * 的 contextmenu 事件，找回鼠标位置下真正的列表项，并按两种模式处理：
 *
 * - "redispatch" 模式（FileManager / ConnectionManager）：
 *   关闭现有菜单（flushSync）后，把合成的 contextmenu 事件重新派发到行级元素，
 *   让 React 的 onContextMenu 回调稳定命中。
 * - "select" 模式（CommandHistory / ShortcutCommands）：
 *   从命中的元素解析出业务数据（payload），直接由回调更新菜单状态。
 *
 * @param {object} params
 * @param {boolean} params.enabled 是否启用监听（通常为 open && 菜单已打开）
 * @param {object} params.rootRef 列表容器根元素 ref
 * @param {string} params.menuSelector 本组件右键菜单 Paper 的选择器（需要排除）
 * @param {"redispatch"|"select"} [params.mode]
 * @param {Function} [params.resolveItemElement] redispatch 模式：由命中元素解析行级元素
 * @param {Function} [params.onCloseMenus] redispatch 模式：关闭现有菜单（在 flushSync 中调用）
 * @param {string} [params.itemSelector] select 模式：列表项选择器（closest 解析）
 * @param {Function} [params.getRetargetPayload] select 模式：由列表项元素解析业务数据，返回 null 则忽略
 * @param {Function} [params.onRetarget] select 模式：应用新的菜单目标 (payload, event)
 */
export default function useContextMenuRetarget({
  enabled,
  rootRef,
  menuSelector,
  mode = "redispatch",
  resolveItemElement,
  onCloseMenus,
  itemSelector,
  getRetargetPayload,
  onRetarget,
}) {
  const retargetingRef = useRef(false);
  const callbacksRef = useRef({});
  callbacksRef.current = {
    resolveItemElement,
    onCloseMenus,
    getRetargetPayload,
    onRetarget,
  };

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    // 找回鼠标位置下、位于容器内且不属于菜单的元素
    const getRetargetBaseElement = (event) => {
      const root = rootRef?.current;
      if (!root) {
        return null;
      }

      const rawTarget = event.target;
      if (
        rawTarget instanceof Element &&
        (rawTarget.closest(menuSelector) || rawTarget.closest('[role="menu"]'))
      ) {
        return null;
      }

      if (rawTarget instanceof Element && root.contains(rawTarget)) {
        return rawTarget;
      }

      const elementsAtPoint =
        typeof document.elementsFromPoint === "function"
          ? document.elementsFromPoint(event.clientX, event.clientY)
          : [];

      return (
        elementsAtPoint.find(
          (element) =>
            root.contains(element) &&
            !element.closest(menuSelector) &&
            !element.closest('[role="menu"]'),
        ) || null
      );
    };

    const handleContextMenuRetarget = (event) => {
      if (retargetingRef.current) {
        return;
      }

      const baseElement = getRetargetBaseElement(event);
      if (!baseElement) {
        return;
      }

      if (mode === "select") {
        const itemElement = itemSelector
          ? baseElement.closest?.(itemSelector)
          : baseElement;
        if (!itemElement) {
          return;
        }

        const payload = callbacksRef.current.getRetargetPayload
          ? callbacksRef.current.getRetargetPayload(itemElement)
          : itemElement;
        if (!payload) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        retargetingRef.current = true;
        callbacksRef.current.onRetarget?.(payload, event);
        queueMicrotask(() => {
          retargetingRef.current = false;
        });
        return;
      }

      // redispatch 模式
      const itemEl = callbacksRef.current.resolveItemElement
        ? callbacksRef.current.resolveItemElement(baseElement)
        : baseElement;
      if (!itemEl) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const mouseEventInit = {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      };

      flushSync(() => {
        callbacksRef.current.onCloseMenus?.();
      });

      if (!itemEl.isConnected) {
        return;
      }

      // 尝试把焦点交给对应行（避免需要左键才能更新"焦点态"）
      try {
        itemEl.focus?.();
      } catch (_) {
        // ignore
      }

      retargetingRef.current = true;
      try {
        itemEl.dispatchEvent(new MouseEvent("contextmenu", mouseEventInit));
      } finally {
        retargetingRef.current = false;
      }
    };

    document.addEventListener("contextmenu", handleContextMenuRetarget, true);
    return () => {
      document.removeEventListener(
        "contextmenu",
        handleContextMenuRetarget,
        true,
      );
    };
  }, [enabled, rootRef, menuSelector, itemSelector, mode]);
}
