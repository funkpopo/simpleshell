import Dialog from "./AccessibleDialog.jsx";
import { alpha, styled } from "@mui/material/styles";
import { Z_INDEX } from "../constants/zIndex.js";

/**
 * 共享的 styled(Dialog) 组件。
 * Dialog 一律经 AccessibleDialog 导入（见 tests/unit/accessibility.test.js 规则）。
 */

/**
 * 磨砂玻璃效果的 Dialog（AboutDialog / Settings / AISettings 共用）。
 * 与全局航天中性色体系保持一致，避免偏蓝冷色调或重投影。
 * 可通过 paperMaxHeight 追加限制 paper 最大高度（如 Settings 的 "80vh"）。
 */
export const GlassDialog = styled(Dialog, {
  shouldForwardProp: (prop) => prop !== "paperMaxHeight",
})(({ theme, paperMaxHeight }) => ({
  "& .MuiDialog-paper": {
    backgroundColor: alpha(
      theme.palette.background.paper,
      theme.palette.mode === "dark" ? 0.9 : 0.94,
    ),
    backdropFilter: "blur(16px) saturate(1.15)",
    WebkitBackdropFilter: "blur(16px) saturate(1.15)",
    boxShadow: "var(--float-shadow)",
    border: "1px solid var(--color-border)",
    ...(paperMaxHeight ? { maxHeight: paperMaxHeight } : {}),
  },
}));

/**
 * 右下角浮动窗口 Dialog 工厂（TransferSidebar / AIChatWindow 共用）。
 * 运行时可通过 customwidth / customheight / customzindex props 动态调整，
 * 其余差异（边距、尺寸上下限、圆角）在创建时参数化。
 */
export const createFloatingDialog = ({
  right,
  bottom,
  width,
  minWidth,
  maxWidth,
  height,
  minHeight,
  maxHeight,
  borderRadius,
}) => {
  const defaultRight = typeof right === "number" ? `${right}px` : right;
  const defaultBottom = typeof bottom === "number" ? `${bottom}px` : bottom;
  return styled(Dialog, {
    shouldForwardProp: (prop) =>
      prop !== "customwidth" &&
      prop !== "customheight" &&
      prop !== "customzindex",
  })(({ theme, customwidth, customheight, customzindex }) => ({
    pointerEvents: "none",
    zIndex: customzindex || Z_INDEX.modal,
    "& .MuiDialog-container": {
      pointerEvents: "none",
    },
    "& .MuiDialog-paper": {
      pointerEvents: "auto",
      position: "fixed",
      right: `min(var(--ss-floating-right, ${defaultRight}), max(16px, calc(100vw - 380px)))`,
      bottom: `calc(${defaultBottom} + var(--ss-transfer-bar-offset, 0px))`,
      margin: 0,
      width: customwidth || width,
      ...(minWidth != null ? { minWidth } : {}),
      maxWidth,
      height: customheight || height,
      ...(minHeight != null ? { minHeight } : {}),
      maxHeight,
      backgroundColor: alpha(
        theme.palette.background.paper,
        theme.palette.mode === "dark" ? 0.94 : 0.96,
      ),
      backdropFilter: "blur(16px) saturate(1.15)",
      WebkitBackdropFilter: "blur(16px) saturate(1.15)",
      borderRadius,
      border: "1px solid var(--color-border)",
      boxShadow: "var(--float-shadow)",
      overflow: "visible",
      transition:
        "right 240ms cubic-bezier(0.2, 0, 0, 1), bottom 180ms cubic-bezier(0.2, 0, 0, 1)",
      "@media (prefers-reduced-motion: reduce)": {
        transition: "none",
      },
    },
  }));
};
