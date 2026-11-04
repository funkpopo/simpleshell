// @ts-check
/**
 * IPC channels for uploads, downloads, resumable transfers, integrity checks
 * and their progress events (category: file).
 */

/**
 * FILE_TRANSFER_INTEGRITY hash algorithm.
 * @typedef {"md5" | "sha256"} TransferIntegrityAlgorithm
 */

/**
 * No transfer response shape is fixed by main yet; all resolve to unknown.
 * @typedef {{}} TransferResponses
 */

const {
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  defineEvent,
  defineRequest,
  numberArg,
  objectArg,
  stringArg,
} = require("../schema");

const TRANSFERS_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest(
    "FILE_LIST_RESUMABLE",
    "file:list-resumable",
    "file",
    NO_ARGS_SCHEMA,
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_RESUME_TRANSFER",
    "file:resume-transfer",
    "file",
    args([{}, stringArg(), objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_DISCARD_RESUMABLE",
    "file:discard-resumable",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_TRANSFER_INTEGRITY",
    "file:transfer-integrity",
    "file",
    args([{}, stringArg(), { enum: ["md5", "sha256"] }]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineEvent(
    "SFTP_TRANSFER_STATE",
    "sftp:transfer-state",
    "file",
    args([objectArg()]),
  ),
  defineRequest(
    "FILE_DOWNLOAD",
    "downloadFile",
    "file",
    args([{}, stringArg(), numberArg()], { minItems: 2, maxItems: 3 }),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_DOWNLOAD_FILES",
    "downloadFiles",
    "file",
    args([{}, arrayArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_DOWNLOAD_FOLDER",
    "downloadFolder",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CANCEL_TRANSFER",
    "cancelTransfer",
    "file",
    args([{}, stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_UPLOAD",
    "uploadFile",
    "file",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_UPLOAD_DROPPED",
    "uploadDroppedFiles",
    "file",
    args([{}, stringArg(), objectArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_UPLOAD_FOLDER",
    "upload-folder",
    "file",
    args([{}, stringArg(), stringArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_VALIDATE_DROPPED_ITEMS",
    "validateDroppedItems",
    "file",
    args([arrayArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineRequest(
    "FILE_CHECK_DROPPED_UPLOAD_CONFLICTS",
    "checkDroppedUploadConflicts",
    "file",
    args([{}, stringArg(), objectArg()]),
    STANDARD_RESPONSE_SCHEMA,
    { permission: "filesystem" },
  ),
  defineEvent(
    "DOWNLOAD_PROGRESS",
    "download-progress",
    "file",
    args([objectArg()]),
  ),
  defineEvent(
    "DOWNLOAD_FOLDER_PROGRESS",
    "download-folder-progress",
    "file",
    args([objectArg()]),
  ),
  defineEvent(
    "TRANSFER_PROGRESS",
    "transfer-progress",
    "file",
    args([objectArg()]),
  ),
  defineEvent(
    "TRANSFER_PROGRESS_BATCH",
    "transfer-progress:batch",
    "file",
    args([arrayArg()]),
  ),
  defineEvent(
    "DYNAMIC_UPLOAD_PROGRESS",
    "upload-progress-*",
    "file",
    args([objectArg()]),
    { dynamic: true },
  ),
  defineEvent(
    "DYNAMIC_UPLOAD_FOLDER_PROGRESS",
    "upload-folder-progress-*",
    "file",
    args([objectArg()]),
    { dynamic: true },
  ),
  defineEvent(
    "DYNAMIC_UPLOAD_DROPPED_PROGRESS",
    "upload-dropped-progress-*",
    "file",
    args([objectArg()]),
    { dynamic: true },
  ),
]);

module.exports = { TRANSFERS_CHANNEL_DEFINITIONS };
