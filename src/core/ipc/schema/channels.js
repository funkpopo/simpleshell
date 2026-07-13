const ANY_SCHEMA = Object.freeze({});
const ANY_ARGS_SCHEMA = Object.freeze({
  type: "array",
  items: ANY_SCHEMA,
});

const NO_ARGS_SCHEMA = Object.freeze({
  type: "array",
  maxItems: 0,
});

const STANDARD_RESPONSE_SCHEMA = Object.freeze({
  anyOf: [
    { type: "boolean" },
    { type: "number" },
    { type: "string" },
    { type: "array" },
    { type: "null" },
    { type: "object", additionalProperties: true },
    {
      type: "object",
      properties: {
        success: { type: "boolean" },
      },
      additionalProperties: true,
    },
  ],
});

const stringArg = () => ({ type: "string" });
const optionalObjectArg = () => ANY_SCHEMA;
const objectArg = () => ({ type: "object", additionalProperties: true });
const arrayArg = () => ({ type: "array", items: ANY_SCHEMA });
const booleanArg = () => ({ type: "boolean" });
const numberArg = () => ({ type: "number" });

const args = (items, options = {}) => ({
  type: "array",
  minItems: options.minItems ?? items.length,
  maxItems: options.maxItems ?? items.length,
  items,
});

const objectPayloadArgs = (required = [], properties = {}) =>
  args([
    {
      type: "object",
      required,
      properties,
      additionalProperties: true,
    },
  ]);

const defineRequest = (
  key,
  channel,
  category,
  requestSchema = ANY_ARGS_SCHEMA,
  responseSchema = STANDARD_RESPONSE_SCHEMA,
  options = {},
) => ({
  key,
  channel,
  category,
  type: "request",
  requestSchema,
  responseSchema,
  permission: options.permission || "internal",
});

const defineEvent = (
  key,
  channel,
  category,
  payloadSchema = ANY_ARGS_SCHEMA,
  options = {},
) => ({
  key,
  channel,
  category,
  type: "event",
  payloadSchema,
  permission: options.permission || "internal",
  dynamic: options.dynamic === true,
});

const IPC_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest("WINDOW_MINIMIZE", "window:minimize", "window", NO_ARGS_SCHEMA),
  defineRequest(
    "WINDOW_TOGGLE_MAXIMIZE",
    "window:toggleMaximize",
    "window",
    NO_ARGS_SCHEMA,
  ),
  defineRequest("WINDOW_CLOSE", "window:close", "window", NO_ARGS_SCHEMA),
  defineRequest("WINDOW_GET_STATE", "window:getState", "window", NO_ARGS_SCHEMA),
  defineEvent(
    "WINDOW_STATE",
    "window:state",
    "window",
    args([
      {
        type: "object",
        required: ["isMaximized", "isFullScreen"],
        properties: {
          isMaximized: { type: "boolean" },
          isFullScreen: { type: "boolean" },
        },
        additionalProperties: true,
      },
    ]),
  ),

  defineRequest("APP_GET_VERSION", "app:getVersion", "app", NO_ARGS_SCHEMA),
  defineRequest("APP_CLOSE", "app:close", "app", NO_ARGS_SCHEMA),
  defineRequest("APP_RELOAD_WINDOW", "app:reloadWindow", "app", NO_ARGS_SCHEMA),
  defineRequest(
    "CLIPBOARD_READ_TEXT",
    "clipboard:readText",
    "clipboard",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "clipboard" },
  ),
  defineRequest(
    "CLIPBOARD_WRITE_TEXT",
    "clipboard:writeText",
    "clipboard",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "clipboard" },
  ),
  defineRequest(
    "APP_OPEN_EXTERNAL",
    "app:openExternal",
    "app",
    objectPayloadArgs(["url"], {
      url: { type: "string", minLength: 1, maxLength: 2048 },
      source: { type: "string", maxLength: 64 },
      allowRestrictedProtocols: { type: "boolean" },
    }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineRequest("APP_CHECK_FOR_UPDATE", "app:checkForUpdate", "app", NO_ARGS_SCHEMA),
  defineRequest("APP_DOWNLOAD_UPDATE", "app:downloadUpdate", "app", NO_ARGS_SCHEMA),
  defineRequest("APP_INSTALL_UPDATE", "app:installUpdate", "app", NO_ARGS_SCHEMA),
  defineRequest(
    "APP_GET_DOWNLOAD_PROGRESS",
    "app:getDownloadProgress",
    "app",
    NO_ARGS_SCHEMA,
  ),
  defineRequest("APP_CANCEL_DOWNLOAD", "app:cancelDownload", "app", NO_ARGS_SCHEMA),
  defineRequest(
    "APP_HAS_DOWNLOADED_INSTALLER",
    "app:hasDownloadedInstaller",
    "app",
    NO_ARGS_SCHEMA,
  ),
  defineRequest("APP_GET_GPU_INFO", "app:getGpuInfo", "app", NO_ARGS_SCHEMA),
  defineRequest(
    "APP_OPEN_LOG_DIRECTORY",
    "app:openLogDirectory",
    "app",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "APP_EXPORT_DIAGNOSTICS",
    "app:exportDiagnostics",
    "app",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "APP_COPY_DIAGNOSTIC_SUMMARY",
    "app:copyDiagnosticSummary",
    "app",
    args([optionalObjectArg()]),
  ),
  defineRequest(
    "APP_COPY_DIAGNOSTIC_PACKAGE",
    "app:copyDiagnosticPackage",
    "app",
    args([optionalObjectArg()]),
  ),
  defineRequest(
    "APP_OPEN_FEEDBACK_ISSUE",
    "app:openFeedbackIssue",
    "app",
    args([optionalObjectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineEvent("APP_ERROR", "app:error", "app"),
  defineEvent("APP_MENU_ACTION", "app:menu-action", "app", args([stringArg()])),
  defineEvent("APP_OPEN_FILES", "app:open-files", "app", args([arrayArg()])),
  defineEvent(
    "UPDATE_DOWNLOAD_PROGRESS",
    "update:downloadProgress",
    "app",
    args([objectArg()]),
  ),

  defineRequest("AI_LOAD_SETTINGS", "ai:loadSettings", "ai", NO_ARGS_SCHEMA),
  defineRequest("AI_SAVE_SETTINGS", "ai:saveSettings", "ai", args([objectArg()])),
  defineRequest(
    "AI_SAVE_API_CONFIG",
    "ai:saveApiConfig",
    "ai",
    args([objectArg()]),
  ),
  defineRequest(
    "AI_DELETE_API_CONFIG",
    "ai:deleteApiConfig",
    "ai",
    args([stringArg()]),
  ),
  defineRequest(
    "AI_SET_CURRENT_API_CONFIG",
    "ai:setCurrentApiConfig",
    "ai",
    args([stringArg()]),
  ),
  defineRequest(
    "AI_SEND_PROMPT",
    "ai:sendPrompt",
    "ai",
    args([stringArg(), objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineRequest(
    "AI_SEND_API_REQUEST",
    "ai:sendAPIRequest",
    "ai",
    args([objectArg(), booleanArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineRequest("AI_ABORT_API_REQUEST", "ai:abortAPIRequest", "ai", NO_ARGS_SCHEMA),
  defineRequest(
    "AI_FETCH_MODELS",
    "ai:fetchModels",
    "ai",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineRequest(
    "AI_SAVE_CUSTOM_RISK_RULES",
    "ai:saveCustomRiskRules",
    "ai",
    args([arrayArg()]),
  ),
  defineEvent("AI_STREAM_CHUNK", "stream-chunk", "ai", args([objectArg()])),
  defineEvent("AI_STREAM_END", "stream-end", "ai", args([objectArg()])),
  defineEvent("AI_STREAM_ERROR", "stream-error", "ai", args([objectArg()])),

  defineRequest(
    "TERMINAL_SEND_TO_PROCESS",
    "terminal:sendToProcess",
    "terminal",
    args([{}, {}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_KILL_PROCESS",
    "terminal:killProcess",
    "terminal",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_SAVE_CONNECTIONS",
    "terminal:saveConnections",
    "terminal",
    args([arrayArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_SELECT_KEY_FILE",
    "terminal:selectKeyFile",
    "terminal",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest("TERMINAL_COMMAND", "terminal:command", "terminal", args([stringArg()])),
  defineRequest(
    "TERMINAL_RESIZE",
    "terminal:resize",
    "terminal",
    args([{}, numberArg(), numberArg()]),
  ),
  defineRequest(
    "TERMINAL_CLEANUP_CONNECTION",
    "terminal:cleanupConnection",
    "terminal",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest(
    "TERMINAL_GET_PROCESS_INFO",
    "terminal:getProcessInfo",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_NOTIFY_EDITOR_MODE_CHANGE",
    "terminal:notifyEditorModeChange",
    "terminal",
    args([{}, booleanArg()]),
  ),
  defineRequest(
    "TERMINAL_LOAD_CONNECTIONS",
    "terminal:loadConnections",
    "terminal",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "TERMINAL_GET_CONNECTION_PASSWORD",
    "terminal:getConnectionPassword",
    "terminal",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_LOAD_TOP_CONNECTIONS",
    "terminal:loadTopConnections",
    "terminal",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "TERMINAL_GET_SYSTEM_INFO",
    "terminal:getSystemInfo",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_GET_PROCESS_LIST",
    "terminal:getProcessList",
    "terminal",
    args([{}]),
  ),
  defineRequest(
    "TERMINAL_START_SSH",
    "terminal:startSSH",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_TEST_SSH_CONNECTION",
    "terminal:testSSHConnection",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineRequest(
    "TERMINAL_START_TELNET",
    "terminal:startTelnet",
    "terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
  defineRequest(
    "TERMINAL_UPDATE_CONNECTION_CREDENTIALS",
    "terminal:updateConnectionCredentials",
    "terminal",
    args([{}, objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineEvent(
    "TERMINAL_SEND_INPUT",
    "terminal:sendInput",
    "terminal",
    objectPayloadArgs(["processId", "input"]),
    { permission: "process-control" },
  ),
  defineEvent(
    "TERMINAL_OUTPUT_ACK",
    "terminal:outputAck",
    "terminal",
    objectPayloadArgs(["processId", "bytes"]),
  ),
  defineEvent(
    "TERMINAL_IO_MAILBOX",
    "terminal:mailbox",
    "terminal",
    objectPayloadArgs(["processId", "message"]),
    { permission: "process-control" },
  ),
  defineEvent(
    "TERMINAL_IO_MAILBOX_OUTPUT",
    "terminal:mailbox:process:*",
    "terminal",
    args([{}]),
    { dynamic: true },
  ),
  defineEvent(
    "TERMINAL_SESSION_RESTORED",
    "terminal:session-restored",
    "terminal",
    args([objectArg()]),
  ),
  defineEvent(
    "TERMINAL_SESSION_RESTORE_FAILED",
    "terminal:session-restore-failed",
    "terminal",
    args([objectArg()]),
  ),
  defineEvent(
    "TERMINAL_PROCESS_OUTPUT",
    "process:output:*",
    "terminal",
    args([{}]),
    { dynamic: true },
  ),
  defineEvent(
    "TERMINAL_PROCESS_EXIT",
    "process:exit:*",
    "terminal",
    args([objectArg()]),
    { dynamic: true },
  ),

  defineRequest(
    "SSH_AUTH_RESPONSE",
    "ssh:auth-response",
    "ssh",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "credentials" },
  ),
  defineEvent("SSH_AUTH_REQUEST", "ssh:auth-request", "ssh", args([objectArg()])),

  defineRequest(
    "RECONNECT_GET_STATUS",
    "get-reconnect-status",
    "reconnect",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "RECONNECT_PAUSE",
    "pause-reconnect",
    "reconnect",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "RECONNECT_RESUME",
    "resume-reconnect",
    "reconnect",
    objectPayloadArgs(["tabId"]),
  ),
  defineRequest(
    "RECONNECT_GET_STATISTICS",
    "get-reconnect-statistics",
    "reconnect",
    NO_ARGS_SCHEMA,
  ),
  defineEvent("RECONNECT_STARTED", "reconnect-started", "reconnect", args([objectArg()])),
  defineEvent("RECONNECT_PROGRESS", "reconnect-progress", "reconnect", args([objectArg()])),
  defineEvent("RECONNECT_SUCCESS", "reconnect-success", "reconnect", args([objectArg()])),
  defineEvent("RECONNECT_FAILED", "reconnect-failed", "reconnect", args([objectArg()])),
  defineEvent(
    "RECONNECT_ABANDONED",
    "reconnect-abandoned",
    "reconnect",
    args([objectArg()]),
  ),
  defineEvent("CONNECTION_LOST", "connection-lost", "reconnect", args([objectArg()])),
  defineEvent(
    "TAB_CONNECTION_STATUS",
    "tab-connection-status",
    "connection",
    args([objectArg()]),
  ),

  defineRequest("LATENCY_REGISTER", "latency:register", "latency", objectPayloadArgs(["tabId", "host", "port"])),
  defineRequest("LATENCY_UNREGISTER", "latency:unregister", "latency", objectPayloadArgs(["tabId"])),
  defineRequest("LATENCY_GET_INFO", "latency:getInfo", "latency", objectPayloadArgs(["tabId"])),
  defineRequest("LATENCY_GET_ALL_INFO", "latency:getAllInfo", "latency", NO_ARGS_SCHEMA),
  defineRequest("LATENCY_GET_SERVICE_STATUS", "latency:getServiceStatus", "latency", NO_ARGS_SCHEMA),
  defineRequest("LATENCY_TEST_NOW", "latency:testNow", "latency", objectPayloadArgs(["tabId"])),
  defineEvent("LATENCY_UPDATED", "latency:updated", "latency", args([objectArg()])),
  defineEvent("LATENCY_ERROR", "latency:error", "latency", args([objectArg()])),
  defineEvent("LATENCY_DISCONNECTED", "latency:disconnected", "latency", args([objectArg()])),

  defineRequest("LOCAL_TERMINALS_DETECT", "detectLocalTerminals", "local-terminal", args([optionalObjectArg()], { minItems: 0 })),
  defineRequest(
    "LOCAL_TERMINAL_START_EMBEDDED",
    "startLocalTerminal",
    "local-terminal",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "process-control" },
  ),
  defineRequest("LOCAL_TERMINAL_CLOSE", "closeLocalTerminal", "local-terminal", args([{}])),
  defineRequest("LOCAL_TERMINAL_GET_INFO", "getLocalTerminalInfo", "local-terminal", args([{}])),
  defineRequest("LOCAL_TERMINAL_ADD_CUSTOM", "addCustomTerminal", "local-terminal", args([objectArg()])),
  defineRequest("LOCAL_TERMINAL_UPDATE_CUSTOM", "updateCustomTerminal", "local-terminal", args([{}, objectArg()])),
  defineRequest("LOCAL_TERMINAL_DELETE_CUSTOM", "deleteCustomTerminal", "local-terminal", args([{}])),
  defineRequest("LOCAL_TERMINAL_GET_CUSTOM", "getCustomTerminals", "local-terminal", NO_ARGS_SCHEMA),
  defineRequest("LOCAL_TERMINAL_GET_ALL_ACTIVE", "getAllActiveLocalTerminals", "local-terminal", NO_ARGS_SCHEMA),
  defineEvent("LOCAL_TERMINAL_STATUS", "localTerminalStatus", "local-terminal", args([objectArg()])),

  defineRequest("CONNECTION_GET_TAB_STATUS", "connection:getTabStatus", "connection", args([{}])),
  defineEvent("CONNECTIONS_CHANGED", "connections-changed", "connection", NO_ARGS_SCHEMA),
  defineEvent(
    "TOP_CONNECTIONS_CHANGED",
    "top-connections-changed",
    "connection",
    args([arrayArg()]),
  ),

  defineRequest("FILE_LIST", "listFiles", "file", args([{}, stringArg(), optionalObjectArg(), stringArg()], { minItems: 2, maxItems: 4 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_COPY", "copyFile", "file", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_MOVE", "moveFile", "file", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_DELETE", "deleteFile", "file", args([{}, stringArg(), booleanArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CREATE_FOLDER", "createFolder", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CREATE", "createFile", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_RENAME", "renameFile", "file", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_DOWNLOAD", "downloadFile", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_DOWNLOAD_FILES", "downloadFiles", "file", args([{}, arrayArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_DOWNLOAD_FOLDER", "downloadFolder", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_GET_PERMISSIONS", "getFilePermissions", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_GET_PERMISSIONS_BATCH", "getFilePermissionsBatch", "file", args([{}, arrayArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_SET_PERMISSIONS", "setFilePermissions", "file", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_SET_OWNERSHIP", "setFileOwnership", "file", args([{}, stringArg(), {}, {}]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_GET_ABSOLUTE_PATH", "getAbsolutePath", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CHECK_PATH_EXISTS", "checkPathExists", "file", args([stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_SHOW_ITEM_IN_FOLDER", "showItemInFolder", "file", args([stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CANCEL_TRANSFER", "cancelTransfer", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CANCEL_LIST", "cancelListFiles", "file", args([{}, {}], { minItems: 1, maxItems: 2 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_START_DIRECTORY_WATCH", "startDirectoryWatch", "file", args([{}, stringArg(), optionalObjectArg()], { minItems: 2, maxItems: 3 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_STOP_DIRECTORY_WATCH", "stopDirectoryWatch", "file", args([{}, {}]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CREATE_REMOTE_FOLDERS", "createRemoteFolders", "file", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_UPLOAD", "uploadFile", "file", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_UPLOAD_DROPPED", "uploadDroppedFiles", "file", args([{}, stringArg(), objectArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_UPLOAD_FOLDER", "upload-folder", "file", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_VALIDATE_DROPPED_ITEMS", "validateDroppedItems", "file", args([arrayArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("FILE_CHECK_DROPPED_UPLOAD_CONFLICTS", "checkDroppedUploadConflicts", "file", args([{}, stringArg(), objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineEvent("FILE_LIST_CHUNK", "listFiles:chunk", "file", args([objectArg()])),
  defineEvent("DIRECTORY_WATCH_EVENT", "directory-watch:event", "file", args([objectArg()])),
  defineEvent("DOWNLOAD_PROGRESS", "download-progress", "file", args([objectArg()])),
  defineEvent("DOWNLOAD_FOLDER_PROGRESS", "download-folder-progress", "file", args([objectArg()])),
  defineEvent("TRANSFER_PROGRESS", "transfer-progress", "file", args([objectArg()])),
  defineEvent("TRANSFER_PROGRESS_BATCH", "transfer-progress:batch", "file", args([arrayArg()])),
  defineEvent("DYNAMIC_UPLOAD_PROGRESS", "upload-progress-*", "file", args([objectArg()]), { dynamic: true }),
  defineEvent("DYNAMIC_UPLOAD_FOLDER_PROGRESS", "upload-folder-progress-*", "file", args([objectArg()]), { dynamic: true }),
  defineEvent("DYNAMIC_UPLOAD_DROPPED_PROGRESS", "upload-dropped-progress-*", "file", args([objectArg()]), { dynamic: true }),

  defineRequest("SFTP_GET_SESSION", "getSftpSession", "sftp", args([{}]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_ENQUEUE_OPERATION", "enqueueSftpOperation", "sftp", ANY_ARGS_SCHEMA, STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_PROCESS_QUEUE", "processSftpQueue", "sftp", ANY_ARGS_SCHEMA, STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_READ_FILE_CONTENT", "readFileContent", "sftp", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_READ_FILE_BASE64", "readFileAsBase64", "sftp", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_SAVE_FILE_CONTENT", "saveFileContent", "sftp", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_LIST_FILE_SNAPSHOTS", "listFileSnapshots", "sftp", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_CREATE_FILE_SNAPSHOT", "createFileSnapshot", "sftp", args([{}, stringArg(), stringArg(), optionalObjectArg()], { minItems: 3, maxItems: 4 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_GET_FILE_SNAPSHOT", "getFileSnapshot", "sftp", args([{}, stringArg(), stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("SFTP_RESTORE_FILE_SNAPSHOT", "restoreFileSnapshot", "sftp", args([{}, stringArg(), stringArg(), {}], { minItems: 3, maxItems: 4 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineEvent("EXTERNAL_EDITOR_SYNC", "external-editor:sync", "sftp", args([objectArg()])),
  defineRequest("EXTERNAL_EDITOR_OPEN", "external-editor:open", "sftp", args([{}, stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),

  defineRequest("DIALOG_SHOW_OPEN", "dialog:showOpenDialog", "dialog", args([objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("DIALOG_SHOW_SAVE", "dialog:showSaveDialog", "dialog", args([objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("DIALOG_SHOW_MESSAGE", "dialog:showMessageBox", "dialog", args([objectArg()])),
  defineRequest("SSH_KEY_GENERATE", "generateSSHKeyPair", "ssh-key", args([objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "credentials" }),
  defineRequest("SSH_KEY_SAVE", "saveSSHKey", "ssh-key", args([objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("UTILITY_IP_QUERY", "ip:query", "utility", args([stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "network" }),

  defineRequest("SETTINGS_LOAD_UI", "settings:loadUISettings", "settings", NO_ARGS_SCHEMA),
  defineRequest("SETTINGS_SAVE_UI", "settings:saveUISettings", "settings", args([objectArg()])),
  defineRequest("SETTINGS_LOAD_LOG", "settings:loadLogSettings", "settings", NO_ARGS_SCHEMA),
  defineRequest("SETTINGS_SAVE_LOG", "settings:saveLogSettings", "settings", args([objectArg()])),
  defineRequest("SETTINGS_GET_ERROR_REPORTING", "settings:getErrorReportingSettings", "settings", NO_ARGS_SCHEMA),
  defineRequest("SETTINGS_SAVE_ERROR_REPORTING", "settings:saveErrorReportingSettings", "settings", args([objectArg()])),
  defineRequest("SETTINGS_UPDATE_PREFETCH", "settings:updatePrefetchSettings", "settings", args([objectArg()])),
  defineRequest("SETTINGS_GET_CREDENTIAL_SECURITY_STATUS", "settings:getCredentialSecurityStatus", "settings", NO_ARGS_SCHEMA),
  defineRequest("SETTINGS_UPDATE_CREDENTIAL_SECURITY", "settings:updateCredentialSecurity", "settings", args([objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "credentials" }),
  defineRequest("SETTINGS_UNLOCK_CREDENTIAL_STORE", "settings:unlockCredentialStore", "settings", args([stringArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "credentials" }),
  defineRequest("SETTINGS_LOCK_CREDENTIAL_STORE", "settings:lockCredentialStore", "settings", NO_ARGS_SCHEMA, STANDARD_RESPONSE_SCHEMA, { permission: "credentials" }),
  defineRequest("SETTINGS_CLEAR_LOCAL_DATA", "settings:clearLocalData", "settings", args([objectArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineEvent("SETTINGS_LOCAL_DATA_CLEARED", "settings:localDataCleared", "settings", args([objectArg()])),
  defineRequest("SHORTCUT_COMMANDS_GET", "get-shortcut-commands", "settings", NO_ARGS_SCHEMA),
  defineRequest("SHORTCUT_COMMANDS_SAVE", "save-shortcut-commands", "settings", args([objectArg()])),
  defineRequest("COMMAND_HISTORY_ADD", "command-history:add", "settings", args([stringArg()])),
  defineRequest("COMMAND_HISTORY_GET_SUGGESTIONS", "command-history:getSuggestions", "settings", args([stringArg(), numberArg()], { minItems: 1, maxItems: 2 })),
  defineRequest("COMMAND_HISTORY_INCREMENT_USAGE", "command-history:incrementUsage", "settings", args([stringArg()])),
  defineRequest("COMMAND_HISTORY_CLEAR", "command-history:clear", "settings", NO_ARGS_SCHEMA),
  defineRequest("COMMAND_HISTORY_GET_STATISTICS", "command-history:getStatistics", "settings", NO_ARGS_SCHEMA),
  defineRequest("COMMAND_HISTORY_GET_ALL", "command-history:getAll", "settings", NO_ARGS_SCHEMA),
  defineRequest("COMMAND_HISTORY_DELETE", "command-history:delete", "settings", args([stringArg()])),
  defineRequest("COMMAND_HISTORY_DELETE_BATCH", "command-history:deleteBatch", "settings", args([arrayArg()])),
  defineEvent("COMMAND_HISTORY_CHANGED", "command-history:changed", "settings", args([objectArg()])),

  defineRequest("PROXY_GET_STATUS", "proxy:getStatus", "proxy", NO_ARGS_SCHEMA),
  defineRequest("PROXY_GET_DEFAULT_CONFIG", "proxy:getDefaultConfig", "proxy", NO_ARGS_SCHEMA),
  defineRequest("PROXY_SAVE_DEFAULT_CONFIG", "proxy:saveDefaultConfig", "proxy", args([objectArg()])),
  defineRequest("PROXY_GET_SYSTEM_CONFIG", "proxy:getSystemConfig", "proxy", NO_ARGS_SCHEMA),

  defineRequest("MEMORY_SAVE", "memory:save", "memory", args([objectArg()])),
  defineRequest("MEMORY_LOAD", "memory:load", "memory", NO_ARGS_SCHEMA),
  defineRequest("MEMORY_DELETE", "memory:delete", "memory", NO_ARGS_SCHEMA),
  defineRequest("MEMORY_GET_DIAGNOSTICS", "memory:getDiagnostics", "memory", NO_ARGS_SCHEMA),

  defineRequest("RUNTIME_FILES_CONFIGURE", "runtime-files:configure", "runtime-files", args([stringArg(), objectArg()], { minItems: 1, maxItems: 2 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("RUNTIME_FILES_RELEASE_PATH", "runtime-files:releasePath", "runtime-files", args([stringArg(), stringArg(), objectArg()], { minItems: 2, maxItems: 3 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("RUNTIME_FILES_CLEAR", "runtime-files:clear", "runtime-files", args([stringArg(), objectArg()], { minItems: 1, maxItems: 2 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),
  defineRequest("RUNTIME_FILES_SWEEP", "runtime-files:sweep", "runtime-files", args([stringArg(), objectArg()], { minItems: 1, maxItems: 2 }), STANDARD_RESPONSE_SCHEMA, { permission: "filesystem" }),

  defineRequest("IPC_BATCH_INVOKE", "ipc:batchInvoke", "ipc", args([arrayArg()]), STANDARD_RESPONSE_SCHEMA, { permission: "high-risk" }),
  defineEvent("IPC_BATCH_FORWARD", "ipc:batch-forward", "ipc", args([objectArg()]), { permission: "high-risk" }),
  defineEvent("TERMINAL_OUTPUT_BATCH", "terminal-output:batch", "ipc", args([arrayArg()])),
  defineEvent("FILE_CHANGE_BATCH", "file-change:batch", "ipc", args([arrayArg()])),
  defineEvent("LOG_MESSAGE_BATCH", "log-message:batch", "ipc", args([arrayArg()])),
]);

const channelDefinitionsByKey = new Map();
const channelDefinitionsByChannel = new Map();
const dynamicChannelDefinitions = [];

function buildDynamicChannelMatcher(channel) {
  if (typeof channel !== "string" || !channel.includes("*")) {
    return null;
  }

  const escaped = channel
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".+");

  return new RegExp(`^${escaped}$`);
}

for (const definition of IPC_CHANNEL_DEFINITIONS) {
  if (channelDefinitionsByKey.has(definition.key)) {
    throw new Error(`Duplicate IPC channel key: ${definition.key}`);
  }
  if (!definition.dynamic && channelDefinitionsByChannel.has(definition.channel)) {
    throw new Error(`Duplicate IPC channel: ${definition.channel}`);
  }
  channelDefinitionsByKey.set(definition.key, definition);
  if (!definition.dynamic) {
    channelDefinitionsByChannel.set(definition.channel, definition);
  } else {
    dynamicChannelDefinitions.push({
      definition,
      matcher: buildDynamicChannelMatcher(definition.channel),
    });
  }
}

function getChannelDefinition(channelOrKey) {
  const staticDefinition =
    channelDefinitionsByKey.get(channelOrKey) ||
    channelDefinitionsByChannel.get(channelOrKey) ||
    null;

  if (staticDefinition) {
    return staticDefinition;
  }

  for (const { definition, matcher } of dynamicChannelDefinitions) {
    if (matcher && matcher.test(channelOrKey)) {
      return definition;
    }
  }

  return null;
}

function getRequestChannelDefinition(channelOrKey) {
  const definition = getChannelDefinition(channelOrKey);
  return definition && definition.type === "request" ? definition : null;
}

function getEventChannelDefinition(channelOrKey) {
  const definition = getChannelDefinition(channelOrKey);
  return definition && definition.type === "event" ? definition : null;
}

function toChannelMap(type) {
  const entries = {};
  for (const definition of IPC_CHANNEL_DEFINITIONS) {
    if (definition.type === type) {
      entries[definition.key] = definition.channel;
    }
  }
  return Object.freeze(entries);
}

const IPC_REQUEST_CHANNELS = toChannelMap("request");
const IPC_EVENT_CHANNELS = toChannelMap("event");

function buildDynamicEventChannel(key, value) {
  const pattern = IPC_EVENT_CHANNELS[key];
  if (typeof pattern !== "string" || !pattern.includes("*")) {
    return null;
  }
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return pattern.replace("*", String(value));
}

function getUploadProgressChannel(token) {
  return buildDynamicEventChannel("DYNAMIC_UPLOAD_PROGRESS", token);
}

function getUploadFolderProgressChannel(token) {
  return buildDynamicEventChannel("DYNAMIC_UPLOAD_FOLDER_PROGRESS", token);
}

function getUploadDroppedProgressChannel(token) {
  return buildDynamicEventChannel("DYNAMIC_UPLOAD_DROPPED_PROGRESS", token);
}

function getTerminalMailboxOutputChannel(processId) {
  return buildDynamicEventChannel("TERMINAL_IO_MAILBOX_OUTPUT", processId);
}

function getTerminalProcessOutputChannel(processId) {
  return buildDynamicEventChannel("TERMINAL_PROCESS_OUTPUT", processId);
}

function getTerminalProcessExitChannel(processId) {
  return buildDynamicEventChannel("TERMINAL_PROCESS_EXIT", processId);
}

module.exports = {
  ANY_ARGS_SCHEMA,
  IPC_CHANNEL_DEFINITIONS,
  IPC_EVENT_CHANNELS,
  IPC_REQUEST_CHANNELS,
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  getChannelDefinition,
  getEventChannelDefinition,
  getRequestChannelDefinition,
  getTerminalMailboxOutputChannel,
  getTerminalProcessExitChannel,
  getTerminalProcessOutputChannel,
  getUploadDroppedProgressChannel,
  getUploadFolderProgressChannel,
  getUploadProgressChannel,
};
