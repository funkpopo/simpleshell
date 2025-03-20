# 创建新文件
<script setup lang="ts">
import { ref, onMounted, watch, nextTick, onBeforeUnmount, onUnmounted } from 'vue'
import path from 'path'
import DeleteDayIcon from '../assets/delete-day.svg'
import DeleteNightIcon from '../assets/delete-night.svg'
import UploadDayIcon from '../assets/upload-day.svg'
import UploadNightIcon from '../assets/upload-night.svg'
import DownloadDayIcon from '../assets/download-day.svg'
import DownloadNightIcon from '../assets/download-night.svg'
import PlusDayIcon from '../assets/plus-day.svg'
import PlusNightIcon from '../assets/plus-night.svg'
import BackDayIcon from '../assets/back-day.svg'
import BackNightIcon from '../assets/back-night.svg'
import RefreshDayIcon from '../assets/refresh-day.svg'
import RefreshNightIcon from '../assets/refresh-night.svg'
import OpenFolderDayIcon from '../assets/openfolder-day.svg'
import OpenFolderNightIcon from '../assets/openfolder-night.svg'
import InfoDayIcon from '../assets/info-day.svg'
import InfoNightIcon from '../assets/info-night.svg'

// 定义文件/文件夹项的接口
interface FileItem {
  name: string
  type: 'file' | 'directory'
  size: number
  modifyTime: string
  permissions: string
  owner: string
  group: string
}

// 文件传输类型
type TransferType = 'upload' | 'download'

// 文件传输项
interface TransferItem {
  id: string
  filename: string
  path: string
  type: TransferType
  size: number
  transferred: number
  progress: number
  status: 'pending' | 'transferring' | 'verifying' | 'completed' | 'error' | 'cancelled'
  error?: string
  removeTimer?: number // 添加移除计时器ID
  pendingRemoval?: boolean // 添加准备删除标志
  completedAt?: number // 添加完成时间戳
  _lastUpdateTime?: number // 添加上次更新时间戳
  _lastVerifyTime?: number // 添加上次验证时间戳
}

// 定义props
const props = defineProps<{
  connectionId: string
  isDarkTheme: boolean
  sidebarWidth?: number
}>()

// 当前路径
const currentPath = ref('/')
// 路径输入框引用
const pathInputRef = ref<HTMLInputElement | null>(null)
// 文件列表
const fileList = ref<FileItem[]>([])
// 加载状态
const isLoading = ref(false)
// 错误信息
const error = ref('')
// 成功消息
const successMessage = ref('')
// 成功消息计时器
let successMessageTimer: number | null = null
// 选中的文件
const selectedFiles = ref<Set<string>>(new Set())
// 选中的项目类型映射
const selectedItemTypes = ref<Map<string, 'file' | 'directory'>>(new Map())
// 删除操作进度状态
const deleteProgress = ref({
  isDeleting: false,
  total: 0,
  completed: 0,
  currentItem: ''
})

// 文件信息对话框
const showFileInfoDialog = ref(false)

interface FileRights {
  user: string
  group: string
  other: string
  [key: string]: string | unknown
}

interface FileInfo {
  name: string
  path?: string
  size: number
  modifyTime?: Date
  accessTime?: Date
  rights?: FileRights
  owner?: string | number
  group?: string | number
  type: string
  isSymbolicLink?: boolean
  items?: number
  permissions?: string
  [key: string]: string | number | boolean | Date | FileRights | undefined | unknown
}

const fileInfo = ref<FileInfo | null>(null)

// 文件传输进度状态
const transferProgress = ref<TransferItem[]>([])
// 是否显示传输进度浮窗
const showTransferProgress = ref(false)
// 传输浮窗位置
const transferWindowPosition = ref({ x: 20, y: 20 })
// 是否正在拖动传输浮窗
const isDraggingTransferWindow = ref(false)
// 拖动初始位置
const dragStartPosition = ref({ x: 0, y: 0, windowX: 0, windowY: 0 })
// 传输浮窗是否折叠
const isTransferWindowCollapsed = ref(false)
// 最近传输的文件历史
const recentTransfers = ref<{ id: string; filename: string; type: TransferType; status: string }[]>(
  []
)
// 在没有显示传输窗口时显示的最新传输提示
const latestTransferNotification = ref<{
  message: string
  type: 'success' | 'error' | 'info'
  visible: boolean
}>({
  message: '',
  type: 'info',
  visible: false
})
// 最新传输提示计时器
let latestTransferNotificationTimer: number | null = null

// 排序方式
const sortBy = ref<'name' | 'size' | 'modifyTime'>('name')
const sortOrder = ref<'asc' | 'desc'>('asc')
// 右键菜单状态
const showContextMenu = ref(false)
const menuPosition = ref({ x: 0, y: 0 })
const contextMenuTarget = ref<'file' | 'directory' | 'background'>('background')
const clickedItem = ref<string | null>(null)
// 高亮显示的项目
const highlightedItem = ref<string | null>(null)
// 加载超时时间（毫秒）
const LOADING_TIMEOUT = 15000 // 增加到15秒

// 格式化文件大小
const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// 格式化修改时间
const formatModifyTime = (time: string): string => {
  return new Date(time).toLocaleString()
}

// 定期检查传输状态的定时器
let transferStatusCheckTimer: number | null = null

// 加载当前目录内容
const loadCurrentDirectory = async () => {
  try {
    console.log('开始加载目录，连接ID:', props.connectionId)
    console.log('当前路径:', currentPath.value)
    isLoading.value = true
    error.value = ''

    if (!props.connectionId) {
      console.error('无效的连接ID')
      error.value = '连接ID无效'
      return
    }

    // 清除之前的选中和高亮状态
    selectedFiles.value.clear()
    selectedItemTypes.value.clear()

    // 添加加载超时控制
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('加载目录超时，请稍后再试')), LOADING_TIMEOUT)
    })

    // 添加重试机制
    let retryCount = 0
    const maxRetries = 3
    const retryDelay = 1000 // 1秒

    while (retryCount < maxRetries) {
      try {
        // 使用Promise.race在超时和正常请求之间竞争
        interface ReadDirResult {
          success: boolean
          files?: FileInfo[]
          error?: string
        }

        const result = (await Promise.race([
          window.api.sftpReadDir({
            connectionId: props.connectionId,
            path: currentPath.value
          }),
          timeoutPromise
        ])) as ReadDirResult

        if (result.success && result.files) {
          console.log('目录加载成功，文件数量:', result.files.length)
          // Convert FileInfo[] to FileItem[] with proper type conversion
          fileList.value = result.files.map((file) => ({
            name: file.name,
            type: file.type === 'directory' ? 'directory' : 'file',
            size: file.size,
            modifyTime: file.modifyTime ? file.modifyTime.toLocaleString() : '',
            permissions: file.permissions || '',
            owner: String(file.owner || ''),
            group: String(file.group || '')
          })) as FileItem[]

          // 如果存在高亮项，滚动到该项
          if (highlightedItem.value) {
            await scrollToHighlightedItem()
          }

          return // 成功后直接返回
        } else {
          console.error(`目录加载失败 (尝试 ${retryCount + 1}/${maxRetries}):`, result.error)
          error.value = result.error || '加载目录失败'
          fileList.value = []
        }
      } catch (err: unknown) {
        console.error(`加载目录时发生错误 (尝试 ${retryCount + 1}/${maxRetries}):`, err)
        error.value = err instanceof Error ? err.message : '加载目录时发生错误'
        fileList.value = []
      }

      retryCount++
      if (retryCount < maxRetries) {
        console.log(`等待 ${retryDelay}ms 后重试...`)
        await new Promise((resolve) => setTimeout(resolve, retryDelay))
      }
    }
  } finally {
    isLoading.value = false
  }
}

// 滚动到高亮显示的项目
const scrollToHighlightedItem = async () => {
  await nextTick()
  if (highlightedItem.value) {
    const highlightedElement = document.querySelector(
      `.file-list-row[data-name="${highlightedItem.value}"]`
    )
    if (highlightedElement) {
      highlightedElement.scrollIntoView({ behavior: 'smooth', block: 'center' })

      // 3秒后取消高亮
      setTimeout(() => {
        highlightedItem.value = null
      }, 3000)
    }
  }
}

// 进入目录
const enterDirectory = async (dirName: string) => {
  const newPath = currentPath.value === '/' ? `/${dirName}` : `${currentPath.value}/${dirName}`

  currentPath.value = newPath
}

// 通过路径输入框跳转
const navigateToPath = (event: Event) => {
  event.preventDefault()

  if (!pathInputRef.value) return

  let inputPath = pathInputRef.value.value.trim()

  // 格式化路径
  if (!inputPath.startsWith('/')) {
    inputPath = `/${inputPath}`
  }

  // 如果路径最后有斜杠且不是根路径，则删除
  if (inputPath.length > 1 && inputPath.endsWith('/')) {
    inputPath = inputPath.slice(0, -1)
  }

  // 解析目标目录和可能的高亮文件/文件夹
  let targetDir = inputPath
  let targetItem: string | null = null

  const lastSlashIndex = inputPath.lastIndexOf('/')
  const lastSegment = inputPath.substring(lastSlashIndex + 1)

  if (lastSegment && lastSlashIndex !== 0) {
    // 检查最后一段是否是文件/文件夹名
    targetDir = inputPath.substring(0, lastSlashIndex) || '/'
    targetItem = lastSegment
  }

  // 设置当前路径和高亮项
  highlightedItem.value = targetItem
  currentPath.value = targetDir
}

// 返回上级目录
const goToParentDirectory = () => {
  if (currentPath.value === '/') return

  const parentPath = currentPath.value.split('/').slice(0, -1).join('/')
  currentPath.value = parentPath || '/'
}

// 选择文件
const toggleFileSelection = (
  fileName: string,
  fileType: 'file' | 'directory',
  event?: MouseEvent
) => {
  // 如果有按住Ctrl键，则不清除之前的选择
  if (event && !event.ctrlKey && !event.metaKey) {
    selectedFiles.value.clear()
    selectedItemTypes.value.clear()
  }

  if (selectedFiles.value.has(fileName)) {
    selectedFiles.value.delete(fileName)
    selectedItemTypes.value.delete(fileName)
  } else {
    selectedFiles.value.add(fileName)
    selectedItemTypes.value.set(fileName, fileType)
  }
}

// 清除选择
const clearSelection = () => {
  selectedFiles.value.clear()
  selectedItemTypes.value.clear()
}

// 下载选中的文件
const downloadSelectedFiles = async () => {
  try {
    for (const fileName of selectedFiles.value) {
      const result = await window.api.sftpDownloadFile({
        connectionId: props.connectionId,
        remotePath: `${currentPath.value}/${fileName}`
      })

      if (!result.success) {
        error.value = `下载文件 ${fileName} 失败: ${result.error}`
        break
      }
    }
    clearSelection()
    // 成功通知由传输事件处理，此处不再显示
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : '下载文件时发生错误'
  }
}

// 上传文件
const uploadFiles = async (targetPath?: string) => {
  try {
    const result = await window.api.openFileDialog({
      title: '选择要上传的文件',
      buttonLabel: '上传',
      properties: ['openFile', 'multiSelections']  // 确保允许多选
    })

    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
      const uploadPath = targetPath || currentPath.value
      showTransferProgress.value = true

      console.log(`准备上传 ${result.filePaths.length} 个文件到 ${uploadPath}`)
      
      try {
        // 直接使用批量上传API
        const uploadResult = await window.api.sftpUploadFiles({
          connectionId: props.connectionId,
          localPaths: result.filePaths,
          remotePath: uploadPath
        })

        // 上传完成后刷新文件列表
        await loadCurrentDirectory()

        if (!uploadResult.success) {
          if (uploadResult.failedFiles && uploadResult.failedFiles.length > 0) {
            const failedCount = uploadResult.failedFiles.length
            const totalCount = result.filePaths.length
            const successCount = totalCount - failedCount
            
            error.value = `上传完成，${successCount}个成功，${failedCount}个失败`
            console.error('上传失败的文件:', uploadResult.failedFiles.map(f => path.basename(f)).join(', '))
          } else if (uploadResult.error) {
            error.value = uploadResult.error
          }
        } else {
          successMessage.value = `成功上传 ${result.filePaths.length} 个文件`
          if (successMessageTimer) {
            clearTimeout(successMessageTimer)
          }
          successMessageTimer = window.setTimeout(() => {
            successMessage.value = ''
            successMessageTimer = null
          }, 3000)
        }
      } catch (err) {
        console.error('批量上传文件时发生错误:', err)
        error.value = err instanceof Error ? err.message : '批量上传文件时发生错误'
      }
    }
  } catch (err) {
    console.error('选择文件时发生错误:', err)
    error.value = err instanceof Error ? err.message : '选择文件时发生错误'
  }
}

// 上传文件到指定文件夹
const handleUploadToFolder = async (e: MouseEvent) => {
  e.preventDefault()
  if (clickedItem.value) {
    const targetPath = `${currentPath.value}/${clickedItem.value}`
    await uploadFiles(targetPath)
  }
}

// 创建新文件夹
const createNewDirectory = async () => {
  const dirName = prompt('请输入文件夹名称:')
  if (!dirName) return

  try {
    const result = await window.api.sftpMkdir({
      connectionId: props.connectionId,
      path: `${currentPath.value}/${dirName}`
    })

    if (result.success) {
      await loadCurrentDirectory()
      // 创建成功后高亮新文件夹
      highlightedItem.value = dirName
    } else {
      error.value = result.error || '创建文件夹失败'
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : '创建文件夹时发生错误'
  }
}

// 获取选中的项目的类型统计
const getSelectedItemsCount = () => {
  let files = 0
  let directories = 0

  selectedItemTypes.value.forEach((type: 'file' | 'directory') => {
    if (type === 'file') files++
    else directories++
  })

  return { files, directories }
}

// 拖拽状态
const isDraggingOver = ref(false)
const dragTargetItem = ref<string | null>(null)
const dragTargetType = ref<'file' | 'directory' | 'background'>('background')

// 处理拖拽开始
const handleDragOver = (e: DragEvent, targetType: 'file' | 'directory' | 'background' = 'background', targetName?: string) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 设置拖拽状态
  isDraggingOver.value = true
  
  // 记录拖拽目标
  if (targetType && targetType !== 'background') {
    dragTargetItem.value = targetName || null
    dragTargetType.value = targetType
  } else {
    dragTargetItem.value = null
    dragTargetType.value = 'background'
  }
  
  // 设置拖拽效果
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
}

// 处理拖拽离开
const handleDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 检查是否真的离开了容器
  // 有时拖拽在子元素之间移动也会触发离开事件
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY
  
  // 如果鼠标仍在容器内，不处理离开事件
  if (
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  ) {
    return
  }
  
  // 重置拖拽状态
  isDraggingOver.value = false
  dragTargetItem.value = null
}

// 处理文件拖放
const handleDrop = async (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 重置拖拽状态
  isDraggingOver.value = false
  
  // 注意: 这里我们处理的是从外部拖入应用的文件
  // 对于从应用拖出到其他应用的情况，应该使用 Electron 的 webContents.startDrag API
  
  // 检查是否有文件被拖放
  if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
    console.log('没有文件被拖放')
    return
  }
  
  try {
    // 确定上传目标路径
    let targetPath = currentPath.value
    
    // 如果拖放到文件夹上，使用该文件夹作为目标
    if (dragTargetType.value === 'directory' && dragTargetItem.value) {
      targetPath = `${currentPath.value}/${dragTargetItem.value}`
    }
    
    console.log(`准备上传文件到: ${targetPath}`)
    
    // 获取拖放的文件列表
    const files = Array.from(e.dataTransfer.files)
    
    // 显示上传进度窗口
    showTransferProgress.value = true
    
    if (files.length > 1) {
      // 批量处理文件上传
      const filePathPromises = files.map(async (file) => {
        // 获取文件路径，如果file.path不存在，则需要读取文件内容并保存到临时文件
        let filePath = (file as any).path
        
        if (!filePath) {
          console.log(`文件 ${file.name} 没有路径信息，将使用FileReader读取内容`)
          
          // 使用FileReader读取文件内容
          const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = reject
            reader.readAsArrayBuffer(file)
          })
          
          // 将文件内容发送到主进程保存为临时文件
          const result = await window.electron.ipcRenderer.invoke('save-file-content', {
            name: file.name,
            content: fileContent
          })
          
          if (!result) {
            throw new Error(`无法保存文件内容: ${file.name}`)
          }
          
          return result.path
        }
        
        return filePath
      })
      
      try {
        // 等待所有文件路径处理完成
        const filePaths = await Promise.all(filePathPromises)
        
        // 批量上传所有文件
        const uploadResult = await window.api.sftpUploadFiles({
          connectionId: props.connectionId,
          localPaths: filePaths,
          remotePath: targetPath
        })
        
        if (!uploadResult.success && uploadResult.failedFiles && uploadResult.failedFiles.length > 0) {
          const failedCount = uploadResult.failedFiles.length
          error.value = `${failedCount} 个文件上传失败`
        }
        
        // 上传完成后刷新文件列表
        await loadCurrentDirectory()
        
        // 清理临时文件
        const tempFilePaths = filePaths.filter(path => !(files.some(file => (file as any).path === path)))
        for (const tempPath of tempFilePaths) {
          try {
            await window.electron.ipcRenderer.invoke('delete-temp-file', tempPath)
            console.log(`临时文件已删除: ${tempPath}`)
          } catch (deleteError) {
            console.error(`删除临时文件失败: ${tempPath}`, deleteError)
          }
        }
      } catch (err) {
        console.error('批量上传文件时发生错误:', err)
        error.value = err instanceof Error ? err.message : '批量上传文件时发生错误'
      }
    } else {
      // 单文件上传，使用原有逻辑
      // 上传所有文件
      for (const file of files) {
        try {
          // 检查文件对象是否有效
          if (!file) {
            console.error('无效的文件对象')
            continue
          }
          
          // 获取文件名
          const fileName = file.name
          
          // 获取文件路径，如果file.path不存在，则需要读取文件内容并保存到临时文件
          let filePath = (file as any).path
          let tempFilePath = null
          
          if (!filePath) {
            console.log(`文件 ${fileName} 没有路径信息，将使用FileReader读取内容`)
            
            // 使用FileReader读取文件内容
            const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as ArrayBuffer)
              reader.onerror = reject
              reader.readAsArrayBuffer(file)
            })
            
            // 将文件内容发送到主进程保存为临时文件
            const result = await window.electron.ipcRenderer.invoke('save-file-content', {
              name: fileName,
              content: fileContent
            })
            
            if (!result) {
              throw new Error(`无法保存文件内容: ${fileName}`)
            }
            
            tempFilePath = result.path
            filePath = tempFilePath
          }
          
          // 使用SFTP上传文件 - 与右键菜单选择文件上传一致
          await window.api.sftpUploadFile({
            connectionId: props.connectionId,
            localPath: filePath,
            remotePath: targetPath
          })
          
          console.log(`文件 ${fileName} 上传请求已发送`)
          
          // 如果使用了临时文件，上传完成后删除
          if (tempFilePath) {
            try {
              await window.electron.ipcRenderer.invoke('delete-temp-file', tempFilePath)
              console.log(`临时文件已删除: ${tempFilePath}`)
            } catch (deleteError) {
              console.error(`删除临时文件失败: ${tempFilePath}`, deleteError)
            }
          }
        } catch (fileError) {
          console.error(`上传文件 ${file.name} 时发生错误:`, fileError)
          error.value = fileError instanceof Error ? fileError.message : `上传文件 ${file.name} 时发生错误`
        }
      }
    }
    
    // 重置拖拽目标
    dragTargetItem.value = null
    dragTargetType.value = 'background'
    
    // 上传完成后清空临时文件夹
    await clearTempDirectory()
    
  } catch (err) {
    console.error('处理拖放文件时发生错误:', err)
    error.value = err instanceof Error ? err.message : '处理拖放文件时发生错误'
  }
}

// 处理文件夹项目的拖拽事件
const handleFolderDragOver = (e: DragEvent, folderName: string) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 设置拖拽状态
  isDraggingOver.value = true
  
  // 记录拖拽目标
  dragTargetItem.value = folderName
  dragTargetType.value = 'directory'
  
  // 设置拖拽效果
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
}

// 处理文件夹的拖拽离开
const handleFolderDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 重置拖拽目标，但保持整体拖拽状态
  dragTargetItem.value = null
  // 不重置isDraggingOver，因为文件可能仍在文件管理器内
}

// 处理文件夹的拖放
const handleFolderDrop = async (e: DragEvent, folderName: string) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 重置拖拽状态
  isDraggingOver.value = false
  dragTargetItem.value = null
  
  // 检查是否有文件被拖放
  if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
    console.log('没有文件被拖放到文件夹')
    return
  }
  
  try {
    // 构建目标路径
    const targetPath = `${currentPath.value}/${folderName}`
    
    console.log(`准备上传文件到文件夹: ${targetPath}`)
    
    // 获取拖放的文件列表
    const files = Array.from(e.dataTransfer.files)
    
    // 显示上传进度窗口
    showTransferProgress.value = true
    
    if (files.length > 1) {
      // 批量处理文件上传
      const filePathPromises = files.map(async (file) => {
        // 获取文件路径，如果file.path不存在，则需要读取文件内容并保存到临时文件
        let filePath = (file as any).path
        
        if (!filePath) {
          console.log(`文件 ${file.name} 没有路径信息，将使用FileReader读取内容`)
          
          // 使用FileReader读取文件内容
          const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = reject
            reader.readAsArrayBuffer(file)
          })
          
          // 将文件内容发送到主进程保存为临时文件
          const result = await window.electron.ipcRenderer.invoke('save-file-content', {
            name: file.name,
            content: fileContent
          })
          
          if (!result) {
            throw new Error(`无法保存文件内容: ${file.name}`)
          }
          
          return result.path
        }
        
        return filePath
      })
      
      try {
        // 等待所有文件路径处理完成
        const filePaths = await Promise.all(filePathPromises)
        
        // 批量上传所有文件
        const uploadResult = await window.api.sftpUploadFiles({
          connectionId: props.connectionId,
          localPaths: filePaths,
          remotePath: targetPath
        })
        
        if (!uploadResult.success && uploadResult.failedFiles && uploadResult.failedFiles.length > 0) {
          const failedCount = uploadResult.failedFiles.length
          error.value = `${failedCount} 个文件上传失败`
        }
        
        // 上传完成后刷新文件列表
        await loadCurrentDirectory()
        
        // 清理临时文件
        const tempFilePaths = filePaths.filter(path => !(files.some(file => (file as any).path === path)))
        for (const tempPath of tempFilePaths) {
          try {
            await window.electron.ipcRenderer.invoke('delete-temp-file', tempPath)
            console.log(`临时文件已删除: ${tempPath}`)
          } catch (deleteError) {
            console.error(`删除临时文件失败: ${tempPath}`, deleteError)
          }
        }
      } catch (err) {
        console.error('批量上传文件时发生错误:', err)
        error.value = err instanceof Error ? err.message : '批量上传文件时发生错误'
      }
    } else {
      // 单文件上传，使用原有逻辑
      // 上传所有文件
      for (const file of files) {
        try {
          // 检查文件对象是否有效
          if (!file) {
            console.error('无效的文件对象')
            continue
          }
          
          // 获取文件名
          const fileName = file.name
          
          // 获取文件路径，如果file.path不存在，则需要读取文件内容并保存到临时文件
          let filePath = (file as any).path
          let tempFilePath = null
          
          if (!filePath) {
            console.log(`文件 ${fileName} 没有路径信息，将使用FileReader读取内容`)
            
            // 使用FileReader读取文件内容
            const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as ArrayBuffer)
              reader.onerror = reject
              reader.readAsArrayBuffer(file)
            })
            
            // 将文件内容发送到主进程保存为临时文件
            const result = await window.electron.ipcRenderer.invoke('save-file-content', {
              name: fileName,
              content: fileContent
            })
            
            if (!result) {
              throw new Error(`无法保存文件内容: ${fileName}`)
            }
            
            tempFilePath = result.path
            filePath = tempFilePath
          }
          
          // 使用SFTP上传文件 - 与右键菜单选择文件上传一致
          await window.api.sftpUploadFile({
            connectionId: props.connectionId,
            localPath: filePath,
            remotePath: targetPath
          })
          
          console.log(`文件 ${fileName} 上传请求已发送到文件夹 ${folderName}`)
          
          // 如果使用了临时文件，上传完成后删除
          if (tempFilePath) {
            try {
              await window.electron.ipcRenderer.invoke('delete-temp-file', tempFilePath)
              console.log(`临时文件已删除: ${tempFilePath}`)
            } catch (deleteError) {
              console.error(`删除临时文件失败: ${tempFilePath}`, deleteError)
            }
          }
        } catch (fileError) {
          console.error(`上传文件 ${file.name} 到文件夹 ${folderName} 时发生错误:`, fileError)
          error.value = fileError instanceof Error ? fileError.message : `上传文件 ${file.name} 时发生错误`
        }
      }
    }
    
    // 上传完成后清空临时文件夹
    await clearTempDirectory()
    
  } catch (err) {
    console.error('处理拖放文件到文件夹时发生错误:', err)
    error.value = err instanceof Error ? err.message : '处理拖放文件时发生错误'
  }
}

// 清空临时文件夹
const clearTempDirectory = async () => {
  try {
    // 获取临时文件夹路径
    const tempDir = await window.electron.ipcRenderer.invoke('get-temp-dir')
    console.log('清空临时文件夹:', tempDir)
    
    // 调用主进程清空临时文件夹
    await window.electron.ipcRenderer.invoke('clear-temp-directory')
    
    console.log('临时文件夹清空完成')
  } catch (error) {
    console.error('清空临时文件夹失败:', error)
  }
}

// 组件卸载前清空临时文件夹
onBeforeUnmount(async () => {
  await clearTempDirectory()
})

// 显示成功消息
const showSuccessMessage = (message: string) => {
  // 清除之前的计时器
  if (successMessageTimer !== null) {
    clearTimeout(successMessageTimer)
  }

  // 设置新消息
  successMessage.value = message

  // 3秒后自动清除
  successMessageTimer = window.setTimeout(() => {
    successMessage.value = ''
    successMessageTimer = null
  }, 3000)
}

// 删除选中的文件/文件夹
const deleteSelectedItems = async () => {
  const { files, directories } = getSelectedItemsCount()

  let confirmMessage = ''
  if (files > 0 && directories > 0) {
    confirmMessage = `确定要删除选中的 ${files} 个文件和 ${directories} 个文件夹吗？此操作不可恢复。`
  } else if (files > 0) {
    confirmMessage = `确定要删除选中的 ${files} 个文件吗？此操作不可恢复。`
  } else if (directories > 0) {
    confirmMessage = `确定要删除选中的 ${directories} 个文件夹吗？文件夹内的所有内容也会被删除，此操作不可恢复。`
  } else {
    return // 没有选中任何项目
  }

  if (!confirm(confirmMessage)) return

  // 清除之前的成功消息
  successMessage.value = ''

  // 设置删除进度状态
  deleteProgress.value = {
    isDeleting: true,
    total: selectedFiles.value.size,
    completed: 0,
    currentItem: ''
  }

  try {
    // 转换为数组以便按顺序处理
    const itemsToDelete = Array.from(selectedFiles.value)

    for (const fileName of itemsToDelete) {
      deleteProgress.value.currentItem = fileName

      const fileType = selectedItemTypes.value.get(fileName) || 'file'

      try {
        // 构建完整路径
        const fullPath = `${currentPath.value}/${fileName}`

        // 执行删除操作
        const result = await window.api.sftpDelete({
          connectionId: props.connectionId,
          path: fullPath
        })

        if (!result.success) {
          throw new Error(
            result.error || `删除${fileType === 'file' ? '文件' : '文件夹'} ${fileName} 失败`
          )
        }

        // 更新完成数量
        deleteProgress.value.completed++
      } catch (itemError: unknown) {
        console.error(`删除 ${fileName} 失败:`, itemError)
        error.value = itemError instanceof Error ? itemError.message : `删除 ${fileName} 时发生错误`

        // 如果不是最后一个项目，提示是否继续
        if (deleteProgress.value.completed < deleteProgress.value.total - 1) {
          if (!confirm(`删除 ${fileName} 失败: ${error.value}\n\n是否继续删除其他项目？`)) {
            break
          }
        }
      }
    }

    // 清除选择
    clearSelection()

    // 刷新当前目录
    await loadCurrentDirectory()

    // 显示成功消息
    if (deleteProgress.value.completed === deleteProgress.value.total) {
      // 所有项目都成功删除
      const message =
        deleteProgress.value.total === 1
          ? `已成功删除 1 个项目`
          : `已成功删除 ${deleteProgress.value.completed} 个项目`

      showSuccessMessage(message)
    } else if (deleteProgress.value.completed > 0) {
      // 部分项目删除成功
      showSuccessMessage(
        `已删除 ${deleteProgress.value.completed}/${deleteProgress.value.total} 个项目`
      )
    }
  } catch (err: unknown) {
    console.error('删除操作失败:', err)
    error.value = err instanceof Error ? err.message : '删除文件时发生错误'
  } finally {
    // 重置删除进度状态
    deleteProgress.value.isDeleting = false
  }
}

// 排序文件列表
const sortFiles = () => {
  fileList.value.sort((a, b) => {
    // 文件夹始终排在前面
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }

    let comparison = 0
    switch (sortBy.value) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'size':
        comparison = a.size - b.size
        break
      case 'modifyTime':
        comparison = new Date(a.modifyTime).getTime() - new Date(b.modifyTime).getTime()
        break
    }

    return sortOrder.value === 'asc' ? comparison : -comparison
  })
}

// 切换排序方式
const toggleSort = (field: 'name' | 'size' | 'modifyTime') => {
  if (sortBy.value === field) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = field
    sortOrder.value = 'asc'
  }
}

// 显示右键菜单
const showMenu = (
  e: MouseEvent,
  target: 'file' | 'directory' | 'background',
  itemName?: string
) => {
  e.preventDefault()

  // 设置右键菜单目标类型和点击的项目
  contextMenuTarget.value = target
  clickedItem.value = itemName || null

  // 如果点击了特定项目且该项目未被选中
  if (itemName) {
    // 获取项目类型
    const fileItem = fileList.value.find((f) => f.name === itemName)
    if (fileItem) {
      // 根据实际的文件类型设置contextMenuTarget
      contextMenuTarget.value = fileItem.type

      if (!selectedFiles.value.has(itemName)) {
        if (!e.ctrlKey && !e.metaKey) {
          selectedFiles.value.clear()
          selectedItemTypes.value.clear()
        }
        selectedFiles.value.add(itemName)
        selectedItemTypes.value.set(itemName, fileItem.type)
      }
    }
  }

  // 获取窗口尺寸
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight

  // 初始设置菜单位置为鼠标位置
  let posX = e.clientX
  let posY = e.clientY

  // 菜单估计尺寸 - 宽和高的初始估计值，但会在渲染后重新调整
  const estimatedMenuWidth = 220 // 增加一些余量
  const estimatedMenuHeight = 230

  // 确保菜单在可视区域内的初步调整
  if (posX + estimatedMenuWidth > windowWidth) {
    // 如果右侧空间不足，则显示在鼠标左侧
    posX = posX - estimatedMenuWidth
  }

  if (posY + estimatedMenuHeight > windowHeight) {
    // 如果底部空间不足，则显示在鼠标上方
    posY = posY - estimatedMenuHeight
  }

  // 确保不超出左边界
  if (posX < 0) posX = 10

  // 确保不超出上边界
  if (posY < 0) posY = 10

  // 设置菜单位置
  menuPosition.value = { x: posX, y: posY }
  showContextMenu.value = true

  // 添加一次性的点击事件监听，点击其他地方关闭菜单
  setTimeout(() => {
    window.addEventListener('click', closeMenu, { once: true })
    // 确保点击ESC也能关闭菜单
    window.addEventListener('keydown', handleMenuKeydown, { once: true })

    // 在下一个渲染周期，根据实际菜单尺寸进行位置微调
    nextTick(() => {
      const menuElement = document.querySelector('.context-menu') as HTMLElement
      if (menuElement) {
        const menuRect = menuElement.getBoundingClientRect()

        // 获取菜单实际尺寸
        const actualMenuWidth = menuRect.width
        const actualMenuHeight = menuRect.height

        // 再次检查并调整位置
        let adjustedX = menuPosition.value.x
        let adjustedY = menuPosition.value.y

        // 右侧边界检查
        if (adjustedX + actualMenuWidth > windowWidth) {
          adjustedX = windowWidth - actualMenuWidth - 10 // 10px边距
        }

        // 左侧边界检查
        if (adjustedX < 0) {
          adjustedX = 10
        }

        // 底部边界检查
        if (adjustedY + actualMenuHeight > windowHeight) {
          adjustedY = windowHeight - actualMenuHeight - 10
        }

        // 顶部边界检查
        if (adjustedY < 0) {
          adjustedY = 10
        }

        // 如果位置有调整，应用新位置
        if (adjustedX !== menuPosition.value.x || adjustedY !== menuPosition.value.y) {
          menuPosition.value = { x: adjustedX, y: adjustedY }
        }
      }
    })
  }, 0)
}

// 处理菜单键盘事件
const handleMenuKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Escape') {
    closeMenu()
  }
}

// 关闭右键菜单
const closeMenu = () => {
  showContextMenu.value = false
  window.removeEventListener('keydown', handleMenuKeydown)
}

// 处理键盘删除事件
const handleKeyDown = (e: KeyboardEvent) => {
  // 如果按下Delete键并且选中了项目
  if (e.key === 'Delete' && selectedFiles.value.size > 0) {
    // 阻止默认行为
    e.preventDefault()
    // 触发删除操作
    deleteSelectedItems()
  }
}

// 监听路径变化
watch(currentPath, () => {
  loadCurrentDirectory()
})

// 监听文件列表变化，自动排序
watch(
  [fileList, sortBy, sortOrder],
  () => {
    sortFiles()
  },
  { deep: true }
)

// 监听传输进度变化，确保上传完成后刷新文件列表
watch(
  transferProgress,
  (newProgress, oldProgress) => {
    // 检查是否有新完成的上传
    for (let i = 0; i < newProgress.length; i++) {
      const newItem = newProgress[i]
      const oldItem = oldProgress[i]

      // 如果是上传项，且状态从transferring变为completed或verifying
      if (
        newItem &&
        oldItem &&
        newItem.type === 'upload' &&
        oldItem.status === 'transferring' &&
        (newItem.status === 'completed' || newItem.status === 'verifying')
      ) {
        console.log('检测到上传完成状态变化，刷新文件列表')
        loadCurrentDirectory()
        break
      }
    }
  },
  { deep: true }
)

// 监听连接ID变化
watch(
  () => props.connectionId,
  (newId, oldId) => {
    console.log('连接ID变化:', { oldId, newId })
    if (newId) {
      console.log('检测到新的连接ID，重置路径并加载目录')
      currentPath.value = '/'
      highlightedItem.value = null
      // 延迟加载目录，确保SFTP连接已经完全建立
      setTimeout(() => {
        loadCurrentDirectory()
      }, 2000) // 增加延迟到2秒
    } else {
      console.log('连接ID被清除，清空文件列表')
      fileList.value = []
      error.value = ''
    }
  },
  { immediate: true }
)

// 处理窗口大小变化时调整菜单位置
const handleWindowResize = () => {
  if (showContextMenu.value) {
    // 获取当前窗口尺寸
    const windowWidth = window.innerWidth
    const windowHeight = window.innerHeight

    // 获取菜单元素
    const menuElement = document.querySelector('.context-menu') as HTMLElement
    if (menuElement) {
      const menuRect = menuElement.getBoundingClientRect()

      // 检查是否超出可视区域
      let needsAdjustment = false
      let newX = menuPosition.value.x
      let newY = menuPosition.value.y

      // 右侧检查
      if (newX + menuRect.width > windowWidth) {
        newX = windowWidth - menuRect.width - 10
        needsAdjustment = true
      }

      // 左侧检查
      if (newX < 0) {
        newX = 10
        needsAdjustment = true
      }

      // 底部检查
      if (newY + menuRect.height > windowHeight) {
        newY = windowHeight - menuRect.height - 10
        needsAdjustment = true
      }

      // 顶部检查
      if (newY < 0) {
        newY = 10
        needsAdjustment = true
      }

      // 更新位置
      if (needsAdjustment) {
        menuPosition.value = { x: newX, y: newY }
      }
    }
  }

  // 确保传输浮窗在可视区域内
  if (showTransferProgress.value) {
    adjustTransferWindowPosition()
  }
}

// 调整传输浮窗位置，确保在可视区域内
const adjustTransferWindowPosition = () => {
  const container = document.querySelector('.file-list-container') as HTMLElement
  if (!container) return

  const containerRect = container.getBoundingClientRect()
  const transferWindow = document.querySelector('.transfer-progress-modal') as HTMLElement
  if (!transferWindow) return

  const transferRect = transferWindow.getBoundingClientRect()

  let newX = transferWindowPosition.value.x
  let newY = transferWindowPosition.value.y

  // 确保不超出右边界
  if (newX + transferRect.width > containerRect.width) {
    newX = containerRect.width - transferRect.width - 10
  }

  // 确保不超出左边界
  if (newX < 10) {
    newX = 10
  }

  // 确保不超出下边界
  if (newY + transferRect.height > containerRect.height) {
    newY = containerRect.height - transferRect.height - 10
  }

  // 确保不超出上边界
  if (newY < 10) {
    newY = 10
  }

  transferWindowPosition.value = { x: newX, y: newY }
}

// 开始拖动传输浮窗
const startDragTransferWindow = (e: MouseEvent) => {
  // 如果点击的是按钮等控件，不启动拖动
  if (
    (e.target as HTMLElement).closest(
      '.transfer-close-btn, .transfer-toggle-btn, .transfer-cancel-btn'
    )
  ) {
    return
  }

  isDraggingTransferWindow.value = true
  dragStartPosition.value = {
    x: e.clientX,
    y: e.clientY,
    windowX: transferWindowPosition.value.x,
    windowY: transferWindowPosition.value.y
  }

  document.addEventListener('mousemove', dragTransferWindow)
  document.addEventListener('mouseup', stopDragTransferWindow)

  // 防止选中文本
  e.preventDefault()
}

// 拖动传输浮窗
const dragTransferWindow = (e: MouseEvent) => {
  if (!isDraggingTransferWindow.value) return

  const deltaX = e.clientX - dragStartPosition.value.x
  const deltaY = e.clientY - dragStartPosition.value.y

  transferWindowPosition.value = {
    x: dragStartPosition.value.windowX + deltaX,
    y: dragStartPosition.value.windowY + deltaY
  }

  // 边界检查
  adjustTransferWindowPosition()
}

// 停止拖动传输浮窗
const stopDragTransferWindow = () => {
  isDraggingTransferWindow.value = false
  document.removeEventListener('mousemove', dragTransferWindow)
  document.removeEventListener('mouseup', stopDragTransferWindow)
}

// 切换传输浮窗折叠状态
const toggleTransferWindowCollapse = () => {
  isTransferWindowCollapsed.value = !isTransferWindowCollapsed.value
}

// 显示传输完成提示（当传输窗口未显示时）
const showTransferNotification = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
  // 如果传输窗口已显示，则不显示额外通知
  if (showTransferProgress.value) return

  // 清除之前的计时器
  if (latestTransferNotificationTimer !== null) {
    clearTimeout(latestTransferNotificationTimer)
  }

  // 设置新通知
  latestTransferNotification.value = {
    message,
    type,
    visible: true
  }

  // 5秒后自动清除
  latestTransferNotificationTimer = window.setTimeout(() => {
    latestTransferNotification.value.visible = false
    latestTransferNotificationTimer = null
  }, 5000)
}

// 文件传输处理
const initFileTransferHandlers = () => {
  // 开始传输事件
  const unsubTransferStart = window.api.onTransferStart((data) => {
    // 添加到传输列表
    transferProgress.value.push({
      id: data.id,
      filename: data.filename,
      path: data.path,
      type: data.type,
      size: data.size,
      transferred: 0,
      progress: 0,
      status: 'transferring'
    })

    // 显示传输进度浮窗
    showTransferProgress.value = true
  })

  // 传输进度更新事件
  const unsubTransferProgress = window.api.onTransferProgress((data) => {
    // 查找对应的传输项
    const transferItem = transferProgress.value.find((item) => item.id === data.id)
    if (transferItem) {
      transferItem.transferred = data.transferred
      transferItem.progress = data.progress

      // 当上传进度达到100%时立即刷新文件列表
      if (
        transferItem.type === 'upload' &&
        data.progress === 100 &&
        transferItem.status === 'transferring'
      ) {
        console.log('上传进度达到100%，立即刷新文件列表')
        loadCurrentDirectory()

        // 添加：如果进度达到100%但状态仍为transferring，设置为verifying并准备验证
        // 这是为了解决某些情况下状态没有正确更新的问题
        if (transferItem.status === 'transferring') {
          console.log(
            `上传进度达到100%，但状态仍为transferring，手动设置为verifying: ${transferItem.filename}`
          )
          transferItem.status = 'verifying'

          // 延迟一段时间后进行验证，确保文件系统已更新
          setTimeout(async () => {
            const success = await verifyTransferSuccess(transferItem)
            handleTransferVerificationResult(transferItem, success)
          }, 1500) // 增加延迟时间以确保文件系统更新
        }
      }
    }
  })

  // 传输完成事件
  const unsubTransferComplete = window.api.onTransferComplete((data) => {
    // 查找对应的传输项
    const transferItem = transferProgress.value.find((item) => item.id === data.id)
    if (transferItem) {
      console.log(
        `收到传输完成事件: ${transferItem.filename}, ID: ${data.id}, 成功: ${data.success}`
      )

      if (data.success) {
        // 设置为验证中状态
        transferItem.status = 'verifying'
        transferItem.progress = 100
        transferItem.transferred = transferItem.size // 确保进度显示为100%

        // 对于上传操作，立即刷新文件列表，不等待验证完成
        if (transferItem.type === 'upload') {
          console.log('上传完成，立即刷新文件列表')
          loadCurrentDirectory()

          // 延迟一段时间后进行验证，确保文件系统已更新
          setTimeout(async () => {
            const success = await verifyTransferSuccess(transferItem)
            handleTransferVerificationResult(transferItem, success)
          }, 1000)
        } else {
          // 下载操作立即验证
          verifyTransferSuccess(transferItem).then((success) => {
            handleTransferVerificationResult(transferItem, success)
          })
        }
      } else {
        // 传输完成但服务端标记为失败
        handleTransferFailure(transferItem, '服务器返回传输失败')
      }
    } else {
      console.error(`收到未知传输项 ID: ${data.id} 的完成事件`)
    }

    // 检查是否所有传输都已完成
    checkTransferComplete()
  })

  // 传输错误事件
  const unsubTransferError = window.api.onTransferError((data) => {
    // 查找对应的传输项
    const transferItem = transferProgress.value.find((item) => item.id === data.id)
    if (transferItem) {
      transferItem.status = 'error'
      transferItem.error = data.error
      transferItem.completedAt = Date.now() // 设置完成时间戳

      // 显示错误消息
      error.value = `${transferItem.type === 'upload' ? '上传' : '下载'}文件 ${transferItem.filename} 失败: ${data.error}`

      // 添加到最近传输历史
      addToRecentTransfers(transferItem.id, transferItem.filename, transferItem.type, 'error')

      // 刷新当前目录，以防文件状态不一致
      loadCurrentDirectory()

      // 如果传输窗口没有显示，则显示通知
      if (!showTransferProgress.value) {
        showTransferNotification(
          `${transferItem.type === 'upload' ? '上传' : '下载'}文件 ${transferItem.filename} 失败`,
          'error'
        )
      }

      // 设置自动移除计时器，错误状态保留较长时间（8秒）以便用户查看
      scheduleItemRemoval(transferItem, 8000)
    }

    // 检查是否所有传输都已完成
    checkTransferComplete()
  })

  // 传输取消事件
  const unsubTransferCancelled = window.api.onTransferCancelled((data) => {
    // 查找对应的传输项
    const transferItem = transferProgress.value.find((item) => item.id === data.id)
    if (transferItem) {
      transferItem.status = 'cancelled'
      transferItem.error = '用户取消传输'
      transferItem.completedAt = Date.now() // 设置完成时间戳

      // 添加到最近传输历史
      addToRecentTransfers(transferItem.id, transferItem.filename, transferItem.type, 'cancelled')

      // 刷新当前目录，以防文件状态不一致
      loadCurrentDirectory()

      // 设置自动移除计时器，取消状态保留较短时间（2秒）
      scheduleItemRemoval(transferItem, 2000)
    }

    // 检查是否所有传输都已完成
    checkTransferComplete()
  })

  // 返回清理函数
  return () => {
    unsubTransferStart()
    unsubTransferProgress()
    unsubTransferComplete()
    unsubTransferError()
    unsubTransferCancelled()
  }
}

// 添加到最近传输历史
const addToRecentTransfers = (id: string, filename: string, type: TransferType, status: string) => {
  // 限制历史记录数量，保留最新的10条
  if (recentTransfers.value.length >= 10) {
    recentTransfers.value.shift() // 移除最旧的记录
  }

  // 添加新记录
  recentTransfers.value.push({
    id,
    filename,
    type,
    status
  })
}

// 为传输项设置自动移除计时器
const scheduleItemRemoval = (item: TransferItem, delay = 5000) => {
  // 清除之前可能存在的计时器
  if (item.removeTimer) {
    clearTimeout(item.removeTimer)
    item.removeTimer = undefined
  }

  console.log(`安排移除传输项：${item.filename}，状态：${item.status}，延迟：${delay}ms`)

  // 使用window.setTimeout而不是setTimeout，确保在所有环境中正常工作
  const timerId = window.setTimeout(() => {
    console.log(`执行移除传输项：${item.filename}，状态：${item.status}`)

    // 先将计时器ID置空，防止重复清除
    item.removeTimer = undefined

    // 更新项目状态，标记为准备删除
    item.pendingRemoval = true

    // 使用Vue的nextTick确保DOM更新完成后再执行移除
    nextTick(() => {
      // 移除该项（使用函数式更新以确保基于最新状态）
      transferProgress.value = transferProgress.value.filter(
        (i) => i.id !== item.id || (i.id === item.id && !i.pendingRemoval)
      )
      console.log(`移除后剩余传输项数量: ${transferProgress.value.length}`)

      // 如果没有正在进行的传输，隐藏浮窗
      const hasActiveTransfers = transferProgress.value.some(
        (i) => i.status === 'pending' || i.status === 'transferring' || i.status === 'verifying'
      )

      console.log(`还有活跃传输: ${hasActiveTransfers}, 总数: ${transferProgress.value.length}`)

      // 如果无正在传输的项，且所有项目都已移除，隐藏传输窗口
      if (!hasActiveTransfers && transferProgress.value.length === 0) {
        console.log('所有传输项已完成，隐藏传输窗口')

        // 使用nextTick确保Vue状态更新完成后再隐藏窗口
        nextTick(() => {
          window.setTimeout(() => {
            showTransferProgress.value = false
          }, 300)
        })
      }
    })
  }, delay)

  // 确保保存计时器ID
  item.removeTimer = timerId
  console.log(`为传输项 ${item.id} 设置了移除计时器 ID: ${timerId}`)

  // 设置备用计时器，防止主计时器失效（多一层保障）
  window.setTimeout(() => {
    // 检查项目是否仍然存在
    const stillExists = transferProgress.value.some((i) => i.id === item.id)
    if (stillExists) {
      console.log(`备用计时器检测到传输项 ${item.id} 仍未被移除，强制移除`)
      transferProgress.value = transferProgress.value.filter((i) => i.id !== item.id)

      // 如果没有活跃传输且列表为空，隐藏窗口
      const hasActiveTransfers = transferProgress.value.some(
        (i) => i.status === 'pending' || i.status === 'transferring' || i.status === 'verifying'
      )
      if (!hasActiveTransfers && transferProgress.value.length === 0) {
        console.log('备用计时器: 所有传输项已完成，隐藏传输窗口')
        showTransferProgress.value = false
      }
    }
  }, delay + 2000) // 比主计时器多2秒
}

// 清除所有传输项的计时器
const clearAllRemovalTimers = () => {
  transferProgress.value.forEach((item) => {
    if (item.removeTimer) {
      clearTimeout(item.removeTimer)
      item.removeTimer = undefined
    }
  })
}

// 检查所有传输是否完成
const checkTransferComplete = () => {
  // 检查是否所有传输都已完成（没有处于进行中状态的传输）
  const allCompleted = !transferProgress.value.some(
    (item) =>
      item.status === 'pending' || item.status === 'transferring' || item.status === 'verifying'
  )

  // 如果全部完成，显示总结性消息
  if (allCompleted && transferProgress.value.length > 0) {
    // 计算成功、失败和取消的数量
    const completedCount = transferProgress.value.filter(
      (item) => item.status === 'completed'
    ).length
    const errorCount = transferProgress.value.filter((item) => item.status === 'error').length
    const cancelledCount = transferProgress.value.filter(
      (item) => item.status === 'cancelled'
    ).length

    // 清理所有已完成但未删除的传输项（停留过久的项）
    const now = Date.now()
    const completedItems = transferProgress.value.filter(
      (item) =>
        item.status === 'completed' || item.status === 'error' || item.status === 'cancelled'
    )

    // 对于已完成状态超过10秒的项目，强制移除
    const forceCleanupDelay = 10000 // 10秒
    completedItems.forEach((item) => {
      // 如果项目没有完成时间戳，设置一个
      if (!item.completedAt) {
        item.completedAt = now
      }

      // 如果已经完成了超过指定时间，且没有正在进行的删除，强制删除
      if (now - item.completedAt > forceCleanupDelay && !item.pendingRemoval) {
        console.log(`强制清理长时间停留的已完成传输项: ${item.filename}`)
        item.pendingRemoval = true

        // 使用nextTick确保DOM更新
        nextTick(() => {
          transferProgress.value = transferProgress.value.filter(
            (i) => i.id !== item.id || (i.id === item.id && !i.pendingRemoval)
          )
        })
      }
    })

    // 添加：检查是否有传输中状态停留时间过长的项目（可能卡住）
    const stuckTransfers = transferProgress.value.filter(
      (item) =>
        (item.status === 'transferring' || item.status === 'verifying') &&
        item.progress === 100 && // 进度100%但状态未更新
        item.completedAt === undefined // 未设置完成时间戳
    )

    // 处理可能卡住的传输项
    const stuckTransferTimeout = 20000 // 20秒无状态更新视为卡住
    stuckTransfers.forEach((item) => {
      // 如果没有上次更新时间，设置当前时间作为参考
      if (!item._lastUpdateTime) {
        item._lastUpdateTime = now
        return
      }

      // 如果已经卡住超过指定时间，尝试恢复
      if (now - item._lastUpdateTime > stuckTransferTimeout) {
        console.log(
          `检测到可能卡住的传输项: ${item.filename}, 状态: ${item.status}, 进度: ${item.progress}%`
        )

        // 对于上传项目，尝试验证并更新状态
        if (item.type === 'upload' && item.status === 'transferring' && item.progress === 100) {
          console.log(`尝试恢复卡住的上传项: ${item.filename}`)
          item.status = 'verifying'

          // 延迟验证
          setTimeout(async () => {
            const success = await verifyTransferSuccess(item)
            handleTransferVerificationResult(item, success)
          }, 1000)
        }
        // 对于验证中状态卡住的项目，强制设置为完成
        else if (item.status === 'verifying') {
          console.log(`验证状态卡住，强制设置为完成: ${item.filename}`)
          item.status = 'completed'
          item.completedAt = now
          scheduleItemRemoval(item, 2000)
        }

        // 更新上次处理时间，避免重复处理
        item._lastUpdateTime = now
      }
    })

    // 如果所有项目都已经完成并且没有剩余项目，隐藏传输窗口
    if (
      transferProgress.value.length === 0 ||
      (completedItems.length === transferProgress.value.length &&
        completedItems.every((item) => item.pendingRemoval))
    ) {
      console.log('所有传输已完成并准备删除，隐藏传输窗口')
      setTimeout(() => {
        showTransferProgress.value = false
      }, 300)
    }

    // 如果有完成的项目，显示提示消息
    if (completedCount > 0 || errorCount > 0 || cancelledCount > 0) {
      const message = `文件传输结果: ${completedCount}个成功, ${errorCount}个失败, ${cancelledCount}个取消`
      console.log(message)

      // 只有有成功项时才显示成功提示
      if (completedCount > 0) {
        showSuccessMessage(message)
      } else if (errorCount > 0) {
        // 否则如果有错误项，显示错误提示
        error.value = message
      }
    }
  }
}

// 关闭传输进度浮窗
const closeTransferProgress = () => {
  showTransferProgress.value = false
  // 清除所有自动移除计时器
  clearAllRemovalTimers()
}

// 处理背景区域上传文件
const handleBackgroundUpload = async (e: MouseEvent) => {
  e.preventDefault()
  await uploadFiles()
  closeMenu()
}

// 取消文件传输
const cancelTransfer = async (transferId: string) => {
  try {
    // 查找对应的传输项
    const transferItem = transferProgress.value.find((item) => item.id === transferId)
    if (!transferItem || transferItem.status !== 'transferring') {
      return
    }

    // 调用API取消传输
    const result = await window.api.cancelTransfer({
      transferId
    })

    if (result.success) {
      // 更新状态为已取消
      transferItem.status = 'cancelled'
      transferItem.error = '用户取消传输'
      transferItem.completedAt = Date.now() // 设置完成时间戳

      // 显示提示
      showSuccessMessage(
        `已取消${transferItem.type === 'upload' ? '上传' : '下载'}文件: ${transferItem.filename}`
      )

      // 刷新文件列表
      loadCurrentDirectory()

      // 设置自动移除计时器
      scheduleItemRemoval(transferItem, 2000)
    } else {
      // 显示错误
      error.value = `取消传输失败: ${result.error || '未知错误'}`
    }
  } catch (err: unknown) {
    console.error('取消传输失败:', err)
    error.value = `取消传输失败: ${err instanceof Error ? err.message : '未知错误'}`
  }
}

// 直接清除传输项
const clearTransferItem = (transferId: string) => {
  const transferItem = transferProgress.value.find((item) => item.id === transferId)
  if (transferItem) {
    console.log(`手动清除传输项: ${transferItem.filename}, ID: ${transferId}`)

    // 清除可能存在的定时器
    if (transferItem.removeTimer) {
      clearTimeout(transferItem.removeTimer)
      transferItem.removeTimer = undefined
      console.log(`清除了传输项 ${transferId} 的自动移除计时器`)
    }

    // 标记为准备删除
    transferItem.pendingRemoval = true

    // 使用nextTick确保DOM更新后再移除
    nextTick(() => {
      // 立即从列表中移除
      transferProgress.value = transferProgress.value.filter(
        (item) => item.id !== transferId || (item.id === transferId && !item.pendingRemoval)
      )
      console.log(`手动移除后剩余传输项数量: ${transferProgress.value.length}`)

      // 如果没有正在进行的传输和剩余项，隐藏传输窗口
      const hasActiveTransfers = transferProgress.value.some(
        (i) => i.status === 'pending' || i.status === 'transferring' || i.status === 'verifying'
      )

      console.log(
        `手动清除后，还有活跃传输: ${hasActiveTransfers}, 总数: ${transferProgress.value.length}`
      )

      if (!hasActiveTransfers && transferProgress.value.length === 0) {
        console.log('手动清除后，所有传输项已完成，隐藏传输窗口')
        nextTick(() => {
          window.setTimeout(() => {
            showTransferProgress.value = false
          }, 300)
        })
      }
    })
  } else {
    console.warn(`尝试清除不存在的传输项 ID: ${transferId}`)
  }
}

// 组件挂载时加载目录
onMounted(async () => {
  console.log('FileManager组件挂载，当前连接ID:', props.connectionId)

  // 添加键盘事件监听
  window.addEventListener('keydown', handleKeyDown)

  // 添加窗口大小变化监听
  window.addEventListener('resize', handleWindowResize)

  if (props.connectionId) {
    // 显示加载状态
    isLoading.value = true

    // 初始化传输事件处理
    const cleanupTransferHandlers = initFileTransferHandlers()

    // 获取目录内容
    if (currentPath.value) {
      loadCurrentDirectory()
        .catch((err) => {
          console.error('初始加载目录失败:', err)
          error.value = `加载目录失败: ${err.message || '未知错误'}`
        })
        .finally(() => {
          isLoading.value = false
        })
    }

    // 设置定期检查传输状态的定时器
    transferStatusCheckTimer = window.setInterval(() => {
      // 调用检查函数
      checkTransferComplete()

      // 检查是否有进度为100%但状态未更新为completed的项目
      const now = Date.now()
      const stuckItems = transferProgress.value.filter(
        (item) =>
          (item.status === 'transferring' && item.progress === 100) ||
          (item.status === 'verifying' &&
            (!item._lastVerifyTime || now - item._lastVerifyTime > 10000))
      )

      if (stuckItems.length > 0) {
        console.log(`定期检查：发现 ${stuckItems.length} 个可能卡住的传输项`)
        stuckItems.forEach((item) => {
          // 为卡在transferring状态的项目触发状态更新
          if (item.status === 'transferring' && item.progress === 100) {
            console.log(`定期检查：修复卡在transferring的项目: ${item.filename}`)
            item.status = 'verifying'

            // 延迟验证
            setTimeout(async () => {
              // 记录开始验证的时间
              item._lastVerifyTime = Date.now()
              const success = await verifyTransferSuccess(item)
              handleTransferVerificationResult(item, success)
            }, 1000)
          }
          // 处理验证时间过长的项目
          else if (
            item.status === 'verifying' &&
            (!item._lastVerifyTime || now - item._lastVerifyTime > 10000)
          ) {
            console.log(`定期检查：验证时间过长，手动完成: ${item.filename}`)
            item.status = 'completed'
            item.completedAt = now

            // 添加到最近传输历史
            addToRecentTransfers(item.id, item.filename, item.type, 'completed')

            // 设置自动移除计时器
            scheduleItemRemoval(item, 2000)
          }
        })
      }
    }, 5000) // 每5秒检查一次

    // 组件卸载时清理监听器
    onBeforeUnmount(() => {
      // 移除键盘事件监听
      window.removeEventListener('keydown', handleKeyDown)

      // 移除窗口大小变化监听
      window.removeEventListener('resize', handleWindowResize)

      cleanupTransferHandlers()

      // 清除定期检查定时器
      if (transferStatusCheckTimer !== null) {
        clearInterval(transferStatusCheckTimer)
        transferStatusCheckTimer = null
      }

      // 清除所有传输项的自动移除计时器
      clearAllRemovalTimers()
    })
  }

  // 在组件挂载时加载保存的列宽
  loadColumnWidths()
  setupResizeObserver()
  
  // 初始调整列宽
  nextTick(() => {
    adjustColumnsToFitContainer()
  })
})

// 组件卸载时移除事件监听
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('resize', handleWindowResize)

  // 清除计时器
  if (successMessageTimer !== null) {
    clearTimeout(successMessageTimer)
  }

  if (latestTransferNotificationTimer !== null) {
    clearTimeout(latestTransferNotificationTimer)
  }

  // 清除所有传输项的计时器
  clearAllRemovalTimers()
})

// 验证文件传输是否成功
const verifyTransferSuccess = async (item: TransferItem): Promise<boolean> => {
  try {
    console.log(`验证传输项: ${item.filename}, 类型: ${item.type}`)

    if (item.type === 'upload') {
      // 对于上传，验证文件是否存在于当前目录
      const result = await window.api.sftpReadDir({
        connectionId: props.connectionId,
        path: currentPath.value
      })

      if (result.success && result.files) {
        // 检查文件是否存在且大小正确
        const uploadedFile = result.files.find((f) => f.name === item.filename)
        if (uploadedFile && uploadedFile.size === item.size) {
          console.log(`上传验证成功: ${item.filename}, 大小匹配: ${uploadedFile.size}`)
          return true
        } else {
          console.error(`上传验证失败: ${item.filename}, 文件不存在或大小不匹配`)
          return false
        }
      }
    } else {
      // 对于下载，验证文件大小是否正确
      if (item.transferred === item.size) {
        console.log(`下载验证成功: ${item.filename}, 传输大小等于文件大小`)
        return true
      } else {
        console.error(
          `下载验证失败: ${item.filename}, 传输大小(${item.transferred}) != 文件大小(${item.size})`
        )
        return false
      }
    }

    return false
  } catch (err) {
    console.error(`验证传输失败: ${err}`)
    return false
  }
}

// 处理传输验证结果
const handleTransferVerificationResult = (item: TransferItem, success: boolean) => {
  if (success) {
    // 更新为完成状态
    item.status = 'completed'
    item.completedAt = Date.now()

    // 显示成功消息
    showSuccessMessage(`${item.type === 'upload' ? '上传' : '下载'}文件 ${item.filename} 成功`)

    // 添加到最近传输历史
    addToRecentTransfers(item.id, item.filename, item.type, 'completed')

    // 如果传输窗口没有显示，则显示通知
    if (!showTransferProgress.value) {
      showTransferNotification(
        `${item.type === 'upload' ? '上传' : '下载'}文件 ${item.filename} 成功`,
        'success'
      )
    }

    // 设置自动移除计时器，完成后2秒移除
    scheduleItemRemoval(item, 2000)
  } else {
    handleTransferFailure(item, '文件传输验证失败')
  }
}

// 处理传输失败
const handleTransferFailure = (item: TransferItem, errorMessage: string) => {
  // 更新为错误状态
  item.status = 'error'
  item.error = errorMessage
  item.completedAt = Date.now()

  // 显示错误消息
  error.value = `${item.type === 'upload' ? '上传' : '下载'}文件 ${item.filename} 失败: ${errorMessage}`

  // 添加到最近传输历史
  addToRecentTransfers(item.id, item.filename, item.type, 'error')

  // 如果传输窗口没有显示，则显示通知
  if (!showTransferProgress.value) {
    showTransferNotification(
      `${item.type === 'upload' ? '上传' : '下载'}文件 ${item.filename} 失败`,
      'error'
    )
  }

  // 设置自动移除计时器，错误状态保留较长时间供用户查看
  scheduleItemRemoval(item, 8000)

  // 刷新当前目录
  loadCurrentDirectory()
}

// 查看文件/文件夹信息
const viewFileInfo = async () => {
  if (!clickedItem.value) return

  try {
    const path = `${currentPath.value}/${clickedItem.value}`
    const result = await window.api.sftpGetFileInfo({
      connectionId: props.connectionId,
      path: path
    })

    if (result.success && result.fileInfo) {
      fileInfo.value = result.fileInfo
      showFileInfoDialog.value = true
    } else {
      error.value = result.error || '获取文件信息失败'
    }
  } catch (err: unknown) {
    error.value = err instanceof Error ? err.message : '获取文件信息时发生错误'
  } finally {
    closeMenu()
  }
}

// 格式化文件权限信息
const formatPermissions = (rights: FileRights | undefined) => {
  if (!rights) return '未知'
  return `${rights.user}${rights.group}${rights.other}`
}

// 格式化日期时间
const formatDateTime = (date: Date | undefined) => {
  if (!date) return '未知'
  return new Date(date).toLocaleString()
}

// 获取权限的可读性描述
const getReadablePermissions = (permStr: string) => {
  if (!permStr || permStr.length !== 3) return '未知'

  const types = ['所有者', '用户组', '其他用户']
  const result: string[] = []

  for (let i = 0; i < 3; i++) {
    const perm = parseInt(permStr[i])
    const readable: string[] = []

    if (perm & 4) readable.push('读')
    if (perm & 2) readable.push('写')
    if (perm & 1) readable.push('执行')

    result.push(`${types[i]}: ${readable.join('、') || '无权限'}`)
  }

  return result.join('；')
}

// 关闭文件信息对话框
const closeInfoDialog = () => {
  showFileInfoDialog.value = false
  fileInfo.value = null
}

// 列宽配置
interface ColumnWidths {
  checkbox: number
  name: number
  size: number
  time: number
  permissions: number
  owner: number
}

// 列宽状态
const columnWidths = ref<ColumnWidths>({
  checkbox: 40,
  name: 300,
  size: 100,
  time: 200,
  permissions: 100,
  owner: 100
})

// 列拖拽状态
const isDraggingColumn = ref(false)
const currentDraggingColumn = ref<keyof ColumnWidths | null>(null)
const startDragX = ref(0)
const startColumnWidth = ref(0)

// 处理列宽拖拽开始
const handleColumnDragStart = (e: MouseEvent, column: keyof ColumnWidths) => {
  e.preventDefault()
  e.stopPropagation() // 阻止事件冒泡，防止触发排序
  isDraggingColumn.value = true
  currentDraggingColumn.value = column
  startDragX.value = e.clientX
  startColumnWidth.value = columnWidths.value[column]
  
  // 添加全局事件监听
  document.addEventListener('mousemove', handleColumnDragMove)
  document.addEventListener('mouseup', handleColumnDragEnd)
  
  // 添加拖拽样式
  document.body.classList.add('column-resizing')
}

// 处理列宽拖拽移动
const handleColumnDragMove = (e: MouseEvent) => {
  if (!isDraggingColumn.value || !currentDraggingColumn.value) return
  
  // 阻止默认行为和事件冒泡
  e.preventDefault()
  e.stopPropagation()
  
  const deltaX = e.clientX - startDragX.value
  const newWidth = Math.max(50, startColumnWidth.value + deltaX)
  
  // 更新列宽
  columnWidths.value[currentDraggingColumn.value] = newWidth
  
  // 添加拖动指示器
  const indicator = document.getElementById('column-resize-indicator') || createResizeIndicator()
  indicator.style.left = `${e.clientX}px`
}

// 创建拖动指示器
const createResizeIndicator = () => {
  const indicator = document.createElement('div')
  indicator.id = 'column-resize-indicator'
  indicator.className = 'column-resize-indicator'
  // 如果是暗色主题，添加对应的类
  if (props.isDarkTheme) {
    indicator.classList.add('dark-theme')
  }
  document.body.appendChild(indicator)
  return indicator
}

// 处理列宽拖拽结束
const handleColumnDragEnd = () => {
  isDraggingColumn.value = false
  currentDraggingColumn.value = null
  
  // 移除全局事件监听
  document.removeEventListener('mousemove', handleColumnDragMove)
  document.removeEventListener('mouseup', handleColumnDragEnd)
  
  // 移除拖拽样式
  document.body.classList.remove('column-resizing')
  
  // 移除拖动指示器
  const indicator = document.getElementById('column-resize-indicator')
  if (indicator && indicator.parentNode) {
    indicator.parentNode.removeChild(indicator)
  }
  
  // 保存列宽到本地存储
  saveColumnWidths()
}

// 保存列宽到本地存储
const saveColumnWidths = () => {
  try {
    localStorage.setItem('file-manager-column-widths', JSON.stringify(columnWidths.value))
  } catch (error) {
    console.error('保存列宽失败:', error)
  }
}

// 从本地存储加载列宽
const loadColumnWidths = () => {
  try {
    const savedWidths = localStorage.getItem('file-manager-column-widths')
    if (savedWidths) {
      const parsedWidths = JSON.parse(savedWidths)
      // 确保所有必要的列都存在
      const requiredColumns: (keyof ColumnWidths)[] = ['checkbox', 'name', 'size', 'time', 'permissions', 'owner']
      const isValid = requiredColumns.every(col => typeof parsedWidths[col] === 'number')
      
      if (isValid) {
        columnWidths.value = parsedWidths
      }
    }
  } catch (error) {
    console.error('加载列宽失败:', error)
  }
}

// 文件列表容器的引用
const fileListContainerRef = ref<HTMLElement | null>(null)

// 调整列宽以适应容器宽度
const adjustColumnsToFitContainer = () => {
  if (!fileListContainerRef.value) return
  
  const containerWidth = fileListContainerRef.value.clientWidth
  
  // 如果容器宽度大于0，进行列宽调整
  if (containerWidth > 0) {
    // 定义各列的最小宽度
    const minWidths = {
      checkbox: 20,    // 保持固定
      name: 100,       // 文件名列最低需要保证这个宽度
      size: 80,        // 大小列最小宽度
      time: 120,       // 时间列最小宽度
      permissions: 70, // 权限列最小宽度
      owner: 70        // 所有者列最小宽度
    };
    
    // 计算所有非name列所需的总宽度
    const otherColumnsMinWidth = minWidths.checkbox + minWidths.size + 
                                 minWidths.time + minWidths.permissions + minWidths.owner;
    
    // 给name列分配剩余的所有空间
    let nameWidth = Math.max(minWidths.name, containerWidth - otherColumnsMinWidth);
    
    // 如果空间不足，需要按优先级缩减其他列宽度
    const newWidths = { ...columnWidths.value };
    
    if (containerWidth < otherColumnsMinWidth + minWidths.name) {
      // 情况非常紧张，空间不够显示所有列的最小宽度
      // 保证文件名列有最小宽度，其他列按比例减少
      nameWidth = minWidths.name;
      
      // 剩余空间
      const remainingWidth = containerWidth - nameWidth - minWidths.checkbox;
      
      // 计算其他列（除checkbox和name列）的总最小宽度
      const otherColumnsMinTotal = minWidths.size + minWidths.time + 
                                   minWidths.permissions + minWidths.owner;
      
      // 其他列按比例分配剩余空间
      newWidths.size = Math.max(30, Math.floor(remainingWidth * (minWidths.size / otherColumnsMinTotal)));
      newWidths.time = Math.max(30, Math.floor(remainingWidth * (minWidths.time / otherColumnsMinTotal)));
      newWidths.permissions = Math.max(30, Math.floor(remainingWidth * (minWidths.permissions / otherColumnsMinTotal)));
      newWidths.owner = Math.max(30, Math.floor(remainingWidth * (minWidths.owner / otherColumnsMinTotal)));
    } else {
      // 空间足够，保持其他列的最小宽度
      newWidths.size = minWidths.size;
      newWidths.time = minWidths.time;
      newWidths.permissions = minWidths.permissions;
      newWidths.owner = minWidths.owner;
    }
    
    // 设置checkbox固定宽度
    newWidths.checkbox = minWidths.checkbox;
    
    // 设置name列宽度
    newWidths.name = nameWidth;
    
    // 微调，确保总宽度正好等于容器宽度
    let totalWidth = Object.values(newWidths).reduce((sum, w) => sum + w, 0);
    const diff = containerWidth - totalWidth;
    
    // 将差值添加到name列
    newWidths.name += diff;
    
    // 更新列宽
    columnWidths.value = newWidths;
  }
}

// 监听窗口大小变化
const setupResizeObserver = () => {
  // 确保在客户端环境下执行
  if (typeof window === 'undefined' || !fileListContainerRef.value) return
  
  // 使用ResizeObserver监听容器大小变化
  const resizeObserver = new ResizeObserver(() => {
    adjustColumnsToFitContainer()
  })
  
  resizeObserver.observe(fileListContainerRef.value)
  
  // 组件卸载时清理
  onUnmounted(() => {
    resizeObserver.disconnect()
  })
}

// 监听左侧边栏宽度变化
watch(() => props.sidebarWidth, () => {
  // 当侧边栏宽度变化时，触发列宽调整
  nextTick(() => {
    adjustColumnsToFitContainer()
  })
}, { immediate: true })

// 处理文件拖动开始
const handleFileDragStart = async (e: DragEvent, fileName: string, fileType: 'file' | 'directory') => {
  // 只允许拖动文件，不允许拖动文件夹
  if (fileType !== 'file') {
    e.preventDefault()
    return
  }
  
  // 阻止默认行为，我们将使用自定义拖动
  e.preventDefault()
  
  try {
    // 构建完整的文件路径
    const filePath = `${currentPath.value}/${fileName}`
    
    // 首先需要下载文件到本地临时目录
    const tempFilePath = await window.electron.ipcRenderer.invoke('prepare-file-for-drag', {
      connectionId: props.connectionId,
      remotePath: filePath,
      fileName
    })
    
    if (!tempFilePath) {
      console.error('准备拖动文件失败')
      return
    }
    
    // 设置拖动图标 - 使用文件图标而不是下载图标
    const dragIcon = document.createElement('img')
    // 根据主题选择合适的文件图标
    dragIcon.src = props.isDarkTheme ? 
      new URL('../assets/file-night.svg', import.meta.url).href : 
      new URL('../assets/file-day.svg', import.meta.url).href
    dragIcon.style.width = '32px'
    dragIcon.style.height = '32px'
    document.body.appendChild(dragIcon)
    e.dataTransfer?.setDragImage(dragIcon, 16, 16)
    
    // 使用setTimeout移除图标元素
    setTimeout(() => {
      if (document.body.contains(dragIcon)) {
        document.body.removeChild(dragIcon)
      }
    }, 0)
    
    // 调用Electron的startDrag API
    window.electron.ipcRenderer.invoke('start-drag', {
      filePath: tempFilePath,
      fileName,
      isDarkTheme: props.isDarkTheme // 传递主题信息
    })
    
    console.log(`开始拖动文件: ${fileName}`)
  } catch (err) {
    console.error('处理文件拖动失败:', err)
    error.value = err instanceof Error ? err.message : '处理文件拖动失败'
  }
}

// 处理文件项目的拖拽事件
const handleFileDragOver = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 设置拖拽状态
  isDraggingOver.value = true
  
  // 记录拖拽目标 - 当拖动到文件上时，目标是当前文件夹
  dragTargetItem.value = null
  dragTargetType.value = 'background'
  
  // 设置拖拽效果
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
}

// 处理文件的拖拽离开
const handleFileDragLeave = (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 检查是否真的离开了元素
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const x = e.clientX
  const y = e.clientY
  
  // 如果鼠标仍在元素内，不处理离开事件
  if (
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  ) {
    return
  }
  
  // 不重置isDraggingOver，因为文件可能仍在文件管理器内
}

// 处理文件的拖放 - 拖放到文件上时，上传到当前文件夹
const handleFileDrop = async (e: DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  
  // 重置拖拽状态
  isDraggingOver.value = false
  
  // 检查是否有文件被拖放
  if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) {
    console.log('没有文件被拖放')
    return
  }
  
  try {
    // 拖放到文件上时，上传到当前文件夹
    const targetPath = currentPath.value
    
    console.log(`准备上传文件到当前文件夹: ${targetPath}`)
    
    // 获取拖放的文件列表
    const files = Array.from(e.dataTransfer.files)
    
    // 显示上传进度窗口
    showTransferProgress.value = true
    
    if (files.length > 1) {
      // 批量处理文件上传
      const filePathPromises = files.map(async (file) => {
        // 获取文件路径，如果file.path不存在，则需要读取文件内容并保存到临时文件
        let filePath = (file as any).path
        
        if (!filePath) {
          console.log(`文件 ${file.name} 没有路径信息，将使用FileReader读取内容`)
          
          // 使用FileReader读取文件内容
          const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as ArrayBuffer)
            reader.onerror = reject
            reader.readAsArrayBuffer(file)
          })
          
          // 将文件内容发送到主进程保存为临时文件
          const result = await window.electron.ipcRenderer.invoke('save-file-content', {
            name: file.name,
            content: fileContent
          })
          
          if (!result) {
            throw new Error(`无法保存文件内容: ${file.name}`)
          }
          
          return result.path
        }
        
        return filePath
      })
      
      try {
        // 等待所有文件路径处理完成
        const filePaths = await Promise.all(filePathPromises)
        
        // 批量上传所有文件
        const uploadResult = await window.api.sftpUploadFiles({
          connectionId: props.connectionId,
          localPaths: filePaths,
          remotePath: targetPath
        })
        
        if (!uploadResult.success && uploadResult.failedFiles && uploadResult.failedFiles.length > 0) {
          const failedCount = uploadResult.failedFiles.length
          error.value = `${failedCount} 个文件上传失败`
        }
        
        // 上传完成后刷新文件列表
        await loadCurrentDirectory()
        
        // 清理临时文件
        const tempFilePaths = filePaths.filter(path => !(files.some(file => (file as any).path === path)))
        for (const tempPath of tempFilePaths) {
          try {
            await window.electron.ipcRenderer.invoke('delete-temp-file', tempPath)
            console.log(`临时文件已删除: ${tempPath}`)
          } catch (deleteError) {
            console.error(`删除临时文件失败: ${tempPath}`, deleteError)
          }
        }
      } catch (err) {
        console.error('批量上传文件时发生错误:', err)
        error.value = err instanceof Error ? err.message : '批量上传文件时发生错误'
      }
    } else {
      // 单文件上传，使用原有逻辑
      for (const file of files) {
        try {
          // 检查文件对象是否有效
          if (!file) {
            console.error('无效的文件对象')
            continue
          }
          
          // 获取文件名
          const fileName = file.name
          
          // 获取文件路径，如果file.path不存在，则需要读取文件内容并保存到临时文件
          let filePath = (file as any).path
          let tempFilePath = null
          
          if (!filePath) {
            console.log(`文件 ${fileName} 没有路径信息，将使用FileReader读取内容`)
            
            // 使用FileReader读取文件内容
            const fileContent = await new Promise<ArrayBuffer>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => resolve(reader.result as ArrayBuffer)
              reader.onerror = reject
              reader.readAsArrayBuffer(file)
            })
            
            // 将文件内容发送到主进程保存为临时文件
            const result = await window.electron.ipcRenderer.invoke('save-file-content', {
              name: fileName,
              content: fileContent
            })
            
            if (!result) {
              throw new Error(`无法保存文件内容: ${fileName}`)
            }
            
            tempFilePath = result.path
            filePath = tempFilePath
          }
          
          console.log(`准备上传文件: ${fileName} 从 ${filePath} 到 ${targetPath}`)
          
          // 上传文件
          const result = await window.api.sftpUploadFile({
            connectionId: props.connectionId,
            localPath: filePath,
            remotePath: targetPath // 直接使用当前目录路径，不需要再拼接文件名
          })
          
          if (!result.success) {
            throw new Error(result.error || `上传文件 ${fileName} 失败`)
          }
          
          // 上传成功后刷新文件列表
          await loadCurrentDirectory()
          
          // 清理临时文件
          if (tempFilePath) {
            try {
              await window.electron.ipcRenderer.invoke('delete-temp-file', tempFilePath)
              console.log(`临时文件已删除: ${tempFilePath}`)
            } catch (deleteError) {
              console.error(`删除临时文件失败: ${tempFilePath}`, deleteError)
            }
          }
        } catch (fileError) {
          console.error(`上传文件 ${file.name} 时发生错误:`, fileError)
          error.value = fileError instanceof Error ? fileError.message : `上传文件 ${file.name} 时发生错误`
        }
      }
    }
    
    // 上传完成后清空临时文件夹
    await clearTempDirectory()
    
  } catch (err) {
    console.error('处理拖放文件时发生错误:', err)
    error.value = err instanceof Error ? err.message : '处理拖放文件时发生错误'
  }
}
</script>

<template>
  <div class="file-manager" :class="{ 'dark-theme': isDarkTheme }">
    <!-- 路径导航栏 -->
    <div class="path-navigation">
      <div class="path-breadcrumb">
        <button :disabled="currentPath === '/'" @click="goToParentDirectory">
          <span class="nav-icon">↑</span>
        </button>
      </div>
      <form class="path-form" @submit="navigateToPath">
        <input
          ref="pathInputRef"
          type="text"
          class="path-input"
          :value="currentPath"
          placeholder="输入路径后按Enter跳转"
        />
      </form>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="error-message">
      {{ error }}
      <button class="close-error" @click="error = ''">×</button>
    </div>

    <!-- 成功提示 -->
    <div v-if="successMessage" class="success-message">
      {{ successMessage }}
      <button class="close-success" @click="successMessage = ''">×</button>
    </div>

    <!-- 传输完成提示（当传输窗口未显示时） -->
    <div
      v-if="latestTransferNotification.visible"
      class="transfer-notification"
      :class="{
        success: latestTransferNotification.type === 'success',
        error: latestTransferNotification.type === 'error',
        'dark-theme': isDarkTheme
      }"
    >
      {{ latestTransferNotification.message }}
      <button class="close-notification" @click="latestTransferNotification.visible = false">
        ×
      </button>
    </div>

    <!-- 文件列表 -->
    <div 
      class="file-list-container" 
      ref="fileListContainerRef"
      @contextmenu="showMenu($event, 'background')"
      @dragover="handleDragOver($event)"
      @dragleave="handleDragLeave($event)"
      @drop="handleDrop($event)"
      :class="{ 'drag-over': isDraggingOver && !dragTargetItem }"
    >
      <!-- 表头 -->
      <div class="file-list-header">
        <div class="file-list-row" :style="{ gridTemplateColumns: `${columnWidths.checkbox}px ${columnWidths.name}px ${columnWidths.size}px ${columnWidths.time}px ${columnWidths.permissions}px ${columnWidths.owner}px` }">
          <div class="checkbox-cell" :style="{ width: `${columnWidths.checkbox}px` }">
            <input
              type="checkbox"
              :checked="selectedFiles.size === fileList.length && fileList.length > 0"
              :indeterminate="selectedFiles.size > 0 && selectedFiles.size < fileList.length"
              @change="
                (e) => {
                  const target = e.target as HTMLInputElement
                  if (target.checked) {
                    fileList.forEach((f) => selectedFiles.add(f.name))
                  } else {
                    clearSelection()
                  }
                }
              "
            />
          </div>
          <div class="name-cell sortable" @click="toggleSort('name')" :style="{ width: `${columnWidths.name}px` }">
            文件名
            <span v-if="sortBy === 'name'" class="sort-indicator">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
            <div class="column-resize-handle" @mousedown="(e) => handleColumnDragStart(e, 'name')"></div>
          </div>
          <div class="size-cell sortable" @click="toggleSort('size')" :style="{ width: `${columnWidths.size}px` }">
            大小
            <span v-if="sortBy === 'size'" class="sort-indicator">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
            <div class="column-resize-handle" @mousedown="(e) => handleColumnDragStart(e, 'size')"></div>
          </div>
          <div class="time-cell sortable" @click="toggleSort('modifyTime')" :style="{ width: `${columnWidths.time}px` }">
            修改时间
            <span v-if="sortBy === 'modifyTime'" class="sort-indicator">
              {{ sortOrder === 'asc' ? '↑' : '↓' }}
            </span>
            <div class="column-resize-handle" @mousedown="(e) => handleColumnDragStart(e, 'time')"></div>
          </div>
          <div class="permissions-cell" :style="{ width: `${columnWidths.permissions}px` }">
            权限
          </div>
        </div>
      </div>

      <!-- 加载中提示 -->
      <div v-if="isLoading" class="loading">加载中...</div>

      <!-- 文件列表内容 -->
      <div v-else class="file-list">
        <div
          v-for="file in fileList"
          :key="file.name"
          class="file-list-row"
          :style="{ gridTemplateColumns: `${columnWidths.checkbox}px ${columnWidths.name}px ${columnWidths.size}px ${columnWidths.time}px ${columnWidths.permissions}px ${columnWidths.owner}px` }"
          :class="{
            selected: selectedFiles.has(file.name),
            'is-directory': file.type === 'directory',
            'is-file': file.type === 'file',
            highlighted: highlightedItem === file.name,
            'drag-target': dragTargetItem === file.name && isDraggingOver
          }"
          :data-name="file.name"
          @click="toggleFileSelection(file.name, file.type, $event)"
          @dblclick="file.type === 'directory' && enterDirectory(file.name)"
          @contextmenu.stop="showMenu($event, file.type, file.name)"
          @dragover.stop="file.type === 'directory' ? handleFolderDragOver($event, file.name) : handleFileDragOver($event)"
          @dragleave.stop="file.type === 'directory' ? handleFolderDragLeave($event) : handleFileDragLeave($event)"
          @drop.stop="file.type === 'directory' ? handleFolderDrop($event, file.name) : handleFileDrop($event)"
          draggable="true"
          @dragstart="(e) => handleFileDragStart(e, file.name, file.type)"
        >
          <div class="checkbox-cell" :style="{ width: `${columnWidths.checkbox}px` }">
            <input
              type="checkbox"
              :checked="selectedFiles.has(file.name)"
              @click.stop
              @change="toggleFileSelection(file.name, file.type)"
            />
          </div>
          <div class="name-cell" :style="{ width: `${columnWidths.name}px` }">
            <span class="file-icon">
              {{ file.type === 'directory' ? '📁' : '📄' }}
            </span>
            <span class="file-name-text" :title="file.name">{{ file.name }}</span>
          </div>
          <div class="size-cell" :style="{ width: `${columnWidths.size}px` }">
            {{ file.type === 'directory' ? '-' : formatFileSize(file.size) }}
          </div>
          <div class="time-cell" :style="{ width: `${columnWidths.time}px` }">
            {{ formatModifyTime(file.modifyTime) }}
          </div>
          <div class="permissions-cell" :style="{ width: `${columnWidths.permissions}px` }">
            {{ file.permissions }}
          </div>
        </div>
      </div>

      <!-- 空状态提示 -->
      <div v-if="!isLoading && fileList.length === 0" class="empty-state">当前目录为空</div>

      <!-- 删除进度条 -->
      <div v-if="deleteProgress.isDeleting" class="delete-progress">
        <div class="progress-info">
          正在删除: {{ deleteProgress.currentItem }}
          <span class="progress-counter"
            >{{ deleteProgress.completed }}/{{ deleteProgress.total }}</span
          >
        </div>
        <div class="progress-bar-container">
          <div
            class="progress-bar"
            :style="{ width: `${(deleteProgress.completed / deleteProgress.total) * 100}%` }"
          ></div>
        </div>
      </div>

      <!-- 右键菜单 -->
      <div
        v-if="showContextMenu"
        class="context-menu"
        :class="{ 'dark-menu': props.isDarkTheme }"
        :style="{ top: `${menuPosition.y}px`, left: `${menuPosition.x}px` }"
      >
        <!-- 文件右键菜单 -->
        <template v-if="contextMenuTarget === 'file'">
          <div class="menu-item" @click="viewFileInfo">
            <img :src="props.isDarkTheme ? InfoNightIcon : InfoDayIcon" class="info-icon" />
            查看文件信息
          </div>
          <div class="menu-item" @click="loadCurrentDirectory">
            <img
              :src="props.isDarkTheme ? RefreshNightIcon : RefreshDayIcon"
              class="refresh-icon"
            />
            刷新
          </div>
          <div class="menu-item" @click="downloadSelectedFiles">
            <img
              :src="props.isDarkTheme ? DownloadNightIcon : DownloadDayIcon"
              class="download-icon"
            />
            {{ selectedFiles.size > 1 ? `下载 ${selectedFiles.size} 个文件` : '下载文件' }}
          </div>
          <div class="menu-item delete-menu-item" @click="deleteSelectedItems">
            <img :src="props.isDarkTheme ? DeleteNightIcon : DeleteDayIcon" class="delete-icon" />
            {{ selectedFiles.size > 1 ? `删除 ${selectedFiles.size} 个文件` : '删除文件' }}
          </div>
        </template>

        <!-- 文件夹右键菜单 -->
        <template v-else-if="contextMenuTarget === 'directory'">
          <div class="menu-item" @click="clickedItem && enterDirectory(clickedItem)">
            <img
              :src="props.isDarkTheme ? OpenFolderNightIcon : OpenFolderDayIcon"
              class="openfolder-icon"
            />
            打开文件夹
          </div>
          <div class="menu-item" @click="handleUploadToFolder">
            <img :src="props.isDarkTheme ? UploadNightIcon : UploadDayIcon" class="upload-icon" />
            上传到该文件夹
          </div>
          <div class="menu-item" @click="viewFileInfo">
            <img :src="props.isDarkTheme ? InfoNightIcon : InfoDayIcon" class="info-icon" />
            查看文件夹信息
          </div>
          <div class="menu-item" @click="loadCurrentDirectory">
            <img
              :src="props.isDarkTheme ? RefreshNightIcon : RefreshDayIcon"
              class="refresh-icon"
            />
            刷新
          </div>
          <div class="menu-item delete-menu-item" @click="deleteSelectedItems">
            <img :src="props.isDarkTheme ? DeleteNightIcon : DeleteDayIcon" class="delete-icon" />
            {{ selectedFiles.size > 1 ? `删除 ${selectedFiles.size} 个文件夹` : '删除文件夹' }}
          </div>
        </template>

        <!-- 背景右键菜单 -->
        <template v-else>
          <div class="menu-item" @click="handleBackgroundUpload">
            <img :src="props.isDarkTheme ? UploadNightIcon : UploadDayIcon" class="upload-icon" />
            上传文件
          </div>
          <div class="menu-item" @click="createNewDirectory">
            <img :src="props.isDarkTheme ? PlusNightIcon : PlusDayIcon" class="plus-icon" />
            新建文件夹
          </div>
          <div
            class="menu-item"
            :class="{ disabled: currentPath === '/' }"
            @click="goToParentDirectory"
          >
            <img :src="props.isDarkTheme ? BackNightIcon : BackDayIcon" class="back-icon" />
            返回上级
          </div>
          <div class="menu-item" @click="loadCurrentDirectory">
            <img
              :src="props.isDarkTheme ? RefreshNightIcon : RefreshDayIcon"
              class="refresh-icon"
            />
            刷新
          </div>
          <template v-if="selectedFiles.size > 0">
            <div class="menu-item delete-menu-item" @click="deleteSelectedItems">
              <img :src="props.isDarkTheme ? DeleteNightIcon : DeleteDayIcon" class="delete-icon" />
              {{ `删除选中的 ${selectedFiles.size} 个项目` }}
            </div>
          </template>
        </template>
      </div>
    </div>

    <!-- 传输进度窗口 -->
    <div
      v-if="showTransferProgress && transferProgress.length > 0"
      class="transfer-progress-modal"
      :class="{
        'dark-theme': props.isDarkTheme,
        collapsed: isTransferWindowCollapsed
      }"
      :style="{
        left: `${transferWindowPosition.x}px`,
        top: `${transferWindowPosition.y}px`
      }"
    >
      <div class="transfer-header" @mousedown="startDragTransferWindow">
        <span class="transfer-title">文件传输</span>
        <div class="transfer-header-right">
          <button
            class="transfer-toggle-btn"
            :title="isTransferWindowCollapsed ? '展开' : '折叠'"
            @click="toggleTransferWindowCollapse"
          >
            {{ isTransferWindowCollapsed ? '＋' : '－' }}
          </button>
          <span v-if="!isTransferWindowCollapsed" class="transfer-count"
            >{{ transferProgress.length }}个任务</span
          >
          <button class="transfer-close-btn" @click="closeTransferProgress">×</button>
        </div>
      </div>

      <div v-if="!isTransferWindowCollapsed" class="transfer-items">
        <div
          v-for="item in transferProgress"
          :key="item.id"
          class="transfer-item"
          :class="{
            completed: item.status === 'completed',
            error: item.status === 'error',
            cancelled: item.status === 'cancelled'
          }"
        >
          <div class="transfer-item-header">
            <span class="transfer-filename" :title="item.filename">{{ item.filename }}</span>
            <div class="transfer-actions">
              <span class="transfer-type">{{ item.type === 'upload' ? '上传' : '下载' }}</span>
              <button
                v-if="item.status === 'transferring'"
                class="transfer-cancel-btn"
                title="取消传输"
                @click="cancelTransfer(item.id)"
              >
                ✕
              </button>
              <span
                v-else-if="item.status === 'completed'"
                class="transfer-status-indicator completed"
                title="传输完成"
              >
                ✓
              </span>
              <span
                v-else-if="item.status === 'verifying'"
                class="transfer-status-indicator verifying"
                title="正在验证"
              >
                ⟳
              </span>
              <span
                v-else-if="item.status === 'error'"
                class="transfer-status-indicator error"
                title="传输失败"
              >
                !
              </span>
              <span
                v-else-if="item.status === 'cancelled'"
                class="transfer-status-indicator cancelled"
                title="已取消"
              >
                -
              </span>
              <!-- 添加清除按钮，仅对于非传输中和非验证中状态显示 -->
              <button
                v-if="item.status !== 'transferring' && item.status !== 'verifying'"
                class="transfer-clear-btn"
                title="清除此项"
                @click="clearTransferItem(item.id)"
              >
                X
              </button>
            </div>
          </div>

          <div class="transfer-info">
            <span class="transfer-size">
              {{ formatFileSize(item.transferred) }} / {{ formatFileSize(item.size) }}
            </span>
            <span
              class="transfer-progress-text"
              :class="{
                completed: item.status === 'completed',
                verifying: item.status === 'verifying'
              }"
            >
              {{
                item.status === 'completed'
                  ? '已完成'
                  : item.status === 'verifying'
                    ? '验证中'
                    : item.status === 'error'
                      ? '失败'
                      : item.status === 'cancelled'
                        ? '已取消'
                        : `${item.progress}%`
              }}
            </span>
          </div>

          <div class="progress-bar-container">
            <div
              class="progress-bar"
              :style="{ width: `${item.progress}%` }"
              :class="{
                completed: item.status === 'completed',
                verifying: item.status === 'verifying',
                error: item.status === 'error',
                cancelled: item.status === 'cancelled',
                'progress-animation': item.progress === 100 && item.status === 'completed',
                'verifying-animation': item.status === 'verifying'
              }"
            ></div>
          </div>

          <div v-if="item.status === 'error'" class="transfer-error">
            {{ item.error }}
          </div>

          <div v-if="item.status === 'cancelled'" class="transfer-cancelled">已取消传输</div>
        </div>
      </div>
    </div>

    <!-- 使用teleport将文件信息对话框移动到body -->
    <teleport to="body">
      <!-- 文件信息对话框 -->
      <div v-if="showFileInfoDialog" class="file-info-dialog-overlay" @click="closeInfoDialog">
        <div class="file-info-dialog" :class="{ 'dark-dialog': props.isDarkTheme }" @click.stop>
          <div class="dialog-header">
            <h3>{{ fileInfo?.type === 'directory' ? '文件夹信息' : '文件信息' }}</h3>
            <button class="close-button" @click="closeInfoDialog">×</button>
          </div>
          <div v-if="fileInfo" class="dialog-content">
            <div class="info-row">
              <span class="info-label">名称:</span>
              <span class="info-value">{{ fileInfo.name }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">路径:</span>
              <span class="info-value">{{ fileInfo.path }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">类型:</span>
              <span class="info-value">{{
                fileInfo.type === 'directory' ? '文件夹' : '文件'
              }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">大小:</span>
              <span class="info-value">{{ formatFileSize(fileInfo.size) }}</span>
            </div>
            <div v-if="fileInfo.type === 'directory'" class="info-row">
              <span class="info-label">包含项目:</span>
              <span class="info-value">{{ fileInfo.items || 0 }} 个</span>
            </div>
            <div class="info-row">
              <span class="info-label">修改时间:</span>
              <span class="info-value">{{ formatDateTime(fileInfo.modifyTime) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">访问时间:</span>
              <span class="info-value">{{ formatDateTime(fileInfo.accessTime) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">权限:</span>
              <span class="info-value">{{ formatPermissions(fileInfo.rights) }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">权限详情:</span>
              <span class="info-value">{{
                getReadablePermissions(formatPermissions(fileInfo.rights))
              }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">所有者:</span>
              <span class="info-value">{{ fileInfo.owner }}</span>
            </div>
            <div class="info-row">
              <span class="info-label">用户组:</span>
              <span class="info-value">{{ fileInfo.group }}</span>
            </div>
            <div v-if="fileInfo.isSymbolicLink" class="info-row">
              <span class="info-label">符号链接:</span>
              <span class="info-value">是</span>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="close-button-text" @click="closeInfoDialog">关闭</button>
          </div>
        </div>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.file-manager {
  height: 100%;
  display: flex;
  flex-direction: column;
  background-color: #ffffff;
  color: #333333;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.4) transparent;
  overflow-y: auto;
  max-height: 100%;
  overflow-x: hidden;
}

.dark-theme {
  background-color: #1a1a1a;
  color: #ffffff;
}

/* 路径导航栏 */
.path-navigation {
  padding: 8px 10px;
  display: flex;
  gap: 8px;
  border-bottom: 1px solid #e0e0e0;
  align-items: center;
}

.dark-theme .path-navigation {
  border-bottom-color: #444444;
}

.path-breadcrumb {
  display: flex;
  align-items: center;
}

.path-breadcrumb button {
  background: none;
  border: none;
  padding: 5px 8px;
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
  color: #333;
}

.dark-theme .path-breadcrumb button {
  color: #ddd;
}

.path-breadcrumb button:hover:not(:disabled) {
  background-color: rgba(0, 0, 0, 0.1);
}

.dark-theme .path-breadcrumb button:hover:not(:disabled) {
  background-color: rgba(255, 255, 255, 0.1);
}

.path-breadcrumb button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.nav-icon {
  font-weight: bold;
}

.dark-menu .folder-icon,
.dark-menu .upload-icon,
.dark-menu .home-icon,
.dark-menu .refresh-icon,
.dark-menu .delete-icon,
.dark-menu .download-icon,
.dark-menu .plus-icon,
.dark-menu .back-icon,
.dark-menu .edit-icon,
.dark-menu .openfolder-icon,
.dark-menu .info-icon {
  opacity: 1;
}

.folder-icon,
.upload-icon,
.home-icon,
.refresh-icon,
.delete-icon,
.download-icon,
.plus-icon,
.back-icon,
.edit-icon,
.openfolder-icon,
.info-icon {
  width: 20px;
  height: 20px;
  margin-right: 8px;
  opacity: 0.8;
  transition: opacity 0.2s;
}

.dark-theme .folder-icon,
.dark-theme .upload-icon,
.dark-theme .home-icon,
.dark-theme .refresh-icon,
.dark-theme .delete-icon,
.dark-theme .download-icon,
.dark-theme .plus-icon,
.dark-theme .back-icon,
.dark-theme .edit-icon,
.dark-theme .openfolder-icon {
  opacity: 1;
}

.menu-item:hover .folder-icon,
.menu-item:hover .upload-icon,
.menu-item:hover .home-icon,
.menu-item:hover .refresh-icon,
.menu-item:hover .delete-icon,
.menu-item:hover .download-icon,
.menu-item:hover .plus-icon,
.menu-item:hover .back-icon,
.menu-item:hover .edit-icon,
.menu-item:hover .openfolder-icon {
  opacity: 1;
}

.path-form {
  flex: 1;
}

.path-input {
  width: 100%;
  padding: 6px 10px;
  font-family: monospace;
  border-radius: 4px;
  border: 1px solid #d0d0d0;
  background-color: #ffffff;
  color: #333333;
}

.dark-theme .path-input {
  background-color: #2a2a2a;
  border-color: #555555;
  color: #ffffff;
}

.path-input:focus {
  outline: none;
  border-color: #4d90fe;
  box-shadow: 0 0 0 2px rgba(77, 144, 254, 0.2);
}

.dark-theme .path-input:focus {
  border-color: #1a73e8;
  box-shadow: 0 0 0 2px rgba(26, 115, 232, 0.2);
}

.error-message {
  margin: 10px;
  padding: 10px;
  background-color: #ff4444;
  color: #ffffff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.close-error {
  background: none;
  border: none;
  color: #ffffff;
  font-size: 20px;
  cursor: pointer;
  padding: 0 5px;
}

.success-message {
  margin: 10px;
  padding: 10px;
  background-color: #4caf50;
  color: #ffffff;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.close-success {
  background: none;
  border: none;
  color: #ffffff;
  font-size: 20px;
  cursor: pointer;
  padding: 0 5px;
}

/* 传输完成提示样式 */
.transfer-notification {
  position: fixed;
  bottom: 20px;
  right: 20px;
  padding: 12px 16px;
  border-radius: 4px;
  background-color: #2196f3;
  color: #ffffff;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  z-index: 9000;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: 250px;
  max-width: 400px;
  animation: notification-slide-in 0.3s ease-out;
}

.transfer-notification.success {
  background-color: #4caf50;
}

.transfer-notification.error {
  background-color: #f44336;
}

.dark-theme .transfer-notification {
  background-color: #1565c0;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}

.dark-theme .transfer-notification.success {
  background-color: #2e7d32;
}

.dark-theme .transfer-notification.error {
  background-color: #c62828;
}

@keyframes notification-slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.close-notification {
  background: none;
  border: none;
  color: #ffffff;
  font-size: 18px;
  cursor: pointer;
  padding: 0 0 0 16px;
  margin-left: 10px;
}

.file-list-container {
  overflow-x: auto; /* 允许水平滚动 */
  overflow-y: auto;
  flex: 1;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  background-color: white;
}

.dark-theme .file-list-container {
  border-color: #444444;
  background-color: #1a1a1a;
}

/* 确保左侧边栏内容在宽度不足时能够正确显示 */
.left-sidebar-content {
  overflow-x: auto; /* 允许水平滚动 */
}

/* 调整左侧边栏最小宽度 */
.left-sidebar {
  min-width: 150px;
}

/* 当左侧边栏宽度不足时的样式 */
@media (max-width: 600px) {
  .file-list-row {
    min-width: 100%; /* 确保行宽度至少是容器宽度 */
  }
}

.file-list-container::-webkit-scrollbar {
  width: 8px;
}

.file-list-container::-webkit-scrollbar-track {
  background: transparent;
}

.file-list-container::-webkit-scrollbar-thumb {
  background-color: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}

.dark-theme .file-list-container::-webkit-scrollbar-thumb {
  background-color: rgba(255, 255, 255, 0.2);
}

.file-list-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(0, 0, 0, 0.3);
}

.dark-theme .file-list-container::-webkit-scrollbar-thumb:hover {
  background-color: rgba(255, 255, 255, 0.3);
}

.file-list-header {
  position: sticky;
  top: 0;
  background-color: #f5f5f5;
  border-bottom: 2px solid #e0e0e0;
  font-weight: bold;
  z-index: 1;
}

.dark-theme .file-list-header {
  background-color: #2a2a2a;
  border-bottom-color: #444444;
}

/* 添加列宽调整提示 */
.file-list-header .column-resize-handle {
  opacity: 0.7; /* 在表头中使调整手柄更明显 */
}

.file-list-header .column-resize-handle::before {
  content: "";
  position: absolute;
  top: 50%;
  right: 0;
  transform: translateY(-50%);
  font-size: 10px;
  color: rgba(0, 0, 0, 0.5);
  pointer-events: none;
}

.dark-theme .file-list-header .column-resize-handle::before {
  color: rgba(255, 255, 255, 0.5);
}

.file-list {
  flex: 1;
}

.file-list-row {
  display: grid;
  grid-template-columns: 40px 3fr 1fr 2fr 1fr 1fr;
  align-items: center;
  padding: 8px;
  border-bottom: 1px solid #e0e0e0;
  cursor: pointer;
  min-width: fit-content; /* 确保内容不会被截断 */
  position: relative; /* 为调整手柄定位 */
}

.dark-theme .file-list-row {
  border-bottom-color: #444444;
}

.file-list-row:hover {
  background-color: #f5f5f5;
}

.dark-theme .file-list-row:hover {
  background-color: #2a2a2a;
}

.file-list-row.selected {
  background-color: #e3f2fd;
}

.dark-theme .file-list-row.selected {
  background-color: #1e3a5f;
}

.file-list-row.highlighted {
  background-color: #fff9c4;
  animation: highlight-pulse 3s ease-in-out;
}

.dark-theme .file-list-row.highlighted {
  background-color: #5d4037;
  animation: highlight-pulse-dark 3s ease-in-out;
}

@keyframes highlight-pulse {
  0%,
  100% {
    background-color: #fff9c4;
  }
  50% {
    background-color: #ffeb3b;
  }
}

@keyframes highlight-pulse-dark {
  0%,
  100% {
    background-color: #5d4037;
  }
  50% {
    background-color: #8d6e63;
  }
}

.checkbox-cell {
  display: flex;
  align-items: center;
  justify-content: center;
}

.name-cell {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.file-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.file-name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.size-cell,
.time-cell,
.permissions-cell {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sortable {
  cursor: pointer;
  user-select: none;
}

.sort-indicator {
  margin-left: 4px;
  font-weight: bold;
}

.loading,
.empty-state {
  padding: 20px;
  text-align: center;
  color: #666666;
}

.dark-theme .loading,
.dark-theme .empty-state {
  color: #999999;
}

/* 右键菜单样式 */
.context-menu {
  position: fixed;
  background-color: #f5f5f5;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  min-width: 180px;
  max-width: 300px;
  z-index: 9999;
  color: var(--text-color);
  opacity: 1 !important;
  backdrop-filter: none;
  border: 1px solid rgba(0, 0, 0, 0.2);
  overflow: hidden;
  padding: 4px 0;
  transition:
    top 0.1s ease,
    left 0.1s ease;
  max-height: 80vh; /* 防止在极端情况下菜单太长 */
  overflow-y: auto; /* 如果内容太多则显示滚动条 */
}

/* 暗色主题下的菜单样式 */
.dark-menu {
  background-color: #222;
  border: 1px solid rgba(255, 255, 255, 0.2);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
}

.dark-menu .menu-separator {
  background-color: var(--separator-color, rgba(255, 255, 255, 0.06));
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.menu-item:not(:last-child) {
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}

.dark-menu .menu-item:not(:last-child) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.menu-item:hover {
  background-color: rgba(0, 0, 0, 0.07);
}

.dark-menu .menu-item:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.menu-item.delete-menu-item,
.menu-item.delete {
  color: var(--delete-color, #f44336);
}

/* 确保夜间模式下禁用项的样式 */
.menu-item.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dark-menu .menu-item.disabled {
  opacity: 0.4;
}

.menu-icon {
  margin-right: 10px;
  font-size: 16px;
  width: 20px;
  text-align: center;
}

/* 删除进度条样式 */
.delete-progress {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  width: 400px;
  max-width: 90%;
  background-color: #ffffff;
  border-radius: 4px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
  padding: 12px;
  z-index: 2000;
}

.dark-theme .delete-progress {
  background-color: #333333;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
}

.progress-info {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.progress-counter {
  margin-left: 10px;
  font-weight: bold;
}

.progress-bar-container {
  height: 6px;
  background-color: #e0e0e0;
  border-radius: 3px;
  overflow: hidden;
}

.dark-theme .progress-bar-container {
  background-color: #555555;
}

.progress-bar {
  height: 100%;
  background-color: #4caf50;
  transition: width 0.3s ease;
}

.progress-bar.error {
  background-color: #f44336;
}

.dark-theme .progress-bar {
  background-color: #4caf50;
}

.dark-theme .progress-bar.error {
  background-color: #f44336;
}

/* 文件传输进度浮窗样式 */
.transfer-progress-modal {
  position: absolute;
  width: 400px;
  max-width: 90%;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
  transition:
    width 0.3s,
    height 0.3s;
}

.dark-theme .transfer-progress-modal {
  background-color: #333333;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
}

/* 折叠状态 */
.transfer-progress-modal.collapsed {
  width: 220px;
  height: auto;
}

.transfer-header {
  background-color: #f5f5f5;
  padding: 10px 15px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: move;
}

.dark-theme .transfer-header {
  background-color: #444444;
  border-bottom-color: #555555;
}

.transfer-title {
  font-weight: 600;
  font-size: 14px;
  color: #333333;
}

.dark-theme .transfer-title {
  color: #ffffff;
}

.transfer-count {
  color: #666666;
  font-size: 12px;
  margin-right: 10px;
}

.dark-theme .transfer-count {
  color: #aaaaaa;
}

.transfer-items {
  padding: 10px;
  overflow-y: auto;
  max-height: 320px;
}

.transfer-item {
  margin-bottom: 15px;
  background-color: #f9f9f9;
  border-radius: 4px;
  padding: 10px;
  border-left: 3px solid #4caf50;
}

.dark-theme .transfer-item {
  background-color: #3a3a3a;
  border-left-color: #4caf50;
}

.transfer-item.completed {
  border-left-color: #4caf50;
  background-color: rgba(76, 175, 80, 0.1);
}

.dark-theme .transfer-item.completed {
  border-left-color: #4caf50;
  background-color: rgba(76, 175, 80, 0.2);
}

.transfer-item.error {
  border-left-color: #f44336;
  background-color: rgba(244, 67, 54, 0.1);
}

.dark-theme .transfer-item.error {
  border-left-color: #f44336;
  background-color: rgba(244, 67, 54, 0.2);
}

.transfer-item-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.transfer-filename {
  font-weight: 500;
  color: #333333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.dark-theme .transfer-filename {
  color: #ffffff;
}

.transfer-type {
  font-size: 11px;
  color: #666666;
  background-color: rgba(0, 0, 0, 0.1);
  padding: 2px 6px;
  border-radius: 10px;
}

.dark-theme .transfer-type {
  color: #cccccc;
  background-color: rgba(255, 255, 255, 0.1);
}

.transfer-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.transfer-size {
  color: #666666;
}

.dark-theme .transfer-size {
  color: #aaaaaa;
}

.transfer-progress-text {
  font-weight: 500;
  color: #333333;
}

.dark-theme .transfer-progress-text {
  color: #ffffff;
}

.transfer-error {
  color: #f44336;
  font-size: 12px;
  margin-top: 8px;
}

.transfer-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transfer-close-btn {
  background: none;
  border: none;
  color: #666666;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
}

.dark-theme .transfer-close-btn {
  color: #aaaaaa;
}

.transfer-toggle-btn {
  background: none;
  border: none;
  color: #666666;
  font-size: 16px;
  cursor: pointer;
  padding: 0;
  width: 20px;
  text-align: center;
}

.dark-theme .transfer-toggle-btn {
  color: #aaaaaa;
}

.transfer-item.cancelled {
  border-left-color: #9e9e9e;
  background-color: rgba(158, 158, 158, 0.1);
}

.dark-theme .transfer-item.cancelled {
  border-left-color: #9e9e9e;
  background-color: rgba(158, 158, 158, 0.2);
}

.transfer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.transfer-cancel-btn {
  background: none;
  border: none;
  color: #f44336;
  font-size: 14px;
  font-weight: bold;
  cursor: pointer;
  padding: 0;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.transfer-cancel-btn:hover {
  background-color: rgba(244, 67, 54, 0.1);
}

.dark-theme .transfer-cancel-btn {
  color: #ff7043;
}

.dark-theme .transfer-cancel-btn:hover {
  background-color: rgba(255, 112, 67, 0.2);
}

.progress-bar.cancelled {
  background-color: #9e9e9e;
}

.dark-theme .progress-bar.cancelled {
  background-color: #757575;
}

.transfer-cancelled {
  color: #757575;
  font-size: 12px;
  margin-top: 8px;
}

.dark-theme .transfer-cancelled {
  color: #aaaaaa;
}

.transfer-status-indicator {
  font-size: 16px;
  margin-left: 5px;
}

.transfer-status-indicator.completed {
  color: #4caf50;
}

.transfer-status-indicator.error {
  color: #f44336;
}

.transfer-status-indicator.cancelled {
  color: #9e9e9e;
}

.transfer-status-indicator {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: bold;
  margin-left: 5px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.transfer-status-indicator.completed {
  color: #4caf50;
  background-color: rgba(76, 175, 80, 0.1);
}

.transfer-status-indicator.error {
  color: #f44336;
  background-color: rgba(244, 67, 54, 0.1);
}

.transfer-status-indicator.cancelled {
  color: #9e9e9e;
  background-color: rgba(158, 158, 158, 0.1);
}

.transfer-clear-btn {
  background: none;
  border: none;
  color: #9e9e9e;
  font-size: 14px;
  cursor: pointer;
  padding: 0;
  margin-left: 5px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.transfer-clear-btn:hover {
  background-color: rgba(0, 0, 0, 0.1);
  color: #666;
}

.dark-theme .transfer-clear-btn {
  color: #aaa;
}

.dark-theme .transfer-clear-btn:hover {
  background-color: rgba(255, 255, 255, 0.1);
  color: #ddd;
}

/* 动画 */
.progress-bar.progress-animation {
  animation: pulse-success 1.5s ease-in-out;
}

@keyframes pulse-success {
  0% {
    background-color: #4caf50;
  }
  50% {
    background-color: #81c784;
  }
  100% {
    background-color: #4caf50;
  }
}

.dark-theme .progress-bar.progress-animation {
  animation: pulse-success-dark 1.5s ease-in-out;
}

@keyframes pulse-success-dark {
  0% {
    background-color: #2e7d32;
  }
  50% {
    background-color: #4caf50;
  }
  100% {
    background-color: #2e7d32;
  }
}

.transfer-progress-text.completed {
  color: #4caf50;
  font-weight: bold;
}

.dark-theme .transfer-progress-text.completed {
  color: #81c784;
}

/* 添加验证中状态的CSS样式 */
.transfer-status-indicator.verifying {
  color: #2196f3;
  background-color: rgba(33, 150, 243, 0.1);
  animation: rotate 1.5s linear infinite;
}

.transfer-progress-text.verifying {
  color: #2196f3;
  font-weight: 500;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* 添加验证中进度条的样式 */
.progress-bar.verifying {
  background-color: #2196f3;
}

.progress-bar.verifying-animation {
  animation: pulse-verifying 2s ease-in-out infinite;
  background-image: linear-gradient(
    -45deg,
    rgba(33, 150, 243, 0.8) 25%,
    rgba(33, 150, 243, 1) 50%,
    rgba(33, 150, 243, 0.8) 75%
  );
  background-size: 200% 100%;
  transition: background-position 0.5s ease-out;
}

@keyframes pulse-verifying {
  0% {
    background-position: 100% 0%;
  }
  100% {
    background-position: 0% 0%;
  }
}

.dark-theme .progress-bar.verifying {
  background-color: #1976d2;
}

.transfer-progress-window .cancel-all-button {
  margin-top: 10px;
  color: var(--text-color);
  background-color: var(--background-color);
  border: 1px solid var(--border-color);
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
}

/* 文件信息对话框样式 */
.file-info-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 99999;
  backdrop-filter: blur(3px);
}

.dark-theme .file-info-dialog-overlay {
  background-color: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
}

.file-info-dialog {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
  width: 500px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  color: #333; /* 日间主题文字颜色 */
}

.dark-dialog {
  background-color: #222;
  color: #eee; /* 夜间主题文字颜色 */
  border: 1px solid #444;
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid #eee;
}

.dark-dialog .dialog-header {
  border-bottom: 1px solid #444;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  color: inherit; /* 继承父元素的文字颜色 */
}

.close-button {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: #666;
}

.dark-dialog .close-button {
  color: #ccc;
}

.dialog-content {
  padding: 16px;
  overflow-y: auto;
}

.info-row {
  display: flex;
  margin-bottom: 8px;
  font-size: 14px;
}

.info-label {
  font-weight: bold;
  min-width: 100px;
  flex-shrink: 0;
  color: #555; /* 日间主题标签颜色 */
}

.dark-dialog .info-label {
  color: #bbb; /* 夜间主题标签颜色 */
}

.info-value {
  word-break: break-all;
  color: #333; /* 日间主题值文字颜色 */
}

.dark-dialog .info-value {
  color: #eee; /* 夜间主题值文字颜色 */
}

.dialog-footer {
  padding: 12px 16px;
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid #eee;
}

.dark-dialog .dialog-footer {
  border-top: 1px solid #444;
}

.close-button-text {
  background-color: #f3f3f3;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  color: #333;
}

.dark-dialog .close-button-text {
  background-color: #444;
  border-color: #555;
  color: #eee;
}

.column-resizing {
  user-select: none;
}

.column-resizing::after {
  content: "";
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 9999;
  pointer-events: none;
}

.column-resizing .column-handle {
  position: fixed;
  top: 0;
  right: 0;
  width: 10px;
  height: 100%;
  background-color: rgba(255, 255, 255, 0.5);
  cursor: col-resize;
  z-index: 10000;
}

.column-resizing .column-handle::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 0;
  width: 100%;
  height: 1px;
  background-color: #fff;
  transform: translateY(-50%);
}

.column-resizing .column-handle:hover::after {
  background-color: #aaa;
}

/* 列调整手柄样式 */
.column-resize-handle {
  position: absolute;
  top: 0;
  right: 0;
  width: 6px; /* 增加宽度 */
  height: 100%;
  cursor: col-resize;
  background-color: rgba(0, 0, 0, 0.05); /* 默认状态下轻微可见 */
  transition: background-color 0.2s;
  z-index: 2;
}

.column-resize-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  right: 2px;
  width: 2px;
  background-color: rgba(0, 0, 0, 0.2); /* 添加中间线 */
}

.dark-theme .column-resize-handle::after {
  background-color: rgba(255, 255, 255, 0.2);
}

.column-resize-handle:hover {
  background-color: rgba(0, 0, 0, 0.15);
}

.dark-theme .column-resize-handle:hover {
  background-color: rgba(255, 255, 255, 0.15);
}

.column-resize-handle:active {
  background-color: rgba(0, 0, 0, 0.25);
}

.dark-theme .column-resize-handle:active {
  background-color: rgba(255, 255, 255, 0.25);
}

/* 确保单元格内容不会被截断 */
.checkbox-cell,
.name-cell,
.size-cell,
.time-cell,
.permissions-cell {
  position: relative;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding-right: 10px; /* 为调整手柄留出更多空间 */
}

/* 列宽调整指示器 */
.column-resize-indicator {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 2px;
  background-color: #2196f3;
  z-index: 10000;
  pointer-events: none;
  box-shadow: 0 0 4px rgba(33, 150, 243, 0.5);
}

.dark-theme .column-resize-indicator {
  background-color: #64b5f6;
  box-shadow: 0 0 4px rgba(100, 181, 246, 0.5);
}

/* 拖拽相关样式 */
.file-list-container.drag-over {
  border: 2px dashed #4caf50;
  background-color: rgba(76, 175, 80, 0.05);
  position: relative;
}

.file-list-container.drag-over::after {
  content: "释放文件以上传到当前文件夹";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(76, 175, 80, 0.9);
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
  font-weight: bold;
  z-index: 10;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.dark-theme .file-list-container.drag-over {
  border: 2px dashed #81c784;
  background-color: rgba(129, 199, 132, 0.1);
}

.dark-theme .file-list-container.drag-over::after {
  background-color: rgba(129, 199, 132, 0.9);
  color: #000;
}

.file-list-row.drag-target {
  background-color: rgba(76, 175, 80, 0.2);
  border: 1px dashed #4caf50;
  position: relative;
}

.file-list-row.drag-target::after {
  content: "释放文件以上传到此文件夹";
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background-color: rgba(76, 175, 80, 0.9);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  z-index: 10;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
}

.dark-theme .file-list-row.drag-target {
  background-color: rgba(129, 199, 132, 0.2);
  border: 1px dashed #81c784;
}

.dark-theme .file-list-row.drag-target::after {
  background-color: rgba(129, 199, 132, 0.9);
  color: #000;
}

/* 文件类型拖拽样式 */
.file-list-row.is-file.drag-target {
  background-color: rgba(33, 150, 243, 0.2);
  border: 1px dashed #2196f3;
}

.file-list-row.is-file.drag-target::after {
  content: "释放文件以上传到当前文件夹";
  background-color: rgba(33, 150, 243, 0.9);
}

.dark-theme .file-list-row.is-file.drag-target {
  background-color: rgba(66, 165, 245, 0.2);
  border: 1px dashed #42a5f5;
}

.dark-theme .file-list-row.is-file.drag-target::after {
  background-color: rgba(66, 165, 245, 0.9);
}
</style>
