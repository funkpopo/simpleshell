import React, { useState, useEffect } from 'react';
import {
  Box,
  Collapse,
  IconButton,
  Typography,
  Paper,
  Tooltip,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Psychology as PsychologyIcon,
} from '@mui/icons-material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

/**
 * 思考内容显示组件
 * 用于显示AI的思考过程，支持折叠/展开
 */
const ThinkContent = ({ 
  content, 
  defaultExpanded = false, 
  showIcon = true,
  variant = 'outlined' // 'outlined' | 'filled' | 'minimal'
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  // 如果没有内容，不渲染组件
  if (!content || content.trim() === '') {
    return null;
  }

  const handleToggle = () => {
    setExpanded(!expanded);
  };

  // Markdown渲染配置
  const markdownComponents = {
    // 自定义代码块样式
    code: ({ node, inline, className, children, ...props }) => {
      return !inline ? (
        <Box
          component="pre"
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
            p: 1,
            borderRadius: 1,
            overflow: 'auto',
            fontSize: '0.7rem',
            fontFamily: 'monospace',
            border: `1px solid ${theme.palette.divider}`,
            my: 0.5,
            maxWidth: '100%',
            wordBreak: 'break-all',
            whiteSpace: 'pre-wrap',
          }}
        >
          <code className={className} {...props}>
            {children}
          </code>
        </Box>
      ) : (
        <Box
          component="code"
          sx={{
            bgcolor: theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
            px: 0.5,
            py: 0.25,
            borderRadius: 0.5,
            fontSize: '0.7rem',
            fontFamily: 'monospace',
            wordBreak: 'break-all',
          }}
          {...props}
        >
          {children}
        </Box>
      );
    },
    // 自定义段落样式
    p: ({ children }) => (
      <Typography
        variant="body2"
        sx={{
          fontSize: '0.75rem',
          lineHeight: 1.4,
          mb: 0.5,
          '&:last-child': { mb: 0 }
        }}
      >
        {children}
      </Typography>
    ),
    // 自定义标题样式
    h1: ({ children }) => (
      <Typography variant="subtitle2" sx={{ fontSize: '0.8rem', fontWeight: 'bold', mb: 0.5 }}>
        {children}
      </Typography>
    ),
    h2: ({ children }) => (
      <Typography variant="subtitle2" sx={{ fontSize: '0.75rem', fontWeight: 'bold', mb: 0.5 }}>
        {children}
      </Typography>
    ),
    h3: ({ children }) => (
      <Typography variant="body2" sx={{ fontSize: '0.7rem', fontWeight: 'bold', mb: 0.5 }}>
        {children}
      </Typography>
    ),
  };

  const getContainerStyles = () => {
    const baseStyles = {
      mb: 1,
      borderRadius: 1,
      overflow: 'hidden',
    };

    switch (variant) {
      case 'filled':
        return {
          ...baseStyles,
          bgcolor: theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
          border: `1px solid ${theme.palette.divider}`,
        };
      case 'minimal':
        return {
          ...baseStyles,
          border: `1px dashed ${theme.palette.divider}`,
          bgcolor: 'transparent',
        };
      default: // outlined
        return {
          ...baseStyles,
          border: `1px solid ${theme.palette.divider}`,
          bgcolor: 'transparent',
        };
    }
  };

  return (
    <Paper
      elevation={0}
      sx={getContainerStyles()}
    >
      {/* 头部 - 点击区域 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          p: 1,
          cursor: 'pointer',
          bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          '&:hover': {
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
          },
          transition: 'background-color 0.2s ease',
        }}
        onClick={handleToggle}
      >
        {showIcon && (
          <PsychologyIcon
            sx={{
              fontSize: '1rem',
              color: theme.palette.primary.main,
              mr: 1,
            }}
          />
        )}
        
        <Typography
          variant="caption"
          sx={{
            flex: 1,
            fontSize: '0.7rem',
            fontWeight: 500,
            color: theme.palette.text.secondary,
            userSelect: 'none',
          }}
        >
          {t('aiAssistant.thinkingProcess', '思考过程')}
        </Typography>

        <Tooltip title={expanded ? t('common.collapse', '折叠') : t('common.expand', '展开')}>
          <IconButton
            size="small"
            sx={{
              p: 0.5,
              color: theme.palette.text.secondary,
            }}
          >
            {expanded ? (
              <ExpandLessIcon sx={{ fontSize: '1rem' }} />
            ) : (
              <ExpandMoreIcon sx={{ fontSize: '1rem' }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>

      {/* 内容区域 */}
      <Collapse in={expanded} timeout={200}>
        <Box
          sx={{
            p: 1.5,
            pt: 0.5,
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.5)',
            maxHeight: '300px',
            overflow: 'auto',
            '& > *:first-of-type': { mt: 0 },
            '& > *:last-child': { mb: 0 },
          }}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </Box>
      </Collapse>
    </Paper>
  );
};

export default ThinkContent;
