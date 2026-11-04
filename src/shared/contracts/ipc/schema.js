// @ts-check
/**
 * Building blocks for the IPC channel registry: JSON Schema fragments (validated
 * by Ajv in src/main/ipc/schema/validator.js) and the define* factories used by
 * the per-domain modules in ./domains. Runtime values are plain JSON Schema;
 * the JSDoc generics only keep literal keys/channels/schemas visible to `tsc`
 * so ./types.d.ts can derive argument tuples from them.
 *
 * @import { JsonSchema, ArgsSchema, ArgsOptions, MinItemsOf, ObjectPayloadSchema } from "./types"
 */

/**
 * Who may trigger the channel; informs auditing in the main process.
 * @typedef {"internal" | "filesystem" | "clipboard" | "network" | "credentials" | "process-control" | "high-risk"} IpcPermission
 */

/**
 * @typedef {object} IpcDefinitionOptions
 * @property {IpcPermission} [permission] Defaults to "internal".
 * @property {boolean} [dynamic] Event channel contains a `*` placeholder.
 */

/**
 * Renderer → main request handled with `ipcMain.handle`.
 * @template {string} [K=string]
 * @template {string} [C=string]
 * @template {JsonSchema} [Req=JsonSchema]
 * @typedef {object} IpcRequestDefinition
 * @property {K} key Constant name exported in IPC_REQUEST_CHANNELS.
 * @property {C} channel Wire channel name.
 * @property {string} category Module label used in logs/IPC traces.
 * @property {"request"} type
 * @property {Req} requestSchema Schema for the invoke argument array.
 * @property {JsonSchema} responseSchema
 * @property {IpcPermission} permission
 */

/**
 * Fire-and-forget message (`send`/`webContents.send`) in either direction.
 * @template {string} [K=string]
 * @template {string} [C=string]
 * @template {JsonSchema} [P=JsonSchema]
 * @typedef {object} IpcEventDefinition
 * @property {K} key Constant name exported in IPC_EVENT_CHANNELS.
 * @property {C} channel Wire channel name; `*` marks a dynamic segment.
 * @property {string} category
 * @property {"event"} type
 * @property {P} payloadSchema Schema for the listener argument array.
 * @property {IpcPermission} permission
 * @property {boolean} dynamic
 */

/** @typedef {IpcRequestDefinition | IpcEventDefinition} IpcChannelDefinition */

/** Accepts any value. */
const ANY_SCHEMA = Object.freeze({});
/** Accepts any argument list. */
const ANY_ARGS_SCHEMA = Object.freeze({
  type: /** @type {const} */ ("array"),
  items: ANY_SCHEMA,
});

/** Accepts only an empty argument list. */
const NO_ARGS_SCHEMA = Object.freeze({
  type: /** @type {const} */ ("array"),
  maxItems: /** @type {const} */ (0),
});

/**
 * Response schema shared by handlers: any JSON value or an envelope object.
 * @type {Readonly<JsonSchema>}
 */
const STANDARD_RESPONSE_SCHEMA = Object.freeze(
  /** @type {const} */ ({
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
  }),
);

/** @returns {{ type: "string" }} */
const stringArg = () => ({ type: "string" });
/** Optional/untyped argument: any value, including undefined. */
const optionalObjectArg = () => ANY_SCHEMA;
/** @returns {{ type: "object", additionalProperties: true }} */
const objectArg = () => ({ type: "object", additionalProperties: true });
/** @returns {{ type: "array", items: typeof ANY_SCHEMA }} */
const arrayArg = () => ({ type: "array", items: ANY_SCHEMA });
/** @returns {{ type: "boolean" }} */
const booleanArg = () => ({ type: "boolean" });
/** @returns {{ type: "number" }} */
const numberArg = () => ({ type: "number" });

/**
 * Positional argument list. Without options every item is required.
 * @template {readonly JsonSchema[]} const T
 * @template {ArgsOptions} [const O={}]
 * @param {T} items
 * @param {O} [options]
 * @returns {ArgsSchema<T, MinItemsOf<T, O>>}
 */
const args = (items, options = /** @type {O} */ ({})) =>
  // The cast only carries the literal minItems computed below into the type.
  /** @type {ArgsSchema<T, MinItemsOf<T, O>>} */ ({
    type: "array",
    minItems: options.minItems ?? items.length,
    maxItems: options.maxItems ?? items.length,
    items,
  });

/**
 * A single object argument whose `required` keys must be present.
 * @template {readonly string[]} const R
 * @template {Readonly<Record<string, JsonSchema>>} [const P={}]
 * @param {R} [required]
 * @param {P} [properties]
 * @returns {ArgsSchema<readonly [ObjectPayloadSchema<R, P>], 1>}
 */
const objectPayloadArgs = (
  required = /** @type {R} */ (/** @type {readonly string[]} */ ([])),
  properties = /** @type {P} */ ({}),
) =>
  args([
    {
      type: "object",
      required,
      properties,
      additionalProperties: true,
    },
  ]);

/**
 * @template {string} K
 * @template {string} C
 * @template {JsonSchema} [Req=typeof ANY_ARGS_SCHEMA]
 * @param {K} key
 * @param {C} channel
 * @param {string} category
 * @param {Req} [requestSchema]
 * @param {JsonSchema} [responseSchema]
 * @param {IpcDefinitionOptions} [options]
 * @returns {IpcRequestDefinition<K, C, Req>}
 */
const defineRequest = (
  key,
  channel,
  category,
  requestSchema = /** @type {Req} */ (ANY_ARGS_SCHEMA),
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

/**
 * @template {string} K
 * @template {string} C
 * @template {JsonSchema} [P=typeof ANY_ARGS_SCHEMA]
 * @param {K} key
 * @param {C} channel
 * @param {string} category
 * @param {P} [payloadSchema]
 * @param {IpcDefinitionOptions} [options]
 * @returns {IpcEventDefinition<K, C, P>}
 */
const defineEvent = (
  key,
  channel,
  category,
  payloadSchema = /** @type {P} */ (ANY_ARGS_SCHEMA),
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

module.exports = {
  ANY_ARGS_SCHEMA,
  ANY_SCHEMA,
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  booleanArg,
  defineEvent,
  defineRequest,
  numberArg,
  objectArg,
  objectPayloadArgs,
  optionalObjectArg,
  stringArg,
};
