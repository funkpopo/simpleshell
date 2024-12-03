<template>
  <div 
    v-if="!isMinimized"
    class="ai-window"
    :style="{ 
      transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
      transition: isDragging ? 'none' : 'transform 0.2s ease',
      width: `${windowSize.width}px`,
      height: `${windowSize.height}px`
    }"
  >
    <div 
      class="ai-window-header"
      @mousedown="startDrag"
    >
      <div class="header-left">
        <span class="ai-window-title">{{ $t('aiAssistant.title') }}</span>
        <span class="current-model">{{ aiSettings.currentModel }}</span>
      </div>
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
      <!-- 添加聊天界面 -->
      <div class="chat-container">
        <!-- 消息列表 -->
        <div class="messages-container" ref="messagesContainer">
          <div 
            v-for="(message, index) in messages" 
            :key="index"
            :class="['message', message.role]"
          >
            <div class="message-content">
              <div class="message-header">
                <span class="message-role">{{ message.role === 'user' ? 'You' : 'Assistant' }}</span>
                <div class="message-actions">
                  <a-button
                    type="text"
                    size="mini"
                    class="copy-button"
                    @click="copyMessage(message.content)"
                  >
                    <template #icon>
                      <icon-copy />
                    </template>
                  </a-button>
                </div>
              </div>
              <div class="message-text" @click="selectText">{{ message.content }}</div>
            </div>
            <div class="message-time">{{ formatTime(message.timestamp) }}</div>
          </div>
          
          <!-- 添加加载动画 -->
          <div v-if="isWaitingResponse" class="message assistant loading">
            <div class="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div class="input-container">
          <a-textarea
            v-model="currentMessage"
            :placeholder="$t('aiAssistant.chatPlaceholder', { model: aiSettings.currentModel })"
            :auto-size="{ minRows: 2, maxRows: 5 }"
            @keydown="handleKeyDown"
          />
          <a-button 
            type="primary" 
            class="send-button"
            :disabled="!currentMessage.trim()"
            @click="sendMessage"
          >
            {{ $t('aiAssistant.send') }}
          </a-button>
        </div>
      </div>
    </div>
    <!-- 添加调整大小的手柄 -->
    <div class="resize-handle resize-right" @mousedown.stop="startResize('right')"></div>
    <div class="resize-handle resize-bottom" @mousedown.stop="startResize('bottom')"></div>
    <div class="resize-handle resize-corner" @mousedown.stop="startResize('corner')"></div>

    <!-- AI 设置对话框 -->
    <a-modal
      v-model:visible="settingsVisible"
      :title="$t('aiAssistant.settings')"
      @cancel="closeSettings"
      @ok="saveSettings"
      :mask-closable="false"
      :closable="true"
      class="ai-settings-modal"
    >
      <a-form :model="aiSettings" layout="vertical">
        <!-- 模型列表 -->
        <a-form-item :label="$t('aiAssistant.models')">
          <div class="models-container">
            <!-- 只在有模型时显示模型列表 -->
            <template v-if="aiSettings.models && aiSettings.models.length > 0">
              <div v-for="(model, index) in aiSettings.models" :key="index" class="model-item">
                <div class="model-header">
                  <span class="model-name">{{ model.name }}</span>
                  <div class="model-actions">
                    <a-button
                      type="text"
                      size="mini"
                      @click="editModel(index)"
                      v-if="!model.isEditing"
                    >
                      <template #icon>
                        <icon-edit />
                      </template>
                    </a-button>
                    <a-button
                      type="text"
                      size="mini"
                      status="danger"
                      @click="removeModel(index)"
                    >
                      <template #icon>
                        <icon-delete />
                      </template>
                    </a-button>
                  </div>
                </div>
                
                <!-- 编辑状态 -->
                <template v-if="model.isEditing">
                  <div class="model-edit-container">
                    <a-form-item label="Model Name">
                      <a-input v-model="model.name" allow-clear />
                    </a-form-item>
                    <a-form-item label="API URL">
                      <a-input v-model="model.apiUrl" allow-clear />
                    </a-form-item>
                    <a-form-item label="API Key">
                      <a-input-password v-model="model.apiKey" allow-clear />
                    </a-form-item>
                    <a-form-item label="Temperature">
                      <a-slider
                        v-model="model.temperature"
                        :min="0"
                        :max="2"
                        :step="0.1"
                        show-ticks
                      />
                    </a-form-item>
                    <a-form-item label="Max Tokens">
                      <a-input-number
                        v-model="model.maxTokens"
                        :min="1"
                        :max="32000"
                        :step="1"
                        placeholder="Enter max tokens"
                      />
                    </a-form-item>
                    <div class="model-edit-actions">
                      <a-button type="primary" size="small" @click="saveModelEdit(index)">
                        Save
                      </a-button>
                      <a-button size="small" @click="cancelModelEdit(index)">
                        Cancel
                      </a-button>
                    </div>
                  </div>
                </template>
                
                <!-- 显示状 -->
                <template v-else>
                  <div class="model-info">
                    <div class="info-item">
                      <span class="info-label">Provider:</span>
                      <span class="info-value">{{ getProviderName(model.provider) }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">API URL:</span>
                      <span class="info-value">{{ model.apiUrl }}</span>
                    </div>
                    <div class="info-item">
                      <span class="info-label">API Key:</span>
                      <span class="info-value">{{ hideApiKey(model.apiKey) }}</span>
                    </div>
                  </div>
                </template>
              </div>
            </template>

            <!-- 添加按钮容器，始终显示 -->
            <div class="model-actions-container" :class="{ 'no-models': !aiSettings.models?.length }">
              <a-button
                type="outline"
                class="add-provider-btn"
                @click="showAddProviderModal"
              >
                <template #icon>
                  <icon-plus />
                </template>
                {{ $t('aiAssistant.addProvider') }}
              </a-button>
            </div>
          </div>
        </a-form-item>

        <!-- 当前选择的模型 -->
        <a-form-item :label="$t('aiAssistant.currentModel')">
          <a-select v-model="aiSettings.currentModel">
            <a-option 
              v-if="!aiSettings.models?.length"
              value="None"
            >
              {{ $t('aiAssistant.noModels') }}
            </a-option>
            <a-option 
              v-for="model in aiSettings.models" 
              :key="model.name" 
              :value="model.name"
            >
              {{ model.name }}
            </a-option>
          </a-select>
        </a-form-item>

        <!-- 上下文长度设置 -->
        <a-form-item :label="$t('aiAssistant.maxContextLength')">
          <a-input-number
            v-model="aiSettings.maxContextLength"
            :min="1"
            :max="50"
            :step="1"
          />
          <template #help>
            {{ $t('aiAssistant.maxContextLength') }}
          </template>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 添加新的供应商对话框 -->
    <a-modal
      v-model:visible="addProviderVisible"
      :title="$t('aiAssistant.addProvider')"
      @cancel="closeAddProviderModal"
      @ok="addNewProvider"
    >
      <a-form :model="newProvider" layout="vertical">
        <!-- 供应商类型选择 -->
        <a-form-item :label="$t('aiAssistant.provider')" required>
          <a-select 
            v-model="newProvider.provider" 
            @change="handleProviderChange"
          >
            <a-option value="openai">
              <template #icon>
                <img :src="getProviderLogo('openai')" class="provider-logo" />
              </template>
              OpenAI
            </a-option>
            <a-option value="zhipu">
              <template #icon>
                <img :src="getProviderLogo('zhipu')" class="provider-logo" />
              </template>
              ZhipuAI
            </a-option>
            <a-option value="qwen">
              <template #icon>
                <img :src="getProviderLogo('qwen')" class="provider-logo" />
              </template>
              Qwen
            </a-option>
            <a-option value="gemini">
              <template #icon>
                <img :src="getProviderLogo('gemini')" class="provider-logo" />
              </template>
              Google Gemini
            </a-option>
            <a-option value="ollama">
              <template #icon>
                <img :src="getProviderLogo('ollama')" class="provider-logo" />
              </template>
              Ollama
            </a-option>
            <a-option value="siliconflow">
              <template #icon>
                <img :src="getProviderLogo('siliconflow')" class="provider-logo" />
              </template>
              SiliconFlow
            </a-option>
          </a-select>
        </a-form-item>

        <!-- 模型名称输入框 -->
        <a-form-item :label="$t('aiAssistant.modelName')" required>
          <a-input 
            v-model="newProvider.name" 
            :placeholder="$t('aiAssistant.modelName')"
          />
        </a-form-item>

        <!-- API URL 输入框 -->
        <a-form-item :label="$t('aiAssistant.apiUrl')" required>
          <a-input 
            v-model="newProvider.apiUrl" 
            :placeholder="$t('aiAssistant.apiUrl')"
          />
        </a-form-item>

        <!-- API Key 输入框 -->
        <a-form-item :label="$t('aiAssistant.apiKey')" required>
          <a-input-password 
            v-model="newProvider.apiKey" 
            :placeholder="$t('aiAssistant.apiKey')"
            allow-clear
          />
        </a-form-item>

        <!-- Temperature 配置 -->
        <a-form-item :label="$t('aiAssistant.temperature')">
          <a-slider
            v-model="newProvider.temperature"
            :min="0"
            :max="2"
            :step="0.1"
            show-ticks
          />
        </a-form-item>

        <!-- Max Tokens 输入框 -->
        <a-form-item :label="$t('aiAssistant.maxTokens')" required>
          <a-input-number
            v-model="newProvider.maxTokens"
            :min="1"
            :max="32000"
            :step="1"
            :placeholder="$t('aiAssistant.maxTokens')"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>

  <!-- 最小后的浮动按钮 -->
  <div 
    v-else
    class="ai-float-button"
    @click="restore"
  >
    <img :src="aiIcon" alt="AI" class="ai-float-icon" />
  </div>
</template>

<script>
import { ref, onMounted, onUnmounted, nextTick, watch, inject } from 'vue'
import { IconMinus, IconClose, IconSettings, IconDelete, IconPlus, IconEdit, IconCopy } from '@arco-design/web-vue/es/icon'
import { Message } from '@arco-design/web-vue'
import aiIcon from '@/assets/aiicon.png'
import { ipcRenderer } from 'electron'

// 导入服务提供商的图标
import openaiLogo from '@/assets/openai_s.svg'
import zhipuLogo from '@/assets/zhipu_s.svg'
import qwenLogo from '@/assets/qwen_s.svg'
import geminiLogo from '@/assets/gemini_s.svg'
import ollamaLogo from '@/assets/ollama_s.svg'
import siliconflowLogo from '@/assets/siliconflow_s.svg'

export default {
  name: 'AIAssistant',
  components: {
    IconMinus,
    IconClose,
    IconSettings,
    IconDelete,
    IconPlus,
    IconEdit,
    IconCopy
  },
  emits: ['close', 'minimize'],
  setup(props, { emit }) {
    const i18n = inject('i18n')
    const t = (key, params) => i18n.t(key, params)
    
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
      minHeight: 80,
      maxWidth: 800,
      maxHeight: window.innerHeight
    })

    // 添加设置相的状态
    const settingsVisible = ref(false)
    const addModelVisible = ref(false)
    const addProviderVisible = ref(false)
    const aiSettings = ref({
      models: [],
      currentModel: 'None',
      maxContextLength: 10
    })
    const newModel = ref({
      provider: '',
      name: '',
      apiUrl: '',
      apiKey: ''
    })
    const newProvider = ref({
      provider: '',
      name: '',
      apiUrl: '',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 32000
    })

    // 添加聊天相关的响应式变量
    const messages = ref([])
    const currentMessage = ref('')
    const messagesContainer = ref(null)

    // 在 setup 函数内添加
    const isWaitingResponse = ref(false)

    // 发送消息
    const sendMessage = async () => {
      if (!currentMessage.value.trim()) return

      const userMessage = {
        role: 'user',
        content: currentMessage.value,
        timestamp: Date.now()
      }

      messages.value.push(userMessage)
      const messageToSend = currentMessage.value
      currentMessage.value = ''

      // 在添加用户消息后滚动到底部
      await nextTick()
      scrollToBottom()

      // 设置等待状态为 true
      isWaitingResponse.value = true

      try {
        const currentModelConfig = aiSettings.value.models.find(
          model => model.name === aiSettings.value.currentModel
        )

        if (!currentModelConfig) {
          throw new Error('No model selected')
        }

        // 获取历史消息，但限制数量
        const contextMessages = messages.value
          .slice(-aiSettings.value.maxContextLength * 2) // 乘2是因为每轮对话包含用户和助手两条消息
          .filter(msg => msg.role !== 'error') // 过滤掉错误消息
          .map(msg => ({
            role: msg.role,
            content: msg.content
          }))

        // 准备发送到 API 的数据
        const requestData = {
          provider: currentModelConfig.provider,
          model: currentModelConfig.name,
          messages: contextMessages, // 发送包含历史消息的数组
          temperature: currentModelConfig.temperature || aiSettings.value.temperature,
          max_tokens: currentModelConfig.maxTokens || aiSettings.value.maxTokens,
          api_key: currentModelConfig.apiKey,
          api_url: currentModelConfig.apiUrl
        }

        // 创建一个新的消息对象用于流式响应
        const assistantMessage = {
          role: 'assistant',
          content: '',
          timestamp: Date.now()
        }
        messages.value.push(assistantMessage)

        const response = await fetch('http://localhost:5000/chat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(requestData)
        })

        const reader = response.body.getReader()
        const decoder = new TextDecoder()

        // 收到第一个响应时，移除加载动画
        let isFirstChunk = true

        while (true) {
          const { value, done } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value)
          const lines = chunk.split('\n')

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(5)
              if (data === '[DONE]') {
                break
              }

              try {
                const parsed = JSON.parse(data)
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
                if (parsed.content) {
                  if (isFirstChunk) {
                    isWaitingResponse.value = false
                    isFirstChunk = false
                  }
                  assistantMessage.content += parsed.content
                  messages.value = [...messages.value]
                  // 在每次更新消息后滚动到底部
                  await nextTick()
                  scrollToBottom()
                }
              } catch (e) {
                console.error('Error parsing SSE data:', e)
                Message.error(e.message)
              }
            }
          }
        }

      } catch (error) {
        console.error('Failed to get AI response:', error)
        let errorMessage = 'Failed to get AI response'
        
        if (error.response) {
          try {
            const errorData = await error.response.json()
            errorMessage = errorData.error || errorMessage
          } catch (e) {
            errorMessage = error.response.statusText
          }
        }
        
        Message.error(errorMessage)
        messages.value.push({
          role: 'error',
          content: errorMessage,
          timestamp: Date.now()
        })

        // 在添加错误消息后也滚动到底部
        await nextTick()
        scrollToBottom()
      } finally {
        // 确保无论如何都关闭加载动画
        isWaitingResponse.value = false
      }
    }

    // 格式化时间
    const formatTime = (timestamp) => {
      const date = new Date(timestamp)
      return date.toLocaleTimeString()
    }

    // 滚动到底部
    const scrollToBottom = () => {
      if (messagesContainer.value) {
        // 使用 requestAnimationFrame 确保在下一帧渲染时滚动
        requestAnimationFrame(() => {
          messagesContainer.value.scrollTo({
            top: messagesContainer.value.scrollHeight,
            behavior: 'smooth'
          })
        })
      }
    }

    // 添加一个监听器来观察消息列表的变化
    watch(() => messages.value.length, () => {
      nextTick(() => scrollToBottom())
    })

    // 添加一个监听器来观察最后一条消息的内容变化
    watch(
      () => messages.value[messages.value.length - 1]?.content,
      () => {
        nextTick(() => scrollToBottom())
      }
    )

    // 监听窗口大小变化，调整滚动位置
    watch(() => windowSize.value, () => {
      nextTick(() => scrollToBottom())
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
          models: aiSettings.value.models.map(model => ({
            provider: model.provider,
            name: model.name,
            apiUrl: model.apiUrl,
            apiKey: model.apiKey,
            temperature: model.temperature,
            maxTokens: model.maxTokens
          })),
          currentModel: aiSettings.value.currentModel,
          maxContextLength: aiSettings.value.maxContextLength
        }
        
        if (aiSettingsIndex !== -1) {
          config[aiSettingsIndex] = aiSettingsData
        } else {
          config.push(aiSettingsData)
        }
        
        await ipcRenderer.invoke('save-config', config)
        
        Message.success(t('aiAssistant.settingsSaved'))
        settingsVisible.value = false
      } catch (error) {
        console.error('Failed to save AI settings:', error)
        Message.error(error.message || 'Failed to save settings')
      }
    }

    // 加载设置
    const loadSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const settings = config.find(item => item.type === 'aisettings')
        
        if (settings) {
          aiSettings.value = {
            models: settings.models?.map(model => ({
              ...model,
              isEditing: false,
              temperature: model.temperature || 0.7,
              maxTokens: model.maxTokens || 32000
            })) || [],
            currentModel: settings.currentModel || 'None',
            maxContextLength: settings.maxContextLength || 10
          }
        }
      } catch (error) {
        console.error('Failed to load AI settings:', error)
      }
    }

    // 添加新模型
    const addNewModel = () => {
      if (!newModel.value.provider || !newModel.value.name || !newModel.value.apiUrl || !newModel.value.apiKey) {
        Message.error('Please fill in all required fields')
        return
      }

      // 检查模型名称是否已存在
      if (aiSettings.value.models.some(model => model.name === newModel.value.name)) {
        Message.error('Model name already exists')
        return
      }

      // 添加新模型
      aiSettings.value.models.push({
        provider: newModel.value.provider,
        name: newModel.value.name,
        apiUrl: newModel.value.apiUrl,
        apiKey: newModel.value.apiKey
      })

      Message.success('Model added successfully')
      closeAddModelModal()
    }

    // 显示添加新模型对话框
    const showAddModelModal = () => {
      newModel.value = {
        provider: '',
        name: '',
        apiUrl: '',
        apiKey: ''
      }
      addModelVisible.value = true
    }

    // 关闭添加新模型对话框
    const closeAddModelModal = () => {
      addModelVisible.value = false
    }

    const removeModel = (index) => {
      // 如果要删除的是前选中的模型，切换到第一个可用模型
      if (aiSettings.value.models[index].name === aiSettings.value.currentModel) {
        if (aiSettings.value.models.length > 1) {
          aiSettings.value.currentModel = aiSettings.value.models[0].name
        }
      }
      aiSettings.value.models.splice(index, 1)
    }

    const editModel = (index) => {
      // 创建编辑状态的副本
      const model = aiSettings.value.models[index]
      aiSettings.value.models[index] = {
        ...model,
        isEditing: true,
        _original: { ...model } // 保存原始数据用于取消
      }
    }

    const saveModelEdit = (index) => {
      const model = aiSettings.value.models[index]
      delete model.isEditing
      delete model._original
      Message.success('Model settings updated')
    }

    const cancelModelEdit = (index) => {
      const model = aiSettings.value.models[index]
      if (model._original) {
        aiSettings.value.models[index] = {
          ...model._original,
          isEditing: false
        }
      }
    }

    const hideApiKey = (apiKey) => {
      if (!apiKey) return '••••••'
      return '•'.repeat(Math.min(apiKey.length, 20))
    }

    // 添加处理供应商变化的法
    const handleProviderChange = (value) => {
      newProvider.value.name = ''
      newProvider.value.apiUrl = getDefaultApiUrl(value)
    }

    // 获取默认 API URL
    const getDefaultApiUrl = (provider) => {
      const urls = {
        openai: '',
        zhipu: 'https://open.bigmodel.cn/api/paas/v3/chat/completions',
        qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
        ollama: '',
        siliconflow: 'https://api.siliconflow.cn/v1'
      }
      return urls[provider] || ''
    }

    // 获取 API URL 占位符
    const getApiUrlPlaceholder = (provider) => {
      return getDefaultApiUrl(provider) || 'Enter API URL'
    }

    // 获取供应商名称
    const getProviderName = (provider) => {
      const names = {
        openai: 'OpenAI',
        zhipu: 'ZhipuAI',
        qwen: 'Qwen',
        gemini: 'Google Gemini',
        ollama: 'Ollama',
        siliconflow: 'SiliconFlow'
      }
      return names[provider] || provider
    }

    // 显示添加供应商对话框
    const showAddProviderModal = () => {
      newProvider.value = {
        provider: '',
        name: '',
        apiUrl: '',
        apiKey: '',
        temperature: 0.7,
        maxTokens: 32000
      }
      addProviderVisible.value = true

      // 添加对 provider 的监听
      watch(() => newProvider.value.provider, (newValue) => {
        if (newValue) {
          newProvider.value.apiUrl = getDefaultApiUrl(newValue)
        }
      })
    }

    // 关闭添加供应商对话框
    const closeAddProviderModal = () => {
      newProvider.value = {
        provider: '',
        name: '',
        apiUrl: '',
        apiKey: '',
        temperature: 0.7,
        maxTokens: 32000
      }
      addProviderVisible.value = false
    }

    // 添加新供应商
    const addNewProvider = () => {
      if (!newProvider.value.provider || !newProvider.value.name || !newProvider.value.apiUrl || !newProvider.value.apiKey) {
        Message.error('Please fill in all required fields')
        return
      }

      // 检查供应商是否已存在
      if (aiSettings.value.models.some(model => model.name === newProvider.value.name)) {
        Message.error('Model name already exists')
        return
      }

      // 添加新供应商，使用固定的 maxTokens 值
      aiSettings.value.models.push({
        provider: newProvider.value.provider,
        name: newProvider.value.name,
        apiUrl: newProvider.value.apiUrl,
        apiKey: newProvider.value.apiKey,
        temperature: newProvider.value.temperature,
        maxTokens: 4096
      })

      Message.success('Provider added successfully')
      closeAddProviderModal()
    }

    // 添加复制消息的方法
    const copyMessage = async (content) => {
      try {
        await navigator.clipboard.writeText(content)
        Message.success('Copied to clipboard')
      } catch (err) {
        console.error('Failed to copy text:', err)
        Message.error('Failed to copy text')
      }
    }

    // 添加文本选择的方法
    const selectText = (event) => {
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(event.target)
      selection.removeAllRanges()
      selection.addRange(range)
    }

    // 添加一个方法来获取服务提供商的图标
    const getProviderLogo = (provider) => {
      const logos = {
        openai: openaiLogo,
        zhipu: zhipuLogo,
        qwen: qwenLogo,
        gemini: geminiLogo,
        ollama: ollamaLogo,
        siliconflow: siliconflowLogo
      }
      return logos[provider] || null
    }

    // 在 setup 函数中添加 handleKeyDown 方法
    const handleKeyDown = (e) => {
      // 如果按下 Enter 且没有按下 Shift
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault() // 阻止默认的换行行为
        if (currentMessage.value.trim()) {
          sendMessage()
        }
      }
      // 如果按下 Shift + Enter，让它正常换行
      // 不需要特殊处理，因为这是 textarea 的默认行为
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
      
      // 初始滚动到底部
      nextTick(() => scrollToBottom())
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
      saveSettings,
      addModelVisible,
      newModel,
      showAddModelModal,
      closeAddModelModal,
      addNewModel,
      removeModel,
      editModel,
      saveModelEdit,
      cancelModelEdit,
      hideApiKey,
      messages,
      currentMessage,
      sendMessage,
      formatTime,
      messagesContainer,
      addProviderVisible,
      newProvider,
      showAddProviderModal,
      closeAddProviderModal,
      addNewProvider,
      handleProviderChange,
      getApiUrlPlaceholder,
      getProviderName,
      copyMessage,
      selectText,
      isWaitingResponse,
      getProviderLogo,
      t,
      handleKeyDown
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

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.ai-window-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--color-text-1);
}

.current-model {
  font-size: 12px;
  color: var(--color-text-3);
  font-weight: bold;
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
  width: 800px;
}

:deep(.arco-form-item) {
  margin-bottom: 16px;
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

/* 添加模型管理相关样式 */
.models-container {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  width: 100%;
}

.model-item {
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 12px;
  background: var(--color-bg-1);
}

.model-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.model-name {
  font-weight: 500;
  color: var(--color-text-1);
}

.model-actions {
  display: flex;
  gap: 4px;
}

.model-item :deep(.arco-form-item) {
  margin-bottom: 12px;
}

.model-item :deep(.arco-form-item:last-child) {
  margin-bottom: 0;
}

.model-info {
  padding: 8px 0;
}

.info-item {
  display: flex;
  margin-bottom: 8px;
  font-size: 14px;
  line-height: 1.5;
}

.info-item:last-child {
  margin-bottom: 0;
}

.info-label {
  color: var(--color-text-3);
  width: 80px;
  flex-shrink: 0;
}

.info-value {
  color: var(--color-text-1);
  word-break: break-all;
}

.model-edit-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 12px;
}

.model-actions {
  display: flex;
  gap: 4px;
}

.model-actions .arco-btn {
  padding: 0 4px;
}

/* 添加聊天界面相关样式 */
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--color-bg-1);
  border-radius: 4px;
}

.messages-container {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.message {
  max-width: 80%;
  padding: 12px;
  border-radius: 8px;
  position: relative;
  margin-bottom: 16px;
}

.message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.message-role {
  font-size: 12px;
  color: var(--color-text-3);
  font-weight: 500;
}

.message-actions {
  opacity: 0;
  transition: opacity 0.2s ease;
}

.message:hover .message-actions {
  opacity: 1;
}

.copy-button {
  padding: 2px;
  color: var(--color-text-3);
}

.copy-button:hover {
  color: var(--color-text-1);
  background: var(--color-fill-3);
  border-radius: 4px;
}

.message-text {
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  user-select: text;  /* 许文本选择 */
  cursor: text;
}

.message.user {
  align-self: flex-end;
  background-color: var(--color-primary-light-1);
  color: var(--color-text-1);
}

.message.assistant {
  align-self: flex-start;
  background-color: var(--color-fill-2);
  color: var(--color-text-1);
}

.message.error {
  align-self: center;
  background-color: var(--color-danger-light-1);
  color: var(--color-danger-dark-2);
  text-align: center;
  max-width: 90%;
}

.message-time {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 4px;
  text-align: right;
}

.input-container {
  padding: 16px;
  background: var(--color-bg-2);
  border-top: 1px solid var(--color-border);
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

:deep(.arco-textarea-wrapper) {
  flex: 1;
}

.send-button {
  height: 32px;
  padding: 0 16px;
}

/* 自定义滚动条样式 */
.messages-container::-webkit-scrollbar {
  width: 8px;
}

.messages-container::-webkit-scrollbar-track {
  background: transparent;
}

.messages-container::-webkit-scrollbar-thumb {
  background-color: var(--color-text-4);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

.messages-container::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-text-3);
}

/* 修改模型容器样式 */
.models-container {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  width: 100%;
}

/* 添加按钮容器样式 */
.model-actions-container {
  grid-column: 1 / -1;
  display: flex;
  gap: 16px;
  margin-top: 8px;
}

.add-provider-btn {
  flex: 1;
  height: 40px;
}

/* 确保按钮图标垂直居中 */
.add-provider-btn :deep(.arco-icon) {
  vertical-align: middle;
  margin-right: 8px;
}

/* 当没有模型时的样式 */
.model-actions-container.no-models {
  margin-top: 0;
}

/* 添加选中文本的样式 */
::selection {
  background: var(--color-primary-light-3);
  color: var(--color-text-1);
}

/* 在 style 部分添加 */
.message.loading {
  max-width: 60px;
  padding: 8px 12px;
  margin-bottom: 0;
}

.typing-indicator {
  display: flex;
  align-items: center;
  gap: 4px;
}

.typing-indicator span {
  width: 6px;
  height: 6px;
  background-color: var(--color-text-3);
  border-radius: 50%;
  display: inline-block;
  animation: bounce 1.4s infinite ease-in-out;
}

.typing-indicator span:nth-child(1) {
  animation-delay: -0.32s;
}

.typing-indicator span:nth-child(2) {
  animation-delay: -0.16s;
}

@keyframes bounce {
  0%, 80%, 100% { 
    transform: scale(0);
  } 
  40% { 
    transform: scale(1);
  }
}

/* 编辑状态的模板中添加滚动容器 */
.model-edit-container {
  max-height: 400px;
  overflow-y: auto;
  padding-right: 12px;
}

.model-edit-container::-webkit-scrollbar {
  width: 6px;
}

.model-edit-container::-webkit-scrollbar-track {
  background: transparent;
}

.model-edit-container::-webkit-scrollbar-thumb {
  background-color: var(--color-text-4);
  border-radius: 3px;
}

.model-edit-container::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-text-3);
}

/* 调整模型卡片的最大高度 */
.model-item {
  max-height: 500px;
  overflow: hidden;
}

/* 添加图标样式 */
.provider-logo {
  width: 24px;
  height: 24px;
  margin-right: 8px;
  object-fit: contain;
}

/* 调整 a-select 选项的样式，使图标和文字对齐 */
:deep(.arco-select-option) {
  display: flex;
  align-items: center;
}
</style> 