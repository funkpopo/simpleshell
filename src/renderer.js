/**
 * This file will automatically be loaded by webpack and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

import "./index.css";
import "./app.jsx";

console.log(
  '👋 This message is being logged by "renderer.js", included via webpack',
);

// Setup event listeners for streaming responses
if (window.terminalAPI) {
  // Listen for streaming chunks
  window.terminalAPI.on("stream-chunk", (event, data) => {
    if (data && data.tabId) {
      // Dispatch a custom event that the AIAssistant component can listen for
      window.dispatchEvent(
        new CustomEvent("ai-stream-chunk", { detail: data })
      );
    }
  });

  // Listen for end of stream
  window.terminalAPI.on("stream-end", (event, data) => {
    if (data && data.tabId) {
      window.dispatchEvent(
        new CustomEvent("ai-stream-end", { detail: data })
      );
    }
  });

  // Listen for stream errors
  window.terminalAPI.on("stream-error", (event, data) => {
    if (data && data.tabId) {
      window.dispatchEvent(
        new CustomEvent("ai-stream-error", { detail: data })
      );
    }
  });
}
