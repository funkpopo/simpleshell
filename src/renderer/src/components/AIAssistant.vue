<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useI18n } from '../i18n'

// 导入图标资源
import minimizeDayIcon from '../assets/minimize-day.svg'
import minimizeNightIcon from '../assets/minimize-night.svg'
import closeDayIcon from '../assets/close-day.svg'
import closeNightIcon from '../assets/close-night.svg'
import settingsDayIcon from '../assets/settings-day.svg'
import settingsNightIcon from '../assets/settings-night.svg'

// 使用i18n
const { t } = useI18n()

// 定义Props
const props = defineProps<{
  visible: boolean
  isDarkTheme: boolean
}>()

// 动态图标计算属性
const minimizeIcon = computed(() => (props.isDarkTheme ? minimizeNightIcon : minimizeDayIcon))
const closeIcon = computed(() => (props.isDarkTheme ? closeNightIcon : closeDayIcon))
const settingsIcon = computed(() => (props.isDarkTheme ? settingsNightIcon : settingsDayIcon))

// 定义事件
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'close'): void
}>()

// 浮窗位置
const posX = ref(window.innerWidth - 350) // 默认放置在右侧
const posY = ref(80) // 距离顶部80px
const startX = ref(0)
const startY = ref(0)
const isDragging = ref(false)
// 标记是否已经加载过位置
const hasLoadedPosition = ref(false)

// 窗口尺寸（仅在开始拖拽时获取一次）
const windowDimensions = ref({
  windowWidth: 0,
  windowHeight: 0,
  floatingWidth: 320,
  floatingHeight: 450
})

// 浮窗状态
const showHistory = ref(false)
const showSettings = ref(false)

// 对话内容
const messages = ref<
  Array<{
    id?: string
    type: 'user' | 'assistant'
    content: string
    timestamp: number
  }>
>([])

// AI设置
const aiSettings = ref({
  apiUrl: '',
  apiKey: '',
  modelName: ''
})

// 自定义模型名称
const customModelName = ref('')

// 是否使用OpenAI
const isUsingOpenAI = computed(() => {
  return !!aiSettings.value.apiKey && !!aiSettings.value.modelName
})

// 用户输入
const userInput = ref('')

// 加载状态
const isLoading = ref(false)
// 当前流式响应的消息ID
const streamingMessageId = ref<string | null>(null)

// 本地存储密钥
const STORAGE_KEY = 'ai_assistant_messages'
const POSITION_STORAGE_KEY = 'ai_assistant_position'

// 浮窗样式
const floatingWindowStyle = computed(() => {
  return {
    transform: `translate3d(${posX.value}px, ${posY.value}px, 0)`,
    // 添加一个过渡效果，但仅在非拖动状态下生效
    transition: isDragging.value ? 'none' : 'transform 0.05s ease'
  }
})

// 开始拖拽
const startDrag = (e: MouseEvent) => {
  // 仅允许通过标题栏拖拽
  if ((e.target as HTMLElement).closest('.window-header')) {
    isDragging.value = true
    startX.value = e.clientX - posX.value
    startY.value = e.clientY - posY.value

    // 获取窗口和浮窗尺寸（只在开始拖拽时获取一次）
    const floatingWindow = document.querySelector('.ai-floating-window') as HTMLElement
    windowDimensions.value = {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      floatingWidth: floatingWindow?.offsetWidth || 320,
      floatingHeight: floatingWindow?.offsetHeight || 450
    }

    // 添加拖拽状态CSS类，用于视觉反馈
    floatingWindow?.classList.add('dragging')

    // 为body添加全局拖动样式
    document.body.classList.add('ai-window-dragging')

    // 阻止事件冒泡和默认行为，防止文本选择等
    e.preventDefault()
    e.stopPropagation()
  }
}

// 拖拽中
const onDrag = (e: MouseEvent) => {
  if (!isDragging.value) return

  // 使用requestAnimationFrame优化动画
  requestAnimationFrame(() => {
    // 计算新位置
    let newX = e.clientX - startX.value
    let newY = e.clientY - startY.value

    const { windowWidth, windowHeight, floatingWidth } = windowDimensions.value

    // 增强的边界检测，确保至少有20px在视口内
    const minVisiblePortion = 40
    newX = Math.max(-floatingWidth + minVisiblePortion, newX)
    newY = Math.max(0, newY)
    newX = Math.min(windowWidth - minVisiblePortion, newX)
    newY = Math.min(windowHeight - minVisiblePortion, newY)

    // 更新位置
    posX.value = newX
    posY.value = newY
  })

  // 阻止事件冒泡和默认行为
  e.preventDefault()
  e.stopPropagation()
}

// 结束拖拽
const endDrag = () => {
  if (isDragging.value) {
    isDragging.value = false

    // 额外的安全检查，确保窗口在可视区域内
    ensureWindowVisible()

    // 保存位置到localStorage
    saveWindowPosition()

    // 移除拖拽状态CSS类
    const floatingWindow = document.querySelector('.ai-floating-window') as HTMLElement
    floatingWindow?.classList.remove('dragging')

    // 移除body上的全局拖动样式
    document.body.classList.remove('ai-window-dragging')

    // 更新窗口尺寸引用为当前尺寸
    windowDimensions.value = {
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      floatingWidth: floatingWindow?.offsetWidth || 320,
      floatingHeight: floatingWindow?.offsetHeight || 450
    }
  }
}

// 确保窗口可见
const ensureWindowVisible = () => {
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight
  const floatingWindow = document.querySelector('.ai-floating-window') as HTMLElement

  if (floatingWindow) {
    const floatingWidth = floatingWindow.offsetWidth
    const floatingHeight = floatingWindow.offsetHeight

    // 确保至少有100px的窗口在视口内
    const minVisiblePortion = 100

    // 检查并修正X位置
    if (posX.value < -floatingWidth + minVisiblePortion) {
      posX.value = -floatingWidth + minVisiblePortion
    } else if (posX.value > windowWidth - minVisiblePortion) {
      posX.value = windowWidth - minVisiblePortion
    }

    // 检查并修正Y位置
    if (posY.value < 0) {
      posY.value = 0
    } else if (posY.value > windowHeight - floatingHeight + minVisiblePortion) {
      posY.value = windowHeight - floatingHeight + minVisiblePortion
    }
  }
}

// 保存窗口位置
const saveWindowPosition = () => {
  try {
    // 确保位置值是有效的数字
    if (isNaN(posX.value) || isNaN(posY.value)) {
      console.error('保存窗口位置失败: 位置值无效', posX.value, posY.value)
      return
    }

    localStorage.setItem(
      POSITION_STORAGE_KEY,
      JSON.stringify({
        x: posX.value,
        y: posY.value
      })
    )

    // 标记已加载位置，防止被默认值覆盖
    hasLoadedPosition.value = true
  } catch (error) {
    console.error('保存窗口位置失败:', error)
  }
}

// 加载窗口位置
const loadWindowPosition = () => {
  try {
    const savedPosition = localStorage.getItem(POSITION_STORAGE_KEY)
    if (savedPosition) {
      const position = JSON.parse(savedPosition)
      posX.value = position.x
      posY.value = position.y

      // 标记已加载位置
      hasLoadedPosition.value = true

      // 确保加载的位置有效且在可视区域内
      setTimeout(ensureWindowVisible, 0)
    }
  } catch (error) {
    console.error('加载窗口位置失败:', error)
  }
}

// 监听窗口大小变化，确保浮窗位置有效
const handleResize = () => {
  // 如果不是正在拖拽，才执行自动调整
  if (!isDragging.value) {
    ensureWindowVisible()
  }
}

// 组件挂载时加载AI设置
onMounted(async () => {
  console.log('组件挂载，初始化事件监听')

  // 优先加载AI设置
  console.log('加载AI设置')
  await loadAISettings()

  // 其他初始化
  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', endDrag)
  window.addEventListener('resize', handleResize)

  // 注册流式输出事件监听
  window.api.onAIStreamUpdate &&
    window.api.onAIStreamUpdate((data) => {
      handleStreamUpdate(data.chunk)
    })

  // 向主进程注册窗口关闭事件监听
  console.log('注册窗口关闭事件监听')
  window.api.onAppClose(async () => {
    console.log('应用关闭，保存窗口位置')
    saveWindowPosition()
  })

  // 加载窗口位置
  console.log('加载窗口位置')
  loadWindowPosition()

  // 如果没有加载到保存的位置，则使用默认位置
  if (!hasLoadedPosition.value) {
    console.log('使用默认窗口位置')
    posX.value = window.innerWidth - 350
    posY.value = 80
  }
})

// 清理全局事件
onUnmounted(() => {
  console.log('组件卸载，清理事件监听')
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', endDrag)
  window.removeEventListener('resize', handleResize)
})

// 切换设置面板
const toggleSettings = (e: MouseEvent) => {
  // 阻止事件冒泡，防止触发拖拽
  e.stopPropagation()
  showSettings.value = !showSettings.value

  // 如果打开设置面板，关闭历史面板
  if (showSettings.value) {
    showHistory.value = false
    loadAISettings()
  }
}

// 最小化窗口
const minimizeWindow = (e: MouseEvent) => {
  // 阻止事件冒泡，防止触发拖拽
  e.stopPropagation()
  emit('update:visible', false)
}

// 关闭窗口
const closeWindow = async (e: MouseEvent) => {
  // 阻止事件冒泡，防止触发拖拽
  e.stopPropagation()

  // 重置消息
  messages.value = []
  localStorage.removeItem(STORAGE_KEY)

  // 发送关闭事件
  emit('update:visible', false)
  emit('close')
}

// 调用OpenAI 兼容API获取回答 - 使用主进程的API
const getAIResponse = async (): Promise<string> => {
  try {
    // 从config.json重新加载设置
    await loadAISettings()

    // 检查设置是否有效
    if (!aiSettings.value.apiKey || !aiSettings.value.modelName) {
      const errorMsg = '请在设置中配置API密钥和模型名称。'
      console.error('AI设置无效:', {
        apiKey: aiSettings.value.apiKey ? '已设置' : '未设置',
        modelName: aiSettings.value.modelName || '未设置',
        error: errorMsg
      })
      return errorMsg
    }

    console.log('使用config.json中的设置发送请求:', {
      apiUrl: aiSettings.value.apiUrl || '未设置',
      apiKeySet: aiSettings.value.apiKey || '未设置',
      modelName: aiSettings.value.modelName || '未设置'
    })

    // 准备消息历史
    const messageHistory = messages.value.map((msg) => ({
      role: msg.type === 'user' ? 'user' : 'assistant',
      content: msg.content
    }))

    // 添加系统消息，但不重复添加用户消息（因为已经在前端添加过了）
    const apiMessages = [{ role: 'system', content: '' }, ...messageHistory]

    // 创建一个空的助手消息用于流式更新
    const assistantMessageId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5)
    messages.value.push({
      id: assistantMessageId,
      type: 'assistant',
      content: '',
      timestamp: Date.now()
    })

    // 设置当前流式消息ID
    streamingMessageId.value = assistantMessageId

    // 滚动到底部
    scrollToBottom()

    // 调用主进程的AI请求接口，使用流式模式
    const response = await window.api.sendAIRequest({
      prompt: '', // 不再传递prompt，因为用户消息已经包含在messageHistory中
      messages: apiMessages,
      apiKey: aiSettings.value.apiKey,
      apiUrl: aiSettings.value.apiUrl,
      modelName: aiSettings.value.modelName,
      stream: true // 启用流式输出
    })

    // 流式输出完成后
    streamingMessageId.value = null

    if (!response.success) {
      console.error('AI请求失败:', {
        error: response.error,
        apiUrl: aiSettings.value.apiUrl,
        modelName: aiSettings.value.modelName
      })

      // 更新错误消息
      const errorIndex = messages.value.findIndex((msg) => msg.id === assistantMessageId)
      if (errorIndex !== -1) {
        messages.value[errorIndex].content = `调用AI服务失败: ${response.error || '未知错误'}`
      }

      return `调用AI服务失败: ${response.error || '未知错误'}`
    }

    console.log('收到AI回答')
    return response.content || '抱歉，我无法生成回答。'
  } catch (error) {
    console.error('调用AI API失败:', error)

    // 如果有流式消息ID，更新错误
    if (streamingMessageId.value) {
      const errorIndex = messages.value.findIndex((msg) => msg.id === streamingMessageId.value)
      if (errorIndex !== -1) {
        messages.value[errorIndex].content =
          `调用AI服务失败: ${error instanceof Error ? error.message : '未知错误'}`
      }
      streamingMessageId.value = null
    }

    return `调用AI服务失败: ${error instanceof Error ? error.message : '未知错误'}`
  }
}

// 处理流式输出更新
const handleStreamUpdate = (chunk: string) => {
  if (!streamingMessageId.value) return

  // 查找当前流式消息
  const messageIndex = messages.value.findIndex((msg) => msg.id === streamingMessageId.value)
  if (messageIndex !== -1) {
    // 追加内容
    messages.value[messageIndex].content += chunk

    // 滚动到底部
    scrollToBottom()
  }
}

// 发送消息
const sendMessage = async () => {
  const message = userInput.value.trim()
  if (!message) return

  // 添加用户消息
  messages.value.push({
    id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
    type: 'user',
    content: message,
    timestamp: Date.now()
  })

  // 清空输入框
  userInput.value = ''

  // 滚动到底部
  scrollToBottom()

  // 设置加载状态
  isLoading.value = true

  try {
    // 检查是否配置了OpenAI
    if (!isUsingOpenAI.value) {
      // 尝试重新加载设置
      await loadAISettings()
    }

    // 再次检查是否配置了OpenAI
    if (isUsingOpenAI.value) {
      // 调用OpenAI API获取回答
      await getAIResponse()
    } else {
      // 添加错误消息
      messages.value.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        type: 'assistant',
        content: '请在设置中配置API密钥和模型名称。',
        timestamp: Date.now()
      })
    }
  } catch (error) {
    console.error('获取AI回答失败:', error)
    // 添加错误消息
    messages.value.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      type: 'assistant',
      content: `抱歉，发生了错误: ${error instanceof Error ? error.message : '未知错误'}`,
      timestamp: Date.now()
    })
  } finally {
    isLoading.value = false
    // 滚动到底部
    scrollToBottom()
  }
}

// 按键事件处理
const handleKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}

// 滚动到底部
const scrollToBottom = () => {
  setTimeout(() => {
    const messageContainer = document.querySelector('.messages-container')
    if (messageContainer) {
      messageContainer.scrollTop = messageContainer.scrollHeight
    }
  }, 50)
}

// 格式化时间戳
const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
}

// 监听可见性变化
watch(
  () => props.visible,
  (newValue) => {
    if (newValue) {
      // 当浮窗显示时，滚动到底部
      scrollToBottom()

      // 如果已经加载过位置，确保窗口在可视区域内
      if (hasLoadedPosition.value) {
        ensureWindowVisible()
      } else {
        // 如果还没有加载过位置，设置默认位置
        posX.value = window.innerWidth - 350
        posY.value = 80
        hasLoadedPosition.value = true
      }
    }
  }
)

// 格式化消息，支持代码块和简单的Markdown
const formatMessage = (content: string): { html: string; safe: boolean } => {
  if (!content) return { html: '', safe: true }

  // 处理代码块: ```code```
  content = content.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<div class="code-block"><pre>${escapeHtml(code.trim())}</pre></div>`
  })

  // 处理行内代码: `code`
  content = content.replace(/`([^`]+)`/g, '<code>$1</code>')

  // 处理换行符
  content = content.replace(/\n/g, '<br>')

  return {
    html: content,
    // 这是一个受控环境，我们只处理特定的格式化，不接受外部输入
    safe: true
  }
}

// HTML转义
const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// 更新自定义模型
const updateCustomModel = () => {
  if (customModelName.value) {
    console.log(`更新自定义模型名称: ${customModelName.value}`)
  }
}

// 加载AI设置
const loadAISettings = async () => {
  try {
    // 通过IPC从主进程获取设置
    const settingsArray = await window.api.loadSettings()
    console.log(
      '从主进程获取到的完整设置:',
      JSON.stringify(
        settingsArray,
        (key, value) => {
          if (key === 'apiKey' && value) return '***'
          return value
        },
        2
      )
    )

    // 获取第一个配置对象
    const settings = Array.isArray(settingsArray) ? settingsArray[0] : settingsArray
    if (!settings) {
      console.warn('未找到有效的设置配置')
      return
    }

    // 从settings中获取aiSettings
    const { aiSettings: configAiSettings } = settings

    if (configAiSettings) {
      // 更新本地设置
      aiSettings.value = {
        apiUrl: configAiSettings.apiUrl || '',
        apiKey: configAiSettings.apiKey || '',
        modelName: configAiSettings.modelName || ''
      }

      console.log('从config.json加载的AI设置:', {
        apiUrl: configAiSettings.apiUrl || '未设置',
        apiKey: configAiSettings.apiKey ? '已设置' : '未设置',
        modelName: configAiSettings.modelName || '未设置'
      })
    } else {
      console.warn('未找到AI设置配置')
    }
  } catch (error) {
    console.error('加载AI设置失败:', error)
  }
}

// 保存AI设置
const saveAISettings = async () => {
  try {
    // 获取当前设置
    const currentSettings = await window.api.loadSettings()

    // 准备新的设置对象
    const settings: AppSettings = {
      ...(Array.isArray(currentSettings) ? currentSettings[0] : currentSettings || {}),
      language: 'zh-CN',
      fontSize: 14,
      fontFamily: 'Roboto',
      terminalFontFamily: 'Consolas, "Courier New", monospace',
      terminalFontSize: 14,
      aiSettings: {
        apiUrl: aiSettings.value.apiUrl || '',
        apiKey: aiSettings.value.apiKey || '',
        modelName: aiSettings.value.modelName || ''
      }
    }

    // 保存到config.json
    await window.api.saveSettings(settings)

    console.log('AI设置已成功保存到config.json')
    showSettings.value = false
  } catch (error) {
    console.error('保存AI设置失败:', error)
  }
}

interface AISettings {
  apiUrl?: string
  apiKey?: string
  modelName?: string
}

interface AppSettings {
  language: string
  fontSize: number
  fontFamily: string
  terminalFontFamily: string
  terminalFontSize: number
  aiSettings?: AISettings
}
</script>

<template>
  <div
    v-if="visible"
    class="ai-floating-window"
    :class="{ 'dark-theme': isDarkTheme }"
    :style="floatingWindowStyle"
  >
    <!-- 窗口头部 -->
    <div class="window-header" @mousedown="startDrag">
      <div class="window-title">{{ t('aiAssistant.title') }}</div>
      <div class="window-controls">
        <button class="window-btn settings-btn" @click="(e) => toggleSettings(e)">
          <img :src="settingsIcon" alt="Settings" width="16" height="16" />
        </button>
        <button class="window-btn minimize-btn" @click="(e) => minimizeWindow(e)">
          <img :src="minimizeIcon" alt="Minimize" width="16" height="16" />
        </button>
        <button class="window-close" @click="(e) => closeWindow(e)">
          <img :src="closeIcon" alt="Close" width="16" height="16" />
        </button>
      </div>
    </div>

    <!-- 设置面板 -->
    <Transition name="settings-panel">
      <div v-if="showSettings" class="settings-panel">
        <div class="settings-header">
          <h3>{{ t('aiAssistant.settingsTitle') || 'AI设置' }}</h3>
        </div>

        <div class="settings-content">
          <div class="settings-group">
            <label for="api-url">{{ t('aiAssistant.apiUrl') || 'API URL' }}</label>
            <input
              id="api-url"
              v-model="aiSettings.apiUrl"
              type="text"
              class="settings-input"
              :placeholder="t('aiAssistant.apiUrlPlaceholder') || '请输入API URL'"
            />
          </div>

          <div class="settings-group">
            <label for="api-key">{{ t('aiAssistant.apiKey') || 'API Key' }}</label>
            <input
              id="api-key"
              v-model="aiSettings.apiKey"
              type="password"
              class="settings-input"
              :placeholder="t('aiAssistant.apiKeyPlaceholder') || '请输入API Key'"
            />
          </div>

          <div class="settings-group">
            <label for="custom-model">{{ t('aiAssistant.customModel') || '自定义模型名称' }}</label>
            <input
              id="custom-model"
              v-model="aiSettings.modelName"
              type="text"
              class="settings-input"
              :placeholder="t('aiAssistant.customModelPlaceholder') || '请输入自定义模型名称'"
              @input="updateCustomModel"
            />
          </div>

          <div class="openai-status">
            <div class="status-indicator" :class="{ active: isUsingOpenAI }"></div>
            <span>{{ isUsingOpenAI ? 'AI接口已配置' : 'AI接口未配置' }}</span>
          </div>

          <div class="settings-actions">
            <button class="settings-save-btn" @click="saveAISettings">
              {{ t('aiAssistant.save') || '保存' }}
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 消息容器，最小化时隐藏 -->
    <div class="messages-container">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message-bubble"
        :class="{
          'user-message': message.type === 'user',
          'assistant-message': message.type === 'assistant'
        }"
      >
        <!-- 用户消息 -->
        <div v-if="message.type === 'user'" class="message-content">
          {{ message.content }}
        </div>

        <!-- AI消息，支持格式化 -->
        <div v-else class="message-content formatted-content">
          <!-- 使用安全的方式渲染格式化内容 -->
          <div
            v-if="formatMessage(message.content).safe"
            :innerHTML="formatMessage(message.content).html"
          ></div>
          <div v-else>{{ message.content }}</div>
        </div>

        <div class="message-timestamp">{{ formatTimestamp(message.timestamp) }}</div>
      </div>

      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-indicator">
        <div class="dot"></div>
        <div class="dot"></div>
        <div class="dot"></div>
      </div>
    </div>

    <!-- 输入区域，最小化时隐藏 -->
    <div class="input-container">
      <textarea
        v-model="userInput"
        class="message-input"
        :placeholder="t('aiAssistant.inputPlaceholder')"
        :disabled="isLoading"
        @keydown="handleKeyDown"
      ></textarea>
      <button class="send-button" :disabled="!userInput.trim() || isLoading" @click="sendMessage">
        {{ t('aiAssistant.send') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* 全局样式，防止拖动过程中的干扰 */
:root {
  /* 拖动过程中应用的全局样式 */
  --dragging-cursor: move;
}

body.ai-window-dragging {
  cursor: var(--dragging-cursor) !important;
  user-select: none !important;
}

/* 组件特定样式 */
.ai-floating-window {
  position: fixed;
  width: 320px;
  height: 450px;
  background-color: white;
  border-radius: 10px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 9999;
  transition:
    transform 0.05s ease,
    box-shadow 0.2s ease;
  border: 1px solid #e0e0e0;
  top: 0;
  left: 0;
  will-change: transform;
}

/* 拖动状态样式 */
.ai-floating-window.dragging {
  transition: none !important; /* 拖动时禁用所有过渡效果，使移动更流畅 */
  opacity: 0.95; /* 轻微透明以提供视觉反馈 */
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.25); /* 增强阴影 */
  cursor: move; /* 显示移动光标 */
  user-select: none; /* 防止文本选择 */
}

.ai-floating-window.dark-theme {
  background-color: #272727;
  border: 1px solid #444;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
}

.ai-floating-window.dark-theme.dragging {
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.4); /* 暗色主题下的增强阴影 */
}

.window-header {
  padding: 12px 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: #f5f5f5;
  border-bottom: 1px solid #e0e0e0;
  cursor: move;
  user-select: none;
  min-height: 48px;
  box-sizing: border-box;
}

.dark-theme .window-header {
  background-color: #333;
  border-bottom: 1px solid #444;
}

.window-title {
  font-weight: 500;
  font-size: 14px;
  color: #333;
}

.dark-theme .window-title {
  color: #eee;
}

.window-controls {
  display: flex;
  gap: 5px;
  align-items: center;
}

.window-btn,
.window-close {
  background: none;
  border: none;
  height: 24px;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s;
  position: relative; /* 添加相对定位，便于处理点击事件 */
  z-index: 10; /* 确保按钮在拖动区域上层 */
}

.window-btn:hover {
  background-color: rgba(0, 0, 0, 0.1);
}

.dark-theme .window-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.window-btn img {
  width: 16px;
  height: 16px;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.window-btn:hover img {
  opacity: 1;
}

.window-close {
  background: none;
  border: none;
  height: 24px;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  cursor: pointer;
  padding: 0;
  transition: all 0.2s;
}

.window-close:hover {
  background-color: rgba(244, 67, 54, 0.1);
}

.window-close img {
  width: 16px;
  height: 16px;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.window-close:hover img {
  opacity: 1;
}

.dark-theme .window-close:hover {
  background-color: rgba(244, 67, 54, 0.2);
}

/* 历史记录面板样式 */
.history-panel {
  position: absolute;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: white;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideIn 0.2s ease-out;
  border-top: 1px solid #e0e0e0;
}

.dark-theme .history-panel {
  background-color: #272727;
  border-top: 1px solid #444;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.history-header {
  padding: 12px 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e0e0e0;
}

.dark-theme .history-header {
  border-bottom: 1px solid #444;
}

.history-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.dark-theme .history-header h3 {
  color: #eee;
}

.new-chat-btn {
  padding: 5px 10px;
  background-color: #4d90fe;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.new-chat-btn:hover {
  background-color: #357ae8;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.new-chat-btn:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}

.dark-theme .new-chat-btn {
  background-color: #1a73e8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.dark-theme .new-chat-btn:hover {
  background-color: #1967d2;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
}

.icon-plus {
  font-size: 14px;
  font-weight: bold;
  line-height: 1;
  margin-top: -2px;
}

.history-item-title {
  font-size: 13px;
  font-weight: 500;
  color: #444;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 5px;
}

.dark-theme .history-item-title {
  color: #eee;
}

.history-icon {
  font-size: 12px;
  line-height: 1;
  opacity: 0.7;
}

.date-icon {
  font-size: 10px;
  opacity: 0.7;
  margin-right: 3px;
}

.history-item-date {
  font-size: 11px;
  color: #999;
  display: flex;
  align-items: center;
}

.dark-theme .history-item-date {
  color: #777;
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 20px;
  gap: 10px;
  text-align: center;
}

.empty-icon {
  font-size: 32px;
  margin-bottom: 10px;
  opacity: 0.6;
}

.start-btn {
  margin-top: 15px;
  padding: 8px 16px;
  background-color: #4d90fe;
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.25s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.start-btn:hover {
  background-color: #357ae8;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
}

.start-btn:active {
  transform: translateY(0);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.dark-theme .start-btn {
  background-color: #1a73e8;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

.dark-theme .start-btn:hover {
  background-color: #1967d2;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.4);
}

.history-list {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

.dark-theme .history-list {
  scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
}

.history-list::-webkit-scrollbar {
  width: 5px;
}

.history-list::-webkit-scrollbar-track {
  background: transparent;
}

.history-list::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
  transition: all 0.3s ease;
}

.history-list::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.4);
}

.dark-theme .history-list::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.15);
}

.dark-theme .history-list::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

.history-item {
  padding: 10px 12px;
  margin-bottom: 6px;
  background-color: #f5f5f5;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
  border: 1px solid transparent;
}

.history-item:last-child {
  margin-bottom: 0;
}

.history-item:hover {
  background-color: #e8e8e8;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.history-item.active {
  background-color: rgba(77, 144, 254, 0.1);
  border: 1px solid rgba(77, 144, 254, 0.5);
}

.dark-theme .history-item {
  background-color: #333;
}

.dark-theme .history-item:hover {
  background-color: #3a3a3a;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.dark-theme .history-item.active {
  background-color: rgba(26, 115, 232, 0.2);
  border: 1px solid rgba(26, 115, 232, 0.5);
}

.history-item-content {
  flex: 1;
  min-width: 0;
  padding-right: 10px;
}

.history-item-preview {
  font-size: 12px;
  color: #777;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 4px;
  max-height: 35px;
}

.dark-theme .history-item-preview {
  color: #aaa;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  scrollbar-width: thin;
  scrollbar-color: rgba(0, 0, 0, 0.2) transparent;
}

.messages-container::-webkit-scrollbar {
  width: 5px;
}

.messages-container::-webkit-scrollbar-track {
  background: transparent;
}

.messages-container::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 10px;
}

.dark-theme .messages-container::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
}

.message-bubble {
  max-width: 80%;
  padding: 10px 12px;
  border-radius: 8px;
  position: relative;
  line-height: 1.4;
  font-size: 14px;
  word-break: break-word;
}

.user-message {
  background-color: #e3f2fd;
  color: #0d47a1;
  align-self: flex-end;
  border-bottom-right-radius: 2px;
}

.assistant-message {
  background-color: #f5f5f5;
  color: #333;
  align-self: flex-start;
  border-bottom-left-radius: 2px;
}

.dark-theme .user-message {
  background-color: #1565c0;
  color: #fff;
}

.dark-theme .assistant-message {
  background-color: #424242;
  color: #eee;
}

.message-timestamp {
  font-size: 10px;
  opacity: 0.7;
  margin-top: 4px;
  text-align: right;
}

.input-container {
  padding: 10px;
  border-top: 1px solid #e0e0e0;
  display: flex;
  gap: 8px;
}

.dark-theme .input-container {
  border-top: 1px solid #444;
}

.message-input {
  flex: 1;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 14px;
  resize: none;
  height: 60px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.message-input:focus {
  border-color: #2196f3;
}

.dark-theme .message-input {
  background-color: #333;
  border-color: #555;
  color: #eee;
}

.dark-theme .message-input:focus {
  border-color: #1a73e8;
}

.send-button {
  align-self: flex-end;
  background-color: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 8px 15px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
  height: 34px;
}

.send-button:hover:not(:disabled) {
  background-color: #1976d2;
}

.send-button:disabled {
  background-color: #bbdefb;
  cursor: not-allowed;
}

.dark-theme .send-button {
  background-color: #1a73e8;
}

.dark-theme .send-button:hover:not(:disabled) {
  background-color: #1565c0;
}

.dark-theme .send-button:disabled {
  background-color: #444;
  opacity: 0.6;
}

/* 加载指示器 */
.loading-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px;
  align-self: flex-start;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #bdbdbd;
  animation: pulse 1.5s infinite ease-in-out;
}

.dark-theme .dot {
  background-color: #757575;
}

.dot:nth-child(1) {
  animation-delay: 0s;
}

.dot:nth-child(2) {
  animation-delay: 0.3s;
}

.dot:nth-child(3) {
  animation-delay: 0.6s;
}

@keyframes pulse {
  0%,
  100% {
    transform: scale(0.7);
    opacity: 0.5;
  }
  50% {
    transform: scale(1);
    opacity: 1;
  }
}

/* 添加格式化内容样式 */
.formatted-content :deep(code) {
  background-color: rgba(0, 0, 0, 0.1);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: monospace;
  font-size: 90%;
}

.dark-theme .formatted-content :deep(code) {
  background-color: rgba(255, 255, 255, 0.1);
}

.formatted-content :deep(.code-block) {
  background-color: rgba(0, 0, 0, 0.1);
  border-radius: 6px;
  margin: 8px 0;
  overflow-x: auto;
}

.dark-theme .formatted-content :deep(.code-block) {
  background-color: rgba(255, 255, 255, 0.1);
}

.formatted-content :deep(pre) {
  padding: 10px;
  margin: 0;
  font-family: monospace;
  font-size: 13px;
  white-space: pre-wrap;
  word-break: break-all;
}

/* 添加进入离开过渡效果 */
.history-panel-enter-active,
.history-panel-leave-active {
  transition: all 0.25s ease-out;
}

.history-panel-enter-from,
.history-panel-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

/* 设置面板过渡效果 */
.settings-panel-enter-active,
.settings-panel-leave-active {
  transition: all 0.25s ease-out;
}

.settings-panel-enter-from,
.settings-panel-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

/* 历史记录项目动画 */
.history-list .history-item {
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  animation: fadeIn 0.25s forwards;
  animation-delay: calc(var(--index, 0) * 0.05s);
  opacity: 0;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 设置面板样式 */
.settings-panel {
  position: absolute;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: white;
  z-index: 10;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: slideIn 0.2s ease-out;
  border-top: 1px solid #e0e0e0;
}

.dark-theme .settings-panel {
  background-color: #272727;
  border-top: 1px solid #444;
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.settings-header {
  padding: 12px 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e0e0e0;
}

.dark-theme .settings-header {
  border-bottom: 1px solid #444;
}

.settings-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: #333;
}

.dark-theme .settings-header h3 {
  color: #eee;
}

.settings-content {
  padding: 15px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.settings-group label {
  font-weight: 500;
  font-size: 12px;
  color: #333;
}

.dark-theme .settings-group label {
  color: #eee;
}

.settings-input {
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  padding: 8px 10px;
  font-size: 14px;
  resize: none;
  height: 40px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.2s;
}

.settings-input:focus {
  border-color: #2196f3;
}

.dark-theme .settings-input {
  background-color: #333;
  border-color: #555;
  color: #eee;
}

.settings-input:focus {
  border-color: #1a73e8;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.settings-save-btn {
  padding: 8px 15px;
  background-color: #2196f3;
  color: white;
  border: none;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.settings-save-btn:hover:not(:disabled) {
  background-color: #1976d2;
}

.settings-save-btn:disabled {
  background-color: #bbdefb;
  cursor: not-allowed;
}

.dark-theme .settings-save-btn {
  background-color: #1a73e8;
}

.dark-theme .settings-save-btn:hover:not(:disabled) {
  background-color: #1565c0;
}

.dark-theme .settings-save-btn:disabled {
  background-color: #444;
  opacity: 0.6;
}

.history-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 20px;
  color: #999;
  font-size: 13px;
  text-align: center;
  font-style: italic;
}

.dark-theme .history-empty {
  color: #777;
}

/* 添加OpenAI状态指示器样式 */
.openai-status {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #666;
}

.dark-theme .openai-status {
  color: #aaa;
}

.status-indicator {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: #ccc;
  transition: all 0.3s ease;
}

.status-indicator.active {
  background-color: #4caf50;
  box-shadow: 0 0 5px rgba(76, 175, 80, 0.5);
}

.dark-theme .status-indicator {
  background-color: #555;
}

.dark-theme .status-indicator.active {
  background-color: #4caf50;
  box-shadow: 0 0 5px rgba(76, 175, 80, 0.7);
}

.openai-badge {
  padding: 3px 6px;
  background-color: #4caf50;
  color: white;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  margin-left: 8px;
  align-self: center;
}

.dark-theme .openai-badge {
  background-color: #2e7d32;
}

/* 添加下拉菜单样式 */
.settings-select {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  font-size: 14px;
  background-color: white;
  height: 40px;
  outline: none;
  transition: border-color 0.2s;
}

.settings-select:focus {
  border-color: #2196f3;
}

.dark-theme .settings-select {
  background-color: #333;
  border-color: #555;
  color: #eee;
}

.dark-theme .settings-select:focus {
  border-color: #1a73e8;
}

.settings-hint {
  font-size: 12px;
  color: #777;
  margin-top: 4px;
}

.dark-theme .settings-hint {
  color: #aaa;
}
</style>
