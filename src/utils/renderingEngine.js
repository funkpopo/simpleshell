/**
 * 终端渲染引擎管理器
 * 提供WebGL和Canvas渲染器的智能选择和管理
 */

// 前端日志函数（替代后端logger）
const logToFile = (message, level = 'INFO') => {
  // 在开发环境下输出日志
  if (typeof window !== 'undefined' && window.location?.hostname === 'localhost') {
    console.log(`[${level}] ${message}`);
  }
};

// 渲染器类型
export const RENDERER_TYPE = {
  WEBGL: 'webgl',
  CANVAS: 'canvas',
  DOM: 'dom'
};

// 渲染器状态
export const RENDERER_STATE = {
  INITIALIZING: 'initializing',
  ACTIVE: 'active',
  FAILED: 'failed',
  DISPOSED: 'disposed'
};

/**
 * 检测WebGL支持
 */
export const detectWebGLSupport = () => {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    
    if (!gl) {
      return { supported: false, reason: 'WebGL context not available' };
    }

    // 检查必要的WebGL扩展
    const requiredExtensions = [
      'OES_texture_float',
      'OES_element_index_uint'
    ];

    const missingExtensions = requiredExtensions.filter(ext => !gl.getExtension(ext));
    
    if (missingExtensions.length > 0) {
      return { 
        supported: false, 
        reason: `Missing extensions: ${missingExtensions.join(', ')}` 
      };
    }

    // 检查性能参数
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'Unknown';
    
    return {
      supported: true,
      renderer,
      version: gl.getParameter(gl.VERSION),
      vendor: gl.getParameter(gl.VENDOR)
    };
  } catch (error) {
    return { supported: false, reason: error.message };
  }
};

/**
 * 检测设备性能等级
 */
export const detectPerformanceLevel = () => {
  const navigator = window.navigator;
  const screen = window.screen;
  
  // 基础性能指标
  const metrics = {
    cores: navigator.hardwareConcurrency || 2,
    memory: navigator.deviceMemory || 4,
    pixelRatio: window.devicePixelRatio || 1,
    screenSize: screen.width * screen.height,
    isMobile: /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
  };

  // 性能等级评估
  let performanceLevel = 'medium';
  
  if (metrics.isMobile) {
    performanceLevel = 'low';
  } else if (metrics.cores >= 8 && metrics.memory >= 8) {
    performanceLevel = 'high';
  } else if (metrics.cores >= 4 && metrics.memory >= 4) {
    performanceLevel = 'medium';
  } else {
    performanceLevel = 'low';
  }

  return { performanceLevel, metrics };
};

/**
 * 渲染器选择策略
 */
export const selectOptimalRenderer = () => {
  const webglSupport = detectWebGLSupport();
  const { performanceLevel, metrics } = detectPerformanceLevel();
  
  // 决策逻辑
  if (!webglSupport.supported) {
    return {
      type: RENDERER_TYPE.CANVAS,
      reason: `WebGL not supported: ${webglSupport.reason}`,
      fallback: true
    };
  }

  if (performanceLevel === 'low' || metrics.isMobile) {
    return {
      type: RENDERER_TYPE.CANVAS,
      reason: 'Low performance device, using Canvas for stability',
      fallback: true
    };
  }

  return {
    type: RENDERER_TYPE.WEBGL,
    reason: 'WebGL supported and performance adequate',
    webglInfo: webglSupport,
    fallback: false
  };
};

/**
 * 渲染器管理类
 */
export class RenderingEngineManager {
  constructor() {
    this.currentRenderer = null;
    this.rendererState = RENDERER_STATE.INITIALIZING;
    this.fallbackRenderer = null;
    this.performanceMetrics = {
      frameCount: 0,
      lastFrameTime: 0,
      fps: 0,
      averageFps: 0,
      frameHistory: []
    };
    this.eventListeners = new Map();
  }

  /**
   * 初始化渲染器
   */
  async initializeRenderer(terminal) {
    try {
      const selection = selectOptimalRenderer();
      
      if (selection.type === RENDERER_TYPE.WEBGL) {
        await this.initializeWebGLRenderer(terminal);
      } else {
        this.initializeCanvasRenderer(terminal);
      }

      this.startPerformanceMonitoring();
      
      return {
        success: true,
        renderer: selection.type,
        info: selection
      };
    } catch (error) {
      logToFile(`渲染器初始化失败: ${error.message}`, 'ERROR');
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 初始化WebGL渲染器
   */
  async initializeWebGLRenderer(terminal) {
    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      
      const webglAddon = new WebglAddon();
      
      // 监听上下文丢失
      webglAddon.onContextLoss((e) => {
        logToFile('WebGL上下文丢失，切换到Canvas渲染器', 'WARN');
        this.handleWebGLContextLoss(terminal);
      });

      terminal.loadAddon(webglAddon);
      
      this.currentRenderer = {
        type: RENDERER_TYPE.WEBGL,
        addon: webglAddon,
        terminal
      };
      
      this.rendererState = RENDERER_STATE.ACTIVE;
      
      logToFile('WebGL渲染器初始化成功', 'INFO');
    } catch (error) {
      logToFile(`WebGL渲染器初始化失败: ${error.message}`, 'ERROR');
      // 降级到Canvas渲染器
      this.initializeCanvasRenderer(terminal);
    }
  }

  /**
   * 初始化Canvas渲染器
   */
  initializeCanvasRenderer(terminal) {
    // Canvas渲染器是默认的，无需额外插件
    this.currentRenderer = {
      type: RENDERER_TYPE.CANVAS,
      terminal
    };
    
    this.rendererState = RENDERER_STATE.ACTIVE;
    logToFile('Canvas渲染器初始化成功', 'INFO');
  }

  /**
   * 处理WebGL上下文丢失
   */
  handleWebGLContextLoss(terminal) {
    if (this.currentRenderer && this.currentRenderer.addon) {
      try {
        this.currentRenderer.addon.dispose();
      } catch (error) {
        logToFile(`WebGL渲染器清理失败: ${error.message}`, 'ERROR');
      }
    }

    // 切换到Canvas渲染器
    this.initializeCanvasRenderer(terminal);
    
    // 触发事件
    this.emit('rendererChanged', {
      from: RENDERER_TYPE.WEBGL,
      to: RENDERER_TYPE.CANVAS,
      reason: 'context_loss'
    });
  }

  /**
   * 开始性能监控
   */
  startPerformanceMonitoring() {
    const measureFrame = () => {
      const now = performance.now();
      
      if (this.performanceMetrics.lastFrameTime > 0) {
        const frameDelta = now - this.performanceMetrics.lastFrameTime;
        const currentFps = 1000 / frameDelta;
        
        this.performanceMetrics.frameHistory.push(currentFps);
        
        // 保持最近60帧的历史
        if (this.performanceMetrics.frameHistory.length > 60) {
          this.performanceMetrics.frameHistory.shift();
        }
        
        // 计算平均FPS
        this.performanceMetrics.averageFps = 
          this.performanceMetrics.frameHistory.reduce((a, b) => a + b, 0) / 
          this.performanceMetrics.frameHistory.length;
        
        this.performanceMetrics.fps = currentFps;
      }
      
      this.performanceMetrics.lastFrameTime = now;
      this.performanceMetrics.frameCount++;
      
      // 检查性能问题
      if (this.performanceMetrics.frameCount % 60 === 0) {
        this.checkPerformanceIssues();
      }
      
      requestAnimationFrame(measureFrame);
    };
    
    measureFrame();
  }

  /**
   * 检查性能问题
   */
  checkPerformanceIssues() {
    const { averageFps } = this.performanceMetrics;
    
    if (averageFps < 30 && this.currentRenderer?.type === RENDERER_TYPE.WEBGL) {
      logToFile(`WebGL渲染器性能不佳 (FPS: ${averageFps.toFixed(1)})，考虑降级`, 'WARN');
      
      // 可以在这里实现自动降级逻辑
      this.emit('performanceWarning', {
        fps: averageFps,
        renderer: this.currentRenderer.type
      });
    }
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics() {
    return { ...this.performanceMetrics };
  }

  /**
   * 获取渲染器信息
   */
  getRendererInfo() {
    return {
      current: this.currentRenderer?.type || 'none',
      state: this.rendererState,
      webglSupport: detectWebGLSupport(),
      performanceLevel: detectPerformanceLevel()
    };
  }

  /**
   * 事件监听
   */
  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }
    this.eventListeners.get(event).push(callback);
  }

  /**
   * 触发事件
   */
  emit(event, data) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          logToFile(`事件监听器错误: ${error.message}`, 'ERROR');
        }
      });
    }
  }

  /**
   * 清理资源
   */
  dispose() {
    if (this.currentRenderer && this.currentRenderer.addon) {
      try {
        this.currentRenderer.addon.dispose();
      } catch (error) {
        logToFile(`渲染器清理失败: ${error.message}`, 'ERROR');
      }
    }
    
    this.rendererState = RENDERER_STATE.DISPOSED;
    this.eventListeners.clear();
  }
}

// 导出单例实例
export const renderingEngine = new RenderingEngineManager();
