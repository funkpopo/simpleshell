<template>
  <div class="terminal-wrapper">
    <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }" @paste.prevent="handlePaste"></div>
    <div class="resource-monitor" v-if="showResourceMonitor">
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
  </div>
</template>

<script>
import { Message } from '@arco-design/web-vue'
import { ref, onMounted, onUnmounted, watch, nextTick, inject, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import io from 'socket.io-client'
import { debounce as _debounce } from 'lodash'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { join } from 'path'
import { promises as fsPromises } from 'fs'
import msgpack from 'msgpack-lite'

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
    }
  },
  emits: ['close', 'pathChange', 'connectionStatus'],
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
    let lastCPUInfo = null
    const showValues = ref(false)

    const timestampPatterns = {
      iso8601: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g,
      unixTimestamp: /\b\d{10}\b|\b\d{13}\b/g,
      rfc2822: /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s\d{1,2}\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{4}\s\d{2}:\d{2}:\d{2}\s(?:[+-]\d{4}|GMT|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT)/g
    }

    const debouncedRefresh = _debounce(() => {
      if (term) {
        term.refresh(0, term.rows - 1)
        term.scrollToBottom()
      }
    }, 16)

    const handleSSHOutput = (data) => {
      if (data.session_id === props.sessionId) {
        console.log('Received SSH output')
        writeToTerminal(data.output)
        debouncedRefresh()
      }
    }

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
          pingInterval: 25000,
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

    const initializeTerminal = async () => {
      await nextTick()
      if (!terminal.value) {
        console.error('Terminal element not found')
        return
      }

      term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        copyOnSelect: false,
        theme: isDarkMode.value ? getDarkTheme() : getLightTheme(),
        allowTransparency: true,
        scrollback: 10000,
        convertEol: true,
        termName: 'xterm-256color',
        rendererType: 'canvas',
        allowProposedApi: true,
        cols: 80,
        rows: 24,
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
      })
      
      term.open(terminal.value)

      await new Promise(resolve => setTimeout(resolve, 0))

      fitAddon = new FitAddon()
      term.loadAddon(fitAddon)
      term.loadAddon(new WebLinksAddon())

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

        // 处理 Enter 键
        if (data === '\r') {
          // 如果命令提示窗口显示且有选中项，不处理这个 Enter 事件
          if (showSuggestions.value && selectedSuggestionIndex.value >= 0) {
            return
          }

          // 正常处理 Enter 键事件
          if (currentInput.value.trim()) {
            addToHistory(currentInput.value.trim())
          }
          currentInput.value = ''
          if (showSuggestions.value) {
            hideSuggestionMenu()
          }
          socket.emit('ssh_input', { session_id: props.sessionId, input: '\r' })
          return
        }

        // 记录普通输入
        if (data >= ' ' && data <= '~') {
          currentInput.value += data
          // 从第一个字符开始就显示建议
          if (currentInput.value.length > 0 && commandHistory.value) { // 确保 commandHistory 已初始化
            showSuggestionMenu()
          }
          socket.emit('ssh_input', { session_id: props.sessionId, input: data })
        } else if (data === '\x7f') { // Backspace
          if (currentInput.value.length > 0) {
            currentInput.value = currentInput.value.slice(0, -1)
            if (currentInput.value.length > 0 && commandHistory.value) { // 确保 commandHistory 已初始化
              showSuggestionMenu()
            } else {
              hideSuggestionMenu()
            }
          }
          socket.emit('ssh_input', { session_id: props.sessionId, input: data })
        } else {
          socket.emit('ssh_input', { session_id: props.sessionId, input: data })
        }
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
    }

    const handleResize = () => {
      if (fitAddon && term && isTerminalReady.value && socket) {
        fitAddon.fit()
        term.scrollToBottom()
        socket.emit('resize', { 
          session_id: props.sessionId, 
          cols: term.cols, 
          rows: term.rows 
        })
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
      if (!commandHistory.value || !currentInput.value) {
        console.warn('Command history or current input not initialized')
        return
      }

      if (!suggestionMenu.value) {
        suggestionMenu.value = document.createElement('div')
        suggestionMenu.value.className = 'command-suggestions'
        const xtermRows = terminal.value.querySelector('.xterm-screen .xterm-rows')
        if (xtermRows && xtermRows.children && xtermRows.children.length >= 2) {
          const lastRow = xtermRows.lastElementChild
          xtermRows.insertBefore(suggestionMenu.value, lastRow)
        } else {
          console.error('Could not find appropriate position for suggestions menu')
          return
        }
      }

      // 过滤命令，添加空值检查
      const filteredCommands = commandHistory.value
        .filter(cmd => {
          // 确保命令和当前输入都是有效的字符串
          return cmd && typeof cmd === 'string' && 
                 currentInput.value && typeof currentInput.value === 'string' &&
                 cmd.toLowerCase().startsWith(currentInput.value.toLowerCase())
        })
        .slice(0, 8)

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
        suggestionMenu.value.style.display = 'block'
        suggestionMenu.value.style.visibility = 'visible'
        
        // 根据命令数量调整高度
        const itemHeight = 32
        const maxVisibleItems = 4
        const actualItems = Math.min(suggestions.value.length, maxVisibleItems)
        suggestionMenu.value.style.height = `${actualItems * itemHeight}px`
        
        // 确保滚动容器可以正常工作
        suggestionMenu.value.style.overflowY = 'auto'
        suggestionMenu.value.style.overscrollBehavior = 'contain'
        
        nextTick(() => {
          positionSuggestionMenu()
          // 如果有选中项，确保它可见
          if (selectedSuggestionIndex.value >= 0) {
            const selectedItem = suggestionMenu.value.querySelector('.suggestion-item.selected')
            if (selectedItem) {
              selectedItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
            }
          }
        })
      } else {
        hideSuggestionMenu()
      }
    }

    const positionSuggestionMenu = () => {
      if (!term || !suggestionMenu.value) return
      
      // 获取光标位置
      const cursorCol = term.buffer.active.cursorX
      const charWidth = Math.ceil(term._core._renderService.dimensions.actualCellWidth)
      const charHeight = Math.ceil(term._core._renderService.dimensions.actualCellHeight)
      
      // 获取 xterm-rows 容器
      const xtermRows = terminal.value.querySelector('.xterm-screen .xterm-rows')
      if (!xtermRows) return
      
      // 获取最后一行的位置
      const lastRow = xtermRows.lastElementChild
      if (!lastRow) return
      
      // 应用位置
      Object.assign(suggestionMenu.value.style, {
        position: 'absolute',
        left: `${cursorCol * charWidth}px`,
        bottom: `${charHeight * 2}px`, // 确保在倒数第二行上方
        zIndex: '9999',
        transform: 'translateY(-100%)', // 向上移动菜单的高度
      })
      
      // 获取菜单尺寸和容器尺寸
      const menuRect = suggestionMenu.value.getBoundingClientRect()
      const containerRect = terminal.value.querySelector('.xterm-screen').getBoundingClientRect()
      
      // 处理水平溢出
      if (cursorCol * charWidth + menuRect.width > containerRect.width) {
        suggestionMenu.value.style.left = `${Math.max(0, containerRect.width - menuRect.width)}px`
      }
      
      // 确保菜单完全可见
      const menuHeight = menuRect.height
      const availableSpace = lastRow.offsetTop - charHeight // 减去一行高度，给最后一行留出空间
      
      if (menuHeight > availableSpace) {
        // 如果菜单高度超过可用空间，调整位置和大小
        suggestionMenu.value.style.maxHeight = `${Math.max(100, availableSpace)}px`
        suggestionMenu.value.style.bottom = `${charHeight * 2}px`
      }
    }

    const hideSuggestionMenu = () => {
      showSuggestions.value = false
      selectedSuggestionIndex.value = -1
      if (suggestionMenu.value) {
        suggestionMenu.value.style.display = 'none'
        suggestionMenu.value.style.visibility = 'hidden'
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
      }, 60000)
    }

    const stopResourceMonitoring = () => {
      console.log('Stopping resource monitoring...')
      if (resourceMonitorInterval) {
        clearInterval(resourceMonitorInterval)
        resourceMonitorInterval = null
      }
    }

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
            max-height: 200px;
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
            position: relative !important;
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
          monitor.addEventListener('mouseenter', handleMouseEnter)
          monitor.addEventListener('mouseleave', handleMouseLeave)
        }
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
      window.removeEventListener('resize', handleResize)
      
      terminal.value?.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('click', hideContextMenu)
      if (contextMenu.value) {
        document.body.removeChild(contextMenu.value)
      }
      stopResourceMonitoring()

      const monitor = document.querySelector('.resource-monitor')
      if (monitor) {
        monitor.removeEventListener('mouseenter', handleMouseEnter)
        monitor.removeEventListener('mouseleave', handleMouseLeave)
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

      const hasSuggestions = Array.isArray(suggestions.value) && suggestions.value.length > 0
      
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
          return true // 让 Enter 事件继续传播
        }
      }
      
      // 如果没有显示命令提示窗口或没有建议，处理普通的终端方向键
      if (event.key.startsWith('Arrow')) {
        const key = event.key.toLowerCase()
        const sequences = {
          arrowup: '\x1b[A',
          arrowdown: '\x1b[B',
          arrowright: '\x1b[C',
          arrowleft: '\x1b[D'
        }
        if (sequences[key]) {
          // 如果命令提示窗口显示但没有建议，先关闭它
          if (showSuggestions.value) {
            hideSuggestionMenu()
          }
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

    const handleSuggestionClick = (event) => {
      const item = event.target.closest('.suggestion-item')
      if (item) {
        const index = parseInt(item.dataset.index)
        if (!isNaN(index) && index >= 0 && index < suggestions.value.length) {
          const selectedCommand = suggestions.value[index]
          // 清除当前输入并填充选中的命令
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
      showValues.value = true
    }

    const handleMouseLeave = () => {
      showValues.value = false
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
      showValues
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
}

:deep(.xterm) {
  flex: 1;
  padding: 10px;
}

.terminal-container.dark-mode {
  background-color: var(--color-bg-5);
  color: var(--color-text-1);
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

.command-suggestions {
  position: absolute;
  /* 深色主题 */
  --dark-bg-color: rgba(36, 36, 36, 0.85);
  --dark-border-color: rgba(78, 78, 78, 0.6);
  --dark-hover-color: rgba(70, 70, 70, 0.8);
  /* 浅色主题 */
  --light-bg-color: rgba(255, 255, 255, 0.85);
  --light-border-color: rgba(229, 230, 235, 0.8);
  --light-hover-color: rgba(242, 243, 245, 0.9);
  
  background-color: var(--light-bg-color);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border: 1px solid var(--light-border-color);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 200px;
  max-width: 400px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  z-index: 9999;
  overflow-y: auto;
  pointer-events: auto;
  user-select: none;
  opacity: 1;
  transition: all 0.2s ease;
  box-sizing: border-box;
  word-break: break-all;
  white-space: normal;
  transform-origin: bottom left;
  
  /* 设置单个命令项的高度 */
  --suggestion-item-height: 32px;
  /* 最大显示4行的高度 */
  max-height: calc(var(--suggestion-item-height) * 4);
  /* 优化滚动行 */
  overflow-y: auto;
  overflow-x: hidden;
  overscroll-behavior: contain;
  scroll-behavior: smooth;
  
  /* 确保内容不会溢出 */
  max-height: calc(var(--suggestion-item-height) * 4);
  min-height: var(--suggestion-item-height);
}

.suggestion-item {
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-text-1);
  line-height: 20px;
  font-size: 14px;
  transition: all 0.15s ease;
  margin: 0 4px;
  border-radius: 4px;
  height: var(--suggestion-item-height);
  box-sizing: border-box;
  display: flex;
  align-items: center;
  /* 确保项目高度固定 */
  height: var(--suggestion-item-height);
  min-height: var(--suggestion-item-height);
  /* 改进选中和悬停状态的视觉效果 */
  position: relative;
  transition: all 0.2s ease;
}

/* 浅色主题选中状态 */
.suggestion-item.selected {
  background-color: var(--light-hover-color);
  color: var(--color-text-1);
}

/* 深色主题选中状态 */
.terminal-container.dark-mode .suggestion-item.selected {
  background-color: var(--dark-hover-color);
  color: var(--color-text-1);
}

/* 悬停效果 */
.suggestion-item:hover {
  background-color: var(--light-hover-color);
}

.terminal-container.dark-mode .suggestion-item:hover {
  background-color: var(--dark-hover-color);
}

/* Arco Design 滚动条样式 */
.command-suggestions::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.command-suggestions::-webkit-scrollbar-track {
  background: transparent;
}

.command-suggestions::-webkit-scrollbar-thumb {
  background-color: var(--color-text-4);
  border-radius: 3px;
  border: none;
}

.command-suggestions::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-text-3);
}

/* 深色题滚动条 */
.terminal-container.dark-mode .command-suggestions::-webkit-scrollbar-thumb {
  background-color: var(--color-fill-3);
}

.terminal-container.dark-mode .command-suggestions::-webkit-scrollbar-thumb:hover {
  background-color: var(--color-fill-4);
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
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  z-index: 1000;
  opacity: 0.9;
  backdrop-filter: blur(4px);
  min-width: 140px;
  transition: opacity 0.2s ease;
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
</style>