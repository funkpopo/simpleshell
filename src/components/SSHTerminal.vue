<template>
  <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }" @paste.prevent="handlePaste"></div>
</template>

<script>
import { ref, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import 'xterm/css/xterm.css'
import io from 'socket.io-client'
import { debounce as _debounce } from 'lodash'

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
          pingInterval: 1000,
          pingTimeout: 5000,
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
        })

        socket.on('disconnect', (reason) => {
          console.log('Socket disconnected:', reason)
          if (reason === 'io server disconnect' || reason === 'transport close') {
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
      const pathRegex = /^(.+?)\s*[\r\n]/;
      const match = output.match(pathRegex);
      if (match) {
        const newPath = match[1].trim();
        if (newPath !== currentPath.value) {
          currentPath.value = newPath;
          emit('pathChange', newPath);
          console.log('Path changed in SSHTerminal:', newPath);
        }
      }
    };

    const writeToTerminal = (text) => {
      if (isTerminalReady.value && term) {
        try {
          // 如果文本已经包含颜色控制序列，直接写入
          if (text.includes('\x1b[')) {
            term.write(text)
            return
          }

          // 处理每一行文本
          const lines = text.split('\n')
          lines.forEach((line, index) => {
            // 检查是否是命令提示符行
            const isPrompt = /^.*?[@:].+[$#>]\s*$/.test(line)
            
            if (isPrompt) {
              // 高亮提示符
              const parts = line.match(/^(.*?)(@|:)(.+?)([$#>])\s*$/)
              if (parts) {
                term.write('\x1b[1;32m' + parts[1]) // 用户名为绿色
                term.write('\x1b[1;37m' + parts[2]) // @ 或 : 为白色
                term.write('\x1b[1;34m' + parts[3]) // 主机名/路径为蓝色
                term.write('\x1b[1;37m' + parts[4]) // 提示符为白色
                term.write('\x1b[0m') // 重置颜色
              } else {
                term.write(line)
              }
            } else {
              // 对其他输出进行语法高亮
              let coloredLine = line
                // 高亮IP地址 (移到最前面，避免被其他规则干扰)
                .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, (match) => {
                  if (!/[a-zA-Z]/.test(match)) {  // 确保IP地址中没有字母
                    const parts = match.split('.');
                    const isValid = parts.every(part => {
                      const num = parseInt(part, 10);
                      return !isNaN(num) && num >= 0 && num <= 255 && part.length <= 3;
                    });
                    return isValid ? '\x1b[1;35m' + match + '\x1b[0m' : match;
                  }
                  return match;
                })
                // 高亮完整时间格式
                .replace(/\b((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))\s+((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec))\s+(\d{1,2})\s+(\d{2}:\d{2}:\d{2})\s+(\d{4})\b/g, 
                  (match, weekday, month, day, time, year) => {
                    return '\x1b[1;36m' + weekday +
                           '\x1b[0m ' +
                           '\x1b[1;36m' + month +
                           '\x1b[0m  ' +
                           '\x1b[1;36m' + day +
                           '\x1b[0m ' +
                           '\x1b[1;36m' + time +
                           '\x1b[0m ' +
                           '\x1b[1;36m' + year +
                           '\x1b[0m'
                  })
                // 高亮错误信息
                .replace(/(error|failed|failure|warning)/gi, '\x1b[1;31m$1\x1b[0m')
                // 高亮成功信息
                .replace(/(success|succeeded|done|completed)/gi, '\x1b[1;32m$1\x1b[0m')
                // 高亮路径
                .replace(/(\/([\w.-]+\/)*[\w.-]+)/g, '\x1b[1;34m$1\x1b[0m')
                // 高亮端口号
                .replace(/(?<![:\d])\b:\d+\b/g, '\x1b[1;33m$&\x1b[0m')
                // 高亮常见命令
                .replace(/\b(ls|cd|pwd|mkdir|rm|cp|mv|cat|grep|ssh|sudo|apt|yum|docker|git)\b/g, '\x1b[1;36m$1\x1b[0m')
                // 高亮选项参数
                .replace(/(\s-\w+|\s--[\w-]+)/g, '\x1b[1;33m$1\x1b[0m')

              term.write(coloredLine)
            }

            // 如果不是最后一行，添加换行符
            if (index < lines.length - 1) {
              term.write('\r\n')
            }
          })

          // 检测路径变化
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
    };

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

    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      try {
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

    return { 
      terminal,
      closeConnection,
      handlePaste,
      setTheme,
      isDarkMode,
      manualResize,
      currentPath
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