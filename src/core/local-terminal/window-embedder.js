const { exec } = require('child_process');
const { promisify } = require('util');
const EventEmitter = require('events');

const execAsync = promisify(exec);

class WindowEmbedder extends EventEmitter {
  constructor(mainWindow) {
    super();
    this.mainWindow = mainWindow;
    this.embeddedWindows = new Map();
    this.isWindows = process.platform === 'win32';
  }

  /**
   * 嵌入外部窗口到应用内
   * @param {string} tabId - 标签页ID
   * @param {number} hwnd - 窗口句柄
   * @param {Object} bounds - 窗口边界
   */
  async embedWindow(tabId, hwnd, bounds) {
    if (!this.isWindows || !hwnd) {
      return false;
    }

    try {
      const mainWindowHandle = this.mainWindow.getNativeWindowHandle();
      if (!mainWindowHandle) {
        throw new Error('Cannot get main window handle');
      }

      // 保存原始窗口信息
      const originalParent = await this.getWindowParent(hwnd);
      const originalStyle = await this.getWindowStyle(hwnd);

      // 设置窗口为子窗口
      const success = await this.setWindowParent(hwnd, mainWindowHandle.readBigUInt64LE(0));
      
      if (success) {
        // 调整窗口大小和位置
        await this.setWindowPos(hwnd, bounds.x, bounds.y, bounds.width, bounds.height);
        
        // 保存嵌入信息
        this.embeddedWindows.set(tabId, {
          tabId,
          hwnd,
          isEmbedded: true,
          originalParent,
          originalStyle,
          bounds
        });

        this.emit('windowEmbedded', { tabId, hwnd });
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to embed window:', error);
      return false;
    }
  }

  /**
   * 取消嵌入窗口
   * @param {string} tabId - 标签页ID
   */
  async unembedWindow(tabId) {
    const windowInfo = this.embeddedWindows.get(tabId);
    if (!windowInfo || !this.isWindows) {
      return false;
    }

    try {
      const { hwnd, originalParent, originalStyle } = windowInfo;

      // 恢复原始父窗口
      if (originalParent) {
        await this.setWindowParent(hwnd, originalParent);
      }

      // 恢复原始样式
      if (originalStyle) {
        await this.setWindowStyle(hwnd, originalStyle);
      }

      // 移除嵌入信息
      this.embeddedWindows.delete(tabId);
      
      this.emit('windowUnembedded', { tabId });
      return true;
    } catch (error) {
      console.error('Failed to unembed window:', error);
      return false;
    }
  }

  /**
   * 调整嵌入窗口大小
   * @param {string} tabId - 标签页ID
   * @param {Object} bounds - 新的边界
   */
  async resizeEmbeddedWindow(tabId, bounds) {
    const windowInfo = this.embeddedWindows.get(tabId);
    if (!windowInfo || !windowInfo.isEmbedded || !this.isWindows) {
      return false;
    }

    try {
      const success = await this.setWindowPos(
        windowInfo.hwnd,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height
      );

      if (success) {
        windowInfo.bounds = bounds;
        return true;
      }

      return false;
    } catch (error) {
      console.error('Failed to resize embedded window:', error);
      return false;
    }
  }

  /**
   * 获取窗口的父窗口
   */
  async getWindowParent(hwnd) {
    if (!this.isWindows) return null;

    try {
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr GetParent(IntPtr hWnd);
          }
"@
        $hwnd = [IntPtr]${hwnd}
        $parent = [Win32]::GetParent($hwnd)
        $parent.ToInt64()
      `;

      const { stdout } = await execAsync(`powershell -c "${script}"`);
      return parseInt(stdout.trim()) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 获取窗口样式
   */
  async getWindowStyle(hwnd) {
    if (!this.isWindows) return null;

    try {
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
            public const int GWL_STYLE = -16;
          }
"@
        $hwnd = [IntPtr]${hwnd}
        [Win32]::GetWindowLong($hwnd, [Win32]::GWL_STYLE)
      `;

      const { stdout } = await execAsync(`powershell -c "${script}"`);
      return parseInt(stdout.trim()) || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * 设置窗口父窗口
   */
  async setWindowParent(hwnd, parentHwnd) {
    if (!this.isWindows) return false;

    try {
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);
            
            [DllImport("user32.dll")]
            public static extern bool SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
            
            public const int GWL_STYLE = -16;
            public const int WS_CHILD = 0x40000000;
          }
"@
        $childHwnd = [IntPtr]${hwnd}
        $parentHwnd = [IntPtr]${parentHwnd}
        
        # 设置为子窗口样式
        [Win32]::SetWindowLong($childHwnd, [Win32]::GWL_STYLE, [Win32]::WS_CHILD)
        
        # 设置父窗口
        $result = [Win32]::SetParent($childHwnd, $parentHwnd)
        $result -ne [IntPtr]::Zero
      `;

      const { stdout } = await execAsync(`powershell -c "${script}"`);
      return stdout.trim() === 'True';
    } catch (error) {
      console.error('Failed to set window parent:', error);
      return false;
    }
  }

  /**
   * 设置窗口样式
   */
  async setWindowStyle(hwnd, style) {
    if (!this.isWindows) return false;

    try {
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
            public const int GWL_STYLE = -16;
          }
"@
        $hwnd = [IntPtr]${hwnd}
        [Win32]::SetWindowLong($hwnd, [Win32]::GWL_STYLE, ${style})
      `;

      await execAsync(`powershell -c "${script}"`);
      return true;
    } catch (error) {
      console.error('Failed to set window style:', error);
      return false;
    }
  }

  /**
   * 设置窗口位置和大小
   */
  async setWindowPos(hwnd, x, y, width, height) {
    if (!this.isWindows) return false;

    try {
      const script = `
        Add-Type -TypeDefinition @"
          using System;
          using System.Runtime.InteropServices;
          public class Win32 {
            [DllImport("user32.dll")]
            public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
          }
"@
        $hwnd = [IntPtr]${hwnd}
        $HWND_TOP = [IntPtr]0
        $SWP_SHOWWINDOW = 0x0040
        [Win32]::SetWindowPos($hwnd, $HWND_TOP, ${x}, ${y}, ${width}, ${height}, $SWP_SHOWWINDOW)
      `;

      const { stdout } = await execAsync(`powershell -c "${script}"`);
      return true;
    } catch (error) {
      console.error('Failed to set window position:', error);
      return false;
    }
  }

  /**
   * 获取嵌入的窗口信息
   */
  getEmbeddedWindow(tabId) {
    return this.embeddedWindows.get(tabId) || null;
  }

  /**
   * 获取所有嵌入的窗口
   */
  getAllEmbeddedWindows() {
    return Array.from(this.embeddedWindows.values());
  }

  /**
   * 清理所有嵌入的窗口
   */
  async cleanup() {
    const promises = Array.from(this.embeddedWindows.keys()).map(tabId => 
      this.unembedWindow(tabId)
    );
    await Promise.all(promises);
  }
}

module.exports = WindowEmbedder;