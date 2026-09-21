// Node-only check: parse JavaScript/JSDoc with TypeScript, validate IPC arity,
// then type-check preload implementations against their documented signatures.
const assert = require("node:assert/strict");
const path = require("node:path");
const ts = require("typescript");
const { collectPreloadSources } = require("./lib/preload-sources");
const {
  IPC_REQUEST_CHANNELS,
  getChannelDefinition,
} = require("../src/shared/contracts/ipc/channels.js");

const repoRoot = path.resolve(__dirname, "..");
const preloadPath = path.join(repoRoot, "src/preload/index.js");
const requiredApis = [
  "terminalAPI",
  "electronAPI",
  "dialogAPI",
  "appErrorAPI",
  "clipboardAPI",
];

function isMember(node, owner, member) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === owner &&
    node.name.text === member
  );
}

function inspectPreload(source, filename = preloadPath) {
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const problems = file.parseDiagnostics.map((d) =>
    ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  );
  const apis = new Set();
  let methodCount = 0;
  let invokeCount = 0;
  let dynamicInvokeCount = 0;
  const report = (node, message) => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
    problems.push(`${path.basename(filename)}:${line + 1}: ${message}`);
  };

  // Factory spreads are resolved to their actual object methods, never skipped.
  const factories = new Map();
  for (const statement of file.statements) {
    if (
      !ts.isFunctionDeclaration(statement) ||
      !statement.name ||
      !statement.body
    )
      continue;
    const returned = statement.body.statements.find(
      ts.isReturnStatement,
    )?.expression;
    if (returned && ts.isObjectLiteralExpression(returned)) {
      factories.set(statement.name.text, returned);
    }
  }
  function flattenProperties(object, visiting = new Set()) {
    return object.properties.flatMap((property) => {
      if (!ts.isSpreadAssignment(property)) return [property];
      const call = property.expression;
      const name =
        ts.isCallExpression(call) && ts.isIdentifier(call.expression)
          ? call.expression.text
          : null;
      if (!name || !factories.has(name) || visiting.has(name)) {
        report(
          property,
          "API spread must resolve to a non-recursive object factory",
        );
        return [];
      }
      return flattenProperties(
        factories.get(name),
        new Set([...visiting, name]),
      );
    });
  }

  function checkApi(call) {
    const [name, object] = call.arguments;
    if (!name || !ts.isStringLiteral(name)) {
      report(call, "API name must be a string literal");
      return;
    }
    // This bridge exposes startup data, not methods.
    if (name.text === "simpleshellBoot") return;
    apis.add(name.text);
    if (!object || !ts.isObjectLiteralExpression(object)) {
      report(
        call,
        `${name.text}: expected an object literal of documented methods`,
      );
      return;
    }
    if (object.properties.length === 0)
      report(object, `${name.text}: API must expose at least one method`);
    const exposedNames = new Set();
    for (const property of flattenProperties(object)) {
      const propertyName = property.name?.getText(file);
      if (exposedNames.has(propertyName))
        report(property, `${name.text}: duplicate API method ${propertyName}`);
      exposedNames.add(propertyName);
      const method = ts.isMethodDeclaration(property)
        ? property
        : ts.isPropertyAssignment(property) &&
            (ts.isArrowFunction(property.initializer) ||
              ts.isFunctionExpression(property.initializer))
          ? property.initializer
          : null;
      if (!method) {
        report(
          property,
          `${name.text}: unsupported API property; use an inline method`,
        );
        continue;
      }
      methodCount += 1;
      const label = `${name.text}.${property.name.getText(file)}`;
      const docs = property.jsDoc || [];
      if (docs.length !== 1) {
        report(
          property,
          `${label}: expected exactly one JSDoc block, got ${docs.length}`,
        );
        continue;
      }
      const tags = Array.from(docs[0].tags || []);
      const params = tags.filter(ts.isJSDocParameterTag);
      const names = method.parameters.map((p) => p.name.getText(file));
      const documentedNames = params
        .filter((p) => !p.name.getText(file).includes("."))
        .map((p) => p.name.getText(file));
      if (JSON.stringify(names) !== JSON.stringify(documentedNames)) {
        report(
          property,
          `${label}: @param names/order must match (${names.join(", ")})`,
        );
      }
      const returns = tags.filter(ts.isJSDocReturnTag);
      if (returns.length !== 1 || !returns[0].typeExpression) {
        report(property, `${label}: expected one typed @returns`);
      }
      for (const tag of [...params, ...returns]) {
        if (!tag.typeExpression) {
          report(
            property,
            `${label}: @${tag.tagName.text} needs an explicit type`,
          );
          continue;
        }
        const inspectType = (node) => {
          if (
            node.kind === ts.SyntaxKind.AnyKeyword ||
            node.kind === ts.SyntaxKind.JSDocAllType ||
            (ts.isTypeReferenceNode(node) &&
              node.typeName.getText(file) === "Function")
          ) {
            report(
              property,
              `${label}: use a concrete type or unknown instead of ${node.getText(file)}`,
            );
          }
          ts.forEachChild(node, inspectType);
        };
        inspectType(tag.typeExpression.type);
      }
    }
  }

  function checkInvoke(call) {
    const [channel, ...args] = call.arguments;
    let definition;
    if (
      channel &&
      ts.isPropertyAccessExpression(channel) &&
      ts.isIdentifier(channel.expression) &&
      channel.expression.text === "IPC_REQUEST_CHANNELS"
    ) {
      definition = getChannelDefinition(
        IPC_REQUEST_CHANNELS[channel.name.text],
      );
    } else if (channel && ts.isStringLiteral(channel)) {
      definition = getChannelDefinition(channel.text);
    } else {
      dynamicInvokeCount += 1;
      return;
    }
    if (!definition || definition.type !== "request") {
      report(call, `unknown request channel: ${channel.getText(file)}`);
      return;
    }
    if (args.some(ts.isSpreadElement)) {
      report(
        call,
        `${definition.key}: spread arguments have unknown arity; pass explicit arguments`,
      );
      return;
    }
    const schema = definition.requestSchema;
    const min = schema?.minItems ?? 0;
    const max =
      schema?.maxItems ??
      (schema?.additionalItems === false && Array.isArray(schema.items)
        ? schema.items.length
        : Infinity);
    if (args.length < min || args.length > max) {
      report(
        call,
        `${definition.key}: ${args.length} argument(s) outside schema bounds [${min}, ${max}]`,
      );
    }
    invokeCount += 1;
  }

  function visit(node) {
    if (ts.isCallExpression(node)) {
      if (isMember(node.expression, "contextBridge", "exposeInMainWorld"))
        checkApi(node);
      if (isMember(node.expression, "ipcRenderer", "invoke")) checkInvoke(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return {
    problems,
    apis: [...apis],
    methodCount,
    invokeCount,
    dynamicInvokeCount,
  };
}

// An optional in-memory source is used by regression tests without editing preload.js.
function getPreloadTypeDiagnostics(source, sourcePath = preloadPath) {
  const configPath = path.join(repoRoot, "tsconfig.preload.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return [config.error];
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, repoRoot);
  if (parsed.errors.length) return parsed.errors;
  const host = ts.createCompilerHost(parsed.options);
  if (source !== undefined) {
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (filename, languageVersion, ...args) =>
      path.resolve(filename) === path.resolve(sourcePath)
        ? ts.createSourceFile(
            filename,
            source,
            languageVersion,
            true,
            ts.ScriptKind.JS,
          )
        : getSourceFile(filename, languageVersion, ...args);
  }
  const program = ts.createProgram(parsed.fileNames, parsed.options, host);
  return ts.getPreEmitDiagnostics(program);
}

function main() {
  const source = collectPreloadSources();
  assert.match(
    source,
    /^\/\/ @ts-check\r?$/m,
    "preload.js must enable JSDoc type checking",
  );
  const result = inspectPreload(source);
  for (const name of requiredApis)
    assert.ok(result.apis.includes(name), `preload.js must expose ${name}`);
  assert.ok(
    result.methodCount > 0 && result.invokeCount > 0,
    "No preload methods/invokes found",
  );
  assert.deepEqual(result.problems, [], result.problems.join("\n"));
  const diagnostics = getPreloadTypeDiagnostics();
  if (diagnostics.length) {
    process.stderr.write(
      ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCurrentDirectory: () => repoRoot,
        getCanonicalFileName: (name) => name,
        getNewLine: () => "\n",
      }),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Preload checks passed: ${result.apis.length} APIs, ${result.methodCount} typed methods, ${result.invokeCount} static invokes; ${result.dynamicInvokeCount} dynamic invokes skipped.`,
  );
}

if (require.main === module) main();
module.exports = { inspectPreload, getPreloadTypeDiagnostics };
