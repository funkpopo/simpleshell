<template>
  <div ref="terminal" class="terminal-container" :class="{ 'dark-mode': isDarkMode }"></div>
</template>

<script>
import { ref, onMounted, onUnmounted, watch, nextTick, inject } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { WebLinksAddon } from 'xterm-addon-web-links'
import { WebglAddon } from 'xterm-addon-webgl'
import { SearchAddon } from 'xterm-addon-search'
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
        // 添加防抖
        if (resizeTimeout.value) {
          clearTimeout(resizeTimeout.value)
        }
        
        resizeTimeout.value = setTimeout(() => {
          try {
            // 检查终端是否可见
            if (terminal.value && terminal.value.offsetParent !== null) {
              fitAddon.value.fit()
              // 仅在终端尺寸实际改变时发送新尺寸
              const newDims = term.value.rows && term.value.cols ? {
                rows: term.value.rows,
                cols: term.value.cols
              } : fitAddon.value.proposeDimensions()
              
              if (socket.value && socket.value.readyState === WebSocket.OPEN && isConnected.value && newDims) {
                // 检查尺寸是否真的改变
                if (!lastDims.value || 
                    lastDims.value.rows !== newDims.rows || 
                    lastDims.value.cols !== newDims.cols) {
                  socket.value.send(JSON.stringify({
                    type: 'resize',
                    session_id: props.sessionId,
                    ...newDims
                  }))
                  lastDims.value = newDims
                }
              }
            }
          } catch (error) {
            console.error('Error resizing terminal:', error)
          }
        }, 100) // 100ms 防抖延迟
      }
    }

    // 添加新的响应式变量
    const resizeTimeout = ref(null)
    const lastDims = ref(null)

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
        cursorWidth: 1,
        rightClickSelectsWord: true,
        copyOnSelect: false,
        allowProposedApi: true,
        unicodeVersion: '6',  // 使用更稳定的 Unicode 6 版本
        wordSeparator: ' ()[]{}\'"',  // 定义单词分隔符
      })

      term.value.open(terminal.value)

      // 创建并加载插件
      fitAddon.value = new FitAddon()
      webLinksAddon.value = new WebLinksAddon()
      const searchAddon = new SearchAddon()
      
      term.value.loadAddon(fitAddon.value)
      term.value.loadAddon(webLinksAddon.value)
      term.value.loadAddon(searchAddon)

      // 添加复制粘贴事件处理
      term.value.attachCustomKeyEventHandler((event) => {
        // Windows/Linux 使用 Ctrl, macOS 使用 Command
        const isCopy = (event.key === 'c' && (event.ctrlKey || event.metaKey))
        const isPaste = (event.key === 'v' && (event.ctrlKey || event.metaKey))

        if (isCopy) {
          const selection = term.value.getSelection()
          if (selection) {
            navigator.clipboard.writeText(selection)
            return false // 阻止默认复制行为
          }
        }

        if (isPaste) {
          navigator.clipboard.readText().then(text => {
            if (socket.value && isConnected.value) {
              socket.value.emit('ssh_input', {
                session_id: props.sessionId,
                input: text
              })
            }
          }).catch(err => console.error('Failed to read clipboard:', err))
          return false // 阻止默认粘贴行为
        }

        return true // 允许其他按键事件
      })

      // 添加右键菜单
      terminal.value.addEventListener('contextmenu', (event) => {
        event.preventDefault()
        const selection = term.value.getSelection()
        
        // 移除旧的菜单
        const oldMenu = document.querySelector('.terminal-context-menu')
        if (oldMenu) {
          oldMenu.remove()
        }
        
        const menu = document.createElement('div')
        menu.className = 'terminal-context-menu'
        menu.style.position = 'fixed'
        menu.style.left = `${event.clientX}px`
        menu.style.top = `${event.clientY}px`
        
        // 复制按钮
        const copyButton = document.createElement('button')
        copyButton.textContent = selection ? '复制' : '复制(无选中内容)'
        copyButton.disabled = !selection
        copyButton.onclick = () => {
          if (selection) {
            navigator.clipboard.writeText(selection)
            term.value.focus() // 复制后重新聚焦终端
          }
          menu.remove()
        }
        
        // 粘贴按钮
        const pasteButton = document.createElement('button')
        pasteButton.textContent = '粘贴'
        pasteButton.onclick = () => {
          navigator.clipboard.readText().then(text => {
            if (socket.value && isConnected.value) {
              socket.value.emit('ssh_input', {
                session_id: props.sessionId,
                input: text
              })
            }
            term.value.focus() // 粘贴后重新聚焦终端
          })
          menu.remove()
        }
        
        // 全选按钮
        const selectAllButton = document.createElement('button')
        selectAllButton.textContent = '全选'
        selectAllButton.onclick = () => {
          term.value.selectAll()
          menu.remove()
        }
        
        // 清除选择按钮
        const clearSelectionButton = document.createElement('button')
        clearSelectionButton.textContent = '清除选择'
        clearSelectionButton.onclick = () => {
          term.value.clearSelection()
          term.value.focus()
          menu.remove()
        }
        
        menu.appendChild(copyButton)
        menu.appendChild(pasteButton)
        menu.appendChild(selectAllButton)
        menu.appendChild(clearSelectionButton)
        document.body.appendChild(menu)
        
        // 点击其他地方关闭菜单
        const closeMenu = (e) => {
          if (!menu.contains(e.target)) {
            menu.remove()
            document.removeEventListener('click', closeMenu)
          }
        }
        document.addEventListener('click', closeMenu)
      })

      // 添加选中文本自动复制功能
      term.value.onSelectionChange(() => {
        const selection = term.value.getSelection()
        if (selection && term.value.hasSelection) {
          navigator.clipboard.writeText(selection)
        }
      })

      // 尝试加载 WebGL 插件以提高性能
      try {
        const webglAddon = new WebglAddon()
        term.value.loadAddon(webglAddon)
      } catch (e) {
        console.warn('WebGL addon could not be loaded', e)
      }

      fitAddon.value.fit()
      term.value.focus()

      console.log('Terminal initialized with size:', {
        rows: term.value.rows,
        cols: term.value.cols
      })

      return true
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
      console.log('Cleaning up socket connection...')
      if (socket.value) {
        try {
          socket.value.close()  // 使用 close() 而不是 disconnect()
          socket.value = null
        } catch (error) {
          console.error('Error cleaning up socket:', error)
        }
      }
    }

    // 初始化WebSocket连接
    const initSocket = () => {
      console.log('Initializing WebSocket connection...')
      if (socket.value) {
        cleanupSocket()
      }

      // 使用 socket.io-client 创建连接
      const ws = io('http://localhost:5000', {
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        path: '/socket.io'  // 添加路径
      })

      // 添加连接事件处理
      ws.on('connect_error', (error) => {
        console.error('Socket connection error:', error)
        term.value?.writeln('\r\nConnection error: ' + error.message)
      })

      ws.on('connect', () => {
        console.log('WebSocket connected, sending SSH connection request...')
        const connectionRequest = {
          session_id: props.sessionId,
          host: props.connection.host,
          port: props.connection.port,
          username: props.connection.username,
          authType: props.connection.authType,
          password: props.connection.password,
          privateKey: props.connection.privateKey,
          privateKeyPath: props.connection.privateKeyPath
        }
        console.log('Sending connection request:', {
          ...connectionRequest,
          password: '******',
          privateKey: connectionRequest.privateKey ? '******' : undefined
        })
        ws.emit('open_ssh', connectionRequest)
      })

      ws.on('ssh_connected', (data) => {
        console.log('Received ssh_connected event:', data)
        if (data.session_id === props.sessionId) {
          console.log('SSH connected:', data.message)
          isConnected.value = true
          term.value?.writeln('\r\nConnected to SSH server')
          
          // 发送初始终端大小
          if (term.value) {
            const { rows, cols } = term.value
            console.log('Sending initial terminal size:', { rows, cols })
            ws.emit('resize', {
              session_id: props.sessionId,
              rows,
              cols
            })
          }
        }
      })

      ws.on('ssh_output', (data) => {
        console.log('Received ssh_output event:', data)
        if (data.session_id === props.sessionId && data.output) {
          term.value?.write(data.output)
        }
      })

      ws.on('ssh_error', (data) => {
        console.error('SSH Error:', data)
        term.value?.writeln(`\r\nError: ${data.error}`)
      })

      ws.on('ssh_closed', (data) => {
        if (data.session_id === props.sessionId) {
          console.log('SSH connection closed:', data)
          isConnected.value = false
          term.value?.writeln('\r\nConnection closed')
          emit('close', props.sessionId)
        }
      })

      ws.on('disconnect', () => {
        console.log('WebSocket disconnected')
        isConnected.value = false
        term.value?.writeln('\r\nDisconnected from server')
      })

      socket.value = ws

      // 处理终端输入
      if (term.value) {
        term.value.onData(data => {
          if (isConnected.value) {
            console.log('Sending SSH input')
            ws.emit('ssh_input', {
              session_id: props.sessionId,
              input: data
            })
          }
        })

        // 处理终端大小变化
        term.value.onResize(size => {
          if (isConnected.value) {
            console.log('Terminal resized:', size)
            ws.emit('resize', {
              session_id: props.sessionId,
              rows: size.rows,
              cols: size.cols
            })
          }
        })
      }

      return ws
    }

    // 组件挂载时初始化
    onMounted(async () => {
      console.log('Mounting SSHTerminal component')
      try {
        // 先初始化终端
        await initTerminal()
        await nextTick()
        
        // 然后初始化 socket 连接
        const ws = initSocket()
        
        // 等待连接建立
        if (ws) {
          ws.on('connect', () => {
            console.log('Socket connected, fitting terminal')
            nextTick(() => {
              if (fitAddon.value) {
                fitAddon.value.fit()
                // 发送初始终端大小
                const { rows, cols } = term.value
                ws.emit('resize', {
                  session_id: props.sessionId,
                  rows,
                  cols
                })
              }
            })
          })
        }

        // 创建 ResizeObserver
        resizeObserver.value = new ResizeObserver(() => {
          manualResize()
        })

        if (terminal.value) {
          resizeObserver.value.observe(terminal.value)
        }

        window.addEventListener('resize', handleResize)
      } catch (error) {
        console.error('Failed to initialize terminal:', error)
        term.value?.writeln(`\r\nInitialization error: ${error.message}`)
      }
    })

    // 组件卸载时清理
    onUnmounted(() => {
      console.log('Unmounting SSHTerminal component')
      if (resizeObserver.value) {
        resizeObserver.value.disconnect()
      }
      if (resizeTimeout.value) {
        clearTimeout(resizeTimeout.value)
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

.terminal-context-menu {
  background: var(--color-bg-2);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  z-index: 1000;
}

.terminal-context-menu button {
  display: block;
  width: 100%;
  padding: 6px 12px;
  text-align: left;
  background: none;
  border: none;
  color: var(--color-text-1);
  cursor: pointer;
  white-space: nowrap;
}

.terminal-context-menu button:hover {
  background: var(--color-fill-2);
}
</style>
