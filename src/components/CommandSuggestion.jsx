import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  memo,
  useMemo,
} from "react";
import { createPortal } from "react-dom";
import { Box, Typography, Paper } from "@mui/material";
import { useTheme } from "@mui/material/styles";

// 自定义比较函数
const areEqual = (prevProps, nextProps) => {
  return (
    prevProps.visible === nextProps.visible &&
    prevProps.suggestions === nextProps.suggestions &&
    prevProps.position.x === nextProps.position.x &&
    prevProps.position.y === nextProps.position.y &&
    prevProps.position.showAbove === nextProps.position.showAbove &&
    prevProps.currentInput === nextProps.currentInput &&
    prevProps.onSelectSuggestion === nextProps.onSelectSuggestion &&
    prevProps.onClose === nextProps.onClose &&
    prevProps.terminalElement === nextProps.terminalElement
  );
};

const CommandSuggestion = memo(
  ({
    suggestions = [],
    visible = false,
    position = { x: 0, y: 0 },
    onSelectSuggestion,
    onDeleteSuggestion,
    onClose,
    currentInput = "",
    initialSelectedIndex = 0,
  }) => {
    const theme = useTheme();
    const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
    const suggestionRef = useRef(null);
    const [isKeyboardNavigation, setIsKeyboardNavigation] = useState(false);

    // 重置选中索引当建议列表变化时
    useEffect(() => {
      setSelectedIndex(initialSelectedIndex);
    }, [suggestions, initialSelectedIndex]);

    // 处理删除建议
    const handleDeleteSuggestion = useCallback(
      async (suggestion) => {
        if (onDeleteSuggestion) {
          try {
            await onDeleteSuggestion(suggestion);
            // 删除成功后，如果当前选中的是最后一项，则向前移动选中索引
            setSelectedIndex((prev) => {
              const newLength = suggestions.length - 1;
              if (newLength === 0) return 0;
              return prev >= newLength ? newLength - 1 : prev;
            });
          } catch (error) {
            console.error("删除建议失败:", error);
          }
        }
      },
      [onDeleteSuggestion, suggestions.length],
    );

    // 处理键盘事件
    const handleKeyDown = useCallback(
      (event) => {
        if (!visible || suggestions.length === 0) return;

        switch (event.key) {
          case "ArrowDown":
            event.preventDefault();
            event.stopPropagation();
            setIsKeyboardNavigation(true);
            setSelectedIndex((prev) => (prev + 1) % suggestions.length);
            break;
          case "ArrowUp":
            event.preventDefault();
            event.stopPropagation();
            setIsKeyboardNavigation(true);
            setSelectedIndex((prev) =>
              prev === 0 ? suggestions.length - 1 : prev - 1,
            );
            break;
          case "Enter":
            if (suggestions[selectedIndex]) {
              event.preventDefault();
              event.stopPropagation();
              onSelectSuggestion?.(suggestions[selectedIndex]);
            }
            break;
          case "Delete":
            if (suggestions[selectedIndex]) {
              event.preventDefault();
              event.stopPropagation();
              handleDeleteSuggestion(suggestions[selectedIndex]);
            }
            break;
          case "Escape":
            event.preventDefault();
            event.stopPropagation();
            onClose?.();
            break;
          default:
            // 其他键不影响导航状态
            break;
        }
      },
      [
        visible,
        suggestions,
        selectedIndex,
        onSelectSuggestion,
        onClose,
        handleDeleteSuggestion,
      ],
    );

    // 添加全局键盘事件监听
    useEffect(() => {
      if (visible) {
        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
          document.removeEventListener("keydown", handleKeyDown, true);
        };
      }
    }, [visible, handleKeyDown]);

    // 处理鼠标悬停
    const handleMouseEnter = useCallback(
      (index) => {
        if (!isKeyboardNavigation) {
          setSelectedIndex(index);
        }
      },
      [isKeyboardNavigation],
    );

    // 处理鼠标点击
    const handleMouseClick = useCallback(
      (suggestion) => {
        onSelectSuggestion?.(suggestion);
      },
      [onSelectSuggestion],
    );

    // 重置键盘导航状态当鼠标移动时
    const handleMouseMove = useCallback(() => {
      setIsKeyboardNavigation(false);
    }, []);

    // 计算建议窗口的位置
    const calculatePosition = useCallback(() => {
      if (!suggestionRef.current) {
        // 根据showAbove决定初始位置
        const offsetY = position.showAbove ? -200 : 20;
        return { top: position.y + offsetY, left: position.x };
      }

      const suggestionRect = suggestionRef.current.getBoundingClientRect();

      // 根据showAbove决定显示位置
      let top;
      if (position.showAbove) {
        // 显示在光标上方
        top = position.y - suggestionRect.height - 5;
      } else {
        // 显示在光标下方
        top = position.y + 25;
      }

      let left = position.x;

      // 确保窗口不会超出屏幕右边界
      if (left + suggestionRect.width > window.innerWidth) {
        left = window.innerWidth - suggestionRect.width - 10;
      }

      // 确保窗口不会超出屏幕左边界
      if (left < 10) {
        left = 10;
      }

      // 确保窗口不会超出屏幕上边界
      if (top < 10) {
        top = 10;
      }

      // 确保窗口不会超出屏幕下边界
      if (top + suggestionRect.height > window.innerHeight) {
        top = window.innerHeight - suggestionRect.height - 10;
      }

      return { top, left };
    }, [position]);

    // 获取匹配类型的显示文本
    const getMatchTypeText = useCallback((matchType) => {
      switch (matchType) {
        case "prefix":
          return "前缀匹配";
        default:
          return "";
      }
    }, []);

    // 高亮匹配的文本 - 使用 useMemo 优化
    const highlightMatch = useCallback(
      (command, input) => {
        if (!input || input.trim() === "") return command;

        const inputLower = input.toLowerCase();
        const commandLower = command.toLowerCase();
        const index = commandLower.indexOf(inputLower);

        if (index === -1) return command;

        const before = command.slice(0, index);
        const match = command.slice(index, index + input.length);
        const after = command.slice(index + input.length);

        return (
          <>
            {before}
            <span
              style={{
                backgroundColor: theme.palette.warning.main,
                color: theme.palette.warning.contrastText,
                fontWeight: "bold",
              }}
            >
              {match}
            </span>
            {after}
          </>
        );
      },
      [theme.palette.warning.main, theme.palette.warning.contrastText],
    );

    // 使用 useMemo 优化建议列表渲染
    const suggestionItems = useMemo(() => {
      return suggestions.map((suggestion, index) => (
        <Box
          key={`${suggestion.command}-${index}`}
          sx={{
            padding: "8px 12px",
            cursor: "pointer",
            backgroundColor:
              selectedIndex === index
                ? theme.palette.action.selected
                : "transparent",
            borderLeft:
              selectedIndex === index
                ? `3px solid ${theme.palette.primary.main}`
                : "3px solid transparent",
            transition: "all 0.1s ease",
            "&:hover": {
              backgroundColor: theme.palette.action.hover,
            },
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
          onMouseEnter={() => handleMouseEnter(index)}
          onClick={() => handleMouseClick(suggestion)}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography
              variant="body2"
              sx={{
                fontFamily: "monospace",
                fontSize: "13px",
                color: theme.palette.text.primary,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {highlightMatch(suggestion.command, currentInput)}
            </Typography>
          </Box>

          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              ml: 1,
              flexShrink: 0,
            }}
          >
            {suggestion.count > 1 && (
              <Typography
                variant="caption"
                sx={{
                  color: theme.palette.text.secondary,
                  fontSize: "10px",
                  backgroundColor: theme.palette.action.selected,
                  padding: "2px 4px",
                  borderRadius: "4px",
                  minWidth: "auto",
                }}
              >
                {suggestion.count}
              </Typography>
            )}

            <Typography
              variant="caption"
              sx={{
                color: theme.palette.text.secondary,
                fontSize: "10px",
                fontStyle: "italic",
              }}
            >
              {getMatchTypeText(suggestion.matchType)}
            </Typography>
          </Box>
        </Box>
      ));
    }, [
      suggestions,
      selectedIndex,
      theme,
      currentInput,
      handleMouseEnter,
      handleMouseClick,
      highlightMatch,
      getMatchTypeText,
    ]);

    if (!visible || suggestions.length === 0) {
      return null;
    }

    const suggestionContent = (
      <Paper
        ref={suggestionRef}
        sx={{
          position: "fixed",
          ...calculatePosition(),
          zIndex: 9999,
          maxWidth: 600,
          maxHeight: 300,
          overflow: "auto",
          backgroundColor:
            theme.palette.mode === "dark"
              ? "rgba(30, 30, 30, 0.95)"
              : "rgba(255, 255, 255, 0.95)",
          backdropFilter: "blur(10px)",
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1,
          boxShadow: theme.shadows[8],
          "&::-webkit-scrollbar": {
            width: 6,
          },
          "&::-webkit-scrollbar-track": {
            background: "transparent",
          },
          "&::-webkit-scrollbar-thumb": {
            background: theme.palette.action.disabled,
            borderRadius: 3,
          },
        }}
        onMouseMove={handleMouseMove}
      >
        {suggestionItems}

        {/* 底部提示 */}
        <Box
          sx={{
            padding: "6px 12px",
            backgroundColor: theme.palette.action.hover,
            borderTop: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography
            variant="caption"
            sx={{
              color: theme.palette.text.secondary,
              fontSize: "10px",
            }}
          >
            ↑↓ 选择 • Enter 确认 • Delete 删除 • Esc 关闭
          </Typography>
        </Box>
      </Paper>
    );

    // 使用 Portal 渲染到 body，确保在最顶层
    return createPortal(suggestionContent, document.body);
  },
  areEqual,
);

// 设置显示名称用于调试
CommandSuggestion.displayName = "CommandSuggestion";

export default CommandSuggestion;
