<template>
  <div 
    v-if="!isMinimized && position"
    class="tools-window"
    :style="{ 
      transform: position ? `translate3d(${position.x}px, ${position.y}px, 0)` : 'none',
      transition: isDragging ? 'none' : 'transform 0.2s ease',
      width: '400px',
      height: '500px'
    }"
  >
    <!-- 窗口标题栏 -->
    <div 
      class="tools-window-header"
      @mousedown="startDrag"
    >
      <div class="header-left">
        <span class="tools-window-title">
          {{ $t('tools.title') }}
          <span class="shortcut-hint">(Ctrl+Shift+T)</span>
        </span>
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
              <a-descriptions :column="1" bordered size="small">
                <a-descriptions-item :label="$t('tools.ipQuery.ip')">
                  <div class="ip-address">
                    <span>{{ ipInfo.ip }}</span>
                    <a-tag v-if="ipInfo.version" size="small" :color="ipInfo.version === 'IPv6' ? 'arcoblue' : 'green'">
                      {{ ipInfo.version }}
                    </a-tag>
                  </div>
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

        <!-- Crontab生成器 -->
        <a-tab-pane key="crontab" :title="$t('tools.crontab.title')">
          <div class="tool-content">
            <!-- Cron表达式输入和结果 -->
            <div class="crontab-expression">
              <a-input-group compact>
                <a-input
                  v-model="cronExpression"
                  :placeholder="$t('tools.crontab.expressionPlaceholder')"
                  :style="{ width: 'calc(100% - 90px)' }"
                  @input="handleExpressionInput"
                  allow-clear
                />
                <a-button type="outline" @click="copyCronExpression">
                  {{ $t('tools.crontab.copy') }}
                </a-button>
              </a-input-group>
              <div class="expression-result" v-if="cronDescription">
                <div class="result-header">
                  <icon-info-circle />
                  <span>{{ $t('tools.crontab.parseResult') }}</span>
                </div>
                <div class="result-content">
                  <div class="time-parts">
                    <div class="time-part" v-for="(part, index) in cronParts" :key="index">
                      <span class="part-label">{{ $t(`tools.crontab.${index}`) }}</span>
                      <span class="part-value">{{ part }}</span>
                    </div>
                  </div>
                  <div class="description">
                    {{ cronDescription }}
                  </div>
                </div>
                <div class="next-executions" v-if="nextExecutions && nextExecutions.length">
                  <div class="next-title">{{ $t('tools.crontab.nextExecutions') }}</div>
                  <div class="execution-times">
                    <div v-for="(time, index) in nextExecutions" :key="index" class="execution-time">
                      {{ time }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div class="crontab-content">
              <!-- 左侧选择器 -->
              <div class="crontab-selectors">
                <!-- 常用模板 -->
                <a-form-item :label="$t('tools.crontab.template')" class="template-select">
                  <a-select
                    v-model="selectedTemplate"
                    :placeholder="$t('tools.crontab.selectTemplate')"
                    @change="applyTemplate"
                    size="small"
                  >
                    <a-option value="every_minute" :label="$t('tools.crontab.everyMinute')"></a-option>
                    <a-option value="every_hour" :label="$t('tools.crontab.everyHour')"></a-option>
                    <a-option value="every_day" :label="$t('tools.crontab.everyDay')"></a-option>
                    <a-option value="every_week" :label="$t('tools.crontab.everyWeek')"></a-option>
                    <a-option value="every_month" :label="$t('tools.crontab.everyMonth')"></a-option>
                    <a-option value="every_year" :label="$t('tools.crontab.everyYear')"></a-option>
                  </a-select>
                </a-form-item>

                <!-- Cron表达式各部分 -->
                <a-form :model="cronParts" layout="vertical" size="small" class="cron-form">
                  <a-form-item :label="$t('tools.crontab.minute')">
                    <a-select
                      v-model="cronParts.minute"
                      :placeholder="$t('tools.crontab.minutePlaceholder')"
                      allow-search
                      allow-clear
                    >
                      <a-option value="*" label="每分钟 (*)"></a-option>
                      <a-option value="*/5" label="每5分钟 (*/5)"></a-option>
                      <a-option value="*/15" label="每15分钟 (*/15)"></a-option>
                      <a-option value="*/30" label="每30分钟 (*/30)"></a-option>
                      <a-option value="0" label="整点 (0)"></a-option>
                    </a-select>
                  </a-form-item>

                  <a-form-item :label="$t('tools.crontab.hour')">
                    <a-select
                      v-model="cronParts.hour"
                      :placeholder="$t('tools.crontab.hourPlaceholder')"
                      allow-search
                      allow-clear
                    >
                      <a-option value="*" label="每小时 (*)"></a-option>
                      <a-option value="*/2" label="每2小时 (*/2)"></a-option>
                      <a-option value="*/4" label="每4小时 (*/4)"></a-option>
                      <a-option value="*/6" label="每6小时 (*/6)"></a-option>
                      <a-option value="*/12" label="每12小时 (*/12)"></a-option>
                      <a-option value="0" label="0点 (0)"></a-option>
                    </a-select>
                  </a-form-item>

                  <a-form-item :label="$t('tools.crontab.day')">
                    <a-select
                      v-model="cronParts.day"
                      :placeholder="$t('tools.crontab.dayPlaceholder')"
                      allow-search
                      allow-clear
                    >
                      <a-option value="*" label="每天 (*)"></a-option>
                      <a-option value="1" label="1号 (1)"></a-option>
                      <a-option value="15" label="15号 (15)"></a-option>
                      <a-option value="L" label="最后一天 (L)"></a-option>
                    </a-select>
                  </a-form-item>

                  <a-form-item :label="$t('tools.crontab.month')">
                    <a-select
                      v-model="cronParts.month"
                      :placeholder="$t('tools.crontab.monthPlaceholder')"
                      allow-search
                      allow-clear
                    >
                      <a-option value="*" label="每月 (*)"></a-option>
                      <a-option value="*/3" label="每季度 (*/3)"></a-option>
                      <a-option value="*/6" label="每半年 (*/6)"></a-option>
                      <a-option value="1" label="一月 (1)"></a-option>
                    </a-select>
                  </a-form-item>

                  <a-form-item :label="$t('tools.crontab.week')">
                    <a-select
                      v-model="cronParts.week"
                      :placeholder="$t('tools.crontab.weekPlaceholder')"
                      allow-search
                      allow-clear
                    >
                      <a-option value="*" label="每天 (*)"></a-option>
                      <a-option value="0" label="周日 (0)"></a-option>
                      <a-option value="1-5" label="工作日 (1-5)"></a-option>
                      <a-option value="6,0" label="周末 (6,0)"></a-option>
                    </a-select>
                  </a-form-item>
                </a-form>
              </div>
            </div>
          </div>
        </a-tab-pane>
      </a-tabs>
    </div>

    <!-- 移除调整大小的手柄 -->
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
import { ref, onMounted, watch, inject } from 'vue'
import { Message } from '@arco-design/web-vue'
import { IconMinus, IconClose, IconTool, IconCopy, IconInfoCircle } from '@arco-design/web-vue/es/icon'
import axios from 'axios'
import { shell } from '@electron/remote'

export default {
  name: 'ToolsWindow',
  components: {
    IconMinus,
    IconClose,
    IconTool,
    IconCopy,
    IconInfoCircle
  },
  emits: ['close', 'minimize'],
  props: {
    positionIndex: {
      type: Number,
      default: 0
    }
  },
  setup(props, { emit }) {
    const i18n = inject('i18n')
    const t = (key, params) => i18n.t(key, params)

    // 初始化位置状态
    const position = ref(null)
    const isMinimized = ref(false)
    const isDragging = ref(false)
    let dragOffset = { x: 0, y: 0 }

    // 初始化窗口位置
    const initPosition = () => {
      const width = 400
      const height = 500
      const bounds = {
        width: window.innerWidth,
        height: window.innerHeight
      }
      
      position.value = {
        x: Math.max(0, Math.min((bounds.width - width) / 2, bounds.width - width)),
        y: Math.max(0, Math.min((bounds.height - height) / 2, bounds.height - height))
      }
    }

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

    // Crontab生成器相关
    const selectedTemplate = ref('')
    const cronParts = ref({
      minute: '*',
      hour: '*',
      day: '*',
      month: '*',
      week: '*'
    })
    const cronExpression = ref('* * * * *')
    const cronDescription = ref('')

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
          // 确保version字段存在
          if (!ipInfo.value.version) {
            ipInfo.value.version = ipInfo.value.ip.includes(':') ? 'IPv6' : 'IPv4'
          }
        } else {
          let errorKey = 'failed'
          const errorMsg = response.data.error.toLowerCase()
          
          if (errorMsg.includes('timeout')) {
            errorKey = 'network'  // 将timeout错误改为network错误
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
      if (!position.value) return
      isDragging.value = true
      dragOffset = {
        x: e.clientX - position.value.x,
        y: e.clientY - position.value.y
      }
      document.addEventListener('mousemove', handleDrag)
      document.addEventListener('mouseup', stopDrag)
    }

    const handleDrag = (e) => {
      if (!isDragging.value || !position.value) return
      const newPos = keepInBounds(
        e.clientX - dragOffset.x,
        e.clientY - dragOffset.y,
        400,
        500
      )
      position.value = newPos
    }

    const stopDrag = () => {
      isDragging.value = false
      document.removeEventListener('mousemove', handleDrag)
      document.removeEventListener('mouseup', stopDrag)
    }

    // 窗口控制函数
    const minimize = () => {
      isMinimized.value = true
      emit('minimize')
    }

    const restore = () => {
      isMinimized.value = false
      if (!position.value) {
        initPosition()
      }
      const newPos = keepInBounds(
        position.value.x,
        position.value.y,
        400,
        500
      )
      position.value = newPos
    }

    const close = () => {
      isMinimized.value = false
      emit('close')
    }

    // 辅助函数
    const keepInBounds = (x, y, width, height) => {
      const bounds = {
        width: window.innerWidth,
        height: window.innerHeight
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
      initPosition()
    })

    const openMap = (lat, lng) => {
      const url = `https://www.google.com/maps?q=${lat},${lng}`
      shell.openExternal(url)
    }

    // 监听cron parts变化，更新表达式
    watch(cronParts, (newParts) => {
      const expression = `${newParts.minute} ${newParts.hour} ${newParts.day} ${newParts.month} ${newParts.week}`
      cronExpression.value = expression
      // 不在这里更新描述，让输入框的值变化时触发更新
    }, { deep: true })

    // 监听表达式输入框的值变化
    watch(cronExpression, (newValue) => {
      parseCronExpression(newValue, false)
    })

    // 处理表达式输入变化
    const handleExpressionInput = (value) => {
      // 直接更新表达式值，让watch处理解析
      cronExpression.value = value
    }

    // 解析cron表达式
    const parseCronExpression = (value, showMessage = false) => {
      // 获取要解析的表达式
      const expression = value.trim()
      
      // 如果表达式为空，不进行解析
      if (!expression) {
        cronDescription.value = ''
        cronParts.value = { minute: '*', hour: '*', day: '*', month: '*', week: '*' }
        return
      }

      const parts = expression.split(/\s+/)
      if (parts.length === 5) {
        // 验证每个部分的格式
        const isValid = parts.every((part, index) => {
          const patterns = {
            minute: /^(\*|([0-9]|[1-5][0-9])(\-[0-9]|[1-5][0-9])?)(\/\d+)?$/,
            hour: /^(\*|([0-9]|1[0-9]|2[0-3])(\-([0-9]|1[0-9]|2[0-3]))?)(\/\d+)?$/,
            day: /^(\*|([1-9]|[12][0-9]|3[01])|L)$/,
            month: /^(\*|([1-9]|1[0-2]))(\/\d+)?$/,
            week: /^(\*|([0-6])(\-[0-6])?|[1-5]\-[1-5]|[0,6])$/
          }
          const types = ['minute', 'hour', 'day', 'month', 'week']
          return patterns[types[index]].test(part)
        })

        if (isValid) {
          // 更新各个部分
          cronParts.value = {
            minute: parts[0],
            hour: parts[1],
            day: parts[2],
            month: parts[3],
            week: parts[4]
          }
          
          // 更新描述
          updateCronDescription(parts)
        } else {
          cronDescription.value = ''
        }
      } else {
        cronDescription.value = ''
      }
    }

    // 更新cron表达式描述
    const updateCronDescription = (parts) => {
      if (!Array.isArray(parts)) {
        parts = cronExpression.value.split(' ')
      }
      
      let desc = []

      // 分钟
      if (parts[0] === '*') desc.push('每分钟')
      else if (parts[0].startsWith('*/')) desc.push(`每${parts[0].split('/')[1]}分钟`)
      else if (parts[0].includes('-')) {
        const [start, end] = parts[0].split('-')
        desc.push(`从第${start}分钟到第${end}分钟`)
      } else desc.push(`第${parts[0]}分钟`)

      // 小时
      if (parts[1] === '*') desc.push('每小时')
      else if (parts[1].startsWith('*/')) desc.push(`每${parts[1].split('/')[1]}小时`)
      else if (parts[1].includes('-')) {
        const [start, end] = parts[1].split('-')
        desc.push(`从${start}点到${end}点`)
      } else desc.push(`${parts[1]}点`)

      // 日期
      if (parts[2] === '*') desc.push('每天')
      else if (parts[2] === 'L') desc.push('最后一天')
      else desc.push(`${parts[2]}号`)

      // 月份
      if (parts[3] === '*') desc.push('每月')
      else if (parts[3].startsWith('*/')) desc.push(`每${parts[3].split('/')[1]}个月`)
      else if (parts[3].includes('-')) {
        const [start, end] = parts[3].split('-')
        desc.push(`从${start}月到${end}月`)
      } else desc.push(`${parts[3]}月`)

      // 星期
      if (parts[4] === '*') desc.push('')
      else if (parts[4] === '1-5') desc.push('工作日')
      else if (parts[4] === '6,0') desc.push('周末')
      else if (parts[4].includes('-')) {
        const [start, end] = parts[4].split('-')
        desc.push(`从星期${start}到星期${end}`)
      } else desc.push(`星期${parts[4]}`)

      cronDescription.value = desc.filter(d => d).join('，') + '执行'
    }

    // 应用模板
    const applyTemplate = (template) => {
      switch (template) {
        case 'every_minute':
          cronExpression.value = '* * * * *'
          break
        case 'every_hour':
          cronExpression.value = '0 * * * *'
          break
        case 'every_day':
          cronExpression.value = '0 0 * * *'
          break
        case 'every_week':
          cronExpression.value = '0 0 * * 0'
          break
        case 'every_month':
          cronExpression.value = '0 0 1 * *'
          break
        case 'every_year':
          cronExpression.value = '0 0 1 1 *'
          break
      }
      // watch会自动触发解析
    }

    // 复制cron表达式
    const copyCronExpression = () => {
      navigator.clipboard.writeText(cronExpression.value)
      Message.success(t('tools.crontab.copied'))
    }

    return {
      position,
      isMinimized,
      isDragging,
      activeTab,
      ipAddress,
      ipInfo,
      passwordOptions,
      generatedPassword,
      // Crontab相关
      selectedTemplate,
      cronParts,
      cronExpression,
      cronDescription,
      // 方法
      applyTemplate,
      copyCronExpression,
      startDrag,
      minimize,
      restore,
      close,
      queryIP,
      generatePassword,
      copyPassword,
      isQuerying,
      openMap,
      hasAutoQueried,
      handleExpressionInput,
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
  height: calc(100% - 32px);

  .tool-content {
    height: 100%;
  }

  .crontab-options {
    margin-bottom: 24px;

    .arco-form {
      max-width: 100%;
    }

    .arco-form-item {
      margin-bottom: 16px;
    }

    .arco-select {
      width: 100%;
    }
  }

  .crontab-result {
    .arco-typography {
      margin-bottom: 8px;
    }

    .arco-input-group {
      margin-bottom: 16px;
    }

    .arco-alert {
      margin-top: 8px;
    }
  }
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

  :deep(.arco-descriptions-item-label) {
    width: 100px;
  }

  :deep(.arco-descriptions-item-value) {
    word-break: break-all;
  }
}

.ip-address {
  display: flex;
  align-items: center;
  gap: 8px;
  word-break: break-all;
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

.shortcut-hint {
  font-size: 12px;
  color: var(--color-text-3);
  margin-left: 8px;
  font-weight: normal;
}

.crontab-expression {
  margin-bottom: 16px;
}

.expression-description {
  margin-top: 8px;
}

.crontab-content {
  display: flex;
  gap: 16px;
}

.crontab-selectors {
  flex: 1;
}

.template-select {
  margin-bottom: 16px;
}

.cron-form {
  .arco-form-item {
    margin-bottom: 12px;
  }

  .arco-form-item-label {
    padding-bottom: 4px;
  }

  :deep(.arco-select) {
    width: 100%;
  }
}

.arco-form-item-label {
  font-size: 13px;
}

:deep(.arco-select-view) {
  padding: 2px 8px;
}

:deep(.arco-btn) {
  padding: 0 16px;
  height: 32px;
  line-height: 32px;
}

:deep(.arco-input-wrapper) {
  padding: 2px 8px;
}

.expression-result {
  margin-top: 16px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-1);
}

.result-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-fill-2);
  color: var(--color-text-1);
  font-weight: 500;
}

.result-header :deep(.arco-icon) {
  color: var(--color-primary);
  font-size: 16px;
}

.result-content {
  padding: 12px;
}

.time-parts {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 12px;
  border-bottom: 1px dashed var(--color-border);
}

.time-part {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.part-label {
  font-size: 12px;
  color: var(--color-text-3);
}

.part-value {
  font-family: monospace;
  color: var(--color-text-1);
  background: var(--color-fill-2);
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 13px;
}

.description {
  color: var(--color-text-2);
  font-size: 13px;
  line-height: 1.5;
}

.next-executions {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--color-border);
}

.next-title {
  font-size: 12px;
  color: var(--color-text-3);
  margin-bottom: 8px;
}

.execution-times {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.execution-time {
  font-family: monospace;
  font-size: 12px;
  color: var(--color-text-2);
  background: var(--color-fill-2);
  padding: 2px 6px;
  border-radius: 3px;
}
</style> 