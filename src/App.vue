<template>
  <a-config-provider :theme="theme" :locale="locale">
    <a-layout class="layout">
      <a-layout-header>
        <div class="header-content">
          <div class="app-title" @click="checkUpdate" title="点击检查更新">
            <h3>SimpleShell</h3><span class="version">v{{ currentVersion }}</span>
          </div>
          <div class="header-actions">
            <div class="header-buttons">
              <a-button
                type="text"
                class="header-btn"
                @click="toggleAI"
              >
                <template #icon>
                  <img :src="aiIcon" class="ai-icon" alt="AI" />
                </template>
              </a-button>
              <a-button
                type="text"
                class="header-btn"
                @click="lockScreen"
              >
                <template #icon>
                  <icon-lock v-if="!isLocked" />
                  <icon-unlock v-else />
                </template>
              </a-button>
              <a-button
                type="text"
                class="header-btn"
                @click="showSettings"
              >
                <template #icon>
                  <icon-settings />
                </template>
              </a-button>
              <div class="theme-switch" @click="toggleTheme">
                <icon-sun-fill v-if="!isDarkMode" class="theme-icon" />
                <icon-moon-fill v-else class="theme-icon" />
              </div>
            </div>
          </div>
        </div>
      </a-layout-header>
      <a-layout class="main-content">
        <!-- 主侧边栏 -->
        <a-layout-sider 
          :collapsed="siderCollapsed" 
          collapsible 
          :width="siderWidth"
          :min-width="180"
          @collapse="siderCollapsed = $event"
          class="folder-sider"
        >
          <a-menu
            :style="{ width: '100%' }"
            :collapsed="siderCollapsed"
          >
            <!-- Add Folder 按钮 -->
            <a-menu-item key="add-folder" @click="showAddFolderModal">
              <template #icon>
                <a-avatar 
                  v-if="siderCollapsed"
                  shape="square"
                  :style="{ backgroundColor: 'rgb(var(--primary-6))' }"
                >
                  +
                </a-avatar>
                <icon-plus v-else />
              </template>
              <template #default>
                {{ t('common.addFolder') }}
              </template>
            </a-menu-item>

            <!-- 文件夹列表 -->
            <draggable 
              v-model="folders" 
              :animation="200"
              item-key="id"
              handle=".folder-drag-handle"
              @end="onFolderDragEnd"
            >
              <template #item="{ element: folder }">
                <div 
                  :key="folder.id"
                  :data-id="folder.id"
                  class="folder-item"
                  @click="selectFolder(folder)"
                  :class="{ 'active': selectedFolderId === folder.id }"
                  @contextmenu.prevent="showFolderContextMenu($event, folder)"
                >
                  <a-menu-item :key="folder.id" class="folder-menu-item">
                    <template #icon>
                      <div class="folder-drag-handle">
                        <a-avatar 
                          v-if="siderCollapsed"
                          shape="square"
                          :style="{ backgroundColor: getAvatarColor(folder) }"
                        >
                          {{ folder.name.charAt(0).toUpperCase() }}
                        </a-avatar>
                        <icon-folder v-else class="folder-icon" />
                      </div>
                    </template>
                    <template #default>
                      <div class="folder-title-wrapper">
                        <span class="folder-name">{{ folder.name }}</span>
                      </div>
                    </template>
                  </a-menu-item>
                </div>
              </template>
            </draggable>
          </a-menu>
          
          <!-- 添加拖拽调整宽度的区域 -->
          <div 
            class="sider-resizer"
            v-show="!siderCollapsed"
            @mousedown="startResize"
          ></div>
        </a-layout-sider>

        <!-- 新增：SSH连接列表侧边栏 -->
        <a-layout-sider
          v-if="selectedFolderId"
          :width="connectionsWidth"
          class="connections-sider"
        >
          <div class="connections-sider-header">
            <span class="connections-title">{{ selectedFolder?.name }}</span>
            <a-button 
              class="new-connection-btn" 
              @click="showAddConnectionModal(selectedFolderId)"
            >
              <template #icon><icon-plus /></template>
              {{ t('common.addConnection') }}
            </a-button>
          </div>

          <div class="connections-list">
            <draggable 
              v-model="selectedFolder.connections"
              :animation="200"
              item-key="id"
              handle=".connection-drag-handle"
              @end="onConnectionDragEnd(selectedFolder)"
            >
              <template #item="{ element: connection }">
                <div
                  :key="connection.id"
                  class="connection-entry"
                  @click="openConnection(connection)"
                  @contextmenu.prevent="showConnectionContextMenu($event, connection, selectedFolder)"
                >
                  <div class="connection-drag-handle">
                    <icon-drag-dot-vertical class="drag-icon" />
                  </div>
                  <div 
                    class="connection-color-block"
                    :style="{ backgroundColor: connection.color || generateRandomColor() }"
                  ></div>
                  <span 
                    class="connection-title" 
                    :title="connection.name"
                  >
                    {{ connection.name }}
                  </span>
                </div>
              </template>
            </draggable>
          </div>
          
          <!-- 添加拖拽调整宽度的区域 -->
          <div 
            class="connections-resizer"
            @mousedown="startConnectionsResize"
          ></div>
        </a-layout-sider>

        <a-layout-content :class="{ 'dark-mode': isDarkMode }" class="content-wrapper">
          <div class="content-header">
            <div class="tabs-container">
              <draggable 
                v-model="tabs" 
                :animation="200"
                item-key="id"
                class="tab-list"
                @start="onDragStart"
                @end="onDragEnd"
                handle=".tab-handle"
              >
                <template #item="{ element }">
                  <div 
                    class="tab-item"
                    :class="{ 'active': activeTab === element.id }"
                    @click="activeTab = element.id"
                    @contextmenu.prevent="showTabContextMenu($event, element)"
                  >
                    <div class="tab-handle">
                      <span class="connection-status" :class="{ 'connected': element.connected }"></span>
                      <span class="tab-title">{{ element.name }}</span>
                    </div>
                    <icon-close
                      class="close-icon"
                      @click.stop="closeTab(element.id)"
                    />
                  </div>
                </template>
              </draggable>
            </div>
          </div>
          <div class="terminal-and-sidebar-container">
            <div class="terminal-container">
              <SSHTerminal 
                v-for="tab in tabs"
                :key="tab.id"
                :connection="tab.connection" 
                :sessionId="tab.id"
                :fontSize="settings.fontSize"
                @close="closeTab"
                @connectionStatus="handleConnectionStatus"
                ref="sshTerminals"
                v-show="activeTab === tab.id"
              />
            </div>
            <transition name="slide-fade">
              <div 
                v-if="isRightSidebarOpen && hasActiveConnection" 
                class="right-sidebar"
                :style="{ width: `${sftpExplorerWidth}px` }"
              >
                <SFTPExplorer 
                  v-if="activeConnection" 
                  :key="activeConnection.id" 
                  :connection="activeConnection"
                  class="sftp-explorer-component" 
                />
              </div>
            </transition>
          </div>
          <div 
            v-if="hasActiveConnection"
            class="toggle-sidebar-button" 
            :class="{ 'open': isRightSidebarOpen }"
            :style="{ right: isRightSidebarOpen ? `${sftpExplorerWidth}px` : '0' }"
            @click="toggleRightSidebar"
          >
            <icon-menu-unfold v-if="isRightSidebarOpen" />
            <icon-menu-fold v-else />
          </div>
        </a-layout-content>
      </a-layout>

      <a-modal v-model:visible="addConnectionModalVisible" :title="$t('common.addConnection')" @ok="addConnection">
        <a-form :model="newConnection">
          <a-form-item :label="$t('common.name')">
            <a-input v-model="newConnection.name" />
          </a-form-item>
          <a-form-item :label="$t('common.host')">
            <a-input v-model="newConnection.host" />
          </a-form-item>
          <a-form-item :label="$t('common.port')">
            <a-input-number v-model="newConnection.port" :min="1" :max="65535" />
          </a-form-item>
          <a-form-item :label="$t('common.username')">
            <a-input v-model="newConnection.username" />
          </a-form-item>
          <a-form-item :label="$t('common.authentication')">
            <a-radio-group v-model="newConnection.authType">
              <a-radio value="password">{{ $t('common.password') }}</a-radio>
              <a-radio value="key">{{ $t('common.privateKey') }}</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item v-if="newConnection.authType === 'password'" :label="$t('common.password')">
            <a-input-password v-model="newConnection.password" />
          </a-form-item>
          <a-form-item v-if="newConnection.authType === 'key'" :label="$t('common.privateKey')">
            <a-input v-model="newConnection.privateKeyPath" :placeholder="$t('common.selectFile')" readonly>
              <template #suffix>
                <a-button @click="selectPrivateKeyFile">{{ $t('common.selectFile') }}</a-button>
              </template>
            </a-input>
          </a-form-item>
        </a-form>
      </a-modal>

      <a-modal v-model:visible="addFolderModalVisible" :title="$t('common.addFolder')" @ok="addFolder">
        <a-form :model="newFolder">
          <a-form-item :label="$t('common.folderName')">
            <a-input v-model="newFolder.name" :placeholder="$t('common.enterFolderName')" />
          </a-form-item>
        </a-form>
      </a-modal>

      <a-modal v-model:visible="editConnectionModalVisible" :title="$t('common.editConnection')" @ok="updateConnection">
        <a-form :model="editingConnection">
          <a-form-item :label="$t('common.name')">
            <a-input v-model="editingConnection.name" />
          </a-form-item>
          <a-form-item :label="$t('common.host')">
            <a-input v-model="editingConnection.host" />
          </a-form-item>
          <a-form-item :label="$t('common.port')">
            <a-input-number v-model="editingConnection.port" :min="1" :max="65535" />
          </a-form-item>
          <a-form-item :label="$t('common.username')">
            <a-input v-model="editingConnection.username" />
          </a-form-item>
          <a-form-item :label="$t('common.authentication')">
            <a-radio-group v-model="editingConnection.authType">
              <a-radio value="password">{{ $t('common.password') }}</a-radio>
              <a-radio value="key">{{ $t('common.privateKey') }}</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item v-if="editingConnection.authType === 'password'" :label="$t('common.password')">
            <a-input-password v-model="editingConnection.password" />
          </a-form-item>
          <a-form-item v-if="editingConnection.authType === 'key'" :label="$t('common.privateKey')">
            <a-input v-model="editingConnection.privateKeyPath" :placeholder="$t('common.selectFile')" readonly>
              <template #suffix>
                <a-button @click="selectPrivateKeyFile">{{ $t('common.selectFile') }}</a-button>
              </template>
            </a-input>
          </a-form-item>
        </a-form>
      </a-modal>

      <!-- 添加文件夹编辑模态框 -->
      <a-modal v-model:visible="editFolderModalVisible" :title="$t('common.editFolder')" @ok="updateFolder">
        <a-form :model="editingFolder">
          <a-form-item :label="$t('common.folderName')">
            <a-input v-model="editingFolder.name" :placeholder="$t('common.enterFolderName')" />
          </a-form-item>
        </a-form>
      </a-modal>

      <!-- 修改设置对话框部分 -->
      <a-modal
        v-model:visible="settingsVisible"
        :title="t('settings.title')"
        @ok="saveSettings"
        @cancel="settingsVisible = false"
      >
        <a-form :model="settings" layout="vertical">
          <a-form-item :label="t('settings.language')">
            <a-select
              v-model="settings.language"
              :style="{ width: '100%' }"
              @change="handleLanguageChange"
            >
              <a-option value="zh-CN">中文</a-option>
              <a-option value="en-US">English</a-option>
            </a-select>
          </a-form-item>
          
          <!-- 添加字号设置和高亮规则按钮的容器 -->
          <div style="display: flex; gap: 16px; align-items: flex-start;">
            <a-form-item :label="t('settings.fontSize')" style="flex: 1;">
              <a-input-number
                v-model="settings.fontSize"
                :min="8"
                :max="32"
                :step="1"
                style="width: 100%;"
              />
            </a-form-item>
            
            <a-form-item style="flex: 1;">
              <a-button 
                type="outline" 
                @click="highlightRulesVisible = true"
              >
                {{ t('settings.customHighlight') }}
              </a-button>
            </a-form-item>
          </div>
        </a-form>
        
        <template #footer>
          <div class="settings-footer">
            <div class="footer-left">
              <img 
                :src="githubIcon" 
                alt="GitHub" 
                class="github-icon"
                @click="openGithubLink"
              />
              <span class="powered-by">Powered by Python3, Vue3 and Xterm.js</span>
            </div>
            <div class="buttons">
              <a-button @click="settingsVisible = false">
                {{ t('sftp.cancel') }}
              </a-button>
              <a-button type="primary" @click="saveSettings">
                {{ t('sftp.confirm') }}
              </a-button>
            </div>
          </div>
        </template>
      </a-modal>
    </a-layout>
  </a-config-provider>

  <!-- 添加高亮规则配置对话框 -->
  <a-modal
    v-model:visible="highlightRulesVisible"
    :title="t('settings.highlightRules')"
    :width="700"
    :mask-closable="false"
    @ok="saveHighlightRules"
    @cancel="highlightRulesVisible = false"
  >
    <div class="highlight-rules-container">
      <a-button type="primary" @click="addHighlightRule" style="margin-bottom: 16px">
        {{ t('settings.addRule') }}
      </a-button>
      
      <div class="rules-table-container">
        <a-table :data="customHighlightRules" :pagination="false">
          <template #columns>
            <a-table-column title="Name" data-index="name">
              <template #cell="{ record }">
                <a-input v-model="record.name" />
              </template>
            </a-table-column>
            
            <a-table-column title="Pattern" data-index="pattern">
              <template #cell="{ record }">
                <div class="pattern-cell">
                  <a-input
                    v-model="record.pattern"
                    readonly
                    :style="{ cursor: 'pointer' }"
                    @click="editPattern(record)"
                  />
                </div>
              </template>
            </a-table-column>
            
            <a-table-column title="Color" data-index="color">
              <template #cell="{ record }">
                <a-input-group compact>
                  <a-input v-model="record.color" style="width: calc(100% - 40px)" />
                  <a-button
                    :style="{ 
                      backgroundColor: record.color,
                      width: '40px',
                      border: '1px solid var(--color-border)'
                    }"
                    @click="() => showColorPicker(record)"
                  />
                </a-input-group>
              </template>
            </a-table-column>
            
            <a-table-column title="Actions" align="center" width="80">
              <template #cell="{ rowIndex }">
                <a-button
                  type="text"
                  status="danger"
                  @click="removeHighlightRule(rowIndex)"
                >
                  <icon-delete />
                </a-button>
              </template>
            </a-table-column>
          </template>
        </a-table>
      </div>
    </div>
  </a-modal>

  <!-- 在 Highlight Rules Configuration 对话框后添加编辑则表达式的窗 -->
  <a-modal
    v-model:visible="patternEditVisible"
    :title="t('settings.editPattern')"
    @ok="savePattern"
    @cancel="patternEditVisible = false"
    :mask-closable="false"
  >
    <a-form :model="editingPattern" layout="vertical">
      <a-form-item :label="t('settings.pattern')">
        <a-textarea
          v-model="editingPattern.pattern"
          :rows="6"
          :style="{ width: '100%' }"
          allow-clear
        />
      </a-form-item>
    </a-form>
  </a-modal>

  <!-- 在 template 末尾添加遮罩和密码输入对话框 -->
  <div v-if="isLocked" class="screen-lock-overlay">
    <div class="lock-content">
      <template v-if="!hasPassword">
        <h2>{{ t('lock.setPassword') }}</h2>
        <a-form :model="lockForm" class="lock-form">
          <a-form-item>
            <a-input-password
              v-model="lockForm.password"
              :placeholder="t('lock.enterPassword')"
              allow-clear
            />
          </a-form-item>
          <a-form-item>
            <a-input-password
              v-model="lockForm.confirmPassword"
              :placeholder="t('lock.confirmPassword')"
              allow-clear
            />
          </a-form-item>
          <a-form-item class="form-buttons">
            <a-space>
              <a-button @click="cancelSetPassword">
                {{ t('lock.cancel') }}
              </a-button>
              <a-button type="primary" @click="setPassword">
                {{ t('lock.confirm') }}
              </a-button>
            </a-space>
          </a-form-item>
        </a-form>
      </template>
      <template v-else>
        <h2>{{ t('lock.enterPassword') }}</h2>
        <a-form :model="lockForm" class="lock-form">
          <a-form-item>
            <a-input-password
              v-model="lockForm.password"
              :placeholder="t('lock.enterPassword')"
              allow-clear
              @keyup.enter="unlock"
            />
          </a-form-item>
          <a-form-item>
            <a-button type="primary" @click="unlock">
              {{ t('lock.unlock') }}
            </a-button>
          </a-form-item>
        </a-form>
      </template>
    </div>
  </div>

  <!-- 添加 AI 助手组件 -->
  <AIAssistant
    v-if="showAI"
    @close="closeAI"
    @minimize="minimizeAI"
  />
</template>

<script>
import { ref, reactive, provide, onMounted, watch, onUnmounted, nextTick, computed, inject, h } from 'vue'
import SSHTerminal from './components/SSHTerminal.vue'
import SFTPExplorer from './components/SFTPExplorer.vue'
import { IconMoonFill, IconSunFill, IconClose, IconFolderAdd, IconMenuFold, IconMenuUnfold, IconEdit, IconDelete, IconSettings, IconPlus, IconFolder, IconLock, IconUnlock, IconDragDotVertical } from '@arco-design/web-vue/es/icon'
import { Message, Modal } from '@arco-design/web-vue' // 添加这行
import axios from 'axios'
import { dialog } from '@electron/remote'
import fs from 'fs'
import { Menu, MenuItem } from '@electron/remote'
import enUS from '@arco-design/web-vue/es/locale/lang/en-us'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn'
import draggable from 'vuedraggable'
import { ipcRenderer } from 'electron'
import { shell } from '@electron/remote'
import AIAssistant from './components/AIAssistant.vue'
import aiIcon from './assets/aiicon.png'

export default {
  name: 'SimpleShell',
  components: {
    SSHTerminal,
    SFTPExplorer,
    IconMoonFill,
    IconSunFill,
    IconClose,
    IconFolderAdd,
    IconMenuFold,
    IconMenuUnfold,
    IconEdit,
    IconDelete,
    IconSettings,
    IconPlus,
    IconFolder,
    IconLock,
    IconUnlock,
    IconDragDotVertical,
    draggable,
    AIAssistant,
  },
  setup() {
    const connections = ref([])
    const tabs = ref([])
    const activeTab = ref('')
    const addConnectionModalVisible = ref(false)
    const newConnection = reactive({
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKeyPath: '',
      privateKey: '',
      folderId: null
    })

    const theme = ref('light')
    const isDarkMode = ref(false)

    const toggleTheme = () => {
      isDarkMode.value = !isDarkMode.value
      theme.value = isDarkMode.value ? 'dark' : 'light'
      document.body.setAttribute('arco-theme', theme.value)
    }

    const detectSystemTheme = () => {
      const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      const isDarkMode = darkModeMediaQuery.matches
      toggleTheme(isDarkMode)
    }

    const systemThemeChangeHandler = (e) => {
      toggleTheme(e.matches)
    }

    provide('theme', theme)
    provide('isDarkMode', isDarkMode)

    const showAddConnectionModal = (folderId = null) => {
      if (!folderId) {
        Message.error('Please select a folder first')
        return
      }
      newConnection.folderId = folderId
      addConnectionModalVisible.value = true
    }

    const selectPrivateKeyFile = async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0];
        // 只保存文件路径，不读取私钥内容
        if (editConnectionModalVisible.value) {
          editingConnection.privateKeyPath = filePath;
          // 清除可能存在的 privateKey 字段
          editingConnection.privateKey = undefined;
        } else {
          newConnection.privateKeyPath = filePath;
          // 清除可能存在的 privateKey 字段
          newConnection.privateKey = undefined;
        }
      }
    };

    const generateRandomColor = () => {
      // 生成柔和的颜色
      const r = Math.floor(Math.random() * 156 + 100); // 100-255
      const g = Math.floor(Math.random() * 156 + 100); // 100-255
      const b = Math.floor(Math.random() * 156 + 100); // 100-255
      return `rgb(${r}, ${g}, ${b})`;
    }

    const addConnection = async () => {
      try {
        const connection = { 
          ...newConnection,
          id: Date.now(),
          type: 'connection',
          color: generateRandomColor() // 添加随机颜色
        };
        
        // 如果是密码认证，进行 base64 编码
        if (connection.authType === 'password' && connection.password) {
          connection.password = btoa(connection.password);
        }
        
        // 如果是私钥认证，确保只保存路径
        if (connection.authType === 'key') {
          // 确保删除 privateKey 字段
          delete connection.privateKey;
          // 验证是否选择了私钥文件
          if (!connection.privateKeyPath) {
            Message.error('Please select a private key file');
            return;
          }
        }
        
        // 获取当前配置
        const response = await axios.get('http://localhost:5000/get_connections');
        let currentConfig = response.data;

        if (!connection.folderId) {
          Message.error('Please select a folder first');
          return;
        }

        // 找到目标文件夹并添加连接
        currentConfig = currentConfig.map(item => {
          if (item.type === 'folder' && item.id === connection.folderId) {
            return {
              ...item,
              connections: [...(item.connections || []), connection]
            };
          }
          return item;
        });

        await axios.post('http://localhost:5000/update_config', currentConfig);
        await refreshConnections();
        
        addConnectionModalVisible.value = false;
        Object.assign(newConnection, {
          name: '',
          host: '',
          port: 22,
          username: '',
          authType: 'password',
          password: '',
          privateKeyPath: '',
          privateKey: '',
          folderId: null
        });

        Message.success('Connection added successfully');
      } catch (error) {
        console.error('Failed to add connection:', error);
        Message.error('Failed to add connection');
      }
    };

    // 修改打开连接的方法
    const openConnection = (connection) => {
      console.log('Opening connection:', connection)
      // 创建连接配置的副本
      const connectionConfig = { ...connection }
      
      // 如果是密认证，解码密码
      if (connectionConfig.authType === 'password' && connectionConfig.password) {
        try {
          connectionConfig.password = atob(connectionConfig.password)
        } catch (error) {
          console.error('Failed to decode password:', error)
          Message.error('Invalid password encoding')
          return
        }
      }
      
      const tab = {
        id: `${connection.name}-${Date.now()}`,
        name: connection.name,
        connection: connectionConfig,
        connected: false // 添加连接状态标志
      }
      tabs.value.push(tab)
      activeTab.value = tab.id
    }

    const onTabEdit = (targetKey, action) => {
      if (action === 'remove') {
        closeTab(targetKey)
      }
    }

    // 添加更新连接状态的方法
    const updateTabStatus = (tabId, isConnected) => {
      const tab = tabs.value.find(t => t.id === tabId)
      if (tab) {
        tab.connected = isConnected
      }
    }

    // 在 SSHTerminal 组件中监听连接状态变化
    const handleConnectionStatus = (data) => {
      console.log('Connection status changed:', data)
      const tab = tabs.value.find(t => t.id === data.sessionId)
      if (tab) {
        tab.connected = data.type === 'connected'
      }
    }

    // 在关闭标签页时重置状态
    const closeTab = (tabId) => {
      const index = tabs.value.findIndex(tab => tab.id === tabId)
      if (index !== -1) {
        updateTabStatus(tabId, false) // 重置连接状态
        tabs.value.splice(index, 1)
        if (tabs.value.length > 0 && activeTab.value === tabId) {
          activeTab.value = tabs.value[tabs.value.length - 1].id
        } else if (tabs.value.length === 0) {
          activeTab.value = ''
        }
      }
    }

    const fetchConnections = async () => {
      try {
        const response = await axios.get('http://localhost:5000/get_connections');
        const allItems = response.data;
        
        // 获取全局设置
        const globalSettings = allItems.find(item => item.type === 'settings') || {};
        if (globalSettings.pingInterval !== undefined) {
          settings.pingInterval = globalSettings.pingInterval;
        }
        
        folders.value = allItems.filter(item => item.type === 'folder').map(folder => ({
          ...folder,
          connections: folder.connections || []
        }));
        connections.value = allItems.filter(item => item.type === 'connection' && !item.folderId);
      } catch (error) {
        console.error('Failed to fetch connections:', error);
      }
    };

    const sshTerminals = ref([])

    const resizeAllTerminals = () => {
      nextTick(() => {
        sshTerminals.value.forEach(terminal => {
          if (terminal && terminal.manualResize) {
            terminal.manualResize()
          }
        })
      })
    }

    // 监听标签的变化
    watch(activeTab, () => {
      nextTick(() => {
        const activeTerminal = sshTerminals.value.find(terminal => terminal.sessionId === activeTab.value)
        if (activeTerminal && activeTerminal.manualResize) {
          activeTerminal.manualResize()
        }
      })
    })

    // 监听标签页数量变化
    watch(() => tabs.value.length, () => {
      resizeAllTerminals()
    })

    onMounted(() => {
      fetchConnections()
      window.addEventListener('resize', resizeAllTerminals)
      
      // 检测系统主题并设置初始主题
      detectSystemTheme()
      
      // 加系统主题变化的监听器
      const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      darkModeMediaQuery.addListener(systemThemeChangeHandler)
      
      // 加载高亮规则
      loadHighlightRules()
      
      // 加载度设置
      loadWidthSettings()
    })

    onUnmounted(() => {
      window.removeEventListener('resize', resizeAllTerminals)
      
      // 移除系统主题变化监听
      const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      darkModeMediaQuery.removeListener(systemThemeChangeHandler)
    })

    const folders = ref([])
    const addFolderModalVisible = ref(false)
    const newFolder = reactive({
      name: ''
    })

    const showAddFolderModal = () => {
      addFolderModalVisible.value = true
    }

    const addFolder = async () => {
      try {
        // 获取当前配置
        const config = await ipcRenderer.invoke('read-config')
        
        // 生成随机颜色
        const randomColor = generateRandomColor()

        const folder = { 
          id: Date.now(), 
          type: 'folder',
          name: newFolder.name, 
          connections: [],
          avatarColor: randomColor
        }
        
        config.push(folder)
        await ipcRenderer.invoke('save-config', config)
        
        addFolderModalVisible.value = false
        newFolder.name = ''
        
        await refreshConnections()
        
        Message.success('Folder added successfully')
      } catch (error) {
        console.error('Failed to add folder:', error)
        Message.error('Failed to add folder')
      }
    }

    const activeConnection = computed(() => {
      const activeTabItem = tabs.value.find(tab => tab.id === activeTab.value);
      console.log('Active connection:', activeTabItem ? activeTabItem.connection : null);
      return activeTabItem ? activeTabItem.connection : null;
    });

    const hasActiveConnection = computed(() => {
      return activeConnection.value !== null;
    });

    const isRightSidebarOpen = ref(false);

    const toggleRightSidebar = () => {
      if (hasActiveConnection.value) {
        isRightSidebarOpen.value = !isRightSidebarOpen.value;
        // 等待过渡动画完成后再调整终端小
        setTimeout(() => {
          const activeTerminal = sshTerminals.value.find(
            terminal => terminal.sessionId === activeTab.value
          );
          if (activeTerminal && activeTerminal.updateTerminalStyle) {
            activeTerminal.updateTerminalStyle();
          }
        }, 300); // 与 CSS 过渡时间匹配
      }
    }

    watch(activeConnection, (newConnection, oldConnection) => {
      if (newConnection !== oldConnection) {
        // Reset the sidebar state when the active connection changes
        isRightSidebarOpen.value = false;
      }
    });

    const editConnectionModalVisible = ref(false)
    const editingConnection = reactive({
      name: '',
      host: '',
      port: 22,
      username: '',
      authType: 'password',
      password: '',
      privateKeyPath: '',
      privateKey: '',
      folderId: null,
      id: null
    })
    const currentFolder = ref(null)

    const showConnectionContextMenu = (event, connection, folder) => {
      const menu = new Menu()
      
      // 打开连接选项
      menu.append(new MenuItem({
        label: t('common.open'),
        click: () => openConnection(connection)
      }))
      
      menu.append(new MenuItem({ type: 'separator' }))
      
      // 编辑选项
      menu.append(new MenuItem({
        label: t('common.edit'),
        click: () => editConnection(connection, folder)
      }))
      
      // 复制选项
      menu.append(new MenuItem({
        label: t('common.duplicate'),
        click: () => duplicateConnection(connection, folder)
      }))
      
      menu.append(new MenuItem({ type: 'separator' }))
      
      // 删除选项
      menu.append(new MenuItem({
        label: t('common.delete'),
        click: () => deleteConnection(connection, folder)
      }))
      
      menu.popup()
    }

    const editConnection = (connection, folder) => {
      currentFolder.value = folder
      Object.assign(editingConnection, connection)
      editConnectionModalVisible.value = true
    }

    const updateConnection = async () => {
      try {
        const folder = currentFolder.value;
        const index = folder.connections.findIndex(conn => conn.id === editingConnection.id);
        if (index !== -1) {
          // 创建更新后的连接配置
          const updatedConnection = { ...editingConnection };
          
          // 如果是密码认证，对新密码进行编码
          if (updatedConnection.authType === 'password' && updatedConnection.password) {
            updatedConnection.password = btoa(updatedConnection.password);
          }
          
          // 如果是私钥认证，确保只保存路径
          if (updatedConnection.authType === 'key') {
            // 确保删除 privateKey 字段
            delete updatedConnection.privateKey;
            // 保留 privateKeyPath
            if (!updatedConnection.privateKeyPath) {
              Message.error('Please select a private key file');
              return;
            }
          }
          
          folder.connections[index] = updatedConnection;

          // 更新配置文件
          const config = await axios.get('http://localhost:5000/get_connections');
          const updatedConfig = config.data.map(item => {
            if (item.id === folder.id) {
              return {
                ...item,
                connections: folder.connections
              };
            }
            return item;
          });

          await axios.post('http://localhost:5000/update_config', updatedConfig);
          await refreshConnections();
          Message.success('Connection updated successfully');
          editConnectionModalVisible.value = false;
        }
      } catch (error) {
        console.error('Failed to update connection:', error);
        Message.error('Failed to update connection');
      }
    };

    const deleteConnection = async (connection, folder) => {
      try {
        Modal.warning({
          title: t('messages.confirmDelete'),
          content: t('messages.confirmDeleteConnection', { name: connection.name }),
          titleAlign: 'start',
          hideCancel: false,
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          okButtonProps: {
            status: 'danger'
          },
          async onOk() {
            try {
              // 获取整的当前配置
              const response = await axios.get('http://localhost:5000/get_connections');
              let currentConfig = response.data;

              // 找到并更新对的文件夹
              currentConfig = currentConfig.map(item => {
                if (item.type === 'folder' && item.id === folder.id) {
                  return {
                    ...item,
                    connections: (item.connections || []).filter(
                      conn => conn.id !== connection.id
                    )
                  };
                }
                return item;
              });

              // 发送更新后的完整配置到后端
              const saveResponse = await axios.post('http://localhost:5000/update_config', currentConfig);
              
              if (saveResponse.data.error) {
                throw new Error(saveResponse.data.error);
              }

              // 新本地状态
              const folderIndex = folders.value.findIndex(f => f.id === folder.id);
              if (folderIndex !== -1) {
                folders.value[folderIndex].connections = folders.value[folderIndex].connections.filter(
                  conn => conn.id !== connection.id
                );
              }

              // 关闭相关的标签页
              const tabIndex = tabs.value.findIndex(tab => tab.connection.id === connection.id);
              if (tabIndex !== -1) {
                closeTab(tabs.value[tabIndex].id);
              }

              Message.success(t('messages.deleteSuccess'));
            } catch (error) {
              console.error('Failed to delete connection:', error);
              Message.error(t('messages.deleteFailed'));
            }
          }
        });
      } catch (error) {
        console.error('Error showing delete dialog:', error);
        Message.error(t('messages.error'));
      }
    };

    const duplicateConnection = async (connection, folder) => {
      try {
        const newConnection = {
          ...connection,
          id: Date.now(),
          name: `${connection.name} (copy)`,
          folderId: folder.id
        }
        
        folder.connections.push(newConnection)

        // 新配置文
        const config = await axios.get('http://localhost:5000/get_connections')
        const updatedConfig = config.data.map(item => {
          if (item.id === folder.id) {
            return {
              ...item,
              connections: folder.connections
            }
          }
          return item
        })

        await axios.post('http://localhost:5000/update_config', updatedConfig)
        Message.success('Connection duplicated successfully')
      } catch (error) {
        console.error('Failed to duplicate connection:', error)
        Message.error('Failed to duplicate connection')
      }
    }

    const editFolderModalVisible = ref(false)
    const editingFolder = reactive({
      id: null,
      name: '',
      type: 'folder',
      connections: []
    })

    // 修改 showFolderContextMenu 函数
    const showFolderContextMenu = (event, folder) => {
      const menu = new Menu()
      menu.append(new MenuItem({
        label: '编辑',
        click: () => editFolder(folder)
      }))
      menu.append(new MenuItem({
        label: '复制',
        click: () => duplicateFolder(folder)
      }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({
        label: '删除',
        click: () => {
          Modal.warning({
            title: t('messages.confirmDelete'),
            content: t('messages.confirmDeleteFolder', { 
              name: folder.name,
              count: folder.connections?.length || 0 
            }),
            titleAlign: 'start',
            hideCancel: false,
            okText: t('common.delete'),
            cancelText: t('common.cancel'),
            okButtonProps: {
              status: 'danger'
            },
            async onOk() {
              try {
                // 取当前配置
                const response = await axios.get('http://localhost:5000/get_connections')
                const updatedConfig = response.data.filter(item => item.id !== folder.id)
                
                // 保存更新后的置
                await axios.post('http://localhost:5000/update_config', updatedConfig)
                
                // 更新本地状态
                const index = folders.value.findIndex(f => f.id === folder.id)
                if (index !== -1) {
                  folders.value.splice(index, 1)
                }
                
                // 关闭相关的标签页
                folder.connections?.forEach(conn => {
                  const tabIndex = tabs.value.findIndex(tab => tab.connection.id === conn.id)
                  if (tabIndex !== -1) {
                    closeTab(tabs.value[tabIndex].id)
                  }
                })
                
                Message.success(t('messages.deleteSuccess'))
              } catch (error) {
                console.error('Failed to delete folder:', error)
                Message.error(t('messages.deleteFailed'))
              }
            }
          })
        }
      }))
      menu.popup()
    }

    // 编辑文件夹
    const editFolder = (folder) => {
      Object.assign(editingFolder, folder)
      editFolderModalVisible.value = true
    }

    // 更新文件夹
    const updateFolder = async () => {
      try {
        const config = await axios.get('http://localhost:5000/get_connections')
        const updatedConfig = config.data.map(item => {
          if (item.id === editingFolder.id) {
            return {
              ...editingFolder,
              connections: item.connections || []
            }
          }
          return item
        })

        await axios.post('http://localhost:5000/update_config', updatedConfig)
        
        // 更新本地状态
        const index = folders.value.findIndex(f => f.id === editingFolder.id)
        if (index !== -1) {
          folders.value[index].name = editingFolder.name
        }
        
        Message.success('Folder updated successfully')
        editFolderModalVisible.value = false
      } catch (error) {
        console.error('Failed to update folder:', error)
        Message.error('Failed to update folder')
      }
    }

    // 复制文件夹
    const duplicateFolder = async (folder) => {
      try {
        const newFolder = {
          ...folder,
          id: Date.now(),
          name: `${folder.name} (copy)`,
          connections: folder.connections.map(conn => ({
            ...conn,
            id: Date.now() + Math.random(),
            folderId: null // 将在下更新
          }))
        }
        
        // 更新新建的 folderId
        newFolder.connections.forEach(conn => {
          conn.folderId = newFolder.id
        })

        const config = await axios.get('http://localhost:5000/get_connections')
        const updatedConfig = [...config.data, newFolder]
        
        await axios.post('http://localhost:5000/update_config', updatedConfig)
        folders.value.push(newFolder)
        
        Message.success('Folder duplicated successfully')
      } catch (error) {
        console.error('Failed to duplicate folder:', error)
        Message.error('Failed to duplicate folder')
      }
    }

    // 删除文件夹
    const deleteFolder = async (folder) => {
      try {
        Modal.warning({
          title: t('messages.confirmDelete'),
          content: t('messages.confirmDeleteFolder', { 
            name: folder.name,
            count: folder.connections?.length || 0 
          }),
          titleAlign: 'start',
          hideCancel: false,
          okText: t('common.delete'),
          cancelText: t('common.cancel'),
          okButtonProps: {
            status: 'danger'
          },
          async onOk() {
            try {
              // 获取当前配置
              const response = await axios.get('http://localhost:5000/get_connections')
              const updatedConfig = response.data.filter(item => item.id !== folder.id)
              
              // 保存更新后的配置
              await axios.post('http://localhost:5000/update_config', updatedConfig)
              
              // 更新本地状态
              const index = folders.value.findIndex(f => f.id === folder.id)
              if (index !== -1) {
                folders.value.splice(index, 1)
              }
              
              // 关闭相关的标签页
              folder.connections?.forEach(conn => {
                const tabIndex = tabs.value.findIndex(tab => tab.connection.id === conn.id)
                if (tabIndex !== -1) {
                  closeTab(tabs.value[tabIndex].id)
                }
              })
              
              Message.success(t('messages.deleteSuccess'))
            } catch (error) {
              console.error('Failed to delete folder:', error)
              Message.error(t('messages.deleteFailed'))
            }
          }
        })
      } catch (error) {
        console.error('Error showing delete dialog:', error)
        Message.error(t('messages.error'))
      }
    }

    const siderCollapsed = ref(false);
    
    const toggleSider = () => {
      siderCollapsed.value = !siderCollapsed.value;
      // 在状态改变后重新调整终端大小
      nextTick(() => {
        resizeAllTerminals();
      });
    };

    // 添加语言设相的代码
    const locale = ref(zhCN)
    const settingsVisible = ref(false)
    const settings = reactive({
      language: localStorage.getItem('language') || 'zh-CN',
      fontSize: 14, // 添加默认字号
      proxy: {
        enabled: false,
        host: '127.0.0.1',
        port: 7890
      }
    });

    // 初始化时设置语��
    watch(() => settings.language, (newLang) => {
      locale.value = newLang === 'zh-CN' ? zhCN : enUS
      localStorage.setItem('language', newLang)
    }, { immediate: true })

    const showSettings = () => {
      settingsVisible.value = true
    }

    // 修改 saveSettings 函数
    const saveSettings = async () => {
      try {
        // 获取当前配置
        const response = await axios.get('http://localhost:5000/get_connections')
        let currentConfig = response.data
        
        // 更新或添加设置
        const settingsIndex = currentConfig.findIndex(item => item.type === 'settings')
        const settingsData = {
          type: 'settings',
          language: settings.language,
          fontSize: settings.fontSize,
          widthSettings: currentConfig[settingsIndex]?.widthSettings
        }
        
        if (settingsIndex !== -1) {
          currentConfig[settingsIndex] = settingsData
        } else {
          currentConfig.push(settingsData)
        }
        
        // 保存更新后的配置
        await axios.post('http://localhost:5000/update_config', currentConfig)
        
        // 更新本地存储
        localStorage.setItem('language', settings.language)
        
        // 关闭设置对话框
        settingsVisible.value = false

        // 只有在语言改变时才需要重启
        if (settings.language !== currentConfig[settingsIndex]?.language) {
          Modal.info({
            title: t('settings.languageChanged'),
            content: t('settings.restartRequired'),
            okText: t('settings.restartNow'),
            cancelText: t('settings.restartLater'),
            hideCancel: false,
            onOk: () => {
              const { app } = require('@electron/remote')
              app.relaunch()
              app.exit(0)
            },
            onCancel: () => {
              Message.success(t('settings.restartReminder'))
            }
          })
        } else {
          Message.success(t('settings.saved'))
        }
      } catch (error) {
        console.error('Failed to save settings:', error)
        Message.error(t('settings.saveFailed'))
      }
    }

    // 提供语言设置给子组件
    provide('locale', locale)

    const handleLanguageChange = (value) => {
      const i18n = inject('i18n')
      i18n.locale = value
      locale.value = value === 'zh-CN' ? zhCN : enUS
    }

    const refreshConnections = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        
        // 更新文件夹和连接
        folders.value = config.filter(item => item.type === 'folder').map(folder => ({
          ...folder,
          connections: folder.connections || []
        }))
        connections.value = config.filter(item => item.type === 'connection' && !item.folderId)
        
        // 更新全局设置
        const globalSettings = config.find(item => item.type === 'settings') || {}
        if (globalSettings.language !== undefined) {
          settings.language = globalSettings.language
        }
      } catch (error) {
        console.error('Failed to refresh connections:', error)
        Message.error('Failed to refresh connections')
      }
    }

    // 监听配置文件更新
    onMounted(() => {
      refreshConnections()
      
      // 监听配置文件变化
      ipcRenderer.on('config-updated', (event, newConfig) => {
        folders.value = newConfig.filter(item => item.type === 'folder').map(folder => ({
          ...folder,
          connections: folder.connections || []
        }))
        connections.value = newConfig.filter(item => item.type === 'connection' && !item.folderId)
        
        const globalSettings = newConfig.find(item => item.type === 'settings') || {}
        if (globalSettings.language !== undefined) {
          settings.language = globalSettings.language
        }
      })
    })

    onUnmounted(() => {
      // 移除事件监听
      ipcRenderer.removeAllListeners('config-updated')
    })

    // 修改保存置的方法
    const saveConfig = async (config) => {
      try {
        await ipcRenderer.invoke('save-config', config)
      } catch (error) {
        console.error('Failed to save config:', error)
        Message.error('Failed to save config')
      }
    }

    const i18n = inject('i18n')

    // 添加 t 函数
    const t = (key, params) => {
      return i18n.t(key, params)
    }

    const onDragStart = () => {
      // 可以添加拽开始时的逻辑
    }

    const onDragEnd = () => {
      // 可以添加拖拽结束时的逻辑
    }

    watch(siderCollapsed, () => {
      // 添加延时以等待侧边栏过动画成
      setTimeout(() => {
        const activeTerminal = sshTerminals.value.find(
          terminal => terminal.sessionId === activeTab.value
        );
        if (activeTerminal && activeTerminal.manualResize) {
          activeTerminal.manualResize();
        }
      }, 300);
    });

    const activeFolderId = ref(null)
    let menuHideTimeout = null

    const showFolderMenu = (folder) => {
      if (menuHideTimeout) {
        clearTimeout(menuHideTimeout)
      }
      activeFolderId.value = folder.id
      
      // 在下一个渲染周期中调整菜单位置
      nextTick(() => {
        const folderEl = document.querySelector(`.folder-item[data-id="${folder.id}"]`)
        const menuEl = document.querySelector('.floating-menu')
        if (folderEl && menuEl) {
          const folderRect = folderEl.getBoundingClientRect()
          menuEl.style.top = `${folderRect.top}px`
          
          // 阻止右键菜单事件
          menuEl.addEventListener('contextmenu', (e) => {
            e.preventDefault()
            e.stopPropagation()
            return false
          }, true)
        }
      })
    }

    const hideFolderMenu = () => {
      menuHideTimeout = setTimeout(() => {
        activeFolderId.value = null
      }, 200) // 添加延时以改善用户体验
    }

    const openGithubLink = () => {
      shell.openExternal('https://github.com/funkpopo')
    }

    // 修改 getAvatarColor 函数
    const getAvatarColor = (folder) => {
      return folder.avatarColor || generateRandomColor()
    }

    const currentVersion = ref(require('../package.json').version)
    const checkingUpdate = ref(false)

    const checkUpdate = async () => {
      if (checkingUpdate.value) return
      
      try {
        checkingUpdate.value = true
        Message.loading('正在检查更新...')
        
        const https = require('https')
        const currentVer = currentVersion.value

        // 创建一个版本号比较函数
        const compareVersions = (v1, v2) => {
          const normalize = v => v.replace(/^v/, '').split('.').map(Number)
          const parts1 = normalize(v1)
          const parts2 = normalize(v2)
          
          for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const num1 = parts1[i] || 0
            const num2 = parts2[i] || 0
            if (num1 > num2) return 1
            if (num1 < num2) return -1
          }
          return 0
        }

        const checkLatestVersion = () => {
          return new Promise((resolve, reject) => {
            const options = {
              hostname: 'api.github.com',
              path: '/repos/funkpopo/simpleshell/releases/latest',
              headers: {
                'User-Agent': 'SimpleShell',
                'Accept': 'application/vnd.github.v3+json'
              }
            }

            const req = https.get(options, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302) {
                // 处重定向
                reject(new Error('Redirect not supported'))
                return
              }

              let data = ''
              res.on('data', chunk => { data += chunk })
              res.on('end', () => {
                try {
                  if (res.statusCode === 200) {
                    resolve(JSON.parse(data))
                  } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`))
                  }
                } catch (e) {
                  reject(e)
                }
              })
            })

            req.on('error', reject)
            req.end()
          })
        }

        const response = await checkLatestVersion()
        const latestVersion = response.tag_name.replace('v', '')
        
        // 使用版本号比较函数
        if (compareVersions(latestVersion, currentVer) > 0) {
          Modal.info({
            title: t('update.newVersion'),
            content: h('div', {}, [
              h('p', {}, t('update.newVersionAvailable', { version: latestVersion })),
              h('p', {}, t('update.currentVersion', { version: currentVer }))
            ]),
            okText: t('update.download'),
            cancelText: t('update.later'),
            async onOk() {
              try {
                await shell.openExternal('https://github.com/funkpopo/simpleshell/releases')
              } catch (error) {
                Message.error('打下载页面失败')
              }
            }
          })
        } else {
          Message.success('当前已是最新本')
        }
      } catch (error) {
        console.error('检查更新失败:', error)
        let errorMessage = '检查更新失败'
        
        if (error.code === 'ENOTFOUND') {
          errorMessage = '网络连接失败，请检查网络设置'
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = '连接超时，请检查网络设置'
        } else if (error.response?.status === 403) {
          errorMessage = 'API 请求次数超限，请稍后再试'
        } else if (error.response?.status === 404) {
          errorMessage = '未找到版本信息'
        }
        
        Message.error({
          content: errorMessage,
          duration: 3000
        })
      } finally {
        checkingUpdate.value = false
      }
    }

    // 在 setup 函数中添加标签页右键菜单处理
    const showTabContextMenu = (event, tab) => {
      event.preventDefault()
      
      const menu = new Menu()
      menu.append(new MenuItem({
        label: t('common.refresh'),
        click: () => {
          const terminal = sshTerminals.value.find(
            term => term.sessionId === tab.id
          )
          if (terminal && terminal.reconnect) {
            terminal.reconnect()
          }
        }
      }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({
        label: t('common.close'),
        click: () => closeTab(tab.id)
      }))
      menu.popup()
    }

    // 在 setup 中添加新的响应式变量
    const highlightRulesVisible = ref(false)
    const customHighlightRules = ref([])

    // 添加加载和保存高亮规则函数
    const loadHighlightRules = async () => {
      try {
        const content = await fs.promises.readFile('highlight.list', 'utf-8')
        const rules = []
        let currentSection = ''
        
        content.split('\n').forEach(line => {
          line = line.trim()
          if (!line || line.startsWith('#')) return
          
          if (line === '[Regex]' || line === '[String]') {
            currentSection = line.slice(1, -1).toLowerCase()
            return
          }
          
          const [name, pattern, color] = line.split('=')
          if (name && pattern && color) {
            rules.push({
              name: name.trim(),
              pattern: pattern.trim(),
              color: color.trim(),
              type: currentSection
            })
          }
        })
        customHighlightRules.value = rules
      } catch (error) {
        console.error('Error loading highlight rules:', error)
        Message.error('Failed to load highlight rules')
      }
    }

    const saveHighlightRules = async () => {
      try {
        let content = '# Format: name=pattern=#HEX_COLOR\n'
        content += '# Colors should be in hexadecimal format like: #FF0000 (red), #00FF00 (green), #0000FF (blue)\n'
        content += '# Each section uses different matching methods:\n'
        content += '# [Regex] section uses regular expressions\n'
        content += '# [String] section uses simple string matching\n\n'
        
        // Write Regex section
        content += '[Regex]\n'
        customHighlightRules.value
          .filter(rule => rule.type === 'regex')
          .forEach(rule => {
            // 检查每规则的长度
            const ruleLine = `${rule.name}=${rule.pattern}=${rule.color}\n`
            if (ruleLine.length > 500) { // 单行最大长度限制
              throw new Error(`Rule "${rule.name}" exceeds maximum length of 500 characters`)
            }
            content += ruleLine
          })
        
        // Write String section
        content += '\n[String]\n'
        customHighlightRules.value
          .filter(rule => rule.type === 'string')
          .forEach(rule => {
            // 检查每个规则的长度
            const ruleLine = `${rule.name}=${rule.pattern}=${rule.color}\n`
            if (ruleLine.length > 500) { // 单行最大长度限制
              throw new Error(`Rule "${rule.name}" exceeds maximum length of 500 characters`)
            }
            content += ruleLine
          })

        // 检查整个文件的大小
        const maxFileSize = 8192 * 1024 // 8MB 限制
        if (content.length > maxFileSize) {
          throw new Error('Total highlight rules exceed maximum file size of 1MB')
        }

        // 检查规则数量
        const maxRules = 10000 // 最大规则数量限制
        if (customHighlightRules.value.length > maxRules) {
          throw new Error(`Number of rules exceeds maximum limit of ${maxRules}`)
        }
        
        await fs.promises.writeFile('highlight.list', content, 'utf-8')
        
        // 关闭高亮规则配置对话框
        highlightRulesVisible.value = false
        
        // 显示重启提示对话框
        Modal.info({
          title: t('settings.highlightRulesChanged'),
          content: t('settings.restartRequired'),
          okText: t('settings.restartNow'),
          cancelText: t('settings.restartLater'),
          hideCancel: false,
          onOk: () => {
            // 用户选择立即重启
            const { app } = require('@electron/remote')
            app.relaunch()
            app.exit(0)
          },
          onCancel: () => {
            // 用户选择稍后重启
            Message.success(t('settings.restartReminder'))
          }
        })
      } catch (error) {
        console.error('Error saving highlight rules:', error)
        Message.error(error.message || 'Failed to save highlight rules')
      }
    }

    // 添加编辑规则的方法
    const addHighlightRule = () => {
      // 检查规则数量限
      if (customHighlightRules.value.length >= 1000) {
        Message.error('Maximum number of rules (1000) reached')
        return
      }
      
      customHighlightRules.value.unshift({
        name: '',
        pattern: '',
        color: '#000000',
        type: 'regex' // 默认为正则表达式类型
      })
    }

    const removeHighlightRule = (index) => {
      customHighlightRules.value.splice(index, 1)
    }

    const showColorPicker = (record) => {
      // 创建一个隐藏的 input type="color" 元素
      const input = document.createElement('input')
      input.type = 'color'
      input.value = record.color
      input.style.position = 'absolute'
      input.style.visibility = 'hidden'
      
      // 添加到文档中并触发点击
      document.body.appendChild(input)
      input.addEventListener('change', (e) => {
        record.color = e.target.value
        document.body.removeChild(input)
      })
      input.click()
    }

    const patternEditVisible = ref(false)
    const editingPattern = reactive({
      pattern: '',
      index: -1
    })

    const editPattern = (record) => {
      const index = customHighlightRules.value.findIndex(r => r === record)
      editingPattern.pattern = record.pattern
      editingPattern.index = index
      patternEditVisible.value = true
    }

    const savePattern = () => {
      if (editingPattern.index >= 0) {
        customHighlightRules.value[editingPattern.index].pattern = editingPattern.pattern
      }
      patternEditVisible.value = false
    }

    // 在 setup 中添加计算属性
    const githubIcon = computed(() => {
      return isDarkMode.value ? 
        require('@/assets/github-light.png') : 
        require('@/assets/github-dark.png')
    })

    const isLocked = ref(false)
    const hasPassword = ref(false)
    const currentPassword = ref('')
    const lockForm = reactive({
      password: '',
      confirmPassword: ''
    })

    const lockScreen = () => {
      if (!hasPassword.value) {
        isLocked.value = true
      } else {
        isLocked.value = true
        lockForm.password = ''
      }
    }

    const setPassword = () => {
      if (!lockForm.password) {
        Message.error(t('lock.passwordRequired'))
        return
      }
      if (lockForm.password !== lockForm.confirmPassword) {
        Message.error(t('lock.passwordMismatch'))
        return
      }
      
      currentPassword.value = lockForm.password
      hasPassword.value = true
      // 清空所有密码输入框
      lockForm.password = ''
      lockForm.confirmPassword = ''
      Message.success(t('lock.passwordSet'))
    }

    const unlock = () => {
      if (lockForm.password === currentPassword.value) {
        isLocked.value = false
        lockForm.password = ''
        Message.success(t('lock.unlocked'))
      } else {
        Message.error(t('lock.wrongPassword'))
        lockForm.password = ''
      }
    }

    // 修改 onFolderDragEnd 函数
    const onFolderDragEnd = async () => {
      try {
        // 获取已保存的配置
        const response = await axios.get('http://localhost:5000/get_connections')
        let currentConfig = response.data

        // 更新文件夹顺序
        const folderIds = folders.value.map(folder => folder.id)
        currentConfig.sort((a, b) => {
          if (a.type !== 'folder' || b.type !== 'folder') return 0;
          return folderIds.indexOf(a.id) - folderIds.indexOf(b.id);
        });  // 修复这里的语法错误，移除多余的右括号

        // 保存更新后的配置
        await axios.post('http://localhost:5000/update_config', currentConfig)
      } catch (error) {
        console.error('Failed to save folder order:', error)
        // 如果保存失败，静默恢复原始顺序
        await refreshConnections()
      }
    }

    // 添加连接拽结束处理方法
    const onConnectionDragEnd = async (folder) => {
      try {
        // 获取当前配置
        const response = await axios.get('http://localhost:5000/get_connections')
        let currentConfig = response.data

        // 更新文件夹中的连接顺序
        currentConfig = currentConfig.map(item => {
          if (item.type === 'folder' && item.id === folder.id) {
            return {
              ...item,
              connections: folder.connections
            }
          }
          return item
        })

        // 保存更新后的配置
        await axios.post('http://localhost:5000/update_config', currentConfig)
      } catch (error) {
        console.error('Failed to save connection order:', error)
        // 如果保存失败，静默恢复原始顺序
        await refreshConnections()
      }
    }

    const selectedFolderId = ref(null)
    const selectedFolder = computed(() => 
      folders.value.find(folder => folder.id === selectedFolderId.value)
    )

    // 修改选择文件夹的方法
    const selectFolder = (folder) => {
      // 如果点击的是当前选中的文件夹，则关闭连接列表
      if (selectedFolderId.value === folder.id) {
        selectedFolderId.value = null
      } else {
        // 否则切换到新的文件夹的连接列表
        selectedFolderId.value = folder.id
      }
    }

    const siderWidth = ref(180) // 修改 siderWidth 的初始值为 180
    let isResizing = ref(false)
    let startX = ref(0)
    let startWidth = ref(0)

    // 修改 startResize 方法，添加折叠状态检查
    const startResize = (e) => {
      // 如果侧边栏已折叠则不允许调宽度
      if (siderCollapsed.value) return
      
      isResizing.value = true
      startX.value = e.clientX
      startWidth.value = siderWidth.value
      
      // 添加事件监听
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', stopResize)
      
      // 添加调整时的样式
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    // 修改 handleResize 方法，添加折叠状态查
    const handleResize = (e) => {
      if (!isResizing.value || siderCollapsed.value) return
      
      const diff = e.clientX - startX.value
      const newWidth = Math.max(180, Math.min(400, startWidth.value + diff)) // 限制最大宽度为400px
      
      siderWidth.value = newWidth
    }

    const stopResize = () => {
      isResizing.value = false
      
      // 移除事件监听
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', stopResize)
      
      // 恢复默认样式
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      
      // 保存宽度设置
      saveWidthSettings()
    }

    // 组件卸载时清理
    onUnmounted(() => {
      document.removeEventListener('mousemove', handleResize)
      document.removeEventListener('mouseup', stopResize)
    })

    // 添加计算最大宽度的函数
    const calculateConnectionsWidth = computed(() => {
      if (!selectedFolder.value?.connections?.length) return 240;
      
      // 创建临时 span 元素来测量文本宽度
      const span = document.createElement('span');
      span.style.visibility = 'hidden';
      span.style.position = 'absolute';
      span.style.fontSize = '14px';
      span.style.fontFamily = 'Avenir, Helvetica, Arial, sans-serif';
      document.body.appendChild(span);
      
      // 计算最长连接名称的宽度
      const maxWidth = selectedFolder.value.connections.reduce((max, conn) => {
        span.innerText = conn.name;
        const width = span.offsetWidth;
        return Math.max(max, width);
      }, 0);
      
      // 清理临时元素
      document.body.removeChild(span);
      
      // 计算所需总宽度：
      // 文本宽度 + 拖拽图标宽度(24px) + 内边距(24px) + 额外边距(40px)
      const calculatedWidth = maxWidth + 24 + 24 + 40;
      
      // 确保最小宽度为 240px
      return Math.max(240, calculatedWidth);
    });

    // 在 setup 中添加
    const connectionsWidth = ref(240) // 默认宽度
    let isConnectionsResizing = false
    let connectionsStartX = ref(0)
    let connectionsStartWidth = ref(0)

    // 添加 SSH 连接列表宽度调整方法
    const startConnectionsResize = (e) => {
      isConnectionsResizing = true
      connectionsStartX.value = e.clientX
      connectionsStartWidth.value = connectionsWidth.value
      
      document.addEventListener('mousemove', handleConnectionsResize)
      document.addEventListener('mouseup', stopConnectionsResize)
      
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    const handleConnectionsResize = (e) => {
      if (!isConnectionsResizing) return
      
      const diff = e.clientX - connectionsStartX.value
      const newWidth = Math.max(100, Math.min(250, connectionsStartWidth.value + diff))
      
      connectionsWidth.value = newWidth
    }

    const stopConnectionsResize = () => {
      isConnectionsResizing = false
      
      document.removeEventListener('mousemove', handleConnectionsResize)
      document.removeEventListener('mouseup', stopConnectionsResize)
      
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      
      // 保存宽度设置
      saveWidthSettings()
    }

    // 添加宽度设置的保存和加载方法
    const saveWidthSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const settingsIndex = config.findIndex(item => item.type === 'settings')
        const widthSettings = {
          folderWidth: siderWidth.value,
          connectionsWidth: connectionsWidth.value
        }
        
        if (settingsIndex !== -1) {
          config[settingsIndex] = {
            ...config[settingsIndex],
            widthSettings
          }
        } else {
          config.push({
            type: 'settings',
            widthSettings
          })
        }
        
        await ipcRenderer.invoke('save-config', config)
      } catch (error) {
        console.error('Failed to save width settings:', error)
      }
    }

    const loadWidthSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const settings = config.find(item => item.type === 'settings')
        
        if (settings?.widthSettings) {
          siderWidth.value = settings.widthSettings.folderWidth || 180
          connectionsWidth.value = settings.widthSettings.connectionsWidth || 240
        }
      } catch (error) {
        console.error('Failed to load width settings:', error)
      }
    }

    // ��� setup 中添加
    const cancelSetPassword = () => {
      isLocked.value = false;
      lockForm.password = '';
      lockForm.confirmPassword = '';
    };

    // 在 setup 中添加 AI 相关方法
    const showAI = ref(false)

    const toggleAI = () => {
      showAI.value = !showAI.value
    }

    const closeAI = () => {
      showAI.value = false
    }

    const minimizeAI = () => {
      // 不再修改 showAI 的值，只是让 AIAssistant 组件自己处理最小化状态
      console.log('AI window minimized')
    }

    // 移除动态计算的 aiIcon
    const aiIcon = require('@/assets/aiicon.png')

    // 在 setup 函数中
    const sftpExplorerWidth = ref(300) // 默认值

    // 添加加载 SFTP 宽度设���的方法
    const loadSFTPWidthSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const settings = config.find(item => item.type === 'settings')
        
        if (settings?.widthSettings?.sftpWidth) {
          // 确保加载的宽度不小于300，不大于600
          sftpExplorerWidth.value = Math.max(300, Math.min(600, settings.widthSettings.sftpWidth))
        }
      } catch (error) {
        console.error('Failed to load SFTP explorer width:', error)
      }
    }

    // 添加保存 SFTP 宽度设置的方法
    const saveSFTPWidthSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const settingsIndex = config.findIndex(item => item.type === 'settings')
        
        // 确保宽度不小于300，不大于600
        const width = Math.max(300, Math.min(600, sftpExplorerWidth.value))
        
        if (settingsIndex !== -1) {
          config[settingsIndex] = {
            ...config[settingsIndex],
            widthSettings: {
              ...(config[settingsIndex].widthSettings || {}),
              sftpWidth: width
            }
          }
        } else {
          config.push({
            type: 'settings',
            widthSettings: { sftpWidth: width }
          })
        }
        
        await ipcRenderer.invoke('save-config', config)
      } catch (error) {
        console.error('Failed to save SFTP explorer width:', error)
      }
    }

    // 在 onMounted 中调用加载方法
    onMounted(() => {
      loadSFTPWidthSettings()
    })

    // 修改 loadSettings 函数
    const loadSettings = async () => {
      try {
        const config = await ipcRenderer.invoke('read-config')
        const savedSettings = config.find(item => item.type === 'settings')
        if (savedSettings) {
          if (savedSettings.language !== undefined) {
            settings.language = savedSettings.language
          }
          if (savedSettings.fontSize !== undefined) {
            settings.fontSize = savedSettings.fontSize
          } else {
            settings.fontSize = 14 // 默认字号
          }
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }
    }

    // 确保在组件挂载时加载设置
    onMounted(() => {
      loadSettings()
      // ... 其他现有的 onMounted 代码
    })

    return {
      connections,
      tabs,
      activeTab,
      addConnectionModalVisible,
      newConnection,
      showAddConnectionModal,
      addConnection,
      theme,
      isDarkMode,
      toggleTheme,
      openConnection,
      onTabEdit,
      closeTab,
      sshTerminals,
      folders,
      addFolderModalVisible,
      newFolder,
      showAddFolderModal,
      addFolder,
      isRightSidebarOpen,
      toggleRightSidebar,
      activeConnection,
      hasActiveConnection,
      selectPrivateKeyFile,
      editConnectionModalVisible,
      editingConnection,
      showConnectionContextMenu,
      editConnection,
      updateConnection,
      deleteConnection,
      duplicateConnection,
      currentFolder,
      editFolderModalVisible,
      editingFolder,
      showFolderContextMenu,
      editFolder,
      updateFolder,
      duplicateFolder,
      deleteFolder,
      siderCollapsed,
      toggleSider,
      getAvatarColor,
      locale,
      settingsVisible,
      settings,
      showSettings,
      saveSettings,
      t,
      activeFolderId,
      showFolderMenu,
      hideFolderMenu,
      openGithubLink,
      currentVersion,
      checkUpdate,
      showTabContextMenu,
      highlightRulesVisible,
      customHighlightRules,
      addHighlightRule,
      removeHighlightRule,
      saveHighlightRules,
      showColorPicker,
      editingPattern,
      savePattern,
      editPattern,
      patternEditVisible,
      githubIcon,
      isLocked,
      hasPassword,
      lockForm,
      lockScreen,
      setPassword,
      unlock,
      onFolderDragEnd,
      onConnectionDragEnd,
      selectedFolderId,
      selectedFolder,
      selectFolder,
      siderWidth,
      startResize,
      handleResize,
      stopResize,
      calculateConnectionsWidth,
      connectionsWidth,
      startConnectionsResize,
      handleConnectionsResize,
      stopConnectionsResize,
      cancelSetPassword,
      handleConnectionStatus,
      showAI,
      toggleAI,
      closeAI,
      minimizeAI,
      aiIcon,
      handleLanguageChange,
      refreshConnections,
      sftpExplorerWidth,
      generateRandomColor
    }
  }
}
</script>

<style>
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: var(--color-text-1);
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.layout {
  height: 100%;
  margin-top: 0;
  display: flex;
  flex-direction: column;
  flex: 1;
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.header-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 20px;
  height: 100%;
}

.arco-layout-header {
  background-color: var(--color-bg-2);
  color: var(--color-text-1);
  padding: 8px 0;
  margin-top: 0;
}

.arco-layout-sider {
  background-color: var(--color-bg-2);
}

.arco-layout-content {
  background-color: var(--color-bg-2);
  color: var(--color-text-1);
  transition: background-color 0.3s, color 0.3s;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.arco-layout-content.dark-mode {
  background-color: var(--color-bg-5);
  color: var(--color-text-1);
}

.content-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.content-header {
  flex: 0 0 auto;
  background-color: var(--color-bg-2);
  border-bottom: 1px solid var(--color-border);
  padding: 4px 8px 0;
}

.tabs-container {
  display: flex;
  overflow-x: auto;
  overflow-y: hidden;
  white-space: nowrap;
  height: 40px;
}

/* 隐藏滚动条但保持功能 */
.tabs-container::-webkit-scrollbar {
  height: 8px;
}

.tab-list {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 2px;
  height: 100%;
}

/* 标签页样式 */
.tab-item {
  display: flex;
  align-items: center;
  padding: 0 16px;
  height: 36px;
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
  margin-right: 2px;
}

/* 活动标签页样式 */
.tab-item.active {
  background-color: var(--color-bg-1);
  border-color: var(--color-primary);
  color: var(--color-primary);
  z-index: 1;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background-color: var(--color-primary);
}

/* 标签页内容样式 */
.tab-handle {
  display: flex;
  align-items: center;
  gap: 2px;
  user-select: none;
}

.tab-title {
  font-size: 14px;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 关闭按钮样式 */
.close-icon {
  margin-left: 8px;
  font-size: 14px;
  color: var(--color-text-3);
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
}

.close-icon:hover {
  color: var(--color-text-1);
  background-color: var(--color-fill-3);
}

/* 标签悬停效果 */
.tab-item:hover {
  background-color: var(--color-fill-2);
}

.tab-item.active:hover {
  background-color: var(--color-bg-1);
}

/* 拖拽时的样式 */
.sortable-ghost {
  opacity: 0.5;
  background-color: var(--color-fill-3);
}

.sortable-drag {
  opacity: 0.9;
  background-color: var(--color-bg-1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

.terminal-and-sidebar-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.terminal-container {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.right-sidebar {
  position: absolute;
  top: 0;
  right: 0;
  height: 100%;
  background-color: var(--color-bg-2);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  z-index: 100;
  overflow: hidden; /* 修改为 hidden */
  min-width: 300px;
  transition: width 0.3s ease;
  display: flex; /* 添加 flex 布局 */
  flex-direction: column; /* 垂直方向排列 */
}

.toggle-sidebar-button {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  background-color: var(--color-fill-2);
  color: var(--color-text-1);
  padding: 10px 5px;
  border-radius: 4px 0 0 4px;
  cursor: pointer;
  z-index: 101;
  transition: right 0.3s ease;
}

.toggle-sidebar-button.open {
  right: 300px;
}

.toggle-sidebar-button:hover {
  background-color: var(--color-fill-3);
}

.add-connection-button {
  padding: 50px;
  cursor: pointer;
  transition: background-color 0.3s, color 0.3s;
}

.add-connection-button:hover {
  background-color: var(--color-primary-light-1);
  color: var(--color-primary);
}

/* 确保按钮在子菜单正确对齐 */
.arco-menu-inline .arco-menu-item-group-title {
  padding-left: 24px;
}

/* 调整子菜单中的项缩进 */
.arco-menu-inline .arco-menu-item {
  padding-left: 40px !important;
}

/* 添加下样来调整添加文夹图标按钮的外观 */
.arco-menu-item .arco-icon {
  font-size: 30;
  vertical-align: middle;
}

/* 选：如果您想图标居中显示 */
.arco-menu-item {
  display: flex;
  justify-content: center;
  align-items: center;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: transform 0.3s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(100%);
}

.slide-fade-enter-to,
.slide-fade-leave-from {
  transform: translateX(0);
}

/* 添加右键菜单相关样式 */
.arco-menu-item {
  position: relative;
}

.arco-menu-item:hover {
  background-color: var(--color-fill-2);
}

/* 添加菜相关的 z-index */
.arco-layout-sider {
  z-index: 1000;  /* 确保侧边栏在最上层 */
  position: relative;
}

.arco-menu {
  z-index: 1001;  /* 确菜单最��层 */
  position: relative;
}

.arco-menu-item {
  z-index: 1002;  /* 确保菜单项在最上层 */
  position: relative;
}

/* 确保 Add Folder 钮在上层 */
.arco-menu-item[key="add-folder"] {
  z-index: 1003;
}

/* 添连接项相样式 */
.connection-item {
  padding: 8px 16px !important;
}

.connection-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.connection-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px;
}

/* 调整菜单项内边距 */
.arco-menu-inline .arco-menu-item {
  padding-right: 10px !important;
}

/* 修改文件夹标题相关式 */
.folder-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding-right: 4px; /* 减小右侧内距 */
  min-width: 0; /* 确保可以���确处���出 */
}

.folder-header > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px; /* 确保文字和按钮之间有足够间 */
}

.folder-actions {
  display: flex;
  gap: 2px; /* 减小按钮之间的间距 */
  opacity: 0;
  transition: opacity 0.2s ease;
  flex-shrink: 0; /* 防止按钮被压缩 */
}

.folder-header:hover .folder-actions {
  opacity: 1;
}

/* 调按钮样式 */
.folder-actions .arco-btn {
  padding: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.folder-actions .arco-btn .arco-icon {
  font-size: 16px;
}

/* 确保按钮在悬停时的样式正确 */
.folder-actions .arco-btn:hover {
  background-color: var(--color-fill-3);
}

.folder-actions .arco-btn[status="danger"]:hover {
  color: rgb(var(--red-6));
  background-color: rgb(var(--red-1));
}

/* 添加左侧栏相关样 */
.arco-layout-sider {
  position: relative;
  transition: all 0.2s;
  user-select: none;
}

/* 修折叠的样式 */
.arco-layout-sider-collapsed {
  width: 64px !important;
  min-width: 64px !important;
  user-select: none;
}

/* 整折叠时的 Avatar 样式 */
.folder-avatar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 0;
  width: 100%;
  user-select: none;
}

.arco-layout-sider-collapsed .folder-header {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 0;
  width: 100%;
}

.arco-layout-sider-collapsed .arco-avatar {
  font-weight: bold;
  font-size: 20;
}

/* 调整子菜单标题在折叠的样式 */
.arco-layout-sider-collapsed .arco-sub-menu-title {
  padding: 0 !important;
  height: auto !important;
  width: 100%;
}

/* 确保 Add Folder 图标在折叠时可见且居中 */
.arco-layout-sider-collapsed .arco-menu-item[key="add-folder"] {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 0;
  width: 100%;
}

.arco-layout-sider-collapsed .arco-menu-item[key="add-folder"] .arco-icon {
  margin: 0;
  font-size: 20;
}

/* 调整子菜单项在折时的样式 */
.arco-layout-sider-collapsed .arco-menu-item {
  padding: 8px 0;
  text-align: center;
  width: 100%;
}

/* 调整菜容器的样 */
.arco-layout-sider-collapsed .arco-menu {
  width: 100%;
  padding: 0;
}

/* 调整子菜单的式 */
.arco-layout-sider-collapsed .arco-sub-menu {
  width: 100%;
}

/* 确保内容居中 */
.arco-layout-sider-collapsed .arco-menu-inline .arco-menu-item,
.arco-layout-sider-collapsed .arco-menu-inline .arco-sub-menu-title {
  padding: 0 !important;
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
}

/* 移除之前的折叠相关式，添加新的折叠布局样式 */

/* 左侧栏基础样式 */
.arco-layout-sider {
  position: relative;
  background-color: var(--color-bg-2);
  transition: all 0.2s cubic-bezier(0.34, 0.69, 0.1, 1);
}

/* 折叠状态下的菜单栏样式 */
.arco-layout-sider-collapsed {
  width: 64px !important;
  min-width: 64px !important;
}

/* 文件夹头像样 */
.folder-avatar {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: 48px;
  padding: 8px 0;
}

/* 文件夹标题样式 */
.folder-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

/* 文件操作按钮样式 */
.folder-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.folder-header:hover .folder-actions {
  opacity: 1;
}

/* 连接样式 */
.connection-item {
  padding: 8px 16px;
}

.connection-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

/* Add Connection 按钮样式 */
.add-connection-button {
  color: rgb(var(--primary-6));
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.add-connection-button:hover {
  opacity: 1;
}

/* ��件夹悬浮菜单样式 */
.folder-floating-menu {
  position: absolute;
  left: 100%; /* 改为相对定位，从父元素右侧开始 */
  top: 0;
  height: 100%; /* 占满整个高度 */
  min-width: 260px;
  background: var(--color-bg-2);
  border-left: 1px solid var(--color-border);
  box-shadow: 4px 0 8px rgba(0, 0, 0, 0.1);
  z-index: 1000;
  transition: all 0.2s ease;
}

/* 修改菜单内容容器样式 */
.floating-menu-content {
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px;
}

/* 修改连接表区域样式 */
.connections {
  flex: 1;
  overflow-y: auto;
  background: var(--color-bg-2);
  border: none;
  border-radius: 0;
  margin-top: 12px;
}

/* 美化滚动条 */
.connections::-webkit-scrollbar {
  width: 4px;
}

.connections::-webkit-scrollbar-track {
  background: var(--color-fill-2);
}

.connections::-webkit-scrollbar-thumb {
  background: var(--color-fill-4);
  border-radius: 2px;
}

/* 调整新建连接按钮样式 */
.new-connection-btn {
  width: 100%;
  height: 36px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: var(--color-bg-2);
  transition: all 0.2s ease;
  margin-bottom: 8px;
}

.new-connection-btn:hover {
  background: var(--color-fill-2);
  border-color: rgb(var(--primary-6));
  color: rgb(var(--primary-6));
}

/* 调整连接项样式 */
.connection-entry {
  position: relative; /* 添加相对定位 */
  display: flex;
  align-items: center;
  padding: 8px 12px;
  margin: 4px 0;
  border-radius: 4px;
  background: var(--color-bg-2);
  transition: all 0.2s ease;
  height: 32px;
}

.connection-entry:hover {
  background: var(--color-fill-2);
}

/* 收起侧边栏时的样式调整 */
.arco-layout-sider-collapsed .floating-menu {
  left: 64px; /* 收起时调整位置 */
}

/* 添加阴影效果 */
.folder-item {
  position: relative;
}

.folder-item:hover .floating-menu {
  box-shadow: 4px 0 16px rgba(0, 0, 0, 0.1);
}

/* 调整菜单分区样式 */
.menu-section {
  padding: 0;
}

.menu-section + .menu-section {
  margin-top: 8px;
}

/* 修改连接标题样式 */
.connection-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 0; /* 移除为按钮预留的空间 */
}

/* 修改连接控制按���容器样式 */
.connection-controls {
  display: none; /* 隐藏原有的编辑和删除按钮 */
}

/* 拖拽相关样式 */
.folder-drag-handle {
  cursor: move;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  margin: 0;
  width: 16px;
  height: 16px;
}

.folder-drag-handle .folder-icon {
  font-size: 16px;
  width: 16px;
  height: 16px;
}

/* 确保菜单项样式正确 */
.folder-menu-item {
  cursor: default;
  display: flex;
  align-items: center;
  padding: 0 16px;
}

/* 确保文件夹名称样式正确 */
.folder-title-wrapper {
  margin-left: 8px;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 折叠状态下的样式 */
.arco-layout-sider-collapsed .folder-drag-handle {
  width: 24px;
  height: 24px;
}

.arco-layout-sider-collapsed .folder-drag-handle .arco-avatar {
  width: 24px;
  height: 24px;
  font-size: 14px;
}

/* 拖拽时的样式 */
.sortable-ghost {
  opacity: 0.5;
  background-color: var(--color-fill-3);
}

.sortable-drag {
  opacity: 0.9;
  background-color: var(--color-bg-1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* 确保拖拽时浮动菜单隐藏 */
.sortable-ghost .floating-menu,
.sortable-drag .floating-menu {
  display: none !important;
}

/* 连接拖拽相关样式 */
.connection-entry {
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 2px;
  height: 32px;
}

.connection-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 8px;
  cursor: move;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.connection-entry:hover .connection-drag-handle {
  opacity: 0.5;
}

.connection-entry:hover .connection-drag-handle:hover {
  opacity: 1;
}

/* 新增：SSH连接列表侧边栏样式 */
.connections-sider {
  border-right: 1px solid var(--color-border);
  background: var(--color-bg-2);
  min-width: 100px !important; /* 设置最小宽度 */
  max-width: 250px !important; /* 设置最大宽度 */
}

.connections-sider-header {
  padding: 16px;
  border-bottom: 1px solid var(--color-border);
}

.connections-title {
  display: block;
  font-size: 16px;
  font-weight: 500;
  color: var(--color-text-1);
  margin-bottom: 12px;
}

.connections-list {
  padding: 12px;
  height: calc(100% - 100px);
  overflow-y: auto;
}

.connections-list::-webkit-scrollbar {
  width: 4px;
}

.connections-list::-webkit-scrollbar-track {
  background: var(--color-fill-2);
}

.connections-list::-webkit-scrollbar-thumb {
  background: var(--color-fill-4);
  border-radius: 2px;
}

/* 修改文件夹选中状态样式 */
.folder-item.active {
  background: var(--color-fill-2);
}

.folder-item.active .folder-menu-item {
  color: rgb(var(--primary-6));
}

/* 调整连接项样式 */
.connection-entry {
  position: relative;
  display: flex;
  align-items: center;
  padding: 4px 8px; /* 减小padding */
  margin: 2px 0; /* 减小margin */
  border-radius: 4px;
  transition: all 0.2s ease;
  height: 28px; /* 减小高度 */
  cursor: pointer;
}

.connection-entry:hover {
  background: var(--color-fill-2);
}

/* 新建连接按钮样式 */
.new-connection-btn {
  width: 100%;
  margin-top: 8px;
}

/* 添加新的样式 */
.folder-sider {
  max-width: 400px; /* 添加最大宽度限制 */
  transition: width 0.2s cubic-bezier(0.34, 0.69, 0.1, 1);
  flex-shrink: 0; /* 防止侧边栏被压缩 */
}

/* 确保文件夹称可以完整显示 */
.folder-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 调整菜单项内容布局 */
.folder-menu-item {
  display: flex;
  align-items: center;
  width: 100%;
}

.folder-title-wrapper {
  flex: 1;
  min-width: 0; /* 确保文本可以正确截断 */
  margin-right: 8px; /* 为折叠按钮留出空间 */
}

/* 添加拖拽调整宽度的区域 */
.sider-resizer {
  width: 10px;
  height: 100%;
  background-color: var(--color-bg-2);
  cursor: col-resize;
  position: absolute;
  top: 0;
  right: 0;
}

/* 添加拖拽调整宽度的样式 */
.folder-sider {
  position: relative;
  transition: none; /* 移除过渡动画以实现平滑拖动 */
}

.sider-resizer {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 100;
  opacity: 1;
  transition: opacity 0.2s ease;
}

/* 在折叠状态下隐藏拖拽区域 */
.arco-layout-sider-collapsed .sider-resizer {
  opacity: 0;
  pointer-events: none;
}

.sider-resizer:hover {
  background: rgba(var(--primary-6), 0.1);
}

/* 拖动时的样式 */
.sider-resizer:active {
  background: rgba(var(--primary-6), 0.2);
}

/* 确保折叠按钮在调整大小时保持位置 */
.arco-layout-sider-trigger {
  transition: none;
}

/* 调整菜单样式以适应宽度变化 */
.folder-menu-item {
  transition: none;
}

/* 确保内容不溢出 */
.folder-title-wrapper {
  min-width: 0;
  margin-right: 24px; /* 为折叠按钮留出空间 */
}

/* 添加全局滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--color-fill-2);
}

::-webkit-scrollbar-thumb {
  background-color: var(--color-fill-3);
  border-radius: 4px;
  border: 2px solid var(--color-fill-2);
}

::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-fill-4);
}

::-webkit-scrollbar-corner {
  background: transparent;
}

/* 确保所有元素都使用相同的滚动条样式 */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--color-fill-3) var(--color-fill-2);
}

/* 添加 SSH 连接列表拖拽调整宽度的样式 */
.connections-resizer {
  position: absolute;
  top: 0;
  right: -5px;
  width: 10px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  z-index: 100;
}

.connections-resizer:hover {
  background: rgba(var(--primary-6), 0.1);
}

.connections-resizer:active {
  background: rgba(var(--primary-6), 0.2);
}

/* 修改连接标题样式 */
.connection-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 0;
}

/* 添加标题提示样式 */
.connection-title:hover::after {
  content: attr(title);
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  top: -30px;
  padding: 4px 8px;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
  z-index: 1000;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* 修改 app-title 相关样式 */
.app-title {
  display: flex;
  align-items: center; /* 垂直居中对齐 */
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.app-title h3 {
  margin: 0; /* 移除默���边距 */
  font-size: 18px; /* 设置标题大小 */
  line-height: 1; /* 确���文字垂直居中 */
}

.version {
  font-size: 14px; /* 调整版本号大小 */
  color: var(--color-text-3);
  line-height: 1; /* 确保文字垂直居中 */
  transition: color 0.2s ease;
}

.app-title:hover {
  opacity: 0.8;
}

.app-title:active {
  transform: scale(0.98);
}

.app-title:hover .version {
  color: var(--color-text-2);
}

/* 修改头部按钮容器样式 */
.header-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
}

/* 统一头部按钮样式 */
.header-btn,
.theme-switch {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  padding: 0;
}

/* 主题切换按钮样式 */
.theme-switch {
  background-color: var(--color-fill-2);
  cursor: pointer;
}

.theme-switch:hover {
  background-color: var(--color-fill-3);
}

.theme-icon {
  font-size: 16px;
  color: var(--color-text-2);
}

.theme-switch:hover .theme-icon {
  color: var(--color-text-1);
}

/* 修改设置对话框底部样式 */
.settings-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 0;
}

/* 左侧内容样式 */
.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* GitHub 图标样式 */
.github-icon {
  width: 14px; /* 调整为与文本相同大小 */
  height: 14px; /* 调整为与���本相同大小 */
  cursor: pointer;
  transition: all 0.2s ease;
  filter: var(--github-icon-filter);
}

.github-icon:hover {
  opacity: 0.8;
}

/* Powered by 文本样式 */
.powered-by {
  color: var(--color-text-2);
  font-size: 14px;
}

/* 确保图标在��同主题下都清晰可见 */
:root {
  --github-icon-filter: none;
}

[arco-theme="dark"] {
  --github-icon-filter: brightness(1);
}

[arco-theme="light"] {
  --github-icon-filter: brightness(0.8);
}

/* 添加锁定界面相关样式 */
.screen-lock-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-bg-1);
  opacity: 0.98;
  z-index: 2000;
  display: flex;
  justify-content: center;
  align-items: center;
  backdrop-filter: blur(4px);
}

.lock-content {
  background-color: var(--color-bg-2);
  padding: 32px;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
  width: 100%;
  max-width: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lock-content h2 {
  margin-bottom: 24px;
  color: var(--color-text-1);
  text-align: center;
  width: 100%;
}

.lock-form {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lock-form .arco-form-item {
  margin-bottom: 16px;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.lock-form .arco-form-item:last-child {
  margin-bottom: 0;
}

.form-buttons {
  display: flex;
  gap: 16px;
  margin-top: 8px;
}

.connection-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: var(--color-danger-light-4);
  margin-right: 6px;
  transition: background-color 0.3s ease;
}

.connection-status.connected {
  background-color: var(--color-success-light-4);
}

/* AI 图标样式 */
.ai-icon {
  width: 16px;
  height: 16px;
  object-fit: contain;
}

/* 统一头部按钮样式 */
.header-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  transition: all 0.2s ease;
  padding: 0;
}

.sftp-explorer-component {
  width: 100%;
  height: 100%;
  overflow: hidden; /* 添加溢出隐藏 */
  display: flex;
  flex-direction: column;
}

/* 增大拖拽区域 */
.connection-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px; /* 增大宽度 */
  height: 24px; /* 增大高度 */
  margin-right: 8px;
  cursor: move;
  opacity: 0;
  transition: opacity 0.2s ease;
}

/* 添加颜色块样式 */
.connection-color-block {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  margin-right: 8px;
  flex-shrink: 0;
}
</style>