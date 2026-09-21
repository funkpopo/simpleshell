import { getFocusedSessionKey } from "./paneLayout.js";
import { processCache } from "../runtime/terminalSessionStore.js";
import { dispatchCommandToGroup } from "./syncGroupCommandDispatcher.js";

// 读取点击时的状态。AI 确认框携带原会话键，切换会话后不能转发到新目标。
export function sendCommandToActiveSession(state, command, options = {}) {
  const sessionKey = getFocusedSessionKey(state);
  if (!sessionKey) return { success: false, reason: "noTerminal" };
  if (
    options.expectedSessionKey !== undefined &&
    options.expectedSessionKey !== sessionKey
  ) {
    return { success: false, reason: "sessionChanged" };
  }
  if (!processCache[sessionKey]) return { success: false, reason: "noProcess" };
  dispatchCommandToGroup(sessionKey, command, state.syncGroups, options);
  return { success: true, sessionKey };
}
