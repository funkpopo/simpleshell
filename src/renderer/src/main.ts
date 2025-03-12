import './assets/main.css'

import { createApp } from 'vue'
import App from './App.vue'
import { initI18n } from './i18n'

// 初始化i18n，从设置加载语言
async function initApp() {
  try {
    // 从设置中加载语言
    const settings = await window.api.loadSettings()
    const language = settings?.language || 'zh-CN'
    
    // 初始化i18n
    initI18n(language)
    
    // 创建应用并挂载
    createApp(App).mount('#app')
  } catch (error) {
    console.error('初始化应用失败:', error)
    // 如果无法加载设置，使用默认设置创建应用
    initI18n('zh-CN')
    createApp(App).mount('#app')
  }
}

initApp()
