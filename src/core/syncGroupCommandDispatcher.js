import { findGroupByTab } from "./syncInputGroups";
import { processCache } from "../modules/terminal/controller/terminalSessionStore.js";

/**
 * 分组命令分发器：统一负责将命令同步到分组内所有终端。
 * 类型策略（与逐键同步、粘贴/清除同步路径一致）：不区分终端类型，
 * 仅要求目标成员存在活跃进程；同步范围由分组内成员构成决定。
 *
 * 投递模型（P2）：命令不再由分发器直写 PTY，而是通过 syncTerminalCommand
 * 事件交给目标终端自己的输入管道（useTerminalIO.enqueueInputToProcess）。
 * 这样成员离线 / 重连中时命令自动进入成员端离线缓冲（与源终端行为一致），
 * 重连后随缓冲一起发送；无活跃会话的成员则通过 syncGroupNotice 提示用户。
 *
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

  const group = findGroupByTab(syncGroups, tabId);
  let members = [tabId];
  if (group && group.members && group.members.length > 1) {
    members = group.members;
  }

  const execute = options.execute !== false;
  const unreachableTabIds = [];

  members.forEach((targetTabId) => {
    if (!processCache[targetTabId]) {
      unreachableTabIds.push(targetTabId);
      return;
    }

    // 交给目标终端自己的管道投递（离线缓冲 / 分块 / UI 状态同步均在成员端完成）
    window.dispatchEvent(
      new CustomEvent("syncTerminalCommand", {
        detail: {
          sourceTabId: tabId,
          targetTabId,
          groupId: group?.groupId ?? null,
          command,
          execute,
        },
      }),
    );
  });

  if (unreachableTabIds.length > 0) {
    console.warn(
      `No process ID found for tabs: ${unreachableTabIds.join(", ")}`,
    );
    window.dispatchEvent(
      new CustomEvent("syncGroupNotice", {
        detail: {
          kind: "member-unreachable",
          groupId: group?.groupId ?? null,
          tabIds: unreachableTabIds,
        },
      }),
    );
  }
}
