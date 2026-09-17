// preload 类型契约检查（todo 项 2「给 preload API 建类型契约」）：
// 1. preload.js 每个暴露到渲染进程的 API 块（terminalAPI/electronAPI/dialogAPI/...）
//    的方法都必须带 JSDoc 注释（/** ... */），且 @param 个数与函数形参个数一致；
// 2. 直接 invoke 的方法，其 IPC 通道的 requestSchema（channels.js）声明的参数
//    个数上下界必须容纳 preload 处的实际实参个数，让 invoke 参数错误在 CI 就被抓住。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const preloadSource = fs.readFileSync(
  path.join(repoRoot, "src/preload.js"),
  "utf8",
);
const { IPC_REQUEST_CHANNELS, getChannelDefinition } = require(
  path.join(repoRoot, "src/core/ipc/schema/channels.js"),
);

function extractExposeBlocks(source) {
  const blocks = [];
  const exposeRe = /exposeInMainWorld\(\s*["']([\w$]+)["']\s*,\s*\{/g;
  let match;
  while ((match = exposeRe.exec(source))) {
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let inString = null;
    let cursor = bodyStart;
    for (; cursor < source.length && depth > 0; cursor += 1) {
      const character = source[cursor];
      const previous = source[cursor - 1];
      if (inString) {
        if (character === inString && previous !== "\\") inString = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") {
        inString = character;
      } else if (character === "{") {
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
      }
    }
    blocks.push({
      name: match[1],
      body: source.slice(bodyStart, cursor - 1),
    });
  }
  return blocks;
}

// 解析 exposeInMainWorld 块内的顶层方法：方法名、形参列表、前置 JSDoc 文本。
// JSDoc 与方法行之间允许夹杂 `// ...` 行注释（preload.js 的既有风格）。
function parseExposedMethods(blockBody) {
  const methods = [];
  const methodRe =
    /((?:\/\*\*[\s\S]*?\*\/\s*)?(?:^ {2}\/\/[^\n]*\n)*?)^ {2}([A-Za-z_$][\w$]*)\s*[:(]/gm;
  let match;
  while ((match = methodRe.exec(blockBody))) {
    const parameterList = extractParameterList(
      blockBody,
      match.index + match[0].length,
    );
    const docText = match[1] || "";
    const docMatch = /\/\*\*([\s\S]*?)\*\//.exec(docText);
    methods.push({
      name: match[2],
      params: parameterList ? splitTopLevel(parameterList) : [],
      doc: docMatch ? docMatch[1] : "",
    });
  }
  return methods;
}

function extractParameterList(source, startIndex) {
  const remainder = source.slice(startIndex);
  const openMatch = /^\s*(?:async\s*)?\(/.exec(remainder);
  if (!openMatch) return null;
  let depth = 1;
  let inString = null;
  let cursor = openMatch[0].length;
  for (; cursor < remainder.length && depth > 0; cursor += 1) {
    const character = remainder[cursor];
    const previous = remainder[cursor - 1];
    if (inString) {
      if (character === inString && previous !== "\\") inString = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      inString = character;
    } else if ("([{".includes(character)) {
      depth += 1;
    } else if (")]}".includes(character)) {
      depth -= 1;
    }
  }
  return remainder.slice(openMatch[0].length, cursor - 1);
}

function splitTopLevel(inner) {
  const parts = [];
  let depth = 0;
  let inString = null;
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];
    const previous = inner[index - 1];
    if (inString) {
      current += character;
      if (character === inString && previous !== "\\") inString = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      inString = character;
      current += character;
    } else if ("([{".includes(character)) {
      depth += 1;
      current += character;
    } else if (")]}".includes(character)) {
      depth -= 1;
      current += character;
    } else if (character === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function collectInvokeCalls(source) {
  const calls = [];
  const invokeRe = /ipcRenderer\.invoke\(/g;
  let match;
  while ((match = invokeRe.exec(source))) {
    const inner = extractBalanced(source, match.index + match[0].length);
    calls.push({ parts: splitTopLevel(inner) });
  }
  return calls;
}

function extractBalanced(source, startIndex) {
  let depth = 1;
  let inString = null;
  let cursor = startIndex;
  for (; cursor < source.length && depth > 0; cursor += 1) {
    const character = source[cursor];
    const previous = source[cursor - 1];
    if (inString) {
      if (character === inString && previous !== "\\") inString = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      inString = character;
    } else if ("([".includes(character)) {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
    }
  }
  return source.slice(startIndex, cursor - 1);
}

// 由 requestSchema 推导参数个数上下界；无个数约束（ANY_ARGS）返回 null。
function schemaArgumentBounds(schema) {
  if (!schema || schema.type !== "array") return null;
  if (Array.isArray(schema.items)) {
    if (
      schema.items.length === 1 &&
      Object.keys(schema.items[0]).length === 0 &&
      schema.minItems === undefined &&
      schema.maxItems === undefined
    ) {
      return null;
    }
    return {
      min: schema.minItems ?? schema.items.length,
      max: schema.maxItems ?? schema.items.length,
    };
  }
  return {
    min: schema.minItems ?? 0,
    max: schema.maxItems ?? Number.POSITIVE_INFINITY,
  };
}

const exposes = extractExposeBlocks(preloadSource);
assert.ok(exposes.length > 0, "preload.js must expose contextBridge APIs");

// simpleshellBoot 是启动主题数据（非方法集合），不参与方法注释检查。
const DOCUMENTED_APIS = [
  "terminalAPI",
  "electronAPI",
  "dialogAPI",
  "appErrorAPI",
  "clipboardAPI",
];

const apiBodies = [];
for (const apiName of DOCUMENTED_APIS) {
  const block = exposes.find((entry) => entry.name === apiName);
  assert.ok(block, `preload.js must expose ${apiName}`);
  apiBodies.push({ name: apiName, body: block.body });

  const methods = parseExposedMethods(block.body);
  assert.ok(methods.length > 0, `${apiName} must expose at least one method`);

  const problems = [];
  for (const method of methods) {
    if (!method.doc.trim()) {
      problems.push(`${method.name}: missing JSDoc comment`);
      continue;
    }
    const documentedParams = (method.doc.match(/@param\b/g) || []).length;
    if (documentedParams !== method.params.length) {
      problems.push(
        `${method.name}: @param count (${documentedParams}) != function arity (${method.params.length})`,
      );
    }
    if (!/@returns\b/.test(method.doc)) {
      problems.push(`${method.name}: missing @returns`);
    }
  }
  assert.deepEqual(
    problems,
    [],
    `${apiName} JSDoc contract violations:\n  ${problems.join("\n  ")}`,
  );
}

// invoke 实参个数必须落在通道 requestSchema 的上下界内
const invokeCalls = collectInvokeCalls(preloadSource);
assert.ok(
  invokeCalls.length > 0,
  "preload.js must contain ipcRenderer.invoke calls",
);

const schemaProblems = [];
for (const call of invokeCalls) {
  const channelReference = call.parts[0] || "";
  const namedChannel = /^IPC_REQUEST_CHANNELS\.(\w+)$/.exec(channelReference);
  if (!namedChannel) continue; // 动态通道由 schema 自身的 key 校验兜底

  const definition = getChannelDefinition(
    IPC_REQUEST_CHANNELS[namedChannel[1]],
  );
  const bounds = schemaArgumentBounds(definition?.requestSchema);
  if (!bounds) continue; // 通道未声明参数个数约束

  const actualArguments = call.parts.length - 1;
  if (actualArguments < bounds.min || actualArguments > bounds.max) {
    schemaProblems.push(
      `${namedChannel[1]}: ${actualArguments} argument(s) outside schema bounds [${bounds.min}, ${bounds.max}]`,
    );
  }
}
assert.deepEqual(
  schemaProblems,
  [],
  `preload invoke argument count violations:\n  ${schemaProblems.join("\n  ")}`,
);

console.log(
  `Preload typings checks passed: ${apiBodies.length} APIs, ${invokeCalls.length} invoke calls verified.`,
);
