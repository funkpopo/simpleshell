<template>
  <div class="ssh-advanced-settings">
    <h3>{{ t('connection.advancedSettings') }}</h3>
    
    <div class="settings-section">
      <h4>{{ t('connection.proxySettings') }}</h4>
      
      <div class="checkbox-container">
        <input type="checkbox" id="enable-proxy" v-model="enableProxy" @change="updateProxyStatus">
        <label for="enable-proxy">{{ t('connection.enableProxy') }}</label>
      </div>
      
      <div class="settings-form" v-if="enableProxy">
        <div class="form-group">
          <label for="proxy-type">{{ t('connection.proxyType') }}</label>
          <select id="proxy-type" v-model="proxyType" @change="updateProxy">
            <option value="http">HTTP</option>
            <option value="socks">SOCKS</option>
          </select>
        </div>
        
        <div class="form-group">
          <label for="proxy-host">{{ t('connection.proxyHost') }}</label>
          <input type="text" id="proxy-host" v-model="proxyHost" placeholder="127.0.0.1" @input="updateProxy">
        </div>
        
        <div class="form-group">
          <label for="proxy-port">{{ t('connection.proxyPort') }}</label>
          <input type="number" id="proxy-port" v-model.number="proxyPort" placeholder="8080" @input="updateProxy">
        </div>
      </div>
    </div>
    
    <div class="settings-section">
      <h4>{{ t('connection.keepAliveSettings') }}</h4>
      
      <div class="checkbox-container">
        <input type="checkbox" id="enable-keep-alive" v-model="enableKeepAlive" @change="updateKeepAliveStatus">
        <label for="enable-keep-alive">{{ t('connection.enableKeepAlive') }}</label>
      </div>
      
      <div class="settings-form" v-if="enableKeepAlive">
        <div class="form-group">
          <label for="keep-alive-interval">{{ t('connection.keepAliveInterval') }}</label>
          <div class="interval-input-container">
            <input 
              type="number" 
              id="keep-alive-interval" 
              v-model.number="keepAliveInterval" 
              min="30" 
              max="3600" 
              @input="updateKeepAliveInterval"
            >
            <span class="interval-unit">{{ t('connection.seconds') }}</span>
          </div>
          <small class="form-hint">{{ t('connection.keepAliveIntervalHint') }}</small>
        </div>
      </div>
    </div>
    
    <div class="settings-actions">
      <button class="btn btn-primary" @click="applySettings">{{ t('common.apply') }}</button>
      <button class="btn btn-secondary" @click="resetSettings">{{ t('common.reset') }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from '../i18n'

const { t } = useI18n()

// 代理设置
const enableProxy = ref(false)
const proxyType = ref<'http' | 'socks'>('http')
const proxyHost = ref('127.0.0.1')
const proxyPort = ref(8080)

// 保持连接活跃设置
const enableKeepAlive = ref(true)
const keepAliveInterval = ref(120)

// 组件挂载时检查是否有已设置的代理和活跃连接设置
onMounted(async () => {
  try {
    // 加载代理设置
    const { proxy } = await window.api.getManualProxy()
    if (proxy) {
      enableProxy.value = true
      proxyType.value = proxy.type as 'http' | 'socks'
      proxyHost.value = proxy.host
      proxyPort.value = proxy.port
    }
    
    // 加载保持连接设置
    const settings = await window.api.loadSettings()
    if (settings && settings.sshKeepAlive !== undefined) {
      enableKeepAlive.value = settings.sshKeepAlive.enabled !== false
      if (settings.sshKeepAlive.interval && settings.sshKeepAlive.interval >= 30) {
        keepAliveInterval.value = Math.floor(settings.sshKeepAlive.interval / 1000) // 转换毫秒为秒
      }
    }
  } catch (error) {
    console.error('获取设置失败:', error)
  }
})

// 更新代理启用状态
const updateProxyStatus = async () => {
  if (enableProxy.value) {
    await updateProxy()
  } else {
    try {
      await window.api.clearManualProxy()
      console.log('已清除代理设置')
    } catch (error) {
      console.error('清除代理设置失败:', error)
    }
  }
}

// 更新代理设置
const updateProxy = async () => {
  if (!enableProxy.value) return
  
  if (!proxyHost.value || !proxyPort.value) {
    console.error('代理主机和端口不能为空')
    return
  }
  
  try {
    await window.api.setManualProxy({
      host: proxyHost.value,
      port: proxyPort.value,
      type: proxyType.value
    })
    console.log('已更新代理设置:', proxyType.value, proxyHost.value, proxyPort.value)
  } catch (error) {
    console.error('设置代理失败:', error)
  }
}

// 更新保持连接状态
const updateKeepAliveStatus = async () => {
  try {
    const settings = await window.api.loadSettings()
    const updatedSettings = {
      ...settings,
      sshKeepAlive: {
        enabled: enableKeepAlive.value,
        interval: keepAliveInterval.value * 1000 // 转换秒为毫秒
      }
    }
    await window.api.saveSettings(updatedSettings)
    console.log('已更新保持连接设置:', enableKeepAlive.value, keepAliveInterval.value)
  } catch (error) {
    console.error('更新保持连接设置失败:', error)
  }
}

// 更新保持连接间隔
const updateKeepAliveInterval = async () => {
  if (!enableKeepAlive.value) return
  
  // 确保值在合理范围内
  if (keepAliveInterval.value < 30) keepAliveInterval.value = 30
  if (keepAliveInterval.value > 3600) keepAliveInterval.value = 3600
  
  try {
    const settings = await window.api.loadSettings()
    const updatedSettings = {
      ...settings,
      sshKeepAlive: {
        enabled: true,
        interval: keepAliveInterval.value * 1000 // 转换秒为毫秒
      }
    }
    await window.api.saveSettings(updatedSettings)
    console.log('已更新保持连接间隔:', keepAliveInterval.value)
  } catch (error) {
    console.error('更新保持连接间隔失败:', error)
  }
}

// 应用设置
const applySettings = async () => {
  if (enableProxy.value) {
    await updateProxy()
  } else {
    await window.api.clearManualProxy()
  }
  
  // 更新保持连接设置
  await updateKeepAliveStatus()
}

// 重置设置
const resetSettings = async () => {
  enableProxy.value = false
  proxyType.value = 'http'
  proxyHost.value = '127.0.0.1'
  proxyPort.value = 8080
  await window.api.clearManualProxy()
  
  // 重置保持连接设置为默认值
  enableKeepAlive.value = true
  keepAliveInterval.value = 120
  await updateKeepAliveStatus()
}
</script>

<style scoped>
.ssh-advanced-settings {
  padding: 15px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  margin-bottom: 20px;
}

h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 16px;
  color: var(--heading-color);
}

h4 {
  margin-top: 0;
  margin-bottom: 10px;
  font-size: 14px;
  color: var(--heading-color);
}

.settings-section {
  margin-bottom: 20px;
}

.checkbox-container {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.checkbox-container input[type="checkbox"] {
  margin-right: 8px;
}

.settings-form {
  background-color: var(--bg-lighter);
  padding: 10px;
  border-radius: 4px;
  margin-top: 10px;
}

.form-group {
  margin-bottom: 10px;
}

.form-group label {
  display: block;
  margin-bottom: 5px;
  font-size: 13px;
  color: var(--text-color);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  border-radius: 3px;
  background-color: var(--input-bg);
  color: var(--text-color);
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.btn {
  padding: 6px 12px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
}

.btn-primary {
  background-color: var(--primary-color);
  color: white;
}

.btn-secondary {
  background-color: var(--secondary-color);
  color: var(--text-color);
}

.interval-input-container {
  display: flex;
  align-items: center;
}

.interval-unit {
  margin-left: 8px;
  color: var(--text-color);
}

.form-hint {
  display: block;
  margin-top: 5px;
  font-size: 12px;
  color: var(--hint-color);
  font-style: italic;
}

:root {
  --border-color: #e0e0e0;
  --heading-color: #333;
  --bg-lighter: #f5f5f5;
  --text-color: #444;
  --input-bg: white;
  --primary-color: #1976d2;
  --secondary-color: #e0e0e0;
  --hint-color: #777;
}

:root .dark-theme {
  --border-color: #444;
  --heading-color: #ddd;
  --bg-lighter: #333;
  --text-color: #ccc;
  --input-bg: #222;
  --primary-color: #1976d2;
  --secondary-color: #444;
  --hint-color: #999;
}
</style> 