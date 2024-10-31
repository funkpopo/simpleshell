import { createApp } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import App from './App.vue'
import '@arco-design/web-vue/dist/arco.css'
import enUS from '@arco-design/web-vue/es/locale/lang/en-us'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn'
import customEnUS from './locale/en-US'
import customZhCN from './locale/zh-CN'

const app = createApp(App)

// 合并 Arco Design 的语言包和自定义语言包
const messages = {
  'en-US': {
    ...enUS,
    ...customEnUS
  },
  'zh-CN': {
    ...zhCN,
    ...customZhCN
  }
}

// 设置默认语言
if (!localStorage.getItem('language')) {
  localStorage.setItem('language', 'en-US')
}

// 创建 i18n 实例
const i18n = {
  locale: localStorage.getItem('language') || 'en-US',
  messages,
  t(key) {
    const locale = this.locale
    return key.split('.').reduce((o, i) => o[i], this.messages[locale])
  }
}

app.config.globalProperties.$t = (key) => i18n.t(key)
app.provide('i18n', i18n)

app.use(ArcoVue, {
  locale: i18n.locale === 'zh-CN' ? zhCN : enUS
})
app.mount('#app')
