const { logToFile } = require("../../core/utils/logger");
const { ipcRenderer } = require("electron");

// 检查是否在渲染进程中
const isRenderer = typeof window !== "undefined" && window.electronAPI;

const loadAISettings = async () => {
  try {
    if (isRenderer) {
      // 在渲染进程中，使用preload API
      return await window.electronAPI.loadAISettings();
    } else {
      // 在主进程中，使用IPC
      return await ipcRenderer.invoke("ai:loadSettings");
    }
  } catch (error) {
    logToFile(`Failed to load AI settings via IPC: ${error.message}`, "ERROR");
    // 返回默认设置
    return {
      configs: [],
      current: {
        apiUrl: "",
        apiKey: "",
        model: "",
        streamEnabled: true,
      },
    };
  }
};

const saveAISettings = async (settings) => {
  try {
    if (isRenderer) {
      // 在渲染进程中，使用preload API
      return await window.electronAPI.saveAISettings(settings);
    } else {
      // 在主进程中，使用IPC
      return await ipcRenderer.invoke("ai:saveSettings", settings);
    }
  } catch (error) {
    logToFile(`Failed to save AI settings via IPC: ${error.message}`, "ERROR");
    return false;
  }
};

module.exports = {
  loadAISettings,
  saveAISettings,
};
