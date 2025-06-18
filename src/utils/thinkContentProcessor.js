export function parseThinkContent(content) {
  if (!content || typeof content !== "string") {
    return { thinkContent: "", normalContent: content || "" };
  }

  // 使用更严格的正则表达式匹配<think></think>标签
  const thinkRegex = /<think>\s*([\s\S]*?)\s*<\/think>/gi;
  const matches = [];
  let match;

  // 提取所有思考内容
  while ((match = thinkRegex.exec(content)) !== null) {
    const thinkContent = match[1].trim();
    if (thinkContent) {
      // 只添加非空的思考内容
      matches.push({
        fullMatch: match[0],
        thinkContent: thinkContent,
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      });
    }
  }

  if (matches.length === 0) {
    return { thinkContent: "", normalContent: content };
  }

  // 合并所有思考内容
  const thinkContent = matches.map((m) => m.thinkContent).join("\n\n");

  // 移除思考标签，保留正常内容
  let normalContent = content;
  matches.reverse().forEach((match) => {
    normalContent =
      normalContent.substring(0, match.startIndex) +
      normalContent.substring(match.endIndex);
  });

  const result = {
    thinkContent: thinkContent.trim(),
    normalContent: normalContent.trim(),
  };
  return result;
}

export class StreamThinkProcessor {
  constructor() {
    this.buffer = "";
    this.isInThinkTag = false;
    this.currentThinkContent = "";
    this.normalContent = "";
    this.pendingThinkContent = "";
    // 保存原始流式内容，用于最终的二次处理
    this.rawStreamContent = "";
  }

  processChunk(chunk) {
    if (!chunk) {
      return {
        hasUpdate: false,
        thinkContent: "",
        normalContent: "",
        isComplete: true,
      };
    }

    // 保存原始流式内容
    this.rawStreamContent += chunk;
    this.buffer += chunk;
    let hasUpdate = false;
    let newThinkContent = "";
    let newNormalContent = "";

    // 检查是否有完整的<think>标签
    const openTagRegex = /<think>/gi;
    const closeTagRegex = /<\/think>/gi;

    let openMatch;
    let closeMatch;

    // 处理开始标签
    while ((openMatch = openTagRegex.exec(this.buffer)) !== null) {
      if (!this.isInThinkTag) {
        // 进入思考模式
        this.isInThinkTag = true;

        // 将开始标签之前的内容作为正常内容
        const beforeTag = this.buffer.substring(0, openMatch.index);
        if (beforeTag) {
          newNormalContent += beforeTag;
          hasUpdate = true;
        }

        // 更新缓冲区，移除已处理的内容
        this.buffer = this.buffer.substring(
          openMatch.index + openMatch[0].length,
        );
        openTagRegex.lastIndex = 0; // 重置正则表达式索引
        break;
      }
    }

    // 处理结束标签
    if (this.isInThinkTag) {
      closeTagRegex.lastIndex = 0;
      closeMatch = closeTagRegex.exec(this.buffer);

      if (closeMatch) {
        // 找到结束标签，提取思考内容
        const thinkText = this.buffer.substring(0, closeMatch.index);
        newThinkContent = (this.pendingThinkContent + thinkText).trim();
        this.pendingThinkContent = "";

        // 退出思考模式
        this.isInThinkTag = false;
        hasUpdate = true;

        // 更新缓冲区，移除已处理的内容
        this.buffer = this.buffer.substring(
          closeMatch.index + closeMatch[0].length,
        );
      } else {
        // 还没有找到结束标签，将当前内容暂存
        this.pendingThinkContent += this.buffer;
        this.buffer = "";
      }
    } else {
      // 不在思考模式中，所有内容都是正常内容
      if (this.buffer) {
        newNormalContent += this.buffer;
        this.buffer = "";
        hasUpdate = true;
      }
    }

    // 更新累积内容
    if (newThinkContent) {
      this.currentThinkContent +=
        (this.currentThinkContent ? "\n\n" : "") + newThinkContent;
    }
    if (newNormalContent) {
      this.normalContent += newNormalContent;
    }

    const result = {
      hasUpdate,
      thinkContent: this.currentThinkContent,
      normalContent: this.normalContent,
      isComplete: !this.isInThinkTag && this.buffer === "",
    };
    return result;
  }

  finalize() {
    // 如果还在思考标签中，将剩余内容作为思考内容
    if (this.isInThinkTag && this.buffer) {
      this.currentThinkContent +=
        (this.currentThinkContent ? "\n\n" : "") +
        this.pendingThinkContent +
        this.buffer;
    } else if (this.buffer) {
      // 否则作为正常内容
      this.normalContent += this.buffer;
    }

    console.log("[StreamThinkProcessor] finalize - 开始最终处理:", {
      rawStreamContentLength: this.rawStreamContent.length,
      currentThinkContentLength: this.currentThinkContent.length,
      normalContentLength: this.normalContent.length,
      isInThinkTag: this.isInThinkTag,
      bufferLength: this.buffer.length,
    });

    // 关键改进：直接对原始流式内容进行完整的二次处理
    const rawProcessingResult = parseThinkContent(this.rawStreamContent);

    console.log("[StreamThinkProcessor] 原始内容二次处理结果:", {
      rawThinkContentLength: rawProcessingResult.thinkContent.length,
      rawNormalContentLength: rawProcessingResult.normalContent.length,
    });

    // 如果原始内容处理得到了更好的结果，使用它
    if (
      rawProcessingResult.thinkContent.length >
        this.currentThinkContent.length ||
      (rawProcessingResult.thinkContent.length > 0 &&
        this.currentThinkContent.length === 0)
    ) {
      console.log("[StreamThinkProcessor] 使用原始内容处理结果");
      return {
        thinkContent: rawProcessingResult.thinkContent,
        normalContent: rawProcessingResult.normalContent,
      };
    }

    // 否则使用流式处理的结果
    return {
      thinkContent: this.currentThinkContent.trim(),
      normalContent: this.normalContent.trim(),
    };
  }

  reconstructFullContent() {
    // 如果有思考内容，需要重新包装成完整的标签格式
    let fullContent = "";

    if (this.currentThinkContent.trim()) {
      fullContent += `<think>${this.currentThinkContent.trim()}</think>\n\n`;
    }

    if (this.normalContent.trim()) {
      fullContent += this.normalContent.trim();
    }

    console.log("[StreamThinkProcessor] 重新构建内容:", {
      hasThinkContent: !!this.currentThinkContent.trim(),
      hasNormalContent: !!this.normalContent.trim(),
      fullContentLength: fullContent.length,
      fullContentPreview:
        fullContent.substring(0, 100) + (fullContent.length > 100 ? "..." : ""),
    });

    return fullContent;
  }

  performSecondaryProcessing(fullContent) {
    if (!fullContent || !fullContent.trim()) {
      return {
        thinkContent: this.currentThinkContent.trim(),
        normalContent: this.normalContent.trim(),
      };
    }

    // 总是执行二次处理，确保标签被正确解析
    console.log("[StreamThinkProcessor] 执行二次处理，重新解析完整内容");

    // 使用parseThinkContent重新处理整个内容
    const reprocessedResult = parseThinkContent(fullContent);

    console.log("[StreamThinkProcessor] 二次处理结果:", {
      originalThinkLength: this.currentThinkContent.length,
      originalNormalLength: this.normalContent.length,
      reprocessedThinkLength: reprocessedResult.thinkContent.length,
      reprocessedNormalLength: reprocessedResult.normalContent.length,
      hasImprovement:
        reprocessedResult.thinkContent.length >
          this.currentThinkContent.length ||
        reprocessedResult.normalContent.length !== this.normalContent.length,
    });

    // 如果二次处理发现了更多内容，使用二次处理的结果
    if (
      reprocessedResult.thinkContent.length > 0 ||
      reprocessedResult.normalContent.length !== this.normalContent.length
    ) {
      return reprocessedResult;
    }

    // 否则返回原始结果
    return {
      thinkContent: this.currentThinkContent.trim(),
      normalContent: this.normalContent.trim(),
    };
  }

  needsSecondaryProcessing(content) {
    if (!content) return false;

    // 检查是否有不完整的think标签
    const hasIncompleteOpenTag = /<think(?!>)/i.test(content);
    const hasIncompleteCloseTag = /<\/think(?!>)/i.test(content);
    const hasUnmatchedTags = this.hasUnmatchedThinkTags(content);

    return hasIncompleteOpenTag || hasIncompleteCloseTag || hasUnmatchedTags;
  }

  hasUnmatchedThinkTags(content) {
    const openTags = (content.match(/<think>/gi) || []).length;
    const closeTags = (content.match(/<\/think>/gi) || []).length;
    return openTags !== closeTags;
  }

  reset() {
    this.buffer = "";
    this.isInThinkTag = false;
    this.currentThinkContent = "";
    this.normalContent = "";
    this.pendingThinkContent = "";
    this.rawStreamContent = "";
  }

  getState() {
    return {
      isInThinkTag: this.isInThinkTag,
      hasThinkContent: this.currentThinkContent.length > 0,
      hasNormalContent: this.normalContent.length > 0,
      bufferLength: this.buffer.length,
    };
  }
}

export function hasThinkTags(content) {
  if (!content || typeof content !== "string") {
    return false;
  }
  return /<think>[\s\S]*?<\/think>/i.test(content);
}

export function cleanIncompleteThinkTags(content) {
  if (!content || typeof content !== "string") {
    return content || "";
  }

  // 移除不完整的开始标签
  content = content.replace(/<think>(?![\s\S]*?<\/think>)/gi, "");

  // 移除不完整的结束标签
  content = content.replace(/(?<!<think>[\s\S]*?)<\/think>/gi, "");

  return content;
}

export function validateThinkTags(content) {
  if (!content || typeof content !== "string") {
    return { isValid: true, issues: [] };
  }

  const issues = [];

  // 检查不完整的开始标签
  const incompleteOpenTags = content.match(/<think(?!>)/gi);
  if (incompleteOpenTags) {
    issues.push(`发现${incompleteOpenTags.length}个不完整的开始标签`);
  }

  // 检查不完整的结束标签
  const incompleteCloseTags = content.match(/<\/think(?!>)/gi);
  if (incompleteCloseTags) {
    issues.push(`发现${incompleteCloseTags.length}个不完整的结束标签`);
  }

  // 检查标签匹配
  const openTags = (content.match(/<think>/gi) || []).length;
  const closeTags = (content.match(/<\/think>/gi) || []).length;

  if (openTags !== closeTags) {
    issues.push(`标签不匹配：${openTags}个开始标签，${closeTags}个结束标签`);
  }

  return {
    isValid: issues.length === 0,
    issues,
    stats: { openTags, closeTags },
  };
}

export function repairThinkContent(content) {
  if (!content || typeof content !== "string") {
    return {
      thinkContent: "",
      normalContent: content || "",
      repaired: false,
    };
  }

  const validation = validateThinkTags(content);

  if (validation.isValid) {
    // 内容完整，直接解析
    const result = parseThinkContent(content);
    return {
      ...result,
      repaired: false,
    };
  }

  console.log(
    "[repairThinkContent] 检测到标签问题，尝试修复:",
    validation.issues,
  );

  // 尝试修复内容
  let repairedContent = content;

  // 移除不完整的标签片段
  repairedContent = repairedContent.replace(/<think(?!>)[^>]*$/gi, "");
  repairedContent = repairedContent.replace(/<\/think(?!>)[^>]*$/gi, "");
  repairedContent = repairedContent.replace(
    /^[^<]*?(?=<think>|<\/think>|$)/gi,
    "",
  );

  // 如果有未匹配的开始标签，尝试添加结束标签
  const openTags = (repairedContent.match(/<think>/gi) || []).length;
  const closeTags = (repairedContent.match(/<\/think>/gi) || []).length;

  if (openTags > closeTags) {
    const missingCloseTags = openTags - closeTags;
    repairedContent += "</think>".repeat(missingCloseTags);
    console.log(
      `[repairThinkContent] 添加了${missingCloseTags}个缺失的结束标签`,
    );
  } else if (closeTags > openTags) {
    // 移除多余的结束标签
    const extraCloseTags = closeTags - openTags;
    for (let i = 0; i < extraCloseTags; i++) {
      repairedContent = repairedContent.replace(/<\/think>/, "");
    }
    console.log(`[repairThinkContent] 移除了${extraCloseTags}个多余的结束标签`);
  }

  const result = parseThinkContent(repairedContent);

  console.log("[repairThinkContent] 修复完成:", {
    originalLength: content.length,
    repairedLength: repairedContent.length,
    thinkContentLength: result.thinkContent.length,
    normalContentLength: result.normalContent.length,
  });

  return {
    ...result,
    repaired: true,
  };
}
