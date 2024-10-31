<template>
  <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }"></div>
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
  emits: ['close'],
  setup(props, { emit }) {
    const terminal = ref(null)
    const term = ref(null)
    const socket = ref(null)
    const fitAddon = ref(null)
    const webLinksAddon = ref(null)
    const isDarkMode = inject('isDarkMode', ref(false))
    const isConnected = ref(false)

    // 在 setup 函数中，initTerminal 之前添加 manualResize 函数的定义
    const manualResize = () => {
      if (fitAddon.value && term.value) {
        nextTick(() => {
          try {
            fitAddon.value.fit()
            // 发送新的尺寸到服务器
            if (socket.value && isConnected.value) {
              const dims = term.value.rows && term.value.cols ? { 
                rows: term.value.rows, 
                cols: term.value.cols 
              } : fitAddon.value.proposeDimensions()
              
              if (dims) {
                socket.value.emit('resize', {
                  session_id: props.sessionId,
                  ...dims
                })
              }
            }
          } catch (error) {
            console.error('Error resizing terminal:', error)
          }
        })
      }
    }

    // 添加 handleResize 函数的定义
    const handleResize = () => {
      console.log('Window resized')
      manualResize()
    }

    // 添加 resizeObserver 的定义
    const resizeObserver = ref(null)

    // 初始化终端
    const initTerminal = async () => {
      if (!terminal.value) return

      console.log('Initializing terminal...')
      term.value = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Consolas, "Courier New", monospace',
        theme: {
          background: isDarkMode.value ? '#1E1E1E' : '#FFFFFF',
          foreground: isDarkMode.value ? '#D4D4D4' : '#333333',
        },
        allowTransparency: true,
        scrollback: 10000,
        cols: 80,
        rows: 24,
        convertEol: true,
        cursorStyle: 'block',
        cursorWidth: 1
      })

      term.value.open(terminal.value)

      // 创建并加载插件
      fitAddon.value = new FitAddon()
      webLinksAddon.value = new WebLinksAddon()
      
      term.value.loadAddon(fitAddon.value)
      term.value.loadAddon(webLinksAddon.value)

      fitAddon.value.fit()
      term.value.focus()

      // 处理终端输入
      term.value.onData(data => {
        if (socket.value && isConnected.value) {
          console.log('Sending terminal input:', data)
          socket.value.emit('ssh_input', {
            session_id: props.sessionId,
            input: data
          })
        }
      })

      // 处理终端大小变化
      term.value.onResize(size => {
        if (socket.value && isConnected.value) {
          console.log('Terminal resized:', size)
          socket.value.emit('resize', {
            session_id: props.sessionId,
            cols: size.cols,
            rows: size.rows
          })
        }
      })

      // 处理窗口大小变化
      const handleResize = () => {
        console.log('Window resized')
        manualResize()
      }

      console.log('Terminal initialized')
      return handleResize
    }

    // 清理终端
    const cleanupTerminal = () => {
      console.log('Cleaning up terminal...')
      if (term.value) {
        try {
          // 先卸载插件
          if (fitAddon.value) {
            term.value.loadAddon(fitAddon.value)
            fitAddon.value = null
          }
          if (webLinksAddon.value) {
            term.value.loadAddon(webLinksAddon.value)
            webLinksAddon.value = null
          }
          // 再销毁终端
          term.value.dispose()
          term.value = null
        } catch (error) {
          console.error('Error disposing terminal:', error)
        }
      }
    }

    // 清理socket连接
    const cleanupSocket = () => {
      console.log('Cleaning up socket...')
      if (socket.value) {
        socket.value.disconnect()
        socket.value = null
      }
    }

    // 初始化WebSocket连接
    const initSocket = () => {
      console.log('Initializing socket connection...')
      socket.value = io('http://localhost:5000', {
        transports: ['websocket']
      })

      socket.value.on('connect', () => {
        console.log('Socket connected, establishing SSH connection...')
        socket.value.emit('open_ssh', {
          ...props.connection,
          session_id: props.sessionId
        })
      })

      socket.value.on('ssh_connected', (data) => {
        if (data.session_id === props.sessionId) {
          console.log('SSH connected:', data.message)
          isConnected.value = true
          term.value?.writeln('Connected to SSH server')
        }
      })

      socket.value.on('ssh_output', (data) => {
        if (data.session_id === props.sessionId) {
          console.log('Received SSH output:', data.output)
          term.value?.write(data.output)
        }
      })

      socket.value.on('ssh_error', (error) => {
        console.error('SSH Error:', error)
        term.value?.writeln(`\r\nError: ${error.message || error}`)
      })

      socket.value.on('ssh_closed', (data) => {
        if (data.session_id === props.sessionId) {
          console.log('SSH connection closed')
          isConnected.value = false
          term.value?.writeln('\r\nConnection closed')
          emit('close', props.sessionId)
        }
      })

      socket.value.on('disconnect', () => {
        console.log('Socket disconnected')
        isConnected.value = false
        term.value?.writeln('\r\nDisconnected from server')
      })

      console.log('Socket initialization completed')
    }

    // 组件挂载时初始化
    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      try {
        await initTerminal()
        initSocket()

        // 创建 ResizeObserver 监听终端容器大小变化
        resizeObserver.value = new ResizeObserver(() => {
          manualResize()
        })

        if (terminal.value) {
          resizeObserver.value.observe(terminal.value)
        }

        window.addEventListener('resize', handleResize)
      } catch (error) {
        console.error('Failed to initialize terminal:', error)
      }
    })

    // 组件卸载时清理
    onUnmounted(() => {
      console.log('Unmounting SSHTerminal component')
      if (resizeObserver.value) {
        resizeObserver.value.disconnect()
      }
      window.removeEventListener('resize', handleResize)
      cleanupSocket()
      cleanupTerminal()
    })

    // 监听主题变化
    watch(() => isDarkMode.value, (newValue) => {
      if (term.value) {
        term.value.options.theme = {
          background: newValue ? '#1E1E1E' : '#FFFFFF',
          foreground: newValue ? '#D4D4D4' : '#333333',
          cursor: newValue ? '#D4D4D4' : '#333333',
          selection: newValue ? 'rgba(255, 255, 255, 0.3)' : 'rgba(0, 0, 0, 0.3)',
          black: newValue ? '#000000' : '#2E3436',
          red: '#CC0000',
          green: '#4E9A06',
          yellow: '#C4A000',
          blue: '#3465A4',
          magenta: '#75507B',
          cyan: '#06989A',
          white: newValue ? '#D3D7CF' : '#D3D7CF',
          brightBlack: '#555753',
          brightRed: '#EF2929',
          brightGreen: '#8AE234',
          brightYellow: '#FCE94F',
          brightBlue: '#729FCF',
          brightMagenta: '#AD7FA8',
          brightCyan: '#34E2E2',
          brightWhite: '#EEEEEC'
        };
        term.value.refresh(0, term.value.rows - 1);
      }
    }, { immediate: true });

    return {
      terminal,
      isDarkMode,
      manualResize
    }
  }
}
</script>

<style scoped>
.terminal-container {
  width: 100%;
  height: 100%;
  padding: 10px;
  background-color: var(--color-bg-2);
}

.terminal-container.dark-mode {
  background-color: #1E1E1E;
}

:deep(.xterm) {
  padding: 5px;
}

:deep(.xterm-viewport) {
  overflow-y: auto;
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
}

:deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: var(--color-text-3);
}
</style>
