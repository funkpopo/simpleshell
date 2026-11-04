// @ts-check
/**
 * IPC channels for AI assistant settings, API configs, prompt streaming and the
 * assistant memory store (categories: ai, memory).
 */

/**
 * No AI response shape is fixed by main yet; all resolve to unknown.
 * @typedef {{}} AiResponses
 */

const {
  NO_ARGS_SCHEMA,
  STANDARD_RESPONSE_SCHEMA,
  args,
  arrayArg,
  booleanArg,
  defineEvent,
  defineRequest,
  objectArg,
  stringArg,
} = require("../schema");

const AI_CHANNEL_DEFINITIONS = Object.freeze([
  defineRequest("AI_LOAD_SETTINGS", "ai:loadSettings", "ai", NO_ARGS_SCHEMA),
  defineRequest(
    "AI_SAVE_SETTINGS",
    "ai:saveSettings",
    "ai",
    args([objectArg()]),
  ),
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
  defineRequest(
    "AI_ABORT_API_REQUEST",
    "ai:abortAPIRequest",
    "ai",
    args([stringArg()]),
  ),
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
  defineRequest(
    "AI_GET_PROXY_CONFIG",
    "ai:getProxyConfig",
    "ai",
    NO_ARGS_SCHEMA,
  ),
  defineRequest(
    "AI_SAVE_PROXY_CONFIG",
    "ai:saveProxyConfig",
    "ai",
    args([objectArg()]),
  ),
  defineEvent("AI_STREAM_CHUNK", "stream-chunk", "ai", args([objectArg()])),
  defineEvent("AI_STREAM_END", "stream-end", "ai", args([objectArg()])),
  defineEvent("AI_STREAM_ERROR", "stream-error", "ai", args([objectArg()])),
  defineRequest("MEMORY_SAVE", "memory:save", "memory", args([objectArg()])),
  defineRequest("MEMORY_LOAD", "memory:load", "memory", NO_ARGS_SCHEMA),
  defineRequest("MEMORY_DELETE", "memory:delete", "memory", NO_ARGS_SCHEMA),
  defineRequest(
    "MEMORY_GET_DIAGNOSTICS",
    "memory:getDiagnostics",
    "memory",
    NO_ARGS_SCHEMA,
  ),
]);

module.exports = { AI_CHANNEL_DEFINITIONS };
