import { ref } from 'vue';

// 创建一个服务来管理lexer规则
class LexerService {
  private lexerCache = new Map<string, string>();
  private isLoading = ref(false);
  private lexerError = ref<string | null>(null);

  // 加载lexer规则文件
  async loadLexerFile(lexerType: string): Promise<string | null> {
    try {
      this.isLoading.value = true;
      this.lexerError.value = null;
      
      // 检查缓存
      if (this.lexerCache.has(lexerType)) {
        return this.lexerCache.get(lexerType) || null;
      }
      
      // 从main进程获取lexer规则文件
      const api = (window as any).api;
      
      // 使用IPC调用获取lexer文件
      if (api.getLexerFile) {
        // 如果已实现getLexerFile方法，则直接调用
        const result = await api.getLexerFile(lexerType);
        if (result.success && result.content) {
          this.lexerCache.set(lexerType, result.content);
          console.log(`已加载 ${lexerType} lexer 规则`);
          return result.content;
        }
      } else {
        // 使用文件对话框作为备选方案
        console.log(`尝试使用文件对话框加载 ${lexerType} lexer 规则文件`);
        
        // 构建文件路径
        const filePath = `rules/${lexerType}.lexer`;
        
        // 尝试打开文件
        const result = await api.openFileDialog({
          defaultPath: filePath,
          properties: ['openFile']
        });
        
        // 如果打开成功且读取到内容
        if (!result.canceled && result.fileContent) {
          // 缓存结果
          this.lexerCache.set(lexerType, result.fileContent);
          console.log(`已加载 ${lexerType} lexer 规则`);
          return result.fileContent;
        }
      }
      
      // 如果都失败了，返回默认的lexer配置
      console.warn(`未能找到 ${lexerType} lexer 规则文件，使用默认规则`);
      const defaultContent = this.getDefaultLinuxLexer();
      this.lexerCache.set(lexerType, defaultContent);
      return defaultContent;
    } catch (error: any) {
      this.lexerError.value = error?.message || '加载lexer文件失败';
      console.error('加载lexer文件失败:', error);
      
      // 出错时也返回默认规则
      const defaultContent = this.getDefaultLinuxLexer();
      this.lexerCache.set(lexerType, defaultContent);
      return defaultContent;
    } finally {
      this.isLoading.value = false;
    }
  }
  
  // 手动设置lexer内容
  setLexerContent(lexerType: string, content: string): void {
    this.lexerCache.set(lexerType, content);
  }
  
  // 获取默认的Linux lexer内容
  getDefaultLinuxLexer(): string {
    // 如果无法从文件系统加载，使用此默认内容
    return JSON.stringify({
      "name": "Linux (Default)",
      "scopeName": "source.linux",
      "patterns": [
        {
          "match": "(?i)\\b(error|fail|failed|warning)\\b",
          "name": "token.error-token.linux"
        },
        {
          "match": "(?i)\\b(success|ok|done)\\b",
          "name": "token.success-token.linux"
        },
        {
          "match": "(?i)\\b(info|notice|note)\\b",
          "name": "token.info-token.linux"
        }
      ],
      "repository": {
        "command": {
          "match": "(?<=[\\|#\\$])[ \\t]{0,99}([\\w\\.-]++)(?=$|\\s)",
          "captures": {
            "1": {
              "name": "support.function.linux"
            }
          }
        },
        "ip": {
          "match": "\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\b",
          "name": "markup.heading.linux"
        },
        "number": {
          "match": "\\b\\d+\\b",
          "name": "constant.numeric.linux"
        }
      }
    });
  }
}

// 导出单例实例
export const lexerService = new LexerService(); 