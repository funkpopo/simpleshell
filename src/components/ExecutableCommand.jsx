/**
 * 可执行命令组件
 * 显示AI回复中的命令块，带有风险等级标识和执行按钮
 */
import React, { useState, memo } from 'react';
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Collapse,
  Alert,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ErrorIcon from '@mui/icons-material/Error';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import InfoIcon from '@mui/icons-material/Info';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useTranslation } from 'react-i18next';
import { RISK_LEVELS, requiresConfirmation } from '../utils/aiSystemPrompt';

/**
 * 获取风险等级对应的图标
 */
const getRiskIcon = (risk) => {
  switch (risk.name) {
    case 'critical':
      return <ErrorIcon fontSize="small" sx={{ color: risk.color }} />;
    case 'high':
      return <WarningAmberIcon fontSize="small" sx={{ color: risk.color }} />;
    case 'medium':
      return <WarningAmberIcon fontSize="small" sx={{ color: risk.color }} />;
    case 'low':
      return <InfoIcon fontSize="small" sx={{ color: risk.color }} />;
    default:
      return <CheckCircleIcon fontSize="small" sx={{ color: risk.color }} />;
  }
};

/**
 * 确认对话框组件
 */
const ConfirmationDialog = memo(({ open, onClose, onConfirm, command, risk, t }) => (
  <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {getRiskIcon(risk)}
      <Typography variant="h6">
        {t('ai.confirmExecution')}
      </Typography>
    </DialogTitle>
    <DialogContent>
      <Alert severity={risk.level >= RISK_LEVELS.HIGH.level ? 'error' : 'warning'} sx={{ mb: 2 }}>
        {t('ai.riskWarning', { level: t(`ai.riskLevels.${risk.name}`) })}
      </Alert>
      <DialogContentText sx={{ mb: 2 }}>
        {risk.description || t(`ai.riskDescriptions.${risk.name}`)}
      </DialogContentText>
      <Box
        sx={{
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          fontFamily: 'monospace',
          fontSize: '0.9rem',
          wordBreak: 'break-all',
          whiteSpace: 'pre-wrap',
        }}
      >
        {command}
      </Box>
    </DialogContent>
    <DialogActions sx={{ px: 3, pb: 2 }}>
      <Button onClick={onClose} color="inherit">
        {t('common.cancel')}
      </Button>
      <Button
        onClick={onConfirm}
        variant="contained"
        color={risk.level >= RISK_LEVELS.CRITICAL.level ? 'error' : 'warning'}
        startIcon={<PlayArrowIcon />}
      >
        {t('ai.executeAnyway')}
      </Button>
    </DialogActions>
  </Dialog>
));

/**
 * 单个可执行命令块组件
 */
const ExecutableCommand = memo(({
  command,
  risk,
  onExecute,
  onCopy,
  disabled = false,
}) => {
  const { t, i18n } = useTranslation();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const isZhCN = i18n.language === 'zh-CN' || i18n.language.startsWith('zh');
  const riskLabel = isZhCN ? risk.label : risk.labelEn;

  const handleExecuteClick = () => {
    if (requiresConfirmation(risk)) {
      setConfirmOpen(true);
    } else {
      onExecute?.(command);
    }
  };

  const handleConfirm = () => {
    setConfirmOpen(false);
    onExecute?.(command);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      onCopy?.(command);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy command:', err);
    }
  };

  return (
    <>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'stretch',
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: risk.color,
          borderRadius: 1,
          overflow: 'hidden',
          my: 1,
          transition: 'all 0.2s ease',
          '&:hover': {
            boxShadow: `0 0 8px ${risk.color}40`,
          },
        }}
      >
        {/* 风险等级标识条 */}
        <Box
          sx={{
            width: 4,
            bgcolor: risk.color,
            flexShrink: 0,
          }}
        />

        {/* 命令内容区 */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          {/* 风险标签行 */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              px: 1.5,
              py: 0.5,
              bgcolor: `${risk.color}15`,
              borderBottom: '1px solid',
              borderColor: 'divider',
            }}
          >
            <Chip
              size="small"
              icon={getRiskIcon(risk)}
              label={riskLabel}
              sx={{
                height: 22,
                fontSize: '0.75rem',
                bgcolor: `${risk.color}20`,
                color: risk.color,
                '& .MuiChip-icon': {
                  color: risk.color,
                },
              }}
            />
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Tooltip title={copied ? t('ai.copied') : t('ai.copyCommand')}>
                <IconButton
                  size="small"
                  onClick={handleCopy}
                  sx={{ p: 0.5 }}
                >
                  <ContentCopyIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('ai.executeCommand')}>
                <span>
                  <IconButton
                    size="small"
                    onClick={handleExecuteClick}
                    disabled={disabled}
                    sx={{
                      p: 0.5,
                      bgcolor: risk.color,
                      color: 'white',
                      '&:hover': {
                        bgcolor: risk.color,
                        filter: 'brightness(1.1)',
                      },
                      '&.Mui-disabled': {
                        bgcolor: 'action.disabledBackground',
                        color: 'action.disabled',
                      },
                    }}
                  >
                    <PlayArrowIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>

          {/* 命令文本 */}
          <Box
            sx={{
              px: 1.5,
              py: 1,
              fontFamily: 'monospace',
              fontSize: '0.875rem',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              bgcolor: (theme) =>
                theme.palette.mode === 'dark'
                  ? 'rgba(0, 0, 0, 0.2)'
                  : 'rgba(0, 0, 0, 0.03)',
            }}
          >
            {command}
          </Box>
        </Box>
      </Box>

      {/* 确认对话框 */}
      <ConfirmationDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleConfirm}
        command={command}
        risk={risk}
        t={t}
      />
    </>
  );
});

/**
 * 命令块列表组件
 * 用于显示多个命令的折叠列表
 */
export const CommandBlockList = memo(({
  commands,
  onExecute,
  onCopy,
  disabled = false,
  collapsible = true,
  defaultExpanded = true,
}) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (!commands || commands.length === 0) {
    return null;
  }

  const highRiskCount = commands.filter(
    (cmd) => cmd.risk.level >= RISK_LEVELS.HIGH.level
  ).length;

  return (
    <Box sx={{ my: 1 }}>
      {collapsible && commands.length > 1 && (
        <Box
          onClick={() => setExpanded(!expanded)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            cursor: 'pointer',
            py: 0.5,
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          <Typography variant="body2" sx={{ ml: 0.5 }}>
            {t('ai.commandsCount', { count: commands.length })}
            {highRiskCount > 0 && (
              <Typography
                component="span"
                variant="body2"
                sx={{ ml: 1, color: 'error.main' }}
              >
                ({t('ai.highRiskCount', { count: highRiskCount })})
              </Typography>
            )}
          </Typography>
        </Box>
      )}

      <Collapse in={!collapsible || expanded}>
        {commands.map((cmd, index) => (
          <ExecutableCommand
            key={`${cmd.command}-${index}`}
            command={cmd.command}
            risk={cmd.risk}
            onExecute={onExecute}
            onCopy={onCopy}
            disabled={disabled}
          />
        ))}
      </Collapse>
    </Box>
  );
});

export default ExecutableCommand;
