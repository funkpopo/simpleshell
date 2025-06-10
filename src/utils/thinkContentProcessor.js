/**
 * 思考内容处理工具
 * 用于解析AI回复中的<think></think>标签，支持流式响应处理
 */

/**
 * 解析完整的消息内容，提取思考内容和正常内容
 * @param {string} content - 完整的消息内容
 * @returns {Object} - { thinkContent: string, normalContent: string }
 */
export function parseThinkContent(content) {
  if (!content || typeof content !== 'string') {
    return { thinkContent: '', normalContent: content || '' };
  }

  // 使用正则表达式匹配<think></think>标签
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  const matches = [];
  let match;

  // 提取所有思考内容
  while ((match = thinkRegex.exec(content)) !== null) {
    matches.push({
      fullMatch: match[0],
      thinkContent: match[1].trim(),
      startIndex: match.index,
      endIndex: match.index + match[0].length
    });
  }

  if (matches.length === 0) {
    return { thinkContent: '', normalContent: content };
  }

  // 合并所有思考内容
  const thinkContent = matches.map(m => m.thinkContent).join('\n\n');

  // 移除思考标签，保留正常内容
  let normalContent = content;
  matches.reverse().forEach(match => {
    normalContent = normalContent.substring(0, match.startIndex) + 
                   normalContent.substring(match.endIndex);
  });

  return {
    thinkContent: thinkContent.trim(),
    normalContent: normalContent.trim()
  };
}

/**
 * 流式响应的思考内容处理器
 * 用于处理流式响应中可能被分割的<think>标签
 */
export class StreamThinkProcessor {
  constructor() {
    this.buffer = '';
    this.isInThinkTag = false;
    this.currentThinkContent = '';
    this.normalContent = '';
    this.pendingThinkContent = '';
  }

  /**
   * 处理新的数据块
   * @param {string} chunk - 新的数据块
   * @returns {Object} - { hasUpdate: boolean, thinkContent: string, normalContent: string, isComplete: boolean }
   */
  processChunk(chunk) {
    if (!chunk) {
      return { hasUpdate: false, thinkContent: '', normalContent: '', isComplete: true };
    }

    this.buffer += chunk;
    let hasUpdate = false;
    let newThinkContent = '';
    let newNormalContent = '';

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
        this.buffer = this.buffer.substring(openMatch.index + openMatch[0].length);
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
        newThinkContent = this.pendingThinkContent + thinkText;
        this.pendingThinkContent = '';
        
        // 退出思考模式
        this.isInThinkTag = false;
        hasUpdate = true;

        // 更新缓冲区，移除已处理的内容
        this.buffer = this.buffer.substring(closeMatch.index + closeMatch[0].length);
      } else {
        // 还没有找到结束标签，将当前内容暂存
        this.pendingThinkContent += this.buffer;
        this.buffer = '';
      }
    } else {
      // 不在思考模式中，所有内容都是正常内容
      if (this.buffer) {
        newNormalContent += this.buffer;
        this.buffer = '';
        hasUpdate = true;
      }
    }

    // 更新累积内容
    if (newThinkContent) {
      this.currentThinkContent += (this.currentThinkContent ? '\n\n' : '') + newThinkContent;
    }
    if (newNormalContent) {
      this.normalContent += newNormalContent;
    }

    return {
      hasUpdate,
      thinkContent: this.currentThinkContent,
      normalContent: this.normalContent,
      isComplete: !this.isInThinkTag && this.buffer === ''
    };
  }

  /**
   * 完成处理，返回最终结果
   * @returns {Object} - { thinkContent: string, normalContent: string }
   */
  finalize() {
    // 如果还在思考标签中，将剩余内容作为思考内容
    if (this.isInThinkTag && this.buffer) {
      this.currentThinkContent += (this.currentThinkContent ? '\n\n' : '') + 
                                  this.pendingThinkContent + this.buffer;
    } else if (this.buffer) {
      // 否则作为正常内容
      this.normalContent += this.buffer;
    }

    return {
      thinkContent: this.currentThinkContent.trim(),
      normalContent: this.normalContent.trim()
    };
  }

  /**
   * 重置处理器状态
   */
  reset() {
    this.buffer = '';
    this.isInThinkTag = false;
    this.currentThinkContent = '';
    this.normalContent = '';
    this.pendingThinkContent = '';
  }

  /**
   * 获取当前状态
   * @returns {Object} - 当前处理状态
   */
  getState() {
    return {
      isInThinkTag: this.isInThinkTag,
      hasThinkContent: this.currentThinkContent.length > 0,
      hasNormalContent: this.normalContent.length > 0,
      bufferLength: this.buffer.length
    };
  }
}

/**
 * 检查内容是否包含思考标签
 * @param {string} content - 要检查的内容
 * @returns {boolean} - 是否包含思考标签
 */
export function hasThinkTags(content) {
  if (!content || typeof content !== 'string') {
    return false;
  }
  return /<think>[\s\S]*?<\/think>/i.test(content);
}

/**
 * 清理不完整的思考标签
 * @param {string} content - 要清理的内容
 * @returns {string} - 清理后的内容
 */
export function cleanIncompleteThinkTags(content) {
  if (!content || typeof content !== 'string') {
    return content || '';
  }

  // 移除不完整的开始标签
  content = content.replace(/<think>(?![\s\S]*?<\/think>)/gi, '');
  
  // 移除不完整的结束标签
  content = content.replace(/(?<!<think>[\s\S]*?)<\/think>/gi, '');

  return content;
}
