const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC_DIR = path.join(ROOT, "src");
const {
  IPC_CHANNEL_DEFINITIONS,
  getChannelDefinition,
} = require(path.join(ROOT, "src/core/ipc/schema/channels"));
const { validateSchema } = require(path.join(
  ROOT,
  "src/core/ipc/schema/validator",
));

const IPC_STRING_PATTERNS = [
  {
    kind: "handler-channel",
    re: /channel:\s*["']([^"']+)["']/g,
  },
  {
    kind: "safe-handle",
    re: /safeHandle\([^\n]*?,\s*["']([^"']+)["']/g,
  },
  {
    kind: "safe-on",
    re: /safeOn\([^\n]*?,\s*["']([^"']+)["']/g,
  },
  {
    kind: "ipc-main-on",
    re: /ipcMain\.on\(\s*["']([^"']+)["']/g,
  },
  {
    kind: "ipc-renderer",
    re: /ipcRenderer\.(?:invoke|send|on|removeListener|removeAllListeners)\(\s*["']([^"']+)["']/g,
  },
  {
    kind: "webcontents-send",
    re: /(?:webContents|sender)\.send\(\s*["']([^"']+)["']/g,
  },
  {
    kind: "terminal-api-listener",
    re: /window\.terminalAPI\.(?:on|off|removeListener)\(\s*["']([^"']+)["']/g,
  },
  {
    kind: "progress-channel-property",
    re: /progressChannel:\s*["']([^"']+)["']/g,
  },
];

const FORBIDDEN_IPC_PATTERNS = [
  {
    kind: "undeclared-channel-option",
    re: /\ballowUndeclared\b/g,
  },
  {
    kind: "legacy-channel-alias",
    re: /\blegacyAliasFor\b/g,
  },
  {
    kind: "safe-handle-legacy-signature",
    re: /safeHandle\(\s*["'][^"']+["']\s*,/g,
  },
  {
    kind: "safe-on-legacy-signature",
    re: /safeOn\(\s*["'][^"']+["']\s*,/g,
  },
  {
    kind: "ipc-main-static-channel",
    re: /ipcMain\.(?:handle|on)\(\s*["'][^"']+["']/g,
  },
  {
    kind: "ipc-renderer-static-channel",
    re: /ipcRenderer\.(?:invoke|send|on|removeListener|removeAllListeners)\(\s*["'][^"']+["']/g,
  },
  {
    kind: "webcontents-static-channel",
    re: /(?:webContents|sender)\.send\(\s*["'][^"']+["']/g,
  },
];

function walkJavaScriptFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".webpack") {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkJavaScriptFiles(entryPath, files);
      continue;
    }

    if (/\.(js|jsx)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function findStaticIpcChannels() {
  const found = [];
  for (const file of walkJavaScriptFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    for (const { kind, re } of IPC_STRING_PATTERNS) {
      let match;
      while ((match = re.exec(source))) {
        found.push({
          kind,
          channel: match[1],
          file: path.relative(ROOT, file),
        });
      }
    }
  }

  return found;
}

function findForbiddenIpcPatterns() {
  const found = [];
  for (const file of walkJavaScriptFiles(SRC_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    for (const { kind, re } of FORBIDDEN_IPC_PATTERNS) {
      let match;
      while ((match = re.exec(source))) {
        found.push({
          kind,
          text: match[0],
          file: path.relative(ROOT, file),
        });
      }
    }
  }

  return found;
}

function assertDefinitionsAreComplete() {
  assert.ok(
    Array.isArray(IPC_CHANNEL_DEFINITIONS),
    "IPC channel definitions must be exported as an array",
  );
  assert.ok(
    IPC_CHANNEL_DEFINITIONS.length > 0,
    "IPC channel definitions must not be empty",
  );

  const keys = new Set();
  const staticChannels = new Set();

  for (const definition of IPC_CHANNEL_DEFINITIONS) {
    assert.equal(typeof definition.key, "string", "definition key is required");
    assert.equal(
      typeof definition.channel,
      "string",
      `definition ${definition.key} channel is required`,
    );
    assert.match(
      definition.type,
      /^(request|event)$/,
      `${definition.key} must be request or event`,
    );
    assert.equal(
      keys.has(definition.key),
      false,
      `duplicate IPC definition key: ${definition.key}`,
    );
    keys.add(definition.key);

    if (!definition.dynamic) {
      assert.equal(
        staticChannels.has(definition.channel),
        false,
        `duplicate static IPC channel: ${definition.channel}`,
      );
      staticChannels.add(definition.channel);
    }

    if (definition.type === "request") {
      assert.ok(
        definition.requestSchema,
        `${definition.key} is missing requestSchema`,
      );
      assert.doesNotThrow(
        () => validateSchema(definition.requestSchema, undefined),
        `${definition.key} requestSchema must compile`,
      );
      assert.ok(
        definition.responseSchema,
        `${definition.key} is missing responseSchema`,
      );
      assert.doesNotThrow(
        () => validateSchema(definition.responseSchema, undefined),
        `${definition.key} responseSchema must compile`,
      );
    } else {
      assert.ok(
        definition.payloadSchema,
        `${definition.key} is missing payloadSchema`,
      );
      assert.doesNotThrow(
        () => validateSchema(definition.payloadSchema, undefined),
        `${definition.key} payloadSchema must compile`,
      );
    }

    assert.ok(
      definition.category,
      `${definition.key} must declare an IPC category`,
    );
    assert.ok(
      definition.permission,
      `${definition.key} must declare a permission level`,
    );
  }
}

function assertStaticChannelsAreDeclared() {
  const found = findStaticIpcChannels();
  const missing = found.filter(({ channel }) => !getChannelDefinition(channel));

  assert.deepEqual(
    missing,
    [],
    `Found undeclared static IPC channels:\n${missing
      .map(({ file, kind, channel }) => `- ${file} ${kind}: ${channel}`)
      .join("\n")}`,
  );
}

function assertNoStaticIpcStringUsage() {
  const found = findStaticIpcChannels();

  assert.deepEqual(
    found,
    [],
    `Static IPC channel strings are not allowed outside src/core/ipc/schema/channels.js:\n${found
      .map(({ file, kind, channel }) => `- ${file} ${kind}: ${channel}`)
      .join("\n")}`,
  );
}

function assertNoForbiddenIpcPatterns() {
  const found = findForbiddenIpcPatterns();

  assert.deepEqual(
    found,
    [],
    `Forbidden IPC compatibility or literal-channel pattern found:\n${found
      .map(({ file, kind, text }) => `- ${file} ${kind}: ${text}`)
      .join("\n")}`,
  );
}

function run() {
  assertDefinitionsAreComplete();
  assertStaticChannelsAreDeclared();
  assertNoStaticIpcStringUsage();
  assertNoForbiddenIpcPatterns();
  console.log("PASS ipc-schema-regression");
}

run();
