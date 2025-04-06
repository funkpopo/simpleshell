const { parentPort, workerData } = require('worker_threads');

// 处理来自主线程的消息
parentPort.on('message', async (message) => {
  try {
    const { type, prompt, settings, id } = message;
    
    if (type === 'prompt') {
      // 处理AI提示请求
      const result = await processAIPrompt(prompt, settings);
      parentPort.postMessage({ id, result });
    }
  } catch (error) {
    // 发送错误回主线程
    parentPort.postMessage({ 
      id: message.id, 
      error: { message: error.message, stack: error.stack } 
    });
  }
});

// 处理AI提示发送
async function processAIPrompt(prompt, settings) {
  try {
    // 检查设置是否有效
    if (!settings || !settings.apiKey) {
      return { error: 'API设置不完整，请在设置中配置API密钥' };
    }
    
    if (!settings.apiUrl) {
      return { error: 'API URL不可用，请在设置中配置API URL' };
    }
    
    if (!settings.model) {
      return { error: '模型名称未指定，请在设置中配置模型名称' };
    }
    
    // 使用指定的API URL发送请求
    return await sendToAPI(prompt, settings);
  } catch (error) {
    console.error('Error processing AI prompt in worker:', error);
    return { error: `处理请求时出错: ${error.message}` };
  }
}

// 发送到API
async function sendToAPI(prompt, settings) {
  try {
    // 组织请求数据
    const messages = [
      { role: "system", content: "你是一个有帮助的助手。" },
      { role: "user", content: prompt }
    ];
    
    const requestData = {
      model: settings.model,
      messages: messages,
      stream: settings.streamEnabled === true
    };
    
    // 这里模拟API响应和处理延迟
    // 在实际实现中，这里会使用fetch或类似库发送API请求
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // 返回模拟响应
    return { 
      response: `这是对"${prompt}"的模拟API响应(来自worker线程)。\n\n在实际应用中，这里将连接到 ${settings.apiUrl} 使用模型 ${settings.model}。${settings.streamEnabled ? '\n\n流式响应已启用。' : ''}`, 
      model: settings.model 
    };
  } catch (error) {
    throw error;
  }
} 