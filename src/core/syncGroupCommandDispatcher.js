import { findGroupByTab } from "./syncInputGroups";

/**
 * 分组命令分发器：统一负责将命令同步到分组内所有终端
 * @param {string} tabId - 当前终端Tab的ID
 * @param {string} command - 需要分发的命令（不带回车）
 */
export function dispatchCommandToGroup(tabId, command) {
  if (!window.terminalAPI || !window.terminalAPI.sendToProcess) {
    console.error("window.terminalAPI.sendToProcess not available");
    return;
  }
  if (!window.processCache) {
    console.error("window.processCache not available");
    return;
  }

  const group = findGroupByTab(tabId);
  let members = [tabId];
  if (group && group.members && group.members.length > 1) {
    members = group.members;
  }

  members.forEach((targetTabId) => {
    const pid = window.processCache[targetTabId];
    if (pid) {
      // 构造完整命令（包含回车）
      const commandToSend = command + "\r";
      
      // 标记这是来自快捷命令窗口的输入，避免在WebTerminal中重复处理
      if (window.webTerminalRefs && window.webTerminalRefs[targetTabId]) {
        // 通过自定义事件通知WebTerminal即将接收外部命令
        const event = new CustomEvent("externalCommandSending", {
          detail: { 
            tabId: targetTabId, 
            command: commandToSend,
            timestamp: Date.now()
          }
        });
        window.dispatchEvent(event);
      }
      
      // 发送命令到进程
      window.terminalAPI.sendToProcess(pid, commandToSend);
    } else {
      console.warn(`No process ID found for tab ${targetTabId}`);
    }
  });
}
