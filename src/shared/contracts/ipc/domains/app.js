// @ts-check
/**
 * IPC channels for window chrome, app lifecycle/updates/diagnostics,
 * clipboard, native dialogs and small utilities
 * (categories: window, app, clipboard, dialog, utility).
 *
 * @import { OpenDialogReturnValue, SaveDialogReturnValue, MessageBoxReturnValue } from "electron"
 * @import { IpcResult, WindowState } from "../../preload"
 */

/**
 * APP_OPEN_EXTERNAL argument (schema: url 1-2048 chars, source <= 64 chars).
 * @typedef {object} ExternalOpenRequest
 * @property {string} url
 * @property {string} [source]
 * @property {boolean} [allowRestrictedProtocols]
 */

/**
 * `{ success: true, ... }` envelope returned by app/clipboard handlers.
 * @template {object} [T={}]
 * @typedef {{ success: true } & T} SuccessEnvelope
 */

/**
 * Responses whose shape main guarantees (src/main/ipc/handlers/{window,app,
 * dialog}Handlers.js); unlisted channels resolve to unknown. Any request can
 * also resolve to the safeHandle failure envelope, hence IpcResult.
 * @typedef {object} AppResponses
 * @property {IpcResult<boolean>} WINDOW_MINIMIZE false when no window exists.
 * @property {IpcResult<WindowState | false>} WINDOW_TOGGLE_MAXIMIZE
 * @property {IpcResult<boolean>} WINDOW_CLOSE
 * @property {IpcResult<WindowState>} WINDOW_GET_STATE
 * @property {IpcResult<SuccessEnvelope<{ version: string }>>} APP_GET_VERSION
 * @property {IpcResult<SuccessEnvelope<{ text: string }>>} CLIPBOARD_READ_TEXT
 * @property {IpcResult<SuccessEnvelope>} CLIPBOARD_WRITE_TEXT
 * @property {IpcResult<SuccessEnvelope>} APP_OPEN_EXTERNAL
 * @property {IpcResult<OpenDialogReturnValue>} DIALOG_SHOW_OPEN
 * @property {IpcResult<SaveDialogReturnValue>} DIALOG_SHOW_SAVE
 * @property {IpcResult<MessageBoxReturnValue>} DIALOG_SHOW_MESSAGE
 */

const {
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  defineEvent,
  defineRequest,
  objectArg,
  objectPayloadArgs,
  optionalObjectArg,
  stringArg,
} = require("../schema");

const APP_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest("WINDOW_MINIMIZE", "window:minimize", "window", NO_ARGS_SCHEMA),
  defineRequest(
    "WINDOW_TOGGLE_MAXIMIZE",
    "window:toggleMaximize",
    "window",
    NO_ARGS_SCHEMA,
  ),
  defineRequest("WINDOW_CLOSE", "window:close", "window", NO_ARGS_SCHEMA),
  defineRequest(
    "WINDOW_GET_STATE",
    "window:getState",
    "window",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "WINDOW_NOTIFY_READY",
    "window:notifyReady",
    "window",
    NO_ARGS_SCHEMA,
  ),
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
    "APP_REBUILD_SYSTEM_MENU",
    "app:rebuildSystemMenu",
    "app",
    NO_ARGS_SCHEMA,
  ),
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
  defineRequest(
    "APP_CHECK_FOR_UPDATE",
    "app:checkForUpdate",
    "app",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "APP_DOWNLOAD_UPDATE",
    "app:downloadUpdate",
    "app",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "APP_INSTALL_UPDATE",
    "app:installUpdate",
    "app",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "APP_GET_DOWNLOAD_PROGRESS",
    "app:getDownloadProgress",
    "app",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "APP_CANCEL_DOWNLOAD",
    "app:cancelDownload",
    "app",
    NO_ARGS_SCHEMA,
  ),
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
  defineRequest(
    "DIALOG_SHOW_OPEN",
    "dialog:showOpenDialog",
    "dialog",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "DIALOG_SHOW_SAVE",
    "dialog:showSaveDialog",
    "dialog",
    args([objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "DIALOG_SHOW_MESSAGE",
    "dialog:showMessageBox",
    "dialog",
    args([objectArg()]),
  ),
  defineRequest(
    "UTILITY_IP_QUERY",
    "ip:query",
    "utility",
    args([stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "network" },
  ),
]);

module.exports = { APP_CHANNEL_DEFINITIONS };
