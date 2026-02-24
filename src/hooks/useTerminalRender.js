import { useCallback, useEffect, useRef } from "react";
import { WebglAddon } from "@xterm/addon-webgl";

/**
 * 统一管理终端渲染副作用：Canvas/WebGL 切换、刷新节流、WebGL 事件生命周期。
 */
export const useTerminalRender = ({
  termRef,
  webglRendererEnabled,
  webglRendererEnabledRef,
  setWebglRendererEnabled,
  performanceMonitorRef,
}) => {
  const highlightRefreshFrameRef = useRef(null);
  const lastHighlightRefreshRef = useRef(0);

  const detachWebglCanvasHandlers = useCallback((termInstance) => {
    const handlers = termInstance?.__webglHandlers;
    if (!handlers) {
      return;
    }

    if (handlers.restoreTimer) {
      clearTimeout(handlers.restoreTimer);
      handlers.restoreTimer = null;
    }

    if (handlers.canvas && handlers.onContextLost) {
      handlers.canvas.removeEventListener(
        "webglcontextlost",
        handlers.onContextLost,
        false,
      );
    }

    if (handlers.canvas && handlers.onContextRestored) {
      handlers.canvas.removeEventListener(
        "webglcontextrestored",
        handlers.onContextRestored,
        false,
      );
    }

    termInstance.__webglHandlers = null;
  }, []);

  const disableWebglRenderer = useCallback(
    (termInstance) => {
      if (!termInstance) {
        return;
      }

      detachWebglCanvasHandlers(termInstance);

      try {
        if (
          termInstance.__webglAddon &&
          typeof termInstance.__webglAddon.dispose === "function"
        ) {
          termInstance.__webglAddon.dispose();
        }
      } catch {
        /* intentionally ignored */
      }

      termInstance.__webglAddon = null;
      termInstance.__webglEnabled = false;
    },
    [detachWebglCanvasHandlers],
  );

  const tryEnableWebglRenderer = useCallback(
    (termInstance) => {
      if (!termInstance) {
        return;
      }

      if (!webglRendererEnabledRef.current) {
        if (termInstance.__webglEnabled) {
          disableWebglRenderer(termInstance);
        }
        return;
      }

      // 防止重复初始化
      if (termInstance.__webglEnabled === true && termInstance.__webglAddon) {
        return;
      }

      try {
        detachWebglCanvasHandlers(termInstance);

        if (
          termInstance.__webglAddon &&
          typeof termInstance.__webglAddon.dispose === "function"
        ) {
          try {
            termInstance.__webglAddon.dispose();
          } catch {
            // 忽略 dispose 错误
          }
        }

        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          termInstance.__webglNeedsRestore = true;
          termInstance.__webglEnabled = false;
        });

        termInstance.loadAddon(webglAddon);
        termInstance.__webglAddon = webglAddon;
        termInstance.__webglEnabled = true;
        termInstance.__webglNeedsRestore = false;

        if (termInstance.element) {
          const canvas = termInstance.element.querySelector("canvas");
          if (canvas) {
            const handlers = {
              canvas,
              restoreTimer: null,
              onContextLost: (event) => {
                event.preventDefault();
                termInstance.__webglEnabled = false;
                termInstance.__webglNeedsRestore = true;
              },
              onContextRestored: () => {
                if (handlers.restoreTimer) {
                  clearTimeout(handlers.restoreTimer);
                }
                handlers.restoreTimer = setTimeout(() => {
                  handlers.restoreTimer = null;
                  if (
                    termInstance.__webglNeedsRestore &&
                    webglRendererEnabledRef.current
                  ) {
                    tryEnableWebglRenderer(termInstance);
                  }
                }, 100);
              },
            };

            canvas.addEventListener(
              "webglcontextlost",
              handlers.onContextLost,
              false,
            );
            canvas.addEventListener(
              "webglcontextrestored",
              handlers.onContextRestored,
              false,
            );
            termInstance.__webglHandlers = handlers;
          }
        }
      } catch {
        termInstance.__webglEnabled = false;
        termInstance.__webglAddon = null;
        webglRendererEnabledRef.current = false;
        setWebglRendererEnabled(false);
        disableWebglRenderer(termInstance);
      }
    },
    [
      detachWebglCanvasHandlers,
      disableWebglRenderer,
      setWebglRendererEnabled,
      webglRendererEnabledRef,
    ],
  );

  const scheduleHighlightRefresh = useCallback(
    (termInstance) => {
      if (!termInstance || typeof termInstance.refresh !== "function") {
        return;
      }

      if (termInstance.__webglEnabled) {
        return;
      }

      const now = Date.now();
      const timeSinceLastRefresh = now - lastHighlightRefreshRef.current;

      if (
        highlightRefreshFrameRef.current &&
        typeof cancelAnimationFrame === "function"
      ) {
        cancelAnimationFrame(highlightRefreshFrameRef.current);
      }

      if (typeof requestAnimationFrame !== "function") {
        if (timeSinceLastRefresh >= 16) {
          const startTime = performance.now();
          termInstance.refresh(0, termInstance.rows - 1);
          const duration = performance.now() - startTime;

          if (performanceMonitorRef.current) {
            performanceMonitorRef.current.recordRender(duration);
          }

          lastHighlightRefreshRef.current = now;
        }
        highlightRefreshFrameRef.current = null;
        return;
      }

      highlightRefreshFrameRef.current = requestAnimationFrame(() => {
        highlightRefreshFrameRef.current = null;
        const currentTime = Date.now();
        if (currentTime - lastHighlightRefreshRef.current >= 16) {
          const startTime = performance.now();
          termInstance.refresh(0, termInstance.rows - 1);
          const duration = performance.now() - startTime;

          if (performanceMonitorRef.current) {
            performanceMonitorRef.current.recordRender(duration);
          }

          lastHighlightRefreshRef.current = currentTime;
        }
      });
    },
    [performanceMonitorRef],
  );

  const resetRenderState = useCallback(() => {
    if (
      highlightRefreshFrameRef.current &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(highlightRefreshFrameRef.current);
    }
    highlightRefreshFrameRef.current = null;
  }, []);

  useEffect(() => {
    const termInstance = termRef.current;
    if (!termInstance) {
      return;
    }

    if (webglRendererEnabled) {
      tryEnableWebglRenderer(termInstance);
    } else {
      disableWebglRenderer(termInstance);
    }
  }, [
    disableWebglRenderer,
    termRef,
    tryEnableWebglRenderer,
    webglRendererEnabled,
  ]);

  useEffect(
    () => () => {
      resetRenderState();
    },
    [resetRenderState],
  );

  return {
    disableWebglRenderer,
    tryEnableWebglRenderer,
    scheduleHighlightRefresh,
    resetRenderState,
  };
};

export default useTerminalRender;
