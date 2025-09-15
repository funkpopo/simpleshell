const logToFile = (message, level = "INFO") => {
  // 在开发环境下输出日志
  if (
    process.env.NODE_ENV === "development" &&
    typeof window !== "undefined" &&
    window.location?.hostname === "localhost"
  ) {
    // Console logging disabled
  }
};

// 图像协议类型
export const IMAGE_PROTOCOL = {
  SIXEL: "sixel",
  ITERM: "iterm",
  KITTY: "kitty",
};

// 图像格式支持
export const SUPPORTED_FORMATS = {
  PNG: "image/png",
  JPEG: "image/jpeg",
  GIF: "image/gif",
  WEBP: "image/webp",
  BMP: "image/bmp",
};

export const detectImageSupport = () => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    return { supported: false, reason: "Canvas context not available" };
  }

  // 检测支持的图像格式
  const supportedFormats = [];

  Object.entries(SUPPORTED_FORMATS).forEach(([format, mimeType]) => {
    const testCanvas = document.createElement("canvas");
    testCanvas.width = 1;
    testCanvas.height = 1;

    try {
      const dataUrl = testCanvas.toDataURL(mimeType);
      if (dataUrl.startsWith(`data:${mimeType}`)) {
        supportedFormats.push(format);
      }
    } catch (error) {
      // 格式不支持
    }
  });

  return {
    supported: true,
    formats: supportedFormats,
    maxTextureSize: getMaxTextureSize(ctx),
    memoryLimit: getEstimatedMemoryLimit(),
  };
};

const getMaxTextureSize = (ctx) => {
  try {
    const gl = document.createElement("canvas").getContext("webgl");
    if (gl) {
      return gl.getParameter(gl.MAX_TEXTURE_SIZE);
    }
  } catch (error) {
    // WebGL不可用
  }

  // 降级到Canvas限制
  return 4096; // 大多数浏览器的Canvas限制
};

/**
 * 估算内存限制
 */
const getEstimatedMemoryLimit = () => {
  const deviceMemory = navigator.deviceMemory || 4; // GB
  const isMobile =
    /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    );

  // 为图像分配设备内存的一定比例
  const memoryRatio = isMobile ? 0.1 : 0.2; // 移动设备10%，桌面设备20%
  return Math.floor(deviceMemory * 1024 * 1024 * 1024 * memoryRatio); // 字节
};

export class ImageSupportManager {
  constructor(options = {}) {
    this.options = {
      // 图像配置
      pixelLimit: options.pixelLimit || 16777216, // 16M像素
      storageLimit: options.storageLimit || 128, // 128MB
      sixelSupport: options.sixelSupport !== false,
      iipSupport: options.iipSupport !== false,

      // Sixel配置
      sixelScrolling: options.sixelScrolling !== false,
      sixelPaletteLimit: options.sixelPaletteLimit || 256,
      sixelSizeLimit: options.sixelSizeLimit || 25000000, // 25MB

      // iTerm配置
      iipSizeLimit: options.iipSizeLimit || 20000000, // 20MB

      // 显示配置
      showPlaceholder: options.showPlaceholder !== false,
      enableSizeReports: options.enableSizeReports !== false,

      ...options,
    };

    this.imageAddon = null;
    this.isInitialized = false;
    this.imageCache = new Map();
    this.memoryUsage = 0;
  }

  async initialize(terminal) {
    try {
      const support = detectImageSupport();

      if (!support.supported) {
        logToFile(`图像支持不可用: ${support.reason}`, "WARN");
        return false;
      }

      // 动态导入图像插件
      const { ImageAddon } = await import("@xterm/addon-image");

      // 创建图像插件实例
      this.imageAddon = new ImageAddon(this.options);

      // 监听图像事件
      this.setupImageEventListeners();

      // 加载插件到终端
      terminal.loadAddon(this.imageAddon);

      this.isInitialized = true;

      logToFile("图像支持初始化成功", "INFO");
      logToFile(`支持的格式: ${support.formats.join(", ")}`, "DEBUG");
      logToFile(`最大纹理尺寸: ${support.maxTextureSize}px`, "DEBUG");
      logToFile(
        `内存限制: ${Math.round(support.memoryLimit / 1024 / 1024)}MB`,
        "DEBUG",
      );

      return true;
    } catch (error) {
      logToFile(`图像支持初始化失败: ${error.message}`, "ERROR");
      return false;
    }
  }

  setupImageEventListeners() {
    if (!this.imageAddon) return;

    // 监听图像加载事件
    this.imageAddon.onImageLoad?.((event) => {
      this.handleImageLoad(event);
    });

    // 监听图像错误事件
    this.imageAddon.onImageError?.((event) => {
      this.handleImageError(event);
    });

    // 监听内存使用变化
    this.imageAddon.onStorageChange?.((event) => {
      this.handleStorageChange(event);
    });
  }

  handleImageLoad(event) {
    const { imageId, width, height, size } = event;

    this.imageCache.set(imageId, {
      width,
      height,
      size,
      loadTime: Date.now(),
    });

    this.memoryUsage += size;

    logToFile(
      `图像加载成功: ${imageId} (${width}x${height}, ${Math.round(size / 1024)}KB)`,
      "DEBUG",
    );
  }

  /**
   * 处理图像错误事件
   */
  handleImageError(event) {
    const { imageId, error } = event;
    logToFile(`图像加载失败: ${imageId} - ${error}`, "WARN");
  }

  handleStorageChange(event) {
    const { storageUsage, storageLimit } = event;
    this.memoryUsage = storageUsage;

    const usagePercent = (storageUsage / storageLimit) * 100;

    if (usagePercent > 80) {
      logToFile(`图像内存使用率过高: ${usagePercent.toFixed(1)}%`, "WARN");
    }
  }

  getImageAtPosition(x, y) {
    if (!this.imageAddon || !this.isInitialized) {
      return null;
    }

    try {
      return this.imageAddon.getImageAtBufferCell(x, y);
    } catch (error) {
      logToFile(`获取图像数据失败: ${error.message}`, "ERROR");
      return null;
    }
  }

  extractImageTile(x, y) {
    if (!this.imageAddon || !this.isInitialized) {
      return null;
    }

    try {
      return this.imageAddon.extractTileAtBufferCell(x, y);
    } catch (error) {
      logToFile(`提取图像瓦片失败: ${error.message}`, "ERROR");
      return null;
    }
  }

  clearImageCache() {
    this.imageCache.clear();
    this.memoryUsage = 0;

    if (this.imageAddon && this.imageAddon.clearStorage) {
      this.imageAddon.clearStorage();
    }

    logToFile("图像缓存已清理", "INFO");
  }

  getImageStats() {
    const stats = {
      totalImages: this.imageCache.size,
      memoryUsage: this.memoryUsage,
      memoryLimit: this.options.storageLimit * 1024 * 1024,
      usagePercent:
        (this.memoryUsage / (this.options.storageLimit * 1024 * 1024)) * 100,
    };

    if (this.imageAddon) {
      stats.storageUsage = this.imageAddon.storageUsage || 0;
      stats.storageLimit =
        this.imageAddon.storageLimit || this.options.storageLimit;
    }

    return stats;
  }

  updateConfig(newOptions) {
    this.options = { ...this.options, ...newOptions };

    if (this.imageAddon) {
      // 更新插件配置
      Object.keys(newOptions).forEach((key) => {
        if (key in this.imageAddon) {
          this.imageAddon[key] = newOptions[key];
        }
      });
    }

    logToFile("图像支持配置已更新", "INFO");
  }

  isFormatSupported(mimeType) {
    return Object.values(SUPPORTED_FORMATS).includes(mimeType);
  }

  getSupportInfo() {
    return {
      initialized: this.isInitialized,
      protocols: {
        sixel: this.options.sixelSupport,
        iterm: this.options.iipSupport,
      },
      limits: {
        pixelLimit: this.options.pixelLimit,
        storageLimit: this.options.storageLimit,
        sixelSizeLimit: this.options.sixelSizeLimit,
        iipSizeLimit: this.options.iipSizeLimit,
      },
      detection: detectImageSupport(),
    };
  }

  dispose() {
    this.clearImageCache();

    if (this.imageAddon) {
      try {
        this.imageAddon.dispose();
      } catch (error) {
        logToFile(`图像插件清理失败: ${error.message}`, "ERROR");
      }
    }

    this.isInitialized = false;
    this.imageAddon = null;
  }
}

// 导出默认实例
export const imageSupport = new ImageSupportManager();
