<template>
  <teleport to="body">
    <div v-if="show" class="file-viewer-overlay" @click="closeViewer">
      <div
        class="file-viewer-container"
        :class="{ 'dark-theme': isDarkTheme }"
        @click.stop
      >
        <!-- 头部区域：标题和控制按钮 -->
        <div class="viewer-header">
          <div class="file-info">
            <div class="file-meta">
              {{ fileName }}
              <span class="file-type"
                >{{ fileType }} | {{ formatFileSize(fileSize) }}</span
              >
              <span v-if="isTruncated" class="truncated-notice"
                >（文件过大，仅显示部分内容）</span
              >
            </div>
          </div>
          <div class="viewer-controls">
            <button
              class="viewer-button"
              title="搜索"
              @click="toggleSearch"
              v-if="isText"
            >
              <img :src="searchIcon" alt="搜索" class="icon-search" />
            </button>
            <button
              class="viewer-button"
              title="下载文件"
              @click="downloadFile"
            >
              <img :src="downloadIcon" alt="下载" class="icon-download" />
            </button>
            <button class="viewer-button" title="关闭" @click="closeViewer">
              <span class="icon-close">×</span>
            </button>
          </div>
        </div>

        <!-- 搜索栏 -->
        <div v-if="showSearch && isText" class="search-bar">
          <input
            type="text"
            v-model="searchQuery"
            placeholder="搜索文本..."
            class="search-input"
            @keyup.enter="searchNext"
            ref="searchInputRef"
          />
          <div class="search-controls">
            <span class="search-count" v-if="matchCount > 0"
              >{{ currentMatchIndex + 1 }}/{{ matchCount }}</span
            >
            <button
              class="search-button"
              @click="searchPrev"
              :disabled="matchCount === 0"
            >
              <span>↑</span>
            </button>
            <button
              class="search-button"
              @click="searchNext"
              :disabled="matchCount === 0"
            >
              <span>↓</span>
            </button>
            <button class="search-button" @click="clearSearch">
              <span>✕</span>
            </button>
          </div>
        </div>

        <!-- 文件内容区域 -->
        <div class="viewer-content" ref="contentRef">
          <!-- 文本文件 -->
          <div
            v-if="isText"
            class="text-viewer"
            :class="{ 'with-line-numbers': showLineNumbers }"
          >
            <div
              v-if="showLineNumbers"
              class="line-numbers"
              ref="lineNumbersRef"
            >
              <div v-for="n in textLineCount" :key="n" class="line-number">
                {{ n }}
              </div>
            </div>
            <div class="text-content-wrapper">
              <pre
                class="text-content"
                v-html="formattedContent"
                ref="textContentRef"
                @scroll="handleTextScroll"
              ></pre>
            </div>
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
            {{ showLineNumbers ? "隐藏行号" : "显示行号" }}
          </button>
          <button class="footer-button" @click="toggleWordWrap">
            {{ wordWrap ? "关闭自动换行" : "开启自动换行" }}
          </button>
          <div class="file-encoding">UTF-8</div>
        </div>
      </div>
    </div>
  </teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from "vue";
import { useI18n } from "../i18n";

const { t } = useI18n();

interface FileViewerProps {
  show: boolean;
  fileName: string;
  fileContent?: string;
  fileType: string;
  fileSize: number;
  isText: boolean;
  isImage: boolean;
  tempFilePath?: string;
  isTruncated: boolean;
  connectionId: string;
  remotePath: string;
  isDarkTheme: boolean;
}

const props = withDefaults(defineProps<FileViewerProps>(), {
  fileContent: "",
  tempFilePath: "",
  isTruncated: false,
});

const emit = defineEmits<{
  (e: "close"): void;
  (e: "download"): void;
}>();

// 引用内容区域DOM元素
const contentRef = ref<HTMLElement | null>(null);
const textContentRef = ref<HTMLElement | null>(null);
const lineNumbersRef = ref<HTMLElement | null>(null);
const searchInputRef = ref<HTMLInputElement | null>(null);

// 文本显示选项
const showLineNumbers = ref(true);
const wordWrap = ref(true);

// 搜索相关
const showSearch = ref(false);
const searchQuery = ref("");
const matchCount = ref(0);
const currentMatchIndex = ref(0);
const matches = ref<number[]>([]); // 存储匹配位置

const searchIcon = computed(() => {
  if (props.isDarkTheme) {
    return new URL("../assets/search-night.svg", import.meta.url).href;
  } else {
    return new URL("../assets/search-day.svg", import.meta.url).href;
  }
});

// 下载图标
const downloadIcon = computed(() => {
  if (props.isDarkTheme) {
    return new URL("../assets/download-night.svg", import.meta.url).href;
  } else {
    return new URL("../assets/download-day.svg", import.meta.url).href;
  }
});

// 计算文本行数
const textLineCount = computed(() => {
  if (!props.fileContent) return 0;
  return props.fileContent.split("\n").length;
});

// 格式化内容 - 可以在这里添加语法高亮等功能
const formattedContent = computed(() => {
  if (!props.fileContent) return "";

  // 简单的HTML转义以防XSS攻击
  let content = props.fileContent
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 如果有搜索结果，添加高亮标记（保留原始文本，只添加样式）
  if (matches.value.length > 0 && searchQuery.value) {
    const parts: string[] = [];
    let lastIndex = 0;

    for (let i = 0; i < matches.value.length; i++) {
      const start = matches.value[i];
      const end = start + searchQuery.value.length;

      // 添加匹配前的文本
      if (start > lastIndex) {
        parts.push(content.substring(lastIndex, start));
      }

      // 添加带高亮的匹配文本
      const highlightClass =
        i === currentMatchIndex.value ? "search-match-current" : "search-match";
      parts.push(
        `<span class="${highlightClass}">${content.substring(start, end)}</span>`,
      );

      lastIndex = end;
    }

    // 添加最后一个匹配后的文本
    if (lastIndex < content.length) {
      parts.push(content.substring(lastIndex));
    }

    content = parts.join("");
  }

  return content;
});

// 图片URL
const imageUrl = computed(() => {
  if (!props.isImage || !props.tempFilePath) return "";
  return `file://${props.tempFilePath}`;
});

// 格式化文件大小
const formatFileSize = (size: number): string => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(2)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(2)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

// 处理文本滚动以同步行号
const handleTextScroll = () => {
  if (textContentRef.value && lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = textContentRef.value.scrollTop;
  }
};

// 切换行号显示
const toggleLineNumbers = () => {
  showLineNumbers.value = !showLineNumbers.value;
};

// 切换自动换行
const toggleWordWrap = () => {
  wordWrap.value = !wordWrap.value;
  updateWordWrapStyle();
};

// 更新自动换行样式
const updateWordWrapStyle = () => {
  if (textContentRef.value) {
    textContentRef.value.style.whiteSpace = wordWrap.value ? "pre-wrap" : "pre";
  }
};

// 关闭查看器
const closeViewer = () => {
  emit("close");
};

// 下载文件
const downloadFile = () => {
  emit("download");
};

// 切换搜索框显示
const toggleSearch = () => {
  showSearch.value = !showSearch.value;
  if (showSearch.value) {
    // 清空之前的搜索结果
    clearSearch();
    // 下一个 tick 后聚焦到输入框
    nextTick(() => {
      searchInputRef.value?.focus();
    });
  }
};

// 执行搜索
const performSearch = () => {
  if (!searchQuery.value || !props.fileContent) {
    matches.value = [];
    matchCount.value = 0;
    currentMatchIndex.value = 0;
    return;
  }

  const query = searchQuery.value.toLowerCase();
  const content = props.fileContent.toLowerCase();

  // 找出所有匹配位置
  matches.value = [];
  let pos = content.indexOf(query);
  while (pos !== -1) {
    matches.value.push(pos);
    pos = content.indexOf(query, pos + 1);
  }

  matchCount.value = matches.value.length;
  currentMatchIndex.value = matches.value.length > 0 ? 0 : -1;

  // 重新渲染内容，添加高亮
  nextTick(() => {
    scrollToCurrentMatch();
  });
};

// 搜索下一个匹配项
const searchNext = () => {
  if (matches.value.length === 0) {
    performSearch();
    return;
  }

  if (currentMatchIndex.value < matches.value.length - 1) {
    currentMatchIndex.value++;
  } else {
    currentMatchIndex.value = 0; // 循环到第一个
  }

  scrollToCurrentMatch();
};

// 搜索上一个匹配项
const searchPrev = () => {
  if (matches.value.length === 0) return;

  if (currentMatchIndex.value > 0) {
    currentMatchIndex.value--;
  } else {
    currentMatchIndex.value = matches.value.length - 1; // 循环到最后一个
  }

  scrollToCurrentMatch();
};

// 滚动到当前匹配项
const scrollToCurrentMatch = () => {
  if (matches.value.length === 0 || currentMatchIndex.value < 0) return;

  nextTick(() => {
    if (textContentRef.value) {
      const highlightElements = textContentRef.value.querySelectorAll(
        ".search-match-current",
      );
      if (highlightElements.length > 0) {
        highlightElements[0].scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  });
};

// 清除搜索
const clearSearch = () => {
  searchQuery.value = "";
  matches.value = [];
  matchCount.value = 0;
  currentMatchIndex.value = 0;
};

// 监听搜索查询变化
watch(searchQuery, () => {
  performSearch();
});

// 组件挂载后设置样式
onMounted(() => {
  updateWordWrapStyle();
});

// 当显示状态变化时，更新样式
watch(
  () => props.show,
  (newValue) => {
    if (newValue) {
      nextTick(() => {
        updateWordWrapStyle();
      });
    }
  },
);
</script>

<style>
/* 内联样式，确保搜索高亮工作正常 */
.search-match {
  background-color: rgba(255, 213, 79, 0.4);
  border-radius: 2px;
}

.search-match-current {
  background-color: rgba(255, 152, 0, 0.7);
  border-radius: 2px;
}

.dark-theme .search-match {
  background-color: rgba(255, 213, 79, 0.3);
}

.dark-theme .search-match-current {
  background-color: rgba(255, 152, 0, 0.6);
}
</style>

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
}

.dark-theme .viewer-header {
  border-bottom-color: #444;
}

.file-info {
  overflow: hidden;
  max-width: 80%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0;
}

.file-meta {
  font-size: 13px;
  color: #666;
  display: flex;
  align-items: center;
  gap: 12px;
}

.dark-theme .file-meta {
  color: #bbb;
}

.file-type {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.08);
  border-radius: 4px;
  font-weight: 500;
}

.dark-theme .file-type {
  background: rgba(255, 255, 255, 0.1);
}

.file-size {
  font-weight: 500;
}

.truncated-notice {
  color: #f57c00;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 500;
  background-color: rgba(245, 124, 0, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}

.dark-theme .truncated-notice {
  color: #ffb74d;
  background-color: rgba(255, 183, 77, 0.15);
}

.viewer-controls {
  display: flex;
  gap: 8px;
}

.viewer-button {
  background: transparent;
  border: none;
  cursor: pointer;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: #555;
  border-radius: 4px;
  transition: all 0.2s;
}

.viewer-button:hover {
  background-color: #f0f0f0;
  transform: translateY(-2px);
}

.dark-theme .viewer-button {
  color: #ddd;
}

.dark-theme .viewer-button:hover {
  background-color: #444;
}

.icon-search {
  width: 20px;
  height: 20px;
  opacity: 0.85;
  transition: opacity 0.2s;
}

.viewer-button:hover .icon-search {
  opacity: 1;
}

.icon-download {
  width: 20px;
  height: 20px;
  opacity: 0.85;
  transition: opacity 0.2s;
}

.viewer-button:hover .icon-download {
  opacity: 1;
}

/* 搜索栏 */
.search-bar {
  padding: 8px 16px;
  border-bottom: 1px solid #e0e0e0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.dark-theme .search-bar {
  border-bottom-color: #444;
}

.search-input {
  flex: 1;
  height: 32px;
  padding: 0 12px;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  font-size: 14px;
  outline: none;
  background-color: #fff;
  color: #333;
}

.dark-theme .search-input {
  border-color: #555;
  background-color: #333;
  color: #eee;
}

.search-input:focus {
  border-color: #2196f3;
  box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.2);
}

.dark-theme .search-input:focus {
  border-color: #2196f3;
  box-shadow: 0 0 0 2px rgba(33, 150, 243, 0.3);
}

.search-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-count {
  font-size: 13px;
  color: #666;
  min-width: 40px;
}

.dark-theme .search-count {
  color: #bbb;
}

.search-button {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  border: 1px solid #e0e0e0;
  border-radius: 4px;
  cursor: pointer;
  color: #555;
  font-size: 14px;
}

.search-button:hover:not(:disabled) {
  background-color: #f5f5f5;
}

.search-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dark-theme .search-button {
  border-color: #555;
  color: #ddd;
}

.dark-theme .search-button:hover:not(:disabled) {
  background-color: #383838;
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
  min-width: 45px;
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
  height: 1.5em;
}

.dark-theme .line-number {
  color: #777;
}

.text-content-wrapper {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.text-content {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 8px 16px;
  font-size: 14px;
  line-height: 1.5;
  color: #333;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
  box-sizing: border-box;
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
