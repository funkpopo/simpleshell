<template>
  <teleport to="body">
    <div v-if="show" class="file-viewer-overlay" @click="closeViewer">
      <div class="file-viewer-container" :class="{ 'dark-theme': isDarkTheme }" @click.stop>
        <!-- 头部区域：标题和控制按钮 -->
        <div class="viewer-header">
          <div class="file-info">
            <div class="file-name">{{ fileName }}</div>
            <div class="file-meta">
              {{ fileType }} | {{ formatFileSize(fileSize) }}
              <span v-if="isTruncated" class="truncated-notice">（文件过大，仅显示部分内容）</span>
            </div>
          </div>
          <div class="viewer-controls">
            <button class="viewer-button" title="下载文件" @click="downloadFile">
              <span class="icon-download">⬇</span>
            </button>
            <button class="viewer-button" title="关闭" @click="closeViewer">
              <span class="icon-close">×</span>
            </button>
          </div>
        </div>
        
        <!-- 文件内容区域 -->
        <div class="viewer-content" ref="contentRef">
          <!-- 文本文件 -->
          <div v-if="isText" class="text-viewer" :class="{ 'with-line-numbers': showLineNumbers }">
            <div v-if="showLineNumbers" class="line-numbers">
              <div v-for="n in textLineCount" :key="n" class="line-number">{{ n }}</div>
            </div>
            <pre class="text-content" v-html="formattedContent"></pre>
          </div>
          
          <!-- 图片文件 -->
          <div v-else-if="isImage" class="image-viewer">
            <img :src="imageUrl" alt="图片预览" />
          </div>
          
          <!-- 不支持的文件类型 -->
          <div v-else class="unsupported-file">
            <div class="unsupported-icon">📁</div>
            <div class="unsupported-message">
              <p>无法预览此类型的文件</p>
              <p>请点击下载按钮下载后查看</p>
            </div>
          </div>
        </div>
        
        <!-- 底部工具栏 -->
        <div v-if="isText" class="viewer-footer">
          <button class="footer-button" @click="toggleLineNumbers">
            {{ showLineNumbers ? '隐藏行号' : '显示行号' }}
          </button>
          <button class="footer-button" @click="toggleWordWrap">
            {{ wordWrap ? '关闭自动换行' : '开启自动换行' }}
          </button>
          <div class="file-encoding">UTF-8</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue'
import { useI18n } from '../i18n'

const { t } = useI18n()

interface FileViewerProps {
  show: boolean
  fileName: string
  fileContent?: string
  fileType: string
  fileSize: number
  isText: boolean
  isImage: boolean
  tempFilePath?: string
  isTruncated: boolean
  connectionId: string
  remotePath: string
  isDarkTheme: boolean
}

const props = withDefaults(defineProps<FileViewerProps>(), {
  fileContent: '',
  tempFilePath: '',
  isTruncated: false
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'download'): void
}>()

// 引用内容区域DOM元素
const contentRef = ref<HTMLElement | null>(null)

// 文本显示选项
const showLineNumbers = ref(true)
const wordWrap = ref(true)

// 计算文本行数
const textLineCount = computed(() => {
  if (!props.fileContent) return 0
  return props.fileContent.split('\n').length
})

// 格式化内容 - 可以在这里添加语法高亮等功能
const formattedContent = computed(() => {
  if (!props.fileContent) return ''
  
  // 简单的HTML转义以防XSS攻击
  let content = props.fileContent
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  
  return content
})

// 图片URL
const imageUrl = computed(() => {
  if (!props.isImage || !props.tempFilePath) return ''
  return `file://${props.tempFilePath}`
})

// 格式化文件大小
const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`
}

// 切换行号显示
const toggleLineNumbers = () => {
  showLineNumbers.value = !showLineNumbers.value
}

// 切换自动换行
const toggleWordWrap = () => {
  wordWrap.value = !wordWrap.value
  updateWordWrapStyle()
}

// 更新自动换行样式
const updateWordWrapStyle = () => {
  if (contentRef.value) {
    const textContent = contentRef.value.querySelector('.text-content')
    if (textContent) {
      ;(textContent as HTMLElement).style.whiteSpace = wordWrap.value ? 'pre-wrap' : 'pre'
    }
  }
}

// 关闭查看器
const closeViewer = () => {
  emit('close')
}

// 下载文件
const downloadFile = () => {
  emit('download')
}

// 组件挂载后设置样式
onMounted(() => {
  updateWordWrapStyle()
})

// 当显示状态变化时，更新样式
watch(() => props.show, (newValue) => {
  if (newValue) {
    nextTick(() => {
      updateWordWrapStyle()
    })
  }
})
</script>

<style scoped>
.file-viewer-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.85);
  z-index: 999999;
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0;
  isolation: isolate;
}

.file-viewer-container {
  width: 90%;
  height: 90%;
  position: absolute;
  background-color: #ffffff;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  max-width: 1400px;
  z-index: 9999999;
  isolation: isolate;
  margin: 0 auto;
}

.dark-theme {
  background-color: #222;
  color: #eee;
}

.viewer-header {
  padding: 12px 16px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dark-theme .viewer-header {
  border-bottom-color: #444;
}

.file-info {
  overflow: hidden;
}

.file-name {
  font-weight: bold;
  font-size: 18px;
  color: #333;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dark-theme .file-name {
  color: #eee;
}

.file-meta {
  font-size: 12px;
  color: #666;
  margin-top: 2px;
}

.dark-theme .file-meta {
  color: #aaa;
}

.truncated-notice {
  color: #f57c00;
  margin-left: 8px;
}

.dark-theme .truncated-notice {
  color: #ffb74d;
}

.viewer-controls {
  display: flex;
  gap: 8px;
}

.viewer-button {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #555;
  border-radius: 4px;
}

.viewer-button:hover {
  background-color: #f0f0f0;
}

.dark-theme .viewer-button {
  color: #ddd;
}

.dark-theme .viewer-button:hover {
  background-color: #444;
}

.viewer-content {
  flex: 1;
  overflow: auto;
  position: relative;
}

/* 文本查看器 */
.text-viewer {
  display: flex;
  height: 100%;
  font-family: monospace;
}

.line-numbers {
  padding: 8px 0;
  background-color: #f5f5f5;
  text-align: right;
  user-select: none;
  border-right: 1px solid #e0e0e0;
  overflow: hidden;
}

.dark-theme .line-numbers {
  background-color: #333;
  border-right-color: #444;
}

.line-number {
  padding: 0 8px;
  color: #999;
  font-size: 13px;
  line-height: 1.5;
}

.dark-theme .line-number {
  color: #777;
}

.text-content {
  flex: 1;
  margin: 0;
  padding: 8px 16px;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.dark-theme .text-content {
  color: #eee;
}

/* 图片查看器 */
.image-viewer {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  padding: 16px;
}

.image-viewer img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

/* 不支持的文件类型 */
.unsupported-file {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  height: 100%;
  text-align: center;
}

.unsupported-icon {
  font-size: 72px;
  margin-bottom: 16px;
  color: #757575;
}

.dark-theme .unsupported-icon {
  color: #bdbdbd;
}

.unsupported-message {
  color: #616161;
  line-height: 1.6;
}

.dark-theme .unsupported-message {
  color: #e0e0e0;
}

/* 底部工具栏 */
.viewer-footer {
  padding: 8px 16px;
  border-top: 1px solid #e0e0e0;
  display: flex;
  gap: 12px;
  align-items: center;
}

.dark-theme .viewer-footer {
  border-top-color: #444;
}

.footer-button {
  background-color: transparent;
  border: 1px solid #e0e0e0;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  color: #555;
}

.footer-button:hover {
  background-color: #f5f5f5;
}

.dark-theme .footer-button {
  border-color: #444;
  color: #ddd;
}

.dark-theme .footer-button:hover {
  background-color: #333;
}

.file-encoding {
  margin-left: auto;
  font-size: 12px;
  color: #757575;
}

.dark-theme .file-encoding {
  color: #bdbdbd;
}
</style> 