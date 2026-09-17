/**
 * 渲染进程：观察已解析的 xterm 首行，订阅 Mosh 自带的蓝底白字网络提示。
 * 只提供展示提示，不推断 UDP RTT，不参与 SSH 健康检查或重连。
 * 副作用：注册 xterm 监听、发送 IPC；调用 dispose 解除监听和待处理任务。
 */
export function attachMoshTransportStatus(term, sessionKey, processId) {
  let lastStatus = null;
  let pendingUpdate = null;
  let disposed = false;

  const reportStatus = () => {
    pendingUpdate = null;
    const buffer = term.buffer.active;
    const line = buffer.getLine(buffer.baseY);
    if (!line || term.cols < 6) return;

    // Mosh 只重绘改变的单元格；直接检查解析后的首行可兼容分块和增量更新。
    const cell = line.getCell(0);
    const isNotification =
      cell?.isBgPalette() &&
      cell.getBgColor() === 4 &&
      cell.isFgPalette() &&
      cell.getFgColor() === 7 &&
      line.translateToString(false, 0, 6) === "mosh: ";
    const message = isNotification ? line.translateToString(true, 0, 160) : "";
    const roaming =
      /^mosh: Last (contact|reply)\b/.test(message) ||
      /without (contact|reply)\b/.test(message);
    // 其他通知（退出快捷键帮助等）可能暂时覆盖网络提示，保留原状态。
    if (isNotification && !roaming) return;
    const status = roaming ? "roaming" : "running";
    if (lastStatus === status || !window.terminalAPI?.reportMoshStatus) return;

    lastStatus = status;
    void window.terminalAPI
      .reportMoshStatus(sessionKey, processId, status)
      .then((result) => {
        if (!disposed && !result?.success && lastStatus === status) {
          lastStatus = null;
        }
      })
      .catch(() => {
        if (!disposed && lastStatus === status) lastStatus = null;
      });
  };

  // 大量输出时至多每 100 ms 读取一行；空闲时不轮询，也不把本地回显当心跳。
  const scheduleUpdate = () => {
    if (pendingUpdate === null) {
      pendingUpdate = setTimeout(reportStatus, 100);
    }
  };
  const listener = term.onWriteParsed(scheduleUpdate);
  scheduleUpdate();
  return {
    dispose() {
      disposed = true;
      listener.dispose();
      clearTimeout(pendingUpdate);
    },
  };
}
