<template>
  <a-config-provider :theme="theme" :locale="locale">
    <a-layout class="layout">
      <a-layout-header>
        <div class="header-content">
          <h3>SimpleSSH</h3>
          <div class="header-actions">
            <!-- 添加设置按钮 -->
            <a-button
              type="text"
              @click="showSettings"
            >
              <template #icon>
                <icon-settings style="font-size: 32; stroke-linecap: round; stroke-linejoin: round;"/>
              </template>
            </a-button>
            <a-switch
              v-model="isDarkMode"
              :checked-value="true"
              :unchecked-value="false"
              checked-color="#165DFF"
              unchecked-color="#165DFF"
              @change="toggleTheme"
            >
              <template #checked>
                <icon-moon-fill />
              </template>
              <template #unchecked>
                <icon-sun-fill />
              </template>
            </a-switch>
          </div>
        </div>
      </a-layout-header>
      <a-layout class="main-content">
        <a-layout-sider 
          v-model:collapsed="siderCollapsed"
          :width="200" 
          collapsible
          :style="{ background: 'var(--color-bg-2)' }"
        >
          <a-menu mode="inline">
            <a-menu-item key="add-folder" @click="showAddFolderModal">
              <icon-folder-add />
              <span>{{ $t('common.addFolder') }}</span>
            </a-menu-item>
            <a-sub-menu v-for="folder in folders" :key="folder.id">
              <template #title>
                <div class="folder-header">
                  <template v-if="siderCollapsed">
                    <div class="folder-avatar">
                      <a-avatar :size="32" :style="{ backgroundColor: getAvatarColor(folder.name) ,position: 'relative', left: '5px' }">
                        {{ folder.name.charAt(0).toUpperCase() }}
                      </a-avatar>
                    </div>
                  </template>
                  <template v-else>
                    <span>{{ folder.name }}</span>
                    <div class="folder-actions">
                      <a-button 
                        type="text" 
                        size="mini"
                        @click.stop="editFolder(folder)"
                      >
                        <icon-edit />
                      </a-button>
                      <a-button 
                        type="text" 
                        size="mini" 
                        status="danger"
                        @click.stop="deleteFolder(folder)"
                      >
                        <icon-delete />
                      </a-button>
                    </div>
                  </template>
                </div>
              </template>
              <a-menu-item-group>
                <template #title>
                  <span class="add-connection-button" @click.stop="showAddConnectionModal(folder.id)">
                    Add Connection
                  </span>
                </template>
              </a-menu-item-group>
              <a-menu-item 
                v-for="conn in folder.connections" 
                :key="conn.id" 
                @click="openConnection(conn)"
                class="connection-item"
              >
                <div class="connection-content">
                  <span class="connection-name">{{ conn.name }}</span>
                  <div class="connection-actions">
                    <a-button 
                      type="text" 
                      size="mini"
                      @click.stop="editConnection(conn, folder)"
                    >
                      <icon-edit />
                    </a-button>
                    <a-button 
                      type="text" 
                      size="mini" 
                      status="danger"
                      @click.stop="deleteConnection(conn, folder)"
                    >
                      <icon-delete />
                    </a-button>
                  </div>
                </div>
              </a-menu-item>
            </a-sub-menu>
          </a-menu>
        </a-layout-sider>
        <a-layout-content :class="{ 'dark-mode': isDarkMode }" class="content-wrapper">
          <div class="content-header">
            <a-tabs v-model:activeKey="activeTab" type="card" class="tabs-container" @edit="onTabEdit">
              <a-tab-pane 
                v-for="tab in tabs" 
                :key="tab.id" 
                :closable="true"
              >
                <template #title>
                  <span>{{ tab.name }}</span>
                  <icon-close
                    class="close-icon"
                    @click.stop="closeTab(tab.id)"
                  />
                </template>
              </a-tab-pane>
            </a-tabs>
          </div>
          <div class="terminal-and-sidebar-container">
            <div class="terminal-container" :class="{ 'sidebar-open': isRightSidebarOpen }">
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
        </a-form>
        <template #footer>
          <div class="settings-footer">
            <div class="copyright">
              <a-link href="https://github.com/funkpopo" target="_blank">
                <template #icon>
                  <icon-github />
                </template>
              </a-link>
              Powered by Python3, Vue3 and Xterm.js
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
</template>

<script>
import { ref, reactive, provide, onMounted, watch, onUnmounted, nextTick, computed, inject } from 'vue'
import SSHTerminal from './components/SSHTerminal.vue'
import SFTPExplorer from './components/SFTPExplorer.vue'
import { IconMoonFill, IconSunFill, IconClose, IconFolderAdd, IconMenuFold, IconMenuUnfold, IconEdit, IconDelete, IconSettings } from '@arco-design/web-vue/es/icon'
import { Message, Modal } from '@arco-design/web-vue' // 添加这行
import axios from 'axios'
import { dialog } from '@electron/remote'
import fs from 'fs'
import { Menu, MenuItem } from '@electron/remote'
import enUS from '@arco-design/web-vue/es/locale/lang/en-us'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn'

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
    IconSettings
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

    const toggleTheme = (checked) => {
      isDarkMode.value = checked
      theme.value = checked ? 'dark' : 'light'
      document.body.setAttribute('arco-theme', theme.value)
      // 为所有 SSHTerminal 组件提供主题信息
      sshTerminals.value.forEach(terminal => {
        if (terminal) {
          terminal.setTheme(theme.value)
        }
      })
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
    })

    onUnmounted(() => {
      window.removeEventListener('resize', resizeAllTerminals)
      
      // 移除系统主题变化的监听器
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
      const folder = { 
        id: Date.now(), 
        type: 'folder',
        name: newFolder.name, 
        connections: [] 
      }
      folders.value.push(folder)
      
      try {
        await saveFolderToConfig(folder)
        console.log('Folder saved successfully')
      } catch (error) {
        console.error('Failed to save folder:', error)
      }

      addFolderModalVisible.value = false
      newFolder.name = ''
    }

    const saveFolderToConfig = async (folder) => {
      try {
        await axios.post('http://localhost:5000/add_folder', folder)
      } catch (error) {
        console.error('Error saving folder to config:', error)
        throw error
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
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Confirm Delete',
          message: `Are you sure you want to delete connection "${connection.name}"?`,
          detail: 'This action cannot be undone.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0
        });

        if (result.response === 1) {
          // 获取完整的当前配置
          const response = await axios.get('http://localhost:5000/get_connections');
          let currentConfig = response.data;

          // 找到并更新对应的文件夹
          currentConfig = currentConfig.map(item => {
            if (item.type === 'folder' && item.id === folder.id) {
              // 滤掉要删除的连接
              const updatedConnections = (item.connections || []).filter(
                conn => conn.id !== connection.id
              );
              return {
                ...item,
                connections: updatedConnections
              };
            }
            return item;
          });

          console.log('Sending updated config to backend:', currentConfig);

          // 发送更新后的完整配置后端
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

          Message.success('Connection deleted successfully');
        }
      } catch (error) {
        console.error('Failed to delete connection:', error);
        Message.error(`Failed to delete connection: ${error.message}`);
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

    // 添加文件夹右键菜单
    const showFolderContextMenu = (event, folder) => {
      const menu = new Menu()
      menu.append(new MenuItem({
        label: 'Edit',
        click: () => editFolder(folder)
      }))
      menu.append(new MenuItem({
        label: 'Duplicate',
        click: () => duplicateFolder(folder)
      }))
      menu.append(new MenuItem({
        type: 'separator'
      }))
      menu.append(new MenuItem({
        label: 'Delete',
        click: () => deleteFolder(folder),
        type: 'normal',
        role: 'delete'
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
            folderId: null // 将在下面更新
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
        const result = await dialog.showMessageBox({
          type: 'warning',
          title: 'Confirm Delete',
          message: `Are you sure you want to delete folder "${folder.name}" and all its connections?`,
          detail: 'This action cannot be undone.',
          buttons: ['Cancel', 'Delete'],
          defaultId: 0,
          cancelId: 0
        })

        if (result.response === 1) {
          const config = await axios.get('http://localhost:5000/get_connections')
          const updatedConfig = config.data.filter(item => item.id !== folder.id)
          
          await axios.post('http://localhost:5000/update_config', updatedConfig)
          
          // 更新本地状态
          const index = folders.value.findIndex(f => f.id === folder.id)
          if (index !== -1) {
            folders.value.splice(index, 1)
          }
          
          // 关闭相关的标签页
          folder.connections.forEach(conn => {
            const tabIndex = tabs.value.findIndex(tab => tab.connection.id === conn.id)
            if (tabIndex !== -1) {
              closeTab(tabs.value[tabIndex].id)
            }
          })
          
          Message.success('Folder deleted successfully')
        }
      } catch (error) {
        console.error('Failed to delete folder:', error)
        Message.error('Failed to delete folder')
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

    // 添加获取头像颜色的函数
    const getAvatarColor = (name) => {
      const colors = [
        'rgb(var(--primary-6))',
        'rgb(var(--success-6))',
        'rgb(var(--warning-6))',
        'rgb(var(--danger-6))',
        'rgb(var(--link-6))'
      ];
      const index = name.length % colors.length;
      return colors[index];
    };

    // 添加语言设置相关的代码
    const locale = ref(zhCN)
    const settingsVisible = ref(false)
    const settings = reactive({
      language: localStorage.getItem('language') || 'zh-CN'
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
            // 用户选择立即重启
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
        // 只有在实际保存设置失败时才显示错误
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
        console.log('Refreshing connections...')
        const response = await axios.get('http://localhost:5000/get_connections')
        const allItems = response.data
        
        // 获取全设置
        const globalSettings = allItems.find(item => item.type === 'settings') || {}
        if (globalSettings.language !== undefined) {
          settings.language = globalSettings.language
        }
        
        // 更新文件夹和连接
        folders.value = allItems.filter(item => item.type === 'folder').map(folder => ({
          ...folder,
          connections: folder.connections || []
        }))
        connections.value = allItems.filter(item => item.type === 'connection' && !item.folderId)
        
        console.log('Connections refreshed successfully')
        console.log('Current folders:', folders.value)
        console.log('Current connections:', connections.value)
      } catch (error) {
        console.error('Failed to refresh connections:', error)
        Message.error('Failed to refresh connections')
      }
    }

    const i18n = inject('i18n')

    // 添加 t 函数
    const t = (key, params) => {
      return i18n.t(key, params)
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
      saveFolderToConfig,
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
      t
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
}

.layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
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
}

.arco-layout-header {
  background-color: var(--color-bg-2);
  color: var(--color-text-1);
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
  display: flex;
  overflow: hidden;
}

.terminal-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  transition: margin-right 0.3s ease;
}

.terminal-container.sidebar-open {
  margin-right: 300px;
}

.right-sidebar {
  position: absolute;
  top: 0;
  right: 0;
  width: 300px;
  height: 100%;
  background-color: var(--color-bg-2);
  box-shadow: -2px 0 8px rgba(0, 0, 0, 0.15);
  z-index: 997;  /* 降低 z-index */
  overflow-y: auto;
  transition: transform 0.3s ease;
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
  z-index: 998;  /* 降低 z-index */
  transition: all 0.3s ease;
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

/* 确保按钮在子菜单中正确对齐 */
.arco-menu-inline .arco-menu-item-group-title {
  padding-left: 24px;
}

/* 调整子菜单中的项目缩进 */
.arco-menu-inline .arco-menu-item {
  padding-left: 40px !important;
}

/* 添加以下样式来调整添加文件夹图标按钮的外观 */
.arco-menu-item .arco-icon {
  font-size: 30px;
  vertical-align: middle;
}

/* 可选：如果您想图标居中显示 */
.arco-menu-item {
  display: flex;
  justify-content: center;
  align-items: center;
}

.slide-fade-enter-active,
.slide-fade-leave-active {
  transition: all 0.3s ease;
}

.slide-fade-enter-from,
.slide-fade-leave-to {
  transform: translateX(100%);
  opacity: 0;
}

/* 添加右键菜单相关样式 */
.arco-menu-item {
  position: relative;
}

.arco-menu-item:hover {
  background-color: var(--color-fill-2);
}

/* 添加菜单相关的 z-index */
.arco-layout-sider {
  z-index: 1000;  /* 确保侧边栏在最上层 */
  position: relative;
}

.arco-menu {
  z-index: 1001;  /* 确保菜单在最上层 */
  position: relative;
}

.arco-menu-item {
  z-index: 1002;  /* 确保菜单项在最上层 */
  position: relative;
}

/* 确保 Add Folder 按钮在最上层 */
.arco-menu-item[key="add-folder"] {
  z-index: 1003;
}

/* 添加连接项相关样式 */
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

.connection-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s ease;
}

.connection-item:hover .connection-actions {
  opacity: 1;
}

/* 连接按钮样式 */
.connection-actions .arco-btn {
  padding: 0 4px;
  height: 24px;
  line-height: 24px;
  font-size: 15px;
}

.connection-actions .arco-btn:hover {
  background-color: var(--color-fill-3);
}

.connection-actions .arco-btn[status="danger"]:hover {
  color: rgb(var(--red-6));
  background-color: rgb(var(--red-1));
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
  padding-right: 4px; /* 减小右侧内边距 */
  min-width: 0; /* 确保可以正确处理溢出 */
}

.folder-header > span {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-right: 8px; /* 确保文字和按钮之间有足够间距 */
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
  padding: 0 4px;
  height: 24px;
  line-height: 24px;
}

.folder-actions .arco-btn .arco-icon {
  font-size: 20px; /* 减小图标大小 */
}

/* 调整子菜单标题的内边距 */
.arco-menu-inline .arco-sub-menu-title {
  padding-right: 4px !important; /* 减小右侧内边距 */
}

/* 确保文件夹名称不会被按钮遮挡 */
.arco-sub-menu-title {
  display: flex;
  align-items: center;
  min-width: 0; /* 确保可以正确处理溢出 */
}

/* 调整图标大小 */
.folder-actions .icon-edit,
.folder-actions .icon-delete {
  font-size: 14px;
}

/* 调整按钮悬停效果 */
.folder-actions .arco-btn:hover {
  background-color: var(--color-fill-3);
  padding: 0 2px;
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

/* 修改折叠时的样式 */
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
  font-size: 20px;
}

/* 调整子菜单标题在折叠时的样式 */
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
  font-size: 24px;
}

/* 调整子菜单项在折叠时的样式 */
.arco-layout-sider-collapsed .arco-menu-item {
  padding: 8px 0;
  text-align: center;
  width: 100%;
}

/* 调整菜单容器的样 */
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

/* 移除之前的折叠相关样式，添加新的折叠布局样式 */

/* 左侧边栏基础样式 */
.arco-layout-sider {
  position: relative;
  background-color: var(--color-bg-2);
  transition: all 0.2s cubic-bezier(0.34, 0.69, 0.1, 1);
}

/* 折叠状态下的边栏样式 */
.arco-layout-sider-collapsed {
  width: 50px !important;
  min-width: 50px !important;
}

/* Add Folder 按钮样式 */
.arco-menu-item[key="add-folder"] {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 48px;
}

.arco-layout-sider-collapsed .arco-menu-item[key="add-folder"] .arco-icon {
  font-size: 20px;
}

/* 文件夹标题样式 */
.arco-sub-menu-title {
  height: 48px;
  line-height: 48px;
  padding: 0 16px;
}

.arco-layout-sider-collapsed .arco-sub-menu-title {
  padding: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 文件夹头像样式 */
.folder-avatar {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 连接项样式 */
.connection-item {
  height: 40px;
  line-height: 40px;
}

.arco-layout-sider-collapsed .connection-item {
  padding: 0 !important;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 隐藏折叠状态下的额外元素 */
.arco-layout-sider-collapsed .folder-actions,
.arco-layout-sider-collapsed .connection-actions,
.arco-layout-sider-collapsed .add-connection-button,
.arco-layout-sider-collapsed .connection-name {
  display: none;
}

/* 菜单样式调整 */
.arco-menu {
  border-right: none;
}

.arco-layout-sider-collapsed .arco-menu {
  width: 48px;
}

/* 折叠钮样式 */
.sider-trigger {
  position: absolute;
  bottom: 12px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: var(--color-bg-2);
  color: var(--color-text-1);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  z-index: 1;
  transition: all 0.2s;
}

.sider-trigger:hover {
  background-color: var(--color-fill-3);
  transform: scale(1.1);
}

/* 确保内容区域正确过渡 */
.arco-layout-content {
  transition: margin-left 0.2s cubic-bezier(0.34, 0.69, 0.1, 1);
}

/* 修改 Add Folder 按钮的样式 */
.arco-menu-item[key="add-folder"] {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 48px;
  padding: 0 !important;
}

.arco-menu-item[key="add-folder"] .arco-icon {
  font-size: 24px;
  margin: 0;
}

/* 调整折叠状态下的菜单样式 */
.arco-layout-sider-collapsed {
  width: 64px !important;
  min-width: 64px !important;
}

.arco-layout-sider-collapsed .arco-menu {
  width: 64px;
}

/* 确保折叠状态下的菜单项居中 */
.arco-layout-sider-collapsed .arco-menu-item {
  padding: 0 !important;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 移除菜单项的右边框 */
.arco-menu {
  border-right: none !important;
}

/* 调整图标大小和位置 */
.arco-menu-item .arco-icon {
  margin-right: 0;
  line-height: 1;
}

/* 确保菜单项在折叠状态下的宽度正确 */
.arco-layout-sider-collapsed .arco-menu-inner {
  width: 64px;
}

/* 调整菜单容器的样式 */
.arco-menu {
  width: 100%;
  transition: width 0.2s;
}

/* 确保图标在折叠状态下居中 */
.arco-layout-sider-collapsed .arco-menu-item[key="add-folder"] {
  width: 64px;
  padding: 12px 0 !important;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-actions .arco-btn {
  color: var(--color-text-1);
}

.header-actions .arco-btn:hover {
  background-color: var(--color-fill-3);
}

.setting-description {
  font-size: 12px;
  color: var(--color-text-3);
  margin-top: 4px;
}

.arco-form-item {
  margin-bottom: 24px;
}

.settings-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.settings-footer .copyright {
  color: var(--color-text-3);
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.settings-footer .buttons {
  display: flex;
  gap: 8px;
}

.settings-footer .arco-link {
  font-size: 16px;
  display: flex;
  align-items: center;
}

.settings-footer .arco-link:hover {
  color: var(--color-primary);
}

/* 确保图标垂直居中 */
.settings-footer .arco-icon {
  vertical-align: middle;
}
</style>




















