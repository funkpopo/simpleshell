const { parentPort } = require("worker_threads");
const https = require("https");
const http = require("http");
const { SocksProxyAgent } = require("socks-proxy-agent");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { HttpProxyAgent } = require("http-proxy-agent");

// 存储活跃请求的Map
const activeRequests = new Map();

// 存储系统代理配置
let systemProxyConfig = null;

// ============================================
// API 适配器定义
// ============================================

/**
 * OpenAI API 适配器
 */
const openaiAdapter = {
  name: "openai",

  /**
   * 构建聊天完成API的URL
   */
  buildChatUrl(baseUrl) {
    if (!baseUrl.includes('/chat/completions')) {
      return baseUrl.replace(/\/$/, '') + '/chat/completions';
    }
    return baseUrl;
  },

  /**
   * 构建模型列表API的URL
   */
  buildModelsUrl(baseUrl) {
    const parsedUrl = new URL(baseUrl);
    const pathParts = parsedUrl.pathname.split('/');
    if (pathParts.length >= 3 && pathParts[1] === 'v1') {
      pathParts[pathParts.length - 1] = 'models';
      parsedUrl.pathname = pathParts.join('/');
      return parsedUrl.toString();
    }
    return baseUrl.replace(/\/$/, '') + '/models';
  },

  /**
   * 构建请求头
   */
  buildHeaders(apiKey) {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    };
  },

  /**
   * 构建请求体
   */
  buildRequestBody(model, messages, isStream, maxTokens) {
    const body = {
      model: model,
      messages: messages,
    };
    if (isStream) {
      body.stream = true;
    }
    return body;
  },

  /**
   * 解析标准响应
   */
  parseResponse(data) {
    if (data.choices && data.choices[0] && data.choices[0].message) {
      return {
        success: true,
        choices: data.choices,
        usage: data.usage,
      };
    }
    return null;
  },

  /**
   * 解析流式响应块
   */
  parseStreamChunk(line) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const jsonData = JSON.parse(line.substring(6));
        if (jsonData.choices && jsonData.choices[0] &&
            jsonData.choices[0].delta && jsonData.choices[0].delta.content) {
          return { content: jsonData.choices[0].delta.content };
        }
      } catch (e) {
        // 忽略解析错误
      }
    } else if (line === "data: [DONE]") {
      return { done: true };
    }
    return null;
  },

  /**
   * 解析模型列表响应
   */
  parseModelsResponse(data) {
    if (data.data && Array.isArray(data.data)) {
      return data.data.map(model => model.id).filter(id => id);
    } else if (Array.isArray(data)) {
      return data.map(model => model.id || model).filter(id => id);
    } else if (data.models && Array.isArray(data.models)) {
      return data.models.map(model => model.id || model).filter(id => id);
    }
    return [];
  },
};

/**
 * Anthropic API 适配器
 */
const anthropicAdapter = {
  name: "anthropic",

  /**
   * 构建聊天完成API的URL
   */
  buildChatUrl(baseUrl) {
    if (!baseUrl.includes('/messages')) {
      return baseUrl.replace(/\/$/, '') + '/v1/messages';
    }
    return baseUrl;
  },

  /**
   * 构建模型列表API的URL
   */
  buildModelsUrl(baseUrl) {
    // Anthropic 没有官方的模型列表API，返回null
    return null;
  },

  /**
   * 构建请求头
   */
  buildHeaders(apiKey) {
    return {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    };
  },

  /**
   * 构建请求体
   */
  buildRequestBody(model, messages, isStream, maxTokens) {
    // 转换消息格式：OpenAI格式 -> Anthropic格式
    // Anthropic需要将system消息单独提取出来
    let systemMessage = "";
    const convertedMessages = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        systemMessage = msg.content;
      } else {
        convertedMessages.push({
          role: msg.role === "assistant" ? "assistant" : "user",
          content: msg.content,
        });
      }
    }

    const body = {
      model: model,
      messages: convertedMessages,
      max_tokens: maxTokens || 4096,
    };

    if (systemMessage) {
      body.system = systemMessage;
    }

    if (isStream) {
      body.stream = true;
    }

    return body;
  },

  /**
   * 解析标准响应
   */
  parseResponse(data) {
    if (data.content && Array.isArray(data.content)) {
      const textContent = data.content.find(c => c.type === "text");
      if (textContent) {
        return {
          success: true,
          choices: [{
            message: {
              role: "assistant",
              content: textContent.text,
            },
          }],
          usage: data.usage ? {
            prompt_tokens: data.usage.input_tokens,
            completion_tokens: data.usage.output_tokens,
            total_tokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
          } : undefined,
        };
      }
    }
    return null;
  },

  /**
   * 解析流式响应块
   */
  parseStreamChunk(line) {
    if (line.startsWith("data: ")) {
      try {
        const jsonData = JSON.parse(line.substring(6));

        // Anthropic流式响应类型
        if (jsonData.type === "content_block_delta" &&
            jsonData.delta && jsonData.delta.text) {
          return { content: jsonData.delta.text };
        } else if (jsonData.type === "message_stop") {
          return { done: true };
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    return null;
  },

  /**
   * 解析模型列表响应
   */
  parseModelsResponse(data) {
    // Anthropic没有模型列表API，返回预定义列表
    return [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-opus-20240229",
      "claude-3-sonnet-20240229",
      "claude-3-haiku-20240307",
    ];
  },
};

/**
 * Gemini API 适配器
 */
const geminiAdapter = {
  name: "gemini",

  /**
   * 构建聊天完成API的URL
   */
  buildChatUrl(baseUrl, model, apiKey, isStream) {
    // Gemini API格式: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
    let url = baseUrl.replace(/\/$/, '');

    // 如果URL不包含models路径，添加它
    if (!url.includes('/models/')) {
      url = url + '/v1beta/models/' + model;
    }

    // 添加操作类型
    if (isStream) {
      url = url.replace(/:generateContent.*$/, '') + ':streamGenerateContent';
    } else {
      url = url.replace(/:streamGenerateContent.*$/, '') + ':generateContent';
    }

    // 添加API key作为查询参数
    const separator = url.includes('?') ? '&' : '?';
    url = url + separator + 'key=' + apiKey;

    return url;
  },

  /**
   * 构建模型列表API的URL
   */
  buildModelsUrl(baseUrl, apiKey) {
    let url = baseUrl.replace(/\/$/, '');
    if (!url.includes('/models')) {
      url = url + '/v1beta/models';
    }
    const separator = url.includes('?') ? '&' : '?';
    return url + separator + 'key=' + apiKey;
  },

  /**
   * 构建请求头
   */
  buildHeaders(apiKey) {
    // Gemini使用URL参数传递API key，不需要Authorization头
    return {
      "Content-Type": "application/json",
    };
  },

  /**
   * 构建请求体
   */
  buildRequestBody(model, messages, isStream, maxTokens) {
    // 转换消息格式：OpenAI格式 -> Gemini格式
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
      if (msg.role === "system") {
        systemInstruction = { parts: [{ text: msg.content }] };
      } else {
        contents.push({
          role: msg.role === "assistant" ? "model" : "user",
          parts: [{ text: msg.content }],
        });
      }
    }

    const body = {
      contents: contents,
      generationConfig: {
        maxOutputTokens: maxTokens || 4096,
      },
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    return body;
  },

  /**
   * 解析标准响应
   */
  parseResponse(data) {
    if (data.candidates && data.candidates[0] &&
        data.candidates[0].content && data.candidates[0].content.parts) {
      const textPart = data.candidates[0].content.parts.find(p => p.text);
      if (textPart) {
        return {
          success: true,
          choices: [{
            message: {
              role: "assistant",
              content: textPart.text,
            },
          }],
          usage: data.usageMetadata ? {
            prompt_tokens: data.usageMetadata.promptTokenCount,
            completion_tokens: data.usageMetadata.candidatesTokenCount,
            total_tokens: data.usageMetadata.totalTokenCount,
          } : undefined,
        };
      }
    }
    return null;
  },

  /**
   * 解析流式响应块
   */
  parseStreamChunk(line) {
    // Gemini流式响应是JSON数组格式
    if (line.startsWith("[") || line.startsWith(",") || line.startsWith("{")) {
      try {
        // 清理行首的逗号或方括号
        let cleanLine = line.replace(/^[\[,\s]+/, '').replace(/\]$/, '');
        if (!cleanLine || cleanLine === ']') return null;

        const jsonData = JSON.parse(cleanLine);
        if (jsonData.candidates && jsonData.candidates[0] &&
            jsonData.candidates[0].content && jsonData.candidates[0].content.parts) {
          const textPart = jsonData.candidates[0].content.parts.find(p => p.text);
          if (textPart) {
            return { content: textPart.text };
          }
        }
      } catch (e) {
        // 忽略解析错误
      }
    }
    return null;
  },

  /**
   * 解析模型列表响应
   */
  parseModelsResponse(data) {
    if (data.models && Array.isArray(data.models)) {
      return data.models
        .filter(model => model.supportedGenerationMethods &&
                model.supportedGenerationMethods.includes("generateContent"))
        .map(model => model.name.replace("models/", ""));
    }
    return [];
  },
};

/**
 * 获取API适配器
 * @param {string} provider - 提供商类型 (openai, anthropic, gemini)
 * @returns {object} API适配器
 */
function getApiAdapter(provider) {
  switch (provider) {
    case "anthropic":
      return anthropicAdapter;
    case "gemini":
      return geminiAdapter;
    case "openai":
    default:
      return openaiAdapter;
  }
}

/**
 * 创建代理Agent
 * @param {string} protocol - 目标URL协议 (http: 或 https:)
 * @returns {object|null} 代理Agent或null
 */
function createProxyAgent(protocol) {
  if (!systemProxyConfig || !systemProxyConfig.host || !systemProxyConfig.port) {
    return null;
  }

  const { type, host, port, username, password } = systemProxyConfig;
  const proxyType = (type || "http").toLowerCase();

  try {
    if (proxyType === "socks4" || proxyType === "socks5") {
      // SOCKS代理
      let socksUrl = `${proxyType}://`;
      if (username && password) {
        socksUrl += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
      }
      socksUrl += `${host}:${port}`;
      return new SocksProxyAgent(socksUrl);
    } else {
      // HTTP/HTTPS代理
      let proxyUrl = `http://`;
      if (username && password) {
        proxyUrl += `${encodeURIComponent(username)}:${encodeURIComponent(password)}@`;
      }
      proxyUrl += `${host}:${port}`;

      if (protocol === "https:") {
        return new HttpsProxyAgent(proxyUrl);
      } else {
        return new HttpProxyAgent(proxyUrl);
      }
    }
  } catch (error) {
    // 创建代理Agent失败，返回null使用直连
    return null;
  }
}

// 监听来自主线程的消息
parentPort.on("message", async (message) => {
  const { type, id, data } = message;

  try {
    switch (type) {
      case "api_request":
        // 处理API请求
        handleAPIRequest(id, data);
        break;

      case "cancel_request":
        // 取消请求
        cancelRequest(id, data);
        break;

      case "update_proxy":
        // 更新系统代理配置
        systemProxyConfig = data;
        parentPort.postMessage({
          id,
          result: { success: true, proxyConfigured: !!data },
        });
        break;

      case "health_check":
        // 响应健康检查
        parentPort.postMessage({
          id,
          result: { status: "healthy", timestamp: Date.now() },
        });
        break;

      default:
        throw new Error(`未知的消息类型: ${type}`);
    }
  } catch (error) {
    // 发送错误回主线程
    parentPort.postMessage({
      id,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  }
});

/**
 * 处理API请求
 * @param {string} requestId - 请求ID
 * @param {Object} requestData - 请求数据
 */
function handleAPIRequest(requestId, requestData) {
  const { url, apiKey, model, messages, isStream, sessionId, type } = requestData;

  try {
    if (type === "models") {
      // 处理获取模型列表请求
      handleModelsRequest(requestId, requestData);
    } else if (isStream) {
      // 处理流式请求
      handleStreamRequest(requestId, requestData);
    } else {
      // 处理标准请求
      handleStandardRequest(requestId, requestData);
    }
  } catch (error) {
    parentPort.postMessage({
      id: requestId,
      error: {
        message: error.message,
        stack: error.stack,
      },
    });
  }
}

/**
 * 处理标准(非流式)API请求
 * @param {string} requestId - 请求ID
 * @param {Object} requestData - 请求数据
 */
function handleStandardRequest(requestId, requestData) {
  const { url, apiKey, model, messages, provider, maxTokens } = requestData;

  // 获取适配器
  const adapter = getApiAdapter(provider);

  // 构建API URL
  let apiUrl;
  if (adapter.name === "gemini") {
    apiUrl = adapter.buildChatUrl(url, model, apiKey, false);
  } else {
    apiUrl = adapter.buildChatUrl(url);
  }

  const parsedUrl = new URL(apiUrl);
  const requestModule = parsedUrl.protocol === "https:" ? https : http;

  const options = {
    method: "POST",
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    headers: adapter.buildHeaders(apiKey),
  };

  // 添加代理Agent
  const proxyAgent = createProxyAgent(parsedUrl.protocol);
  if (proxyAgent) {
    options.agent = proxyAgent;
  }

  // 创建请求
  const req = requestModule.request(options, (res) => {
    let responseData = "";

    // 处理状态码非200的情况
    if (res.statusCode !== 200) {
      // 收集错误响应体
      res.on("data", (chunk) => {
        responseData += chunk.toString("utf-8");
      });
      res.on("end", () => {
        let errorMessage = `API请求失败: ${res.statusCode} ${res.statusMessage}`;
        try {
          const errorData = JSON.parse(responseData);
          if (errorData.error && errorData.error.message) {
            errorMessage = errorData.error.message;
          }
        } catch (e) {
          // 忽略解析错误
        }
        parentPort.postMessage({
          id: requestId,
          error: {
            message: errorMessage,
            statusCode: res.statusCode,
          },
        });
      });
      return;
    }

    res.on("data", (chunk) => {
      responseData += chunk.toString("utf-8");
    });

    res.on("end", () => {
      try {
        // 解析JSON响应
        const data = JSON.parse(responseData);

        // 使用适配器解析响应
        const result = adapter.parseResponse(data);
        if (result) {
          parentPort.postMessage({
            id: requestId,
            result: result,
          });
        } else {
          parentPort.postMessage({
            id: requestId,
            error: {
              message: "无法解析API响应",
              rawResponse: responseData.substring(0, 200) + "...",
            },
          });
        }
      } catch (error) {
        parentPort.postMessage({
          id: requestId,
          error: {
            message: `解析响应失败: ${error.message}`,
            rawResponse: responseData.substring(0, 200) + "...",
          },
        });
      }
    });
  });

  // 处理请求错误
  req.on("error", (error) => {
    parentPort.postMessage({
      id: requestId,
      error: {
        message: `请求出错: ${error.message}`,
        stack: error.stack,
      },
    });
  });

  // 存储请求引用
  activeRequests.set(requestId, { req, type: "standard" });

  // 使用适配器构建请求体
  const requestBody = adapter.buildRequestBody(model, messages, false, maxTokens);

  // 发送请求数据
  req.write(JSON.stringify(requestBody));

  req.end();
}

/**
 * 处理流式API请求
 * @param {string} requestId - 请求ID
 * @param {Object} requestData - 请求数据
 */
function handleStreamRequest(requestId, requestData) {
  const { url, apiKey, model, messages, sessionId, provider, maxTokens } = requestData;

  // 获取适配器
  const adapter = getApiAdapter(provider);

  // 构建API URL
  let apiUrl;
  if (adapter.name === "gemini") {
    apiUrl = adapter.buildChatUrl(url, model, apiKey, true);
  } else {
    apiUrl = adapter.buildChatUrl(url);
  }

  const parsedUrl = new URL(apiUrl);
  const requestModule = parsedUrl.protocol === "https:" ? https : http;

  const options = {
    method: "POST",
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    headers: adapter.buildHeaders(apiKey),
  };

  // 添加代理Agent
  const proxyAgent = createProxyAgent(parsedUrl.protocol);
  if (proxyAgent) {
    options.agent = proxyAgent;
  }

  // 用于处理Gemini的JSON数组流式响应
  let geminiBuffer = "";

  // 创建请求
  const req = requestModule.request(options, (res) => {
    // 处理状态码非200的情况
    if (res.statusCode !== 200) {
      let errorData = "";
      res.on("data", (chunk) => {
        errorData += chunk.toString("utf-8");
      });
      res.on("end", () => {
        let errorMessage = `API请求失败: ${res.statusCode} ${res.statusMessage}`;
        try {
          const parsed = JSON.parse(errorData);
          if (parsed.error && parsed.error.message) {
            errorMessage = parsed.error.message;
          }
        } catch (e) {
          // 忽略解析错误
        }
        parentPort.postMessage({
          id: requestId,
          type: "stream_error",
          data: {
            sessionId,
            error: {
              message: errorMessage,
              statusCode: res.statusCode,
            },
          },
        });
      });
      return;
    }

    // 接收数据块
    res.on("data", (chunk) => {
      try {
        const data = chunk.toString("utf-8");

        // Gemini使用不同的流式格式（JSON数组）
        if (adapter.name === "gemini") {
          geminiBuffer += data;
          // 尝试解析完整的JSON对象
          const lines = geminiBuffer.split("\n");
          geminiBuffer = "";

          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;

            const result = adapter.parseStreamChunk(trimmedLine);
            if (result) {
              if (result.content) {
                parentPort.postMessage({
                  id: requestId,
                  type: "stream_chunk",
                  data: {
                    sessionId,
                    chunk: result.content,
                  },
                });
              } else if (result.done) {
                parentPort.postMessage({
                  id: requestId,
                  type: "stream_end",
                  data: {
                    sessionId,
                  },
                });
              }
            } else {
              // 保留未完成的行
              geminiBuffer += trimmedLine;
            }
          }
        } else {
          // OpenAI和Anthropic使用SSE格式
          const lines = data.split("\n");

          for (const line of lines) {
            const result = adapter.parseStreamChunk(line);
            if (result) {
              if (result.content) {
                parentPort.postMessage({
                  id: requestId,
                  type: "stream_chunk",
                  data: {
                    sessionId,
                    chunk: result.content,
                  },
                });
              } else if (result.done) {
                parentPort.postMessage({
                  id: requestId,
                  type: "stream_end",
                  data: {
                    sessionId,
                  },
                });
              }
            }
          }
        }
      } catch (error) {
        // 处理数据解析错误
        parentPort.postMessage({
          id: requestId,
          type: "stream_error",
          data: {
            sessionId,
            error: {
              message: `处理流数据时出错: ${error.message}`,
            },
          },
        });
      }
    });

    // 处理流结束
    res.on("end", () => {
      // 移除请求引用
      activeRequests.delete(requestId);

      // 发送流结束消息
      parentPort.postMessage({
        id: requestId,
        type: "stream_end",
        data: {
          sessionId,
        },
      });
    });
  });

  // 处理请求错误
  req.on("error", (error) => {
    // 移除请求引用
    activeRequests.delete(requestId);

    // 发送错误消息
    parentPort.postMessage({
      id: requestId,
      type: "stream_error",
      data: {
        sessionId,
        error: {
          message: `请求出错: ${error.message}`,
        },
      },
    });
  });

  // 存储请求引用
  activeRequests.set(requestId, { req, type: "stream", sessionId });

  // 使用适配器构建请求体
  const requestBody = adapter.buildRequestBody(model, messages, true, maxTokens);

  // 发送请求数据
  req.write(JSON.stringify(requestBody));

  req.end();
}

/**
 * 取消请求
 * @param {string} requestId - 请求ID
 * @param {Object} data - 取消数据
 */
function cancelRequest(requestId, data) {
  const { sessionId } = data || {};

  if (requestId && activeRequests.has(requestId)) {
    // 通过请求ID取消
    const { req } = activeRequests.get(requestId);
    if (req && req.abort) {
      req.abort();
    }
    activeRequests.delete(requestId);

    // 发送取消确认
    parentPort.postMessage({
      id: requestId,
      result: { cancelled: true, byId: true },
    });
  } else if (sessionId) {
    // 通过会话ID取消
    let found = false;
    for (const [id, request] of activeRequests.entries()) {
      if (request.sessionId === sessionId) {
        if (request.req && request.req.abort) {
          request.req.abort();
        }
        activeRequests.delete(id);
        found = true;
      }
    }

    // 发送取消确认
    parentPort.postMessage({
      id: requestId || "cancel_by_session",
      result: { cancelled: found, bySessionId: true },
    });
  } else {
    // 没有足够信息取消请求
    parentPort.postMessage({
      id: requestId || "cancel_unknown",
      error: {
        message: "取消请求失败: 未提供有效的请求ID或会话ID",
      },
    });
  }
}

// 初始化消息
parentPort.postMessage({
  type: "init",
  result: {
    status: "ready",
    timestamp: Date.now(),
  },
});

// 错误处理
process.on("uncaughtException", (error) => {
  parentPort.postMessage({
    type: "worker_error",
    error: {
      message: `Worker未捕获异常: ${error.message}`,
      stack: error.stack,
    },
  });
});

/**
 * 处理获取模型列表请求
 * @param {string} requestId - 请求ID
 * @param {Object} requestData - 请求数据
 */
function handleModelsRequest(requestId, requestData) {
  const { url, apiKey, provider } = requestData;

  // 获取适配器
  const adapter = getApiAdapter(provider);

  // Anthropic没有模型列表API，直接返回预定义列表
  if (adapter.name === "anthropic") {
    const models = adapter.parseModelsResponse({});
    parentPort.postMessage({
      id: requestId,
      result: {
        success: true,
        models: models,
      },
    });
    return;
  }

  // 构建模型列表API地址
  let modelsUrl;
  try {
    if (adapter.name === "gemini") {
      modelsUrl = adapter.buildModelsUrl(url, apiKey);
    } else {
      modelsUrl = adapter.buildModelsUrl(url);
    }

    if (!modelsUrl) {
      throw new Error("无法构建模型列表URL");
    }
  } catch (error) {
    parentPort.postMessage({
      id: requestId,
      error: {
        message: `构建模型列表URL失败: ${error.message}`,
      },
    });
    return;
  }

  // 解析模型列表URL
  const parsedModelsUrl = new URL(modelsUrl);
  const requestModule = parsedModelsUrl.protocol === "https:" ? https : http;

  const options = {
    method: "GET",
    hostname: parsedModelsUrl.hostname,
    path: parsedModelsUrl.pathname + parsedModelsUrl.search,
    port: parsedModelsUrl.port || (parsedModelsUrl.protocol === "https:" ? 443 : 80),
    headers: adapter.buildHeaders(apiKey),
  };

  // 添加代理Agent
  const proxyAgent = createProxyAgent(parsedModelsUrl.protocol);
  if (proxyAgent) {
    options.agent = proxyAgent;
  }

  // 创建请求
  const req = requestModule.request(options, (res) => {
    let responseData = "";

    // 处理状态码非200的情况
    if (res.statusCode !== 200) {
      parentPort.postMessage({
        id: requestId,
        error: {
          message: `获取模型列表失败: ${res.statusCode} ${res.statusMessage}`,
          statusCode: res.statusCode,
        },
      });
      return;
    }

    res.on("data", (chunk) => {
      responseData += chunk.toString("utf-8");
    });

    res.on("end", () => {
      try {
        // 解析JSON响应
        const data = JSON.parse(responseData);

        // 使用适配器解析模型列表
        const models = adapter.parseModelsResponse(data);

        parentPort.postMessage({
          id: requestId,
          result: {
            success: true,
            models: models,
          },
        });
      } catch (error) {
        parentPort.postMessage({
          id: requestId,
          error: {
            message: `解析模型列表响应失败: ${error.message}`,
            rawResponse: responseData.substring(0, 200) + "...",
          },
        });
      }
    });
  });

  // 处理请求错误
  req.on("error", (error) => {
    parentPort.postMessage({
      id: requestId,
      error: {
        message: `获取模型列表请求出错: ${error.message}`,
        stack: error.stack,
      },
    });
  });

  // 存储请求引用
  activeRequests.set(requestId, { req, type: "models" });

  req.end();
}

// 退出处理
process.on("exit", (code) => {
  try {
    parentPort.postMessage({
      type: "worker_exit",
      result: {
        code,
        timestamp: Date.now(),
      },
    });
  } catch (e) {
    // 忽略退出时的通信错误
  }
});
