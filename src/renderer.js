import "./index.css";
import "./app.jsx";

// Setup event listeners for streaming responses
if (window.terminalAPI) {
  // Listen for streaming chunks
  window.terminalAPI.on("stream-chunk", (event, data) => {
    if (data && data.tabId) {
      // Dispatch a custom event that the AIAssistant component can listen for
      window.dispatchEvent(
        new CustomEvent("ai-stream-chunk", { detail: data }),
      );
    }
  });

  // Listen for end of stream
  window.terminalAPI.on("stream-end", (event, data) => {
    if (data && data.tabId) {
      window.dispatchEvent(new CustomEvent("ai-stream-end", { detail: data }));
    }
  });

  // Listen for stream errors
  window.terminalAPI.on("stream-error", (event, data) => {
    if (data && data.tabId) {
      window.dispatchEvent(
        new CustomEvent("ai-stream-error", { detail: data }),
      );
    }
  });
}
