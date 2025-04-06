import React from 'react';
import { Box } from '@mui/material';

// 标签页面板组件 - 只有当前选中标签页的内容会显示
const TabPanel = (props) => {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`tabpanel-${index}`}
      aria-labelledby={`tab-${index}`}
      style={{ 
        height: '100%',
        display: value === index ? 'block' : 'none'
      }}
      {...other}
    >
      {value === index && (
        <Box sx={{ 
          height: '100%',
          // 不要给Box添加背景色，让它透明
          backgroundColor: 'transparent'
        }}>
          {children}
        </Box>
      )}
    </div>
  );
};

export default TabPanel; 