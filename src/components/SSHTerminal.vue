<template>
  <div class="terminal-wrapper">
    <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }" @paste.prevent="handlePaste"></div>
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
              initializeTerminal().then(() => {
                // 确保终端完全初始化后调整大小
                nextTick(() => {
                  if (fitAddon) {
                    fitAddon.fit()
                  }
                  
                  // 发送精确的终端大小
                  if (socket && term) {
                    socket.emit('resize', { 
                      session_id: props.sessionId, 
                      cols: term.cols, 
                      rows: term.rows 
                    })
                  }
                })
              })
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
        socket.emit('ssh_input', { session_id: props.sessionId, input: text })
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

    const calculateTerminalSize = () => {
      if (!terminal.value) return { cols: 80, rows: 24 }

      // 获取终端容器的实际尺寸（减去padding）
      const container = terminal.value
      const containerWidth = container.clientWidth - 20  // 减去左右padding各10px
      const containerHeight = container.clientHeight - 20 // 减去上下padding各10px

      // 使用更精确的字符尺寸计算
      const fontSize = props.fontSize
      const charWidth = fontSize * 0.6  // 更精确的字符宽度比例
      const charHeight = fontSize * 1.2 // 更精确的字符高度比例

      // 计算可容纳的列数和行数（向下取整以确保完整显示）
      const cols = Math.floor(containerWidth / charWidth)
      const rows = Math.floor(containerHeight / charHeight)

      // 调整最小值，确保旧版终端程序也能正常显示
      const minCols = 80
      const minRows = 24

      return {
        cols: Math.max(minCols, cols),
        rows: Math.max(minRows, rows)
      }
    }

    const initializeTerminal = async () => {
      await nextTick()
      if (!terminal.value) {
        console.error('Terminal element not found')
        return
      }

      // 计算初始终端大小
      const { cols, rows } = calculateTerminalSize()

      term = new Terminal({
        cursorBlink: true,
        fontSize: props.fontSize,
        fontFamily: 'Consolas, "Courier New", monospace',
        copyOnSelect: false,
        theme: isDarkMode.value ? getDarkTheme() : getLightTheme(),
        allowTransparency: true,
        scrollback: 10000,
        convertEol: true,
        termName: 'xterm-256color',
        rendererType: 'canvas',
        allowProposedApi: true,
        cols: cols,
        rows: rows,
        windowsMode: false,
        windowsPty: false,
        smoothScrollDuration: 0,
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
        letterSpacing: 0, // 添加字符间距设置
        lineHeight: 1, // 添加行高设置
      })
      
      term.open(terminal.value)

      await new Promise(resolve => setTimeout(resolve, 0))

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)

      // 添加窗口大小变化监听器
      const resizeObserver = new ResizeObserver(() => {
        if (fitAddon && term) {
          const { cols, rows } = calculateTerminalSize()
          
          // 调整终端大小
          term.resize(cols, rows)
          
          // 发送终端大小调整事件
          if (socket && isTerminalReady.value) {
            socket.emit('resize', { 
              session_id: props.sessionId, 
              cols: cols, 
              rows: rows 
            })
          }
        }
      })

      // 监听终端容器的大小变化
      if (terminal.value) {
        resizeObserver.observe(terminal.value)
      }

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

      term.onData((data) => {
        if (!isTerminalReady.value || !socket) return

        const inEditor = isinEditor()

        if (inEditor) {
          socket.emit('ssh_input', { session_id: props.sessionId, input: data })
          return
        }

        socket.emit('ssh_input', { session_id: props.sessionId, input: data })
      })

      term.onLineFeed(() => {
        term.scrollToBottom()
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

    const handleResize = () => {
      if (fitAddon && term && isTerminalReady.value && socket) {
        // 添加短暂延迟以确保容器尺寸已更新
        setTimeout(() => {
          // 重新计算终端大小
          const { cols, rows } = calculateTerminalSize()
          
          // 调整终端大小
          term.resize(cols, rows)
          fitAddon.fit()
          
          // 发送终端大小到服务器
          socket.emit('resize', { 
            session_id: props.sessionId, 
            cols: cols, 
            rows: rows 
          })

          // 确保内容显示正确
          term.refresh(0, term.rows - 1)
          term.scrollToBottom()
        }, 50)
      }
    }

    const manualResize = () => {
      if (fitAddon && term) {
        nextTick(() => {
          fitAddon.fit()
          term.scrollToBottom()
          if (socket && isTerminalReady.value) {
            socket.emit('resize', { 
              session_id: props.sessionId, 
              cols: term.cols, 
              rows: term.rows 
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
          const lines = text.split('\n')
          
          lines.forEach((line, index) => {
            if (!line && index < lines.length - 1) {
              term.write('\r\n')
              return
            }

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
        await loadHighlightPatterns()
        await initializeSocket()
        await initializeTerminal()
        
        terminal.value.addEventListener('contextmenu', handleContextMenu)
        document.addEventListener('click', hideContextMenu)
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

      // 如果存在 ResizeObserver，确保取消监听
      if (resizeObserver) {
        resizeObserver.disconnect()
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
    }

    const isinEditor = () => {
      if (!term) return false

      try {
        // 获取终端的完整缓冲区内容
        const buffer = term.buffer.active
        const totalRows = buffer.length
        const visibleRows = term.rows

        // 获取当前行的文本
        const currentLine = buffer.getLine(buffer.cursorY)
        const currentLineText = currentLine ? currentLine.translateToString(true) : ''

        // 检查是否是命令提示符
        const promptPattern = /^.*?[$#>]\s*$/
        if (promptPattern.test(currentLineText)) {
          return false  // 如果是命令提示符，不是编辑器模式
        }

        // 检查最后几行的内容
        for (let i = Math.max(0, totalRows - visibleRows); i < totalRows; i++) {
          const line = buffer.getLine(i)
          if (!line) continue

          const lineText = line.translateToString(true)
          
          // 检查是否匹配编辑器特征
          const editorPatterns = [
            /^~+$/,  // vim 空行标识
            /^~.*?(?:\[New File\]|\[.+?\]).*?$/,  // vim 文件信息行
            /^:.*$/,  // vim 命令模式
            /^-- (INSERT|VISUAL|REPLACE|SELECT) --$/,  // vim 式提示
            /^[0-9]+ lines? (?:yanked|deleted|changed)$/,  // vim 操作提示
            /^".+" \d+L, \d+C written$/,  // vim 写入提示
            /^".+" \d+L, \d+C$/,  // vim 文件信息
            /^Press ENTER or type command to continue$/,  // vim 提示
            /^E\d+: /,  // vim 错误信息
            
            // Nano 编辑器特征
            /^GNU nano \d+\.\d+/,  // Nano 版本信息
            /^\s*\^G Get Help\s*\^O Write Out/,  // Nano 帮助行
            /^File: .+$/,  // Nano 文件名显示
            /^\[ .+ \]/,  // Nano 状态信息
            /^\s*\[ (line|col) \d+\]/,  // Nano 位置信息
          ]

          if (editorPatterns.some(pattern => pattern.test(lineText.trim()))) {
            return true
          }
        }

        // 检查当前行是否包含命令提示符特征
        const hasPromptCharacters = currentLineText.includes('$') || 
                                   currentLineText.includes('#') || 
                                   currentLineText.includes('>')

        // 如果当前行包含命令示符特征，则不是编辑器模式
        if (hasPromptCharacters) {
          return false
        }

        // 检查是否在编辑器中
        // 如果不包含命令提示符特征且不在最后一行，可能在编辑器中
        const isInEditor = !hasPromptCharacters && buffer.cursorY < buffer.length - 1

        return isInEditor
      } catch (error) {
        console.error('Error in isinEditor:', error)
        return false
      }
    }

    const handleSpecialKeys = (event) => {
      if (!term || !isTerminalReady.value) return true

      // 使用更可靠的 vim/编辑器检测
      const inEditor = isinEditor()

      // 如果在 vim 或编辑器中，直接返回true
      if (inEditor) {
        return true
      }

      // 添加搜索快捷键 Ctrl+F 的切换逻辑
      if (event.ctrlKey && event.key === 'f') {
        event.preventDefault()
        
        // 如果搜索栏已经打开，则关闭；否则打开
        if (showSearchBar.value) {
          closeSearchBar()
        } else {
          openSearchBar()
        }
        
        return false
      }

      // 处理方向键
      if (event.key.startsWith('Arrow')) {
        const key = event.key.toLowerCase()
        const sequences = {
          arrowup: '\x1b[A',
          arrowdown: '\x1b[B',
          arrowright: '\x1b[C',
          arrowleft: '\x1b[D'
        }
        if (sequences[key]) {
          socket.emit('ssh_input', { session_id: props.sessionId, input: sequences[key] })
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

    // 查找下一个匹配项
    const findNext = () => {
      performSearch()
    }

    const isResourceMonitorCollapsed = ref(false)
    
    const toggleResourceMonitor = () => {
      isResourceMonitorCollapsed.value = !isResourceMonitorCollapsed.value
    }

    // 从 Vue 实例中获取 $t 方法
    const t = getCurrentInstance()?.proxy?.$t || ((key) => key)

    // 在 setup 函数中添加对 fontSize prop 的监听
    watch(() => props.fontSize, (newSize) => {
      if (term) {
        term.options.fontSize = newSize
        // 调整终端大小以适应新的字号
        nextTick(() => {
          if (fitAddon) {
            fitAddon.fit()
            // 发送新的终端大小到服务器
            if (socket && isTerminalReady.value) {
              socket.emit('resize', { 
                session_id: props.sessionId, 
                cols: term.cols, 
                rows: term.rows 
              })
            }
          }
        })
      }
    })

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
.terminal-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative; /* 添加相对定位 */
}

:deep(.xterm) {
  flex: 1;
  padding: 10px;
  position: absolute; /* 使用绝对定位 */
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.terminal-container.dark-mode {
  background-color: var(--color-bg-5);
  color: var(--color-text-1);
}

:deep(.xterm-viewport) {
  width: 100% !important; /* 确保视口宽度填满容器 */
  height: 100% !important; /* 确保视口高度填满容器 */
}

:deep(.xterm-screen) {
  width: 100% !important; /* 确保屏幕宽度填满容器 */
  height: 100% !important; /* 确保屏幕高度填满容器 */
}

:deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: var(--color-text-4) transparent;
}

:deep(.xterm-viewport::-webkit-scrollbar) {
  width: 8px;
}

:deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: var(--color-text-4);
  border-radius: 4px;
  border: 2px solid var(--color-bg-1);
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-text-3);
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

.terminal-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
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
  transition: opacity 0.2s ease;
  transform: translateY(-50%);
  top: 50%;
}

.resource-monitor:hover .value {
  opacity: 1;
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
</style>

