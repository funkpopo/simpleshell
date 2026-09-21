import Dialog from "./AccessibleDialog.jsx";
import { styled } from "@mui/material/styles";

/**
 * 共享的 styled(Dialog) 组件。
 * Dialog 一律经 AccessibleDialog 导入（见 scripts/check-accessibility.js 规则）。
 */

/**
 * 磨砂玻璃效果的 Dialog（AboutDialog / Settings 共用）。
 * 可通过 paperMaxHeight 追加限制 paper 最大高度（如 Settings 的 "80vh"）。
 */
export const GlassDialog = styled(Dialog, {
  shouldForwardProp: (prop) => prop !== "paperMaxHeight",
})(({ theme, paperMaxHeight }) => ({
  "& .MuiDialog-paper": {
    backgroundColor:
      theme.palette.mode === "dark"
        ? "rgba(40, 44, 52, 0.75)"
        : "rgba(255, 255, 255, 0.75)",
    backdropFilter: "blur(10px)",
    boxShadow:
      theme.palette.mode === "dark"
        ? "0 8px 32px 0 rgba(0, 0, 0, 0.37)"
        : "0 8px 32px 0 rgba(31, 38, 135, 0.37)",
    border: "1px solid rgba(255, 255, 255, 0.18)",
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
}) =>
  styled(Dialog)(({ theme, customwidth, customheight, customzindex }) => ({
    pointerEvents: "none",
    zIndex: customzindex || 1300,
    "& .MuiDialog-container": {
      pointerEvents: "none",
    },
    "& .MuiDialog-paper": {
      pointerEvents: "auto",
      position: "fixed",
      right,
      bottom,
      margin: 0,
      width: customwidth || width,
      ...(minWidth != null ? { minWidth } : {}),
      maxWidth,
      height: customheight || height,
      ...(minHeight != null ? { minHeight } : {}),
      maxHeight,
      backgroundColor:
        theme.palette.mode === "dark"
          ? "rgba(30, 30, 30, 0.95)"
          : "rgba(255, 255, 255, 0.95)",
      backdropFilter: "blur(10px)",
      borderRadius,
      boxShadow:
        theme.palette.mode === "dark"
          ? "0 10px 40px rgba(0, 0, 0, 0.6)"
          : "0 10px 40px rgba(0, 0, 0, 0.2)",
      overflow: "visible",
    },
  }));
