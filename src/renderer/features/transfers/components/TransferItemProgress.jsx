import { memo } from "react";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import { getProgressTrackColor } from "../transferStatusStyles.jsx";

const SIZE_PRESETS = {
  // 侧栏紧凑行内进度条
  sm: { height: 4, barRadius: 2, useTrackColor: false },
  // 浮窗卡片进度条（带轨道色）
  md: { height: 6, barRadius: 3, useTrackColor: true },
};

/**
 * 传输条目共享进度条：
 * - validating 状态显示 indeterminate，其余 determinate（封顶 100）
 * - showPercent 时在右侧输出内联百分比
 * - barColor 可覆盖进度条主色（如按状态着色）
 */
const TransferItemProgress = ({
  transfer,
  size = "sm",
  barColor = null,
  showPercent = false,
  sx,
}) => {
  const theme = useTheme();
  const preset = SIZE_PRESETS[size] || SIZE_PRESETS.sm;
  const progress = Math.min(transfer?.progress || 0, 100);

  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 1, ...sx }}>
      <LinearProgress
        variant={
          transfer?.status === "validating" ? "indeterminate" : "determinate"
        }
        value={progress}
        sx={{
          flex: 1,
          height: preset.height,
          borderRadius: preset.barRadius,
          ...(preset.useTrackColor && {
            backgroundColor: getProgressTrackColor(theme),
          }),
          "& .MuiLinearProgress-bar": {
            borderRadius: preset.barRadius,
            transition: "transform 0.2s ease-in-out",
            ...(barColor ? { backgroundColor: barColor } : {}),
          },
        }}
      />
      {showPercent && (
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ minWidth: 35 }}
        >
          {Math.round(transfer?.progress || 0)}%
        </Typography>
      )}
    </Box>
  );
};

TransferItemProgress.displayName = "TransferItemProgress";

export default memo(TransferItemProgress);
