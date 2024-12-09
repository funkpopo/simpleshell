<template>
  <div class="terminal-wrapper">
    <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }" @paste.prevent="handlePaste">
      <div 
        v-if="showSuggestions" 
        class="command-suggestions"
        :class="{ 'visible': showSuggestions }"
      >
        <!-- suggestions content -->
      </div>
    </div>
    <div 
      v-if="showSearchBar" 
      class="terminal-search-bar terminal-search-bar-top-right"
    >
      <div class="search-bar-content">
        <div class="search-input-wrapper">
          <a-input 
            id="terminal-search-input"
            v-model="searchText" 
            @input="performSearch"
            @keyup.enter="performSearch"
            :placeholder="t('terminal.search.placeholder')"
            class="search-input"
            size="small"
            allow-clear
          >
            <template #prefix>
              <icon-search />
            </template>
          </a-input>
          <div class="search-navigation">
            <a-button 
              type="text" 
              size="small" 
              @click="findPrevious"
              class="nav-btn"
            >
              <template #icon>
                <icon-arrow-up />
              </template>
            </a-button>
            <a-button 
              type="text" 
              size="small" 
              @click="findNext"
              class="nav-btn"
            >
              <template #icon>
                <icon-arrow-down />
              </template>
            </a-button>
          </div>
        </div>
        
        <div class="search-options">
          <a-checkbox 
            v-model="searchOptions.caseSensitive" 
            @change="performSearch"
            size="small"
          >
            {{ t('terminal.search.caseSensitive') }}
          </a-checkbox>
          <a-checkbox 
            v-model="searchOptions.wholeWord" 
            @change="performSearch"
            size="small"
          >
            {{ t('terminal.search.wholeWord') }}
          </a-checkbox>
        </div>
      </div>
    </div>
    <div 
      class="resource-monitor" 
      :class="{ 'collapsed': isResourceMonitorCollapsed }"
      @click="toggleResourceMonitor"
    >
      <div v-if="!isResourceMonitorCollapsed" class="monitor-content">
        <div class="monitor-item">
          <span class="label">CPU</span>
          <div class="progress-bar">
            <div class="progress cpu-progress" :style="{ width: `${cpuUsage}%` }" :class="getCPUClass"></div>
          </div>
          <span class="value" v-show="showValues">{{ cpuUsage }}%</span>
        </div>
        <div class="monitor-item">
          <span class="label">MEM</span>
          <div class="progress-bar">
            <div class="progress mem-progress" :style="{ width: `${memUsage}%` }"></div>
          </div>
          <span class="value" v-show="showValues">{{ memUsage }}%</span>
        </div>
      </div>
      <div class="monitor-collapse-indicator">
        <icon-right v-if="isResourceMonitorCollapsed" />
        <icon-left v-else />
      </div>
    </div>
  </div>
</template>

<script>
import { Message } from '@arco-design/web-vue'
import { ref, onMounted, onUnmounted, watch, nextTick, inject, computed, getCurrentInstance } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import io from 'socket.io-client'
import { debounce as _debounce } from 'lodash'
import fs from 'fs'
import path from 'path'
import { join } from 'path'
import { promises as fsPromises } from 'fs'
import msgpack from 'msgpack-lite'
import { SearchAddon } from '@xterm/addon-search'
import { 
  IconSearch, 
  IconClose, 
  IconRight, 
  IconLeft, 
  IconDrag,
  IconArrowUp,
  IconArrowDown 
} from '@arco-design/web-vue/es/icon'
import { shell } from '@electron/remote'

export default {
  name: 'SSHTerminal',
  props: {
    connection: {
      type: Object,
      required: true
    },
    sessionId: {
      type: String,
      required: true
    },
    fontSize: {
      type: Number,
      default: 14
    },
    settings: {
      type: Object,
      required: true
    },
    active: {
      type: Boolean,
      default: false
    }
  },
  emits: ['close', 'pathChange', 'connectionStatus'],
  components: {
    IconSearch,
    IconClose,
    IconRight,
    IconLeft,
    IconDrag,
    IconArrowUp,
    IconArrowDown
  },
  setup(props, { emit }) {
    const terminal = ref(null)
    let term = null
    let socket = null
    let fitAddon = null
    const isTerminalReady = ref(false)
    const outputBuffer = ref([])
    const isDarkMode = inject('isDarkMode', ref(false))
    const currentPath = ref('/')
    const contextMenu = ref(null)
    const regexPatterns = ref({})
    const commandHistory = ref([])
    const suggestionMenu = ref(null)
    const showSuggestions = ref(false)
    const currentInput = ref('')
    const selectedSuggestionIndex = ref(-1)
    const suggestions = ref([])
    const cpuUsage = ref(0)
    const memUsage = ref(0)
    const showResourceMonitor = ref(true)
    let resourceMonitorInterval = null
    const showValues = ref(false)
    let searchAddon = null

    // 搜索相关的响应式变量
    const showSearchBar = ref(false)
    const searchText = ref('')
    const searchOptions = ref({
      caseSensitive: false,
      wholeWord: false
    })

    // 在 setup 中添加编辑器模式的检测变量
    const isInEditorMode = ref(false)

    // 在 setup 函数中添加定时器相关的变量和函数
    const resizeInterval = ref(null)

    // 添加启动定时resize的函数
    const startResizeInterval = () => {
      if (resizeInterval.value) {
        clearInterval(resizeInterval.value)
      }
      
      resizeInterval.value = setInterval(() => {
        // 复用 top 命令的终端尺寸调整逻辑
        const terminalElement = terminal.value
        const computedStyle = window.getComputedStyle(terminalElement)
        const padding = parseInt(computedStyle.padding || '0')
        
        // 计算可用空间
        const availableWidth = terminalElement.clientWidth - 2 * padding
        const availableHeight = terminalElement.clientHeight - 2 * padding

        // 使用更精确的字符尺寸计算
        const span = document.createElement('span')
        span.style.fontFamily = term.options.fontFamily
        span.style.fontSize = `${term.options.fontSize}px`
        span.style.position = 'absolute'
        span.style.visibility = 'hidden'
        span.textContent = 'X'
        document.body.appendChild(span)

        const charSize = span.getBoundingClientRect()
        const charWidth = charSize.width
        const charHeight = charSize.height
        document.body.removeChild(span)

        // 计算新的列数和行数
        const newCols = Math.max(80, Math.floor(availableWidth / charWidth))
        // 为界面预留合适的空间，减去2行
        const newRows = Math.max(24, Math.floor(availableHeight / charHeight) - 2)

        // 调整终端大小
        if (term) {
          term.resize(newCols, newRows)
          
          // 通知服务器新的终端大小
          if (socket && isTerminalReady.value) {
            socket.emit('resize', { 
              session_id: props.sessionId, 
              cols: newCols, 
              rows: newRows
            })
          }
        }
      }, 1000) // 每秒执行一次
    }

    // 监听 fontSize 的变化
    watch(() => props.fontSize, (newSize) => {
      if (term) {
        term.options.fontSize = newSize;
        // 调整终端大小以适应新的字号
        nextTick(() => {
          if (fitAddon) {
            fitAddon.fit();
            // 通知服务器终端大小变化
            if (socket && isTerminalReady.value) {
              socket.emit('resize', { 
                session_id: props.sessionId, 
                cols: term.cols, 
                rows: term.rows 
              });
            }
          }
        });
      }
    });

    const initializeSocket = () => {
      return new Promise((resolve) => {
        socket = io('http://localhost:5000', {
          transports: ['websocket'],
          reconnection: true,
          reconnectionAttempts: 5,
          reconnectionDelay: 1000,
          forceNew: true,
          timeout: 5000,
          perMessageDeflate: false,
          pingInterval: 60000,
          pingTimeout: 300000,
          upgrade: false,
          rememberUpgrade: false,
          autoConnect: true,
          reconnectionDelayMax: 5000,
        })
        
        socket.on('connect', () => {
          console.log('Socket connected')
          socket.emit('open_ssh', { 
            ...props.connection, 
            session_id: props.sessionId,
            term: 'xterm-256color',
            env: {
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              TERM_PROGRAM: 'xterm',
            }
          })
        })

        socket.on('connect_error', (error) => {
          console.error('Socket connection error:', error)
          setTimeout(() => {
            console.log('Attempting to reconnect...')
            socket.connect()
          }, 1000)
        })

        socket.on('disconnect', (reason) => {
          console.log('Socket disconnected:', reason)
          if (reason === 'io server disconnect' || reason === 'transport close') {
            console.log('Attempting to reconnect...')
            socket.connect()
          }
        })

        socket.on('ssh_connected', (data) => {
          if (data.session_id === props.sessionId) {
            console.log('SSH connected:', data.message)
            emit('connectionStatus', { type: 'connected', sessionId: props.sessionId })
            if (!isTerminalReady.value) {
              initializeTerminal()
            }
            updateResourceUsage()
          }
        })

        socket.on('ssh_output', (data) => {
          if (data.session_id === props.sessionId) {
            console.log('Received SSH output')
            writeToTerminal(data.output)
          }
        })

        socket.on('ssh_error', (error) => {
          console.error('SSH Error:', error)
          if (isTerminalReady.value && term) {
            term.write('\r\n\x1b[31m=== Error ===\x1b[0m\r\n')
            term.write('\x1b[31m' + error.error + '\x1b[0m\r\n')
            term.write('\x1b[31m=============\x1b[0m\r\n\r\n')
            term.write('Press Ctrl+W or click the close button (×) to close this terminal.\r\n')
            term.scrollToBottom()
          } else {
            outputBuffer.value.push('\r\n\x1b[31m=== Error ===\x1b[0m\r\n')
            outputBuffer.value.push('\x1b[31m' + error.error + '\x1b[0m\r\n')
            outputBuffer.value.push('\x1b[31m=============\x1b[0m\r\n\r\n')
            outputBuffer.value.push('Press Ctrl+W or click the close button (×) to close this terminal.\r\n')
          }
        })

        socket.on('ssh_closed', (data) => {
          if (data.session_id === props.sessionId) {
            console.log('SSH connection closed:', data.message)
            emit('connectionStatus', { type: 'disconnected', sessionId: props.sessionId })
            writeToTerminal('SSH connection closed\r\n')
          }
        })

        socket.on('resource_usage', (data) => {
          if (data.session_id === props.sessionId) {
            console.log('Received resource usage:', data.usage)
            cpuUsage.value = data.usage.cpu
            memUsage.value = data.usage.memory
          }
        })

        resolve()
      })
    }

    const handlePaste = (event) => {
      event.preventDefault()
      if (term && isTerminalReady.value) {
        const text = event.clipboardData.getData('text')
        // 规范化换行符，移除多余的空行
        const normalizedText = text
          .replace(/\r\n/g, '\n') // 将 CRLF 转换为 LF
          .replace(/\r/g, '\n')   // 将剩余的 CR 转换为 LF
          .replace(/\n\n+/g, '\n') // 将多个连续换行替换为单个换行
          .trim() // 移除首尾空白

        // 发送处理后的文本
        socket.emit('ssh_input', { session_id: props.sessionId, input: normalizedText })
      }
    }

    const handleCopy = () => {
      if (term && term.hasSelection()) {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
          term.clearSelection()
        }
      }
    }

    const setTheme = (newTheme) => {
      isDarkMode.value = newTheme === 'dark'
      if (term) {
        const theme = isDarkMode.value ? getDarkTheme() : getLightTheme()
        term.options.theme = theme
        term.refresh(0, term.rows - 1)
      }
    }

    const getDarkTheme = () => ({
      background: '#1E1E1E',
      foreground: '#D4D4D4',
      cursor: '#FFFFFF',
      cursorAccent: '#000000',
      selection: 'rgba(255, 255, 255, 0.3)',
      black: '#000000',
      red: '#E06C75',
      green: '#98C379',
      yellow: '#E5C07B',
      blue: '#61AFEF',
      magenta: '#C678DD',
      cyan: '#56B6C2',
      white: '#D4D4D4',
      brightBlack: '#666666',
      brightRed: '#FF7A80',
      brightGreen: '#B5E890',
      brightYellow: '#FFD780',
      brightBlue: '#80BAFF',
      brightMagenta: '#FF80FF',
      brightCyan: '#80FFFF',
      brightWhite: '#FFFFFF'
    })

    const getLightTheme = () => ({
      background: '#FFFFFF',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#FFFFFF',
      selection: 'rgba(0, 0, 0, 0.3)',
      black: '#000000',
      red: '#CC0000',
      green: '#4E9A06',
      yellow: '#C4A000',
      blue: '#3465A4',
      magenta: '#75507B',
      cyan: '#06989A',
      white: '#D3D7CF',
      brightBlack: '#666666',
      brightRed: '#EF2929',
      brightGreen: '#8AE234',
      brightYellow: '#FCE94F',
      brightBlue: '#729FCF',
      brightMagenta: '#AD7FA8',
      brightCyan: '#34E2E2',
      brightWhite: '#EEEEEC'
    })

    const initializeTerminal = async () => {
      await nextTick()
      if (!terminal.value) {
        console.error('Terminal element not found')
        return
      }

      // 获取终端容器元素
      const terminalElement = terminal.value
      const computedStyle = window.getComputedStyle(terminalElement)
      
      // 计算可用空间
      const padding = parseInt(computedStyle.padding || '0')
      const availableWidth = terminalElement.clientWidth - 2 * padding
      const availableHeight = terminalElement.clientHeight - 2 * padding

      // 创建临时的span元素来测量字符尺寸
      const span = document.createElement('span')
      span.style.fontFamily = 'Consolas, "Courier New", monospace'
      span.style.fontSize = `${props.fontSize}px`
      span.style.position = 'absolute'
      span.style.visibility = 'hidden'
      span.textContent = 'X'
      document.body.appendChild(span)

      // 获取实际字符尺寸
      const charSize = span.getBoundingClientRect()
      const charWidth = charSize.width
      const charHeight = charSize.height
      document.body.removeChild(span)

      // 计算终端的列数和行数
      const cols = Math.floor(availableWidth / charWidth)
      const rows = Math.floor(availableHeight / charHeight)

      // 创建终端实例
      term = new Terminal({
        cursorBlink: true,
        fontSize: props.fontSize,
        fontFamily: 'Consolas, "Courier New", monospace',
        copyOnSelect: false,
        theme: isDarkMode.value ? getDarkTheme() : getLightTheme(),
        allowTransparency: true,
        scrollback: 10000, // 增加回滚缓冲区大小
        convertEol: true,
        termName: 'xterm-256color',
        rendererType: props.settings.useGPU ? 'webgl' : 'canvas',
        webglAddon: props.settings.useGPU ? {
          preserveDrawingBuffer: true,
          antialias: true,
          transparent: true
        } : undefined,
        allowProposedApi: true,
        cols: cols,
        rows: rows,
        windowsMode: false,
        windowsPty: false,
        smoothScrollDuration: 300, // 添加平滑滚动
        fastScrollModifier: 'alt',
        allowTransparency: true,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 1,
        screenReaderMode: false,
        disableStdin: false,
        cursorStyle: 'block',
        fastScrollKey: 'Alt',
        macOptionIsMeta: true,
        scrollSensitivity: 1,
        experimentalCharAtlas: 'dynamic',
        refreshRate: 60,
      })

      term.open(terminal.value)

      await new Promise(resolve => setTimeout(resolve, 0))

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      // 自定义链接处理器
      const webLinksAddon = new WebLinksAddon(
        (event, uri) => {
          event.preventDefault()
          
          // 检查是否按下 Ctrl 键
          if (event.ctrlKey) {
            try {
              // 使用 Electron 的 shell 打开链接
              shell.openExternal(uri)
            } catch (error) {
              console.error('Failed to open link:', error)
              Message.error(`Unable to open link: ${uri}`)
            }
          }
        }
      )

      term.loadAddon(webLinksAddon)

      fitAddon.fit()

      term.attachCustomKeyEventHandler((event) => {
        if (event.ctrlKey && event.key === 'c' && term.hasSelection()) {
          handleCopy()
          return false
        }
        if (event.type === 'keydown') {
          return handleSpecialKeys(event)
        }
        return true
      })

      // 修改滚动行为添加安全检查
      term.onLineFeed(() => {
        // 确保 term.element 存在
        if (term && term.element) {
          try {
            const isScrolledToBottom = 
              term.element.scrollTop + term.element.clientHeight >= term.element.scrollHeight
            if (isScrolledToBottom) {
              // 使用 requestAnimationFrame 来确保在下一帧执行滚动
              requestAnimationFrame(() => {
                try {
                  term.scrollToBottom()
                } catch (error) {
                  console.error('Error scrolling to bottom:', error)
                }
              })
            }
          } catch (error) {
            console.error('Error checking scroll position:', error)
          }
        }
      })

      // 添加数据处理事件
      term.onData((data) => {
        if (!isTerminalReady.value || !socket) return
        
        // 忽略NUL字符(^@)
        if (data === '\x00') return
        
        // 检测 Ctrl+C（ASCII 码 3）
        if (data === '\x03' && isInEditorMode.value) {
          socket.emit('ssh_input', { session_id: props.sessionId, input: data })
          return
        }

        // 记录输入命令 - 修改这部分逻辑
        if (!isInEditorMode.value) {
          // 处理 Enter 键
          if (data === '\r') {
            // 如果命令提示窗口显示且有选中项，使用选中的建议
            if (showSuggestions.value && selectedSuggestionIndex.value >= 0) {
              const selectedCommand = suggestions.value[selectedSuggestionIndex.value]
              if (selectedCommand) {
                // 清除当前输入
                const backspaces = '\b'.repeat(currentInput.value.length)
                socket.emit('ssh_input', { 
                  session_id: props.sessionId, 
                  input: backspaces + selectedCommand + '\r'
                })
                // 记录到历史后清除当前输入
                if (selectedCommand.trim()) {
                  addToHistory(selectedCommand.trim())
                }
                currentInput.value = ''
                hideSuggestionMenu()
                return
              }
            }

            // 正常处理 Enter 键事件
            const command = currentInput.value.trim()
            if (command) {
              addToHistory(command)
            }
            // 发送命令前清除当前输入
            currentInput.value = ''
            if (showSuggestions.value) {
              hideSuggestionMenu()
            }
            socket.emit('ssh_input', { session_id: props.sessionId, input: '\r' })
            return
          }

          // 只对可打印字符进行记录
          if (data >= ' ' && data <= '~') {
            currentInput.value += data
            if (currentInput.value.length > 0) {
              showSuggestionMenu()
            }
          }
          // 处理退格键
          else if (data === '\x7f') {
            if (currentInput.value.length > 0) {
              currentInput.value = currentInput.value.slice(0, -1)
              if (currentInput.value.length > 0) {
                showSuggestionMenu()
              } else {
                hideSuggestionMenu()
              }
            }
          }
        }

        // 发送输入到服务器
        socket.emit('ssh_input', { session_id: props.sessionId, input: data })
      })

      // 添加终端大小变化处理
      const updateTerminalSize = () => {
        if (fitAddon) {
          fitAddon.fit()
          const dimensions = term.options
          if (socket && isTerminalReady.value) {
            socket.emit('resize', { 
              session_id: props.sessionId, 
              cols: dimensions.cols, 
              rows: dimensions.rows 
            })
          }
        }
      }

      // 监听窗口大小变化
      const debouncedResize = _debounce(updateTerminalSize, 100)
      window.addEventListener('resize', debouncedResize)

      // 在组件卸载时移除事件监听
      onUnmounted(() => {
        window.removeEventListener('resize', debouncedResize)
      })

      isTerminalReady.value = true
      
      outputBuffer.value.forEach(output => {
        term.write(output)
      })
      outputBuffer.value = []

      if (socket) {
        socket.emit('resize', { 
          session_id: props.sessionId, 
          cols: term.cols, 
          rows: term.rows 
        })
      }

      window.addEventListener('resize', handleResize)

      // 初始化 SearchAddon
      searchAddon = new SearchAddon()
      term.loadAddon(searchAddon)
    }

    // 添加一个安全的滚动函数
    const safeScrollToBottom = () => {
      if (term && term.element) {
        try {
          term.scrollToBottom()
        } catch (error) {
          console.error('Error in safeScrollToBottom:', error)
        }
      }
    }

    const handleResize = () => {
      if (!props.active) {
        return;
      }

      if (fitAddon && term && isTerminalReady.value && socket) {
        // 获取新的终端尺寸
        const terminalElement = terminal.value
        const computedStyle = window.getComputedStyle(terminalElement)
        const padding = parseInt(computedStyle.padding || '0')
        
        // 计算可用空间
        const availableWidth = terminalElement.clientWidth - 2 * padding
        const availableHeight = terminalElement.clientHeight - 2 * padding

        // 使用当前字体大小计算字符尺寸
        const charWidth = Math.ceil(term.options.fontSize * 0.6)  // 估算字符宽度
        const charHeight = Math.ceil(term.options.fontSize * 1.2) // 估算字符高度

        // 计算新的列数和行数
        const newCols = Math.max(80, Math.floor(availableWidth / charWidth))
        const newRows = Math.max(24, Math.floor(availableHeight / charHeight))

        // 调整终端大小
        term.resize(newCols, newRows)
        
        // 通知服务器新的终端尺寸
        socket.emit('resize', { 
          session_id: props.sessionId, 
          cols: newCols, 
          rows: newRows 
        })

        // 使用安全的滚动函数
        nextTick(() => {
          safeScrollToBottom()
        })

        // 重新定位建议菜单
        if (suggestionMenu.value && showSuggestions.value) {
          nextTick(() => {
            positionSuggestionMenu()
          })
        }
      }
    }

    const manualResize = () => {
      if (!props.active) {
        return;
      }

      if (fitAddon && term) {
        nextTick(() => {
          // 获取新的终端尺寸
          const terminalElement = terminal.value
          const computedStyle = window.getComputedStyle(terminalElement)
          const padding = parseInt(computedStyle.padding || '0')
          
          // 计算可用空间
          const availableWidth = terminalElement.clientWidth - 2 * padding
          const availableHeight = terminalElement.clientHeight - 2 * padding

          // 使用当前字体大小计算字符尺寸
          const charWidth = Math.ceil(term.options.fontSize * 0.6)
          const charHeight = Math.ceil(term.options.fontSize * 1.2)

          // 计算新的列数和行数
          const newCols = Math.max(80, Math.floor(availableWidth / charWidth))
          const newRows = Math.max(24, Math.floor(availableHeight / charHeight))

          // 调整终端大小
          term.resize(newCols, newRows)
          
          if (socket && isTerminalReady.value) {
            socket.emit('resize', { 
              session_id: props.sessionId, 
              cols: newCols, 
              rows: newRows 
            })
          }
        })
      }
    }

    const detectPathChange = (output) => {
      const pathRegex = /^\[([^@\]]+@[^\]]+)\]/;
      const match = output.match(pathRegex);
      if (match) {
        const promptInfo = match[1].trim();
        if (promptInfo !== currentPath.value) {
          currentPath.value = promptInfo;
          emit('pathChange', promptInfo);
          console.log('Path changed in SSHTerminal:', promptInfo);
        }
      }
    };

    const writeToTerminal = (text) => {
      if (isTerminalReady.value && term) {
        try {
          // 检测是否进入 top 界面
          if (text.includes('top - ') && text.includes('Tasks:')) {
            isInEditorMode.value = true
            // top 命令界面调整
            nextTick(() => {
              const terminalElement = terminal.value
              const computedStyle = window.getComputedStyle(terminalElement)
              const padding = parseInt(computedStyle.padding || '0')
              
              // 计算可用空间
              const availableWidth = terminalElement.clientWidth - 2 * padding
              const availableHeight = terminalElement.clientHeight - 2 * padding

              // 使用更精确的字符尺寸计算
              const span = document.createElement('span')
              span.style.fontFamily = term.options.fontFamily
              span.style.fontSize = `${term.options.fontSize}px`
              span.style.position = 'absolute'
              span.style.visibility = 'hidden'
              span.textContent = 'X'
              document.body.appendChild(span)

              const charSize = span.getBoundingClientRect()
              const charWidth = charSize.width
              const charHeight = charSize.height
              document.body.removeChild(span)

              // 计算新的列数和行数，为 top 界面预留空间
              const newCols = Math.max(80, Math.floor(availableWidth / charWidth))
              // 为 top 界面预留合适的空间，减去4行（顶部信息、任务信息、CPU信息和底部提示）
              const newRows = Math.max(24, Math.floor(availableHeight / charHeight) - 2)

              // 调整终端大小
              term.resize(newCols, newRows)
              
              // 通知服务器新的终端大小
              if (socket && isTerminalReady.value) {
                socket.emit('resize', { 
                  session_id: props.sessionId, 
                  cols: newCols, 
                  rows: newRows,
                  isTop: true
                })
              }
            })
          } 
          // 检测是否退出 top 界面（按 q 键退出或 Ctrl+C）
          else if (isInEditorMode.value && (
            /\[.*?@.*?\s+.*?\][$#>]\s*$/.test(text) || // 检测命令提示符
            text.includes('^C') || // 检测 Ctrl+C
            text.includes('Terminated') // 检测终止信息
          )) {
            isInEditorMode.value = false
            // 退出 top 界面时恢复正常终端大小
            nextTick(() => {
              handleResize()
            })
          }

          // 原有的编辑器模式检测逻辑
          if (text.includes('\u001b[?1049h') || // vim 进入全屏模式
              text.includes('\u001b[?47h') ||   // 备用全屏模式
              text.includes('GNU nano') ||       // nano 编辑器
              text.includes('-- INSERT --')) {   // vim 插入模式
            isInEditorMode.value = true
            
            // 编辑器模式下立即重新计算并调整终端大小
            nextTick(() => {
              const terminalElement = terminal.value
              const computedStyle = window.getComputedStyle(terminalElement)
              const padding = parseInt(computedStyle.padding || '0')
              
              // 计算可用空间
              const availableWidth = terminalElement.clientWidth - 2 * padding
              const availableHeight = terminalElement.clientHeight - 2 * padding

              // 使用更精确的字符尺寸计算
              const span = document.createElement('span')
              span.style.fontFamily = term.options.fontFamily
              span.style.fontSize = `${term.options.fontSize}px`
              span.style.position = 'absolute'
              span.style.visibility = 'hidden'
              span.textContent = 'X'
              document.body.appendChild(span)

              const charSize = span.getBoundingClientRect()
              const charWidth = charSize.width
              const charHeight = charSize.height
              document.body.removeChild(span)

              // 计算新的列数和行数，考虑编辑器边框和状态栏
              const newCols = Math.max(80, Math.floor(availableWidth / charWidth))
              // 为状态栏和边框预留空间
              const newRows = Math.max(24, Math.floor(availableHeight / charHeight) - 2)

              // 调整终端大小
              term.resize(newCols, newRows)
              
              // 通知服务器新的终端大小
              if (socket && isTerminalReady.value) {
                socket.emit('resize', { 
                  session_id: props.sessionId, 
                  cols: newCols, 
                  rows: newRows,
                  isEditor: true // 标记这是编辑器模式的调整
                })
              }
            })

            // 在编辑器模式下直接写入内容，不做处理
            term.write(text)
            return
          } 
          // 检测是否退出编辑器模式
          else if (isInEditorMode.value && (
            text.includes('\u001b[?1049l') || // vim 退出全屏模式
            text.includes('\u001b[?47l') ||    // 备用全屏模式退出
            /\[.*?@.*?\s+.*?\][$#>]\s*$/.test(text) || // 命令提示符
            text.includes('-- NORMAL --'))) {    // vim 普通模式
            isInEditorMode.value = false
            // 退出编辑器模式时恢复正常终端大���
            nextTick(() => {
              handleResize()
            })
          }

          // 如果在编辑器模式下，直接写入内容
          if (isInEditorMode.value) {
            term.write(text)
            return
          }

          const lines = text.split('\n')
          lines.forEach((line, index) => {
            const isPrompt = /^\[.*?@.*?\s+.*?\][$#>]\s*$/.test(line)
            
            if (isPrompt) {
              // 处理提示符高亮...
              const parts = line.match(/^\[(.*?)@(.*?)\s+(.*?)\]([$#>])\s*$/)
              if (parts) {
                term.write('\x1b[1;32m[' + parts[1])
                term.write('\x1b[1;37m@')
                term.write('\x1b[1;34m' + parts[2])
                term.write('\x1b[1;34m ' + parts[3])
                term.write('\x1b[1;37m]' + parts[4])
                term.write('\x1b[0m')
              } else {
                term.write(line)
              }
            } else {
              // 处理正则和字符串匹配的高亮
              const matches = processLine(line)
              let lastIndex = 0
              
              if (matches.length === 0) {
                // 如果没有匹配，直接写入整行
                term.write(line)
              } else {
                matches.forEach(match => {
                  if (match.start > lastIndex) {
                    term.write(line.substring(lastIndex, match.start))
                  }
                  term.write(match.color + match.text + '\x1b[0m')
                  lastIndex = match.end
                })
                
                if (lastIndex < line.length) {
                  term.write(line.substring(lastIndex))
                }
              }
            }

            if (index < lines.length - 1) {
              term.write('\r\n')
            }
          })

          detectPathChange(text)

          // 在写入完成后安全滚动
          nextTick(() => {
            safeScrollToBottom()
          })

        } catch (error) {
          console.error('Error writing to terminal:', error)
          if (!term || term.disposed) {
            cleanup()
            initializeTerminal()
          }
        }
      } else {
        outputBuffer.value.push(text)
      }
    }

    const handleContextMenu = (event) => {
      event.preventDefault()
      if (!contextMenu.value) {
        contextMenu.value = document.createElement('div')
        contextMenu.value.className = 'terminal-context-menu'
        document.body.appendChild(contextMenu.value)
      }

      const hasSelection = term && term.hasSelection()
      
      contextMenu.value.innerHTML = `
        <div class="menu-item ${hasSelection ? '' : 'disabled'}" data-action="copy">
          Copy
        </div>
        <div class="menu-item" data-action="paste">
          Paste
        </div>
      `

      contextMenu.value.style.visibility = 'hidden'
      contextMenu.value.style.display = 'block'

      const menuRect = contextMenu.value.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let left = event.pageX
      let top = event.pageY

      if (left + menuRect.width > viewportWidth) {
        left = viewportWidth - menuRect.width - 5
      }

      if (top + menuRect.height > viewportHeight) {
        top = viewportHeight - menuRect.height - 5
      }

      left = Math.max(5, left)
      top = Math.max(5, top)

      contextMenu.value.style.left = `${left}px`
      contextMenu.value.style.top = `${top}px`
      contextMenu.value.style.visibility = 'visible'

      contextMenu.value.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', handleMenuClick)
      })
    }

    const handleMenuClick = (event) => {
      const action = event.target.dataset.action
      if (action === 'copy' && term && term.hasSelection()) {
        handleCopy()
      } else if (action === 'paste') {
        navigator.clipboard.readText().then(text => {
          if (term && isTerminalReady.value) {
            socket.emit('ssh_input', { session_id: props.sessionId, input: text })
          }
        })
      }
      hideContextMenu()
    }

    const hideContextMenu = () => {
      if (contextMenu.value) {
        contextMenu.value.style.display = 'none'
      }
    }

    // 添加一个颜色转换函数
    const hexToAnsi256 = (hex) => {
      // 移除 # 号
      hex = hex.replace('#', '')
      
      // 将hex转换为RGB
      const r = parseInt(hex.substr(0, 2), 16)
      const g = parseInt(hex.substr(2, 2), 16)
      const b = parseInt(hex.substr(4, 2), 16)
      
      // 计算最接近的ANSI 256色值
      if (r === g && g === b) {
        if (r < 8) return 16
        if (r > 248) return 231
        return Math.round(((r - 8) / 247) * 24) + 232
      }

      const ansi = 16 +
        (36 * Math.round(r / 255 * 5)) +
        (6 * Math.round(g / 255 * 5)) +
        Math.round(b / 255 * 5)
        
      return ansi
    }

    const loadHighlightPatterns = async () => {
      try {
        const highlightPath = path.join(process.cwd(), 'highlight.list')
        console.log('Loading highlight patterns from:', highlightPath)
        const content = await fs.promises.readFile(highlightPath, 'utf-8')
        
        let currentSection = ''
        const patterns = {
          regex: {},
          string: {}
        }
        
        // Parse highlight.list file
        content.split('\n').forEach(line => {
          line = line.trim()
          if (!line || line.startsWith('#')) return
          
          // Check for section headers
          if (line === '[Regex]') {
            currentSection = 'regex'
            console.log('Processing Regex section')
            return
          }
          if (line === '[String]') {
            currentSection = 'string'
            console.log('Processing String section')
            return
          }
          
          // Parse patterns based on current section
          const [name, pattern, color] = line.split('=')
          if (name && pattern && color) {
            const ansiColor = hexToAnsi256(color.trim())
            const colorCode = `\x1b[38;5;${ansiColor}m`
            
            if (currentSection === 'regex') {
              try {
                patterns.regex[name.trim()] = {
                  pattern: new RegExp(pattern.trim(), 'g'),
                  color: colorCode
                }
                console.log(`Added regex pattern: ${name.trim()}`)
              } catch (error) {
                console.error(`Failed to compile regex pattern for ${name}:`, error)
              }
            } else if (currentSection === 'string') {
              patterns.string[name.trim()] = {
                keywords: pattern.trim().split(','),
                color: colorCode
              }
              console.log(`Added string pattern: ${name.trim()}`)
            }
          }
        })
        
        regexPatterns.value = patterns
        console.log('Loaded highlight patterns:', patterns)
      } catch (error) {
        console.error('Error loading highlight patterns:', error)
      }
    }

    const getHistoryPath = () => {
      const isProd = process.env.NODE_ENV === 'production'
      const basePath = isProd 
        ? join(process.resourcesPath, '..')
        : join(process.cwd(), 'backend')
      
      return fsPromises.mkdir(basePath, { recursive: true })
        .then(() => join(basePath, 'command_history.mpack'))
    }

    const addToHistory = async (command) => {
      if (!command || typeof command !== 'string') {
        console.warn('Invalid command input')
        return
      }

      // 检查是否有回显
      const hasEcho = checkCommandEcho(command)
      if (!hasEcho) {
        // 如果没有回显(如密��输入),则不记录
        console.log('Command has no echo, skipping history record')
        return
      }

      try {
        let history = []
        const historyPath = await getHistoryPath()
        
        try {
          const data = await fsPromises.readFile(historyPath)
          history = msgpack.decode(data)
          // 确保历史记录是数组
          if (!Array.isArray(history)) {
            history = []
          }
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error('Error reading history:', error)
          }
        }
        
        // 检查是否存在重复命令
        if (!history.includes(command)) {
          history.unshift(command)
          
          // 限制历史记录数量
          const maxHistoryItems = 50000 // 最大历史记录条数
          if (history.length > maxHistoryItems) {
            history = history.slice(0, maxHistoryItems)
          }

          // 计算编码后的数据大小
          const encoded = msgpack.encode(history)
          const maxFileSize = 10 * 1024 * 1024 // 10MB 限制
          
          if (encoded.length > maxFileSize) {
            // 如果超过大小限制，删除旧的记录直到满足大小要求
            while (history.length > 0) {
              history.pop() // 移除最旧的记录
              const newEncoded = msgpack.encode(history)
              if (newEncoded.length <= maxFileSize) {
                break
              }
            }
          }
          
          // 保存历史记录
          await fsPromises.writeFile(historyPath, msgpack.encode(history))
          
          // 更新内存中的历史记录
          commandHistory.value = history
        }
      } catch (error) {
        console.error('Error saving command history:', error)
      }
    }

    const loadHistory = async () => {
      try {
        const historyPath = await getHistoryPath()
        
        try {
          const data = await fsPromises.readFile(historyPath)
          const decoded = msgpack.decode(data)
          
          // 验证数据格式
          if (!Array.isArray(decoded)) {
            console.warn('Invalid history data format')
            commandHistory.value = []
            return
          }
          
          // 限制加载的历史记录量
          const maxHistoryItems = 50000
          commandHistory.value = decoded.slice(0, maxHistoryItems)
          
        } catch (error) {
          if (error.code !== 'ENOENT') {
            console.error('Error reading command history:', error)
          }
          commandHistory.value = []
        }
      } catch (error) {
        console.error('Error loading command history:', error)
        commandHistory.value = []
      }
    }

    const showSuggestionMenu = () => {
      // 如果在编辑器模式下，不显示建议菜单
      if (isInEditorMode.value) {
        return
      }

      if (!commandHistory.value || !currentInput.value) {
        console.warn('Command history or current input not initialized')
        return
      }

      if (!suggestionMenu.value) {
        suggestionMenu.value = document.createElement('div')
        suggestionMenu.value.className = 'command-suggestions'
        terminal.value.appendChild(suggestionMenu.value)
      }

      // 过滤命令并限制数量
      const filteredCommands = commandHistory.value
        .filter(cmd => {
          return cmd && typeof cmd === 'string' && 
                 currentInput.value && typeof currentInput.value === 'string' &&
                 cmd.toLowerCase().startsWith(currentInput.value.toLowerCase())
        })
        .slice(0, 20)

      suggestions.value = filteredCommands
      
      if (suggestions.value && suggestions.value.length > 0) {
        suggestionMenu.value.innerHTML = suggestions.value
          .map((cmd, index) => `
            <div class="suggestion-item ${index === selectedSuggestionIndex.value ? 'selected' : ''}"
                 data-index="${index}">
              ${cmd}
            </div>
          `)
          .join('')
        
        // 添加点击事件监听
        suggestionMenu.value.querySelectorAll('.suggestion-item').forEach(item => {
          item.addEventListener('click', handleSuggestionClick)
        })
        
        showSuggestions.value = true
        suggestionMenu.value.classList.add('visible')
        
        nextTick(() => {
          positionSuggestionMenu()
        })
      } else {
        hideSuggestionMenu()
      }
    }

    const positionSuggestionMenu = () => {
      if (!term || !suggestionMenu.value) return
      
      // 获取终端容器的位置和大小
      const terminalRect = terminal.value.getBoundingClientRect()
      const suggestionRect = suggestionMenu.value.getBoundingClientRect()
      
      // 获取当前光标位置
      const cursorElement = terminal.value.querySelector('.xterm-cursor')
      let cursorRect = cursorElement ? cursorElement.getBoundingClientRect() : null
      
      // 如果找不到光标，使用默认位置
      if (!cursorRect) {
        suggestionMenu.value.style.left = '10px'
        suggestionMenu.value.style.bottom = '40px'
        return
      }
      
      // 计算建议菜单的位置
      let left = cursorRect.left - terminalRect.left
      let bottom = terminalRect.bottom - cursorRect.bottom + 5
      
      // 确保菜单不会超出终端边界
      if (left + suggestionRect.width > terminalRect.width - 10) {
        left = terminalRect.width - suggestionRect.width - 10
      }
      if (left < 10) left = 10
      
      if (bottom < 10) bottom = 10
      if (bottom + suggestionRect.height > terminalRect.height - 10) {
        bottom = terminalRect.height - suggestionRect.height - 10
      }
      
      // 设置菜单位置
      suggestionMenu.value.style.left = `${left}px`
      suggestionMenu.value.style.bottom = `${bottom}px`
      
      // 确保菜单在视图内
      if (suggestionMenu.value.offsetTop < 0) {
        suggestionMenu.value.style.top = '10px'
        suggestionMenu.value.style.bottom = 'auto'
      }
    }

    const hideSuggestionMenu = () => {
      showSuggestions.value = false
      selectedSuggestionIndex.value = -1
      if (suggestionMenu.value) {
        suggestionMenu.value.classList.remove('visible')
      }
    }

    const getCPUClass = computed(() => {
      if (cpuUsage.value >= 90) return 'critical'
      if (cpuUsage.value >= 70) return 'warning'
      return 'normal'
    })

    const getMemClass = computed(() => {
      if (memUsage.value >= 90) return 'critical'
      if (memUsage.value >= 70) return 'warning'
      return 'normal'
    })

    const updateResourceUsage = () => {
      if (!socket || !isTerminalReady.value) return
      
      console.log('Requesting resource usage update...')
      socket.emit('monitor_resources', { 
        session_id: props.sessionId
      })
    }

    const startResourceMonitoring = () => {
      console.log('Starting resource monitoring...')
      resourceMonitorInterval = setInterval(() => {
        console.log('Resource monitoring interval triggered')
        updateResourceUsage()
      }, 30000)
    }

    const stopResourceMonitoring = () => {
      console.log('Stopping resource monitoring...')
      if (resourceMonitorInterval) {
        clearInterval(resourceMonitorInterval)
        resourceMonitorInterval = null
      }
    }

    const debouncedResize = _debounce(handleResize, 100)

    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      try {
        const styles = `
          .command-suggestions {
            position: absolute;
            background-color: rgba(var(--color-bg-2-rgb), 0.8);
            backdrop-filter: blur(4px);
            border: 1px solid var(--color-border);
            border-radius: 4px;
            padding: 4px 0;
            min-width: 200px;
            max-width: 400px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            z-index: 9999;
            max-height: 128px;
            overflow-y: auto;
            pointer-events: auto;
            user-select: none;
            opacity: 1;
            transition: opacity 0.1s ease;
            box-sizing: border-box;
            word-break: break-all;
            white-space: normal;
            transform-origin: bottom left;
          }

          :deep(.xterm-rows) {
            position: absolute;
            left: 0;
            top: 0;
            right: 0;
            bottom: 0;
            overflow: hidden;
          }

          .terminal-container {
            position: relative;
          }
        `

        const styleSheet = document.createElement('style')
        styleSheet.textContent = styles
        document.head.appendChild(styleSheet)

        await loadHighlightPatterns()
        await initializeSocket()
        await initializeTerminal()
        
        terminal.value.addEventListener('contextmenu', handleContextMenu)
        document.addEventListener('click', hideContextMenu)
        loadHistory()
        startResourceMonitoring()

        const monitor = document.querySelector('.resource-monitor')
        if (monitor) {
          monitor.addEventListener('mouseenter', () => {
            showValues.value = true;
          })
          monitor.addEventListener('mouseleave', () => {
            showValues.value = false;
          })
        }

        window.addEventListener('resize', debouncedResize)

        // 添加鼠标中键粘贴事件
        terminal.value.addEventListener('mousedown', handleMouseDown)
        
        startResizeInterval() // 启动定时resize
      } catch (error) {
        console.error('Error mounting SSHTerminal:', error)
      }
    })

    const closeConnection = () => {
      cleanup()
      emit('close', props.sessionId)
    }

    onUnmounted(() => {
      cleanup()
      window.removeEventListener('resize', debouncedResize)
      
      terminal.value?.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('click', hideContextMenu)
      if (contextMenu.value) {
        document.body.removeChild(contextMenu.value)
      }
      stopResourceMonitoring()

      const monitor = document.querySelector('.resource-monitor')
      if (monitor) {
        monitor.removeEventListener('mouseenter', () => {
          showValues.value = true;
        })
        monitor.removeEventListener('mouseleave', () => {
          showValues.value = false;
        })
      }

      // 移除鼠标中键事监听
      terminal.value?.removeEventListener('mousedown', handleMouseDown)
      
      if (resizeInterval.value) {
        clearInterval(resizeInterval.value)
        resizeInterval.value = null
      }
    })

    watch(() => isDarkMode.value, (newValue) => {
      setTheme(newValue ? 'dark' : 'light')
    })

    const cleanup = () => {
      stopResourceMonitoring()
      if (socket) {
        socket.emit('close_ssh', { session_id: props.sessionId })
        socket.disconnect()
        socket = null
      }
      if (term) {
        term.dispose()
        term = null
      }
      if (fitAddon) {
        fitAddon.dispose()
        fitAddon = null
      }
      isTerminalReady.value = false
      
      // 清理建议菜单
      if (suggestionMenu.value) {
        suggestionMenu.value.querySelectorAll('.suggestion-item').forEach(item => {
          item.removeEventListener('click', handleSuggestionClick)
        })
        if (suggestionMenu.value.parentNode) {
          suggestionMenu.value.parentNode.removeChild(suggestionMenu.value)
        }
        suggestionMenu.value = null
      }
    }

    const handleSpecialKeys = (event) => {
      if (!term || !isTerminalReady.value) return true

      // 处理 ALT+F4 关闭程序
      if (event.altKey && event.key === 'F4') {
        const { app } = require('@electron/remote')
        app.quit()
        return false
      }

      const hasSuggestions = Array.isArray(suggestions.value) && suggestions.value.length > 0
      
      // 添加搜索快捷键 Ctrl+F 的切换逻辑
      if (event.ctrlKey && event.key === 'f') {
        event.preventDefault()
        
        if (showSearchBar.value) {
          closeSearchBar()
        } else {
          openSearchBar()
        }
        
        return false
      }

      // 原有的建议菜单处理逻辑
      if (showSuggestions.value && hasSuggestions) {
        if (event.key === 'Escape') {
          event.preventDefault()
          hideSuggestionMenu()
          return false
        }
        
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          
          if (event.key === 'ArrowUp') {
            // 如果没有选中项或在第一项，则移动到最后一项
            if (selectedSuggestionIndex.value <= 0) {
              selectedSuggestionIndex.value = suggestions.value.length - 1
            } else {
              selectedSuggestionIndex.value--
            }
          } else { // ArrowDown
            // 如果没有选中项，选择第一项
            if (selectedSuggestionIndex.value === -1) {
              selectedSuggestionIndex.value = 0
            } 
            // 如果在最后一项，循环到第一项
            else if (selectedSuggestionIndex.value >= suggestions.value.length - 1) {
              selectedSuggestionIndex.value = 0
            } else {
              selectedSuggestionIndex.value++
            }
          }
          
          // 更新高亮显示并滚动到选中项
          if (suggestionMenu.value) {
            const items = suggestionMenu.value.querySelectorAll('.suggestion-item')
            items.forEach((item, index) => {
              if (index === selectedSuggestionIndex.value) {
                item.classList.add('selected')
                // 确保选中项可见
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
              } else {
                item.classList.remove('selected')
              }
            })
          }
          return false
        }

        if (event.key === 'Enter') {
          event.preventDefault()
          // 如果有选中的建议，填充命令但不执行
          if (selectedSuggestionIndex.value >= 0 && selectedSuggestionIndex.value < suggestions.value.length) {
            const selectedCommand = suggestions.value[selectedSuggestionIndex.value]
            if (selectedCommand) {
              // 清除当前输入
              const backspaces = '\b'.repeat(currentInput.value.length)
              // 填充新命令
              socket.emit('ssh_input', { 
                session_id: props.sessionId, 
                input: backspaces + selectedCommand
              })
              currentInput.value = selectedCommand
              hideSuggestionMenu()
              return false // 阻止事件继续传播
            }
          }
          // 如果没有选中的建议，关闭提示窗口
          hideSuggestionMenu()
          return true //  Enter 事件继续传播
        }
      }
      
      // 处理方向键
      if (event.key.startsWith('Arrow')) {
        const key = event.key.toLowerCase()
        
        // 定义不同模式下的按键序列
        const sequences = {
          // 普通终端模式
          normal: {
            arrowup: '\x1b[A',
            arrowdown: '\x1b[B',
            arrowright: '\x1b[C',
            arrowleft: '\x1b[D'
          },
          // vim 插入模式
          vimInsert: {
            arrowup: '\x1bOA',
            arrowdown: '\x1bOB',
            arrowright: '\x1bOC',
            arrowleft: '\x1bOD'
          }
        }

        if (sequences.normal[key]) {
          // 如果命令提示窗口显示但没有建议，先关闭它
          if (showSuggestions.value) {
            hideSuggestionMenu()
          }

          // 根据当前状态选择合适的序列
          let sequence
          if (isInEditorMode.value) {
            // 检测是否在 vim 插入模式
            const isVimInsertMode = term.buffer.active.getLine(term.buffer.active.length - 1)?.translateToString().includes('-- INSERT --')
            sequence = isVimInsertMode ? sequences.vimInsert[key] : sequences.normal[key]
          } else {
            sequence = sequences.normal[key]
          }

          // 发送单个序列
          if (sequence) {
            socket.emit('ssh_input', { 
              session_id: props.sessionId, 
              input: sequence 
            })
          }

          return false
        }
      }

      return true
    }

    const reconnect = async () => {
      try {
        // 清理现有连接
        cleanup()
        
        // 重新初始化连接
        await initializeSocket()
        await initializeTerminal()
        
        Message.success('Connection refreshed successfully')
      } catch (error) {
        console.error('Failed to refresh connection:', error)
        Message.error('Failed to refresh connection')
      }
    }

    const processLine = (line) => {
      let matches = []
      
      // 如果regexPatterns.value未初始化，直接返回空数组
      if (!regexPatterns.value || (!regexPatterns.value.regex && !regexPatterns.value.string)) {
        console.log('No highlight patterns loaded')
        return matches
      }

      try {
        // Process regex patterns
        if (regexPatterns.value.regex) {
          console.log('Processing regex patterns:', Object.keys(regexPatterns.value.regex))
          for (const [name, config] of Object.entries(regexPatterns.value.regex)) {
            const { pattern, color } = config
            if (!pattern || !color) continue
            
            try {
              pattern.lastIndex = 0 // Reset regex state
              let match
              while ((match = pattern.exec(line)) !== null) {
                console.log(`Regex match found for ${name}:`, match[0])
                matches.push({
                  start: match.index,
                  end: match.index + match[0].length,
                  text: match[0],
                  color: color,
                  type: 'regex'
                })
              }
            } catch (error) {
              console.error(`Error processing regex pattern ${name}:`, error)
            }
          }
        }
        
        // Process string patterns
        if (regexPatterns.value.string) {
          console.log('Processing string patterns:', Object.keys(regexPatterns.value.string))
          for (const [name, config] of Object.entries(regexPatterns.value.string)) {
            const { keywords, color } = config
            if (!keywords || !color) continue
            
            keywords.forEach(keyword => {
              if (!keyword) return
              let index = line.indexOf(keyword)
              while (index !== -1) {
                console.log(`String match found for ${name}:`, keyword)
                matches.push({
                  start: index,
                  end: index + keyword.length,
                  text: keyword,
                  color: color,
                  type: 'string'
                })
                index = line.indexOf(keyword, index + 1)
              }
            })
          }
        }
        
        // Sort matches by start position and handle overlaps
        matches.sort((a, b) => a.start - b.start)
        matches = matches.reduce((acc, curr) => {
          if (acc.length === 0) {
            acc.push(curr)
            return acc
          }

          const last = acc[acc.length - 1]
          if (curr.start <= last.end) {
            // If overlapping, keep the longer match
            if (curr.end > last.end) {
              last.end = curr.end
              last.text = line.substring(last.start, curr.end)
            }
          } else {
            acc.push(curr)
          }
          return acc
        }, [])

        console.log('Final matches:', matches)

      } catch (error) {
        console.error('Error processing line:', error)
        return []
      }

      return matches
    }

    const handleSuggestionClick = (event) => {
      const item = event.target.closest('.suggestion-item')
      if (item) {
        const index = parseInt(item.dataset.index)
        if (!isNaN(index) && index >= 0 && index < suggestions.value.length) {
          const selectedCommand = suggestions.value[index]
          // 清除��前输入并填充选中的命令
          const backspaces = '\b'.repeat(currentInput.value.length)
          socket.emit('ssh_input', { 
            session_id: props.sessionId, 
            input: backspaces + selectedCommand
          })
          currentInput.value = selectedCommand
          hideSuggestionMenu()
        }
      }
    }

    const handleMouseEnter = () => {
      showValues.value = true;
    };

    const handleMouseLeave = () => {
      showValues.value = false;
    };

    // 添加鼠标中键处理函数
    const handleMouseDown = (event) => {
      // 检查是否是鼠标中键（button 1）
      if (event.button === 1 && term && isTerminalReady.value) {
        event.preventDefault()
        navigator.clipboard.readText().then(text => {
          if (text) {
            socket.emit('ssh_input', { 
              session_id: props.sessionId, 
              input: text 
            })
          }
        }).catch(err => {
          console.error('Failed to read clipboard:', err)
          Message.error('Failed to paste text')
        })
      }
    }

    // 打开搜索栏
    const openSearchBar = () => {
      showSearchBar.value = true
      searchText.value = '' // 清空上一次的搜索内容
      
      // 使用 findNext 并传递空字符串来清除之前的搜索结果
      if (searchAddon && term) {
        searchAddon.findNext('', {
          caseSensitive: false,
          wholeWord: false,
          regex: false
        })
      }
      
      nextTick(() => {
        const searchInput = document.getElementById('terminal-search-input')
        searchInput?.focus()
      })
    }

    // 关闭搜索栏
    const closeSearchBar = () => {
      showSearchBar.value = false
      searchText.value = ''
      
      // 使用 findNext 并传递空字符串来清除之前的搜索结果
      if (searchAddon && term) {
        searchAddon.findNext('', {
          caseSensitive: false,
          wholeWord: false,
          regex: false
        })
      }
    }

    // 执行搜索
    const performSearch = () => {
      if (!searchAddon || !term || !searchText.value) return

      searchAddon.findNext(searchText.value, {
        caseSensitive: searchOptions.value.caseSensitive,
        wholeWord: searchOptions.value.wholeWord,
        regex: false // 取消正则表达式匹配
      })
    }

    // 查找上一个匹配项
    const findPrevious = () => {
      if (!searchAddon || !term || !searchText.value) return

      searchAddon.findPrevious(searchText.value, {
        caseSensitive: searchOptions.value.caseSensitive,
        wholeWord: searchOptions.value.wholeWord,
        regex: false // 取消正则表达式匹配
      })
    }

    // 查找一个匹配项
    const findNext = () => {
      performSearch()
    }

    const isResourceMonitorCollapsed = ref(false)
    
    const toggleResourceMonitor = () => {
      isResourceMonitorCollapsed.value = !isResourceMonitorCollapsed.value
    }

    // 从 Vue 实例中获取 $t 方法
    const t = getCurrentInstance()?.proxy?.$t || ((key) => key)

    // 监听 active 变化
    watch(() => props.active, (newActive) => {
      if (newActive) {
        // 标签页激活时重新适配大小
        nextTick(() => {
          manualResize();
        });
      }
    });

    // 修改检查命令回显的函数
    const checkCommandEcho = (command) => {
      if (!term || !term.buffer) {
        return false
      }

      try {
        // 获取当前行的内容
        const currentLine = term.buffer.active.getLine(term.buffer.active.cursorY)
        if (!currentLine) {
          return false
        }

        // 获取当前行的文本内容
        const lineContent = currentLine.translateToString()

        // 检查是否是密码输入
        const isPasswordPrompt = /password.*:|密码.*:|passphrase.*:/i.test(lineContent)
        if (isPasswordPrompt) {
          return false
        }

        // 获取最近的几行内容来检查命令回显
        const lineCount = term.buffer.active.length
        const startLine = Math.max(0, term.buffer.active.cursorY - 3)
        const endLine = term.buffer.active.cursorY
        
        let recentLines = []
        for (let i = startLine; i <= endLine; i++) {
          const line = term.buffer.active.getLine(i)
          if (line) {
            recentLines.push(line.translateToString())
          }
        }
        
        // 将最近几行合并成一个字符串
        const recentContent = recentLines.join('\n')

        // 检查是否包含命令本身
        // 1. 移除ANSI转义序列以进行纯文本比较
        const cleanContent = recentContent.replace(/\x1b\[[0-9;]*[mGKH]/g, '')
        const cleanCommand = command.trim()

        // 2. 检查命令是否出现在最近的输出中
        const hasCommand = cleanContent.includes(cleanCommand)

        // 3. 检查是否有命令提示符
        const hasPrompt = /\[.*?@.*?\s+.*?\][$#>]\s*/.test(cleanContent)

        // 如果找到提示符和命令，说明这是一个正常的命令输入
        return hasPrompt || hasCommand

      } catch (error) {
        console.error('Error checking command echo:', error)
        return false
      }
    }

    return { 
      terminal,
      closeConnection,
      handlePaste,
      setTheme,
      isDarkMode,
      manualResize,
      currentPath,
      reconnect,
      cpuUsage,
      memUsage,
      showResourceMonitor,
      getCPUClass,
      getMemClass,
      showValues,
      showSearchBar,
      searchText,
      searchOptions,
      openSearchBar,
      closeSearchBar,
      performSearch,
      findPrevious,
      findNext,
      isResourceMonitorCollapsed,
      toggleResourceMonitor,
      t
    }
  }
}
</script>

<style scoped>
.terminal-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  margin: 0;
  padding: 0;
}

.terminal-container {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 0;
  margin: 0;
  box-sizing: border-box;
  overflow: hidden;
}

:deep(.xterm) {
  height: 100%;
  padding: 0;         /* 移除多余的内边距 */
}

:deep(.xterm-viewport) {
  overflow-y: auto !important;
  overflow-x: hidden !important;
  width: calc(100%) !important;
  scrollbar-width: thin;
  scrollbar-color: var(--color-text-4) transparent;
  padding-right: 4px;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 12px;
  height: 12px;
  background-color: transparent;
}

:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
  border-radius: 6px;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: var(--color-fill-3);
  border-radius: 4px;
  border: 3px solid transparent;
  background-clip: padding-box;
  min-height: 50px;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-fill-4);
}

/* 深色模式下的滚动条样式 */
.terminal-container.dark-mode :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: var(--color-fill-4);
}

.terminal-container.dark-mode :deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-fill-5);
}

/* Firefox 滚动条样式 */
@supports (scrollbar-color: auto) {
  :deep(.xterm-viewport) {
    scrollbar-width: thin;
    scrollbar-color: var(--color-fill-3) transparent;
  }
  
  .terminal-container.dark-mode :deep(.xterm-viewport) {
    scrollbar-color: var(--color-fill-4) transparent;
  }
}

:deep(.xterm-screen) {
  position: relative;
}
</style>

<style>
.terminal-context-menu {
  position: fixed;
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px 0;
  min-width: 120px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.terminal-context-menu .menu-item {
  padding: 6px 12px;
  cursor: pointer;
  user-select: none;
  color: var(--color-text-1);
}

.terminal-context-menu .menu-item:hover {
  background-color: var(--color-fill-2);
}

.terminal-context-menu .menu-item.disabled {
  color: var(--color-text-4);
  cursor: not-allowed;
}

.terminal-context-menu .menu-item.disabled:hover {
  background-color: transparent;
}

.command-suggestions {
  position: absolute;
  left: 10px;
  bottom: 40px;
  max-width: calc(100% - 20px);
  width: auto;
  min-width: 200px;
  max-height: 128px;
  box-sizing: border-box;
  margin: 0;
  padding: 4px 0;
  background-color: var(--color-bg-2);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  overflow: auto;
  z-index: 9999;
  display: none;
}

.command-suggestions.visible {
  display: block;
}

.suggestion-item {
  padding: 4px 12px;
  height: 16px;
  line-height: 16px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-1);
  transition: background-color 0.2s;
}

.suggestion-item:hover,
.suggestion-item.selected {
  background-color: var(--color-fill-2);
}

/* 深色模式下的建议菜单样式 */
.terminal-container.dark-mode .command-suggestions {
  background-color: var(--dark-bg-color);
  border-color: var(--dark-border-color);
}

.suggestion-item.selected {
  background-color: var(--color-primary-light-2);
  color: var(--color-white);
  font-weight: 500;
}

.terminal-container.dark-mode .suggestion-item.selected {
  background-color: var(--color-primary-light-2);
  color: var(--color-white);
}

.suggestion-item:hover:not(.selected) {
  background-color: var(--color-fill-2);
}

.terminal-container.dark-mode .suggestion-item:hover:not(.selected) {
  background-color: var(--color-fill-3);
}

.suggestion-item.selected::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background-color: var(--color-primary-light-3);
  border-radius: 0 2px 2px 0;
}

.terminal-container.dark-mode .suggestion-item.selected::before {
  background-color: var(--color-primary-light-3);
}

.resource-monitor {
  position: absolute;
  bottom: 10px;
  right: 10px;
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: all 0.3s ease;
  cursor: pointer;
  z-index: 1000;
  opacity: 0.9;
  backdrop-filter: blur(4px);
}

.resource-monitor.collapsed {
  width: 30px;
  min-width: 30px;
}

.monitor-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  transition: opacity 0.3s ease;
}

.resource-monitor.collapsed .monitor-content {
  opacity: 0;
  width: 0;
  padding: 0;
  overflow: hidden;
}

.monitor-collapse-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 100%;
  background-color: var(--color-fill-2);
}

.monitor-collapse-indicator .arco-icon {
  color: var(--color-text-2);
}

.monitor-item {
  display: flex;
  align-items: center;
  gap: 6px;
  position: relative;
  height: 16px;
}

.monitor-item .label {
  color: var(--color-text-2);
  width: 28px;
  text-align: right;
  font-size: 11px;
  flex-shrink: 0;
}

.progress-bar {
  flex: 1;
  height: 4px;
  background-color: var(--color-fill-2);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
  min-width: 60px;
}

.value {
  position: absolute;
  right: -4px;
  font-size: 10px;
  color: var(--color-text-2);
  min-width: 36px;
  text-align: right;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
  transform: translateY(-50%);
  top: 50%;
  pointer-events: none;
}

.resource-monitor:hover .value {
  opacity: 1;
  transform: translateY(-50%) translateX(-8px);
}

/* CPU进度条样式 */
.cpu-progress {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 2px;
}

.cpu-progress.normal {
  background-color: var(--color-success-light-4);
}

.cpu-progress.warning {
  background-color: var(--color-warning-light-4);
}

.cpu-progress.critical {
  background-color: var(--color-danger-light-4);
}

/* MEM进度条样式 */
.mem-progress {
  height: 100%;
  transition: width 0.3s ease;
  border-radius: 2px;
  background-color: var(--color-primary-light-4);
}

/* 深色主题调整 */
.terminal-container.dark-mode .cpu-progress.normal {
  background-color: var(--color-success-light-3);
}

.terminal-container.dark-mode .cpu-progress.warning {
  background-color: var(--color-warning-light-3);
}

.terminal-container.dark-mode .cpu-progress.critical {
  background-color: var(--color-danger-light-3);
}

.terminal-container.dark-mode .mem-progress {
  background-color: var(--color-primary-light-3);
}

.terminal-container.dark-mode .resource-monitor {
  background-color: rgba(0, 0, 0, 0.7);
  border-color: var(--color-border-2);
}

/* 优化进度条动画效果 */
.progress::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.1) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  transform: translateX(-100%);
  animation: shimmer 2s infinite;
}

@keyframes shimmer {
  100% {
    transform: translateX(100%);
  }
}

.terminal-search-bar-top-right {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 2000;
  width: 280px; /* 压缩窗口大小 */
  background-color: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  padding: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  gap: 8px;
  user-select: none;
}

.terminal-container.dark-mode .terminal-search-bar-top-right {
  background-color: var(--color-bg-3);
  border-color: var(--color-border-2);
}

.search-bar-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
}

.search-navigation {
  display: flex;
  align-items: center;
  gap: 4px;
}

.nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
}

.search-options {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  user-select: none;
}

.search-options .arco-checkbox {
  user-select: none;
}

/* 响应式调整 */
@media (max-width: 480px) {
  .terminal-search-bar-top-right {
    width: 250px;
    right: 5px;
    top: 5px;
  }

  .search-options {
    gap: 6px;
  }
}

/* 优化悬停效果 */
.resource-monitor {
  transition: all 0.3s ease, background-color 0.2s ease;
}

.resource-monitor:hover {
  background-color: var(--color-bg-3);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* 深色模式下的悬停效果 */
.terminal-container.dark-mode .resource-monitor:hover {
  background-color: var(--color-bg-4);
}
</style>