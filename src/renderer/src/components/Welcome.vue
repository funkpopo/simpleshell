<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from '../i18n'

// 使用i18n
const { t } = useI18n()

// 定义欢迎页面的属性
const props = defineProps<{
  isDarkTheme: boolean
}>()

// 定义事件
const emit = defineEmits<{
  (e: 'open-local-terminal'): void
}>()

// 防抖控制
const isClickDisabled = ref(false)
const CLICK_DEBOUNCE_MS = 1000 // 1秒防抖

// 打开本地终端 - 添加防抖逻辑
const openLocalTerminal = () => {
  if (isClickDisabled.value) {
    console.log('点击太频繁，已忽略')
    return
  }
  
  // 设置点击禁用标志
  isClickDisabled.value = true
  
  // 触发事件
  emit('open-local-terminal')
  
  // 一段时间后恢复点击
  setTimeout(() => {
    isClickDisabled.value = false
  }, CLICK_DEBOUNCE_MS)
}
</script>

<template>
  <div class="welcome-section" :class="{ 'dark-theme': props.isDarkTheme }">
    <h1>{{ t('app.welcome') }}</h1>
    
    <div class="quick-actions">
      <div 
        class="action-card" 
        @click="openLocalTerminal"
        :class="{ 'disabled': isClickDisabled }"
      >
        <div class="action-icon local-terminal-icon"></div>
        <h3>{{ t('terminal.openLocalTerminal') }}</h3>
        <p>{{ t('terminal.localDescription') }}</p>
      </div>
      
      <div class="action-card info-card">
        <div class="action-icon info-icon"></div>
        <h3>{{ t('terminal.ssh') }}</h3>
        <p>{{ t('terminal.sshDescription') }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 欢迎页样式 */
.welcome-section {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 20px;
  text-align: center;
  background-color: var(--bg-color);
  color: var(--text-color);
}

.welcome-section h1 {
  font-size: 2.5em;
  margin-bottom: 40px;
  font-weight: 600;
  background: linear-gradient(45deg, #2196f3, #4caf50);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin-top: 0;
}

.quick-actions {
  display: flex;
  gap: 20px;
  margin-top: 20px;
  justify-content: center;
  flex-wrap: wrap;
  max-width: 800px;
}

.action-card {
  background-color: var(--card-bg);
  border-radius: 10px;
  padding: 25px;
  width: 250px;
  cursor: pointer;
  transition: all 0.3s ease;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);
  border: 1px solid var(--border-color);
}

.action-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 6px 15px rgba(0, 0, 0, 0.15);
}

.action-card.disabled {
  opacity: 0.6;
  cursor: default;
  pointer-events: none;
  transform: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);
}

.info-card {
  cursor: default;
  opacity: 0.8;
}

.info-card:hover {
  transform: none;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.1);
}

.action-icon {
  width: 60px;
  height: 60px;
  margin-bottom: 15px;
  background-position: center;
  background-repeat: no-repeat;
  background-size: contain;
  opacity: 0.8;
}

.local-terminal-icon {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230078d7'%3E%3Cpath d='M0 0h24v24H0V0z' fill='none'/%3E%3Cpath d='M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-5 14H4v-4h11v4zm0-5H4V9h11v4zm5 5h-4V9h4v9z'/%3E%3C/svg%3E");
}

.info-icon {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%232196f3'%3E%3Cpath d='M0 0h24v24H0V0z' fill='none'/%3E%3Cpath d='M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z'/%3E%3C/svg%3E");
}

.action-card h3 {
  margin: 0 0 10px 0;
  font-size: 1.2em;
  font-weight: 500;
}

.action-card p {
  margin: 0;
  opacity: 0.8;
  font-size: 0.9em;
  line-height: 1.4;
}

/* 主题变量 */
:root {
  --bg-color: #f5f5f5;
  --text-color: #333;
  --card-bg: #ffffff;
  --border-color: #e0e0e0;
}

:root .dark-theme {
  --bg-color: #1a1a1a;
  --text-color: #eee;
  --card-bg: #272727;
  --border-color: #444;
}
</style> 