import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Paper, List, ListItem, ListItemText, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';

const CommandSuggestion = ({
  suggestions = [],
  visible = false,
  position = { x: 0, y: 0, showAbove: false },
  onSelectSuggestion,
  onClose,
  terminalElement,
  currentInput = '',
  initialSelectedIndex = -1
}) => {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const listRef = useRef(null);
  const componentRef = useRef(null);

  // 使用 useMemo 缓存窗口尺寸计算 - 必须在条件渲染之前调用
  const windowDimensions = useMemo(() => {
    if (!visible || suggestions.length === 0) {
      return { width: 200, height: 100 }; // 返回默认值
    }
    
    // 计算动态窗口尺寸的逻辑
    const minWidth = 200;
    const maxWidth = 500;
    const padding = 24;
    const extraPadding = 16;

    const maxCommandLength = Math.max(
      ...suggestions.map(suggestion => suggestion.command.length),
      10
    );

    const longestCommand = suggestions.reduce((longest, current) => 
      current?.command && current.command.length > longest.length ? current.command : longest, 
      ""
    );

    let actualTextWidth = 0;
    try {
      const tempElement = document.createElement('div');
      tempElement.style.position = 'absolute';
      tempElement.style.visibility = 'hidden';
      tempElement.style.height = 'auto';
      tempElement.style.width = 'auto';
      tempElement.style.fontSize = '13px';
      tempElement.style.fontFamily = '"Fira Code", "Consolas", "Monaco", "Courier New", monospace';
      tempElement.style.whiteSpace = 'nowrap';
      tempElement.textContent = longestCommand;
      
      document.body.appendChild(tempElement);
      actualTextWidth = tempElement.offsetWidth;
      document.body.removeChild(tempElement);
      
      console.log('[CommandSuggestion] Actual text width measured:', actualTextWidth, 'for command:', longestCommand);
    } catch (error) {
      const avgCharWidth = 8;
      actualTextWidth = maxCommandLength * avgCharWidth;
      console.log('[CommandSuggestion] Fallback to character estimation:', actualTextWidth);
    }
    
    let suggestedWidth = actualTextWidth + padding + extraPadding;
    const finalWidth = Math.max(minWidth, Math.min(maxWidth, suggestedWidth));
    
    console.log('[CommandSuggestion] Width calculation:', {
      maxCommandLength,
      longestCommand,
      actualTextWidth,
      suggestedWidth,
      finalWidth,
      components: {
        text: actualTextWidth,
        padding,
        extra: extraPadding
      }
    });

    // 计算更精确的高度，考虑单个项目的高度和底部提示栏
    const itemHeight = 28; // 每个建议项的高度
    const bottomBarHeight = 28; // 底部提示栏高度
    const listPadding = 0; // List 组件的内边距
    
    // 计算内容高度：项目数量 * 项目高度 + 内边距
    const contentHeight = suggestions.length * itemHeight + listPadding;
    // 总高度：内容高度 + 底部提示栏高度
    const totalHeight = contentHeight + bottomBarHeight;
    
    // 设置最大高度限制，但不设置最小高度，让内容自动决定
    const maxAllowedHeight = 280;
    const finalHeight = Math.min(totalHeight, maxAllowedHeight);
    
    // 当达到最大高度时，需要为底部文字预留空间
    const actualContentHeight = totalHeight > maxAllowedHeight 
      ? maxAllowedHeight - bottomBarHeight 
      : contentHeight;
    
    return {
      width: finalWidth,
      height: finalHeight,
      contentHeight: actualContentHeight, // 调整后的内容高度
      needsScrollbar: totalHeight > maxAllowedHeight
    };
  }, [suggestions, visible]); // 依赖项包括visible

  // 监听建议变化以重新计算窗口尺寸
  useEffect(() => {
    if (visible && suggestions.length > 0) {
      console.log('[CommandSuggestion] Suggestions changed, recalculating dimensions:', {
        count: suggestions.length,
        commands: suggestions.map(s => s.command)
      });
    }
  }, [suggestions, visible]);

  // 监听窗口大小变化
  useEffect(() => {
    if (!visible) return;

    const handleResize = () => {
      console.log('[CommandSuggestion] Window resized, recalculating position');
      // 触发重新渲染以重新计算位置
      const event = new Event('positionUpdate');
      window.dispatchEvent(event);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [visible]);

  // 重置选中项
  useEffect(() => {
    if (visible && suggestions.length > 0) {
      setSelectedIndex(0);
    } else {
      setSelectedIndex(-1);
    }
  }, [visible, suggestions]);

  // 处理建议选择
  const handleSuggestionSelect = useCallback((suggestion) => {
    console.log('[CommandSuggestion] Selecting suggestion:', suggestion);
    onSelectSuggestion?.(suggestion);
  }, [onSelectSuggestion]);

  // 处理删除建议
  const handleDeleteSuggestion = useCallback(async (suggestion, index) => {
    try {
      console.log('[CommandSuggestion] Deleting suggestion:', suggestion.command);
      
      // 调用删除API
      if (window.terminalAPI && window.terminalAPI.deleteCommandHistory) {
        await window.terminalAPI.deleteCommandHistory(suggestion.command);
        console.log('[CommandSuggestion] Successfully deleted command from history');
        
        // 触发重新获取建议以更新列表
        if (currentInput && currentInput.trim()) {
          // 延迟一点让删除操作完成
          setTimeout(() => {
            // 发送自定义事件通知WebTerminal重新获取建议
            window.dispatchEvent(new CustomEvent('refreshCommandSuggestions', {
              detail: { input: currentInput }
            }));
          }, 100);
        }
      } else {
        console.error('[CommandSuggestion] deleteCommandHistory API not available');
      }
    } catch (error) {
      console.error('[CommandSuggestion] Error deleting command from history:', error);
    }
  }, [currentInput]);

  // 添加全局键盘事件监听，限制方向键只在建议窗口中工作
  useEffect(() => {
    if (!visible) return;

    // 主要的键盘事件处理器
    const keyHandler = (e) => {
      // 只处理建议窗口相关的键
      const restrictedKeys = ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape', 'Delete'];
      
      if (restrictedKeys.includes(e.key)) {
        // 阻止事件的默认行为和传播
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        
        // 执行相应的操作
        switch (e.key) {
          case 'ArrowDown':
            setSelectedIndex(prev => 
              prev < suggestions.length - 1 ? prev + 1 : 0
            );
            break;
          case 'ArrowUp':
            setSelectedIndex(prev => 
              prev > 0 ? prev - 1 : suggestions.length - 1
            );
            break;
          case 'Enter':
          case 'Tab':
            setSelectedIndex(currentIndex => {
              if (currentIndex >= 0 && currentIndex < suggestions.length) {
                handleSuggestionSelect(suggestions[currentIndex]);
              }
              return currentIndex;
            });
            break;
          case 'Delete':
            setSelectedIndex(currentIndex => {
              if (currentIndex >= 0 && currentIndex < suggestions.length) {
                handleDeleteSuggestion(suggestions[currentIndex], currentIndex);
              }
              return currentIndex;
            });
            break;
          case 'Escape':
            onClose?.();
            break;
        }
      }
    };

    // 在捕获阶段添加事件监听器，确保优先处理
    document.addEventListener('keydown', keyHandler, { capture: true, passive: false });
    
    return () => {
      document.removeEventListener('keydown', keyHandler, { capture: true });
    };
  }, [visible, suggestions, handleSuggestionSelect, handleDeleteSuggestion, onClose]); // 移除selectedIndex依赖

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e) => {
      if (componentRef.current && !componentRef.current.contains(e.target)) {
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [visible, onClose]);

  // 滚动选中项到可见区域
  useEffect(() => {
    if (visible && selectedIndex >= 0 && listRef.current) {
      const listItems = listRef.current.querySelectorAll('[data-suggestion-index]');
      const selectedItem = listItems[selectedIndex];
      if (selectedItem) {
        selectedItem.scrollIntoView({
          block: 'nearest',
          behavior: 'smooth'
        });
      }
    }
  }, [selectedIndex, visible]);

  if (!visible || suggestions.length === 0) {
    return null;
  }

  // 计算建议窗口位置（使用缓存的尺寸）
  const getWindowPosition = () => {
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    const suggestionWidth = windowDimensions.width;
    const suggestionHeight = windowDimensions.height;

    let left = position.x;
    let top = position.y;

    // 检查位置是否有效（不能简单检查是否为0，因为光标可能真的在0位置）
    const isValidPosition = (typeof left === 'number' && typeof top === 'number' && 
                           !isNaN(left) && !isNaN(top));

    // 如果位置信息无效，尝试获取终端元素位置作为备选
    if (!isValidPosition) {
      console.log('[CommandSuggestion] Invalid position, using fallback');
      if (terminalElement) {
        const terminalRect = terminalElement.getBoundingClientRect();
        left = terminalRect.left + 50;
        top = terminalRect.top + 50;
      } else {
        left = 100;
        top = 100;
      }
    } else {
      console.log('[CommandSuggestion] Using provided position:', { x: left, y: top });
    }

    // 根据 showAbove 标志决定显示位置
    if (position.showAbove) {
      top = top - suggestionHeight - 5;
    } else {
      top = top + 25; // 在光标下方一点显示
    }

    // 边界检查和调整
    const padding = 10; // 距离窗口边缘的最小距离
    
    // 防止超出右边界
    if (left + suggestionWidth > windowWidth - padding) {
      left = Math.max(padding, windowWidth - suggestionWidth - padding);
    }

    // 防止超出左边界
    if (left < padding) {
      left = padding;
    }

    // 防止超出下边界
    if (top + suggestionHeight > windowHeight - padding) {
      // 尝试在光标上方显示
      const originalY = isValidPosition ? position.y : 100;
      const newTop = originalY - suggestionHeight - 5;
      if (newTop >= padding) {
        top = newTop;
      } else {
        // 如果上方也放不下，就放在能放下的地方
        top = Math.max(padding, windowHeight - suggestionHeight - padding);
      }
    }

    // 防止超出上边界
    if (top < padding) {
      // 尝试在光标下方显示
      const originalY = isValidPosition ? position.y : 100;
      const newTop = originalY + 25;
      if (newTop + suggestionHeight <= windowHeight - padding) {
        top = newTop;
      } else {
        top = padding;
      }
    }

    console.log('[CommandSuggestion] Final position calculated:', {
      original: position,
      calculated: { left, top },
      window: { width: windowWidth, height: windowHeight },
      suggestion: { width: suggestionWidth, height: suggestionHeight },
      isValidPosition,
      boundaries: {
        rightEdge: left + suggestionWidth,
        bottomEdge: top + suggestionHeight,
        withinBounds: {
          horizontal: left >= padding && left + suggestionWidth <= windowWidth - padding,
          vertical: top >= padding && top + suggestionHeight <= windowHeight - padding
        }
      }
    });

    return { left, top, width: suggestionWidth, height: suggestionHeight };
  };

  const windowPosition = getWindowPosition();

  // 高亮匹配的文本
  const highlightMatch = (text, input) => {
    if (!input || !text) return text;
    
    const lowerText = text.toLowerCase();
    const lowerInput = input.toLowerCase();
    const index = lowerText.indexOf(lowerInput);
    
    if (index === -1) return text;
    
    return (
      <>
        {text.substring(0, index)}
        <span style={{ 
          backgroundColor: theme.palette.primary.main, 
          color: theme.palette.primary.contrastText,
          fontWeight: 'bold'
        }}>
          {text.substring(index, index + input.length)}
        </span>
        {text.substring(index + input.length)}
      </>
    );
  };

  return (
    <Paper
      ref={componentRef}
      elevation={8}
      sx={{
        position: 'fixed',
        left: windowPosition.left,
        top: windowPosition.top,
        width: windowPosition.width,
        maxHeight: windowPosition.height,
        zIndex: 9999,
        overflow: 'hidden',
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
        boxShadow: theme.shadows[12],
        // 添加过渡动画以平滑显示位置和尺寸变化
        transition: 'left 0.1s ease-out, top 0.1s ease-out, width 0.2s ease-out',
        // 确保窗口不会被其他元素遮挡
        '&::before': {
          content: '""',
          position: 'absolute',
          top: -5,
          left: -5,
          right: -5,
          bottom: -5,
          zIndex: -1,
          backgroundColor: 'transparent',
          pointerEvents: 'none'
        }
      }}
    >
      <List
        ref={listRef}
        dense
        sx={{
          // 使用精确的内容高度，只有在需要时才启用滚动
          height: windowDimensions.contentHeight,
          maxHeight: windowDimensions.contentHeight,
          // 移除绝对最小高度限制，让内容自动决定高度，确保能完整显示一条记录
          overflow: windowDimensions.needsScrollbar ? 'auto' : 'hidden', // 只有需要时才显示滚动条
          padding: 0,
          // 只有在确实需要滚动时才显示滚动条样式
          ...(windowDimensions.needsScrollbar && {
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              backgroundColor: 'transparent',
            },
            '&::-webkit-scrollbar-thumb': {
              backgroundColor: theme.palette.divider,
              borderRadius: '3px',
            },
          })
        }}
      >
        {suggestions.map((suggestion, index) => (
          <ListItem
            key={`${suggestion.command}-${index}`}
            data-suggestion-index={index}
            button
            selected={selectedIndex === index}
            onClick={() => handleSuggestionSelect(suggestion)}
            onMouseEnter={() => setSelectedIndex(index)}
            sx={{
              padding: '4px 8px', 
              cursor: 'pointer',
              height: '28px', 
              minHeight: '28px', 
              maxHeight: '28px', 
              display: 'flex',
              alignItems: 'center', 
              backgroundColor: selectedIndex === index 
                ? theme.palette.action.selected 
                : 'transparent',
              '&:hover': {
                backgroundColor: theme.palette.action.hover,
              },
              borderLeft: selectedIndex === index 
                ? `2px solid ${theme.palette.primary.main}` 
                : '2px solid transparent',
              transition: 'all 0.2s ease',
            }}
          >
            <ListItemText
              primary={
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily: '"Fira Code", "Consolas", "Monaco", "Courier New", monospace',
                    fontSize: '12px',
                    color: theme.palette.text.primary,
                    lineHeight: 1.2,
                    // 只有当命令很长时才使用省略号，否则显示完整文本
                    ...(suggestion.command.length > 50 ? {
                      maxWidth: windowPosition.width - 30,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    } : {
                      wordBreak: 'break-all',
                      whiteSpace: 'pre-wrap'
                    })
                  }}
                >
                  {highlightMatch(suggestion.command, currentInput)}
                </Typography>
              }
              secondary={
                suggestion.count > 1 && (
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '10px' }}>
                    使用了 {suggestion.count} 次
                  </Typography>
                )
              }
              sx={{ margin: 0, flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}
            />
          </ListItem>
        ))}
      </List>
      
      {/* 底部提示信息 */}
      <div
        style={{
          padding: '4px 8px',
          backgroundColor: theme.palette.background.default,
          borderTop: `1px solid ${theme.palette.divider}`,
          fontSize: '10px',
          color: theme.palette.text.secondary,
          textAlign: 'center'
        }}
      >
        <Typography variant="caption" sx={{ fontSize: '10px' }}>
          Enter/Tab 确认 • Del 删除
        </Typography>
      </div>
    </Paper>
  );
};

export default CommandSuggestion;