const { parentPort, workerData } = require("worker_threads");
const fetch = require("node-fetch");

// 处理来自主线程的消息
parentPort.on("message", async (message) => {
  try {
    const { type, prompt, settings, id } = message;

    if (type === "prompt") {
      // 处理AI提示请求
      const result = await processAIPrompt(prompt, settings);
      parentPort.postMessage({ id, result });
    } else if (type === "stream") {
      // 处理流式响应请求
      processStreamingPrompt(prompt, settings, id);
    }
  } catch (error) {
    // 发送错误回主线程
    parentPort.postMessage({
      id: message.id,
      error: { message: error.message, stack: error.stack },
    });
  }
});

// 处理AI提示发送
async function processAIPrompt(prompt, settings) {
  try {
    // 检查设置是否有效
    if (!settings || !settings.apiKey) {
      return { error: "API设置不完整，请在设置中配置API密钥" };
    }

    if (!settings.apiUrl) {
      return { error: "API URL不可用，请在设置中配置API URL" };
    }

    if (!settings.model) {
      return { error: "模型名称未指定，请在设置中配置模型名称" };
    }

    // 使用指定的API URL发送请求
    return await sendToAPI(prompt, settings);
  } catch (error) {
    console.error("Error processing AI prompt in worker:", error);
    return { error: `处理请求时出错: ${error.message}` };
  }
}

// 处理流式响应
async function processStreamingPrompt(prompt, settings, id) {
  try {
    // 验证设置
    if (!settings || !settings.apiKey) {
      parentPort.postMessage({
        id,
        error: { message: "API设置不完整，请在设置中配置API密钥" }
      });
      return;
    }

    if (!settings.apiUrl) {
      parentPort.postMessage({
        id,
        error: { message: "API URL不可用，请在设置中配置API URL" }
      });
      return;
    }

    if (!settings.model) {
      parentPort.postMessage({
        id,
        error: { message: "模型名称未指定，请在设置中配置模型名称" }
      });
      return;
    }

    // 组织请求数据
    const messages = [
      { role: "system", content: "你是一个有帮助的助手。" },
      { role: "user", content: prompt },
    ];

    const requestOptions = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model: settings.model,
        messages: messages,
        stream: true,
      }),
    };

    try {
      const response = await fetch(settings.apiUrl, requestOptions);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API请求失败: ${response.status} ${errorText}`);
      }
      
      // 处理流式响应
      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          // 流结束
          parentPort.postMessage({
            id,
            streamEnd: true
          });
          break;
        }
        
        // 解码收到的数据
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // 处理数据行
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);
          
          if (line.trim() === "") continue;
          if (line.trim() === "data: [DONE]") continue;
          
          // 处理数据行
          if (line.startsWith("data: ")) {
            try {
              const jsonData = JSON.parse(line.slice(6));
              if (jsonData.choices && jsonData.choices[0].delta) {
                const { content } = jsonData.choices[0].delta;
                if (content) {
                  // 发送内容块给主进程
                  parentPort.postMessage({
                    id,
                    chunk: content
                  });
                }
              }
            } catch (e) {
              console.error("解析响应行出错:", e);
            }
          }
        }
      }
    } catch (error) {
      // 发送错误给主进程
      parentPort.postMessage({
        id,
        error: { message: error.message }
      });
    }
  } catch (error) {
    parentPort.postMessage({
      id,
      error: { message: error.message, stack: error.stack }
    });
  }
}

// 发送到API
async function sendToAPI(prompt, settings) {
  try {
    // 组织请求数据
    const messages = [
      { role: "system", content: "你是一个有帮助的助手。" },
      { role: "user", content: prompt },
    ];

    const requestData = {
      model: settings.model,
      messages: messages,
      stream: false,
    };

    // 使用fetch发送实际API请求
    const response = await fetch(settings.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify(requestData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        `API请求失败: ${response.status} ${errorData.error?.message || response.statusText}`
      );
    }

    const data = await response.json();
    return {
      response: data.choices[0].message.content,
      model: settings.model,
    };
  } catch (error) {
    throw error;
  }
}
