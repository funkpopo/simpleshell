import { findGroupByTab } from "./syncInputGroups";

/**
 * 分组命令分发器：统一负责将命令同步到分组内所有终端
 * @param {string} tabId - 当前终端Tab的ID
 * @param {string} command - 需要分发的命令（不带回车）
 * @param {Array} syncGroups - 当前分组状态（来自 AppContext，由调用方传入）
 * @param {{ execute?: boolean }} options - execute 为 false 时只输入命令，不发送回车
 */
export function dispatchCommandToGroup(tabId, command, syncGroups, options = {}) {
  if (!window.terminalAPI || !window.terminalAPI.sendToProcess) {
    console.error("window.terminalAPI.sendToProcess not available");
    return;
  }
  if (!window.processCache) {
    console.error("window.processCache not available");
    return;
  }

  const group = findGroupByTab(syncGroups, tabId);
  let members = [tabId];
  if (group && group.members && group.members.length > 1) {
    members = group.members;
  }

  members.forEach((targetTabId) => {
    const pid = window.processCache[targetTabId];
    if (pid) {
      const shouldExecute = options.execute !== false;
      const commandToSend = shouldExecute ? command + "\r" : command;

      // Explicit external-input channel notification. The command is sent to
      // the process below; this event only lets the target terminal mark the
      // channel payload so its onData handler can recognize (and skip) a
      // replay without ever swallowing user keystrokes.
      if (window.webTerminalRefs && window.webTerminalRefs[targetTabId]) {
        const event = new CustomEvent("externalCommandSending", {
          detail: {
            tabId: targetTabId,
            command: commandToSend,
          },
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
