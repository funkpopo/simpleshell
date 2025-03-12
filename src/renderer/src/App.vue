<script setup lang="ts">
import { ref, onMounted } from 'vue'
import NightIcon from './assets/night.svg'
import DayIcon from './assets/day.svg'
import BrainIcon from './assets/brain.svg'
import SettingsNightIcon from './assets/settings-night.svg'
import SettingsDayIcon from './assets/settings-day.svg'
import SystemMonitor from './components/SystemMonitor.vue'
import ConnectionManager from './components/ConnectionManager.vue'
import Welcome from './components/Welcome.vue'
import TerminalView from './components/TerminalView.vue'
import FileManager from './components/FileManager.vue'
import SettingsDialog from './components/SettingsDialog.vue'
import AIAssistant from './components/AIAssistant.vue'

// 定义TerminalView组件实例的类型
interface TerminalViewInstance {
  addLocalTerminal: () => void
  addSshConnection: (connection: any) => void
  hasAnyTabs: boolean
}

// 主题状态
const isDarkTheme = ref(true)
const toggleTheme = () => {
  isDarkTheme.value = !isDarkTheme.value
}

// 连接状态
const hasConnections = ref(false)
// 是否使用本地终端模式
const isLocalTerminalMode = ref(false)

// 左侧边栏状态
const isLeftSidebarExpanded = ref(true)
const sidebarWidth = ref(300)
const lastSidebarWidth = ref(300)
const isDragging = ref(false)

// 当前活动的连接ID
const activeConnectionId = ref<string | null>(null)

// 右侧边栏状态
const isRightSidebarExpanded = ref(true)
const rightSidebarWidth = ref(250)
const lastRightSidebarWidth = ref(250)
const isRightDragging = ref(false)
// 右侧边栏分割线位置（百分比）
const rightSidebarSplitPosition = ref(50)
const isRightSplitDragging = ref(false)

// 左侧边栏方法
const toggleLeftSidebar = () => {
  if (isLeftSidebarExpanded.value) {
    lastSidebarWidth.value = sidebarWidth.value
    sidebarWidth.value = 40 // 设置为折叠宽度
  } else {
    sidebarWidth.value = lastSidebarWidth.value
  }
  isLeftSidebarExpanded.value = !isLeftSidebarExpanded.value
}

const handleMouseDown = () => {
  if (!isLeftSidebarExpanded.value) return
  isDragging.value = true
  
  // 在拖动开始时禁用过渡动画，使拖动更流畅
  const sidebar = document.querySelector('.left-sidebar') as HTMLElement
  if (sidebar) {
    sidebar.classList.add('dragging')
  }
  
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
}

const handleMouseMove = (e: MouseEvent) => {
  if (!isDragging.value) return
  
  // 使用requestAnimationFrame减少不必要的渲染
  window.requestAnimationFrame(() => {
    const newWidth = e.clientX
    if (newWidth >= 100 && newWidth <= 500) {
      sidebarWidth.value = newWidth
    }
  })
}

const handleMouseUp = () => {
  isDragging.value = false
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  
  // 恢复过渡动画
  const sidebar = document.querySelector('.left-sidebar') as HTMLElement
  if (sidebar) {
    sidebar.classList.remove('dragging')
  }
}

// 右侧边栏方法
const toggleRightSidebar = () => {
  if (isRightSidebarExpanded.value) {
    lastRightSidebarWidth.value = rightSidebarWidth.value
  } else {
    rightSidebarWidth.value = lastRightSidebarWidth.value
  }
  isRightSidebarExpanded.value = !isRightSidebarExpanded.value
}

const handleRightMouseDown = () => {
  if (!isRightSidebarExpanded.value) return
  isRightDragging.value = true
  
  // 在拖动开始时禁用过渡动画，使拖动更流畅
  const sidebar = document.querySelector('.right-sidebar') as HTMLElement
  if (sidebar) {
    sidebar.classList.add('dragging')
  }
  
  document.addEventListener('mousemove', handleRightMouseMove)
  document.addEventListener('mouseup', handleRightMouseUp)
}

const handleRightMouseMove = (e: MouseEvent) => {
  if (!isRightDragging.value) return
  
  // 使用requestAnimationFrame减少不必要的渲染
  window.requestAnimationFrame(() => {
    const newWidth = window.innerWidth - e.clientX
    if (newWidth >= 100 && newWidth <= 500) {
      rightSidebarWidth.value = newWidth
    }
  })
}

const handleRightMouseUp = () => {
  isRightDragging.value = false
  document.removeEventListener('mousemove', handleRightMouseMove)
  document.removeEventListener('mouseup', handleRightMouseUp)
  
  // 恢复过渡动画
  const sidebar = document.querySelector('.right-sidebar') as HTMLElement
  if (sidebar) {
    sidebar.classList.remove('dragging')
  }
}

// 处理右侧边栏分割线拖动
const handleRightSplitMouseDown = (e: MouseEvent) => {
  e.preventDefault()
  isRightSplitDragging.value = true
  
  // 在拖动开始时禁用过渡动画
  const monitorSection = document.querySelector('.monitor-section') as HTMLElement
  const connectionSection = document.querySelector('.connection-section') as HTMLElement
  if (monitorSection) monitorSection.classList.add('dragging')
  if (connectionSection) connectionSection.classList.add('dragging')
  
  document.addEventListener('mousemove', handleRightSplitMouseMove)
  document.addEventListener('mouseup', handleRightSplitMouseUp)
}

const handleRightSplitMouseMove = (e: MouseEvent) => {
  if (!isRightSplitDragging.value) return
  
  // 使用requestAnimationFrame减少不必要的渲染
  window.requestAnimationFrame(() => {
    const sidebarRect = document.querySelector('.right-sidebar-content')?.getBoundingClientRect()
    if (!sidebarRect) return
    
    const offsetY = e.clientY - sidebarRect.top
    const percentage = Math.round((offsetY / sidebarRect.height) * 100)
    
    // 限制拖动范围在20%-80%之间
    if (percentage >= 20 && percentage <= 80) {
      rightSidebarSplitPosition.value = percentage
    }
  })
}

const handleRightSplitMouseUp = () => {
  isRightSplitDragging.value = false
  document.removeEventListener('mousemove', handleRightSplitMouseMove)
  document.removeEventListener('mouseup', handleRightSplitMouseUp)
  
  // 恢复过渡动画
  const monitorSection = document.querySelector('.monitor-section') as HTMLElement
  const connectionSection = document.querySelector('.connection-section') as HTMLElement
  if (monitorSection) monitorSection.classList.remove('dragging')
  if (connectionSection) connectionSection.classList.remove('dragging')
}

// 获取TerminalView组件的引用
const TerminalViewRef = ref<TerminalViewInstance | null>(null)

// 处理标签页变化
const handleTabsChange = (hasTabs: boolean) => {
  hasConnections.value = hasTabs
}

// 处理本地终端请求
const handleOpenLocalTerminal = () => {
  console.log('打开本地终端请求');
  
  // 检查是否已经有终端标签页
  if (hasConnections.value && TerminalViewRef.value?.hasAnyTabs) {
    console.log('已有终端存在，直接添加新标签页');
    TerminalViewRef.value.addLocalTerminal();
    return;
  }
  
  // 首次创建终端 - 先添加标记，防止组件onMounted时重复创建
  console.log('首次创建终端，设置本地终端模式');
  // 添加正在创建的标记，防止TerminalView的onMounted钩子重复创建
  window.localStorage.setItem('terminal_creating', 'true');
  
  isLocalTerminalMode.value = true;
  hasConnections.value = true;
  
  // 确保TerminalView组件已加载并初始化后再创建终端
  setTimeout(() => {
    if (TerminalViewRef.value) {
      console.log('TerminalView组件已初始化，创建新的本地终端标签页');
      TerminalViewRef.value.addLocalTerminal();
      // 创建后清除标记
      window.localStorage.removeItem('terminal_creating');
    } else {
      console.warn('TerminalView组件未初始化，无法创建本地终端标签页');
      // 清除标记，避免残留
      window.localStorage.removeItem('terminal_creating');
    }
  }, 50); // 给予足够的时间让组件挂载和初始化
}

// 处理SSH连接请求
const handleConnectToServer = async (connection: any) => {
  console.log('处理SSH连接请求:', connection.id)
  
  // 不再直接设置activeConnectionId，依赖TerminalView的事件通知
  
  if (!TerminalViewRef.value) {
    hasConnections.value = true
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        if (TerminalViewRef.value) {
          try {
            await TerminalViewRef.value.addSshConnection(connection)
            console.log('SSH连接成功')
            // activeConnectionId.value = connection.id  // 移除这一行
          } catch (error) {
            console.error('SSH连接失败:', error)
          }
        }
        resolve()
      }, 0)
    })
  } else {
    try {
      await TerminalViewRef.value.addSshConnection(connection)
      console.log('SSH连接成功')
      // activeConnectionId.value = connection.id  // 移除这一行
    } catch (error) {
      console.error('SSH连接失败:', error)
    }
  }
}

// 处理活动连接ID变化
const handleActiveConnectionChange = (connectionId: string | null) => {
  console.log('活动连接ID变化:', connectionId)
  activeConnectionId.value = connectionId
}

// 设置对话框状态
const settingsDialogVisible = ref(false)

// 处理设置保存
const handleSaveSettings = async (settings: any) => {
  try {
    const result = await window.api.saveSettings(settings)
    if (result) {
      // 应用设置到当前界面 - 实际应用通过ipcRenderer.on('settings-saved')完成
      console.log('设置保存成功:', settings)
      
      // 显示保存成功提示
      // 这里可以添加一个临时提示元素或使用toast组件
      const toast = document.createElement('div')
      toast.className = 'settings-toast'
      toast.innerText = '设置已保存并应用'
      document.body.appendChild(toast)
      
      // 2秒后移除提示
      setTimeout(() => {
        if (document.body.contains(toast)) {
          document.body.removeChild(toast)
        }
      }, 2000)
    }
  } catch (error) {
    console.error('保存设置失败:', error)
    
    // 显示保存失败提示
    const toast = document.createElement('div')
    toast.className = 'settings-toast error'
    toast.innerText = '设置保存失败'
    document.body.appendChild(toast)
    
    // 2秒后移除提示
    setTimeout(() => {
      if (document.body.contains(toast)) {
        document.body.removeChild(toast)
      }
    }, 2000)
  }
}

// AI助手状态
const isAIAssistantVisible = ref(false)
const toggleAIAssistant = () => {
  isAIAssistantVisible.value = !isAIAssistantVisible.value
}

// 在组件加载后设置键盘快捷键
onMounted(() => {
  // 设置主题切换快捷键
  window.addEventListener('keydown', (e) => {
    // Ctrl+T 切换主题
    if (e.ctrlKey && e.key === 't') {
      toggleTheme()
    }
    
    // Ctrl+L 打开新的本地终端
    if (e.ctrlKey && e.key === 'l') {
      handleOpenLocalTerminal()
    }
    
    // Ctrl+S 打开设置
    if (e.ctrlKey && e.key === 's') {
      settingsDialogVisible.value = true
    }
    
    // Ctrl+A 打开/关闭AI助手
    if (e.ctrlKey && e.key === 'a') {
      toggleAIAssistant()
    }
  })
})
</script>

<template>
  <div class="app-container" :class="{ 'dark-theme': isDarkTheme }">
    <!-- 左侧边栏 -->
    <div
      class="left-sidebar"
      :class="{ 'left-sidebar-collapsed': !isLeftSidebarExpanded }"
      :style="isLeftSidebarExpanded ? { width: sidebarWidth + 'px' } : {}"
    >
      <div class="left-sidebar-toggle" @click="toggleLeftSidebar">
        {{ isLeftSidebarExpanded ? '' : '' }}
      </div>
      
      <!-- 分割线 -->
      <div class="sidebar-separator"></div>
      
      <div class="left-sidebar-content">
        <transition name="fade-slide">
          <div v-show="isLeftSidebarExpanded" class="left-sidebar-items">
            <!-- 文件管理器 -->
            <FileManager
              v-if="activeConnectionId"
              :connection-id="activeConnectionId"
              :is-dark-theme="isDarkTheme"
              key="file-manager"
            />
            <!-- 未连接时的提示 -->
            <div v-else class="no-connection-message">
              <p>请先连接到服务器以查看文件</p>
            </div>
          </div>
        </transition>
      </div>
      
      <div v-show="isLeftSidebarExpanded" class="resize-handle" @mousedown="handleMouseDown"></div>
      
      <!-- 按钮容器 -->
      <div class="sidebar-buttons">
        <!-- 主题切换按钮 -->
        <div class="theme-toggle" @click="toggleTheme">
          <img
            :src="isDarkTheme ? NightIcon : DayIcon"
            :alt="isDarkTheme ? '切换到日间模式' : '切换到夜间模式'"
            class="theme-icon"
          />
        </div>
        <!-- AI助手按钮 -->
        <div class="ai-toggle" @click="toggleAIAssistant">
          <img
            :src="BrainIcon"
            alt="AI助手"
            class="ai-icon"
          />
        </div>
        <!-- 设置按钮 -->
        <div class="settings-toggle" @click="settingsDialogVisible = true">
          <img
            :src="isDarkTheme ? SettingsNightIcon : SettingsDayIcon"
            :alt="'设置'"
            class="settings-icon"
          />
        </div>
      </div>
    </div>

    <!-- 主要内容区域 -->
    <div class="main-area">
      <!-- 没有连接时显示欢迎页 -->
      <Welcome 
        v-if="!hasConnections" 
        :is-dark-theme="isDarkTheme"
        @open-local-terminal="handleOpenLocalTerminal"
      />
      
      <!-- 有连接时显示终端内容 -->
      <TerminalView
        v-else
        ref="TerminalViewRef"
        :is-dark-theme="isDarkTheme"
        :is-local-mode="isLocalTerminalMode"
        @tabs-change="handleTabsChange"
        @active-connection-change="handleActiveConnectionChange"
      />
    </div>

    <!-- 右侧边栏 -->
    <div
      class="right-sidebar"
      :class="{ 'right-sidebar-collapsed': !isRightSidebarExpanded }"
      :style="isRightSidebarExpanded ? { width: rightSidebarWidth + 'px' } : {}"
    >
      <div class="right-sidebar-toggle" @click="toggleRightSidebar">
        {{ isRightSidebarExpanded ? '' : '' }}
      </div>
      <div class="right-sidebar-content">
        <div class="right-sidebar-items">
          <!-- 上半部分：系统监控 -->
          <div 
            class="monitor-section"
            :style="{ height: rightSidebarSplitPosition + '%' }"
          >
            <SystemMonitor 
              :ssh-connection="activeConnectionId ? {
                id: activeConnectionId,
                name: '',
                connectionId: activeConnectionId
              } : null"
            />
          </div>
          
          <!-- 分隔线 -->
          <div 
            class="right-sidebar-splitter"
            @mousedown="handleRightSplitMouseDown"
          ></div>
          
          <!-- 下半部分：连接管理 -->
          <div 
            class="connection-section"
            :style="{ height: (100 - rightSidebarSplitPosition) + '%' }"
          >
            <ConnectionManager 
              :is-dark-theme="isDarkTheme" 
              @connect-to-server="handleConnectToServer"
            />
          </div>
        </div>
      </div>
      <div
        v-show="isRightSidebarExpanded"
        class="resize-handle"
        @mousedown="handleRightMouseDown"
      ></div>
    </div>

    <!-- 将AI助手浮窗移到最后，确保它位于整个应用上方 -->
    <!-- 设置对话框 -->
    <SettingsDialog
      v-model:visible="settingsDialogVisible"
      :is-dark-theme="isDarkTheme"
      @save="handleSaveSettings"
    />
    
    <!-- AI助手浮窗 -->
    <AIAssistant
      v-model:visible="isAIAssistantVisible"
      :is-dark-theme="isDarkTheme"
      @close="isAIAssistantVisible = false"
    />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  margin: 0;
  padding: 0;
  position: fixed;
  top: 0;
  left: 0;
  background-color: #ffffff;
  color: #2c3e50;
  transition:
    background-color 0.3s,
    color 0.3s;
  justify-content: space-between;
  box-sizing: border-box;
}

.app-container.dark-theme {
  background-color: #1a1a1a;
  color: #ffffff;
}

.main-area {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.left-sidebar,
.right-sidebar {
  position: relative;
  width: 250px;
  min-width: 100px;
  max-width: 500px;
  background-color: var(--section-bg);
  color: #333;
  height: 100%;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  z-index: 5;
  transition: all 0.2s ease-in-out;
}

.dark-theme .left-sidebar,
.dark-theme .right-sidebar {
  background-color: #1e1e1e;
  color: #fff;
}

.left-sidebar-content,
.right-sidebar-content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  overflow-x: hidden;
}

/* 按钮容器样式 */
.sidebar-buttons {
  display: flex;
  justify-content: center;
  gap: 8px;
  padding: 10px;
  background-color: var(--section-bg);
}

.dark-theme .sidebar-buttons {
  background-color: #1e1e1e;
}

/* 调整左侧边栏折叠状态下的按钮布局 */
.left-sidebar-collapsed .sidebar-buttons {
  flex-direction: column;
  align-items: center;
  padding: 10px 4px;
}

.left-sidebar-collapsed .sidebar-separator {
  display: none;
}

/* 主题切换按钮样式 */
.theme-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  transition: all 0.2s ease-in-out;
  z-index: 1000;
  position: relative;
  margin-bottom: 10px;
}

.dark-theme .theme-toggle {
  background-color: rgba(255, 255, 255, 0.1);
}

.theme-toggle:hover {
  background-color: rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.dark-theme .theme-toggle:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.theme-toggle::after {
  content: '主题切换';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: -20px;
  font-size: 10px;
  color: var(--text-color-light);
  opacity: 0;
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.theme-toggle:hover::after {
  opacity: 1;
}

.theme-icon {
  width: 22px;
  height: 22px;
  filter: brightness(0.8) contrast(1.2);
}

.dark-theme .theme-icon {
  filter: brightness(1.2) contrast(1.2);
}

/* 设置按钮样式 */
.settings-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  transition: all 0.2s ease-in-out;
  z-index: 1000;
  position: relative;
  margin-bottom: 10px;
}

.dark-theme .settings-toggle {
  background-color: rgba(255, 255, 255, 0.1);
}

.settings-toggle:hover {
  background-color: rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.dark-theme .settings-toggle:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.settings-toggle::after {
  content: '设置';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: -20px;
  font-size: 10px;
  color: var(--text-color-light);
  opacity: 0;
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.settings-toggle:hover::after {
  opacity: 1;
}

.settings-icon {
  width: 22px;
  height: 22px;
  filter: brightness(0.8) contrast(1.2);
}

.dark-theme .settings-icon {
  filter: brightness(1.2) contrast(1.2);
}

/* 调整resize-handle的位置 */
.resize-handle {
  position: absolute;
  top: 0;
  width: 4px;
  height: 100%;
  cursor: ew-resize;
  background-color: transparent;
  transition: background-color 0.2s;
  z-index: 10;
}

.left-sidebar .resize-handle {
  right: 0;
}

.right-sidebar .resize-handle {
  left: 0;
}

.resize-handle:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.dark-theme .resize-handle:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.resize-handle:active {
  background-color: rgba(255, 255, 255, 0.2);
}

/* 折叠状态样式 */
.left-sidebar-collapsed,
.right-sidebar-collapsed {
  width: 40px !important;
  min-width: 40px !important;
  max-width: 40px !important;
  resize: none;
  margin: 0;
  padding: 0;
}

.left-sidebar-collapsed .left-sidebar-content,
.right-sidebar-collapsed .right-sidebar-content {
  display: none;
}

.left-sidebar-toggle,
.right-sidebar-toggle {
  position: absolute;
  width: 10px;
  height: 100px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-color: #a0a0a0;
  color: #333;
  transition: background-color 0.2s;
  z-index: 999;
}

.dark-theme .left-sidebar-toggle,
.dark-theme .right-sidebar-toggle {
  background-color: #535353;
  color: #fff;
}

.left-sidebar-toggle {
  right: -10px;
  border-radius: 0 4px 4px 0;
}

.right-sidebar-toggle {
  left: -10px;
  border-radius: 4px 0 0 4px;
  z-index: 999;
}

/* 确保折叠状态下的右侧切换按钮能够正确显示 */
.right-sidebar-collapsed .right-sidebar-toggle {
  left: -10px;
  position: absolute;
}

/* 确保切换按钮不会被遮挡 */
.right-sidebar {
  position: relative;
  z-index: 10;
}

.left-sidebar-toggle:hover,
.right-sidebar-toggle:hover {
  background-color: #cccbcb;
}

.dark-theme .left-sidebar-toggle:hover,
.dark-theme .right-sidebar-toggle:hover {
  background-color: #888888;
}

.left-sidebar-items {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.right-sidebar-items {
  padding-left: 4px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.right-sidebar-collapsed .right-sidebar-items {
  padding: 0;
  width: 40px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.right-sidebar-collapsed .right-sidebar-content {
  width: 40px;
  height: 100%;
  overflow: visible;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.monitor-section,
.connection-section {
  width: 100%;
  overflow: auto;
  position: relative;
}

.right-sidebar-splitter {
  height: 6px;
  width: 100%;
  background-color: #a0a0a0;
  cursor: ns-resize;
  flex-shrink: 0;
  position: relative;
}

.dark-theme .right-sidebar-splitter {
  background-color: #535353;
}

.right-sidebar-splitter:hover {
  background-color: #cccbcb;
}

.dark-theme .right-sidebar-splitter:hover {
  background-color: #888888;
}

.right-sidebar-collapsed .right-sidebar-items {
  padding: 0;
}

.right-sidebar-collapsed .right-sidebar-content {
  overflow: visible;
}

.left-sidebar-items h3,
.right-sidebar-items h3 {
  margin-top: 0;
  margin-bottom: 20px;
  color: inherit;
}

.left-sidebar-items ul,
.right-sidebar-items ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.left-sidebar-items li,
.right-sidebar-items li {
  margin-bottom: 10px;
}

.left-sidebar-items a,
.right-sidebar-items a {
  color: #333;
  text-decoration: none;
}

.dark-theme .left-sidebar-items a,
.dark-theme .right-sidebar-items a {
  color: white;
}

.left-sidebar-items a:hover,
.right-sidebar-items a:hover {
  text-decoration: underline;
}

/* 保持原有样式 */
.logo {
  height: 6em;
  padding: 1.5em;
  will-change: filter;
  transition: filter 300ms;
}

.logo:hover {
  filter: drop-shadow(0 0 2em #646cffaa);
}

/* 添加过渡动画样式 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease-in-out;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}

.right-sidebar .fade-slide-enter-from,
.right-sidebar .fade-slide-leave-to {
  transform: translateX(20px);
}

/* 确保主内容区域填充可用空间 */
.main-area {
  flex: 1;
  min-width: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.no-connection-message {
  padding: 20px;
  text-align: center;
  color: var(--text-color-light);
  font-size: 14px;
}

.dark-theme .no-connection-message {
  color: #888;
}

/* 调整左侧边栏最小宽度 */
.left-sidebar {
  min-width: 300px;
}

/* 确保文件管理器占满可用空间 */
.left-sidebar-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

/* 分割线样式 */
.sidebar-separator {
  height: 1px;
  background-color: rgba(0, 0, 0, 0.1);
  margin: 0;
  width: 100%;
}

.dark-theme .sidebar-separator {
  background-color: rgba(255, 255, 255, 0.1);
}

/* AI助手按钮样式 */
.ai-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 8px;
  transition: all 0.2s ease-in-out;
  z-index: 1000;
  position: relative;
  margin-bottom: 10px;
}

.dark-theme .ai-toggle {
  background-color: rgba(255, 255, 255, 0.1);
}

.ai-toggle:hover {
  background-color: rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.dark-theme .ai-toggle:hover {
  background-color: rgba(255, 255, 255, 0.2);
}

.ai-toggle::after {
  content: 'AI助手';
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: -20px;
  font-size: 10px;
  color: var(--text-color-light);
  opacity: 0;
  transition: opacity 0.2s ease;
  white-space: nowrap;
}

.ai-toggle:hover::after {
  opacity: 1;
}

.ai-icon {
  width: 22px;
  height: 22px;
  filter: brightness(0.8) contrast(1.2);
}

.dark-theme .ai-icon {
  filter: brightness(1.2) contrast(1.2);
}

/* 设置保存提示样式 */
:global(.settings-toast) {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(76, 175, 80, 0.9);
  color: white;
  padding: 12px 24px;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  box-shadow: 0 3px 10px rgba(0, 0, 0, 0.2);
  z-index: 100000;
  animation: toast-fade-in 0.3s ease-out;
}

:global(.settings-toast.error) {
  background-color: rgba(244, 67, 54, 0.9);
}

@keyframes toast-fade-in {
  from {
    opacity: 0;
    transform: translate(-50%, 20px);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

/* 添加新的CSS类，表示正在拖动时禁用过渡效果 */
.dragging,
.dragging * {
  transition: none !important;
}

/* 右侧边栏分割线样式 */
</style>
