import * as React from "react";
import { styled, useTheme } from "@mui/material/styles";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import CloseIcon from "@mui/icons-material/Close";
import SendIcon from "@mui/icons-material/Send";
import CircularProgress from "@mui/material/CircularProgress";
import Avatar from "@mui/material/Avatar";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/Delete";
import AddIcon from "@mui/icons-material/Add";
import StopIcon from "@mui/icons-material/Stop";
import ListItemButton from "@mui/material/ListItemButton";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";

// 消息样式
const MessageItem = styled(ListItem)(({ theme, isuser }) => ({
  display: "flex",
  flexDirection: "column",
  alignItems: isuser === "true" ? "flex-end" : "flex-start",
  padding: theme.spacing(1, 2),
  width: "100%",
}));

const MessageContent = styled(Paper)(({ theme, isuser }) => ({
  padding: theme.spacing(1, 2),
  borderRadius: "1.2em",
  maxWidth: "85%",
  minWidth: "40px",
  backgroundColor:
    isuser === "true"
      ? theme.palette.primary.main
      : theme.palette.mode === "dark"
        ? theme.palette.grey[800]
        : theme.palette.grey[200],
  color:
    isuser === "true"
      ? theme.palette.primary.contrastText
      : theme.palette.text.primary,
  wordBreak: "break-word",
  whiteSpace: "pre-wrap",
  display: "inline-block",
}));

// 闪烁光标样式
const blinkKeyframes = `
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
`;

const BlinkCursor = styled("span")({
  animation: "blink 1s step-end infinite",
});

// 创建自定义钩子来处理样式添加
function useBlinkStyle() {
  React.useEffect(() => {
    const styleElement = document.createElement("style");
    styleElement.innerHTML = blinkKeyframes;
    document.head.appendChild(styleElement);

    return () => {
      document.head.removeChild(styleElement);
    };
  }, []);
}

// 标签页面板
function TabPanel(props) {
  const { children, value, index, ...other } = props;

  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`ai-tabpanel-${index}`}
      aria-labelledby={`ai-tab-${index}`}
      style={{ height: "100%", overflow: "auto" }}
      {...other}
    >
      {value === index && <Box sx={{ height: "100%", p: 0 }}>{children}</Box>}
    </div>
  );
}

function AIAssistant({ open, onClose }) {
  const theme = useTheme();
  // 应用闪烁样式
  useBlinkStyle();

  // 标签页状态
  const [tabValue, setTabValue] = React.useState(0);

  // 聊天消息
  const [messages, setMessages] = React.useState([
    {
      id: "welcome-1",
      text: "你好！我是AI助手，有什么可以帮助您的吗？",
      isUser: false,
    },
  ]);

  // 输入消息
  const [inputMessage, setInputMessage] = React.useState("");

  // 加载状态
  const [loading, setLoading] = React.useState(false);

  // 添加一个防止重复发送的标志
  const [isSending, setIsSending] = React.useState(false);

  // 最近发送的消息时间戳
  const lastSendTimeRef = React.useRef(0);

  // 流式响应ID引用
  const streamResponseIdRef = React.useRef(null);
  
  // 添加中断控制器和状态
  const abortControllerRef = React.useRef(null);
  const [isGenerating, setIsGenerating] = React.useState(false);

  // API设置
  const [apiSettings, setApiSettings] = React.useState({
    current: {
      apiUrl: "",
      apiKey: "",
      model: "",
      streamEnabled: true, // 默认启用流式响应
    },
    configs: [],
  });

  // 当前编辑的配置
  const [currentEditConfig, setCurrentEditConfig] = React.useState({
    id: "",
    name: "",
    apiUrl: "",
    apiKey: "",
    model: "",
    streamEnabled: false,
  });

  // 设置是否已保存的状态
  const [settingsSaved, setSettingsSaved] = React.useState(false);

  // 错误状态
  const [error, setError] = React.useState(null);

  // 信息提示
  const [infoMessage, setInfoMessage] = React.useState("");

  // 测试状态
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState(null);

  // 消息容器引用，用于自动滚动
  const messagesEndRef = React.useRef(null);

  // 添加一个最新消息ID的引用，用于追踪最后一条AI消息
  const lastAIMessageIdRef = React.useRef(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // 当消息更新时滚动到底部
  React.useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 生成唯一ID的辅助函数
  const generateUniqueId = (prefix = "ai") => {
    // 使用当前时间戳和随机字符串以确保唯一性
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 10)}-${Math.random().toString(36).substring(2, 6)}`;
  };

  // 安全地添加消息的函数
  const safelyAddMessage = (newMessage) => {
    // 确保消息有唯一ID
    if (!newMessage.id) {
      newMessage.id = generateUniqueId(newMessage.isUser ? "user" : "ai");
    }

    // 确保消息有类型标记
    if (!newMessage.type) {
      newMessage.type = newMessage.isUser ? "user" : "ai";
    }

    // 直接添加新消息，不过滤任何现有消息
    setMessages((prev) => [...prev, newMessage]);

    // 定期清理旧消息
    cleanupOldMessages();
  };

  // 清理旧的消息
  const cleanupOldMessages = () => {
    // 设置一个消息数量上限，如果超过就移除老的消息
    const MAX_MESSAGES = 100;

    setMessages((prev) => {
      if (prev.length > MAX_MESSAGES) {
        // 保留最新的消息，但确保不会打断正在进行的对话
        const messages = prev.slice(-MAX_MESSAGES);

        // 确保第一条消息是用户消息，如果不是，就多保留一条消息
        if (!messages[0].isUser) {
          return prev.slice(-(MAX_MESSAGES + 1));
        }

        return messages;
      }
      return prev;
    });
  };

  // 格式化和准备显示的消息
  const getFormattedMessages = () => {
    // 简化消息处理逻辑，只过滤空消息并按时间戳排序
    return (
      messages
        .filter((msg) => msg.isUser || (msg.text && msg.text.trim() !== ""))
        // 按时间戳排序显示
        .sort((a, b) => {
          // 使用消息的时间戳排序
          return (a.timestamp || 0) - (b.timestamp || 0);
        })
    );
  };

  // 加载AI设置
  React.useEffect(() => {
    const loadSettings = async () => {
      try {
        if (window.terminalAPI && window.terminalAPI.loadAISettings) {
          const settings = await window.terminalAPI.loadAISettings();
          if (settings) {
            // 设置API设置和已保存的配置
            setApiSettings({
              current: settings.current
                ? {
                    ...settings.current,
                    streamEnabled: true,
                  }
                : {
                    apiUrl: "",
                    apiKey: "",
                    model: "",
                    streamEnabled: false,
                  },
              configs: Array.isArray(settings.configs)
                ? settings.configs.map((config) => ({
                    ...config,
                    streamEnabled: true,
                  }))
                : [],
            });

            // 如果存在当前配置，将其作为编辑的起点
            if (settings.current) {
              setCurrentEditConfig({
                ...settings.current,
                streamEnabled: true,
                name: settings.current.name || "默认配置",
              });
            }
          }
        }
      } catch (error) {
        console.error("Failed to load AI settings:", error);
        setError("无法加载AI设置");
      }
    };

    if (open) {
      loadSettings();
    }
  }, [open]);

  // 处理标签页切换
  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
    // 当切换到设置标签时，重置保存状态
    if (newValue === 1) {
      setSettingsSaved(false);
    }
  };

  // 在组件挂载时设置流式事件监听器
  React.useEffect(() => {
    // 处理流式数据块
    const handleStreamChunk = (event) => {
      const { detail } = event;
      if (detail && detail.chunk && streamResponseIdRef.current) {
        // 更新当前AI响应的内容
        setMessages((prev) => {
          return prev.map((msg) => {
            if (msg.id === streamResponseIdRef.current) {
              return {
                ...msg,
                text: msg.text + detail.chunk,
              };
            }
            return msg;
          });
        });
      }
    };

    // 处理流式响应结束
    const handleStreamEnd = (event) => {
      streamResponseIdRef.current = null;
      setLoading(false);
      setIsSending(false);
      setIsGenerating(false);
      abortControllerRef.current = null;
    };

    // 处理流式响应错误
    const handleStreamError = (event) => {
      const { detail } = event;
      if (detail && detail.error) {
        // 添加错误消息
        const errorMessageId = `error-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        const errorMessage = {
          id: errorMessageId,
          text: `错误: ${detail.error.message}`,
          isUser: false,
          isError: true,
          timestamp: Date.now(),
        };
        safelyAddMessage(errorMessage);
      }
      streamResponseIdRef.current = null;
      setLoading(false);
      setIsSending(false);
      setIsGenerating(false);
      abortControllerRef.current = null;
    };

    // 注册事件监听器
    window.addEventListener("ai-stream-chunk", handleStreamChunk);
    window.addEventListener("ai-stream-end", handleStreamEnd);
    window.addEventListener("ai-stream-error", handleStreamError);

    // 清理函数
    return () => {
      window.removeEventListener("ai-stream-chunk", handleStreamChunk);
      window.removeEventListener("ai-stream-end", handleStreamEnd);
      window.removeEventListener("ai-stream-error", handleStreamError);
    };
  }, []);

  // 使用OpenAI API发送请求
  const sendOpenAIRequest = async (prompt, settings = apiSettings.current) => {
    if (!settings.apiUrl || !settings.apiKey || !settings.model) {
      throw new Error("API URL、API密钥和模型名称都必须提供");
    }

    const messages = [
      { role: "system", content: "你是一个有帮助的助手。" },
      { role: "user", content: prompt },
    ];

    // 检查是否在Electron环境中
    if (window.terminalAPI && window.terminalAPI.sendAPIRequest) {
      // 使用Electron的IPC通道发送请求
      return sendRequestViaElectron(prompt, settings);
    } else {
      // 回退到浏览器fetch API
      const requestOptions = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: messages,
          stream: settings.streamEnabled, // 使用设置中的流式响应标志
        }),
      };

      // 根据流式设置选择处理方式
      if (settings.streamEnabled) {
        return handleStreamingResponse(settings.apiUrl, requestOptions);
      } else {
        return handleStandardResponse(settings.apiUrl, requestOptions);
      }
    }
  };

  // 通过Electron的IPC通道发送请求
  const sendRequestViaElectron = async (
    prompt,
    settings = apiSettings.current,
  ) => {
    try {
      const messages = [
        { role: "system", content: "你是一个有帮助的助手。" },
        { role: "user", content: prompt },
      ];

      const requestData = {
        url: settings.apiUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: messages,
        stream: settings.streamEnabled, // 使用设置中的流式响应标志
      };

      // 如果启用流式响应
      if (settings.streamEnabled) {
        // 创建一个空的AI响应消息
        const newAIMessageId = `ai-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
        const aiMessage = {
          id: newAIMessageId,
          text: "", // 初始为空文本
          type: "ai",
          isUser: false,
          timestamp: Date.now(),
        };
        safelyAddMessage(aiMessage);
        
        // 保存当前流式响应的消息ID
        streamResponseIdRef.current = newAIMessageId;
        
        // 设置生成状态
        setIsGenerating(true);
        
        // 发送流式请求
        window.terminalAPI.sendAPIRequest(requestData, true);
        
        // 返回消息ID，表示已开始处理
        return newAIMessageId;
      } else {
        // 使用非流式请求
        const response = await window.terminalAPI.sendAPIRequest(
          requestData,
          false,
        );
        if (response.error) {
          throw new Error(response.error);
        }
        return response.content;
      }
    } catch (error) {
      if (
        error.message === "Failed to fetch" ||
        error.message.includes("网络连接失败")
      ) {
        throw new Error(
          "网络连接失败: 无法连接到API服务器。请检查您的网络连接、API URL是否正确，以及防火墙设置。",
        );
      }
      throw error;
    }
  };

  // 处理流式响应
  const handleStreamingResponse = async (apiUrl, requestOptions) => {
    try {
      // 创建一个空的AI响应消息
      const newAIMessageId = `ai-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
      const aiMessage = {
        id: newAIMessageId,
        text: "", // 初始为空文本
        type: "ai",
        isUser: false,
        timestamp: Date.now(),
      };
      safelyAddMessage(aiMessage);
      
      // 保存当前流式响应的消息ID
      streamResponseIdRef.current = newAIMessageId;
      
      // 创建 AbortController 用于中断请求
      abortControllerRef.current = new AbortController();
      setIsGenerating(true);
      
      // 将 signal 添加到请求选项中
      const requestWithSignal = {
        ...requestOptions,
        signal: abortControllerRef.current.signal
      };
      
      // 开始流式响应处理
      const response = await fetch(apiUrl, requestWithSignal);
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `API请求失败: ${response.status} ${errorData.error?.message || response.statusText}`,
        );
      }
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      
      // 循环读取流式数据
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) {
          break;
        }
        
        // 解码数据
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
                  // 更新消息内容
                  setMessages((prev) => {
                    return prev.map((msg) => {
                      if (msg.id === newAIMessageId) {
                        return {
                          ...msg,
                          text: msg.text + content,
                        };
                      }
                      return msg;
                    });
                  });
                }
              }
            } catch (e) {
              console.error("解析响应行出错:", e);
            }
          }
        }
      }
      
      setIsGenerating(false);
      abortControllerRef.current = null;
      
      // 返回消息ID
      return newAIMessageId;
    } catch (error) {
      // 检查是否是中断错误
      if (error.name === 'AbortError') {
        console.log('请求被中断');
      } else {
        throw error;
      }
    } finally {
      setIsGenerating(false);
      abortControllerRef.current = null;
    }
  };

  // 处理标准响应
  const handleStandardResponse = async (apiUrl, requestOptions) => {
    try {
      const response = await fetch(apiUrl, requestOptions);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(
          `API请求失败: ${response.status} ${errorData.error?.message || response.statusText}`,
        );
      }

      const data = await response.json();
      const content = data.choices[0].message.content;

      // 创建新消息
      addNewAIMessage(content);

      return content;
    } catch (error) {
      if (error.message === "Failed to fetch") {
        throw new Error(
          "网络连接失败: 无法连接到API服务器。请检查您的网络连接、API URL是否正确，以及防火墙设置。",
        );
      }
      throw error;
    }
  };

  // 添加新的AI消息
  const addNewAIMessage = (text) => {
    // 使用时间戳和随机字符串确保消息ID完全唯一
    const newAIMessageId = `ai-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

    // 添加一个新的消息
    setMessages((prev) => [
      ...prev,
      {
        id: newAIMessageId,
        text,
        type: "ai",
        isUser: false,
        timestamp: Date.now(),
      },
    ]);

    return newAIMessageId;
  };

  // 处理发送消息
  const handleSendMessage = async () => {
    if (!inputMessage.trim() || isSending) return;

    // 检查是否过快地发送消息（防抖动）
    const now = Date.now();
    if (now - lastSendTimeRef.current < 1000) {
      // 1秒内不允许连续发送
      console.log("发送过快，请稍后再试");
      return;
    }

    // 更新最后发送时间
    lastSendTimeRef.current = now;

    // 设置发送状态
    setIsSending(true);
    setIsGenerating(true);

    // 添加用户消息，使用唯一的ID生成方式
    const userMessageId = `user-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;

    const userMessage = {
      id: userMessageId,
      text: inputMessage,
      isUser: true,
      timestamp: Date.now(),
    };
    safelyAddMessage(userMessage);
    const currentInput = inputMessage.trim();
    setInputMessage("");

    // 设置加载状态
    setLoading(true);

    try {
      // 验证设置
      if (
        !apiSettings.current ||
        !apiSettings.current.apiUrl ||
        !apiSettings.current.apiKey ||
        !apiSettings.current.model
      ) {
        throw new Error("请在设置中配置API URL、API密钥和模型名称");
      }

      // 直接调用OpenAI API
      const response = await sendOpenAIRequest(currentInput);

      // 如果是流式响应，不需要创建新的AI响应消息，因为已经在handleStreamingResponse中创建了
      if (!apiSettings.current.streamEnabled) {
        // 创建AI响应消息
        const aiResponseId = `ai-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`;
        const aiResponse = {
          id: aiResponseId,
          text: response,
          isUser: false,
          timestamp: Date.now(),
        };
        safelyAddMessage(aiResponse);
      }
      
      // 对于流式响应，setLoading和setIsSending会在流结束事件中被处理
      if (!apiSettings.current.streamEnabled) {
        setLoading(false);
        setIsSending(false);
      }
    } catch (error) {
      console.error("发送消息出错:", error);
      // 添加错误消息
      const errorMessageId = `error-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      const errorMessage = {
        id: errorMessageId,
        text: `错误: ${error.message}`,
        isUser: false,
        isError: true,
        timestamp: Date.now(),
      };
      safelyAddMessage(errorMessage);
      
      setLoading(false);
      setIsSending(false);
    }
  };

  // 处理输入改变
  const handleInputChange = (e) => {
    setInputMessage(e.target.value);
  };

  // 处理按键事件（回车发送）
  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // 处理设置改变
  const handleSettingChange = (e) => {
    const { name, value, checked } = e.target;
    setApiSettings((prev) => ({
      ...prev,
      current: {
        ...prev.current,
        [name]: name === "streamEnabled" ? checked : value,
      },
    }));
    // 如果设置被修改，重置保存状态
    setSettingsSaved(false);
  };

  // 测试API设置
  const handleTestSettings = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    setInfoMessage("");

    // 测试消息内容
    const testPrompt = "这是一条测试消息，请回复'测试成功'确认连接正常。";

    try {
      // 验证设置
      if (!currentEditConfig.apiUrl) {
        throw new Error("请先配置API URL");
      }
      if (!currentEditConfig.apiKey) {
        throw new Error("请先配置API密钥");
      }
      if (!currentEditConfig.model) {
        throw new Error("请先配置模型名称");
      }

      // 验证URL格式
      try {
        new URL(currentEditConfig.apiUrl);
      } catch (urlError) {
        throw new Error(
          "API URL格式无效，请输入完整的URL，包括http://或https://",
        );
      }

      console.log(
        `向 ${currentEditConfig.apiUrl} 发送测试消息: "${testPrompt}"`,
      );

      // 准备发送测试请求
      const messages = [
        { role: "system", content: "你是一个有帮助的助手。" },
        { role: "user", content: testPrompt },
      ];

      const requestData = {
        url: currentEditConfig.apiUrl,
        apiKey: currentEditConfig.apiKey,
        model: currentEditConfig.model,
        messages: messages,
        stream: false, // 测试时使用非流式请求
      };

      // 使用新的API请求方法
      let response;
      if (window.terminalAPI && window.terminalAPI.sendAPIRequest) {
        // 禁用流式响应进行测试
        const result = await window.terminalAPI.sendAPIRequest(
          requestData,
          false,
        );
        if (!result.success) {
          throw new Error(result.error || "无法连接到API服务器");
        }
        response = result.content;
      } else {
        // 回退到旧方法 - 但使用当前编辑的配置
        const tmpSettings = {
          apiUrl: currentEditConfig.apiUrl,
          apiKey: currentEditConfig.apiKey,
          model: currentEditConfig.model,
          streamEnabled: false,
        };
        response = await sendOpenAIRequest(testPrompt, tmpSettings);
      }

      // 显示成功结果，包含API响应
      setTestResult({
        success: true,
        message: "连接测试成功！",
        apiResponse: response,
        testPrompt: testPrompt,
      });

      // 提示用户保存设置
      setInfoMessage('测试成功！请点击"保存设置"按钮保存您的配置。');
    } catch (error) {
      console.error("API测试失败:", error);
      setTestResult({
        success: false,
        message: `测试失败: ${error.message || "未知错误"}`,
        tip: "请检查API URL和密钥是否正确，以及您的网络连接是否正常。",
      });
    } finally {
      setTesting(false);
    }
  };

  // 新建配置
  const handleNewConfig = () => {
    // 生成唯一ID
    const newId = generateUniqueId();
    console.log("创建新配置，ID:", newId);

    // 清空测试结果和错误
    setTestResult(null);
    setError(null);
    setSettingsSaved(false);

    setCurrentEditConfig({
      id: newId,
      name: "新配置",
      apiUrl: "",
      apiKey: "",
      model: "",
      streamEnabled: false,
    });
    setInfoMessage("请在右侧表单中填写新配置的详细信息");
  };

  // 编辑现有配置
  const handleEditConfig = (config) => {
    setCurrentEditConfig({ ...config });
    setInfoMessage("请在右侧表单中编辑配置");
    setSettingsSaved(false);
    setTestResult(null);
    setError(null);
  };

  // 处理当前编辑配置的输入变更
  const handleEditConfigChange = (e) => {
    const { name, value, checked } = e.target;
    setCurrentEditConfig((prev) => ({
      ...prev,
      [name]: name === "streamEnabled" ? checked : value,
    }));
    // 如果设置被修改，重置保存状态
    setSettingsSaved(false);
  };

  // 保存设置
  const handleSaveSettings = async () => {
    try {
      // 保存当前正在编辑的配置
      console.log("正在保存当前编辑的配置:", currentEditConfig);

      // 确保有ID
      let configToSave = { ...currentEditConfig };
      if (!configToSave.id) {
        const newId = generateUniqueId();
        console.log("生成新ID:", newId);
        configToSave.id = newId;
      }

      // 验证必填项
      if (
        !configToSave.name ||
        !configToSave.apiUrl ||
        !configToSave.apiKey ||
        !configToSave.model
      ) {
        setError("请填写所有必填字段");
        return;
      }

      // 验证URL格式
      try {
        new URL(configToSave.apiUrl);
      } catch (urlError) {
        setError("API URL格式无效，请输入完整的URL，包括http://或https://");
        return;
      }

      // 保存配置到IPC
      if (window.terminalAPI && window.terminalAPI.saveApiConfig) {
        console.log("正在通过IPC保存配置，ID:", configToSave.id);

        // 保存配置
        const success = await window.terminalAPI.saveApiConfig(configToSave);

        if (!success) {
          console.error("保存配置失败");
          setError("保存配置失败");
          return;
        }

        console.log("保存配置成功，配置ID:", configToSave.id);

        // 将该配置设置为当前配置
        if (configToSave.id) {
          console.log(`将配置 ${configToSave.id} 设置为当前选中配置`);
          const currentSuccess = await window.terminalAPI.setCurrentApiConfig(
            configToSave.id,
          );

          if (!currentSuccess) {
            console.error("设置当前配置失败");
            setError("设置当前配置失败");
          } else {
            console.log("设置当前配置成功");
          }
        } else {
          console.error("配置ID无效，无法设置为当前配置");
          setError("配置ID无效");
          return;
        }

        // 无论是否设置为当前配置成功，都重新加载设置
        try {
          console.log("重新加载设置");
          const settings = await window.terminalAPI.loadAISettings();
          if (settings) {
            console.log(
              "已加载最新设置:",
              JSON.stringify({
                hasConfigs: Array.isArray(settings.configs),
                configsCount: Array.isArray(settings.configs)
                  ? settings.configs.length
                  : 0,
                hasCurrent: !!settings.current,
              }),
            );

            setApiSettings(settings);

            // 更新当前编辑的配置
            const savedConfig = settings.configs.find(
              (c) => c.id === configToSave.id,
            );
            if (savedConfig) {
              setCurrentEditConfig(savedConfig);
              console.log("已更新当前编辑的配置");

              setInfoMessage("所有设置已保存");
              setSettingsSaved(true);
              setError(null);
            } else {
              console.error("无法在加载的设置中找到已保存的配置");
              setError("保存的配置未正确加载");
            }
          } else {
            console.error("加载设置返回无效数据");
            setError("无法加载更新后的设置");
          }
        } catch (loadError) {
          console.error("加载设置时出错:", loadError);
          setError(`加载设置失败: ${loadError.message || "未知错误"}`);
        }
      } else {
        console.error("saveApiConfig API不可用");
        setError("保存API不可用");
      }
    } catch (error) {
      console.error("保存设置时发生错误:", error);
      setError(`保存设置失败: ${error.message || "未知错误"}`);
    }
  };

  // 设置当前使用的配置
  const handleSetCurrentConfig = async (configId) => {
    try {
      if (window.terminalAPI && window.terminalAPI.setCurrentApiConfig) {
        const success = await window.terminalAPI.setCurrentApiConfig(configId);

        if (success) {
          // 重新加载设置
          const settings = await window.terminalAPI.loadAISettings();

          if (settings) {
            setApiSettings(settings);
            setCurrentEditConfig({
              ...settings.current,
              name: settings.current.name || "默认配置",
            });
            setInfoMessage("已切换到选定的配置");
          }
        }
      }
    } catch (error) {
      console.error("设置当前配置时发生错误:", error);
      setError(`切换配置失败: ${error.message || "未知错误"}`);
    }
  };

  // 删除配置
  const handleDeleteConfig = async (configId) => {
    try {
      if (window.terminalAPI && window.terminalAPI.deleteApiConfig) {
        const success = await window.terminalAPI.deleteApiConfig(configId);

        if (success) {
          // 重新加载设置
          const settings = await window.terminalAPI.loadAISettings();

          if (settings) {
            setApiSettings(settings);
            // 更新编辑区域为当前配置
            setCurrentEditConfig({
              ...settings.current,
              name: settings.current.name || "默认配置",
            });
            setInfoMessage("配置已删除");
          }
        }
      }
    } catch (error) {
      console.error("删除配置时发生错误:", error);
      setError(`删除配置失败: ${error.message || "未知错误"}`);
    }
  };

  // 组件卸载时清理状态
  React.useEffect(() => {
    return () => {
      // 如果有流式响应正在进行，需要中断它
      if (streamResponseIdRef.current) {
        streamResponseIdRef.current = null;
      }
      
      // 中断任何正在进行的请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      // 如果使用的是 Electron IPC 通道
      if (window.terminalAPI && window.terminalAPI.abortAPIRequest) {
        window.terminalAPI.abortAPIRequest();
      }
    };
  }, []);

  // 移除复杂的流式处理定时清理
  React.useEffect(() => {
    const cleanupInterval = setInterval(() => {
      // 定期清理过多的消息，避免内存占用过大
      cleanupOldMessages();
    }, 30000); // 每30秒清理一次

    return () => clearInterval(cleanupInterval);
  }, []);

  // 添加中断生成功能
  const handleStopGeneration = () => {
    // 如果有活跃的 AbortController，使用它中断请求
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    // 如果使用的是 Electron IPC 通道
    if (window.terminalAPI && window.terminalAPI.abortAPIRequest) {
      window.terminalAPI.abortAPIRequest();
    }
    
    // 重置状态
    streamResponseIdRef.current = null;
    setIsGenerating(false);
    setLoading(false);
    setIsSending(false);
  };

  // 将组件实例暴露给父组件
  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      if (!window.aiAssistantRef) {
        window.aiAssistantRef = { current: null };
      }
      window.aiAssistantRef.current = {
        clearMessages: () => {
          setMessages([
            {
              id: "welcome-1",
              text: "你好！我是AI助手，有什么可以帮助您的吗？",
              isUser: false,
            },
          ]);
        }
      };
    }
    return () => {
      if (typeof window !== 'undefined' && window.aiAssistantRef) {
        window.aiAssistantRef.current = null;
      }
    };
  }, []);

  return (
    <Paper
      sx={{
        width: open ? 300 : 0,
        height: "100%",
        overflow: "hidden",
        transition: theme.transitions.create("width", {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
      elevation={4}
    >
      {open && (
        <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* 标题栏 */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography variant="subtitle1" fontWeight="medium">
                AI助手
              </Typography>
              {apiSettings.current?.name && (
                <Typography
                  variant="caption"
                  sx={{ ml: 1, color: "text.secondary" }}
                >
                  ({apiSettings.current.name})
                </Typography>
              )}
            </Box>
            <IconButton size="small" onClick={onClose}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>

          {/* 标签页 */}
          <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
            <Tabs
              value={tabValue}
              onChange={handleTabChange}
              aria-label="ai assistant tabs"
            >
              <Tab label="聊天" id="ai-tab-0" />
              <Tab label="设置" id="ai-tab-1" />
            </Tabs>
          </Box>

          {/* 标签页内容 */}
          <Box
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* 对话标签 */}
            <TabPanel value={tabValue} index={0}>
              <Box
                sx={{
                  display: "flex",
                  flexDirection: "column",
                  height: "100%",
                }}
              >
                {/* 当前API配置选择器 */}
                {apiSettings.configs && apiSettings.configs.length > 0 && (
                  <Box sx={{ px: 2, pt: 1, pb: 0 }}>
                    <FormControl variant="outlined" size="small" fullWidth>
                      <InputLabel
                        id="current-api-config-label"
                        sx={{ fontSize: "0.85rem" }}
                      >
                        当前API
                      </InputLabel>
                      <Select
                        labelId="current-api-config-label"
                        value={apiSettings.current?.id || ""}
                        onChange={(e) => handleSetCurrentConfig(e.target.value)}
                        label="当前API"
                        sx={{ fontSize: "0.85rem" }}
                      >
                        {apiSettings.configs.map((config) => (
                          <MenuItem key={config.id} value={config.id}>
                            <Box
                              sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                width: "100%",
                              }}
                            >
                              <span>{config.name || "未命名配置"}</span>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ ml: 1 }}
                              >
                                {config.model}
                              </Typography>
                            </Box>
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                )}

                {/* 消息列表 */}
                <List
                  sx={{
                    flexGrow: 1,
                    overflow: "auto",
                    p: 0,
                    "&::-webkit-scrollbar": {
                      width: "8px",
                    },
                    "&::-webkit-scrollbar-thumb": {
                      backgroundColor: "rgba(0,0,0,0.2)",
                      borderRadius: "4px",
                    },
                  }}
                >
                  {getFormattedMessages().map((message, index) => {
                    // 为每条消息添加一个唯一的key，确保React能正确区分不同消息
                    // 使用仅消息ID作为key，避免索引导致的重复渲染问题
                    const messageKey = `msg-${message.id}`;
                    return (
                      <MessageItem
                        key={messageKey}
                        isuser={message.isUser.toString()}
                      >
                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "flex-end",
                            gap: 1,
                            maxWidth: "100%",
                            width: message.isUser ? "auto" : "100%",
                          }}
                        >
                          {!message.isUser && (
                            <Avatar
                              sx={{
                                width: 28,
                                height: 28,
                                bgcolor: message.isError
                                  ? "error.main"
                                  : "primary.main",
                                flexShrink: 0,
                              }}
                            >
                              <SmartToyIcon sx={{ fontSize: 16 }} />
                            </Avatar>
                          )}
                          <MessageContent
                            isuser={message.isUser.toString()}
                            sx={{
                              bgcolor: message.isError
                                ? "error.light"
                                : undefined,
                              color: message.isError
                                ? "error.contrastText"
                                : undefined,
                              flexGrow: message.isUser ? 0 : 1,
                              maxWidth: message.isUser
                                ? "85%"
                                : "calc(100% - 40px)",
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {message.text}
                            </Typography>
                          </MessageContent>
                        </Box>
                      </MessageItem>
                    );
                  })}
                  {loading && (
                    <Box sx={{ display: "flex", p: 2 }}>
                      <CircularProgress size={20} />
                    </Box>
                  )}
                  <div ref={messagesEndRef} />
                </List>

                {/* 输入区域 */}
                <Box
                  sx={{
                    p: 2,
                    borderTop: 1,
                    borderColor: "divider",
                    display: "flex",
                    gap: 1,
                  }}
                >
                  <TextField
                    fullWidth
                    variant="outlined"
                    placeholder="输入消息..."
                    size="small"
                    multiline
                    maxRows={4}
                    minRows={1}
                    value={inputMessage}
                    onChange={handleInputChange}
                    onKeyPress={handleKeyPress}
                    disabled={loading}
                    sx={{
                      "& .MuiOutlinedInput-root": {
                        "& textarea": {
                          overflow: "auto",
                          lineHeight: 1.5,
                          padding: "8px 14px",
                          whiteSpace: "pre-wrap",
                        },
                      },
                    }}
                  />
                  <span>
                    {isGenerating ? (
                      <Tooltip title="中断生成">
                        <IconButton
                          color="error"
                          onClick={handleStopGeneration}
                        >
                          <StopIcon />
                        </IconButton>
                      </Tooltip>
                    ) : (
                      <Tooltip title="发送">
                        <IconButton
                          color="primary"
                          onClick={handleSendMessage}
                          disabled={!inputMessage.trim() || loading || isSending}
                        >
                          <SendIcon />
                        </IconButton>
                      </Tooltip>
                    )}
                  </span>
                </Box>
              </Box>
            </TabPanel>

            {/* 设置标签 */}
            <TabPanel value={tabValue} index={1}>
              <Box sx={{ p: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
                {/* 配置列表和操作区 */}
                <Box sx={{ width: "100%", mb: 2 }}>
                  <Typography variant="h6" gutterBottom>
                    API配置
                  </Typography>

                  {/* 配置列表 */}
                  <List
                    sx={{
                      mt: 1,
                      border: 1,
                      borderColor: "divider",
                      borderRadius: 1,
                      overflow: "auto",
                      maxHeight: "150px",
                    }}
                    dense
                  >
                    {apiSettings.configs && apiSettings.configs.length > 0 ? (
                      apiSettings.configs.map((config) => (
                        <ListItem
                          key={config.id}
                          secondaryAction={
                            <Box>
                              <IconButton
                                edge="end"
                                aria-label="edit"
                                onClick={() => handleEditConfig(config)}
                                size="small"
                              >
                                <EditIcon fontSize="small" />
                              </IconButton>
                              <IconButton
                                edge="end"
                                aria-label="delete"
                                onClick={() => handleDeleteConfig(config.id)}
                                size="small"
                                sx={{ ml: 0.5 }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Box>
                          }
                          disablePadding
                        >
                          <ListItemButton
                            selected={config.id === apiSettings.current?.id}
                            onClick={() => handleSetCurrentConfig(config.id)}
                            dense
                          >
                            <ListItemText
                              primary={config.name || "未命名配置"}
                              secondary={config.model}
                              primaryTypographyProps={{
                                fontWeight:
                                  config.id === apiSettings.current?.id
                                    ? "bold"
                                    : "normal",
                              }}
                            />
                          </ListItemButton>
                        </ListItem>
                      ))
                    ) : (
                      <ListItem>
                        <ListItemText
                          primary="暂无配置"
                          secondary="请点击下方按钮创建配置"
                        />
                      </ListItem>
                    )}
                  </List>

                  {/* 新建按钮 */}
                  <Button
                    variant="outlined"
                    fullWidth
                    startIcon={<AddIcon />}
                    onClick={handleNewConfig}
                    sx={{ mt: 1 }}
                  >
                    新建配置
                  </Button>
                </Box>

                {/* 编辑区域 */}
                <Box sx={{ width: "100%", flex: 1, overflow: "auto" }}>
                  <Typography variant="h6" gutterBottom>
                    配置详情
                  </Typography>

                  {/* 测试结果显示 */}
                  {testResult && (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 1,
                        mb: 1.5,
                        bgcolor: testResult.success
                          ? "success.light"
                          : "error.light",
                      }}
                    >
                      <Typography
                        variant="body2"
                        fontWeight="medium"
                        color={
                          testResult.success ? "success.dark" : "error.dark"
                        }
                      >
                        {testResult.success ? "✅ " : "❌ "}
                        {testResult.message}
                      </Typography>

                      {testResult.tip && (
                        <Typography
                          variant="body2"
                          sx={{ mt: 0.5, color: "text.secondary" }}
                        >
                          {testResult.tip}
                        </Typography>
                      )}
                    </Box>
                  )}

                  {/* 错误提示，只在没有测试结果时显示 */}
                  {!testResult && error && (
                    <Typography variant="body2" color="error" sx={{ mb: 1.5 }}>
                      {error}
                    </Typography>
                  )}

                  {/* 保存成功提示，只在没有测试结果时显示 */}
                  {!testResult && settingsSaved && (
                    <Typography
                      variant="body2"
                      color="success.main"
                      sx={{ mb: 1.5 }}
                    >
                      设置已保存
                    </Typography>
                  )}

                  {/* 其他信息提示，只在没有测试结果时显示 */}
                  {!testResult && infoMessage && (
                    <Typography
                      variant="body2"
                      color="info.main"
                      sx={{ mb: 1.5 }}
                    >
                      {infoMessage}
                    </Typography>
                  )}

                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    <TextField
                      fullWidth
                      label="配置名称"
                      name="name"
                      value={currentEditConfig.name}
                      onChange={handleEditConfigChange}
                      placeholder="我的API配置"
                      size="small"
                    />

                    <TextField
                      fullWidth
                      label="API URL"
                      name="apiUrl"
                      value={currentEditConfig.apiUrl}
                      onChange={handleEditConfigChange}
                      placeholder="https://api.openai.com/v1/chat/completions"
                      helperText="AI API的完整URL"
                      size="small"
                    />

                    <TextField
                      fullWidth
                      label="API密钥"
                      name="apiKey"
                      type="password"
                      value={currentEditConfig.apiKey}
                      onChange={handleEditConfigChange}
                      helperText="您的API密钥将被加密存储"
                      size="small"
                    />

                    <TextField
                      fullWidth
                      label="模型名称"
                      name="model"
                      value={currentEditConfig.model}
                      onChange={handleEditConfigChange}
                      placeholder="gpt-3.5-turbo"
                      helperText="例如: gpt-3.5-turbo, gpt-4, gpt-4-turbo"
                      size="small"
                    />

                    <FormControlLabel
                      control={
                        <Switch
                          checked={currentEditConfig.streamEnabled}
                          onChange={(e) => setCurrentEditConfig(prev => ({
                            ...prev,
                            streamEnabled: e.target.checked
                          }))}
                          name="streamEnabled"
                        />
                      }
                      label="启用流式响应"
                    />

                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Button
                        variant="contained"
                        color="info"
                        fullWidth
                        onClick={handleTestSettings}
                        disabled={
                          testing ||
                          !currentEditConfig.apiUrl ||
                          !currentEditConfig.apiKey ||
                          !currentEditConfig.model
                        }
                        startIcon={
                          testing && (
                            <CircularProgress size={20} color="inherit" />
                          )
                        }
                        size="small"
                      >
                        {testing ? "测试中..." : "测试API设置"}
                      </Button>

                      <Button
                        variant="contained"
                        color="primary"
                        fullWidth
                        onClick={handleSaveSettings}
                        size="small"
                      >
                        保存设置
                      </Button>
                    </Box>
                  </Box>
                </Box>
              </Box>
            </TabPanel>
          </Box>
        </Box>
      )}
    </Paper>
  );
}

export default AIAssistant;
