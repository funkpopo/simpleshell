import { ref, computed } from 'vue'

// 中文翻译
const zhCN = {
  common: {
    confirm: '确认',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    create: '创建',
    close: '关闭',
    loading: '加载中...',
    success: '成功',
    error: '错误',
    warning: '警告',
    unknown: '未知'
  },
  app: {
    title: 'SimpleShell',
    welcome: '欢迎使用 SimpleShell'
  },
  aiAssistant: {
    title: 'AI助手',
    welcome: '您好！我是您的AI助手，有什么可以帮助您的吗？',
    inputPlaceholder: '请输入您的问题...',
    send: '发送',
    response: '这是模拟的AI响应，实际项目中可以接入OpenAI等AI服务。',
    thinking: '思考中...',
    historyTitle: '历史记录',
    noHistory: '没有历史记录',
    startNewChat: '开始新对话',
    deleteHistory: '删除历史记录',
    deleteConfirm: '确定要删除所有历史记录吗？',
    deleteSuccess: '历史记录已删除',
    deleteError: '删除历史记录失败',
    deleteCancel: '取消删除'
  },
  settings: {
    title: '全局设置',
    language: '界面语言',
    fontSize: '界面字号',
    fontFamily: '界面字体',
    terminalFontSize: '终端字号',
    terminalFontFamily: '终端字体',
    fontSizes: {
      small: '小',
      medium: '中',
      large: '大',
      extraLarge: '特大',
      huge: '超大',
      extraHuge: '巨大'
    },
    fontFamilies: {
      system: '系统默认',
      arial: 'Arial',
      yahei: '微软雅黑',
      source: '思源黑体',
      roboto: 'Roboto'
    },
    saveError: '设置保存失败，请重试'
  },
  terminal: {
    local: '本地终端',
    openLocalTerminal: '打开本地终端',
    localDescription: '在本地系统中打开命令行终端',
    ssh: 'SSH连接',
    sshDescription: '从右侧连接管理面板选择一个SSH连接',
    newTab: '新标签页',
    closeTab: '关闭标签页',
    disconnected: '已断开连接'
  },
  connection: {
    title: '连接管理',
    newOrganization: '新建组织',
    editOrganization: '编辑组织',
    newConnection: '新建连接',
    editConnection: '编辑连接',
    name: '名称',
    host: '主机地址',
    port: '端口',
    username: '用户名',
    password: '密码',
    privateKey: '私钥文件',
    description: '描述',
    organization: '组织',
    required: '必填',
    selectOrDropKey: '选择或拖放私钥文件',
    selectFile: '选择文件',
    clear: '清除',
    defaultPort: 'SSH默认端口为22',
    atLeastOne: '密码和密钥至少填写一个',
    portRange: '端口号必须在1-65535之间',
    loadingFile: '加载中...',
    savedPrivateKey: '已保存的私钥'
  },
  fileManager: {
    title: '文件管理',
    upload: '上传',
    download: '下载',
    newFolder: '新建文件夹',
    delete: '删除',
    rename: '重命名',
    refresh: '刷新',
    name: '名称',
    size: '大小',
    type: '类型',
    modified: '修改时间',
    permissions: '权限',
    owner: '所有者',
    actions: '操作',
    confirmDelete: '确认删除',
    deleteWarning: '确定要删除该项目吗？此操作不可撤销。'
  },
  system: {
    title: '系统监控',
    cpu: 'CPU信息',
    memory: '内存信息',
    os: '操作系统信息',
    platform: '平台',
    version: '版本',
    arch: '架构',
    model: '型号',
    cores: '核心数',
    usage: '使用率',
    total: '总内存',
    used: '已用内存'
  }
}

// 英文翻译
const enUS = {
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    close: 'Close',
    loading: 'Loading...',
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    unknown: 'Unknown'
  },
  app: {
    title: 'SimpleShell',
    welcome: 'Welcome to SimpleShell'
  },
  settings: {
    title: 'Global Settings',
    language: 'Interface Language',
    fontSize: 'Interface Font Size',
    fontFamily: 'Interface Font',
    terminalFontSize: 'Terminal Font Size',
    terminalFontFamily: 'Terminal Font',
    fontSizes: {
      small: 'Small',
      medium: 'Medium',
      large: 'Large',
      extraLarge: 'Extra Large',
      huge: 'Huge',
      extraHuge: 'Extra Huge'
    },
    fontFamilies: {
      system: 'System Default',
      arial: 'Arial',
      yahei: 'Microsoft YaHei',
      source: 'Noto Sans SC',
      roboto: 'Roboto'
    },
    saveError: 'Failed to save settings, please try again'
  },
  terminal: {
    local: 'Local Terminal',
    openLocalTerminal: 'Open Local Terminal',
    localDescription: 'Open a command-line terminal on the local system',
    ssh: 'SSH Connection',
    sshDescription: 'Select an SSH connection from the connection panel',
    newTab: 'New Tab',
    closeTab: 'Close Tab',
    disconnected: 'Disconnected'
  },
  connection: {
    title: 'Connection Manager',
    newOrganization: 'New Organization',
    editOrganization: 'Edit Organization',
    newConnection: 'New Connection',
    editConnection: 'Edit Connection',
    name: 'Name',
    host: 'Host Address',
    port: 'Port',
    username: 'Username',
    password: 'Password',
    privateKey: 'Private Key File',
    description: 'Description',
    organization: 'Organization',
    required: 'Required',
    selectOrDropKey: 'Select or drop private key file',
    selectFile: 'Select File',
    clear: 'Clear',
    defaultPort: 'Default SSH port is 22',
    atLeastOne: 'Provide either password or private key',
    portRange: 'Port must be between 1-65535',
    loadingFile: 'Loading...',
    savedPrivateKey: 'Saved Private Key'
  },
  fileManager: {
    title: 'File Manager',
    upload: 'Upload',
    download: 'Download',
    newFolder: 'New Folder',
    delete: 'Delete',
    rename: 'Rename',
    refresh: 'Refresh',
    name: 'Name',
    size: 'Size',
    type: 'Type',
    modified: 'Modified',
    permissions: 'Permissions',
    owner: 'Owner',
    actions: 'Actions',
    confirmDelete: 'Confirm Delete',
    deleteWarning: 'Are you sure you want to delete this item? This action cannot be undone.'
  },
  system: {
    title: 'System Monitor',
    cpu: 'CPU Information',
    memory: 'Memory Information',
    os: 'Operating System Info',
    platform: 'Platform',
    version: 'Version',
    arch: 'Architecture',
    model: 'Model',
    cores: 'Cores',
    usage: 'Usage',
    total: 'Total Memory',
    used: 'Used Memory'
  }
}

// 支持的语言
export const supportedLanguages = {
  'zh-CN': '简体中文',
  'en-US': 'English'
}

// 翻译资源
const messages = {
  'zh-CN': zhCN,
  'en-US': enUS
}

// 当前语言
const currentLanguage = ref('zh-CN')

// 设置语言
export function setLanguage(lang: string) {
  if (messages[lang]) {
    currentLanguage.value = lang
    return true
  }
  return false
}

// 获取当前语言
export function getLanguage() {
  return currentLanguage.value
}

// 翻译函数
export function t(key: string, params?: Record<string, string>): string {
  const lang = currentLanguage.value
  const path = key.split('.')
  
  let result = messages[lang]
  for (const segment of path) {
    if (result && typeof result === 'object' && segment in result) {
      result = result[segment]
    } else {
      console.warn(`[i18n] 翻译键 "${key}" 未找到`)
      return key
    }
  }
  
  if (typeof result !== 'string') {
    console.warn(`[i18n] 翻译键 "${key}" 无效，期望字符串但获得 ${typeof result}`)
    return key
  }
  
  // 替换参数
  if (params) {
    return result.replace(/\{(\w+)\}/g, (_, name) => {
      return params[name] ?? `{${name}}`
    })
  }
  
  return result
}

// Vue 组合式API钩子
export function useI18n() {
  const language = computed(() => currentLanguage.value)
  
  return {
    language,
    t,
    setLanguage
  }
}

// 初始化语言
export function initI18n(initialLang?: string) {
  if (initialLang && messages[initialLang]) {
    currentLanguage.value = initialLang
  }
} 