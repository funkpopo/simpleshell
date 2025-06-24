const { parentPort } = require("worker_threads");
const https = require("https");
const http = require("http");

// 存储活跃请求的Map
const activeRequests = new Map();

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
  const { url, apiKey, model, messages, isStream, sessionId } = requestData;

  try {
    if (isStream) {
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

  // 解析URL
  const parsedUrl = new URL(url);
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

  // 解析URL
  const parsedUrl = new URL(url);
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
