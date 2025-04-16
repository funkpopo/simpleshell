import React, { useEffect, useRef } from "react";
import { Box } from "@mui/material";

// 标签页面板组件 - 只有当前选中标签页的内容会显示
const TabPanel = (props) => {
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
            window.dispatchEvent(new Event('resize'));
          }, 10);
        }
      }
    }
  }, [value, index]);

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      ref={panelRef}
      style={{
        height: "100%",
        display: value === index ? "block" : "none",
      }}
      {...other}
    >
      {value === index && (
        <Box
          sx={{
            height: "100%",
            // 不要给Box添加背景色，让它透明
            backgroundColor: "transparent",
          }}
        >
          {children}
        </Box>
      )}
    </div>
  );
};

export default TabPanel;
