<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import draggable from 'vuedraggable'
import CollectionNightIcon from '../assets/collection-night.svg'
import CollectionDayIcon from '../assets/collection-day.svg'
import AddCollectionNightIcon from '../assets/plus-night.svg'
import AddCollectionDayIcon from '../assets/plus-day.svg'
import ConnectNightIcon from '../assets/connect-night.svg'
import ConnectDayIcon from '../assets/connect-day.svg'
import DeleteNightIcon from '../assets/delete-night.svg'
import DeleteDayIcon from '../assets/delete-day.svg'
import EditNightIcon from '../assets/edit-night.svg'
import EditDayIcon from '../assets/edit-day.svg'
import ConnectDialog from './ConnectDialog.vue'

// 主题状态 - 通过props接收父组件的isDarkTheme
const props = defineProps<{
  isDarkTheme: boolean
}>()

// 定义事件
const emit = defineEmits<{
  (e: 'connect-to-server', connection: Connection): void
}>()

// 菜单类型
type MenuType = 'organization' | 'connection' | 'area'

// 组织和连接项的数据结构
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

// 组织数据
const organizations = ref<Organization[]>([])

// 对话框状态
const dialogVisible = ref(false)
const dialogType = ref<'organization' | 'connection'>('organization')
const editingOrgId = ref<string | null>(null)
const editingConnId = ref<string | null>(null)

// 组织展开/折叠状态
const expandedOrganizations = ref<Record<string, boolean>>({})

// 拖拽状态
const isDragging = ref(false)
const dragSourceOrg = ref<string | null>(null)

// 拖拽相关样式
const dragOptionsOrg = {
  animation: 150,
  group: 'organizations',
  ghostClass: 'ghost-org',
  dragClass: 'dragging-org',
  handle: '.organization-header'
}

const dragOptionsConn = {
  animation: 150,
  group: 'connections',
  ghostClass: 'ghost-conn',
  dragClass: 'dragging-conn'
}

// 处理组织排序变化
const handleOrgChange = async (evt) => {
  console.log('组织排序变更:', evt)
  if (evt.moved) {
    await saveConnections()
  }
}

// 处理连接排序变化
const handleConnChange = async (evt) => {
  console.log('连接排序变更:', evt)
  if (evt.moved || evt.added || evt.removed) {
    await saveConnections()
  }
}

// 拖拽开始
const onDragStart = (orgId) => {
  isDragging.value = true
  dragSourceOrg.value = orgId
}

// 拖拽结束
const onDragEnd = () => {
  isDragging.value = false
  dragSourceOrg.value = null
}

// 加载连接配置
const loadConnections = async () => {
  try {
    const data = await window.api.loadConnections()
    organizations.value = data
    
    // 默认展开第一个组织
    if (data.length > 0) {
      expandedOrganizations.value[data[0].id] = false
    }
  } catch (error) {
    console.error('加载连接配置失败:', error)
  }
}

// 保存连接配置
const saveConnections = async () => {
  try {
    // 即使是空数组也允许保存
    const orgData = JSON.parse(JSON.stringify(organizations.value))
    console.log('前端发送保存请求，数据大小:', orgData.length, '个组织')
    
    // 添加重试机制
    let retryCount = 0;
    const maxRetries = 3;
    let success = false;
    
    while (!success && retryCount < maxRetries) {
      try {
        await window.api.saveConnections(orgData)
        console.log('保存连接配置成功')
        success = true
      } catch (error) {
        retryCount++;
        console.error(`保存连接配置失败(尝试 ${retryCount}/${maxRetries}):`, error)
        
        // 在重试之前等待一段时间
        if (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 500))
        }
      }
    }
    
    return success
  } catch (error) {
    console.error('保存连接配置失败:', error)
    return false
  }
}

// 切换组织展开/折叠状态
const toggleOrganization = (orgId: string) => {
  expandedOrganizations.value[orgId] = !expandedOrganizations.value[orgId]
}

// 右键菜单数据
const showContextMenu = ref(false)
const menuType = ref<MenuType>('area')
const menuPosition = ref({ x: 0, y: 0 })
const selectedOrganizationId = ref<string | null>(null)
const selectedConnectionId = ref<string | null>(null)

// 为连接生成随机颜色
const getConnectionColor = (connId: string) => {
  // 使用连接ID作为种子，确保相同ID总是得到相同颜色
  let hash = 0
  for (let i = 0; i < connId.length; i++) {
    hash = connId.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  // 生成HSL颜色，固定饱和度和亮度，只改变色相
  // 这样可以确保颜色鲜艳但不会太暗
  const hue = Math.abs(hash) % 360
  return `hsl(${hue}, 70%, 60%)`
}

// 显示右键菜单
const showMenu = (e: MouseEvent, type: MenuType, orgId?: string, connId?: string) => {
  e.preventDefault()
  showContextMenu.value = true
  menuType.value = type
  
  // 获取窗口宽度和高度
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight
  
  // 估计菜单宽高（可根据实际情况调整）
  const estimatedMenuWidth = 180 // 根据CSS中设置的min-width
  const estimatedMenuHeight = type === 'area' ? 40 : type === 'organization' ? 120 : 80 // 根据菜单项数量估计
  
  // 初始设置位置为鼠标位置
  let posX = e.clientX
  let posY = e.clientY
  
  // 检查右边界，如果超出则显示在鼠标左侧
  if (posX + estimatedMenuWidth > windowWidth) {
    posX = posX - estimatedMenuWidth
  }
  
  // 检查底部边界，如果超出则向上移动菜单
  if (posY + estimatedMenuHeight > windowHeight) {
    posY = posY - estimatedMenuHeight
  }
  
  // 设置调整后的位置
  menuPosition.value = { x: posX, y: posY }
  
  if (orgId) selectedOrganizationId.value = orgId
  if (connId) selectedConnectionId.value = connId

  // 添加一次性的点击事件监听，点击其他地方关闭菜单
  setTimeout(() => {
    window.addEventListener('click', closeMenu, { once: true })
    
    // 菜单渲染后进行精确调整
    nextTick(() => {
      const menuElement = document.querySelector('.context-menu') as HTMLElement
      if (menuElement) {
        const menuRect = menuElement.getBoundingClientRect()
        
        // 精确调整X坐标，确保不超出右边界
        if (menuRect.right > windowWidth) {
          menuPosition.value.x = windowWidth - menuRect.width
        }
        
        // 精确调整Y坐标，确保不超出底部边界
        if (menuRect.bottom > windowHeight) {
          menuPosition.value.y = windowHeight - menuRect.height
        }
        
        // 确保不超出左边界和上边界
        if (menuPosition.value.x < 0) menuPosition.value.x = 0
        if (menuPosition.value.y < 0) menuPosition.value.y = 0
      }
    })
  }, 0)
}

// 关闭右键菜单
const closeMenu = () => {
  showContextMenu.value = false
  selectedOrganizationId.value = null
  selectedConnectionId.value = null
}

// 打开新建组织对话框
const openCreateOrganizationDialog = () => {
  dialogType.value = 'organization'
  editingOrgId.value = null
  editingConnId.value = null
  dialogVisible.value = true
  closeMenu()
}

// 打开编辑组织对话框
const openEditOrganizationDialog = (orgId: string | null) => {
  if (!orgId) return
  dialogType.value = 'organization'
  editingOrgId.value = orgId
  editingConnId.value = null
  dialogVisible.value = true
  closeMenu()
}

// 打开新建连接对话框
const openCreateConnectionDialog = (orgId: string | null) => {
  if (!orgId) return
  dialogType.value = 'connection'
  editingOrgId.value = orgId
  editingConnId.value = null
  dialogVisible.value = true
  closeMenu()
}

// 打开编辑连接对话框
const openEditConnectionDialog = (orgId: string | null, connId: string | null) => {
  if (!orgId || !connId) return
  dialogType.value = 'connection'
  editingOrgId.value = orgId
  editingConnId.value = connId
  dialogVisible.value = true
  closeMenu()
}

// 处理表单保存
const handleSaveForm = async (data: { organizationId: string | null; connectionId: string | null; formData: any }) => {
  console.log('处理表单保存，数据:', data)
  
  if (dialogType.value === 'organization') {
    if (data.organizationId) {
      // 编辑现有组织
      const org = organizations.value.find(o => o.id === data.organizationId)
      if (org) {
        org.name = data.formData.name
        console.log('已更新组织名称:', org.name)
      }
    } else {
      // 创建新组织
      const newId = Date.now().toString()
      organizations.value.push({
        id: newId,
        name: data.formData.name,
        connections: []
      })
      console.log('已创建新组织:', data.formData.name)
      // 自动展开新创建的组织
      expandedOrganizations.value[newId] = true
    }
  } else if (dialogType.value === 'connection') {
    if (data.organizationId) {
      const org = organizations.value.find(o => o.id === data.organizationId)
      if (org) {
        if (data.connectionId) {
          // 编辑现有连接
          const conn = org.connections.find(c => c.id === data.connectionId)
          if (conn) {
            Object.assign(conn, data.formData)
            console.log('已更新连接:', conn.name)
          }
        } else {
          // 创建新连接
          const newId = `${data.organizationId}-${Date.now()}`
          const newConnection: Connection = {
            id: newId,
            ...data.formData
          }
          org.connections.push(newConnection)
          console.log('已创建新连接:', newConnection.name)
        }
      }
    }
  }
  
  console.log('组织数据更新后:', organizations.value)
  
  // 保存到本地存储
  try {
    await saveConnections()
    console.log('保存操作完成')
  } catch (error) {
    console.error('保存操作失败:', error)
  }
}

// 删除组织
const deleteOrganization = async (orgId: string | null) => {
  if (!orgId) return
  organizations.value = organizations.value.filter(o => o.id !== orgId)
  // 从展开状态中移除
  delete expandedOrganizations.value[orgId]
  closeMenu()
  
  // 保存到本地存储
  await saveConnections()
}

// 删除连接
const deleteConnection = async (orgId: string | null, connId: string | null) => {
  if (!orgId || !connId) return
  const org = organizations.value.find(o => o.id === orgId)
  if (org) {
    org.connections = org.connections.filter(c => c.id !== connId)
  }
  closeMenu()
  
  // 保存到本地存储
  await saveConnections()
}

// 连接到服务器
const connectToServer = (orgId: string | null, connId: string | null) => {
  if (!orgId || !connId) return
  const org = organizations.value.find(o => o.id === orgId)
  if (org) {
    const conn = org.connections.find(c => c.id === connId)
    if (conn) {
      console.log('连接到服务器:', conn)
      
      // 创建一个干净的连接对象副本，避免结构化克隆错误
      const cleanConnection = {
        id: conn.id,
        name: conn.name,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password || '',
        privateKey: conn.privateKey || '',
        privateKeyPath: conn.privateKeyPath || '',
        description: conn.description || ''
      }
      
      // 将连接信息发送到父组件
      emit('connect-to-server', cleanConnection)
    }
  }
  closeMenu()
}

// 重置所有连接
const resetAllConnections = () => {
  organizations.value = []
  expandedOrganizations.value = {}
  closeMenu()
  // 保存到本地存储
  saveConnections()
}

// 组件挂载和卸载时的事件处理
onMounted(async () => {
  // 加载连接配置
  await loadConnections()
  
  // 添加自动保存功能 - 每当organizations发生深度变化时保存
  watch(organizations, async () => {
    console.log('检测到organizations数据变化，自动保存')
    await saveConnections()
  }, { deep: true })
})

onUnmounted(() => {
  window.removeEventListener('click', closeMenu)
})
</script>

<template>
  <div class="connection-manager" @contextmenu="showMenu($event, 'area')">
    <!-- 仅在展开状态显示标题和连接列表 -->
    <div class="connection-manager-content">
      <h3>连接管理</h3>
      
      <div class="connection-list">
        <draggable 
          v-model="organizations" 
          item-key="id"
          v-bind="dragOptionsOrg"
          @start="onDragStart"
          @end="onDragEnd"
          @change="handleOrgChange"
          class="organization-draggable"
        >
          <template #item="{ element: org }">
            <div class="organization">
              <!-- 组织名称 -->
              <div 
                class="organization-header" 
                @click="toggleOrganization(org.id)"
                @contextmenu.stop="showMenu($event, 'organization', org.id)"
              >
                <div class="organization-name">
                  <span class="drag-handle">⋮⋮</span>
                  <img
                    :src="props.isDarkTheme ? CollectionNightIcon : CollectionDayIcon"
                    class="collection-icon"
                  />
                  {{ org.name }}
                </div>
              </div>
              
              <!-- 连接列表 -->
              <div v-show="expandedOrganizations[org.id]" class="connection-items">
                <draggable 
                  v-model="org.connections" 
                  item-key="id"
                  v-bind="dragOptionsConn"
                  @change="handleConnChange"
                  class="connection-draggable"
                >
                  <template #item="{ element: conn }">
                    <div 
                      class="connection-item"
                      @dblclick="connectToServer(org.id, conn.id)"
                      @contextmenu.stop="showMenu($event, 'connection', org.id, conn.id)"
                    >
                      <div class="connection-name">
                        <span class="drag-handle-conn">⋮⋮</span>
                        <div 
                          class="connection-color-block" 
                          :style="{ backgroundColor: getConnectionColor(conn.id) }"
                        ></div>
                        {{ conn.name }}
                      </div>
                    </div>
                  </template>
                </draggable>
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </div>
    
    <!-- 折叠状态下的垂直文字 -->
    <div class="connection-vertical-label">
      <span>连接管理</span>
    </div>
    
    <!-- 右键菜单 -->
    <div 
      v-if="showContextMenu" 
      class="context-menu"
      :class="{ 'dark-menu': props.isDarkTheme }"
      :style="{ top: `${menuPosition.y}px`, left: `${menuPosition.x}px` }"
    >
      <!-- 空白区域菜单 -->
      <template v-if="menuType === 'area'">
        <div class="menu-item" @click="openCreateOrganizationDialog">
          <img
            :src="props.isDarkTheme ? AddCollectionNightIcon : AddCollectionDayIcon"
            class="plus-icon"
          />
          新建组织
        </div>
        
        <div class="menu-item delete" @click="resetAllConnections" v-if="organizations.length > 0">
          <img
            :src="props.isDarkTheme ? DeleteNightIcon : DeleteDayIcon"
            class="delete-icon"
          />
          清空所有组织
        </div>
      </template>
      
      <!-- 组织菜单 -->
      <template v-else-if="menuType === 'organization'">
        <div class="menu-item" @click="openEditOrganizationDialog(selectedOrganizationId)">
          <img
            :src="props.isDarkTheme ? EditNightIcon : EditDayIcon"
            class="edit-icon"
          />
          编辑组织
        </div>
        <div class="menu-item" @click="openCreateConnectionDialog(selectedOrganizationId)">
          <img
            :src="props.isDarkTheme ? AddCollectionNightIcon : AddCollectionDayIcon"
            class="plus-icon"
          />
          新建连接
        </div>
        <div class="menu-item delete" @click="deleteOrganization(selectedOrganizationId)">
          <img
            :src="props.isDarkTheme ? DeleteNightIcon : DeleteDayIcon"
            class="delete-icon"
          />
          删除组织
        </div>
      </template>
      
      <!-- 连接菜单 -->
      <template v-else-if="menuType === 'connection'">
        <div class="menu-item" @click="connectToServer(selectedOrganizationId, selectedConnectionId)">
          <img
            :src="props.isDarkTheme ? ConnectNightIcon : ConnectDayIcon"
            class="connect-icon"
          />
          连接到服务器
        </div>
        <div class="menu-item" @click="openEditConnectionDialog(selectedOrganizationId, selectedConnectionId)">
          <img
            :src="props.isDarkTheme ? EditNightIcon : EditDayIcon"
            class="edit-icon"
          />
          编辑连接
        </div>
        <div class="menu-item delete" @click="deleteConnection(selectedOrganizationId, selectedConnectionId)">
          <img
            :src="props.isDarkTheme ? DeleteNightIcon : DeleteDayIcon"
            class="delete-icon"
          />
          删除连接
        </div>
      </template>
    </div>
    
    <!-- 连接编辑对话框 -->
    <ConnectDialog
      v-model:visible="dialogVisible"
      :edit-type="dialogType"
      :organization-id="editingOrgId"
      :connection-id="editingConnId"
      :organizations="organizations"
      :is-dark-theme="props.isDarkTheme"
      @save="handleSaveForm"
      @cancel="dialogVisible = false"
    />
  </div>
</template>

<style scoped>
:root {
  --text-color: #333;
  --text-color-light: #666;
  --section-bg-color: rgba(0, 0, 0, 0.05);
  --section-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1);
  --menu-bg-color: rgba(0, 0, 0, 0.05);
  --menu-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
  --menu-hover-bg: rgba(0, 0, 0, 0.07);
  --delete-color: #e53935;
  --border-color: rgba(0, 0, 0, 0.15);
  --separator-color: #e0e0e0;
}

:root .dark-menu {
  --text-color: #ffffff;
  --text-color-light: #aaa;
  --section-bg-color: rgba(255, 255, 255, 0.05);
  --section-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1);
  --menu-bg-color: rgba(255, 255, 255, 0.05);
  --menu-shadow: 0 2px 10px rgba(0, 0, 0, 0.3);
  --menu-hover-bg: rgba(255, 255, 255, 0.15);
  --delete-color: #ff6b6b;
  --border-color: rgba(255, 255, 255, 0.15);
  --separator-color: #444;
}

.connection-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: auto;
  padding: 10px;
  position: relative;
  color: var(--text-color);
}

h3 {
  margin-top: 0;
  margin-bottom: 15px;
  font-size: 16px;
  font-weight: 500;
  color: var(--text-color);
}

.connection-list {
  flex: 1;
  overflow: auto;
}

.organization {
  margin-bottom: 10px;
}

.organization-header {
  display: flex;
  align-items: center;
  padding: 5px;
  border-radius: 4px;
  cursor: pointer;
  margin-bottom: 2px;
}

.organization-header:hover {
  background-color: var(--menu-hover-bg);
}

.organization-name {
  display: flex;
  align-items: center;
  font-weight: 500;
  color: var(--text-color);
}

.collection-icon,
.plus-icon,
.connect-icon,
.delete-icon,
.edit-icon {
  width: 20px;
  height: 20px;
  margin-right: 8px;
}

.connection-items {
  margin-left: 20px;
  transition: all 0.3s ease;
}

.connection-item {
  display: flex;
  align-items: center;
  padding: 5px;
  margin-bottom: 2px;
  border-radius: 4px;
  cursor: pointer;
}

.connection-item:hover {
  background-color: var(--menu-hover-bg);
}

.connection-name {
  display: flex;
  align-items: center;
  color: var(--text-color);
}

/* 右键菜单 */
.context-menu {
  position: fixed;
  background-color: #f5f5f5;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  min-width: 180px;
  z-index: 9999;
  color: var(--text-color);
  opacity: 1 !important;
  backdrop-filter: none;
  border: 1px solid rgba(0, 0, 0, 0.2);
  overflow: hidden;
  padding: 4px 0;
  transition: top 0.1s ease, left 0.1s ease;
  max-height: 80vh; /* 防止在极端情况下菜单太长 */
  overflow-y: auto; /* 如果内容太多则显示滚动条 */
}

/* 暗色主题下的菜单样式 */
.dark-menu {
  background-color: #222;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}

.menu-item {
  padding: 8px 15px;
  display: flex;
  align-items: center;
  cursor: pointer;
  color: var(--text-color);
  transition: all 0.2s ease;
  position: relative;
  margin: 2px 4px;
  border-radius: 4px;
}

.menu-item:not(:last-child) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.dark-menu .menu-item:not(:last-child) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.menu-item svg {
  margin-right: 8px;
  fill: currentColor;
}

.menu-item:hover {
  background-color: rgba(0, 0, 0, 0.07);
}

.dark-menu .menu-item:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.menu-item.delete {
  color: var(--delete-color);
}

/* 编辑输入框 */
.editing-container {
  flex: 1;
}

.editing-input {
  width: 100%;
  background: transparent;
  border: 1px solid var(--border-color);
  padding: 3px 6px;
  border-radius: 3px;
  font-size: 14px;
  color: var(--text-color);
}

.dark-menu .editing-input {
  background-color: rgba(30, 30, 30, 0.5);
}

/* 图标样式 */
.dark-menu .folder-icon,
.dark-menu .terminal-icon,
.dark-menu .collection-icon,
.dark-menu .connect-icon,
.dark-menu .plus-icon,
.dark-menu .delete-icon,
.dark-menu .edit-icon {
  opacity: 1;
}

/* 确保夜间模式下分隔线可见 */
.menu-separator {
  height: 1px;
  background-color: var(--separator-color);
  margin: 4px 0;
}

/* 确保夜间模式下禁用项的样式 */
.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dark-menu .menu-item.disabled {
  opacity: 0.4;
}

/* 添加折叠/展开动画 */
/* 图标样式 */
.collection-open, 
.collection-close {
  transition: transform 0.3s ease;
}

.collection-open {
  transform: rotate(0deg);
}

.collection-close {
  transform: rotate(-90deg);
}

/* 连接颜色方块 */
.connection-color-block {
  width: 16px;
  height: 16px;
  border-radius: 3px;
  margin-right: 6px;
  flex-shrink: 0;
}

.dark-menu .connection-color-block {
  box-shadow: 0 0 1px rgba(255, 255, 255, 0.3);
}

/* 空状态提示 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px;
  color: var(--text-color-light);
  text-align: center;
}

.empty-state-icon {
  font-size: 40px;
  margin-bottom: 10px;
  opacity: 0.5;
}

.empty-state-text {
  margin-bottom: 20px;
}

.create-button {
  padding: 8px 15px;
  background-color: #4d90fe;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.create-button:hover {
  background-color: #3c78dc;
}

.dark-menu .create-button {
  background-color: #1a73e8;
}

.dark-menu .create-button:hover {
  background-color: #1967d2;
}

/* 右侧边栏折叠时隐藏连接管理内容 */
.right-sidebar-collapsed .connection-manager-content {
  display: none;
}

/* 折叠状态下的UI优化 */
.right-sidebar-collapsed .connection-manager {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  height: 100%;
  flex-direction: column;
}

/* 垂直文字样式 */
.connection-vertical-label {
  display: none;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  white-space: nowrap;
  padding: 15px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-color);
  letter-spacing: 2px;
  text-align: center;
  user-select: none;
  opacity: 0.8;
  transition: all 0.3s ease;
  position: relative;
}

/* 添加底部边框作为装饰 */
.connection-vertical-label::after {
  content: '';
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 20px;
  height: 2px;
  background-color: currentColor;
  border-radius: 1px;
  opacity: 0.6;
  transition: width 0.3s ease, opacity 0.3s ease;
}

/* 悬停效果 */
.connection-vertical-label:hover {
  opacity: 1;
  letter-spacing: 3px;
}

.connection-vertical-label:hover::after {
  width: 28px;
  opacity: 0.8;
}

/* 折叠状态下显示垂直文字 */
.right-sidebar-collapsed .connection-vertical-label {
  display: block;
}

/* 暗色主题下的垂直文字样式 */
.dark-theme .connection-vertical-label {
  color: var(--text-color-light);
}

.dark-theme .connection-vertical-label:hover {
  color: white;
}

/* 拖拽相关样式 */
.organization-draggable,
.connection-draggable {
  min-height: 5px; /* 确保即使没有项目也有拖拽区域 */
}

.drag-handle,
.drag-handle-conn {
  cursor: move;
  font-size: 14px;
  margin-right: 5px;
  color: var(--text-color-light);
  opacity: 0.5;
  transition: opacity 0.2s ease;
  user-select: none;
}

.drag-handle-conn {
  font-size: 12px;
}

.organization-header:hover .drag-handle,
.connection-item:hover .drag-handle-conn {
  opacity: 0.8;
}

.ghost-org {
  opacity: 0.6;
  background-color: var(--section-bg-color);
  border: 1px dashed var(--border-color);
}

.ghost-conn {
  opacity: 0.6;
  background-color: var(--section-bg-color);
  border: 1px dashed var(--border-color);
}

.dragging-org,
.dragging-conn {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
  opacity: 0.8;
  background-color: var(--menu-hover-bg);
  z-index: 1;
}
</style> 