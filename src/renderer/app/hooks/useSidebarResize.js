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
  const sidebarWidthRef = React.useRef(sidebarWidth);
  const sidebarPositionRef = React.useRef(sidebarPosition);
  React.useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);
  React.useEffect(() => {
    sidebarPositionRef.current = sidebarPosition;
  }, [sidebarPosition]);
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
  }, [saveSidebarWidthSetting]);
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
      if (nextWidth !== sidebarWidthRef.current) {
        sidebarWidthRef.current = nextWidth;
        setSidebarWidth(nextWidth);
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
      const resizeState = sidebarResizeStateRef.current;
      if (resizeState) {
        document.body.style.cursor = resizeState.bodyCursor || "";
        document.body.style.userSelect = resizeState.bodyUserSelect || "";
        sidebarResizeStateRef.current = null;
      }
    },
    [],
  );
  return { sidebarResizing, handleSidebarResizeStart };
}
