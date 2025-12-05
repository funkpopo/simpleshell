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
  const { url, apiKey, model, messages } = requestData;

  // 解析URL，确保包含完整的API路径
  let apiUrl = url;
  if (!url.includes('/chat/completions')) {
    // 如果URL不包含chat/completions路径，自动添加
    apiUrl = url.replace(/\/$/, '') + '/chat/completions';
  }

  const parsedUrl = new URL(apiUrl);
  const requestModule = parsedUrl.protocol === "https:" ? https : http;

  const options = {
    method: "POST",
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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
      parentPort.postMessage({
        id: requestId,
        error: {
          message: `API请求失败: ${res.statusCode} ${res.statusMessage}`,
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

        // 提取响应内容
        if (data.choices && data.choices[0] && data.choices[0].message) {
          parentPort.postMessage({
            id: requestId,
            result: {
              success: true,
              choices: data.choices,
              usage: data.usage,
            },
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

  // 发送请求数据
  req.write(
    JSON.stringify({
      model: model,
      messages: messages,
    }),
  );

  req.end();
}

/**
 * 处理流式API请求
 * @param {string} requestId - 请求ID
 * @param {Object} requestData - 请求数据
 */
function handleStreamRequest(requestId, requestData) {
  const { url, apiKey, model, messages, sessionId } = requestData;

  // 解析URL，确保包含完整的API路径
  let apiUrl = url;
  if (!url.includes('/chat/completions')) {
    // 如果URL不包含chat/completions路径，自动添加
    apiUrl = url.replace(/\/$/, '') + '/chat/completions';
  }

  const parsedUrl = new URL(apiUrl);
  const requestModule = parsedUrl.protocol === "https:" ? https : http;

  const options = {
    method: "POST",
    hostname: parsedUrl.hostname,
    path: parsedUrl.pathname + parsedUrl.search,
    port: parsedUrl.port || (parsedUrl.protocol === "https:" ? 443 : 80),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  };

  // 添加代理Agent
  const proxyAgent = createProxyAgent(parsedUrl.protocol);
  if (proxyAgent) {
    options.agent = proxyAgent;
  }

  // 创建请求
  const req = requestModule.request(options, (res) => {
    // 处理状态码非200的情况
    if (res.statusCode !== 200) {
      parentPort.postMessage({
        id: requestId,
        type: "stream_error",
        data: {
          sessionId,
          error: {
            message: `API请求失败: ${res.statusCode} ${res.statusMessage}`,
            statusCode: res.statusCode,
          },
        },
      });
      return;
    }

    // 接收数据块
    res.on("data", (chunk) => {
      try {
        const data = chunk.toString("utf-8");
        const lines = data.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const jsonData = JSON.parse(line.substring(6));

              // 提取内容并发送到主线程
              if (
                jsonData.choices &&
                jsonData.choices[0] &&
                jsonData.choices[0].delta &&
                jsonData.choices[0].delta.content
              ) {
                parentPort.postMessage({
                  id: requestId,
                  type: "stream_chunk",
                  data: {
                    sessionId,
                    chunk: jsonData.choices[0].delta.content,
                  },
                });
              }
            } catch (e) {
              // 忽略无法解析的行
            }
          } else if (line === "data: [DONE]") {
            // 流结束
            parentPort.postMessage({
              id: requestId,
              type: "stream_end",
              data: {
                sessionId,
              },
            });
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

  // 发送请求数据
  req.write(
    JSON.stringify({
      model: model,
      messages: messages,
      stream: true,
    }),
  );

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
  const { url, apiKey } = requestData;

  // 解析URL，构建模型列表API地址
  let modelsUrl;
  try {
    const parsedUrl = new URL(url);
    // 从chat completions URL构建models URL
    // 例如: https://api.openai.com/v1/chat/completions -> https://api.openai.com/v1/models
    const pathParts = parsedUrl.pathname.split('/');
    if (pathParts.length >= 3 && pathParts[1] === 'v1') {
      // 替换路径中的最后一个部分
      pathParts[pathParts.length - 1] = 'models';
      parsedUrl.pathname = pathParts.join('/');
      modelsUrl = parsedUrl.toString();
    } else {
      // 如果不是标准OpenAI格式，尝试直接添加/models
      modelsUrl = url.replace(/\/$/, '') + '/models';
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
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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

        // 提取模型列表
        let models = [];
        if (data.data && Array.isArray(data.data)) {
          // OpenAI格式: {data: [{id: "gpt-3.5-turbo"}, ...]}
          models = data.data.map(model => model.id).filter(id => id);
        } else if (Array.isArray(data)) {
          // 其他格式: [{id: "model1"}, ...]
          models = data.map(model => model.id || model).filter(id => id);
        } else if (data.models && Array.isArray(data.models)) {
          // 某些API格式
          models = data.models.map(model => model.id || model).filter(id => id);
        }

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
