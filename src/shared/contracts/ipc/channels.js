// @ts-check
/**
 * Single source of truth for every IPC channel (public entry point).
 *
 * Definitions live in per-domain modules under ./domains; schema helpers live in
 * ./schema.js. This module combines them, indexes them by key/channel and
 * exposes the channel maps and lookups that main, preload and tests import.
 * New channels go into the matching domain module; nothing else needs editing.
 *
 * @import { IpcChannelDefinition, IpcRequestDefinition, IpcEventDefinition } from "./schema"
 * @import { IpcRequestChannelMap, IpcEventChannelMap, IpcDynamicEventKey } from "./types"
 */

const {
  ANY_ARGS_SCHEMA,
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
} = require("./schema");
const { APP_CHANNEL_DEFINITIONS } = require("./domains/app");
const { AI_CHANNEL_DEFINITIONS } = require("./domains/ai");
const { TERMINAL_CHANNEL_DEFINITIONS } = require("./domains/terminal");
const { CONNECTION_CHANNEL_DEFINITIONS } = require("./domains/connection");
const { FILES_CHANNEL_DEFINITIONS } = require("./domains/files");
const { TRANSFERS_CHANNEL_DEFINITIONS } = require("./domains/transfers");
const { SETTINGS_CHANNEL_DEFINITIONS } = require("./domains/settings");
const { BATCH_CHANNEL_DEFINITIONS } = require("./domains/batch");

// Dynamic channels are matched in this order; keep terminal before transfers.
const IPC_CHANNEL_DEFINITIONS = Object.freeze([
  ...APP_CHANNEL_DEFINITIONS,
  ...AI_CHANNEL_DEFINITIONS,
  ...TERMINAL_CHANNEL_DEFINITIONS,
  ...CONNECTION_CHANNEL_DEFINITIONS,
  ...FILES_CHANNEL_DEFINITIONS,
  ...TRANSFERS_CHANNEL_DEFINITIONS,
  ...SETTINGS_CHANNEL_DEFINITIONS,
  ...BATCH_CHANNEL_DEFINITIONS,
]);

/** @type {Map<string, IpcChannelDefinition>} */
const channelDefinitionsByKey = new Map();
/** @type {Map<string, IpcChannelDefinition>} */
const channelDefinitionsByChannel = new Map();
/** @type {{ definition: IpcChannelDefinition, matcher: RegExp | null }[]} */
const dynamicChannelDefinitions = [];

/**
 * @param {unknown} channel
 * @returns {RegExp | null}
 */
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

for (const definition of /** @type {readonly IpcChannelDefinition[]} */ (
  IPC_CHANNEL_DEFINITIONS
)) {
  if (channelDefinitionsByKey.has(definition.key)) {
    throw new Error(`Duplicate IPC channel key: ${definition.key}`);
  }
  if (
    !("dynamic" in definition && definition.dynamic) &&
    channelDefinitionsByChannel.has(definition.channel)
  ) {
    throw new Error(`Duplicate IPC channel: ${definition.channel}`);
  }
  channelDefinitionsByKey.set(definition.key, definition);
  if (!("dynamic" in definition && definition.dynamic)) {
    channelDefinitionsByChannel.set(definition.channel, definition);
  } else {
    dynamicChannelDefinitions.push({
      definition,
      matcher: buildDynamicChannelMatcher(definition.channel),
    });
  }
}

/**
 * Looks up a definition by constant key, static channel, or a concrete
 * instance of a dynamic channel (e.g. `process:exit:42`).
 * @param {string} channelOrKey
 * @returns {IpcChannelDefinition | null}
 */
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

/**
 * @param {string} channelOrKey
 * @returns {IpcRequestDefinition | null}
 */
function getRequestChannelDefinition(channelOrKey) {
  const definition = getChannelDefinition(channelOrKey);
  return definition && definition.type === "request" ? definition : null;
}

/**
 * @param {string} channelOrKey
 * @returns {IpcEventDefinition | null}
 */
function getEventChannelDefinition(channelOrKey) {
  const definition = getChannelDefinition(channelOrKey);
  return definition && definition.type === "event" ? definition : null;
}

/**
 * @param {"request" | "event"} type
 * @returns {Readonly<Record<string, string>>}
 */
function toChannelMap(type) {
  /** @type {Record<string, string>} */
  const entries = {};
  for (const definition of IPC_CHANNEL_DEFINITIONS) {
    if (definition.type === type) {
      entries[definition.key] = definition.channel;
    }
  }
  return Object.freeze(entries);
}

// The casts give each map its literal key → channel type derived from the
// definitions (see ./types.d.ts); the runtime objects are unchanged.
const IPC_REQUEST_CHANNELS = /** @type {IpcRequestChannelMap} */ (
  toChannelMap("request")
);
const IPC_EVENT_CHANNELS = /** @type {IpcEventChannelMap} */ (
  toChannelMap("event")
);

/**
 * Replaces the `*` in a dynamic event channel with `value`.
 * @param {IpcDynamicEventKey} key
 * @param {unknown} value
 * @returns {string | null} null when the key is not dynamic or value is empty.
 */
function buildDynamicEventChannel(key, value) {
  /** @type {string | undefined} */
  const pattern = IPC_EVENT_CHANNELS[key];
  if (typeof pattern !== "string" || !pattern.includes("*")) {
    return null;
  }
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return pattern.replace("*", String(value));
}

/**
 * @param {unknown} token
 * @returns {string | null}
 */
function getUploadProgressChannel(token) {
  return buildDynamicEventChannel("DYNAMIC_UPLOAD_PROGRESS", token);
}

/**
 * @param {unknown} token
 * @returns {string | null}
 */
function getUploadFolderProgressChannel(token) {
  return buildDynamicEventChannel("DYNAMIC_UPLOAD_FOLDER_PROGRESS", token);
}

/**
 * @param {unknown} token
 * @returns {string | null}
 */
function getUploadDroppedProgressChannel(token) {
  return buildDynamicEventChannel("DYNAMIC_UPLOAD_DROPPED_PROGRESS", token);
}

/**
 * @param {unknown} processId
 * @returns {string | null}
 */
function getTerminalMailboxOutputChannel(processId) {
  return buildDynamicEventChannel("TERMINAL_IO_MAILBOX_OUTPUT", processId);
}

/**
 * @param {unknown} processId
 * @returns {string | null}
 */
function getTerminalProcessOutputChannel(processId) {
  return buildDynamicEventChannel("TERMINAL_PROCESS_OUTPUT", processId);
}

/**
 * @param {unknown} processId
 * @returns {string | null}
 */
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
