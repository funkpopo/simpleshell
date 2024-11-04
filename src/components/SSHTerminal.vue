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

    const handlePaste = (event) => {
      if (term && isTerminalReady.value) {
        const text = event.clipboardData.getData('text')
        term.paste(text)
        socket.emit('ssh_input', { session_id: props.sessionId, input: text })
      }
    }

    const handleCopy = () => {
      if (term && term.hasSelection()) {
        const selection = term.getSelection()
        if (selection) {
          navigator.clipboard.writeText(selection)
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
      black: '#000000',
      brightBlack: '#666666',
      red: '#E06C75',
      brightRed: '#FF7A80',
      green: '#98C379',
      brightGreen: '#B5E890',
      yellow: '#E5C07B',
      brightYellow: '#FFD780',
      blue: '#61AFEF',
      brightBlue: '#80BAFF',
      magenta: '#C678DD',
      brightMagenta: '#FF80FF',
      cyan: '#56B6C2',
      brightCyan: '#80FFFF',
      white: '#D4D4D4',
      brightWhite: '#FFFFFF'
    })

    const getLightTheme = () => ({
      background: '#FFFFFF',
      foreground: '#333333',
      black: '#000000',
      brightBlack: '#666666',
      red: '#CC0000',
      brightRed: '#FF0000',
      green: '#4E9A06',
      brightGreen: '#73D216',
      yellow: '#C4A000',
      brightYellow: '#FCE94F',
      blue: '#3465A4',
      brightBlue: '#729FCF',
      magenta: '#75507B',
      brightMagenta: '#AD7FA8',
      cyan: '#06989A',
      brightCyan: '#34E2E2',
      white: '#D3D7CF',
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
        copyOnSelect: true,
        theme: isDarkMode.value ? getDarkTheme() : getLightTheme(),
        allowTransparency: true,
        scrollback: 10000,
      })
      
      term.open(terminal.value)

      // 等待终端完全加载
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
        return true
      })

      isTerminalReady.value = true
      
      // 处理缓冲的输出
      outputBuffer.value.forEach(output => {
        term.write(output)
      })
      outputBuffer.value = []

      term.onData((data) => {
        console.log('Sending SSH input')
        socket.emit('ssh_input', { session_id: props.sessionId, input: data })
      })

      // 发送初始终端大小
      socket.emit('resize', { 
        session_id: props.sessionId, 
        cols: term.cols, 
        rows: term.rows 
      })

      // 添加自动滚动到底部的功能
      term.onLineFeed(() => {
        term.scrollToBottom()
      })

      window.addEventListener('resize', handleResize)
    }

    const handleResize = () => {
      if (fitAddon && term && isTerminalReady.value) {
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

    const initializeSocket = () => {
      return new Promise((resolve) => {
        socket = io('http://localhost:5000', {
          transports: ['websocket']
        })
        
        socket.on('connect', () => {
          console.log('Socket connected')
          socket.emit('open_ssh', { ...props.connection, session_id: props.sessionId })
        })

        socket.on('ssh_connected', (data) => {
          if (data.session_id === props.sessionId) {
            console.log('SSH connected:', data.message)
            writeToTerminal('Connected to SSH server\r\n')
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
          // 直接写入错误消息到终端，但不关闭会话
          if (isTerminalReady.value && term) {
            // 添加换行和颜色，使错误消息更醒目
            term.write('\r\n\x1b[31m=== Error ===\x1b[0m\r\n')
            term.write('\x1b[31m' + error.error + '\x1b[0m\r\n')
            term.write('\x1b[31m=============\x1b[0m\r\n\r\n')
            term.write('Press Ctrl+W or click the close button (×) to close this terminal.\r\n')
            term.scrollToBottom()
          } else {
            // 如果终端还没准备好，将错误消息添加到缓冲区
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
            emit('close', props.sessionId)
          }
        })

        resolve()
      })
    }

    const detectPathChange = (output) => {
      // 使用正则表达式匹配路径
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
        // 如果是错误消息，添加更醒目的格式
        if (typeof text === 'string' && text.includes('Error:')) {
          term.write('\r\n\x1b[31m=== Error ===\x1b[0m\r\n')
          term.write('\x1b[31m' + text + '\x1b[0m\r\n')
          term.write('\x1b[31m=============\x1b[0m\r\n\r\n')
        } else {
          term.write(text)
        }
        term.scrollToBottom()
        detectPathChange(text)
      } else {
        outputBuffer.value.push(text)
      }
    };

    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      await initializeSocket()
      await initializeTerminal()
    })

    const closeConnection = () => {
      cleanup()
      emit('close', props.sessionId)
    }

    onUnmounted(() => {
      cleanup()
      window.removeEventListener('resize', handleResize)
    })

    // 监听父组件的主题变化
    watch(() => isDarkMode.value, (newValue) => {
      setTheme(newValue ? 'dark' : 'light')
    })

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

/* 自定义 xterm 滚动条样式 */
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