<script setup lang="ts">
import { ref, watch, onMounted, nextTick } from 'vue'
import { useI18n } from '../i18n'

// 使用i18n
const { t } = useI18n()

interface Connection {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  privateKeyPath?: string
  description?: string
}

interface Organization {
  id: string
  name: string
  connections: Connection[]
}

const props = defineProps<{
  visible: boolean
  editType: 'organization' | 'connection'
  organizationId: string | null
  connectionId: string | null
  organizations: Organization[]
  isDarkTheme: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'save', data: { organizationId: string | null; connectionId: string | null; formData: any }): void
  (e: 'cancel'): void
}>()

// 表单数据
const formData = ref<{
  name: string
  host?: string
  port?: number
  username?: string
  password?: string
  privateKey?: string
  privateKeyPath?: string
  description?: string
}>({
  name: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  privateKeyPath: '',
  description: ''
})

// 表单验证状态
const formErrors = ref<{
  name?: string
  host?: string
  port?: string
  username?: string
}>({})

// 对话框标题
const dialogTitle = ref('')

// 当前操作是新建还是编辑
const isCreating = ref(true)

// 密码输入框类型（明文/密文）
const passwordType = ref('password')

// 私钥文件选择状态
const privateKeyFilename = ref('')
const fileSelectError = ref('')
const isLoadingFile = ref(false)

// 切换密码显示/隐藏
const togglePasswordVisibility = () => {
  passwordType.value = passwordType.value === 'password' ? 'text' : 'password'
}

// 选择私钥文件
const selectPrivateKeyFile = async () => {
  try {
    isLoadingFile.value = true
    fileSelectError.value = ''
    
    const result = await window.api.openFileDialog({
      title: '选择SSH私钥文件',
      buttonLabel: '选择私钥'
    })
    
    if (!result.canceled && result.filePath) {
      privateKeyFilename.value = result.filePath.split(/[/\\]/).pop() || '未知文件'
      
      if (result.fileContent) {
        formData.value.privateKey = result.fileContent
        formData.value.privateKeyPath = result.filePath
      } else if (result.error) {
        fileSelectError.value = result.error
      }
    }
  } catch (error: any) {
    fileSelectError.value = `文件选择错误: ${error.message}`
    console.error('选择私钥文件失败:', error)
  } finally {
    isLoadingFile.value = false
  }
}

// 清除私钥
const clearPrivateKey = () => {
  formData.value.privateKey = ''
  formData.value.privateKeyPath = ''
  privateKeyFilename.value = ''
  fileSelectError.value = ''
}

// 初始化表单数据
const initFormData = () => {
  // 重置表单数据
  formData.value = {
    name: '',
    host: '',
    port: 22,
    username: '',
    password: '',
    privateKey: '',
    privateKeyPath: '',
    description: ''
  }
  
  // 重置文件选择状态
  privateKeyFilename.value = ''
  fileSelectError.value = ''
  
  // 重置表单错误
  formErrors.value = {}
  
  // 根据编辑类型设置对话框标题
  if (props.editType === 'organization') {
    dialogTitle.value = isCreating.value ? t('connection.newOrganization') : t('connection.editOrganization')
    
    // 如果是编辑现有组织
    if (!isCreating.value && props.organizationId) {
      const org = props.organizations.find(o => o.id === props.organizationId)
      if (org) {
        formData.value.name = org.name
      }
    }
  } else {
    dialogTitle.value = isCreating.value ? t('connection.newConnection') : t('connection.editConnection')
    
    // 如果是编辑现有连接
    if (!isCreating.value && props.organizationId && props.connectionId) {
      const org = props.organizations.find(o => o.id === props.organizationId)
      if (org) {
        const conn = org.connections.find(c => c.id === props.connectionId)
        if (conn) {
          formData.value = { ...conn }
          
          // 如果有私钥，设置文件名显示
          if (conn.privateKey && conn.privateKeyPath) {
            privateKeyFilename.value = conn.privateKeyPath.split(/[/\\]/).pop() || t('connection.savedPrivateKey')
          } else if (conn.privateKey) {
            privateKeyFilename.value = t('connection.savedPrivateKey')
          }
        }
      }
    }
  }
}

// 验证表单
const validateForm = (): boolean => {
  formErrors.value = {}
  let isValid = true
  
  // 名称是必填的
  if (!formData.value.name.trim()) {
    formErrors.value.name = `${t('connection.name')}${t('connection.required')}`
    isValid = false
  }
  
  // 如果是连接表单，还需要验证其他字段
  if (props.editType === 'connection') {
    if (!formData.value.host?.trim()) {
      formErrors.value.host = `${t('connection.host')}${t('connection.required')}`
      isValid = false
    }
    
    if (!formData.value.port || formData.value.port <= 0 || formData.value.port > 65535) {
      formErrors.value.port = t('connection.portRange')
      isValid = false
    }
    
    if (!formData.value.username?.trim()) {
      formErrors.value.username = `${t('connection.username')}${t('connection.required')}`
      isValid = false
    }
  }
  
  return isValid
}

// 保存表单
const saveForm = () => {
  if (!validateForm()) {
    console.log('表单验证失败')
    return
  }
  
  console.log('表单验证成功，准备保存:', {
    organizationId: props.organizationId,
    connectionId: props.connectionId,
    formData: { ...formData.value }
  })
  
  emit('save', {
    organizationId: props.organizationId,
    connectionId: props.connectionId,
    formData: { ...formData.value }
  })
  
  console.log('已触发save事件')
  
  emit('update:visible', false)
}

// 取消
const cancelForm = () => {
  emit('cancel')
  emit('update:visible', false)
}

// 监听visible属性变化
watch(() => props.visible, (newValue) => {
  if (newValue) {
    // 对话框显示时初始化表单
    isCreating.value = !(
      (props.editType === 'organization' && props.organizationId) ||
      (props.editType === 'connection' && props.connectionId)
    )
    initFormData()
    
    // 在下一个DOM更新周期聚焦第一个输入框
    nextTick(() => {
      const firstInput = document.querySelector('.form-input:first-child input')
      if (firstInput instanceof HTMLInputElement) {
        firstInput.focus()
      }
    })
  }
})

// 组件挂载时初始化表单
onMounted(() => {
  if (props.visible) {
    isCreating.value = !(
      (props.editType === 'organization' && props.organizationId) ||
      (props.editType === 'connection' && props.connectionId)
    )
    initFormData()
  }
})
</script>

<template>
  <teleport to="body">
    <div class="dialog-overlay" v-if="visible" :class="{ 'dark-theme': isDarkTheme }" @click.self="cancelForm">
      <div class="dialog-container" :class="{ 'dark-theme': isDarkTheme, 'dialog-large': editType === 'connection' }">
        <div class="dialog-header">
          <h3>{{ dialogTitle }}</h3>
          <button class="close-button" @click="cancelForm">&times;</button>
        </div>
        
        <div class="dialog-body">
          <!-- 组织表单 -->
          <div v-if="editType === 'organization'" class="form">
            <div class="form-input">
              <label for="name">组织名称 <span class="required">*</span></label>
              <input 
                id="name" 
                type="text" 
                v-model="formData.name" 
                :class="{ 'error': formErrors.name }"
                placeholder="请输入组织名称"
              />
              <div class="error-message" v-if="formErrors.name">{{ formErrors.name }}</div>
            </div>
          </div>
          
          <!-- 连接表单 -->
          <div v-else class="form">
            <div class="form-input">
              <label for="name">连接名称 <span class="required">*</span></label>
              <input 
                id="name" 
                type="text" 
                v-model="formData.name" 
                :class="{ 'error': formErrors.name }"
                placeholder="请输入连接名称"
              />
              <div class="error-message" v-if="formErrors.name">{{ formErrors.name }}</div>
            </div>
            
            <div class="form-input">
              <label for="host">主机地址 <span class="required">*</span></label>
              <input 
                id="host" 
                type="text" 
                v-model="formData.host" 
                :class="{ 'error': formErrors.host }"
                placeholder="例如: 127.0.0.1 或 example.com"
              />
              <div class="error-message" v-if="formErrors.host">{{ formErrors.host }}</div>
            </div>
            
            <div class="form-input">
              <label for="port">端口 <span class="required">*</span></label>
              <input 
                id="port" 
                type="number" 
                v-model.number="formData.port" 
                :class="{ 'error': formErrors.port }"
                min="1" 
                max="65535"
                placeholder="SSH默认端口为22"
              />
              <div class="error-message" v-if="formErrors.port">{{ formErrors.port }}</div>
            </div>
            
            <div class="form-input">
              <label for="username">用户名 <span class="required">*</span></label>
              <input 
                id="username" 
                type="text" 
                v-model="formData.username" 
                :class="{ 'error': formErrors.username }"
                placeholder="例如: root"
              />
              <div class="error-message" v-if="formErrors.username">{{ formErrors.username }}</div>
            </div>
            
            <div class="form-input password-input">
              <label for="password">密码</label>
              <div class="password-container">
                <input 
                  id="password" 
                  :type="passwordType" 
                  v-model="formData.password"
                  placeholder="密码和密钥至少填写一个"
                />
                <button 
                  type="button" 
                  class="toggle-password" 
                  @click="togglePasswordVisibility"
                >
                  {{ passwordType === 'password' ? '显示' : '隐藏' }}
                </button>
              </div>
            </div>
            
            <div class="form-input">
              <label>私钥文件</label>
              <div class="file-selector">
                <div class="file-input-container">
                  <div class="file-info" :class="{ 'has-file': !!privateKeyFilename }">
                    <span v-if="privateKeyFilename" class="file-name" :title="formData.privateKeyPath">
                      {{ privateKeyFilename }}
                    </span>
                    <span v-else class="placeholder">选择或拖放私钥文件</span>
                  </div>
                  
                  <div class="file-actions">
                    <button 
                      type="button" 
                      class="file-button" 
                      @click="selectPrivateKeyFile"
                      :disabled="isLoadingFile"
                    >
                      {{ isLoadingFile ? '加载中...' : '选择文件' }}
                    </button>
                    
                    <button 
                      v-if="formData.privateKey" 
                      type="button" 
                      class="file-button clear-button" 
                      @click="clearPrivateKey"
                    >
                      清除
                    </button>
                  </div>
                </div>
                
                <div v-if="fileSelectError" class="error-message file-error">
                  {{ fileSelectError }}
                </div>
              </div>
            </div>
            
            <div class="form-input">
              <label for="description">描述</label>
              <textarea 
                id="description" 
                v-model="formData.description"
                placeholder="可选，添加对此连接的描述"
                rows="2"
              ></textarea>
            </div>
          </div>
        </div>
        
        <div class="dialog-footer">
          <button class="cancel-button" @click="cancelForm">取消</button>
          <button class="save-button" @click="saveForm">保存</button>
        </div>
      </div>
    </div>
  </teleport>
</template>

<style>
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

.dialog-large {
  width: 500px;
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

.form-input input, 
.form-input textarea {
  padding: 8px 10px;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  font-size: 14px;
  transition: all 0.2s;
}

.dark-theme .form-input input, 
.dark-theme .form-input textarea {
  background-color: #333;
  border: 1px solid #555;
  color: #eee;
}

.form-input input:focus, 
.form-input textarea:focus {
  border-color: #4d90fe;
  outline: none;
  box-shadow: 0 0 0 2px rgba(77, 144, 254, 0.2);
}

.dark-theme .form-input input:focus, 
.dark-theme .form-input textarea:focus {
  border-color: #1a73e8;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
}

.form-input input.error, 
.form-input textarea.error {
  border-color: #f44336;
}

.form-input input.error:focus, 
.form-input textarea.error:focus {
  box-shadow: 0 0 0 2px rgba(244, 67, 54, 0.2);
}

.required {
  color: #f44336;
}

.error-message {
  font-size: 12px;
  color: #f44336;
  margin-top: 4px;
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

/* 密码输入框特殊样式 */
.password-container {
  position: relative;
  display: flex;
}

.password-container input {
  flex: 1;
  padding-right: 70px; /* 为按钮留出空间 */
}

.toggle-password {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  border: none;
  background: none;
  padding: 0 10px;
  cursor: pointer;
  color: #666;
  font-size: 12px;
  border-radius: 0 4px 4px 0;
  transition: all 0.2s;
}

.toggle-password:hover {
  background-color: rgba(0, 0, 0, 0.05);
}

.dark-theme .toggle-password {
  color: #bbb;
}

.dark-theme .toggle-password:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

/* 文件选择器样式 */
.file-selector {
  width: 100%;
}

.file-input-container {
  display: flex;
  align-items: center;
  width: 100%;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  overflow: hidden;
  transition: all 0.2s;
}

.dark-theme .file-input-container {
  background-color: #333;
  border: 1px solid #555;
}

.file-input-container:focus-within {
  border-color: #4d90fe;
  box-shadow: 0 0 0 2px rgba(77, 144, 254, 0.2);
}

.dark-theme .file-input-container:focus-within {
  border-color: #1a73e8;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
}

.file-info {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  flex: 1;
  min-width: 0;
  color: #999;
}

.file-info.has-file {
  color: #333;
}

.dark-theme .file-info {
  color: #777;
}

.dark-theme .file-info.has-file {
  color: #eee;
}

.file-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 14px;
}

.placeholder {
  color: #999;
  font-size: 14px;
}

.dark-theme .placeholder {
  color: #777;
}

.file-actions {
  display: flex;
  gap: 4px;
  margin-left: auto;
  padding-right: 4px;
}

.file-button {
  padding: 6px 12px;
  background-color: #f5f5f5;
  border: 1px solid #d0d0d0;
  border-radius: 4px;
  color: #555;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}

.file-button:hover:not(:disabled) {
  background-color: #e5e5e5;
}

.file-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.dark-theme .file-button {
  background-color: #444;
  border: 1px solid #555;
  color: #eee;
}

.dark-theme .file-button:hover:not(:disabled) {
  background-color: #555;
}

.clear-button {
  color: #f44336;
}

.dark-theme .clear-button {
  color: #ff6b6b;
}

.file-error {
  margin-top: 4px;
}
</style> 