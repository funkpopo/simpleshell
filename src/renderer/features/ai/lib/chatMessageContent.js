// AI 对话消息内容的纯解析函数：思考块拆分与命令块分段。

// 处理思考内容的处理
export const processThinkContent = (text) => {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/g;
  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = thinkRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }
    parts.push({
      type: "think",
      content: match[1].trim(),
    });
    lastIndex = match.index + match[0].length;
  }

  const remainder = text.slice(lastIndex);
  const openThinkMatch = remainder.match(/<think>/i);
  if (openThinkMatch) {
    const openThinkIndex = openThinkMatch.index;
    if (openThinkIndex > 0) {
      parts.push({
        type: "text",
        content: remainder.slice(0, openThinkIndex),
      });
    }
    parts.push({
      type: "think",
      content: remainder
        .slice(openThinkIndex + openThinkMatch[0].length)
        .trim(),
      open: true,
    });
  } else if (remainder) {
    parts.push({
      type: "text",
      content: remainder,
    });
  }

  return parts;
};

// 将助手消息拆为思考片段与正文；关闭思考显示时直接剥离 <think> 块。
export const splitAssistantContent = (content, showThinking) => {
  const assistantParts = showThinking ? processThinkContent(content) : null;
  const thinkParts = assistantParts
    ? assistantParts.filter((part) => part.type === "think")
    : [];
  const textContent = showThinking
    ? assistantParts
        .filter((part) => part.type === "text")
        .map((part) => part.content)
        .join("")
    : content
        .replace(/<think>[\s\S]*?<\/think>/g, "")
        .replace(/<think>[\s\S]*$/i, "");
  return { thinkParts, textContent };
};

// 按解析出的命令块把内容切分为文本段与命令段
export const splitContentByCommands = (content, commands) => {
  const parts = [];
  let lastIndex = 0;

  commands.forEach((cmd, idx) => {
    // 添加命令之前的文本
    if (cmd.index > lastIndex) {
      const textBefore = content.slice(lastIndex, cmd.index);
      if (textBefore.trim()) {
        parts.push({
          type: "text",
          content: textBefore,
          key: `text-${idx}`,
        });
      }
    }

    // 添加命令块
    parts.push({
      type: "command",
      command: cmd.command,
      risk: cmd.risk,
      key: `cmd-${idx}`,
    });

    lastIndex = cmd.index + cmd.length;
  });

  // 添加最后的文本
  if (lastIndex < content.length) {
    const textAfter = content.slice(lastIndex);
    if (textAfter.trim()) {
      parts.push({
        type: "text",
        content: textAfter,
        key: "text-last",
      });
    }
  }

  return parts;
};
