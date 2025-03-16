<!-- 全局设置对话框 -->
<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue'
import { useI18n } from '../i18n'

// 使用i18n
const { t, language, setLanguage } = useI18n()

// 定义props
const props = defineProps<{
  visible: boolean
  isDarkTheme: boolean
}>()

// 定义事件
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'save', settings: GlobalSettings): void
  (e: 'cancel'): void
}>()

// AI API接口配置
interface AIApiConfig {
  id: string
  name: string
  apiUrl: string
  apiKey: string
  modelName: string
}

// 全局设置接口
interface GlobalSettings {
  language: string
  fontSize: number
  fontFamily: string
  terminalFontFamily: string
  terminalFontSize: number
  aiApis?: AIApiConfig[]
}

// 防抖工具函数
function debounce(
  fn: (settings: GlobalSettings) => Promise<void>,
  delay: number
): (settings: GlobalSettings) => void {
  let timer: NodeJS.Timeout | null = null
  return function (settings: GlobalSettings) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn(settings)
      timer = null
    }, delay)
  }
}

// 表单数据
const formData = ref<GlobalSettings>({
  language: 'zh-CN',
  fontSize: 14,
  fontFamily: 'system-ui',
  terminalFontFamily: 'Consolas, "Courier New", monospace',
  terminalFontSize: 14,
  aiApis: []
})

// 当前编辑的API配置
const currentApiConfig = ref<AIApiConfig | null>(null)
const showApiConfigDialog = ref(false)
const isEditingApi = ref(false)

// 安全的API配置属性访问
const apiName = computed({
  get: () => currentApiConfig.value?.name || '',
  set: (value) => { if (currentApiConfig.value) currentApiConfig.value.name = value }
})

const apiUrl = computed({
  get: () => currentApiConfig.value?.apiUrl || '',
  set: (value) => { if (currentApiConfig.value) currentApiConfig.value.apiUrl = value }
})

const apiKey = computed({
  get: () => currentApiConfig.value?.apiKey || '',
  set: (value) => { if (currentApiConfig.value) currentApiConfig.value.apiKey = value }
})

const modelName = computed({
  get: () => currentApiConfig.value?.modelName || '',
  set: (value) => { if (currentApiConfig.value) currentApiConfig.value.modelName = value }
})

// 字体大小选项
const fontSizeOptions = [
  { label: t('settings.fontSizes.small'), value: 12 },
  { label: t('settings.fontSizes.medium'), value: 14 },
  { label: t('settings.fontSizes.large'), value: 16 },
  { label: t('settings.fontSizes.extraLarge'), value: 18 }
]

// 终端字体大小选项
const terminalFontSizeOptions = [
  { label: t('settings.fontSizes.small'), value: 12 },
  { label: t('settings.fontSizes.medium'), value: 14 },
  { label: t('settings.fontSizes.large'), value: 16 },
  { label: t('settings.fontSizes.extraLarge'), value: 18 },
  { label: t('settings.fontSizes.huge'), value: 20 },
  { label: t('settings.fontSizes.extraHuge'), value: 24 }
]

// 语言选项
const languageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en-US' }
]

// 常用字体选项
const fontFamilyOptions = [
  { label: t('settings.fontFamilies.system'), value: 'system-ui' },
  { label: t('settings.fontFamilies.arial'), value: 'Arial' },
  { label: t('settings.fontFamilies.yahei'), value: 'Microsoft YaHei' },
  { label: t('settings.fontFamilies.source'), value: 'Noto Sans SC' },
  { label: t('settings.fontFamilies.roboto'), value: 'Roboto' }
]

// 终端字体选项
const terminalFontFamilyOptions = [
  { label: 'Consolas', value: 'Consolas, "Courier New", monospace' },
  { label: 'Courier New', value: '"Courier New", monospace' },
  { label: 'Menlo', value: 'Menlo, Monaco, "Courier New", monospace' },
  { label: 'Monaco', value: 'Monaco, "Courier New", monospace' },
  { label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { label: 'Fira Code', value: '"Fira Code", monospace' },
  { label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' }
]

// 加载设置
const loadSettings = async () => {
  try {
    const settings = await window.api.loadSettings()
    if (settings) {
      formData.value = {
        ...formData.value,
        ...settings,
        // 确保aiApis是数组
        aiApis: Array.isArray(settings.aiApis) ? settings.aiApis : []
      }
    }
  } catch (error) {
    console.error('加载设置失败:', error)
  }
}

// 实时保存设置
const saveSettingsRealtime = async (newSettings: GlobalSettings) => {
  try {
    // 创建一个干净的纯数据对象，避免Vue的响应式对象可能导致的序列化问题
    const cleanSettings: any = {
      language: newSettings.language,
      fontSize: newSettings.fontSize,
      fontFamily: newSettings.fontFamily,
      terminalFontFamily: newSettings.terminalFontFamily,
      terminalFontSize: newSettings.terminalFontSize
    }

    // 单独处理 aiApis 数组，确保每个对象都是纯数据对象
    if (Array.isArray(newSettings.aiApis)) {
      cleanSettings.aiApis = newSettings.aiApis.map(api => ({
        id: api.id,
        name: api.name,
        apiUrl: api.apiUrl,
        apiKey: api.apiKey,
        modelName: api.modelName
      }))
    } else {
      cleanSettings.aiApis = []
    }

    console.log('实时保存设置:', JSON.stringify(cleanSettings))
    const result = await window.api.saveSettings(cleanSettings)
    if (result) {
      console.log('设置已实时保存并应用')

      // 如果语言发生变化，更新i18n状态
      if (cleanSettings.language !== language.value) {
        setLanguage(cleanSettings.language)
      }
    } else {
      console.error('实时保存设置失败：返回结果为false')
    }
  } catch (error: Error | unknown) {
    console.error('实时保存设置出错:', error instanceof Error ? error.message : error)
  }
}

// 创建防抖版本的保存函数
const debouncedSaveSettings = debounce(saveSettingsRealtime, 500)

// 保存设置并关闭对话框
const saveSettings = async () => {
  try {
    // 创建一个干净的纯数据对象
    const cleanSettings: any = {
      language: formData.value.language,
      fontSize: formData.value.fontSize,
      fontFamily: formData.value.fontFamily,
      terminalFontFamily: formData.value.terminalFontFamily,
      terminalFontSize: formData.value.terminalFontSize
    }

    // 单独处理 aiApis 数组，确保每个对象都是纯数据对象
    if (Array.isArray(formData.value.aiApis)) {
      cleanSettings.aiApis = formData.value.aiApis.map(api => ({
        id: api.id,
        name: api.name,
        apiUrl: api.apiUrl,
        apiKey: api.apiKey,
        modelName: api.modelName
      }))
    } else {
      cleanSettings.aiApis = []
    }

    console.log('开始保存设置:', JSON.stringify(cleanSettings))
    // 直接保存，不使用防抖
    const result = await window.api.saveSettings(cleanSettings)

    if (result) {
      console.log('设置保存成功')

      // 如果语言发生变化，更新i18n状态
      if (cleanSettings.language !== language.value) {
        setLanguage(cleanSettings.language)
      }

      // 通知父组件
      emit('save', cleanSettings)
      // 关闭对话框
      emit('update:visible', false)
    } else {
      console.error('设置保存失败：返回结果为false')
      alert(t('settings.saveError'))
    }
  } catch (error: Error | unknown) {
    console.error('保存设置出错:', error)
    alert(
      `${t('settings.saveError')}: ${error instanceof Error ? error.message : t('common.unknown')}`
    )
  }
}

// 取消
const cancelSettings = () => {
  emit('cancel')
  emit('update:visible', false)
}

// 添加新的API配置
const addApiConfig = () => {
  currentApiConfig.value = {
    id: Date.now().toString(),
    name: '',
    apiUrl: '',
    apiKey: '',
    modelName: ''
  }
  isEditingApi.value = false
  showApiConfigDialog.value = true
}

// 编辑API配置
const editApiConfig = (api: AIApiConfig) => {
  currentApiConfig.value = { ...api }
  isEditingApi.value = true
  showApiConfigDialog.value = true
}

// 删除API配置
const deleteApiConfig = (id: string) => {
  if (confirm(t('settings.aiApi.deleteConfirm'))) {
    formData.value.aiApis = formData.value.aiApis?.filter(api => api.id !== id) || []
    debouncedSaveSettings(formData.value)
  }
}

// 保存API配置
const saveApiConfig = () => {
  if (!currentApiConfig.value) return
  
  if (!currentApiConfig.value.name.trim()) {
    alert(t('settings.aiApi.nameRequired'))
    return
  }

  if (!formData.value.aiApis) {
    formData.value.aiApis = []
  }

  if (isEditingApi.value) {
    // 更新现有配置
    const index = formData.value.aiApis.findIndex(api => api.id === currentApiConfig.value?.id)
    if (index !== -1) {
      formData.value.aiApis[index] = { ...currentApiConfig.value }
    }
  } else {
    // 添加新配置
    formData.value.aiApis.push({ ...currentApiConfig.value })
  }

  showApiConfigDialog.value = false
  currentApiConfig.value = null
  debouncedSaveSettings(formData.value)
}

// 取消API配置编辑
const cancelApiConfig = () => {
  showApiConfigDialog.value = false
  currentApiConfig.value = null
}

// 监听设置变更
watch(
  () => formData.value,
  (newValue) => {
    debouncedSaveSettings(newValue)
  },
  { deep: true }
)

// 监听visible变化
watch(
  () => props.visible,
  (newValue) => {
    if (newValue) {
      loadSettings()
    }
  }
)

// 组件挂载时加载设置
onMounted(() => {
  if (props.visible) {
    loadSettings()
  }
})
</script>

<template>
  <teleport to="body">
    <div
      v-if="visible"
      class="dialog-overlay"
      :class="{ 'dark-theme': isDarkTheme }"
      @click.self="cancelSettings"
    >
      <div class="dialog-container" :class="{ 'dark-theme': isDarkTheme }">
        <div class="dialog-header">
          <h3>{{ t('settings.title') }}</h3>
          <button class="close-button" @click="cancelSettings">&times;</button>
        </div>

        <div class="dialog-body">
          <div class="form">
            <!-- 语言设置 -->
            <div class="form-input">
              <label for="language">{{ t('settings.language') }}</label>
              <select id="language" v-model="formData.language" class="settings-select">
                <option v-for="option in languageOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </option>
              </select>
            </div>

            <!-- 字体大小设置 -->
            <div class="form-input">
              <label for="fontSize">{{ t('settings.fontSize') }}</label>
              <select id="fontSize" v-model="formData.fontSize" class="settings-select">
                <option v-for="option in fontSizeOptions" :key="option.value" :value="option.value">
                  {{ option.label }} ({{ option.value }}px)
                </option>
              </select>
            </div>

            <!-- 字体设置 -->
            <div class="form-input">
              <label for="fontFamily">{{ t('settings.fontFamily') }}</label>
              <select id="fontFamily" v-model="formData.fontFamily" class="settings-select">
                <option
                  v-for="option in fontFamilyOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <!-- 终端字体大小设置 -->
            <div class="form-input">
              <label for="terminalFontSize">{{ t('settings.terminalFontSize') }}</label>
              <select
                id="terminalFontSize"
                v-model="formData.terminalFontSize"
                class="settings-select"
              >
                <option
                  v-for="option in terminalFontSizeOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }} ({{ option.value }}px)
                </option>
              </select>
            </div>

            <!-- 终端字体设置 -->
            <div class="form-input">
              <label for="terminalFontFamily">{{ t('settings.terminalFontFamily') }}</label>
              <select
                id="terminalFontFamily"
                v-model="formData.terminalFontFamily"
                class="settings-select"
              >
                <option
                  v-for="option in terminalFontFamilyOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>

            <!-- AI API配置列表 -->
            <div class="form-section">
              <div class="section-header">
                <h4>{{ t('settings.aiApi.title') }}</h4>
                <button class="add-button" @click="addApiConfig">{{ t('settings.aiApi.add') }}</button>
              </div>
              
              <div class="api-list">
                <div v-if="!formData.aiApis || formData.aiApis.length === 0" class="no-apis">
                  {{ t('settings.aiApi.noApis') }}
                </div>
                <div v-else v-for="api in formData.aiApis" :key="api.id" class="api-item">
                  <div class="api-info">
                    <div class="api-name">{{ api.name }}</div>
                    <div class="api-url">{{ api.apiUrl }}</div>
                  </div>
                  <div class="api-actions">
                    <button class="edit-button" @click="editApiConfig(api)">{{ t('common.edit') }}</button>
                    <button class="delete-button" @click="deleteApiConfig(api.id)">{{ t('common.delete') }}</button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="cancel-button" @click="cancelSettings">{{ t('common.cancel') }}</button>
          <button class="save-button" @click="saveSettings">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>

    <!-- API配置对话框 -->
    <div
      v-if="showApiConfigDialog"
      class="dialog-overlay"
      :class="{ 'dark-theme': isDarkTheme }"
      @click.self="cancelApiConfig"
    >
      <div class="api-dialog-container" :class="{ 'dark-theme': isDarkTheme }">
        <div class="dialog-header">
          <h3>{{ isEditingApi ? t('settings.aiApi.edit') : t('settings.aiApi.add') }}</h3>
          <button class="close-button" @click="cancelApiConfig">&times;</button>
        </div>

        <div class="dialog-body">
          <div class="form">
            <div class="form-input">
              <label for="api-name">{{ t('settings.aiApi.name') }}</label>
              <input
                id="api-name"
                v-model="apiName"
                type="text"
                class="settings-input"
                :placeholder="t('settings.aiApi.namePlaceholder')"
              />
            </div>

            <div class="form-input">
              <label for="api-url">{{ t('settings.aiApi.url') }}</label>
              <input
                id="api-url"
                v-model="apiUrl"
                type="text"
                class="settings-input"
                :placeholder="t('settings.aiApi.urlPlaceholder')"
              />
            </div>

            <div class="form-input">
              <label for="api-key">{{ t('settings.aiApi.key') }}</label>
              <input
                id="api-key"
                v-model="apiKey"
                type="password"
                class="settings-input"
                :placeholder="t('settings.aiApi.keyPlaceholder')"
              />
            </div>

            <div class="form-input">
              <label for="model-name">{{ t('settings.aiApi.model') }}</label>
              <input
                id="model-name"
                v-model="modelName"
                type="text"
                class="settings-input"
                :placeholder="t('settings.aiApi.modelPlaceholder')"
              />
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="cancel-button" @click="cancelApiConfig">{{ t('common.cancel') }}</button>
          <button class="save-button" @click="saveApiConfig">{{ t('common.save') }}</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 99999;
  backdrop-filter: blur(3px);
}

.dialog-overlay.dark-theme {
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
}

.dialog-container {
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  width: 500px;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.api-dialog-container {
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  width: 400px;
  max-width: 90vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dark-theme .dialog-container,
.dark-theme .api-dialog-container {
  background-color: #272727;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  padding: 15px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e0e0e0;
}

.dark-theme .dialog-header {
  border-bottom: 1px solid #444;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 500;
  color: #333;
}

.dark-theme .dialog-header h3 {
  color: #fff;
}

.close-button {
  background: none;
  border: none;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  color: #999;
  padding: 0;
  height: 24px;
  width: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-button:hover {
  background-color: rgba(0, 0, 0, 0.1);
  color: #666;
}

.dark-theme .close-button {
  color: #aaa;
}

.dark-theme .close-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ddd;
}

.dialog-body {
  padding: 15px;
  overflow-y: auto;
  flex: 1;
}

.dialog-footer {
  padding: 15px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid #e0e0e0;
}

.dark-theme .dialog-footer {
  border-top: 1px solid #444;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.form-input {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-section {
  margin-top: 10px;
  border-top: 1px solid #e0e0e0;
  padding-top: 15px;
}

.dark-theme .form-section {
  border-top: 1px solid #444;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.section-header h4 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: #333;
}

.dark-theme .section-header h4 {
  color: #fff;
}

.form-input label {
  font-size: 14px;
  color: #555;
}

.dark-theme .form-input label {
  color: #ccc;
}

.settings-select,
.settings-input {
  padding: 8px 10px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  font-size: 14px;
  background-color: #fff;
  color: #333;
  transition: all 0.2s;
}

.settings-select {
  cursor: pointer;
}

.dark-theme .settings-select,
.dark-theme .settings-input {
  background-color: #333;
  border-color: #555;
  color: #eee;
}

.settings-select:focus,
.settings-input:focus {
  border-color: #4d90fe;
  outline: none;
  box-shadow: 0 0 0 2px rgba(77, 144, 254, 0.2);
}

.dark-theme .settings-select:focus,
.dark-theme .settings-input:focus {
  border-color: #1a73e8;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
}

.cancel-button,
.save-button,
.add-button,
.edit-button,
.delete-button {
  padding: 8px 16px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s;
}

.cancel-button {
  background-color: #f5f5f5;
  border: 1px solid #d0d0d0;
  color: #555;
}

.save-button,
.add-button {
  background-color: #4d90fe;
  border: 1px solid #3c78dc;
  color: white;
}

.edit-button {
  background-color: #4caf50;
  border: 1px solid #388e3c;
  color: white;
  padding: 4px 8px;
  font-size: 12px;
}

.delete-button {
  background-color: #f44336;
  border: 1px solid #d32f2f;
  color: white;
  padding: 4px 8px;
  font-size: 12px;
}

.add-button {
  padding: 4px 8px;
  font-size: 12px;
}

.cancel-button:hover {
  background-color: #e5e5e5;
}

.save-button:hover,
.add-button:hover {
  background-color: #3c78dc;
}

.edit-button:hover {
  background-color: #388e3c;
}

.delete-button:hover {
  background-color: #d32f2f;
}

.dark-theme .cancel-button {
  background-color: #444;
  border: 1px solid #555;
  color: #eee;
}

.dark-theme .save-button,
.dark-theme .add-button {
  background-color: #1a73e8;
  border: 1px solid #1967d2;
}

.dark-theme .edit-button {
  background-color: #388e3c;
  border: 1px solid #2e7d32;
}

.dark-theme .delete-button {
  background-color: #d32f2f;
  border: 1px solid #c62828;
}

.dark-theme .cancel-button:hover {
  background-color: #555;
}

.dark-theme .save-button:hover,
.dark-theme .add-button:hover {
  background-color: #1967d2;
}

.dark-theme .edit-button:hover {
  background-color: #2e7d32;
}

.dark-theme .delete-button:hover {
  background-color: #c62828;
}

.api-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 10px;
}

.no-apis {
  color: #888;
  font-style: italic;
  text-align: center;
  padding: 10px;
}

.dark-theme .no-apis {
  color: #aaa;
}

.api-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background-color: #f9f9f9;
}

.dark-theme .api-item {
  border-color: #444;
  background-color: #333;
}

.api-info {
  flex: 1;
}

.api-name {
  font-weight: 500;
  margin-bottom: 4px;
}

.api-url {
  font-size: 12px;
  color: #666;
  word-break: break-all;
}

.dark-theme .api-url {
  color: #aaa;
}

.api-actions {
  display: flex;
  gap: 5px;
}
</style>

