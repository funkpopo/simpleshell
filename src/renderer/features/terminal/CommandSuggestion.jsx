import React, {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import {
  Paper,
  List,
  ListItemButton,
  ListItemText,
  Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import {
  resolveCommandSuggestionKeyAction,
  shouldIgnoreCommandSuggestionKeyEvent,
} from "./model/commandSuggestionState.js";
import {
  getSuggestionWindowHeight,
  resolveCommandSuggestionWindowPosition,
  SUGGESTION_BOTTOM_BAR_HEIGHT,
  SUGGESTION_FRAME_BORDER,
  SUGGESTION_ITEM_HEIGHT,
} from "./model/commandSuggestionPosition.js";
import { FIRA_CODE_FONT_FAMILY } from "../../shared/lib/fonts.js";
import { Z_INDEX } from "../../shared/constants/zIndex.js";

// 与列表行实际渲染的字号一致，否则测得的宽度偏大
const COMMAND_FONT = `12px ${FIRA_CODE_FONT_FAMILY}`;
const MIN_WIDTH = 240;
const MAX_WIDTH = 520;
// 行左右内边距 + 选中指示条 + 滚动条 + 边框的余量
const ROW_HORIZONTAL_CHROME = 40;

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

const isNodeWithin = (container, node) => {
  if (!container || !node) {
    return false;
  }
  try {
    return container.contains(node);
  } catch {
    return false;
  }
};

const CommandSuggestion = ({
  suggestions = [],
  visible = false,
  position = null,
  onSelectSuggestion,
  onClose,
  terminalElement,
  currentInput = "",
}) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const selectedIndexRef = useRef(-1);
  // 已删除但列表尚未刷新的命令，先在本地隐藏，删除操作立即可见
  const [removedCommands, setRemovedCommands] = useState(() => new Set());
  const listRef = useRef(null);
  const componentRef = useRef(null);
  // 本次显示期间的锚点与朝向：输入时保持稳定，避免弹窗随每个字符横向漂移、上下翻转
  const placementRef = useRef(null);
  const showAboveRef = useRef(false);
  const restoreIndexRef = useRef(null);

  const items = useMemo(
    () =>
      removedCommands.size === 0
        ? suggestions
        : suggestions.filter((item) => !removedCommands.has(item.command)),
    [removedCommands, suggestions],
  );
  const isOpen = visible && items.length > 0;

  const selectIndex = useCallback((index) => {
    selectedIndexRef.current = index;
    setSelectedIndex(index);
  }, []);

  // 新的建议列表到达时清除选中（删除后恢复到原位置）
  useEffect(() => {
    setRemovedCommands((previous) =>
      previous.size === 0 ? previous : new Set(),
    );
    const restoreIndex = restoreIndexRef.current;
    restoreIndexRef.current = null;
    if (!visible) {
      placementRef.current = null;
      selectIndex(-1);
      return;
    }
    selectIndex(
      restoreIndex !== null && suggestions.length > 0
        ? Math.min(restoreIndex, suggestions.length - 1)
        : -1,
    );
  }, [visible, suggestions, selectIndex]);

  const windowDimensions = useMemo(() => {
    if (items.length === 0) {
      return null;
    }

    const longestCommand = items.reduce(
      (longest, current) =>
        current?.command && current.command.length > longest.length
          ? current.command
          : longest,
      "",
    );

    let textWidth = 0;
    try {
      textWidth = measureCommandText(longestCommand, COMMAND_FONT);
    } catch {
      textWidth = 0;
    }
    if (!Number.isFinite(textWidth) || textWidth === 0) {
      textWidth = Math.max(longestCommand.length, 10) * 8;
    }

    return {
      width: Math.max(
        MIN_WIDTH,
        Math.min(MAX_WIDTH, textWidth + ROW_HORIZONTAL_CHROME),
      ),
      height: getSuggestionWindowHeight(items.length),
    };
  }, [items]);

  let windowPosition = null;
  let anchoredPosition = position;
  if (isOpen && windowDimensions && position) {
    const placement = placementRef.current;
    // 同一输入行内左边缘固定在首次出现的位置；退格越过该位置时跟随光标左移
    if (placement && Math.abs(placement.anchorY - position.y) < 1) {
      anchoredPosition = {
        ...position,
        anchorX: Math.min(placement.anchorX, position.x),
      };
    }
    windowPosition = resolveCommandSuggestionWindowPosition({
      position: anchoredPosition,
      windowDimensions,
      terminalRect: terminalElement?.getBoundingClientRect?.() || null,
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      preferAbove: placement ? placement.showAbove : null,
    });
  }

  // 只有弹窗真正渲染出来时才接管键盘/鼠标，避免看不见的弹窗吞掉按键
  const isRendered = Boolean(windowPosition);

  const handleSuggestionSelect = useCallback(
    (suggestion) => {
      onSelectSuggestion?.(suggestion);
    },
    [onSelectSuggestion],
  );

  const handleDeleteSuggestion = useCallback(
    async (suggestion, index) => {
      if (!window.terminalAPI?.deleteCommandHistory) {
        return;
      }
      restoreIndexRef.current = index;
      setRemovedCommands((previous) => {
        const next = new Set(previous);
        next.add(suggestion.command);
        return next;
      });
      selectIndex(index < items.length - 1 ? index : index - 1);
      try {
        await window.terminalAPI.deleteCommandHistory(suggestion.command);
      } catch {
        // 删除失败时下面的刷新会把该条目带回列表
      }
      if (currentInput && currentInput.trim()) {
        window.dispatchEvent(
          new CustomEvent("refreshCommandSuggestions", {
            detail: { input: currentInput },
          }),
        );
      }
    },
    [currentInput, items.length, selectIndex],
  );

  // 捕获阶段监听键盘，仅处理发往本终端的按键：焦点在搜索框、AI 输入框
  // 或其他分屏时不劫持方向键
  useEffect(() => {
    if (!isRendered) return;

    const keyHandler = (e) => {
      if (shouldIgnoreCommandSuggestionKeyEvent(e)) {
        return;
      }
      if (
        !isNodeWithin(terminalElement, e.target) &&
        !isNodeWithin(componentRef.current, e.target)
      ) {
        return;
      }

      const action = resolveCommandSuggestionKeyAction({
        key: e.key,
        selectedIndex: selectedIndexRef.current,
        count: items.length,
        showAbove: showAboveRef.current,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
      });

      if (action.type === "pass") {
        return;
      }
      if (action.type === "dismiss") {
        // 移动光标意味着在行内编辑，关闭弹窗并让按键照常到达 shell
        onClose?.({ reason: "cursor-move", suppressUntilEnter: false });
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      switch (action.type) {
        case "move":
          selectIndex(action.index);
          break;
        case "accept":
          handleSuggestionSelect(items[action.index]);
          break;
        case "remove":
          handleDeleteSuggestion(items[action.index], action.index);
          break;
        case "close":
          onClose?.({ reason: "escape", suppressUntilEnter: true });
          break;
      }
    };

    document.addEventListener("keydown", keyHandler, {
      capture: true,
      passive: false,
    });

    return () => {
      document.removeEventListener("keydown", keyHandler, { capture: true });
    };
  }, [
    isRendered,
    items,
    terminalElement,
    handleSuggestionSelect,
    handleDeleteSuggestion,
    onClose,
    selectIndex,
  ]);

  // 点击弹窗外部，或焦点移到终端之外（快捷键打开搜索框等）时关闭
  useEffect(() => {
    if (!isRendered) return;

    const isOutside = (target) =>
      !isNodeWithin(componentRef.current, target) &&
      !isNodeWithin(terminalElement, target);

    const handleMouseDownOutside = (e) => {
      if (!isNodeWithin(componentRef.current, e.target)) {
        onClose?.({ reason: "outside", suppressUntilEnter: false });
      }
    };
    const handleFocusOutside = (e) => {
      if (isOutside(e.target)) {
        onClose?.({ reason: "blur", suppressUntilEnter: false });
      }
    };

    document.addEventListener("mousedown", handleMouseDownOutside);
    document.addEventListener("focusin", handleFocusOutside);
    return () => {
      document.removeEventListener("mousedown", handleMouseDownOutside);
      document.removeEventListener("focusin", handleFocusOutside);
    };
  }, [isRendered, onClose, terminalElement]);

  // 滚动选中项到可见区域
  useEffect(() => {
    if (isRendered && selectedIndex >= 0 && listRef.current) {
      const selectedItem = listRef.current.querySelector(
        `[data-suggestion-index="${selectedIndex}"]`,
      );
      selectedItem?.scrollIntoView({
        block: "nearest",
        behavior: "auto",
      });
    }
  }, [selectedIndex, isRendered]);

  useLayoutEffect(() => {
    if (!windowPosition || !anchoredPosition) {
      return;
    }
    placementRef.current = {
      anchorX: anchoredPosition.anchorX ?? anchoredPosition.x,
      anchorY: anchoredPosition.y,
      showAbove: windowPosition.showAbove,
    };
    showAboveRef.current = windowPosition.showAbove;
  });

  if (!windowPosition) {
    return null;
  }

  const { showAbove } = windowPosition;
  const innerHeight = windowPosition.height - SUGGESTION_FRAME_BORDER;
  // 空间不足时优先保证建议条目可见，收起提示栏
  const showFooter =
    innerHeight >= SUGGESTION_ITEM_HEIGHT * 2 + SUGGESTION_BOTTOM_BAR_HEIGHT;
  const contentHeight = items.length * SUGGESTION_ITEM_HEIGHT;
  const listMaxHeight = Math.max(
    SUGGESTION_ITEM_HEIGHT,
    innerHeight - (showFooter ? SUGGESTION_BOTTOM_BAR_HEIGHT : 0),
  );
  const listHeight = Math.min(contentHeight, listMaxHeight);
  const listScrollable = contentHeight > listHeight;
  const hasSelection = selectedIndex >= 0 && selectedIndex < items.length;
  const matchText = String(currentInput || "").trim();

  const highlightMatch = (text) => {
    if (!matchText || !text) return text;

    const index = text.toLowerCase().indexOf(matchText.toLowerCase());
    if (index === -1) return text;

    return (
      <>
        {text.substring(0, index)}
        <span
          style={{
            color: theme.palette.primary.main,
            fontWeight: 600,
          }}
        >
          {text.substring(index, index + matchText.length)}
        </span>
        {text.substring(index + matchText.length)}
      </>
    );
  };

  // 提示栏只展示当前可用的操作：未选中时提示如何进入列表，选中后提示 Enter/Del
  const hints = hasSelection
    ? [
        ["Enter", t("webTerminal.suggestion.accept")],
        ["Del", t("webTerminal.suggestion.remove")],
        ["Esc", t("webTerminal.suggestion.close")],
      ]
    : [
        [showAbove ? "↑" : "↓", t("webTerminal.suggestion.navigate")],
        ["Esc", t("webTerminal.suggestion.close")],
      ];

  return (
    <Paper
      ref={componentRef}
      elevation={8}
      // 阻止 mousedown 的默认行为，点击建议时焦点留在终端，无需再点回去
      onMouseDown={(e) => e.preventDefault()}
      sx={{
        position: "fixed",
        left: windowPosition.left,
        top: windowPosition.top,
        width: windowPosition.width,
        maxHeight: windowPosition.height,
        boxSizing: "border-box",
        display: "flex",
        // 弹窗在光标上方时整体镜像：最佳匹配贴近光标，提示栏位于远端
        flexDirection: showAbove ? "column-reverse" : "column",
        // 高于浮动窗口（zIndex.floatWindow），保证输入建议始终可见；
        // 低于模态/锁屏/主题切换遮罩（见 shared/constants/zIndex.js）
        zIndex: Z_INDEX.commandSuggestion,
        overflow: "hidden",
        borderRadius: 1,
        border: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <List
        ref={listRef}
        className="app-scrollbar app-scrollbar-compact"
        dense
        role="listbox"
        aria-label={t("webTerminal.suggestion.label")}
        sx={{
          height: listHeight,
          maxHeight: listHeight,
          flexShrink: 0,
          overflowY: listScrollable ? "auto" : "hidden",
          overflowX: "hidden",
          padding: 0,
          display: "flex",
          flexDirection: showAbove ? "column-reverse" : "column",
        }}
      >
        {items.map((suggestion, index) => {
          const selected = selectedIndex === index;
          return (
            <ListItemButton
              key={`${suggestion.command}-${index}`}
              data-suggestion-index={index}
              role="option"
              aria-selected={selected}
              selected={selected}
              onClick={() => handleSuggestionSelect(suggestion)}
              sx={{
                padding: "0 8px",
                cursor: "default",
                flexShrink: 0,
                height: SUGGESTION_ITEM_HEIGHT,
                minHeight: SUGGESTION_ITEM_HEIGHT,
                display: "flex",
                alignItems: "center",
                borderLeft: selected
                  ? `2px solid ${theme.palette.primary.main}`
                  : "2px solid transparent",
                transition:
                  "background-color 0.12s ease, border-color 0.12s ease",
                "@media (prefers-reduced-motion: reduce)": {
                  transition: "none",
                },
              }}
            >
              <ListItemText
                primary={
                  <Typography
                    variant="body2"
                    title={suggestion.command}
                    sx={{
                      fontFamily: FIRA_CODE_FONT_FAMILY,
                      fontSize: "12px",
                      color: theme.palette.text.primary,
                      lineHeight: 1.2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {highlightMatch(suggestion.command)}
                  </Typography>
                }
                sx={{
                  margin: 0,
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                }}
              />
            </ListItemButton>
          );
        })}
      </List>

      {showFooter ? (
        <div
          aria-hidden="true"
          style={{
            boxSizing: "border-box",
            height: SUGGESTION_BOTTOM_BAR_HEIGHT,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
            padding: "0 8px",
            backgroundColor: theme.palette.background.default,
            [showAbove ? "borderBottom" : "borderTop"]:
              `1px solid ${theme.palette.divider}`,
            fontSize: 11,
            lineHeight: 1,
            color: theme.palette.text.secondary,
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {hints.map(([key, label]) => (
            <span key={key}>
              <span
                style={{
                  fontFamily: FIRA_CODE_FONT_FAMILY,
                  color: theme.palette.text.primary,
                  marginRight: 4,
                }}
              >
                {key}
              </span>
              {label}
            </span>
          ))}
        </div>
      ) : null}
    </Paper>
  );
};

export default CommandSuggestion;
