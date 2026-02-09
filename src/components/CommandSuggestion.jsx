import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { Paper, List, ListItemButton, ListItemText, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useConditionalWindowEvent } from "../hooks/useWindowEvent.js";

const COMMAND_FONT =
  '13px "Fira Code", "Consolas", "Monaco", "Courier New", monospace';

const measureCommandText = (() => {
  let canvas = null;
  let context = null;
  const cache = new Map();
  const fallbackCharWidth = 8;

  const ensureContext = () => {
    if (typeof document === "undefined") {
      return null;
    }

    if (!canvas) {
      canvas = document.createElement("canvas");
    }

    if (!context && canvas) {
      context = canvas.getContext("2d");
    }

    return context;
  };

  return (text = "", font = COMMAND_FONT) => {
    const key = `${font}__${text}`;
    if (cache.has(key)) {
      return cache.get(key);
    }

    const ctx = ensureContext();
    let width;

    if (!ctx) {
      width = text.length * fallbackCharWidth;
    } else {
      ctx.font = font;
      width = ctx.measureText(text).width || text.length * fallbackCharWidth;
    }

    cache.set(key, width);
    return width;
  };
})();

const CommandSuggestion = ({
  suggestions = [],
  visible = false,
  position = { x: 0, y: 0, showAbove: false },
  onSelectSuggestion,
  onClose,
  terminalElement,
  currentInput = "",
  initialSelectedIndex = -1,
}) => {
  const theme = useTheme();
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const listRef = useRef(null);
  const componentRef = useRef(null);
  const [keyboardNavigated, setKeyboardNavigated] = useState(false);
  const keyboardNavigatedRef = useRef(false);
  const selectedIndexRef = useRef(selectedIndex);

  useEffect(() => {
    keyboardNavigatedRef.current = keyboardNavigated;
  }, [keyboardNavigated]);

  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

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
      ...suggestions.map((suggestion) => suggestion.command.length),
      10,
    );

    const longestCommand = suggestions.reduce(
      (longest, current) =>
        current?.command && current.command.length > longest.length
          ? current.command
          : longest,
      "",
    );

    let actualTextWidth = 0;
    try {
      actualTextWidth = measureCommandText(longestCommand, COMMAND_FONT);
    } catch {
      actualTextWidth = 0;
    }

    if (!Number.isFinite(actualTextWidth) || actualTextWidth === 0) {
      actualTextWidth = maxCommandLength * 8;
    }

    let suggestedWidth = actualTextWidth + padding + extraPadding;
    const finalWidth = Math.max(minWidth, Math.min(maxWidth, suggestedWidth));

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
    const actualContentHeight =
      totalHeight > maxAllowedHeight
        ? maxAllowedHeight - bottomBarHeight
        : contentHeight;

    return {
      width: finalWidth,
      height: finalHeight,
      contentHeight: actualContentHeight, // 调整后的内容高度
      needsScrollbar: totalHeight > maxAllowedHeight,
    };
  }, [suggestions, visible]); // 依赖项包括visible

  // 监听建议变化以重新计算窗口尺寸
  useEffect(() => {
    if (visible && suggestions.length > 0) {
      // Recalculating dimensions when suggestions change
    }
  }, [suggestions, visible]);

  // 监听窗口大小变化（使用 useConditionalWindowEvent Hook）
  const handleResize = useCallback(() => {
    // 触发重新渲染以重新计算位置
    const event = new Event("positionUpdate");
    window.dispatchEvent(event);
  }, []);

  useConditionalWindowEvent("resize", handleResize, visible);

  // 重置选中项
  useEffect(() => {
    if (visible) {
      setSelectedIndex(-1);
      setKeyboardNavigated(false);
    }
  }, [visible, suggestions]);

  // 处理建议选择
  const handleSuggestionSelect = useCallback(
    (suggestion) => {
      onSelectSuggestion?.(suggestion);
    },
    [onSelectSuggestion],
  );

  // 处理鼠标悬停选择 - 使用 useCallback 包装以避免在渲染期间更新状态
  const handleMouseEnter = useCallback((index) => {
    // 使用 setTimeout 延迟状态更新，确保不会在渲染期间发生
    setTimeout(() => {
      setSelectedIndex(index);
    }, 0);
  }, []);

  // 处理删除建议
  const handleDeleteSuggestion = useCallback(
    async (suggestion) => {
      try {
        // 调用删除API
        if (window.terminalAPI && window.terminalAPI.deleteCommandHistory) {
          await window.terminalAPI.deleteCommandHistory(suggestion.command);

          // 触发重新获取建议以更新列表
          if (currentInput && currentInput.trim()) {
            // 延迟一点让删除操作完成
            setTimeout(() => {
              // 发送自定义事件通知WebTerminal重新获取建议
              window.dispatchEvent(
                new CustomEvent("refreshCommandSuggestions", {
                  detail: { input: currentInput },
                }),
              );
            }, 100);
          }
        } else {
          // deleteCommandHistory API not available
        }
      } catch {
        // Error deleting command from history
      }
    },
    [currentInput],
  );

  // 添加全局键盘事件监听，限制方向键只在建议窗口中工作
  useEffect(() => {
    if (!visible) return;

    // 主要的键盘事件处理器
    const keyHandler = (e) => {
      // 仅当通过方向键激活并有有效选中项时，才拦截 Enter/Delete
      if (e.key === "Enter" || e.key === "Delete") {
        const hasValidSelection =
          selectedIndexRef.current >= 0 &&
          selectedIndexRef.current < suggestions.length;
        if (!(keyboardNavigatedRef.current && hasValidSelection)) {
          // 未激活选择：放行，作为正常输入处理
          return;
        }
      }
      // 只处理建议窗口相关的键
      const restrictedKeys = [
        "ArrowDown",
        "ArrowUp",
        "Enter",
        "Escape",
        "Delete",
      ];

      if (restrictedKeys.includes(e.key)) {
        // 阻止事件的默认行为和传播
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 执行相应的操作
        switch (e.key) {
          case "ArrowDown":
            setKeyboardNavigated(true);
            setSelectedIndex((prev) =>
              prev < suggestions.length - 1 ? prev + 1 : 0,
            );
            break;
          case "ArrowUp":
            setKeyboardNavigated(true);
            setSelectedIndex((prev) =>
              prev > 0 ? prev - 1 : suggestions.length - 1,
            );
            break;
          case "Enter":
            {
              const currentIndex = selectedIndexRef.current;
              if (currentIndex >= 0 && currentIndex < suggestions.length) {
                handleSuggestionSelect(suggestions[currentIndex]);
              }
            }
            break;
          case "Delete":
            {
              const currentIndex = selectedIndexRef.current;
              if (currentIndex >= 0 && currentIndex < suggestions.length) {
                handleDeleteSuggestion(suggestions[currentIndex], currentIndex);
              }
            }
            break;
          case "Escape":
            onClose?.();
            break;
        }
      }
    };

    // 在捕获阶段添加事件监听器，确保优先处理
    document.addEventListener("keydown", keyHandler, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("keydown", keyHandler, { capture: true });
    };
  }, [
    visible,
    suggestions,
    handleSuggestionSelect,
    handleDeleteSuggestion,
    onClose,
  ]); // 移除selectedIndex依赖

  // 点击外部关闭
  useEffect(() => {
    if (!visible) return;

    const handleClickOutside = (e) => {
      if (componentRef.current && !componentRef.current.contains(e.target)) {
        onClose?.();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [visible, onClose]);

  // 滚动选中项到可见区域
  useEffect(() => {
    if (visible && selectedIndex >= 0 && listRef.current) {
      const listItems = listRef.current.querySelectorAll(
        "[data-suggestion-index]",
      );
      const selectedItem = listItems[selectedIndex];
      if (selectedItem) {
        selectedItem.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
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
    const isValidPosition =
      typeof left === "number" &&
      typeof top === "number" &&
      !isNaN(left) &&
      !isNaN(top);

    // 如果位置信息无效，尝试获取终端元素位置作为备选
    if (!isValidPosition) {
      if (terminalElement) {
        const terminalRect = terminalElement.getBoundingClientRect();
        left = terminalRect.left + 50;
        top = terminalRect.top + 50;
      } else {
        left = 100;
        top = 100;
      }
    }

    // 终端容器边界（优先使用容器边界约束其位置，确保在容器内部）
    const containerRect = terminalElement?.getBoundingClientRect();
    const bounds = containerRect
      ? {
          left: containerRect.left,
          top: containerRect.top,
          right: containerRect.right,
          bottom: containerRect.bottom,
        }
      : { left: 0, top: 0, right: windowWidth, bottom: windowHeight };

    // 与容器边界保持内边距
    const padding = 8;
    const gap = 20; // 与光标的垂直间距，确保不遮挡输入行

    // 计算光标下边缘位置（更稳定的定位）
    const cursorBottom =
      position.cursorBottom ?? position.y + (position.cursorHeight || 18);

    // 计算上下可用空间
    const spaceBelow = Math.max(0, bounds.bottom - cursorBottom - gap);
    const spaceAbove = Math.max(0, position.y - bounds.top - gap);

    // 选择展示方向：优先使用传入的showAbove；若空间不足则选择空间更大的一侧
    let showAbove = !!position.showAbove;
    const desiredHeight = suggestionHeight;
    const belowFits = spaceBelow >= Math.min(desiredHeight, 120);
    const aboveFits = spaceAbove >= Math.min(desiredHeight, 120);
    if (!belowFits && !aboveFits) {
      // 两侧都不够，选择空间更大的一侧
      showAbove = spaceAbove > spaceBelow;
    } else if (showAbove && !aboveFits && belowFits) {
      showAbove = false;
    } else if (!showAbove && !belowFits && aboveFits) {
      showAbove = true;
    }

    // 根据容器可用空间动态收缩尺寸，确保完全位于容器内
    const containerWidthAvailable = Math.max(
      50,
      bounds.right - bounds.left - padding * 2,
    );
    const finalWidth = Math.min(suggestionWidth, containerWidthAvailable);

    const containerHeightAvailable = Math.max(
      40,
      bounds.bottom - bounds.top - padding * 2,
    );
    const sideSpace = showAbove ? spaceAbove : spaceBelow;
    let finalHeight = Math.min(
      suggestionHeight,
      containerHeightAvailable,
      sideSpace,
    );
    if (!Number.isFinite(finalHeight) || finalHeight <= 0) {
      // 最小显示高度回退
      finalHeight = Math.min(suggestionHeight, containerHeightAvailable);
    }

    // 使用容器边界进行限制（横向）
    const maxLeftWithin = bounds.right - finalWidth - padding;
    const minLeftWithin = bounds.left + padding;
    if (left > maxLeftWithin) left = Math.max(minLeftWithin, maxLeftWithin);
    if (left < minLeftWithin) left = minLeftWithin;

    // 计算目标top（尽量贴近光标但不遮挡）
    if (showAbove) {
      top = position.y - finalHeight - gap;
    } else {
      top = cursorBottom + gap;
    }

    // 使用容器边界进行限制（纵向）
    const maxTopWithin = bounds.bottom - finalHeight - padding;
    const minTopWithin = bounds.top + padding;
    if (top > maxTopWithin) {
      // 优先尝试翻转到光标上方（如果原来在下方）
      if (!showAbove && isValidPosition) {
        const flippedTop = position.y - finalHeight - gap;
        top = Math.max(minTopWithin, Math.min(flippedTop, maxTopWithin));
      } else {
        top = Math.max(minTopWithin, maxTopWithin);
      }
    }
    if (top < minTopWithin) {
      // 优先尝试翻转到光标下方（如果原来在上方）
      if (showAbove && isValidPosition) {
        const flippedTop = cursorBottom + gap;
        top = Math.max(minTopWithin, Math.min(flippedTop, maxTopWithin));
      } else {
        top = minTopWithin;
      }
    }

    return { left, top, width: finalWidth, height: finalHeight };
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
        <span
          style={{
            backgroundColor: theme.palette.primary.main,
            color: theme.palette.primary.contrastText,
            fontWeight: "bold",
          }}
        >
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
        position: "fixed",
        left: windowPosition.left,
        top: windowPosition.top,
        width: windowPosition.width,
        maxHeight: windowPosition.height,
        // Raise above potential high-z overlays during tab drag previews
        zIndex: 11000,
        overflow: "hidden",
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
        boxShadow: theme.shadows[12],
        // 添加过渡动画以平滑显示位置和尺寸变化
        transition:
          "left 0.1s ease-out, top 0.1s ease-out, width 0.2s ease-out",
        // 确保窗口不会被其他元素遮挡
        "&::before": {
          content: '""',
          position: "absolute",
          top: -5,
          left: -5,
          right: -5,
          bottom: -5,
          zIndex: -1,
          backgroundColor: "transparent",
          pointerEvents: "none",
        },
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
          overflow: windowDimensions.needsScrollbar ? "auto" : "hidden", // 只有需要时才显示滚动条
          padding: 0,
          // 只有在确实需要滚动时才显示滚动条样式
          ...(windowDimensions.needsScrollbar && {
            "&::-webkit-scrollbar": {
              width: "6px",
            },
            "&::-webkit-scrollbar-track": {
              backgroundColor: "transparent",
            },
            "&::-webkit-scrollbar-thumb": {
              backgroundColor: theme.palette.divider,
              borderRadius: "3px",
            },
          }),
        }}
      >
        {suggestions.map((suggestion, index) => (
          <ListItemButton
            key={`${suggestion.command}-${index}`}
            data-suggestion-index={index}
            selected={selectedIndex === index}
            onClick={() => handleSuggestionSelect(suggestion)}
            onMouseEnter={() => handleMouseEnter(index)}
            sx={{
              padding: "4px 8px",
              cursor: "pointer",
              height: "28px",
              minHeight: "28px",
              maxHeight: "28px",
              display: "flex",
              alignItems: "center",
              backgroundColor:
                selectedIndex === index
                  ? theme.palette.action.selected
                  : "transparent",
              "&:hover": {
                backgroundColor: theme.palette.action.hover,
              },
              borderLeft:
                selectedIndex === index
                  ? `2px solid ${theme.palette.primary.main}`
                  : "2px solid transparent",
              transition: "all 0.2s ease",
            }}
          >
            <ListItemText
              primary={
                <Typography
                  variant="body2"
                  sx={{
                    fontFamily:
                      '"Fira Code", "Consolas", "Monaco", "Courier New", monospace',
                    fontSize: "12px",
                    color: theme.palette.text.primary,
                    lineHeight: 1.2,
                    // 只有当命令很长时才使用省略号，否则显示完整文本
                    ...(suggestion.command.length > 50
                      ? {
                          maxWidth: windowPosition.width - 30,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }
                      : {
                          wordBreak: "break-all",
                          whiteSpace: "pre-wrap",
                        }),
                  }}
                >
                  {highlightMatch(suggestion.command, currentInput)}
                </Typography>
              }
              secondary={
                suggestion.count > 1 && (
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontSize: "10px" }}
                  >
                    使用了 {suggestion.count} 次
                  </Typography>
                )
              }
              sx={{
                margin: 0,
                flex: 1,
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-start",
              }}
            />
          </ListItemButton>
        ))}
      </List>

      {/* 底部提示信息 */}
      <div
        style={{
          padding: "4px 8px",
          backgroundColor: theme.palette.background.default,
          borderTop: `1px solid ${theme.palette.divider}`,
          fontSize: "10px",
          color: theme.palette.text.secondary,
          textAlign: "center",
        }}
      >
        <Typography variant="caption" sx={{ fontSize: "10px" }}>
          Enter 确认 • Del 删除
        </Typography>
      </div>
    </Paper>
  );
};

export default CommandSuggestion;
