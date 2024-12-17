<template>
  <div 
    v-if="!isMinimized"
    class="tools-window"
    :style="{ 
      transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      transition: isDragging ? 'none' : 'transform 0.2s ease',
      width: `${windowSize.width}px`,
      height: `${windowSize.height}px`
    }"
  >
    <!-- 窗口标题栏 -->
    <div 
      class="tools-window-header"
      @mousedown="startDrag"
    >
      <div class="header-left">
        <span class="tools-window-title">{{ $t('tools.title') }}</span>
      </div>
      <div class="tools-window-controls">
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

    <!-- 工具内容区域 -->
    <div class="tools-window-content">
      <a-tabs v-model:activeKey="activeTab">
        <!-- IP查询工具 -->
        <a-tab-pane key="ipQuery" :title="$t('tools.ipQuery.title')">
          <div class="tool-content">
            <a-input
              v-model="ipAddress"
              :placeholder="$t('tools.ipQuery.placeholder')"
              allow-clear
            >
              <template #append>
                <a-button 
                  type="primary" 
                  @click="queryIP"
                  :loading="isQuerying"
                >
                  {{ $t('tools.ipQuery.query') }}
                </a-button>
              </template>
            </a-input>
            
            <div v-if="ipInfo" class="ip-info">
              <a-descriptions :column="1" bordered>
                <a-descriptions-item :label="$t('tools.ipQuery.ip')">
                  {{ ipInfo.ip }}
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.country')">
                  {{ ipInfo.country }} ({{ ipInfo.country_code }})
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.region')">
                  {{ ipInfo.region }}
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.city')">
                  {{ ipInfo.city }}
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.postal')" v-if="ipInfo.postal">
                  {{ ipInfo.postal }}
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.isp')">
                  {{ ipInfo.isp }}
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.timezone')">
                  {{ ipInfo.timezone }}
                </a-descriptions-item>
                <a-descriptions-item :label="$t('tools.ipQuery.location')" v-if="ipInfo.latitude && ipInfo.longitude">
                  <a-link 
                    href="#" 
                    @click.prevent="openMap(ipInfo.latitude, ipInfo.longitude)"
                  >
                    {{ ipInfo.latitude }}, {{ ipInfo.longitude }}
                  </a-link>
                </a-descriptions-item>
              </a-descriptions>
            </div>
          </div>
        </a-tab-pane>

        <!-- 密码生成器 -->
        <a-tab-pane key="passwordGen" :title="$t('tools.passwordGen.title')">
          <div class="tool-content">
            <div class="password-options">
              <a-form :model="passwordOptions" layout="vertical">
                <a-form-item>
                  <template #label>
                    <div class="length-label">
                      <span>{{ $t('tools.passwordGen.length') }}</span>
                      <span class="length-value">{{ passwordOptions.length }}</span>
                    </div>
                  </template>
                  <a-slider
                    v-model="passwordOptions.length"
                    :min="8"
                    :max="64"
                    :step="1"
                  />
                </a-form-item>
                <a-form-item>
                  <a-space direction="vertical">
                    <a-checkbox v-model="passwordOptions.uppercase">
                      {{ $t('tools.passwordGen.uppercase') }}
                    </a-checkbox>
                    <a-checkbox v-model="passwordOptions.lowercase">
                      {{ $t('tools.passwordGen.lowercase') }}
                    </a-checkbox>
                    <a-checkbox v-model="passwordOptions.numbers">
                      {{ $t('tools.passwordGen.numbers') }}
                    </a-checkbox>
                    <a-checkbox v-model="passwordOptions.symbols">
                      {{ $t('tools.passwordGen.symbols') }}
                    </a-checkbox>
                  </a-space>
                </a-form-item>
              </a-form>
            </div>

            <div class="password-result">
              <a-input-group compact>
                <a-input
                  v-model="generatedPassword"
                  readonly
                  :style="{ width: 'calc(100% - 90px)' }"
                />
                <a-button type="primary" @click="generatePassword">
                  {{ $t('tools.passwordGen.generate') }}
                </a-button>
              </a-input-group>
              <a-button 
                v-if="generatedPassword"
                type="text"
                class="copy-button"
                @click="copyPassword"
              >
                <template #icon>
                  <icon-copy />
                </template>
                {{ $t('tools.passwordGen.copy') }}
              </a-button>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 调整大小的手柄 -->
    <div class="resize-handle resize-right" @mousedown.stop="startResize('right')"></div>
    <div class="resize-handle resize-bottom" @mousedown.stop="startResize('bottom')"></div>
    <div class="resize-handle resize-corner" @mousedown.stop="startResize('corner')"></div>
  </div>

  <!-- 最小化后的浮动按钮 -->
  <div 
    v-if="isMinimized"
    class="tools-float-button"
    @click="restore"
    :style="{ 
      '--position-offset': `${positionIndex * 60}px`
    }"
  >
    <icon-tool />
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, watch, inject } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconMinus, IconClose, IconTool, IconCopy } from '@arco-design/web-vue/es/icon'
import axios from 'axios'
import { shell } from '@electron/remote'

export default {
  name: 'ToolsWindow',
  components: {
    IconMinus,
    IconClose,
    IconTool,
    IconCopy
  },
  emits: ['close', 'minimize'],
  props: {
    positionIndex: {
      type: Number,
      default: 0
    },
    isMinimized: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { emit }) {
    const i18n = inject('i18n')
    const t = (key, params) => i18n.t(key, params)

    const position = ref({ x: 150, y: 150 })
    const isDragging = ref(false)
    const isResizing = ref(false)
    const resizeType = ref('')
    let dragOffset = { x: 0, y: 0 }
    let startSize = { width: 0, height: 0 }
    let startPos = { x: 0, y: 0 }

    const windowSize = ref({
      width: 400,
      height: 500,
      minWidth: 300,
      minHeight: 400,
      maxWidth: 800,
      maxHeight: window.innerHeight
    })

    // 标签页相关
    const activeTab = ref('ipQuery')
    const hasAutoQueried = ref(false)
    
    // IP查询相关
    const ipAddress = ref('')
    const ipInfo = ref(null)
    const isQuerying = ref(false)
    
    // 密码生成器相关
    const passwordOptions = ref({
      length: 16,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true
    })
    const generatedPassword = ref('')

    // 监听标签页变化和组件挂载
    onMounted(() => {
      // 组件挂载时，如果当前是IP查询标签，自动查询
      if (activeTab.value === 'ipQuery') {
        queryIP()
      }
    })

    watch(activeTab, (newTab) => {
      // 当切换到IP查询标签时自动查询当前IP
      if (newTab === 'ipQuery' && !ipInfo.value) {
        queryIP()
      }
    })

    // IP查询功能
    const queryIP = async () => {
      if (isQuerying.value) return // 防止重复查询
      
      try {
        isQuerying.value = true
        const response = await axios.post('http://localhost:5000/query_ip', {
          ip: ipAddress.value.trim()
        })
        
        if (response.data.success) {
          ipInfo.value = response.data.data
        } else {
          let errorKey = 'failed'
          const errorMsg = response.data.error.toLowerCase()
          
          if (errorMsg.includes('timeout')) {
            errorKey = 'timeout'
          } else if (errorMsg.includes('rate limit')) {
            errorKey = 'rateLimit'
          } else if (errorMsg.includes('network error')) {
            errorKey = 'network'
          }
          
          console.error('IP query failed:', response.data.error)
          Message.error(t(`tools.ipQuery.error.${errorKey}`))
        }
      } catch (error) {
        console.error('Failed to query IP:', error)
        Message.error(t('tools.ipQuery.error.network'))
      } finally {
        isQuerying.value = false
      }
    }

    // 监听IP地址输入变化
    watch(ipAddress, () => {
      // 清空输入框时自动查询当前IP
      if (!ipAddress.value.trim()) {
        queryIP()
      }
    })

    // 密码生成功能
    const generatePassword = () => {
      const charset = {
        uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        lowercase: 'abcdefghijklmnopqrstuvwxyz',
        numbers: '0123456789',
        symbols: '!@#$%^&*()_+-=[]{}|;:,.<>?'
      }

      let availableChars = ''
      if (passwordOptions.value.uppercase) availableChars += charset.uppercase
      if (passwordOptions.value.lowercase) availableChars += charset.lowercase
      if (passwordOptions.value.numbers) availableChars += charset.numbers
      if (passwordOptions.value.symbols) availableChars += charset.symbols

      if (!availableChars) {
        Message.warning(t('tools.passwordGen.error.empty'))
        return
      }

      let password = ''
      for (let i = 0; i < passwordOptions.value.length; i++) {
        const randomIndex = Math.floor(Math.random() * availableChars.length)
        password += availableChars[randomIndex]
      }

      generatedPassword.value = password
      Message.success(t('tools.passwordGen.success.generate'))
    }

    // 复制密码
    const copyPassword = async () => {
      try {
        await navigator.clipboard.writeText(generatedPassword.value)
        Message.success(t('tools.passwordGen.success.copy'))
      } catch (error) {
        Message.error(t('tools.passwordGen.error.copy'))
      }
    }

    // 窗口拖拽相关函数
    const startDrag = (e) => {
      isDragging.value = true
      dragOffset = {
        x: e.clientX - position.value.x,
        y: e.clientY - position.value.y
      }
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', stopDrag)
    }

    const handleDrag = (e) => {
      if (!isDragging.value) return
      const newPos = keepInBounds(
        e.clientX - dragOffset.x,
        e.clientY - dragOffset.y,
        windowSize.value.width,
        windowSize.value.height
      )
      position.value = newPos
    }

    const stopDrag = () => {
      isDragging.value = false
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', stopDrag)
    }

    // 窗口大小调整相关函数
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
      const dx = e.clientX - (startPos.x + startSize.width)
      const dy = e.clientY - (startPos.y + startSize.height)
      
      let newWidth = startSize.width
      let newHeight = startSize.height

      if (resizeType.value === 'right' || resizeType.value === 'corner') {
        newWidth = Math.min(
          Math.max(windowSize.value.minWidth, startSize.width + dx),
          windowSize.value.maxWidth
        )
      }
      
      if (resizeType.value === 'bottom' || resizeType.value === 'corner') {
        newHeight = Math.min(
          Math.max(windowSize.value.minHeight, startSize.height + dy),
          windowSize.value.maxHeight
        )
      }

      windowSize.value = {
        ...windowSize.value,
        width: newWidth,
        height: newHeight
      }
    }

    const stopResize = () => {
      isResizing.value = false
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', stopResize)
      document.body.style.cursor = ''
    }

    // 窗口控制函数
    const minimize = () => {
      emit('minimize')
    }

    const restore = () => {
      const newPos = keepInBounds(
        position.value.x,
        position.value.y,
        windowSize.value.width,
        windowSize.value.height
      )
      position.value = newPos
    }

    const close = () => {
      emit('close')
    }

    // 辅助函数
    const keepInBounds = (x, y, width, height) => {
      const bounds = {
        width: document.documentElement.clientWidth,
        height: document.documentElement.clientHeight
      }
      
      const maxX = bounds.width - width
      const maxY = bounds.height - height
      
      return {
        x: Math.min(Math.max(0, x), maxX),
        y: Math.min(Math.max(0, y), maxY)
      }
    }

    // 生命周期钩子
    onMounted(() => {
      const bounds = {
        width: window.innerWidth,
        height: window.innerHeight
      }
      position.value = {
        x: (bounds.width - windowSize.value.width) / 2,
        y: (bounds.height - windowSize.value.height) / 2
      }
    })

    const openMap = (lat, lng) => {
      const url = `https://www.google.com/maps?q=${lat},${lng}`
      shell.openExternal(url)
    }

    return {
      position,
      windowSize,
      activeTab,
      ipAddress,
      ipInfo,
      passwordOptions,
      generatedPassword,
      startDrag,
      minimize,
      restore,
      close,
      startResize,
      queryIP,
      generatePassword,
      copyPassword,
      isQuerying,
      openMap,
      hasAutoQueried,
      t
    }
  }
}
</script>

<style scoped>
.tools-window {
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
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  perspective: 1000;
  will-change: transform;
}

.gpu-accelerated {
  transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  perspective: 1000;
  will-change: transform, opacity;
}

.tools-window-header {
  height: 40px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--color-border);
  cursor: move;
  user-select: none;
}

.tools-window-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
}

.tools-window-controls {
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

.tools-window-content {
  flex: 1;
  padding: 16px;
  overflow: auto;
}

.tool-content {
  padding: 16px;
}

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

.tools-float-button {
  position: fixed;
  left: 20px;
  bottom: calc(20px + var(--position-offset));
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
  animation: float-in 0.3s ease both;
}

.tools-float-button:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
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

.tools-float-button::after {
  content: '工具';
  position: absolute;
  left: 120%;
  top: 50%;
  transform: translateY(-50%);
  padding: 4px 8px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s ease;
  margin-left: 8px;
}

.tools-float-button:hover::after {
  opacity: 1;
}

.tools-float-button .arco-icon {
  font-size: 20px;
  color: var(--color-text-1);
}

.ip-info {
  margin-top: 16px;
  animation: fade-in 0.3s ease;
}

.ip-info :deep(.arco-link) {
  color: var(--color-primary);
}

.ip-info :deep(.arco-link:hover) {
  color: var(--color-primary-light-3);
}

@keyframes fade-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.password-options {
  margin-bottom: 24px;
}

.password-result {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.copy-button {
  align-self: flex-end;
}

.length-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.length-value {
  font-size: 14px;
  color: var(--color-text-2);
  font-family: monospace;
  padding: 2px 6px;
  background-color: var(--color-fill-2);
  border-radius: 4px;
}
</style> 