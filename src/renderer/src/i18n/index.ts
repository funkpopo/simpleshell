import { ref, computed } from "vue";

// 中文翻译
const zhCN = {
  common: {
    confirm: "确认",
    cancel: "取消",
    save: "保存",
    delete: "删除",
    edit: "编辑",
    create: "创建",
    close: "关闭",
    loading: "加载中...",
    success: "成功",
    error: "错误",
    warning: "警告",
    unknown: "未知",
    search: "搜索",
    noData: "暂无数据",
    refresh: "刷新",
    uploading: "上传中...",
    downloading: "下载中...",
    upload: "上传",
    download: "下载",
    copy: "复制",
    paste: "粘贴",
    add: "添加",
    remove: "移除",
    test: "测试",
    testing: "测试中...",
  },
  app: {
    title: "SimpleShell",
    welcome: "欢迎使用 SimpleShell",
  },
  aiAssistant: {
    title: "AI助手",
    welcome: "您好！我是您的AI助手，有什么可以帮助您的吗？",
    inputPlaceholder: "请输入您的问题...",
    send: "发送",
    stop: "停止",
    response: "回应内容",
    thinking: "思考中...",
    historyTitle: "历史记录",
    noHistory: "没有历史记录",
    startNewChat: "开始新对话",
    deleteHistory: "删除历史记录",
    deleteConfirm: "确定要删除所有历史记录吗？",
    deleteSuccess: "历史记录已删除",
    deleteError: "删除历史记录失败",
    deleteCancel: "取消删除",
    settingsTitle: "设置",
    save: "保存设置",
    apiUrl: "API URL",
    apiKey: "API Key",
    apiUrlPlaceholder: "请输入API URL",
    apiKeyPlaceholder: "请输入API Key",
    customModel: "自定义模型",
    customModelPlaceholder: "请输入自定义模型名称",
  },
  settings: {
    title: "全局设置",
    language: "界面语言",
    fontSize: "界面字号",
    fontFamily: "界面字体",
    terminalFontSize: "终端字号",
    terminalFontFamily: "终端字体",
    fontSizes: {
      small: "小",
      medium: "中",
      large: "大",
      extraLarge: "特大",
      huge: "超大",
      extraHuge: "巨大",
    },
    fontFamilies: {
      system: "系统默认",
      arial: "Arial",
      yahei: "微软雅黑",
      source: "思源黑体",
      roboto: "Roboto",
    },
    saveError: "设置保存失败，请重试",
    aiApi: {
      title: "AI接口设置",
      add: "添加接口",
      edit: "编辑接口",
      delete: "删除接口",
      deleteConfirm: "确定要删除此接口配置吗？",
      noApis: '暂无配置的AI接口，点击"添加接口"按钮添加',
      name: "接口名称",
      namePlaceholder: "请输入接口名称（如：OpenAI、Claude等）",
      nameRequired: "接口名称不能为空",
      url: "API地址",
      urlPlaceholder: "请输入API地址",
      key: "API密钥",
      keyPlaceholder: "请输入API密钥",
      model: "模型名称",
      modelPlaceholder: "请输入模型名称（如：gpt-4-turbo）",
      select: "选择API配置",
      testSuccess: "测试成功，接口可正常使用",
      testFailed: "测试失败，请检查接口配置",
    },
  },
  terminal: {
    local: "本地终端",
    openLocalTerminal: "打开本地终端",
    localDescription: "在本地系统中打开命令行终端",
    ssh: "SSH连接",
    sshDescription: "从右侧连接管理面板选择一个SSH连接",
    newTab: "新标签页",
    closeTab: "关闭标签页",
    disconnected: "已断开连接",
  },
  connection: {
    title: "连接管理",
    newOrganization: "新建组织",
    editOrganization: "编辑组织",
    newConnection: "新建连接",
    editConnection: "编辑连接",
    name: "名称",
    host: "主机地址",
    port: "端口",
    username: "用户名",
    password: "密码",
    privateKey: "私钥文件",
    description: "描述",
    organization: "组织",
    required: "必填",
    selectOrDropKey: "选择或拖放私钥文件",
    selectFile: "选择文件",
    clear: "清除",
    defaultPort: "SSH默认端口为22",
    atLeastOne: "密码和密钥至少填写一个",
    portRange: "端口号必须在1-65535之间",
    loadingFile: "加载中...",
    savedPrivateKey: "已保存的私钥",
    advancedSettings: "高级设置",
    proxySettings: "代理设置",
    enableProxy: "启用代理",
    proxyType: "代理类型",
    proxyHost: "代理主机",
    proxyPort: "代理端口",
    proxyAuthRequired: "代理需要认证",
    proxyUsername: "代理用户名",
    proxyPassword: "代理密码",
    keepAliveSettings: "连接保活设置",
    enableKeepAlive: "启用连接保活",
    keepAliveInterval: "保活间隔",
    seconds: "秒",
    keepAliveIntervalHint:
      "每隔指定时间发送保活命令以防止连接超时断开，建议设置为120秒",
  },
  fileManager: {
    title: "文件管理",
    upload: "上传",
    download: "下载",
    newFolder: "新建文件夹",
    delete: "删除",
    rename: "重命名",
    refresh: "刷新",
    name: "名称",
    size: "大小",
    type: "类型",
    modified: "修改时间",
    permissions: "权限",
    owner: "所有者",
    actions: "操作",
    confirmDelete: "确认删除",
    deleteWarning: "确定要删除该项目吗？此操作不可撤销。",
  },
  system: {
    title: "系统监控",
    cpu: "CPU信息",
    memory: "内存信息",
    os: "操作系统信息",
    platform: "平台",
    version: "版本",
    arch: "架构",
    model: "型号",
    cores: "核心数",
    usage: "使用率",
    total: "总内存",
    used: "已用内存",
  },
};

// 英文翻译
const enUS = {
  common: {
    confirm: "Confirm",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    create: "Create",
    close: "Close",
    loading: "Loading...",
    success: "Success",
    error: "Error",
    warning: "Warning",
    unknown: "Unknown",
    search: "Search",
    noData: "No Data",
    refresh: "Refresh",
    uploading: "Uploading...",
    downloading: "Downloading...",
    upload: "Upload",
    download: "Download",
    copy: "Copy",
    paste: "Paste",
    add: "Add",
    remove: "Remove",
    test: "Test",
    testing: "Testing...",
  },
  app: {
    title: "SimpleShell",
    welcome: "Welcome to SimpleShell",
  },
  aiAssistant: {
    title: "AI Assistant",
    welcome: "Hello! I am your AI assistant. How can I help you?",
    inputPlaceholder: "Type your question...",
    send: "Send",
    stop: "Stop",
    response: "Response",
    thinking: "Thinking...",
    historyTitle: "History",
    noHistory: "No history",
    startNewChat: "Start new chat",
    deleteHistory: "Delete history",
    deleteConfirm: "Are you sure you want to delete all history?",
    deleteSuccess: "History deleted",
    deleteError: "Failed to delete history",
    deleteCancel: "Cancel deletion",
    settingsTitle: "Settings",
    save: "Save settings",
    apiUrl: "API URL",
    apiKey: "API Key",
    apiUrlPlaceholder: "Enter API URL",
    apiKeyPlaceholder: "Enter API Key",
    customModel: "Custom Model",
    customModelPlaceholder: "Enter custom model name",
  },
  settings: {
    title: "Global Settings",
    language: "Interface Language",
    fontSize: "Interface Font Size",
    fontFamily: "Interface Font",
    terminalFontSize: "Terminal Font Size",
    terminalFontFamily: "Terminal Font",
    fontSizes: {
      small: "Small",
      medium: "Medium",
      large: "Large",
      extraLarge: "Extra Large",
      huge: "Huge",
      extraHuge: "Extra Huge",
    },
    fontFamilies: {
      system: "System Default",
      arial: "Arial",
      yahei: "Microsoft YaHei",
      source: "Source Han Sans",
      roboto: "Roboto",
    },
    saveError: "Failed to save settings, please try again",
    aiApi: {
      title: "AI API Settings",
      add: "Add API",
      edit: "Edit API",
      delete: "Delete API",
      deleteConfirm: "Are you sure you want to delete this API configuration?",
      noApis: 'No AI APIs configured. Click "Add API" button to add one.',
      name: "API Name",
      namePlaceholder: "Enter API name (e.g., OpenAI, Claude)",
      nameRequired: "API name is required",
      url: "API URL",
      urlPlaceholder: "Enter API URL",
      key: "API Key",
      keyPlaceholder: "Enter API key",
      model: "Model Name",
      modelPlaceholder: "Enter model name (e.g., gpt-4-turbo)",
      select: "Select API Configuration",
      testSuccess: "Test successful, API can be used normally",
      testFailed: "Test failed, please check API configuration",
    },
  },
  terminal: {
    local: "Local Terminal",
    openLocalTerminal: "Open Local Terminal",
    localDescription: "Open a command-line terminal on the local system",
    ssh: "SSH Connection",
    sshDescription: "Select an SSH connection from the connection panel",
    newTab: "New Tab",
    closeTab: "Close Tab",
    disconnected: "Disconnected",
  },
  connection: {
    title: "Connection Manager",
    newOrganization: "New Organization",
    editOrganization: "Edit Organization",
    newConnection: "New Connection",
    editConnection: "Edit Connection",
    name: "Name",
    host: "Host Address",
    port: "Port",
    username: "Username",
    password: "Password",
    privateKey: "Private Key File",
    description: "Description",
    organization: "Organization",
    required: "Required",
    selectOrDropKey: "Select or drop private key file",
    selectFile: "Select File",
    clear: "Clear",
    defaultPort: "Default SSH port is 22",
    atLeastOne: "Provide either password or private key",
    portRange: "Port must be between 1-65535",
    loadingFile: "Loading...",
    savedPrivateKey: "Saved Private Key",
    advancedSettings: "Advanced Settings",
    proxySettings: "Proxy Settings",
    enableProxy: "Enable Proxy",
    proxyType: "Proxy Type",
    proxyHost: "Proxy Host",
    proxyPort: "Proxy Port",
    proxyAuthRequired: "Proxy Authentication Required",
    proxyUsername: "Proxy Username",
    proxyPassword: "Proxy Password",
    keepAliveSettings: "Keep-Alive Settings",
    enableKeepAlive: "Enable Keep-Alive",
    keepAliveInterval: "Keep-Alive Interval",
    seconds: "seconds",
    keepAliveIntervalHint:
      "Send keep-alive commands at this interval to prevent connection timeout, recommended: 120 seconds",
  },
  fileManager: {
    title: "File Manager",
    upload: "Upload",
    download: "Download",
    newFolder: "New Folder",
    delete: "Delete",
    rename: "Rename",
    refresh: "Refresh",
    name: "Name",
    size: "Size",
    type: "Type",
    modified: "Modified",
    permissions: "Permissions",
    owner: "Owner",
    actions: "Actions",
    confirmDelete: "Confirm Delete",
    deleteWarning:
      "Are you sure you want to delete this item? This action cannot be undone.",
  },
  system: {
    title: "System Monitor",
    cpu: "CPU Information",
    memory: "Memory Information",
    os: "Operating System Info",
    platform: "Platform",
    version: "Version",
    arch: "Architecture",
    model: "Model",
    cores: "Cores",
    usage: "Usage",
    total: "Total Memory",
    used: "Used Memory",
  },
};

// 支持的语言
export const supportedLanguages = {
  "zh-CN": "简体中文",
  "en-US": "English",
};

// 翻译资源
const messages = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

// 当前语言
const currentLanguage = ref("zh-CN");

// 设置语言
export function setLanguage(lang: string) {
  if (messages[lang]) {
    currentLanguage.value = lang;
    return true;
  }
  return false;
}

// 获取当前语言
export function getLanguage() {
  return currentLanguage.value;
}

// 翻译函数
export function t(key: string, params?: Record<string, string>): string {
  const lang = currentLanguage.value;
  const path = key.split(".");

  let result = messages[lang];
  for (const segment of path) {
    if (result && typeof result === "object" && segment in result) {
      result = result[segment];
    } else {
      console.warn(`[i18n] 翻译键 "${key}" 未找到`);
      return key;
    }
  }

  if (typeof result !== "string") {
    console.warn(
      `[i18n] 翻译键 "${key}" 无效，期望字符串但获得 ${typeof result}`,
    );
    return key;
  }

  // 替换参数
  if (params) {
    return result.replace(/\{(\w+)\}/g, (_, name) => {
      return params[name] ?? `{${name}}`;
    });
  }

  return result;
}

// Vue 组合式API钩子
export function useI18n() {
  const language = computed(() => currentLanguage.value);

  return {
    language,
    t,
    setLanguage,
  };
}

// 初始化语言
export function initI18n(initialLang?: string) {
  if (initialLang && messages[initialLang]) {
    currentLanguage.value = initialLang;
  }
}
