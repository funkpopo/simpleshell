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
    const contextMenu = ref(null)

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
      brightWhite: '#FFFFFF',
      extendedAnsi: true,
    })

    const getLightTheme = () => ({
      background: '#FFFFFF',
      foreground: '#333333',
      cursor: '#333333',
      cursorAccent: '#FFFFFF',
      selection: 'rgba(0, 0, 0, 0.3)',
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
      brightWhite: '#EEEEEC',
      extendedAnsi: true,
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
        smoothScrollDuration: 300,
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
        // 检查是否包含特殊的终端控制序列
        const hasControlSeq = /\x1b\[[?]?(1049[hl]|2J|H|K)/.test(text)
        
        // 检查是否是大量输出
        const isLargeOutput = text.length > 4096 || (text.match(/\n/g) || []).length > 50
        
        if (hasControlSeq) {
          // 对于包含控制序列的输出，直接写入并立即刷新
          term.write(text)
          term.refresh(0, term.rows - 1)
        } else if (isLargeOutput) {
          // 对于大量输出，分批写入
          const chunkSize = 1024
          for (let i = 0; i < text.length; i += chunkSize) {
            const chunk = text.slice(i, i + chunkSize)
            term.write(chunk)
            // 每写入一块数据后让出一点时间给渲染线程
            if (i + chunkSize < text.length) {
              setTimeout(() => {}, 0)
            }
          }
          term.scrollToBottom()
        } else if (text.includes('Error:')) {
          term.write('\r\n\x1b[31m=== Error ===\x1b[0m\r\n')
          term.write('\x1b[31m' + text + '\x1b[0m\r\n')
          term.write('\x1b[31m=============\x1b[0m\r\n\r\n')
          term.scrollToBottom()
        } else {
          term.write(text)
          term.scrollToBottom()
        }
        
        detectPathChange(text)
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

      // 先显示菜单以获取其尺寸
      contextMenu.value.style.visibility = 'hidden'
      contextMenu.value.style.display = 'block'

      // 获取菜单尺寸和视窗尺寸
      const menuRect = contextMenu.value.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      // 计算最佳位置
      let left = event.pageX
      let top = event.pageY

      // 检查右边界
      if (left + menuRect.width > viewportWidth) {
        left = viewportWidth - menuRect.width - 5
      }

      // 检查下边界
      if (top + menuRect.height > viewportHeight) {
        top = viewportHeight - menuRect.height - 5
      }

      // 确保不会超出左边和上边界
      left = Math.max(5, left)
      top = Math.max(5, top)

      // 应用计算后的位置
      contextMenu.value.style.left = `${left}px`
      contextMenu.value.style.top = `${top}px`
      contextMenu.value.style.visibility = 'visible'

      // 添加菜单项点击事件
      contextMenu.value.querySelectorAll('.menu-item').forEach(item => {
        item.addEventListener('click', handleMenuClick)
      })
    }

    // 处理菜单项点击
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

    // 隐藏右键菜单
    const hideContextMenu = () => {
      if (contextMenu.value) {
        contextMenu.value.style.display = 'none'
      }
    }

    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      await initializeSocket()
      await initializeTerminal()
      
      // 添加右键菜单事件监听
      terminal.value.addEventListener('contextmenu', handleContextMenu)
      document.addEventListener('click', hideContextMenu)
    })

    const closeConnection = () => {
      cleanup()
      emit('close', props.sessionId)
    }

    onUnmounted(() => {
      cleanup()
      window.removeEventListener('resize', handleResize)
      
      // 清理右键菜单相关
      terminal.value?.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('click', hideContextMenu)
      if (contextMenu.value) {
        document.body.removeChild(contextMenu.value)
      }
    })

    // 监听父组件的主题变化
    watch(() => isDarkMode.value, (newValue) => {
      setTheme(newValue ? 'dark' : 'light')
    })

    const cleanup = () => {
      if (socket) {
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