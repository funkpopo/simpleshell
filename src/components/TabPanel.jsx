import React, { useEffect, useRef, memo } from "react";
import { Box } from "@mui/material";

// 自定义比较函数，只有当 value 或 index 变化时才重新渲染
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.value === nextProps.value &&
    prevProps.index === nextProps.index &&
    prevProps.children === nextProps.children
  );
};

// 标签页面板组件 - 只有当前选中标签页的内容会显示
const TabPanel = memo((props) => {
  const { children, value, index, ...other } = props;
  const previousValueRef = useRef(value);
  const panelRef = useRef(null);

  // 监听显示状态变化
  useEffect(() => {
    const wasVisible = previousValueRef.current === index;
    const isVisible = value === index;

    // 仅在显示状态变化时执行
    if (wasVisible !== isVisible) {
      // 记录当前值，以便下次比较
      previousValueRef.current = value;

      if (isVisible) {
        // 使用ResizeObserver API来确保在标签切换后大小正确
        if (window.ResizeObserver && panelRef.current) {
          // 强制进行一次DOM重排
          panelRef.current.getBoundingClientRect();

          // 触发窗口resize事件，确保所有组件能感知大小变化
          setTimeout(() => {
            window.dispatchEvent(new Event("resize"));
          }, 10);
        }
      }
    }
  }, [value, index]);

  const isActive = value === index;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      ref={panelRef}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        opacity: isActive ? 1 : 0,
        zIndex: isActive ? 1 : 0,
        pointerEvents: isActive ? "auto" : "none",
        visibility: isActive ? "visible" : "hidden",
        transition: "opacity 0.2s ease-in-out, visibility 0.2s ease-in-out",
      }}
      {...other}
    >
      <Box
        sx={{
          height: "100%",
          backgroundColor: "transparent",
        }}
      >
        {children}
      </Box>
    </div>
  );
}, areEqual);

// 设置显示名称用于调试
TabPanel.displayName = "TabPanel";

export default TabPanel;
