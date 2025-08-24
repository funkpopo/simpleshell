import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Typography,
  Box,
  FormControlLabel,
  Switch,
  Chip,
  Alert,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  Tabs,
  Tab,
  Grid,
  Tooltip,
  InputAdornment
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AddIcon from '@mui/icons-material/Add';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@mui/material/styles';

const TerminalConfigDialog = ({ open, onClose, terminal = null, onSave }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const isEditing = Boolean(terminal);
  const [activeTab, setActiveTab] = useState(0);
  
  const [formData, setFormData] = useState({
    name: '',
    executable: '',
    args: [],
    cwd: '',
    env: {},
    icon: 'terminal',
    description: '',
    runInBackground: false
  });
  
  const [argInput, setArgInput] = useState('');
  const [envKey, setEnvKey] = useState('');
  const [envValue, setEnvValue] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (terminal) {
      setFormData({
        name: terminal.name || '',
        executable: terminal.executable || '',
        args: terminal.args || [],
        cwd: terminal.cwd || '',
        env: terminal.env || {},
        icon: terminal.icon || 'terminal',
        description: terminal.description || '',
        runInBackground: terminal.runInBackground || false
      });
    } else {
      setFormData({
        name: '',
        executable: '',
        args: [],
        cwd: '',
        env: {},
        icon: 'terminal',
        description: '',
        runInBackground: false
      });
    }
    setErrors({});
  }, [terminal, open]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
    
    // 清除相关错误
    if (errors[field]) {
      setErrors(prev => ({
        ...prev,
        [field]: ''
      }));
    }
  };

  const handleAddArg = () => {
    if (argInput.trim()) {
      setFormData(prev => ({
        ...prev,
        args: [...prev.args, argInput.trim()]
      }));
      setArgInput('');
    }
  };

  const handleRemoveArg = (index) => {
    setFormData(prev => ({
      ...prev,
      args: prev.args.filter((_, i) => i !== index)
    }));
  };

  const handleAddEnv = () => {
    if (envKey.trim() && envValue.trim()) {
      setFormData(prev => ({
        ...prev,
        env: {
          ...prev.env,
          [envKey.trim()]: envValue.trim()
        }
      }));
      setEnvKey('');
      setEnvValue('');
    }
  };

  const handleRemoveEnv = (key) => {
    setFormData(prev => {
      const newEnv = { ...prev.env };
      delete newEnv[key];
      return {
        ...prev,
        env: newEnv
      };
    });
  };

  const handleSelectFile = async () => {
    // 通过 Electron 的对话框选择文件
    if (window.dialogAPI && window.dialogAPI.showOpenDialog) {
      const result = await window.dialogAPI.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Executables', extensions: ['exe', 'bat', 'cmd', 'sh', 'app'] },
          { name: 'Scripts', extensions: ['ps1', 'py', 'js', 'jar'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        title: t('localTerminal.config.selectExecutable', '选择可执行文件')
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        const selectedPath = result.filePaths[0];
        // 直接使用选择的路径，不做额外处理
        handleInputChange('executable', selectedPath);
        
        // 如果没有设置名称，自动根据文件名生成
        if (!formData.name) {
          const fileName = selectedPath.split(/[\\\/]/).pop();
          const nameWithoutExt = fileName.replace(/\.[^/.]+$/, '');
          handleInputChange('name', nameWithoutExt);
        }
      }
    }
  };

  const handleSelectCwd = async () => {
    if (window.dialogAPI && window.dialogAPI.showOpenDialog) {
      const result = await window.dialogAPI.showOpenDialog({
        properties: ['openDirectory'],
        title: t('localTerminal.config.selectWorkingDirectory', '选择工作目录')
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        handleInputChange('cwd', result.filePaths[0]);
      }
    }
  };

  const validateForm = () => {
    const newErrors = {};
    
    if (!formData.name.trim()) {
      newErrors.name = t('localTerminal.config.nameRequired');
    }
    
    if (!formData.executable.trim()) {
      newErrors.executable = t('localTerminal.config.executableRequired');
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = () => {
    if (!validateForm()) {
      return;
    }
    
    const terminalConfig = {
      ...formData,
      name: formData.name.trim(),
      executable: formData.executable.trim(),
      cwd: formData.cwd.trim() || null,
      description: formData.description.trim()
    };
    
    if (terminal && terminal.id) {
      terminalConfig.id = terminal.id;
    }
    
    onSave(terminalConfig);
  };

  const iconOptions = [
    { value: 'terminal', label: 'Terminal' },
    { value: 'vscode', label: 'VS Code' },
    { value: 'git', label: 'Git' },
    { value: 'editor', label: 'Editor' },
    { value: 'browser', label: 'Browser' },
    { value: 'database', label: 'Database' },
    { value: 'server', label: 'Server' },
    { value: 'tool', label: 'Tool' }
  ];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          minHeight: '60vh'
        }
      }}
    >
      <DialogTitle sx={{ 
        borderBottom: `1px solid ${theme.palette.divider}`,
        pb: 1
      }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="h6">
            {isEditing ? t('localTerminal.config.editTitle') : t('localTerminal.config.addTitle')}
          </Typography>
          <IconButton onClick={onClose} size="small" edge="end">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent sx={{ p: 0 }}>
        <Tabs 
          value={activeTab} 
          onChange={(e, v) => setActiveTab(v)}
          sx={{ 
            borderBottom: 1, 
            borderColor: 'divider',
            px: 2
          }}
        >
          <Tab label={t('localTerminal.config.basicTab', '基本设置')} />
          <Tab label={t('localTerminal.config.advancedTab', '高级设置')} />
        </Tabs>
        
        <Box sx={{ p: 3 }}>
          {activeTab === 0 && (
            <Grid container spacing={3}>
              {/* 基本信息区域 */}
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom color="primary">
                    {t('localTerminal.config.basicInfo', '基本信息')}
                  </Typography>
                  
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label={t('localTerminal.config.name')}
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        error={Boolean(errors.name)}
                        helperText={errors.name}
                        fullWidth
                        required
                        size="small"
                        InputProps={{
                          endAdornment: (
                            <Tooltip title={t('localTerminal.config.nameHelp', '显示在列表中的名称')}>
                              <InputAdornment position="end">
                                <HelpOutlineIcon fontSize="small" sx={{ color: 'text.secondary' }} />
                              </InputAdornment>
                            </Tooltip>
                          )
                        }}
                      />
                    </Grid>
                    
                    <Grid item xs={12} md={6}>
                      <FormControl fullWidth size="small">
                        <InputLabel>{t('localTerminal.config.icon')}</InputLabel>
                        <Select
                          value={formData.icon}
                          onChange={(e) => handleInputChange('icon', e.target.value)}
                          label={t('localTerminal.config.icon')}
                        >
                          {iconOptions.map(option => (
                            <MenuItem key={option.value} value={option.value}>
                              {option.label}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                    
                    <Grid item xs={12}>
                      <TextField
                        label={t('localTerminal.config.description')}
                        value={formData.description}
                        onChange={(e) => handleInputChange('description', e.target.value)}
                        multiline
                        rows={2}
                        fullWidth
                        size="small"
                        placeholder={t('localTerminal.config.descriptionPlaceholder', '可选：简短描述此应用的用途')}
                      />
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
              
              {/* 执行配置区域 */}
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom color="primary">
                    {t('localTerminal.config.executionConfig', '执行配置')}
                  </Typography>
                  
                  <Grid container spacing={2} sx={{ mt: 1 }}>
                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                          label={t('localTerminal.config.executable')}
                          value={formData.executable}
                          onChange={(e) => handleInputChange('executable', e.target.value)}
                          error={Boolean(errors.executable)}
                          helperText={errors.executable || t('localTerminal.config.executableHelp')}
                          fullWidth
                          required
                          size="small"
                          placeholder="例如: code, notepad++, C:\\Program Files\\Git\\bin\\bash.exe"
                        />
                        <IconButton 
                          onClick={handleSelectFile} 
                          sx={{ 
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 1
                          }}
                        >
                          <FolderOpenIcon />
                        </IconButton>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12}>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                          label={t('localTerminal.config.workingDirectory')}
                          value={formData.cwd}
                          onChange={(e) => handleInputChange('cwd', e.target.value)}
                          helperText={t('localTerminal.config.workingDirectoryHelp')}
                          fullWidth
                          size="small"
                          placeholder={t('localTerminal.config.cwdPlaceholder', '可选：留空使用默认目录')}
                        />
                        <IconButton 
                          onClick={handleSelectCwd}
                          sx={{ 
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 1
                          }}
                        >
                          <FolderOpenIcon />
                        </IconButton>
                      </Box>
                    </Grid>
                    
                    <Grid item xs={12}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={formData.runInBackground}
                            onChange={(e) => handleInputChange('runInBackground', e.target.checked)}
                            size="small"
                          />
                        }
                        label={t('localTerminal.config.runInBackground')}
                      />
                      {formData.runInBackground && (
                        <Alert severity="info" sx={{ mt: 1 }}>
                          {t('localTerminal.config.runInBackgroundInfo')}
                        </Alert>
                      )}
                    </Grid>
                  </Grid>
                </Paper>
              </Grid>
            </Grid>
          )}
          
          {activeTab === 1 && (
            <Grid container spacing={3}>
              {/* 参数配置 */}
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom color="primary">
                    {t('localTerminal.config.arguments')}
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
                      <TextField
                        size="small"
                        placeholder={t('localTerminal.config.addArgument')}
                        value={argInput}
                        onChange={(e) => setArgInput(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleAddArg()}
                        fullWidth
                        helperText={t('localTerminal.config.argHelp', '例如: --version, -h, /c')}
                      />
                      <Button 
                        onClick={handleAddArg} 
                        variant="contained" 
                        size="small"
                        startIcon={<AddIcon />}
                        sx={{ minWidth: 100 }}
                      >
                        {t('common.add')}
                      </Button>
                    </Box>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minHeight: 40 }}>
                      {formData.args.length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          {t('localTerminal.config.noArgs', '暂无参数')}
                        </Typography>
                      ) : (
                        formData.args.map((arg, index) => (
                          <Chip
                            key={index}
                            label={arg}
                            onDelete={() => handleRemoveArg(index)}
                            size="small"
                            variant="outlined"
                          />
                        ))
                      )}
                    </Box>
                  </Box>
                </Paper>
              </Grid>
              
              {/* 环境变量配置 */}
              <Grid item xs={12}>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="subtitle2" gutterBottom color="primary">
                    {t('localTerminal.config.environmentVariables')}
                  </Typography>
                  <Box sx={{ mt: 2 }}>
                    <Grid container spacing={1} sx={{ mb: 1 }}>
                      <Grid item xs={5}>
                        <TextField
                          size="small"
                          placeholder="变量名"
                          value={envKey}
                          onChange={(e) => setEnvKey(e.target.value)}
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={5}>
                        <TextField
                          size="small"
                          placeholder="变量值"
                          value={envValue}
                          onChange={(e) => setEnvValue(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && handleAddEnv()}
                          fullWidth
                        />
                      </Grid>
                      <Grid item xs={2}>
                        <Button 
                          onClick={handleAddEnv} 
                          variant="contained" 
                          size="small"
                          fullWidth
                          startIcon={<AddIcon />}
                        >
                          {t('common.add')}
                        </Button>
                      </Grid>
                    </Grid>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, minHeight: 40 }}>
                      {Object.keys(formData.env).length === 0 ? (
                        <Typography variant="caption" color="text.secondary">
                          {t('localTerminal.config.noEnvVars', '暂无环境变量')}
                        </Typography>
                      ) : (
                        Object.entries(formData.env).map(([key, value]) => (
                          <Chip
                            key={key}
                            label={`${key}=${value}`}
                            onDelete={() => handleRemoveEnv(key)}
                            size="small"
                            variant="outlined"
                            sx={{ maxWidth: '100%' }}
                          />
                        ))
                      )}
                    </Box>
                  </Box>
                </Paper>
              </Grid>
            </Grid>
          )}
        </Box>
      </DialogContent>
      
      <DialogActions sx={{ 
        borderTop: `1px solid ${theme.palette.divider}`,
        p: 2 
      }}>
        <Button onClick={onClose} color="inherit">
          {t('common.cancel')}
        </Button>
        <Button onClick={handleSubmit} variant="contained" color="primary">
          {isEditing ? t('common.update') : t('common.add')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TerminalConfigDialog;