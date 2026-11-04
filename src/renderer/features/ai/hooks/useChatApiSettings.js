import { useCallback, useEffect, useState } from "react";
import { setCustomRiskRules } from "../lib/aiSystemPrompt";

// AI 对话浮窗的 API 配置：可见时加载配置/风险规则/窗口尺寸，切换当前模型，
// 以及模型菜单与设置对话框的开关状态。
export default function useChatApiSettings({
  windowState,
  applyStoredWindowSize,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [currentApi, setCurrentApi] = useState(null);
  const [apiMenuAnchor, setApiMenuAnchor] = useState(null);
  const [availableApis, setAvailableApis] = useState([]);
  // 首次展开前恢复配置和窗口尺寸，避免先显示默认布局再跳变。
  const [initialSettingsLoaded, setInitialSettingsLoaded] = useState(false);

  // 加载API配置
  const loadApiSettings = async () => {
    try {
      if (window.terminalAPI?.loadAISettings) {
        const settings = await window.terminalAPI.loadAISettings();
        setAvailableApis(settings.configs || []);
        if (settings.current) {
          // 从configs中获取最新的配置
          const latestConfig =
            settings.configs?.find((c) => c.id === settings.current.id) ||
            settings.current;
          setCurrentApi(latestConfig);
        } else if (settings.configs && settings.configs.length > 0) {
          setCurrentApi(settings.configs[0]);
        }
        // 加载自定义风险规则
        if (settings.customRiskRules) {
          setCustomRiskRules(settings.customRiskRules);
        }

        applyStoredWindowSize(settings.windowSize);
      }
    } catch (err) {
      console.error("Failed to load API settings:", err);
    } finally {
      setInitialSettingsLoaded(true);
    }
  };

  // 初始化加载设置
  useEffect(() => {
    if (windowState === "visible") {
      loadApiSettings();
      return;
    }
    setApiMenuAnchor(null);
    setSettingsOpen(false);
  }, [windowState]);

  // 切换 API / 模型配置
  const handleApiChange = useCallback(async (api) => {
    if (!api) {
      return;
    }

    setCurrentApi(api);
    setApiMenuAnchor(null);

    try {
      if (window.terminalAPI?.setCurrentApiConfig) {
        await window.terminalAPI.setCurrentApiConfig(api.id);
      }
    } catch (err) {
      console.error("Failed to set current API config:", err);
    }
  }, []);

  const handleOpenApiMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setApiMenuAnchor(event.currentTarget);
  }, []);

  const handleCloseApiMenu = useCallback(() => {
    setApiMenuAnchor(null);
  }, []);

  const handleOpenSettingsFromMenu = useCallback(() => {
    setApiMenuAnchor(null);
    setSettingsOpen(true);
  }, []);

  return {
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
  };
}
