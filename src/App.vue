<template>
  <a-config-provider :theme="theme">
    <a-layout class="layout">
      <a-layout-header>
        <div class="header-content">
          <h1>SSH Client</h1>
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
      </a-layout-header>
      <a-layout class="main-content">
        <a-layout-sider width="250" style="background: var(--color-bg-2);">
          <a-menu mode="inline">
            <a-menu-item key="add-folder" @click="showAddFolderModal">
              <icon-folder-add />
            </a-menu-item>
            <a-sub-menu v-for="folder in folders" :key="folder.id">
              <template #title>
                <span>{{ folder.name }}</span>
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
              >
                {{ conn.name }}
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

      <a-modal v-model:visible="addConnectionModalVisible" title="Add SSH Connection" @ok="addConnection">
        <a-form :model="newConnection">
          <a-form-item label="Name">
            <a-input v-model="newConnection.name" />
          </a-form-item>
          <a-form-item label="Host">
            <a-input v-model="newConnection.host" />
          </a-form-item>
          <a-form-item label="Port">
            <a-input-number v-model="newConnection.port" :min="1" :max="65535" />
          </a-form-item>
          <a-form-item label="Username">
            <a-input v-model="newConnection.username" />
          </a-form-item>
          <a-form-item label="Authentication">
            <a-radio-group v-model="newConnection.authType">
              <a-radio value="password">Password</a-radio>
              <a-radio value="key">Private Key</a-radio>
            </a-radio-group>
          </a-form-item>
          <a-form-item v-if="newConnection.authType === 'password'" label="Password">
            <a-input-password v-model="newConnection.password" />
          </a-form-item>
          <a-form-item v-if="newConnection.authType === 'key'" label="Private Key">
            <a-input v-model="newConnection.privateKey" type="textarea" />
          </a-form-item>
        </a-form>
      </a-modal>

      <a-modal v-model:visible="addFolderModalVisible" title="Add Folder" @ok="addFolder">
        <a-form :model="newFolder">
          <a-form-item label="Folder Name">
            <a-input v-model="newFolder.name" />
          </a-form-item>
        </a-form>
      </a-modal>
    </a-layout>
  </a-config-provider>
</template>

<script>
import { ref, reactive, provide, onMounted, watch, onUnmounted, nextTick, computed } from 'vue'
import SSHTerminal from './components/SSHTerminal.vue'
import SFTPExplorer from './components/SFTPExplorer.vue'
import { IconMoonFill, IconSunFill, IconClose, IconFolderAdd, IconMenuFold, IconMenuUnfold } from '@arco-design/web-vue/es/icon'
import axios from 'axios'

export default {
  name: 'App',
  components: {
    SSHTerminal,
    SFTPExplorer,
    IconMoonFill,
    IconSunFill,
    IconClose,
    IconFolderAdd,
    IconMenuFold,
    IconMenuUnfold
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
      addConnectionModalVisible.value = true
      newConnection.folderId = folderId
    }

    const addConnection = async () => {
      const connection = { 
        ...newConnection, 
        id: Date.now(),
        type: 'connection'
      }
      
      if (connection.folderId) {
        const folder = folders.value.find(f => f.id === connection.folderId)
        if (folder) {
          if (!folder.connections) {
            folder.connections = []
          }
          folder.connections.push(connection)
        }
      } else {
        connections.value.push(connection)
      }
      
      try {
        await axios.post('http://localhost:5000/add_connection', connection)
        console.log('Connection saved successfully')
        await fetchConnections() // 重新获取所有连接以更新视图
      } catch (error) {
        console.error('Failed to save connection:', error)
      }

      addConnectionModalVisible.value = false
      // Reset form
      Object.assign(newConnection, {
        name: '',
        host: '',
        port: 22,
        username: '',
        authType: 'password',
        password: '',
        privateKey: '',
        folderId: null
      })
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
        const response = await axios.get('http://localhost:5000/get_connections')
        const allItems = response.data
        
        folders.value = allItems.filter(item => item.type === 'folder').map(folder => ({
          ...folder,
          connections: folder.connections || []
        }))
        connections.value = allItems.filter(item => item.type === 'connection' && !item.folderId)
      } catch (error) {
        console.error('Failed to fetch connections:', error)
      }
    }

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

    // 监听标签页的变化
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
      
      // 添加系统主题变化的监听器
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
  z-index: 1000;
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
  z-index: 1002;
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
  display: inline-block;
  padding: 4px 8px;
  background-color: var(--color-fill-2);
  color: var(--color-text-1);
  border-radius: 4px;
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

/* 添加以下样式来调整图标按钮的外观 */
.arco-menu-item .arco-icon {
  font-size: 18px;
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
</style>
