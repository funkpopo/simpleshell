<template>
  <a-config-provider :theme="theme" :locale="locale">
    <a-layout class="layout">
      <a-layout-header>
        <div class="header-content">
          <div class="app-title" @click="checkUpdate" title="点击检查更新">
            <h3>SimpleSSH</h3>
            <span class="version">v{{ currentVersion }}</span>
          </div>
          <div class="header-actions">
            <div class="header-buttons">
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
        <a-layout-sider 
          :collapsed="siderCollapsed" 
          collapsible 
          :width="240"
          @collapse="siderCollapsed = $event"
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
            <div 
              v-for="folder in folders" 
              :key="folder.id"
              :data-id="folder.id"
              class="folder-item"
              @mouseenter="showFolderMenu(folder)"
              @mouseleave="hideFolderMenu"
              @contextmenu.prevent="showFolderContextMenu($event, folder)"
            >
              <a-menu-item :key="folder.id" class="folder-menu-item">
                <template #icon>
                  <a-avatar 
                    v-if="siderCollapsed"
                    shape="square"
                    :style="{ backgroundColor: getAvatarColor(folder) }"
                  >
                    {{ folder.name.charAt(0).toUpperCase() }}
                  </a-avatar>
                  <icon-folder v-else />
                </template>
                <template #default>
                  <div class="folder-title-wrapper">
                    <span class="folder-name">{{ folder.name }}</span>
                  </div>
                </template>
              </a-menu-item>

              <!-- 漂浮菜单 -->
              <div 
                v-show="activeFolderId === folder.id"
                class="floating-menu"
                @mouseenter="showFolderMenu(folder)"
                @mouseleave="hideFolderMenu"
                @contextmenu.prevent
              >
                <div class="floating-menu-content">
                  <!-- 添加连接按钮 -->
                  <div class="menu-section">
                    <a-button 
                      class="new-connection-btn" 
                      @click.stop="showAddConnectionModal(folder.id)"
                      @contextmenu.prevent
                    >
                      <template #icon><icon-plus /></template>
                      {{ t('common.addConnection') }}
                    </a-button>
                  </div>

                  <!-- 连接 -->
                  <div class="menu-section connections" @contextmenu.prevent>
                    <div
                      v-for="connection in folder.connections"
                      :key="connection.id"
                      class="connection-entry"
                      @click="openConnection(connection)"
                      @contextmenu.prevent
                    >
                      <span class="connection-title">{{ connection.name }}</span>
                      <div class="connection-controls">
                        <a-button 
                          class="control-btn"
                          @click.stop="editConnection(connection, folder)"
                          @contextmenu.prevent
                        >
                          <icon-edit />
                        </a-button>
                        <a-button 
                          class="control-btn delete"
                          @click.stop="deleteConnection(connection, folder)"
                          @contextmenu.prevent
                        >
                          <icon-delete />
                        </a-button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </a-menu>
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
                @close="closeTab"
                ref="sshTerminals"
                v-show="activeTab === tab.id"
              />
            </div>
            <transition name="slide-fade">
              <div v-if="isRightSidebarOpen && hasActiveConnection" class="right-sidebar">
                <SFTPExplorer 
                  v-if="activeConnection" 
                  :key="activeConnection.id" 
                  :connection="activeConnection" 
                />
              </div>
            </transition>
          </div>
          <div 
            v-if="hasActiveConnection"
            class="toggle-sidebar-button" 
            :class="{ 'open': isRightSidebarOpen }"
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
          
          <!-- 添加高亮规则配置按钮 -->
          <a-form-item>
            <a-button 
              type="outline" 
              @click="highlightRulesVisible = true"
            >
              {{ t('settings.customHighlight') }}
            </a-button>
          </a-form-item>
        </a-form>
        
        <template #footer>
          <div class="settings-footer">
            <div class="footer-left">
              <img 
                src="@/assets/github-light.png" 
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

  <!-- 在 Highlight Rules Configuration 对话框后添加编辑正则表达式的弹窗 -->
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
</template>

<script>
import { ref, reactive, provide, onMounted, watch, onUnmounted, nextTick, computed, inject, h } from 'vue'
import SSHTerminal from './components/SSHTerminal.vue'
import SFTPExplorer from './components/SFTPExplorer.vue'
import { IconMoonFill, IconSunFill, IconClose, IconFolderAdd, IconMenuFold, IconMenuUnfold, IconEdit, IconDelete, IconSettings, IconPlus, IconFolder } from '@arco-design/web-vue/es/icon'
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

export default {
  name: 'SimpleSSH',
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
    draggable,
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
      })

      if (!result.canceled && result.filePaths.length > 0) {
        const filePath = result.filePaths[0]
        newConnection.privateKeyPath = filePath
        try {
          const privateKeyContent = fs.readFileSync(filePath, 'utf-8')
          newConnection.privateKey = privateKeyContent
        } catch (error) {
          console.error('Failed to read private key file:', error)
          Message.error('Failed to read private key file')
        }
      }
    }

    const addConnection = async () => {
      try {
        const connection = { 
          ...newConnection, 
          id: Date.now(),
          type: 'connection'
        }
        
        // 获取当前配置
        const response = await axios.get('http://localhost:5000/get_connections')
        let currentConfig = response.data

        if (!connection.folderId) {
          Message.error('Please select a folder first')
          return
        }

        // 找到目标文件夹并添加连接
        currentConfig = currentConfig.map(item => {
          if (item.type === 'folder' && item.id === connection.folderId) {
            return {
              ...item,
              connections: [...(item.connections || []), connection]
            }
          }
          return item
        })

        // 保存更新后的配置
        await axios.post('http://localhost:5000/update_config', currentConfig)
        
        // 刷新连接列表
        await refreshConnections()
        
        // 重置表单并关闭对话框
        addConnectionModalVisible.value = false
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
        })

        Message.success('Connection added successfully')
      } catch (error) {
        console.error('Failed to add connection:', error)
        Message.error('Failed to add connection')
      }
    }

    const openConnection = (connection) => {
      console.log('Opening connection:', connection)
      const tab = {
        id: `${connection.name}-${Date.now()}`,
        name: connection.name,
        connection
      }
      tabs.value.push(tab)
      activeTab.value = tab.id
    }

    const onTabEdit = (targetKey, action) => {
      if (action === 'remove') {
        closeTab(targetKey)
      }
    }

    const closeTab = (tabId) => {
      const index = tabs.value.findIndex(tab => tab.id === tabId)
      if (index !== -1) {
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

    // 监听标签页数量的变化
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
    })

    onUnmounted(() => {
      window.removeEventListener('resize', resizeAllTerminals)
      
      // 移除系统主题变化的监听
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

    // 生成随机颜色的函数
    const generateRandomColor = () => {
      // 生成柔和的颜色
      const r = Math.floor(Math.random() * 156 + 100); // 100-255
      const g = Math.floor(Math.random() * 156 + 100); // 100-255
      const b = Math.floor(Math.random() * 156 + 100); // 100-255
      return `rgb(${r}, ${g}, ${b})`;
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
        // 等待过渡动画完成后再调整终端大小
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
      menu.append(new MenuItem({
        label: 'Edit',
        click: () => editConnection(connection, folder)
      }))
      menu.append(new MenuItem({
        label: 'Duplicate',
        click: () => duplicateConnection(connection, folder)
      }))
      menu.append(new MenuItem({
        type: 'separator'
      }))
      menu.append(new MenuItem({
        label: 'Delete',
        click: () => deleteConnection(connection, folder),
        type: 'normal',
        role: 'delete'
      }))
      menu.popup()
    };

    const editConnection = (connection, folder) => {
      currentFolder.value = folder
      Object.assign(editingConnection, connection)
      editConnectionModalVisible.value = true
    }

    const updateConnection = async () => {
      try {
        const folder = currentFolder.value
        const index = folder.connections.findIndex(conn => conn.id === editingConnection.id)
        if (index !== -1) {
          // 更新连接信息
          const updatedConnection = { ...editingConnection }
          folder.connections[index] = updatedConnection

          // 更新配置文件
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
          await refreshConnections()
          Message.success('Connection updated successfully')
          editConnectionModalVisible.value = false
        }
      } catch (error) {
        console.error('Failed to update connection:', error)
        Message.error('Failed to update connection')
      }
    }

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

              // 更新本地状态
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
        
        // 更新新连接的 folderId
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
      proxy: {
        enabled: false,
        host: '127.0.0.1',
        port: 7890
      }
    });

    // 初始化时设置语言
    watch(() => settings.language, (newLang) => {
      locale.value = newLang === 'zh-CN' ? zhCN : enUS
      localStorage.setItem('language', newLang)
    }, { immediate: true })

    const showSettings = () => {
      settingsVisible.value = true
    }

    const saveSettings = async () => {
      try {
        // 获取当前配置
        const response = await axios.get('http://localhost:5000/get_connections')
        let currentConfig = response.data
        
        // 更新或添加设置
        const settingsIndex = currentConfig.findIndex(item => item.type === 'settings')
        const settingsData = {
          type: 'settings',
          language: settings.language
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

        // 显示重启提示对话框
        Modal.info({
          title: t('settings.languageChanged'),
          content: t('settings.restartRequired'),
          okText: t('settings.restartNow'),
          cancelText: t('settings.restartLater'),
          hideCancel: false,
          onOk: () => {
            // 用户选择立即重
            const { app } = require('@electron/remote')
            app.relaunch()
            app.exit(0)
          },
          onCancel: () => {
            // 用户选稍后重启
            Message.success(t('settings.restartReminder'))
          }
        })
      } catch (error) {
        // 有在实际保存设置失败时才显示错误
        console.error('Failed to save settings:', error)
        if (error.response) {
          Message.error(t('settings.saveFailed'))
        } else {
          // 如果是网络错误但本地存储更新成功，仍然认为是成功的
          if (localStorage.getItem('language') === settings.language) {
            settingsVisible.value = false
            Message.success(t('settings.saved'))
          } else {
            Message.error(t('settings.saveFailed'))
          }
        }
      }
    }

    // 提供语言设给子组件
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

    // 修改保存配置的方法
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
      // 可以添加拖拽开始时的逻辑
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
              path: '/repos/funkpopo/simplessh/releases/latest',
              headers: {
                'User-Agent': 'SimpleSSH',
                'Accept': 'application/vnd.github.v3+json'
              }
            }

            const req = https.get(options, (res) => {
              if (res.statusCode === 301 || res.statusCode === 302) {
                // 处理重定向
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
                await shell.openExternal('https://github.com/funkpopo/simplessh/releases')
              } catch (error) {
                Message.error('打下载页面失败')
              }
            }
          })
        } else {
          Message.success('当前已是最新版本')
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

    // 添加加载和保存高亮规则的函数
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
            content += `${rule.name}=${rule.pattern}=${rule.color}\n`
          })
        
        // Write String section
        content += '\n[String]\n'
        customHighlightRules.value
          .filter(rule => rule.type === 'string')
          .forEach(rule => {
            content += `${rule.name}=${rule.pattern}=${rule.color}\n`
          })
        
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
        Message.error('Failed to save highlight rules')
      }
    }

    // 添加编辑规则的方法
    const addHighlightRule = () => {
      customHighlightRules.value.unshift({  // 使用 unshift 替代 push
        name: '',
        pattern: '',
        color: '#000000'
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
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-right: 10px;
  background-color: var(--color-bg-2);
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
  width: 300px;
  height: 100%;
  background-color: var(--color-bg-2);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  z-index: 100;
  overflow-y: auto;
}

.toggle-sidebar-button {
  position: absolute;
  top: 50%;
  right: 0;
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

.tabs-container {
  flex: 1;
  overflow-x: auto;
}

.close-icon {
  margin-left: 8px;
  font-size: 12px;
  color: var(--color-text-2);
  cursor: pointer;
}

.close-icon:hover {
  color: var(--color-text-1);
}

.terminal-container {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
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

/* 调整子菜单中的项目缩进 */
.arco-menu-inline .arco-menu-item {
  padding-left: 40px !important;
}

/* 添加下样式来调整添加文件夹图标按钮的外观 */
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
  z-index: 1001;  /* 确菜单最上层 */
  position: relative;
}

.arco-menu-item {
  z-index: 1002;  /* 确保菜单项在最上层 */
  position: relative;
}

/* 确保 Add Folder 按钮在上层 */
.arco-menu-item[key="add-folder"] {
  z-index: 1003;
}

/* 添加连接项相样式 */
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
  min-width: 0; /* 确保可以正确处理出 */
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

/* 调整按钮样式 */
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

/* 添加左侧边栏相关样 */
.arco-layout-sider {
  position: relative;
  transition: all 0.2s;
}

/* 修折叠的样式 */
.arco-layout-sider-collapsed {
  width: 64px !important;
  min-width: 64px !important;
}

/* 调整折叠时的 Avatar 样式 */
.folder-avatar {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 4px 0;
  width: 100%;
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

/* 调整子菜单项在折叠时的样式 */
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

/* 调整子菜单的样式 */
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

/* 左侧边栏基础样式 */
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

/* 文件夹悬浮菜单样式 */
.folder-floating-menu {
  position: fixed;
  left: 240px;
  min-width: 260px;
  background: var(--color-bg-2);
  border-radius: 6px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  z-index: 1100;
  transition: all 0.2s ease;
}

/* 收起侧边栏时的位调整 */
.arco-layout-sider-collapsed .folder-floating-menu {
  left: 64px;
}

/* 菜单内容容器 */
.floating-menu-content {
  padding: 8px;
}

/* 菜单分区 */
.menu-section {
  padding: 4px;
}

.menu-section + .menu-section {
  margin-top: 4px;
}

/* 新建连接按钮 */
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
}

.new-connection-btn:hover {
  background: var(--color-fill-2);
  border-color: var(--color-primary-light-2);
}

/* 连接列表区域 */
.connections {
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
}

/* 连接项 */
.connection-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 2px;
}

.connection-entry:hover {
  background: var(--color-fill-2);
}

/* 连接标题 */
.connection-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-1);
}

/* 连接控制按组 */
.connection-controls {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.connection-entry:hover .connection-controls {
  opacity: 1;
}

/* 控制按钮 */
.control-btn {
  padding: 2px;
  height: 20px;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 2px;
  transition: all 0.2s ease;
}

/* 编辑按钮样式 */
.control-btn:not(.delete) {
  color: rgb(var(--primary-6));
}

.control-btn:not(.delete):hover {
  background: var(--color-primary-light-1);
  color: rgb(var(--primary-6));
}

/* 删除按钮样式 */
.control-btn.delete {
  color: rgb(var(--danger-6));
}

.control-btn.delete:hover {
  background: var(--color-danger-light-1);
  color: rgb(var(--danger-6));
}

/* 图标样式 */
.control-btn .arco-icon {
  font-size: 14px;
}

/* 漂浮菜单基础样式 */
.floating-menu {
  position: fixed;
  min-width: 260px;
  background: var(--color-bg-2);
  border-radius: 6px;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.1);
  z-index: 1100;
  transition: all 0.2s ease;
  transform: translateX(240px); /* 使用 transform 定位 */
  pointer-events: all; /* 确保菜单可以接收事件 */
}

/* 收起侧边栏时的位置调 */
.arco-layout-sider-collapsed .floating-menu {
  transform: translateX(64px);
}

/* 修改文件夹项的定位 */
.folder-item {
  position: relative;
  cursor: pointer;
}

/* 菜单内容容器 */
.floating-menu-content {
  padding: 8px;
  pointer-events: all; /* 确保内容可以接收事件 */
}

/* 连接列表区域 */
.connections {
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  pointer-events: all; /* 确保连接列表可以接收事件 */
}

/* 连接项样式调整 */
.connection-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px; /* 减小内边距 */
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 2px;
  height: 32px; /* 固定高度 */
}

.connection-entry:hover {
  background: var(--color-fill-2);
}

/* 连接标题样式 */
.connection-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-1);
}

/* 连接控制按钮组样式 */
.connection-controls {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.connection-entry:hover .connection-controls {
  opacity: 1;
}

/* 控制按钮样式 */
.control-btn {
  padding: 2px;
  height: 20px;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  border-radius: 2px;
  color: var(--color-text-2);
  transition: all 0.2s ease;
}

.control-btn:hover {
  background: var(--color-fill-3);
  color: var(--color-text-1);
}

.control-btn.delete:hover {
  background: var(--color-danger-light-1);
  color: var(--color-danger);
}

/* 图标样式 */
.control-btn .arco-icon {
  font-size: 14px;
}

/* 连接列表容器样式 */
.connections {
  background: var(--color-bg-2);
  border: none; /* 移除边框 */
  border-radius: 4px;
  padding: 4px;
}

/* 确保按钮可以正常显示和交互 */
.connection-controls .arco-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  padding: 0 !important;
  min-width: unset !important;
}

/* 修复按钮图标显示 */
.connection-controls .arco-btn .arco-icon {
  margin: 0;
  font-size: 14px;
}

/* 标签页容器样式 */
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
  height: 0;
  width: 0;
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
  gap: 8px;
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

/* 标签页悬停效果 */
.tab-item:hover {
  background-color: var(--color-fill-2);
}

.tab-item.active:hover {
  background-color: var(--color-bg-1);
}

/* 拖拽时的式 */
.sortable-ghost {
  opacity: 0.5;
  background-color: var(--color-fill-3);
}

.sortable-drag {
  opacity: 0.9;
  background-color: var(--color-bg-1);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
}

/* 头部按钮容器样式 */
.header-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 4px;
}

/* 设置按钮样式 */
.header-btn,
.theme-switch {
  padding: 0;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  margin: 2px;
}

.header-btn .arco-icon,
.theme-switch .arco-icon {
  font-size: 16px;
}

/* 主题换按钮样式 */
.theme-switch {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background-color: var(--color-fill-2);
  cursor: pointer;
  transition: all 0.2s ease;
}

.theme-switch:hover {
  background-color: var(--color-fill-3);
}

.theme-icon {
  font-size: 16px;
  color: var(--color-text-2);
  transition: all 0.2s ease;
}

.theme-switch:hover .theme-icon {
  color: var(--color-text-1);
}

/* 设置对话框底部样式 */
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
  width: 20px;
  height: 20px;
  cursor: pointer;
  transition: opacity 0.2s ease;
}

.github-icon:hover {
  opacity: 0.8;
}

/* Powered by 文本样式 */
.powered-by {
  color: var(--color-text-2);
  font-size: 14px;
}

/* 按钮组样式 */
.buttons {
  display: flex;
  gap: 8px;
}

.app-title {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.app-title:hover {
  opacity: 0.8;
}

.app-title:active {
  transform: scale(0.98);
}

.version {
  font-size: 12px;
  color: var(--color-text-3);
  margin-left: 4px;
  transition: color 0.2s ease;
}

.app-title:hover .version {
  color: var(--color-text-2);
}

.app-title h3 {
  margin: 0;
}

/* 高亮规则配置对话框样式 */
.highlight-rules-container {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.rules-table-container {
  flex: 1;
  overflow-y: auto;
  max-height: calc(70vh - 120px); /* 减去按钮和padding的高度 */
}

/* 确保表格头部固定 */
.rules-table-container :deep(.arco-table-header) {
  position: sticky;
  top: 0;
  z-index: 1;
  background: var(--color-bg-2);
}

/* 美化滚动条 */
.rules-table-container::-webkit-scrollbar {
  width: 8px;
}

.rules-table-container::-webkit-scrollbar-track {
  background: var(--color-fill-2);
  border-radius: 4px;
}

.rules-table-container::-webkit-scrollbar-thumb {
  background: var(--color-fill-4);
  border-radius: 4px;
}

.rules-table-container::-webkit-scrollbar-thumb:hover {
  background: var(--color-fill-5);
}

/* 确保表格内容不会被截断 */
.rules-table-container :deep(.arco-table-body) {
  overflow-y: visible;
}

/* 调整表格行高 */
.rules-table-container :deep(.arco-table-tr) {
  height: 54px;
}

/* 确保输入框在单元格内正确对齐 */
.rules-table-container :deep(.arco-table-td) {
  padding: 8px;
}

/* 调整颜色选择器按钮样式 */
.rules-table-container :deep(.arco-input-group) {
  display: flex;
  align-items: center;
}

.pattern-cell {
  display: flex;
  align-items: center;
  gap: 8px;
}

.pattern-cell :deep(.arco-input) {
  background-color: var(--color-bg-2);
}

.pattern-cell :deep(.arco-input:hover) {
  background-color: var(--color-fill-2);
}
</style>