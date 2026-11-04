import { clamp } from "../../../../shared/common";
import { RADIUS } from "../../../theme";

// AI 浮窗的定位间距与尺寸约束；尺寸 hook、拖拽手柄与浮窗外壳共用。
export const DIALOG_RIGHT_GAP = 50;
export const DIALOG_BOTTOM_GAP = 20;
export const DIALOG_TOP_GAP = 20;
export const DIALOG_PAPER_RADIUS = RADIUS.LG;
export const HANDLE_VISUAL_INSET = 12;

// 默认和限制尺寸
export const DEFAULT_WIDTH = 400;
export const DEFAULT_HEIGHT = 600;
export const MIN_WIDTH = 360;
export const MIN_HEIGHT = 540;
export const MAX_WIDTH = 800;
export const MAX_HEIGHT = 900;

export const normalizeWindowSize = (size) => {
  if (!size || typeof size !== "object") {
    return null;
  }

  const width = Number(size.width);
  const height = Number(size.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return {
    width: clamp(Math.round(width), MIN_WIDTH, MAX_WIDTH),
    height: clamp(Math.round(height), MIN_HEIGHT, MAX_HEIGHT),
  };
};
