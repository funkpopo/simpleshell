import React, { useState } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
import Box from '@mui/material/Box';
import { translateError } from '../utils/errorTranslator';

/**
 * 错误通知组件
 * 用于显示应用内的错误提醒，替代系统原生的错误窗口
 * 显示在左下角，提供简洁的用户友好错误信息和解决方案
 */
const ErrorNotification = ({ error, open, onClose }) => {
  const [showDetails, setShowDetails] = useState(false);

  if (!error) return null;

  // 使用新的错误翻译器
  const translatedError = translateError(error);

  // 红色通知(error)不自动关闭，橙色通知(warning)自动关闭
  const isErrorSeverity = translatedError.severity === 'error';
  const autoHideDuration = isErrorSeverity ? null : (showDetails ? null : 6000);

  return (
    <Snackbar
      open={open}
      autoHideDuration={autoHideDuration}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      sx={{
        bottom: '8px !important',
        left: '8px !important',
        zIndex: 9999 // 保持高层级确保不被遮挡
      }}
    >
      <Alert
        severity={translatedError.severity}
        variant="filled"
        onClose={onClose}
        sx={{
          minWidth: 320,
          maxWidth: 500,
          boxShadow: 3,
          '& .MuiAlert-message': {
            width: '100%'
          }
        }}
      >
        <Box>
          {/* 错误标题 */}
          <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
            {translatedError.title}
          </Typography>

          {/* 错误描述 */}
          <Typography variant="body2" sx={{ mb: 1, opacity: 0.95, whiteSpace: 'pre-line' }}>
            {translatedError.message}
          </Typography>

          {/* 解决方案展开/收起 */}
          <Button
            size="small"
            onClick={() => setShowDetails(!showDetails)}
            sx={{
              color: 'inherit',
              p: 0,
              minWidth: 'auto',
              fontSize: '0.75rem',
              textTransform: 'none',
              '&:hover': {
                backgroundColor: 'transparent',
                textDecoration: 'underline'
              }
            }}
          >
            {showDetails ? '隐藏解决方案' : '查看解决方案'}
          </Button>

          {/* 解决方案详情 */}
          <Collapse in={showDetails}>
            <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(255,255,255,0.2)' }}>
              <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>
                解决方案：
              </Typography>
              {translatedError.solutions.map((solution, index) => (
                <Typography
                  key={index}
                  variant="caption"
                  sx={{
                    display: 'block',
                    mb: 0.3,
                    ml: 1,
                    '&::before': {
                      content: '"• "',
                      marginLeft: '-0.5rem'
                    }
                  }}
                >
                  {solution}
                </Typography>
              ))}
            </Box>
          </Collapse>
        </Box>
      </Alert>
    </Snackbar>
  );
};

export default ErrorNotification;
