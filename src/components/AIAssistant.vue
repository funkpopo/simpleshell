<template>
  <div 
    v-if="!isMinimized"
    class="ai-window"
    :style="{ 
      transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      transition: isDragging ? 'none' : 'transform 0.3s ease',
      width: `${windowSize.width}px`,
      height: `${windowSize.height}px`
    }"
  >
    <div 
      class="ai-window-header"
      @mousedown="startDrag"
    >
      <span class="ai-window-title">AI Assistant</span>
      <div class="ai-window-controls">
        <a-button
          type="text"
          class="control-btn"
          @click="showSettings"
        >
          <template #icon>
            <icon-settings />
          </template>
        </a-button>
        <a-button
          type="text"
          class="control-btn"
          @click="minimize"
        >
          <template #icon>
            <icon-minus />
          </template>
        </a-button>
        <a-button
          type="text"
          class="control-btn"
          @click="close"
        >
          <template #icon>
            <icon-close />
          </template>
        </a-button>
      </div>
    </div>
    <div class="ai-window-content">
      <!-- AI 助手的内容 -->
    </div>
    <!-- 添加调整大小的手柄 -->
    <div class="resize-handle resize-right" @mousedown.stop="startResize('right')"></div>
    <div class="resize-handle resize-bottom" @mousedown.stop="startResize('bottom')"></div>
    <div class="resize-handle resize-corner" @mousedown.stop="startResize('corner')"></div>

    <!-- AI 设置对话框 -->
    <a-modal
      v-model:visible="settingsVisible"
      title="AI Assistant Settings"
      @cancel="closeSettings"
      @ok="saveSettings"
      :mask-closable="false"
      :closable="true"
      class="ai-settings-modal"
    >
      <a-form :model="aiSettings" layout="vertical">
        <a-form-item label="API Key">
          <a-input-password v-model="aiSettings.apiKey" allow-clear />
        </a-form-item>
        
        <a-form-item label="API Proxy">
          <a-input v-model="aiSettings.apiProxy" placeholder="https://api.example.com" allow-clear />
        </a-form-item>
        
        <a-form-item label="Model">
          <a-select v-model="aiSettings.model">
            <a-option value="gpt-3.5-turbo">GPT-3.5 Turbo</a-option>
            <a-option value="gpt-4">GPT-4</a-option>
          </a-select>
        </a-form-item>
        
        <a-form-item label="Temperature">
          <a-slider
            v-model="aiSettings.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            show-ticks
          />
        </a-form-item>
        
        <a-form-item label="Max Tokens">
          <a-input-number
            v-model="aiSettings.maxTokens"
            :min="1"
            :max="4096"
            :step="1"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>

  <!-- 最小化后的浮动按钮 -->
  <div 
    v-else
    class="ai-float-button"
    @click="restore"
  >
    <img :src="aiIcon" alt="AI" class="ai-float-icon" />
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted } from 'vue'
import { IconMinus, IconClose, IconSettings } from '@arco-design/web-vue/es/icon'
import { Message } from '@arco-design/web-vue'
import aiIcon from '@/assets/aiicon.png'
import { ipcRenderer } from 'electron'

export default {
  name: 'AIAssistant',
  components: {
    IconMinus,
    IconClose,
    IconSettings
  },
  emits: ['close', 'minimize'],
  setup(props, { emit }) {
    const position = ref({ x: 100, y: 100 })
    const isMinimized = ref(false)
    const isDragging = ref(false)
    const isResizing = ref(false)
    const resizeType = ref('')
    let dragOffset = { x: 0, y: 0 }
    let startSize = { width: 0, height: 0 }
    let startPos = { x: 0, y: 0 }

    const windowSize = ref({
      width: 400,
      height: 600,
      minWidth: 200,
      minHeight: 40,
      maxWidth: 800,
      maxHeight: window.innerHeight
    })

    // 添加设置相关的状态
    const settingsVisible = ref(false)
    const aiSettings = ref({
      apiKey: '',
      apiProxy: '',
      model: 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 2048
    })

    // 获取应用窗口尺寸
    const getWindowBounds = () => {
      const bounds = {
        width: window.innerWidth,
        height: window.innerHeight
      }
      return bounds
    }

    // 确保窗口在可视区域内
    const keepInBounds = (x, y, width, height) => {
      const bounds = getWindowBounds()
      return {
        x: Math.min(Math.max(0, x), bounds.width - width),
        y: Math.min(Math.max(0, y), bounds.height - height)
      }
    }

    const startDrag = (e) => {
      isDragging.value = true
      dragOffset = {
        x: e.clientX - position.value.x,
        y: e.clientY - position.value.y
      }
      document.addEventListener('mousemove', handleDrag, { passive: true })
      document.addEventListener('mouseup', stopDrag)
    }

    const handleDrag = (e) => {
      if (!isDragging.value) return
      requestAnimationFrame(() => {
        const newPos = keepInBounds(
          e.clientX - dragOffset.x,
          e.clientY - dragOffset.y,
          windowSize.value.width,
          windowSize.value.height
        )
        position.value = newPos
      })
    }

    const stopDrag = () => {
      isDragging.value = false
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', stopDrag)
    }

    const startResize = (type) => {
      isResizing.value = true
      resizeType.value = type
      startSize = {
        width: windowSize.value.width,
        height: windowSize.value.height
      }
      startPos = {
        x: position.value.x,
        y: position.value.y
      }
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', stopResize)
      document.body.style.cursor = 
        type === 'right' ? 'ew-resize' :
        type === 'bottom' ? 'ns-resize' :
        'nwse-resize'
    }

    const handleResize = (e) => {
      if (!isResizing.value) return
      requestAnimationFrame(() => {
        const dx = e.clientX - (startPos.x + startSize.width)
        const dy = e.clientY - (startPos.y + startSize.height)
        
        let newWidth = startSize.width
        let newHeight = startSize.height

        if (resizeType.value === 'right' || resizeType.value === 'corner') {
          newWidth = Math.min(
            Math.max(windowSize.value.minWidth, startSize.width + dx),
            Math.min(windowSize.value.maxWidth, window.innerWidth - position.value.x)
          )
        }
        
        if (resizeType.value === 'bottom' || resizeType.value === 'corner') {
          newHeight = Math.min(
            Math.max(windowSize.value.minHeight, startSize.height + dy),
            Math.min(windowSize.value.maxHeight, window.innerHeight - position.value.y)
          )
        }

        windowSize.value = {
          ...windowSize.value,
          width: newWidth,
          height: newHeight
        }
      })
    }

    const stopResize = () => {
      isResizing.value = false
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', stopResize)
      document.body.style.cursor = ''
    }

    const minimize = () => {
      isMinimized.value = true
      emit('minimize')
    }

    const restore = () => {
      isMinimized.value = false
      // 确保窗口在可视区域内
      const newPos = keepInBounds(
        position.value.x,
        position.value.y,
        windowSize.value.width,
        windowSize.value.height
      )
      position.value = newPos
    }

    const close = () => {
      isMinimized.value = false
      emit('close')
    }

    const updateMaxDimensions = () => {
      windowSize.value = {
        ...windowSize.value,
        maxHeight: window.innerHeight
      }
      // 确保当前尺寸不超过新的最大值
      if (windowSize.value.height > window.innerHeight) {
        windowSize.value.height = window.innerHeight
      }
    }

    // 显示设置对话框
    const showSettings = () => {
      settingsVisible.value = true
    }

    // 关闭设置对话框
    const closeSettings = () => {
      settingsVisible.value = false
    }

    // 保存设置
    const saveSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const aiSettingsIndex = config.findIndex(item => item.type === 'aisettings')
        
        const aiSettingsData = {
          type: 'aisettings',
          apiKey: aiSettings.value.apiKey,
          apiProxy: aiSettings.value.apiProxy,
          model: aiSettings.value.model,
          temperature: aiSettings.value.temperature,
          maxTokens: aiSettings.value.maxTokens
        }
        
        if (aiSettingsIndex !== -1) {
          config[aiSettingsIndex] = aiSettingsData
        } else {
          config.push(aiSettingsData)
        }
        
        await ipcRenderer.invoke('save-config', config)
        Message.success('Settings saved successfully')
        settingsVisible.value = false
      } catch (error) {
        console.error('Failed to save AI settings:', error)
        Message.error('Failed to save settings')
      }
    }

    // 加载设置
    const loadSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const settings = config.find(item => item.type === 'aisettings')
        
        if (settings) {
          aiSettings.value = {
            apiKey: settings.apiKey || '',
            apiProxy: settings.apiProxy || '',
            model: settings.model || 'gpt-3.5-turbo',
            temperature: settings.temperature || 0.7,
            maxTokens: settings.maxTokens || 2048
          }
        }
      } catch (error) {
        console.error('Failed to load AI settings:', error)
      }
    }

    onMounted(() => {
      loadSettings()
      // 初始化窗口位置在可视区域内
      const bounds = getWindowBounds()
      position.value = {
        x: (bounds.width - windowSize.value.width) / 2,
        y: (bounds.height - windowSize.value.height) / 2
      }

      // 监听窗口大小变化
      window.addEventListener('resize', updateMaxDimensions)
    })

    onUnmounted(() => {
      window.removeEventListener('resize', updateMaxDimensions)
    })

    return {
      position,
      isMinimized,
      isDragging,
      windowSize,
      startDrag,
      minimize,
      restore,
      close,
      aiIcon,
      startResize,
      settingsVisible,
      aiSettings,
      showSettings,
      closeSettings,
      saveSettings
    }
  }
}
</script>

<style scoped>
.ai-window {
  position: fixed;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  z-index: 1000;
  will-change: transform;
  backface-visibility: hidden;
  transform-style: preserve-3d;
  touch-action: none;
  resize: none;
}

.ai-window-header {
  height: 40px;
  min-height: 40px;
  flex-shrink: 0;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  cursor: move;
  user-select: none;
  background: var(--color-bg-2);
  border-radius: 8px 8px 0 0;
}

.ai-window-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
}

.ai-window-controls {
  display: flex;
  gap: 4px;
}

.control-btn {
  padding: 4px;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.control-btn:hover {
  background-color: var(--color-fill-3);
  border-radius: 4px;
}

.ai-window-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px;
}

/* 调整大小的手柄 */
.resize-handle {
  position: absolute;
  background: transparent;
}

.resize-right {
  right: -4px;
  top: 0;
  width: 8px;
  height: 100%;
  cursor: ew-resize;
}

.resize-bottom {
  bottom: -4px;
  left: 0;
  height: 8px;
  width: 100%;
  cursor: ns-resize;
}

.resize-corner {
  right: -4px;
  bottom: -4px;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
}

/* 浮动按钮样式 */
.ai-float-button {
  position: fixed;
  left: 20px;
  bottom: 20px;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: var(--color-bg-2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 1000;
  transition: all 0.3s ease;
  border: 1px solid var(--color-border);
}

.ai-float-button:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
}

.ai-float-icon {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

/* 添加动画效果 */
.ai-float-button {
  animation: float-in 0.3s ease;
}

@keyframes float-in {
  from {
    transform: translateY(100%) scale(0.8);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}

/* 添加设置对话框相关样式 */
.ai-settings-modal {
  width: 500px;
}

:deep(.arco-form-item) {
  margin-bottom: 24px;
}

:deep(.arco-slider) {
  width: 100%;
}

:deep(.arco-input-number) {
  width: 100%;
}

/* 移除滑块相关样式 */
.slider-with-values {
  display: none;
}

.slider-value {
  display: none;
}

.current-value {
  display: none;
}
</style> 