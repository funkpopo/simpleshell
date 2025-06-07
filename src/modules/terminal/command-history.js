class CommandHistoryService {
  constructor() {
    this.history = [];
    this.maxHistorySize = 1000; // 最大历史记录数量
    this.initialized = false;
  }

  initialize(initialHistory = []) {
    this.history = Array.isArray(initialHistory) ? [...initialHistory] : [];
    this.initialized = true;
  }

  isValidCommand(command) {
    if (!command || typeof command !== "string") {
      return false;
    }

    const trimmedCommand = command.trim();

    // 基本长度检查
    if (trimmedCommand.length === 0 || trimmedCommand.length < 2) {
      return false;
    }

    // 过滤ANSI转义序列
    if (/\x1b\[|\u001b\[/.test(trimmedCommand)) {
      return false;
    }

    // 过滤控制字符（除了常见的空白字符）
    // ASCII控制字符范围：0-31，但允许空格(32)、制表符(9)、换行符(10)、回车符(13)
    const hasInvalidControlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(
      trimmedCommand,
    );
    if (hasInvalidControlChars) {
      return false;
    }

    // 过滤只包含方向键序列的命令
    if (/^\[?[ABCD]\]?$/.test(trimmedCommand)) {
      return false;
    }

    // 过滤只包含特殊字符组合的命令
    const specialCharPatterns = [
      /^[\[\]]+$/, // 只包含方括号
      /^[<>]+$/, // 只包含尖括号
      /^[\-=_]+$/, // 只包含横线、等号、下划线
      /^[~`!@#$%^&*()+=|\\{}[\]:";'<>?,./]+$/, // 只包含特殊符号
      /^[\s]+$/, // 只包含空白字符
    ];

    if (specialCharPatterns.some((pattern) => pattern.test(trimmedCommand))) {
      return false;
    }

    // 过滤重复字符（同一字符重复3次以上）
    if (/(.)\1{2,}/.test(trimmedCommand) && trimmedCommand.length <= 5) {
      return false;
    }

    // 确保命令包含至少一个字母或数字
    if (!/[a-zA-Z0-9]/.test(trimmedCommand)) {
      return false;
    }

    // 过滤明显的按键序列或无意义的输入
    const invalidPatterns = [
      /^[hjkl]+$/, // vim导航键
      /^[wasd]+$/, // 游戏控制键
      /^[qwerty]+$/, // 键盘布局测试
      /^[asdf]+$/, // 随意按键
      /^[zxcv]+$/, // 常见快捷键
      /^[.,;:'"]+$/, // 只包含标点
      /^\d{1,2,3,4,5,6,7,8,9,10}$/, // 单纯的1-10位数字
      /^[yn]$/, // 单个y或n（通常是确认响应，不是命令）
    ];

    if (
      invalidPatterns.some((pattern) =>
        pattern.test(trimmedCommand.toLowerCase()),
      )
    ) {
      return false;
    }

    // 过滤过长的重复模式
    if (trimmedCommand.length > 20) {
      // 检查是否有重复的子字符串模式
      const repeatedPattern = /(.{2,10})\1{2,}/.exec(trimmedCommand);
      if (repeatedPattern) {
        return false;
      }
    }

    return true;
  }

  addCommand(command) {
    // 使用增强的验证逻辑
    if (!this.isValidCommand(command)) {
      return false;
    }

    const trimmedCommand = command.trim();

    // 移除重复的命令（如果存在）
    this.removeCommand(trimmedCommand);

    // 添加到历史记录开头
    this.history.unshift({
      command: trimmedCommand,
      timestamp: Date.now(),
      count: 1,
    });

    // 保持历史记录大小限制
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(0, this.maxHistorySize);
    }

    return true;
  }

  removeCommand(command) {
    this.history = this.history.filter((item) => item.command !== command);
  }

  incrementCommandUsage(command) {
    const item = this.history.find((h) => h.command === command);
    if (item) {
      item.count = (item.count || 1) + 1;
      item.timestamp = Date.now();
    }
  }

  getSuggestions(input, maxResults = 10) {
    if (!input || typeof input !== "string" || input.trim().length === 0) {
      // 如果没有输入，返回最近使用的命令
      return this.getRecentCommands(maxResults);
    }

    const trimmedInput = input.trim().toLowerCase();
    const suggestions = [];

    // 1. 精确前缀匹配（优先级最高）
    const prefixMatches = this.history.filter((item) =>
      item.command.toLowerCase().startsWith(trimmedInput),
    );

    // 2. 包含匹配
    const containsMatches = this.history.filter(
      (item) =>
        !item.command.toLowerCase().startsWith(trimmedInput) &&
        item.command.toLowerCase().includes(trimmedInput),
    );

    // 3. 模糊匹配
    const fuzzyMatches = this.history.filter(
      (item) =>
        !item.command.toLowerCase().includes(trimmedInput) &&
        this.fuzzyMatch(item.command.toLowerCase(), trimmedInput),
    );

    // 合并结果并按优先级排序
    const allMatches = [
      ...prefixMatches.map((item) => ({
        ...item,
        matchType: "prefix",
        score: 3,
      })),
      ...containsMatches.map((item) => ({
        ...item,
        matchType: "contains",
        score: 2,
      })),
      ...fuzzyMatches.map((item) => ({
        ...item,
        matchType: "fuzzy",
        score: 1,
      })),
    ];

    // 按分数、使用次数和时间排序
    allMatches.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.count !== b.count) return (b.count || 1) - (a.count || 1);
      return b.timestamp - a.timestamp;
    });

    return allMatches.slice(0, maxResults).map((item) => ({
      command: item.command,
      matchType: item.matchType,
      count: item.count || 1,
      timestamp: item.timestamp,
    }));
  }

  getRecentCommands(maxResults = 10) {
    return this.history.slice(0, maxResults).map((item) => ({
      command: item.command,
      matchType: "recent",
      count: item.count || 1,
      timestamp: item.timestamp,
    }));
  }

  fuzzyMatch(text, pattern) {
    let textIndex = 0;
    let patternIndex = 0;

    while (textIndex < text.length && patternIndex < pattern.length) {
      if (text[textIndex] === pattern[patternIndex]) {
        patternIndex++;
      }
      textIndex++;
    }

    return patternIndex === pattern.length;
  }

  clearHistory() {
    this.history = [];
  }

  getAllHistory() {
    return [...this.history];
  }

  setMaxHistorySize(size) {
    if (typeof size === "number" && size > 0) {
      this.maxHistorySize = size;
      if (this.history.length > size) {
        this.history = this.history.slice(0, size);
      }
    }
  }

  getStatistics() {
    return {
      totalCommands: this.history.length,
      maxHistorySize: this.maxHistorySize,
      mostUsedCommand: this.getMostUsedCommand(),
      initialized: this.initialized,
    };
  }

  getMostUsedCommand() {
    if (this.history.length === 0) return null;

    return this.history.reduce((max, current) =>
      (current.count || 1) > (max.count || 1) ? current : max,
    );
  }

  exportHistory() {
    return this.history.map((item) => ({
      command: item.command,
      timestamp: item.timestamp,
      count: item.count || 1,
    }));
  }

  importHistory(exportedHistory) {
    if (!Array.isArray(exportedHistory)) return;

    this.history = exportedHistory
      .filter((item) => item && typeof item.command === "string")
      .map((item) => ({
        command: item.command,
        timestamp: item.timestamp || Date.now(),
        count: item.count || 1,
      }))
      .slice(0, this.maxHistorySize);
  }
}

// 创建单例实例
const commandHistoryService = new CommandHistoryService();

module.exports = commandHistoryService;
