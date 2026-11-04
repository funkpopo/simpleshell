import { aiClassName } from "./lib/aiClassName.js";
import React, { useState, useEffect, useRef, memo, useTransition } from "react";
import { createFloatingDialog } from "../../shared/ui/styledDialogs.jsx";
import { DialogContent, Alert } from "@mui/material";
import AISettings from "./AISettings";
import { createAnchoredTransition } from "../../app/lib/launchAnimation.js";
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DIALOG_BOTTOM_GAP,
  DIALOG_PAPER_RADIUS,
  DIALOG_RIGHT_GAP,
  DIALOG_TOP_GAP,
  MIN_HEIGHT,
  MIN_WIDTH,
} from "./lib/chatWindowLayout.js";
import useChatAutoScroll from "./hooks/useChatAutoScroll.js";
import useChatWindowSize from "./hooks/useChatWindowSize.js";
import useChatApiSettings from "./hooks/useChatApiSettings.js";
import useChatRequest from "./hooks/useChatRequest.js";
import { deleteChatMemory } from "./lib/chatMemory.js";
import useChatMarkdownRenderer from "./hooks/useChatMarkdownRenderer.jsx";
import ChatResizeHandles from "./components/ChatResizeHandles.jsx";
import ChatHeader from "./components/ChatHeader.jsx";
import ChatMessageList, {
  ChatMessageDots,
} from "./components/ChatMessageList.jsx";
import ChatComposer from "./components/ChatComposer.jsx";

import "./CodeHighlight.css";

// 自定义浮动窗口对话框（支持动态宽高和z-index）
// min/max 均按视口钳制，避免小窗口下 min-height 胜出导致 header 伸出视口
const FloatingDialog = createFloatingDialog({
  right: DIALOG_RIGHT_GAP,
  bottom: DIALOG_BOTTOM_GAP,
  width: DEFAULT_WIDTH,
  minWidth: `min(${MIN_WIDTH}px, calc(100vw - ${DIALOG_RIGHT_GAP * 2}px))`,
  maxWidth: `calc(100vw - ${DIALOG_RIGHT_GAP * 2}px)`,
  height: DEFAULT_HEIGHT,
  minHeight: `min(${MIN_HEIGHT}px, calc(100vh - ${DIALOG_BOTTOM_GAP + DIALOG_TOP_GAP}px))`,
  maxHeight: `calc(100vh - ${DIALOG_BOTTOM_GAP + DIALOG_TOP_GAP}px)`,
  borderRadius: DIALOG_PAPER_RADIUS,
});

const AIChatWindow = ({
  windowState,
  sessionKey,
  commandEnabled,
  onClose,
  onMinimize,
  presetInput,
  onInputPresetUsed,
  connectionInfo,
  onExecuteCommand,
  zIndex,
  onFocus,
  anchorEl,
}) => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [showThinking, setShowThinking] = useState(true);
  const [expandedThinking, setExpandedThinking] = useState({});
  const inputRef = useRef(null);
  const dialogRef = useRef(null);

  // 副作用顺序与拆分前一致：滚动 → 视口钳制 → 加载设置 → 聚焦 → 预设输入 → 卸载清理。
  const {
    messagesEndRef,
    messagesContainerRef,
    messageRefsMap,
    scrollToMessage,
  } = useChatAutoScroll({ messages, windowState });

  const {
    windowWidth,
    windowHeight,
    isResizing,
    handleResizeStart,
    applyStoredWindowSize,
  } = useChatWindowSize();

  const {
    settingsOpen,
    setSettingsOpen,
    currentApi,
    apiMenuAnchor,
    availableApis,
    initialSettingsLoaded,
    loadApiSettings,
    handleApiChange,
    handleOpenApiMenu,
    handleCloseApiMenu,
    handleOpenSettingsFromMenu,
  } = useChatApiSettings({ windowState, applyStoredWindowSize });

  useEffect(() => {
    if (windowState !== "visible" || !initialSettingsLoaded) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(timer);
  }, [initialSettingsLoaded, windowState]);

  // 处理预设输入
  useEffect(() => {
    if (presetInput && windowState === "visible") {
      setInput(presetInput);
      onInputPresetUsed();
      if (inputRef.current) {
        inputRef.current.focus();
      }
    }
  }, [presetInput, windowState, onInputPresetUsed]);

  const {
    abortController,
    cancelActiveRequest,
    handleSendMessage,
    handleEditMessage,
    handleRetryMessage,
    handleAbortRequest,
    handleClearChat,
  } = useChatRequest({
    sessionKey,
    connectionInfo,
    currentApi,
    messages,
    setMessages,
    input,
    setInput,
    setError,
    isPending,
    startTransition,
    inputRef,
  });

  // 处理关闭窗口（清空对话内容并删除记忆文件）
  const handleClose = async () => {
    cancelActiveRequest();
    setMessages([]);
    setInput("");
    setError("");
    setExpandedThinking({});
    // 删除记忆文件（失败只记录，不能阻止关闭）
    await deleteChatMemory();
    if (onClose) {
      onClose();
    }
  };

  // 切换思考内容展开状态
  const toggleThinking = (messageId) => {
    setExpandedThinking((prev) => ({
      ...prev,
      [messageId]: !prev[messageId],
    }));
  };

  const { markdownComponents, markdownUrlTransform, renderMessageContent } =
    useChatMarkdownRenderer({
      windowState,
      commandEnabled,
      onExecuteCommand,
      setError,
    });

  return (
    <FloatingDialog
      open={windowState === "visible" && initialSettingsLoaded}
      hideBackdrop
      disableEnforceFocus
      disableAutoFocus
      disableEscapeKeyDown={Boolean(isPending || abortController)}
      customwidth={windowWidth}
      customheight={windowHeight}
      customzindex={zIndex}
      ref={dialogRef}
      onMouseDown={onFocus}
      {...createAnchoredTransition(anchorEl, {
        paper: {
          className: aiClassName("ai-chat-paper"),
        },
      })}
    >
      <ChatResizeHandles
        isResizing={isResizing}
        handleResizeStart={handleResizeStart}
      />
      <ChatHeader
        sessionKey={sessionKey}
        connectionInfo={connectionInfo}
        zIndex={zIndex}
        currentApi={currentApi}
        availableApis={availableApis}
        apiMenuAnchor={apiMenuAnchor}
        onOpenApiMenu={handleOpenApiMenu}
        onCloseApiMenu={handleCloseApiMenu}
        onApiChange={handleApiChange}
        onOpenSettingsFromMenu={handleOpenSettingsFromMenu}
        onClearChat={handleClearChat}
        onMinimize={onMinimize}
        onClose={handleClose}
      />
      <DialogContent className={aiClassName("ai-chat-content")}>
        {/* 消息列表 */}
        <ChatMessageList
          messages={messages}
          currentApi={currentApi}
          onOpenSettings={() => setSettingsOpen(true)}
          messagesContainerRef={messagesContainerRef}
          messagesEndRef={messagesEndRef}
          messageRefsMap={messageRefsMap}
          showThinking={showThinking}
          expandedThinking={expandedThinking}
          onToggleThinking={toggleThinking}
          requestBusy={Boolean(isPending || abortController)}
          renderMessageContent={renderMessageContent}
          markdownComponents={markdownComponents}
          markdownUrlTransform={markdownUrlTransform}
          onEditMessage={handleEditMessage}
          onRetryMessage={handleRetryMessage}
        />

        {/* 点状导航 - 消息快速跳转 */}
        <ChatMessageDots messages={messages} onSelect={scrollToMessage} />

        {/* 错误提示 */}
        {error && (
          <Alert
            severity="error"
            className={aiClassName("ai-chat-error")}
            onClose={() => setError("")}
          >
            {error}
          </Alert>
        )}

        {/* 输入区域 */}
        <ChatComposer
          input={input}
          setInput={setInput}
          inputRef={inputRef}
          isPending={isPending}
          abortController={abortController}
          currentApi={currentApi}
          showThinking={showThinking}
          setShowThinking={setShowThinking}
          onSend={handleSendMessage}
          onAbort={handleAbortRequest}
        />
      </DialogContent>

      {/* AI设置对话框 */}
      <AISettings
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          loadApiSettings();
        }}
      />
    </FloatingDialog>
  );
};

export default memo(AIChatWindow);
