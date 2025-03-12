import { Terminal, ITerminalAddon } from '@xterm/xterm';

// 定义lexer规则类型
interface LexerRule {
  name: string;
  match: string | RegExp;
  captures?: Record<string, { name: string }>;
  begin?: string;
  end?: string;
  patterns?: LexerRule[];
}

// 定义lexer文件结构
interface LexerDefinition {
  name: string;
  scopeName: string;
  patterns: LexerRule[];
  repository: Record<string, LexerRule | { patterns: LexerRule[] }>;
}

// 定义主题色映射
interface ThemeColorMap {
  [key: string]: string;
}

export class LexerHighlightAddon implements ITerminalAddon {
  private terminal: Terminal | undefined;
  private lexerRules: LexerDefinition | null = null;
  private darkThemeColorMap: ThemeColorMap = {
    'support.function.linux': '\x1b[38;2;86;156;214m', // 蓝色
    'token.error-token.linux': '\x1b[38;2;204;55;55m', // 红色
    'token.success-token.linux': '\x1b[38;2;87;166;74m', // 绿色
    'token.warn-token.linux': '\x1b[38;2;209;154;28m', // 黄色
    'token.info-token.linux': '\x1b[38;2;78;148;204m', // 浅蓝色
    'markup.heading.linux': '\x1b[38;2;197;134;192m', // 紫色
    'constant.numeric.linux': '\x1b[38;2;181;206;168m', // 淡绿色
    'variable.language.linux': '\x1b[38;2;204;129;82m', // 橙色
    'entity.name.filename.find-in-files.linux': '\x1b[38;2;156;220;254m', // 淡蓝色
    'string.quoted.double.linux': '\x1b[38;2;206;145;120m', // 褐色
    'punctuation.definition.delimiter.linux': '\x1b[38;2;212;212;212m', // 白色
    'punctuation.definition.block.linux': '\x1b[38;2;212;212;212m', // 白色
  };

  private lightThemeColorMap: ThemeColorMap = {
    'support.function.linux': '\x1b[38;2;0;0;255m', // 蓝色
    'token.error-token.linux': '\x1b[38;2;204;0;0m', // 红色
    'token.success-token.linux': '\x1b[38;2;0;128;0m', // 绿色
    'token.warn-token.linux': '\x1b[38;2;255;140;0m', // 橙色
    'token.info-token.linux': '\x1b[38;2;0;120;215m', // 蓝色
    'markup.heading.linux': '\x1b[38;2;128;0;128m', // 紫色
    'constant.numeric.linux': '\x1b[38;2;9;136;90m', // 绿色
    'variable.language.linux': '\x1b[38;2;175;80;0m', // 褐色
    'entity.name.filename.find-in-files.linux': '\x1b[38;2;0;100;200m', // 深蓝色
    'string.quoted.double.linux': '\x1b[38;2;163;21;21m', // 红褐色
    'punctuation.definition.delimiter.linux': '\x1b[38;2;0;0;0m', // 黑色
    'punctuation.definition.block.linux': '\x1b[38;2;0;0;0m', // 黑色
  };

  private isDarkTheme: boolean = true;
  private cachedRegexPatterns: Map<string, RegExp> = new Map();
  private lexerContent: string | null = null;

  constructor(isDarkTheme: boolean = true, lexerContent: string | null = null) {
    this.isDarkTheme = isDarkTheme;
    this.lexerContent = lexerContent;
  }

  public activate(terminal: Terminal): void {
    this.terminal = terminal;
    this.loadLexerRules();
    this.setupDataProcessing();
  }

  public dispose(): void {
    // 清除任何事件监听或资源
    if (this.terminal) {
      // 恢复原始write方法
      // 注意：这需要更复杂的处理，这里只是示意
    }
  }

  // 设置终端主题
  public setTheme(isDarkTheme: boolean): void {
    this.isDarkTheme = isDarkTheme;
  }

  // 设置lexer内容
  public setLexerContent(content: string): void {
    this.lexerContent = content;
    this.loadLexerRules();
  }

  private setupDataProcessing(): void {
    if (!this.terminal) return;

    // 存储原始write方法
    const originalWrite = this.terminal.write.bind(this.terminal);

    // 重写write方法以拦截输出
    this.terminal.write = (data: string | Uint8Array): void => {
      if (typeof data === 'string' && this.lexerRules) {
        const highlightedData = this.highlightText(data);
        originalWrite(highlightedData);
      } else {
        originalWrite(data);
      }
    };
  }

  // 加载lexer规则
  private loadLexerRules(): void {
    try {
      // 如果有提供lexer内容，则直接解析
      if (this.lexerContent) {
        this.lexerRules = JSON.parse(this.lexerContent) as LexerDefinition;
        console.log('Lexer规则从提供的内容加载成功', this.lexerRules.name);
        return;
      }

      // 使用预定义的lexer规则（可选，作为备选方案）
      const defaultLexer = {
        name: "Default Linux Lexer",
        scopeName: "source.linux",
        patterns: [
          // 简化的默认规则
          {
            match: "(?i)\\b(error|fail|failed|warning)\\b",
            name: "token.error-token.linux"
          },
          {
            match: "(?i)\\b(success|ok|done)\\b",
            name: "token.success-token.linux"
          }
        ],
        repository: {}
      };
      
      this.lexerRules = defaultLexer;
      console.log('使用默认Lexer规则');
    } catch (error) {
      console.error('解析Lexer规则出错:', error);
    }
  }

  // 高亮文本
  private highlightText(text: string): string {
    if (!this.lexerRules) return text;

    const lines = text.split('\n');
    const highlightedLines = lines.map(line => this.highlightLine(line));
    
    return highlightedLines.join('\n');
  }

  // 高亮单行文本
  private highlightLine(line: string): string {
    if (!this.lexerRules || !line) return line;

    // 复制原始行以便后续处理
    let result = line;
    const colorMap = this.isDarkTheme ? this.darkThemeColorMap : this.lightThemeColorMap;
    const resetColor = '\x1b[0m';

    // 应用顶级模式
    for (const pattern of this.lexerRules.patterns) {
      if (pattern.match) {
        const regex = this.getRegexFromPattern(pattern.match);
        result = result.replace(regex, (match) => {
          if (pattern.name && colorMap[pattern.name]) {
            return `${colorMap[pattern.name]}${match}${resetColor}`;
          }
          return match;
        });
      }
    }

    // 应用仓库中的模式
    if (this.lexerRules.repository) {
      for (const [key, ruleOrPatterns] of Object.entries(this.lexerRules.repository)) {
        // 跳过复杂规则，如命令、字符串等，这些需要更复杂的处理
        if (key === 'string' || key === 'command') continue;

        let patternRules: LexerRule[] = [];
        
        if ('patterns' in ruleOrPatterns && ruleOrPatterns.patterns) {
          patternRules = ruleOrPatterns.patterns;
        } else if ('match' in ruleOrPatterns) {
          patternRules = [ruleOrPatterns as LexerRule];
        }

        for (const rule of patternRules) {
          if (rule.match) {
            const regex = this.getRegexFromPattern(rule.match);
            result = result.replace(regex, (match) => {
              if (rule.name && colorMap[rule.name]) {
                return `${colorMap[rule.name]}${match}${resetColor}`;
              }
              return match;
            });
          }
        }
      }
    }

    return result;
  }

  // 将规则中的模式转换为正则表达式
  private getRegexFromPattern(pattern: string | RegExp): RegExp {
    if (pattern instanceof RegExp) {
      return pattern;
    }

    // 如果已缓存则返回缓存的正则
    if (this.cachedRegexPatterns.has(pattern)) {
      return this.cachedRegexPatterns.get(pattern)!;
    }

    // 将模式字符串转换为正则表达式
    let regexPattern = pattern;
    
    // 处理特殊语法
    regexPattern = regexPattern.replace(/\(\*UTF\)/g, '');
    
    // 处理其他特殊语法...
    try {
      const regex = new RegExp(regexPattern, 'g');
      this.cachedRegexPatterns.set(pattern, regex);
      return regex;
    } catch (e) {
      console.error('无法创建正则表达式:', pattern, e);
      return /a^/; // 返回一个不会匹配任何内容的正则表达式
    }
  }
} 