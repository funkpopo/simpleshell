// @ts-check
/**
 * IPC channels for remote/local file operations, directory listing and
 * watching, SFTP editor content and snapshots, external editor sync and
 * runtime file housekeeping (categories: file, sftp, runtime-files).
 *
 * @import { IpcResult } from "../../preload"
 */

/**
 * FILE_LIST response. Non-blocking listings return `{ chunked: true, token }`
 * immediately and stream items over FILE_LIST_CHUNK; otherwise the native
 * SFTP result is passed through.
 * @typedef {object} FileListResponse
 * @property {boolean} [success]
 * @property {unknown} [data]
 * @property {boolean} [chunked]
 * @property {string} [token]
 */

/**
 * Responses whose shape main guarantees (fileHandlers.js); unlisted channels
 * resolve to unknown.
 * @typedef {object} FileResponses
 * @property {IpcResult<FileListResponse>} FILE_LIST
 */

const {
  ANY_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  booleanArg,
  defineEvent,
  defineRequest,
  objectArg,
  optionalObjectArg,
  stringArg,
} = require("../schema");

const FILES_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest(
    "FILE_LIST",
    "listFiles",
    "file",
    args([{}, stringArg(), optionalObjectArg(), stringArg()], {
      minItems: 2,
      maxItems: 4,
    }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_COPY",
    "copyFile",
    "file",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_MOVE",
    "moveFile",
    "file",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_DELETE",
    "deleteFile",
    "file",
    args([{}, stringArg(), booleanArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CREATE_FOLDER",
    "createFolder",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CREATE",
    "createFile",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_RENAME",
    "renameFile",
    "file",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_GET_PERMISSIONS",
    "getFilePermissions",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_GET_PERMISSIONS_BATCH",
    "getFilePermissionsBatch",
    "file",
    args([{}, arrayArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_SET_PERMISSIONS",
    "setFilePermissions",
    "file",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_SET_OWNERSHIP",
    "setFileOwnership",
    "file",
    args([{}, stringArg(), {}, {}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_GET_ABSOLUTE_PATH",
    "getAbsolutePath",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CHECK_PATH_EXISTS",
    "checkPathExists",
    "file",
    args([stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_SHOW_ITEM_IN_FOLDER",
    "showItemInFolder",
    "file",
    args([stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CANCEL_LIST",
    "cancelListFiles",
    "file",
    args([{}, {}], { minItems: 1, maxItems: 2 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_START_DIRECTORY_WATCH",
    "startDirectoryWatch",
    "file",
    args([{}, stringArg(), optionalObjectArg()], { minItems: 2, maxItems: 3 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_STOP_DIRECTORY_WATCH",
    "stopDirectoryWatch",
    "file",
    args([{}, {}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CREATE_REMOTE_FOLDERS",
    "createRemoteFolders",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineEvent(
    "FILE_LIST_CHUNK",
    "listFiles:chunk",
    "file",
    args([objectArg()]),
  ),
  defineEvent(
    "DIRECTORY_WATCH_EVENT",
    "directory-watch:event",
    "file",
    args([objectArg()]),
  ),
  // Deprecated metadata/queue compatibility channels. Native commands own
  // their sessions and scheduling; these do not create or close SFTP sessions.
  defineRequest(
    "SFTP_GET_SESSION",
    "getSftpSession",
    "sftp",
    args([{}]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_ENQUEUE_OPERATION",
    "enqueueSftpOperation",
    "sftp",
    ANY_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_PROCESS_QUEUE",
    "processSftpQueue",
    "sftp",
    ANY_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_READ_FILE_CONTENT",
    "readFileContent",
    "sftp",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_READ_FILE_BASE64",
    "readFileAsBase64",
    "sftp",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_SAVE_FILE_CONTENT",
    "saveFileContent",
    "sftp",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_LIST_FILE_SNAPSHOTS",
    "listFileSnapshots",
    "sftp",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_CREATE_FILE_SNAPSHOT",
    "createFileSnapshot",
    "sftp",
    args([{}, stringArg(), stringArg(), optionalObjectArg()], {
      minItems: 3,
      maxItems: 4,
    }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_GET_FILE_SNAPSHOT",
    "getFileSnapshot",
    "sftp",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "SFTP_RESTORE_FILE_SNAPSHOT",
    "restoreFileSnapshot",
    "sftp",
    args([{}, stringArg(), stringArg(), {}], { minItems: 3, maxItems: 4 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineEvent(
    "EXTERNAL_EDITOR_SYNC",
    "external-editor:sync",
    "sftp",
    args([objectArg()]),
  ),
  defineRequest(
    "EXTERNAL_EDITOR_OPEN",
    "external-editor:open",
    "sftp",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "RUNTIME_FILES_CONFIGURE",
    "runtime-files:configure",
    "runtime-files",
    args([stringArg(), objectArg()], { minItems: 1, maxItems: 2 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "RUNTIME_FILES_RELEASE_PATH",
    "runtime-files:releasePath",
    "runtime-files",
    args([stringArg(), stringArg(), objectArg()], { minItems: 2, maxItems: 3 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "RUNTIME_FILES_CLEAR",
    "runtime-files:clear",
    "runtime-files",
    args([stringArg(), objectArg()], { minItems: 1, maxItems: 2 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "RUNTIME_FILES_SWEEP",
    "runtime-files:sweep",
    "runtime-files",
    args([stringArg(), objectArg()], { minItems: 1, maxItems: 2 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
]);

module.exports = { FILES_CHANNEL_DEFINITIONS };
