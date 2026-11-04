import { useCallback, useEffect, useState } from "react";
import { clamp } from "../../../../shared/common";
import useDragResize from "../../../shared/hooks/useDragResize.js";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DIALOG_BOTTOM_GAP,
  DIALOG_RIGHT_GAP,
  DIALOG_TOP_GAP,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  normalizeWindowSize,
} from "../lib/chatWindowLayout.js";

// AI 浮窗宽高：视口钳制、拖拽调整、持久化到 AI 设置，以及恢复已保存尺寸。
export default function useChatWindowSize() {
  const [windowWidth, setWindowWidth] = useState(DEFAULT_WIDTH);
  const [windowHeight, setWindowHeight] = useState(DEFAULT_HEIGHT);
  const [isResizing, setIsResizing] = useState(null);

  const getWidthLimit = useCallback(() => {
    const viewportLimit = window.innerWidth - DIALOG_RIGHT_GAP * 2;
    return clamp(viewportLimit, MIN_WIDTH, MAX_WIDTH);
  }, []);

  const getHeightLimit = useCallback(() => {
    const viewportLimit =
      window.innerHeight - DIALOG_BOTTOM_GAP - DIALOG_TOP_GAP;
    return clamp(viewportLimit, MIN_HEIGHT, MAX_HEIGHT);
  }, []);

  // 窗口尺寸变化时，确保浮窗不会超过当前视口
  useEffect(() => {
    const syncSizeWithViewport = () => {
      const maxWidth = getWidthLimit();
      const maxHeight = getHeightLimit();
      setWindowWidth((prev) => clamp(prev, MIN_WIDTH, maxWidth));
      setWindowHeight((prev) => clamp(prev, MIN_HEIGHT, maxHeight));
    };

    syncSizeWithViewport();
    window.addEventListener("resize", syncSizeWithViewport);
    return () => {
      window.removeEventListener("resize", syncSizeWithViewport);
    };
  }, [getHeightLimit, getWidthLimit]);

  const persistWindowSize = useCallback(async (width, height) => {
    if (
      !window.terminalAPI?.loadAISettings ||
      !window.terminalAPI?.saveAISettings
    ) {
      return;
    }

    const normalizedSize = normalizeWindowSize({ width, height });
    if (!normalizedSize) {
      return;
    }

    try {
      const settings = (await window.terminalAPI.loadAISettings()) || {};
      await window.terminalAPI.saveAISettings({
        ...settings,
        windowSize: normalizedSize,
      });
    } catch (err) {
      console.error("Failed to persist AI window size:", err);
    }
  }, []);

  // 拖拽调整宽高
  const handleResizeStart = useDragResize({
    getStart: () => ({ width: windowWidth, height: windowHeight }),
    getBounds: () => ({
      minWidth: MIN_WIDTH,
      maxWidth: getWidthLimit(),
      minHeight: MIN_HEIGHT,
      maxHeight: getHeightLimit(),
    }),
    onResize: ({ width, height }) => {
      if (width !== undefined) {
        setWindowWidth(width);
      }
      if (height !== undefined) {
        setWindowHeight(height);
      }
    },
    onStateChange: setIsResizing,
    onEnd: ({ width, height }) => {
      persistWindowSize(width, height);
    },
    stopPropagation: true,
    manageBodyStyles: true,
  });

  // 应用 AI 设置中保存的尺寸（按当前视口钳制）；无效尺寸保持现状。
  const applyStoredWindowSize = (windowSize) => {
    const normalizedSize = normalizeWindowSize(windowSize);
    if (normalizedSize) {
      const maxWidth = getWidthLimit();
      const maxHeight = getHeightLimit();
      setWindowWidth(clamp(normalizedSize.width, MIN_WIDTH, maxWidth));
      setWindowHeight(clamp(normalizedSize.height, MIN_HEIGHT, maxHeight));
    }
  };

  return {
    windowWidth,
    windowHeight,
    isResizing,
    handleResizeStart,
    applyStoredWindowSize,
  };
}
