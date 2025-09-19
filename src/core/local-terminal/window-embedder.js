const EventEmitter = require("events");

/**
 * Window embedding helpers for the local terminal integration.
 * The implementation currently keeps track of requested embeds so that
 * other parts of the application can query state without relying on the
 * native PowerShell embedding utility.
 */
class WindowEmbedder extends EventEmitter {
  constructor(mainWindow) {
    super();
    this.mainWindow = mainWindow;
    this.embeddedWindows = new Map();
    this.isWindows = process.platform === "win32";
  }

  async embedWindow(tabId, hwnd, bounds) {
    if (!tabId) {
      return false;
    }

    const info = {
      tabId,
      hwnd: hwnd ?? null,
      bounds: bounds ? { ...bounds } : null,
      isEmbedded: this.isWindows && Boolean(hwnd),
      originalParent: null,
      originalStyle: null,
    };

    this.embeddedWindows.set(tabId, info);

    if (info.isEmbedded) {
      this.emit("windowEmbedded", { tabId, hwnd: info.hwnd });
    }

    return true;
  }

  async unembedWindow(tabId) {
    const info = this.embeddedWindows.get(tabId);
    if (!info) {
      return false;
    }

    this.embeddedWindows.delete(tabId);

    if (info.isEmbedded) {
      this.emit("windowUnembedded", { tabId, hwnd: info.hwnd });
    }

    return true;
  }

  async resizeEmbeddedWindow(tabId, bounds) {
    const info = this.embeddedWindows.get(tabId);
    if (!info) {
      return false;
    }

    const nextBounds = bounds ? { ...bounds } : null;
    this.embeddedWindows.set(tabId, { ...info, bounds: nextBounds });

    return true;
  }

  getEmbeddedWindow(tabId) {
    const info = this.embeddedWindows.get(tabId);
    return info ? this._cloneInfo(info) : null;
  }

  getAllEmbeddedWindows() {
    return Array.from(this.embeddedWindows.values()).map((info) =>
      this._cloneInfo(info),
    );
  }

  async unembed(tabId) {
    return this.unembedWindow(tabId);
  }

  async updateBounds(tabId, bounds) {
    return this.resizeEmbeddedWindow(tabId, bounds);
  }

  async getWindowInfo(hwnd) {
    for (const info of this.embeddedWindows.values()) {
      if (info.hwnd === hwnd) {
        return this._cloneInfo(info);
      }
    }
    return null;
  }

  async hideWindow(_hwnd) {
    return false;
  }

  async showWindow(_hwnd) {
    return false;
  }

  cleanup() {
    this.embeddedWindows.clear();
  }

  _cloneInfo(info) {
    return {
      ...info,
      bounds: info.bounds ? { ...info.bounds } : null,
    };
  }
}

module.exports = WindowEmbedder;
