import { useCallback, useEffect, useRef, useState } from "react";
import { actions } from "../state/appReducer.js";

/**
 * AI 面板（全局聊天窗）状态与 API 可达性探测。
 * 从 AppShell 渐进拆分出的独立模块（progressive split），行为不变：
 * - aiPanelOpen：派生自 aiChatStatus
 * - aiApiReachable：仅面板打开时每 30s 探测一次（false 包含未配置/不可达）
 * - 处理函数：打开/最小化/关闭全局 AI 聊天窗、发送文本到 AI 助手
 */
export default function useAIPanel({
  aiChatStatus,
  dispatch,
  setLastActiveFloatWindow,
}) {
  /** AI 当前 API 是否可达（false 包含未配置/不可达） */
  const [aiApiReachable, setAiApiReachable] = useState(false);
  const aiApiProbeTokenRef = useRef(0);
  const aiPanelOpen =
    aiChatStatus === "minimized" || aiChatStatus === "visible";

  const probeAiApiStatus = useCallback(async () => {
    if (
      !window.terminalAPI?.fetchModels ||
      !window.terminalAPI?.loadAISettings
    ) {
      return;
    }
    const probeToken = ++aiApiProbeTokenRef.current;
    try {
      const settings = await window.terminalAPI.loadAISettings();
      const current = settings?.current;
      if (
        !current?.apiUrl?.trim() ||
        !current?.model?.trim() ||
        !current?.hasApiKey
      ) {
        if (probeToken !== aiApiProbeTokenRef.current) return;
        setAiApiReachable(false);
        return;
      }
      const result = await window.terminalAPI.fetchModels({
        apiConfigId: current.id || undefined,
        url: current.apiUrl,
        provider: current.provider || "openai",
      });
      if (probeToken !== aiApiProbeTokenRef.current) return;
      if (result && Array.isArray(result.models)) {
        setAiApiReachable(true);
      } else {
        setAiApiReachable(false);
      }
    } catch {
      if (probeToken !== aiApiProbeTokenRef.current) return;
      setAiApiReachable(false);
    }
  }, []);

  // 全局AI聊天窗口处理函数
  const handleToggleGlobalAiChatWindow = useCallback(() => {
    if (aiChatStatus === "visible") {
      dispatch(actions.setAiChatStatus("minimized"));
    } else {
      dispatch(actions.setAiChatStatus("visible"));
      setLastActiveFloatWindow("ai");
      probeAiApiStatus();
    }
  }, [aiChatStatus, dispatch, setLastActiveFloatWindow, probeAiApiStatus]);

  // 最小化AI聊天窗口（保持对话内容）
  const handleMinimizeGlobalAiChatWindow = useCallback(() => {
    dispatch(actions.setAiChatStatus("minimized"));
  }, [dispatch]);

  // 关闭AI聊天窗口（清空对话内容）
  const handleCloseGlobalAiChatWindow = useCallback(() => {
    dispatch(actions.setAiChatStatus("closed"));
  }, [dispatch]);

  // 发送文本到AI助手
  const handleSendToAI = useCallback(
    (text) => {
      dispatch(actions.setAiInputPreset(text));
      dispatch(actions.setAiChatStatus("visible"));
    },
    [dispatch],
  );

  // 面板关闭时使探测结果失效
  useEffect(() => {
    if (aiChatStatus === "closed") {
      aiApiProbeTokenRef.current += 1;
      setAiApiReachable(false);
    }
  }, [aiChatStatus]);

  // 仅面板打开时周期性探测（30s + 页面重新可见时立即探测）
  useEffect(() => {
    if (
      !aiPanelOpen ||
      !window.terminalAPI?.fetchModels ||
      !window.terminalAPI?.loadAISettings
    ) {
      return undefined;
    }
    const safeProbe = async () => {
      await probeAiApiStatus();
    };
    safeProbe();
    const intervalId = window.setInterval(safeProbe, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") safeProbe();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [aiChatStatus, probeAiApiStatus]);

  return {
    aiPanelOpen,
    aiApiReachable,
    handleToggleGlobalAiChatWindow,
    handleMinimizeGlobalAiChatWindow,
    handleCloseGlobalAiChatWindow,
    handleSendToAI,
  };
}
