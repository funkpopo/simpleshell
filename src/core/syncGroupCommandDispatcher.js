import { findGroupByTab } from './syncInputGroups';

/**
 * 分组命令分发器：统一负责将命令同步到分组内所有终端
 * @param {string} tabId - 当前终端Tab的ID
 * @param {string} command - 需要分发的命令（不带回车）
 */
export function dispatchCommandToGroup(tabId, command) {
  console.log('dispatchCommandToGroup called:', { tabId, command });
  
  if (!window.terminalAPI || !window.terminalAPI.sendToProcess) {
    console.error('window.terminalAPI.sendToProcess not available');
    return;
  }
  if (!window.processCache) {
    console.error('window.processCache not available');
    return;
  }

  const group = findGroupByTab(tabId);
  let members = [tabId];
  if (group && group.members && group.members.length > 1) {
    members = group.members;
    console.log('Found group members:', members);
  } else {
    console.log('No group found, using single tab:', tabId);
  }

  console.log('Available process IDs in cache:', Object.keys(window.processCache));
  
  members.forEach(targetTabId => {
    const pid = window.processCache[targetTabId];
    console.log(`Sending command to tab ${targetTabId}, pid: ${pid}`);
    if (pid) {
      window.terminalAPI.sendToProcess(pid, command + '\r');
      console.log(`Command sent successfully to pid ${pid}`);
    } else {
      console.warn(`No process ID found for tab ${targetTabId}`);
    }
  });
} 