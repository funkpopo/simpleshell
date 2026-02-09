import React, { createContext, useContext, useState, useCallback } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';

const NotificationContext = createContext(null);

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState('info'); // 'success' | 'info' | 'warning' | 'error'
  const [duration, setDuration] = useState(5000);

  const showNotification = useCallback((msg, type = 'info', options = {}) => {
    const { autoHideDuration = 5000 } = options;

    setMessage(msg);
    setSeverity(type);
    setDuration(autoHideDuration);
    setOpen(true);
  }, []);

  const showError = useCallback((msg, options) => {
    showNotification(msg, 'error', { autoHideDuration: null, ...options }); // 红色通知不自动关闭
  }, [showNotification]);

  const showSuccess = useCallback((msg, options) => {
    showNotification(msg, 'success', { autoHideDuration: 5000, ...options });
  }, [showNotification]);

  const showInfo = useCallback((msg, options) => {
    showNotification(msg, 'info', { autoHideDuration: 5000, ...options });
  }, [showNotification]);

  const showWarning = useCallback((msg, options) => {
    showNotification(msg, 'warning', { autoHideDuration: 5000, ...options });
  }, [showNotification]);

  const handleClose = (event, reason) => {
    if (reason === 'clickaway') {
      return;
    }
    setOpen(false);
  };

  return (
    <NotificationContext.Provider value={{ showNotification, showError, showSuccess, showInfo, showWarning }}>
      {children}
      <Snackbar
        open={open}
        autoHideDuration={duration}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        sx={{
          bottom: '24px !important',
          left: '24px !important',
          zIndex: 9999
        }}
      >
        <Alert
          severity={severity}
          variant="filled"
          onClose={handleClose}
          sx={{
            minWidth: 300,
            maxWidth: 450,
            boxShadow: 3,
            '& .MuiAlert-message': {
              width: '100%'
            }
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 500 }}>
            {message}
          </Typography>
        </Alert>
      </Snackbar>
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
