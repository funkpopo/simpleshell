import React, { useEffect, useState } from "react";
import { AIChatWindowWithSuspense } from "../../app/LazyComponents.jsx";
import { getSessionConnectionInfo } from "../terminal/model/paneLayout.js";

// 只挂载访问过的 AI 对话。窗格切换保留各自草稿、历史与流式请求；
// 关闭终端或整个 AI 工作区时才卸载并清理对应请求。
export default function AIChatWorkspace({
  sessions,
  activeSessionKey,
  windowState,
  presetInput,
  onExecuteCommand,
  chatComponent: Chat = AIChatWindowWithSuspense,
  ...props
}) {
  const activeKey = activeSessionKey ?? "welcome";
  const [visited, setVisited] = useState([activeKey]);
  const liveKeys = new Set([
    "welcome",
    ...sessions.map((session) => session.sessionKey),
  ]);
  const keys = [...new Set([...visited, activeKey])].filter((key) =>
    liveKeys.has(key),
  );
  useEffect(() => {
    setVisited((previous) => {
      const next = [...new Set([...previous, activeKey])].filter((key) =>
        liveKeys.has(key),
      );
      return previous.length === next.length &&
        previous.every((key, index) => key === next[index])
        ? previous
        : next;
    });
  }, [activeKey, sessions]);
  return keys.map((key) => {
    const session = sessions.find((item) => item.sessionKey === key);
    const active = key === activeKey;
    return (
      <Chat
        key={key}
        {...props}
        sessionKey={key}
        windowState={active ? windowState : "minimized"}
        connectionInfo={getSessionConnectionInfo(session)}
        commandEnabled={active && Boolean(session?.processId)}
        presetInput={active ? presetInput : ""}
        onExecuteCommand={(command) =>
          onExecuteCommand(command, { expectedSessionKey: key })
        }
      />
    );
  });
}
