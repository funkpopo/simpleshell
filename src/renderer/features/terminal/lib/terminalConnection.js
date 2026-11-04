// Pure helpers for interpreting terminal connection results and errors.

/**
 * Builds the line written to the terminal when a local/remote session fails
 * to start. `localizedSshConfig` is only read on the remote path.
 */
export function formatTerminalConnectionError(
  error,
  { isLocalTerminal, localizedSshConfig, translate },
) {
  const errorObject = error && typeof error === "object" ? error : null;
  const localError =
    errorObject?.data?.error ||
    errorObject?.error ||
    errorObject?.message ||
    error;
  const rawMessage =
    typeof errorObject?.error === "string" && errorObject.error.trim()
      ? errorObject.error
      : typeof errorObject?.message === "string" && errorObject.message.trim()
        ? errorObject.message
        : String(error || "").trim();
  if (isLocalTerminal) {
    const message =
      typeof localError === "string"
        ? localError
        : localError?.message || rawMessage;
    return `\r\nLocal terminal failed to start: ${
      message || translate("webTerminal.runtime.unknownError")
    }`;
  }
  const isCancelled =
    /cancel(l)?ed/i.test(rawMessage) || rawMessage.includes("取消");
  if (isCancelled) {
    return `\r\n${translate("webTerminal.runtime.connectionCancelled")}`;
  }
  const connectionFailure = errorObject?.connectionFailure;
  const reason =
    typeof connectionFailure?.message === "string" &&
    connectionFailure.message.trim()
      ? connectionFailure.message.trim()
      : rawMessage || translate("webTerminal.runtime.unknownError");
  const baseMessage = localizedSshConfig.splitReconnect
    ? `\r\n${translate("webTerminal.runtime.reconnectFailed", {
        error: reason,
      })}`
    : `\r\n${translate("webTerminal.runtime.connectionFailed", {
        error: reason,
      })}`;
  const suggestion =
    typeof connectionFailure?.suggestion === "string" &&
    connectionFailure.suggestion.trim()
      ? connectionFailure.suggestion.trim()
      : "";
  return suggestion
    ? `${baseMessage}\r\n${translate("webTerminal.runtime.connectionAdvice", {
        advice: suggestion,
      })}`
    : baseMessage;
}

export function normalizeTerminalConnectResult(result) {
  if (
    result &&
    typeof result === "object" &&
    Object.prototype.hasOwnProperty.call(result, "success")
  ) {
    if (!result.success) {
      return { processId: null, error: result };
    }
    const data = result.data ?? null;
    const processId = data && typeof data === "object" ? data.processId : data;
    return { processId, metadata: data, error: null };
  }
  return { processId: result, metadata: result, error: null };
}
