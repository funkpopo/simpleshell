/**
 * Deletes the AI memory file. Failures are logged and swallowed so that
 * clearing or closing the chat always completes.
 */
export async function deleteChatMemory() {
  if (!window.terminalAPI?.deleteMemory) return;
  try {
    await window.terminalAPI.deleteMemory();
  } catch (err) {
    console.error("Failed to delete AI memory:", err);
  }
}
