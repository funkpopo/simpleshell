import React, { memo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

const ROOT_SX = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  textAlign: "center",
  gap: 0.75,
  px: 2,
  py: 4,
  color: "text.secondary",
  minWidth: 0,
};

const ICON_SX = {
  display: "flex",
  "& .MuiSvgIcon-root": { fontSize: 40, opacity: 0.45 },
};

/**
 * 侧栏统一空状态：可选图标 + 主文案 + 可选提示/操作。
 * 列表为空、搜索无结果等场景共用，保证各侧栏的留白、字号与颜色一致。
 */
const SidebarEmptyState = memo(function SidebarEmptyState({
  icon,
  message,
  hint,
  action,
  sx,
  ...rest
}) {
  return (
    <Box sx={sx ? [ROOT_SX, sx] : ROOT_SX} {...rest}>
      {icon ? <Box sx={ICON_SX}>{icon}</Box> : null}
      <Typography variant="body2" color="text.secondary">
        {message}
      </Typography>
      {hint ? (
        <Typography variant="caption" color="text.disabled">
          {hint}
        </Typography>
      ) : null}
      {action ? <Box sx={{ mt: 0.5 }}>{action}</Box> : null}
    </Box>
  );
});

export default SidebarEmptyState;
