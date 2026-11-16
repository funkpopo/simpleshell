import * as React from "react";
import { useCallback } from "react";
import { SIDEBAR_WIDTHS } from "../../shared/constants/layout.js";
import { normalizeSidebarWidth } from "../appShellUtils.js";

export default function useSidebarResize({
  sidebarWidth,
  sidebarPosition,
  setSidebarWidth,
  setUiSettingsSnapshot,
}) {
  const [sidebarResizing, setSidebarResizing] = React.useState(false);
  const sidebarResizeStateRef = React.useRef(null);
  const resizeRafRef = React.useRef(null);
  const pendingWidthRef = React.useRef(null);
  const sidebarWidthRef = React.useRef(sidebarWidth);
  const sidebarPositionRef = React.useRef(sidebarPosition);
  React.useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  React.useEffect(() => {
    sidebarPositionRef.current = sidebarPosition;
  }, [sidebarPosition]);
  const cancelPendingResizeFrame = useCallback(() => {
    if (
      resizeRafRef.current !== null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
  }, []);
  const saveSidebarWidthSetting = useCallback(
    async (width) => {
      if (!window.terminalAPI?.saveUISettings) {
        return;
      }
      const nextWidth = normalizeSidebarWidth(width);
      try {
        let currentSettings = {};
        if (window.terminalAPI?.loadUISettings) {
          const loadedSettings = await window.terminalAPI.loadUISettings();
          if (loadedSettings) {
            currentSettings = loadedSettings;
          }
        }
        const nextSettings = {
          ...currentSettings,
          sidebarWidth: nextWidth,
        };
        await window.terminalAPI.saveUISettings(nextSettings);
        setUiSettingsSnapshot(nextSettings);
      } catch (error) {
        console.error("Failed to save sidebar width:", error);
      }
    },
    [setUiSettingsSnapshot],
  );
  const finishSidebarResize = useCallback(() => {
    const resizeState = sidebarResizeStateRef.current;
    if (!resizeState) {
      return;
    }
    cancelPendingResizeFrame();
    if (pendingWidthRef.current !== null) {
      const flushedWidth = pendingWidthRef.current;
      pendingWidthRef.current = null;
      if (flushedWidth !== sidebarWidthRef.current) {
        sidebarWidthRef.current = flushedWidth;
        setSidebarWidth(flushedWidth);
      }
    }
    sidebarResizeStateRef.current = null;
    setSidebarResizing(false);
    document.body.style.cursor = resizeState.bodyCursor || "";
    document.body.style.userSelect = resizeState.bodyUserSelect || "";
    const nextWidth = sidebarWidthRef.current;
    void saveSidebarWidthSetting(nextWidth);
    window.dispatchEvent(new Event("resize"));
    window.dispatchEvent(
      new CustomEvent("sidebarChanged", {
        detail: {
          margin:
            nextWidth +
            SIDEBAR_WIDTHS.SIDEBAR_BUTTONS_WIDTH +
            SIDEBAR_WIDTHS.SAFETY_MARGIN,
          sidebarWidth: nextWidth,
          timestamp: Date.now(),
        },
      }),
    );
  }, [cancelPendingResizeFrame, saveSidebarWidthSetting, setSidebarWidth]);
  const handleSidebarResizeMove = useCallback(
    (event) => {
      const resizeState = sidebarResizeStateRef.current;
      if (!resizeState) {
        return;
      }
      const delta =
        resizeState.position === "left"
          ? event.clientX - resizeState.startX
          : resizeState.startX - event.clientX;
      const nextWidth = normalizeSidebarWidth(resizeState.startWidth + delta);
      const applyWidth = (targetWidth) => {
        if (targetWidth !== null && targetWidth !== sidebarWidthRef.current) {
          sidebarWidthRef.current = targetWidth;
          setSidebarWidth(targetWidth);
        }
      };
      if (typeof requestAnimationFrame !== "function") {
        applyWidth(nextWidth);
        event.preventDefault();
        return;
      }
      if (resizeRafRef.current === null) {
        applyWidth(nextWidth);
        pendingWidthRef.current = null;
        resizeRafRef.current = requestAnimationFrame(() => {
          resizeRafRef.current = null;
          const trailingWidth = pendingWidthRef.current;
          pendingWidthRef.current = null;
          applyWidth(trailingWidth);
        });
      } else {
        pendingWidthRef.current = nextWidth;
      }
      event.preventDefault();
    },
    [setSidebarWidth],
  );
  const handleSidebarResizeStart = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    const startWidth = normalizeSidebarWidth(sidebarWidthRef.current);
    sidebarResizeStateRef.current = {
      startX: event.clientX,
      startWidth,
      position: sidebarPositionRef.current,
      bodyCursor: document.body.style.cursor,
      bodyUserSelect: document.body.style.userSelect,
    };
    setSidebarResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }, []);
  React.useEffect(() => {
    if (!sidebarResizing) {
      return undefined;
    }
    document.addEventListener("pointermove", handleSidebarResizeMove);
    document.addEventListener("pointerup", finishSidebarResize);
    document.addEventListener("pointercancel", finishSidebarResize);
    return () => {
      document.removeEventListener("pointermove", handleSidebarResizeMove);
      document.removeEventListener("pointerup", finishSidebarResize);
      document.removeEventListener("pointercancel", finishSidebarResize);
    };
  }, [finishSidebarResize, handleSidebarResizeMove, sidebarResizing]);

  React.useEffect(
    () => () => {
      cancelPendingResizeFrame();
      const resizeState = sidebarResizeStateRef.current;
      if (resizeState) {
        document.body.style.cursor = resizeState.bodyCursor || "";
        document.body.style.userSelect = resizeState.bodyUserSelect || "";
        sidebarResizeStateRef.current = null;
      }
    },
    [cancelPendingResizeFrame],
  );
  return { sidebarResizing, handleSidebarResizeStart };
}
