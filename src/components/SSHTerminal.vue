<template>
  <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }" @paste.prevent="handlePaste"></div>
</template>

<script>
import { Message } from '@arco-design/web-vue'
import { ref, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import io from 'socket.io-client'
import { debounce as _debounce } from 'lodash'
import fs from 'fs'
import path from 'path'

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
  emits: ['close', 'pathChange'],
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
            if (!isTerminalReady.value) {
              initializeTerminal()
            }
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
            writeToTerminal('SSH connection closed\r\n')
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
        console.log('Sending SSH input')
        
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

    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      try {
        await loadHighlightPatterns()
        await initializeSocket()
        await initializeTerminal()
        
        terminal.value.addEventListener('contextmenu', handleContextMenu)
        document.addEventListener('click', hideContextMenu)
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
    })

    watch(() => isDarkMode.value, (newValue) => {
      setTheme(newValue ? 'dark' : 'light')
    })

    const cleanup = () => {
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

    const handleSpecialKeys = (event) => {
      if (term && isTerminalReady.value) {
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
        
        if (event.ctrlKey || event.altKey) {
          return true
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

    return { 
      terminal,
      closeConnection,
      handlePaste,
      setTheme,
      isDarkMode,
      manualResize,
      currentPath,
      reconnect
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
</style>