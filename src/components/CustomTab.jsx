import React, { memo, useCallback } from "react";
import { Box, Typography, Tab } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

// 自定义比较函数
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.label === nextProps.label &&
    prevProps.value === nextProps.value &&
    prevProps.selected === nextProps.selected &&
    prevProps.index === nextProps.index &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.onContextMenu === nextProps.onContextMenu &&
    prevProps.onDragStart === nextProps.onDragStart &&
    prevProps.onDragOver === nextProps.onDragOver &&
    prevProps.onDrop === nextProps.onDrop
  );
};

// 自定义标签页组件
const CustomTab = memo((props) => {
  const {
    label,
    onClose,
    onContextMenu,
    index,
    onDragStart,
    onDragOver,
    onDrop,
    ...other
  } = props;

  // 优化关闭按钮点击处理
  const handleCloseClick = useCallback(
    (e) => {
      e.stopPropagation();
      onClose?.();
    },
    [onClose],
  );

  return (
    <Tab
      {...other}
      onContextMenu={onContextMenu}
      draggable="true"
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      label={
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Typography variant="body2" component="span" sx={{ mr: 1 }}>
            {label}
          </Typography>
          {onClose && (
            <CloseIcon
              fontSize="small"
              sx={{
                width: 16,
                height: 16,
                "&:hover": {
                  color: "error.main",
                },
              }}
              onClick={handleCloseClick}
            />
          )}
        </Box>
      }
      sx={{
        textTransform: "none",
        minWidth: "auto",
        minHeight: 40,
        py: 0,
        cursor: "pointer",
        userSelect: "none",
        // 确保标签颜色跟随主题变化
        color: "text.secondary",
        "&.Mui-selected": {
          color: "text.primary",
          backgroundColor: (theme) =>
            theme.palette.mode === "dark"
              ? "rgba(255, 255, 255, 0.1)"
              : "rgba(245, 245, 245, 0.91)",
          borderRadius: "4px 4px 0 0",
          fontWeight: "bold",
        },
      }}
    />
  );
}, areEqual);

// 设置显示名称用于调试
CustomTab.displayName = "CustomTab";

export default CustomTab;
