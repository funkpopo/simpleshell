import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import App from './App.vue'
import '@arco-design/web-vue/dist/arco.css'
import enUS from './locale/en-US'
import zhCN from './locale/zh-CN'

const app = createApp(App)

// 设置默认语言为英文
if (!localStorage.getItem('language')) {
  localStorage.setItem('language', 'en-US')
}

// 注册语言包
app.config.globalProperties.$t = function(key) {
  const lang = localStorage.getItem('language') || 'en-US'
  const messages = lang === 'zh-CN' ? zhCN : enUS
  return key.split('.').reduce((o, i) => o[i], messages)
}

app.use(ArcoVue)
app.mount('#app')
