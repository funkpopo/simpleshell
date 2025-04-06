import React from 'react';
import { Box, Typography, Paper } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ComputerIcon from '@mui/icons-material/Computer';

const WelcomePage = () => {
  const theme = useTheme();
  
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        p: 3,
        bgcolor: 'background.default',
      }}
    >
      <Paper
        elevation={3}
        sx={{
          p: 5,
          borderRadius: 2,
          maxWidth: 800,
          width: '100%',
          textAlign: 'center',
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ mb: 4, display: 'flex', justifyContent: 'center' }}>
          <ComputerIcon sx={{ fontSize: 80, color: 'primary.main', mb: 2 }} />
        </Box>
        
        <Typography variant="h4" gutterBottom sx={{ fontWeight: 'bold', mb: 3 }}>
          欢迎使用 SimpleShell
        </Typography>
        
        <Typography variant="body1" paragraph sx={{ mb: 4 }}>
          SimpleShell 是一个轻量级的终端模拟器，提供了简单易用的界面和强大的功能。
        </Typography>
      </Paper>
    </Box>
  );
};

export default WelcomePage; 