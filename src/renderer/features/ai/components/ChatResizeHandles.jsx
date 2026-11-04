import React from "react";
import { Box } from "@mui/material";
import { Z_INDEX } from "../../../shared/constants/zIndex.js";
import {
  DIALOG_PAPER_RADIUS,
  HANDLE_VISUAL_INSET,
} from "../lib/chatWindowLayout.js";

// AI 浮窗左上角 / 顶部 / 左侧的拖拽调整手柄（浮窗固定在右下角）。
export default function ChatResizeHandles({ isResizing, handleResizeStart }) {
  return (
    <>
      {/* 左上角拖动调整宽高手柄 */}
      <Box
        onMouseDown={handleResizeStart("both")}
        sx={{
          position: "absolute",
          left: -6,
          top: -6,
          width: 14,
          height: 14,
          cursor: "nwse-resize",
          zIndex: Z_INDEX.resizeCorner,
          borderRadius: "8px 0 0 0",
          "&::after": {
            content: '""',
            position: "absolute",
            left: 4,
            top: 4,
            width: 8,
            height: 8,
            borderRadius: "50%",
            backgroundColor: "primary.main",
            opacity: isResizing === "both" ? 0.55 : 0,
            transform: isResizing === "both" ? "scale(1.05)" : "scale(1)",
            transition: "opacity 120ms ease, transform 120ms ease",
          },
          "&:hover::after": {
            opacity: isResizing === "both" ? 0.55 : 0.35,
          },
        }}
      />
      {/* 顶部拖动调整高度手柄 */}
      <Box
        onMouseDown={handleResizeStart("height")}
        sx={{
          position: "absolute",
          left: 0,
          top: -4,
          right: 0,
          height: 8,
          cursor: "ns-resize",
          zIndex: Z_INDEX.control,
          "&::after": {
            content: '""',
            position: "absolute",
            left: DIALOG_PAPER_RADIUS,
            right: DIALOG_PAPER_RADIUS,
            top: 3,
            height: 2,
            borderRadius: 999,
            backgroundColor: "primary.main",
            opacity: isResizing === "height" || isResizing === "both" ? 0.5 : 0,
            transform:
              isResizing === "height" || isResizing === "both"
                ? "scaleY(1.2)"
                : "scaleY(1)",
            transition: "opacity 120ms ease, transform 120ms ease",
          },
          "&:hover::after": {
            opacity:
              isResizing === "height" || isResizing === "both" ? 0.5 : 0.3,
          },
        }}
      />
      {/* 左侧拖动调整宽度手柄 */}
      <Box
        onMouseDown={handleResizeStart("width")}
        sx={{
          position: "absolute",
          left: -4,
          top: 0,
          bottom: 0,
          width: 8,
          cursor: "ew-resize",
          zIndex: Z_INDEX.control,
          "&::after": {
            content: '""',
            position: "absolute",
            top: HANDLE_VISUAL_INSET,
            bottom: HANDLE_VISUAL_INSET,
            left: 3,
            width: 2,
            borderRadius: 999,
            backgroundColor: "primary.main",
            opacity: isResizing === "width" || isResizing === "both" ? 0.5 : 0,
            transform:
              isResizing === "width" || isResizing === "both"
                ? "scaleX(1.2)"
                : "scaleX(1)",
            transformOrigin: "left center",
            transition: "opacity 120ms ease, transform 120ms ease",
          },
          "&:hover::after": {
            opacity:
              isResizing === "width" || isResizing === "both" ? 0.5 : 0.3,
          },
        }}
      />
    </>
  );
}
