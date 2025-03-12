<!-- 全局设置对话框 -->
<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
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

// 全局设置接口
interface GlobalSettings {
  language: string
  fontSize: number
  fontFamily: string
  terminalFontFamily: string
  terminalFontSize: number
}

// 防抖工具函数
function debounce<T extends (...args: any[]) => any>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout | null = null
  return function(this: any, ...args: Parameters<T>) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      fn.apply(this, args)
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
  terminalFontSize: 14
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
        ...settings
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
    const cleanSettings = {
      language: newSettings.language,
      fontSize: newSettings.fontSize,
      fontFamily: newSettings.fontFamily,
      terminalFontFamily: newSettings.terminalFontFamily,
      terminalFontSize: newSettings.terminalFontSize
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
  } catch (error: any) {
    console.error('实时保存设置出错:', error?.message || error)
  }
}

// 创建防抖版本的保存函数
const debouncedSaveSettings = debounce(saveSettingsRealtime, 500)

// 保存设置并关闭对话框
const saveSettings = async () => {
  try {
    // 创建一个干净的纯数据对象
    const cleanSettings = {
      language: formData.value.language,
      fontSize: formData.value.fontSize,
      fontFamily: formData.value.fontFamily,
      terminalFontFamily: formData.value.terminalFontFamily,
      terminalFontSize: formData.value.terminalFontSize
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
  } catch (error: any) {
    console.error('保存设置出错:', error)
    alert(`${t('settings.saveError')}: ${error?.message || t('common.unknown')}`)
  }
}

// 取消
const cancelSettings = () => {
  emit('cancel')
  emit('update:visible', false)
}

// 监听设置变更
watch(() => formData.value, (newValue) => {
  debouncedSaveSettings(newValue)
}, { deep: true })

// 监听visible变化
watch(() => props.visible, (newValue) => {
  if (newValue) {
    loadSettings()
  }
})

// 组件挂载时加载设置
onMounted(() => {
  if (props.visible) {
    loadSettings()
  }
})
</script>

<template>
  <teleport to="body">
    <div class="dialog-overlay" v-if="visible" :class="{ 'dark-theme': isDarkTheme }" @click.self="cancelSettings">
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
              <select 
                id="language" 
                v-model="formData.language"
                class="settings-select"
              >
                <option 
                  v-for="option in languageOptions" 
                  :key="option.value" 
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
            
            <!-- 字体大小设置 -->
            <div class="form-input">
              <label for="fontSize">{{ t('settings.fontSize') }}</label>
              <select 
                id="fontSize" 
                v-model="formData.fontSize"
                class="settings-select"
              >
                <option 
                  v-for="option in fontSizeOptions" 
                  :key="option.value" 
                  :value="option.value"
                >
                  {{ option.label }} ({{ option.value }}px)
                </option>
              </select>
            </div>
            
            <!-- 字体设置 -->
            <div class="form-input">
              <label for="fontFamily">{{ t('settings.fontFamily') }}</label>
              <select 
                id="fontFamily" 
                v-model="formData.fontFamily"
                class="settings-select"
              >
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
          </div>
        </div>
        
        <div class="dialog-footer">
          <button class="cancel-button" @click="cancelSettings">{{ t('common.cancel') }}</button>
          <button class="save-button" @click="saveSettings">{{ t('common.save') }}</button>
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
  width: 400px;
  max-width: 90vw;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dark-theme .dialog-container {
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

.form-input label {
  font-size: 14px;
  color: #555;
}

.dark-theme .form-input label {
  color: #ccc;
}

.settings-select {
  padding: 8px 10px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  font-size: 14px;
  background-color: #fff;
  color: #333;
  cursor: pointer;
  transition: all 0.2s;
}

.dark-theme .settings-select {
  background-color: #333;
  border-color: #555;
  color: #eee;
}

.settings-select:focus {
  border-color: #4d90fe;
  outline: none;
  box-shadow: 0 0 0 2px rgba(77, 144, 254, 0.2);
}

.dark-theme .settings-select:focus {
  border-color: #1a73e8;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
}

.cancel-button, 
.save-button {
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

.save-button {
  background-color: #4d90fe;
  border: 1px solid #3c78dc;
  color: white;
}

.cancel-button:hover {
  background-color: #e5e5e5;
}

.save-button:hover {
  background-color: #3c78dc;
}

.dark-theme .cancel-button {
  background-color: #444;
  border: 1px solid #555;
  color: #eee;
}

.dark-theme .save-button {
  background-color: #1a73e8;
  border: 1px solid #1967d2;
}

.dark-theme .cancel-button:hover {
  background-color: #555;
}

.dark-theme .save-button:hover {
  background-color: #1967d2;
}
</style> 