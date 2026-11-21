import { describe, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import _path from "node:path";
const require = createRequire(import.meta.url);
const _repoRoot = fileURLToPath(new URL("../../", import.meta.url));

describe("direct-dependencies", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const { builtinModules } = require("node:module");
    const { parse } = require("@babel/parser");
    const traverse = require("@babel/traverse").default;

    const root = _path.resolve(_repoRoot, "");
    const pkg = require("../../package.json");
    const declared = new Set(
      Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }),
    );
    const builtins = new Set(builtinModules);
    const failures = [];

    function checkSpecifier(value, filename) {
      if (
        typeof value !== "string" ||
        value.startsWith(".") ||
        value.startsWith("/") ||
        value.startsWith("node:") ||
        builtins.has(value)
      )
        return;
      const name = value.startsWith("@")
        ? value.split("/").slice(0, 2).join("/")
        : value.split("/")[0];
      if (!declared.has(name))
        failures.push(`${filename}: declare ${name} in package.json`);
    }

    function checkFile(filename) {
      const ast = parse(fs.readFileSync(path.join(root, filename), "utf8"), {
        sourceType: "unambiguous",
        plugins: ["jsx"],
      });
      traverse(ast, {
        ImportDeclaration({ node }) {
          checkSpecifier(node.source.value, filename);
        },
        ExportNamedDeclaration({ node }) {
          checkSpecifier(node.source?.value, filename);
        },
        ExportAllDeclaration({ node }) {
          checkSpecifier(node.source.value, filename);
        },
        CallExpression({ node }) {
          if (
            node.callee.name === "require" ||
            node.callee.type === "Import" ||
            (node.callee.object?.name === "require" &&
              node.callee.property?.name === "resolve")
          ) {
            checkSpecifier(node.arguments[0]?.value, filename);
          }
        },
      });
    }

    function walk(directory) {
      for (const entry of fs.readdirSync(path.join(root, directory), {
        withFileTypes: true,
      })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(filename);
        else if (/\.(?:js|jsx|mjs)$/.test(entry.name)) checkFile(filename);
      }
    }

    for (const directory of ["src", "scripts", "tests"]) walk(directory);
    for (const filename of fs.readdirSync(root)) {
      if (/\.(?:js|mjs)$/.test(filename)) checkFile(filename);
    }
    assert.deepEqual(failures, [], failures.join("\n"));
    console.log("PASS check-direct-dependencies");
  });
});

describe("ipc-schema", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");

    const ROOT = _path.resolve(_repoRoot, "");
    const SRC_DIR = path.join(ROOT, "src");
    const {
      IPC_CHANNEL_DEFINITIONS,
      IPC_REQUEST_CHANNELS,
      getChannelDefinition,
    } = require(path.join(ROOT, "src/shared/contracts/ipc/channels"));
    const { validateSchema } = require(
      path.join(ROOT, "src/main/ipc/schema/validator"),
    );

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
      {
        kind: "send-to-renderer",
        re: /(?:safeSendToRenderer|sendToRenderer|broadcastToAllWindows)\(\s*["']([^"']+)["']/g,
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
      {
        kind: "send-to-renderer-static-channel",
        re: /(?:safeSendToRenderer|sendToRenderer|broadcastToAllWindows)\(\s*["'][^"']+["']/g,
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
        assert.equal(
          typeof definition.key,
          "string",
          "definition key is required",
        );
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
      const missing = found.filter(
        ({ channel }) => !getChannelDefinition(channel),
      );

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
        `Static IPC channel strings are not allowed outside src/shared/contracts/ipc/channels.js:\n${found
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

    function assertAllRequestChannelsUsed() {
      const mainSource = walkJavaScriptFiles(path.join(SRC_DIR, "main"))
        .map((file) => fs.readFileSync(file, "utf8"))
        .join("\n");
      const clientSource = [
        ...walkJavaScriptFiles(path.join(SRC_DIR, "preload")),
        ...walkJavaScriptFiles(path.join(SRC_DIR, "renderer")),
      ]
        .map((file) => fs.readFileSync(file, "utf8"))
        .join("\n");

      // Renderer terminal resize uses TERMINAL_IO_MAILBOX_CHANNEL; TERMINAL_RESIZE
      // stays registered on main as a legacy/test endpoint.
      const clientReferenceAllowlist = new Set(["TERMINAL_RESIZE"]);
      const unreferencedInMain = [];
      const unreferencedInClient = [];

      for (const key of Object.keys(IPC_REQUEST_CHANNELS)) {
        const refPattern = new RegExp(`\\b${key}\\b`);
        if (!refPattern.test(mainSource)) {
          unreferencedInMain.push(key);
        }
        if (
          !clientReferenceAllowlist.has(key) &&
          !refPattern.test(clientSource)
        ) {
          unreferencedInClient.push(key);
        }
      }

      assert.deepEqual(
        unreferencedInMain,
        [],
        `IPC_REQUEST_CHANNELS missing main handler reference: ${unreferencedInMain.join(", ")}`,
      );
      assert.deepEqual(
        unreferencedInClient,
        [],
        `IPC_REQUEST_CHANNELS unused by preload/renderer: ${unreferencedInClient.join(", ")}`,
      );
    }

    function run() {
      assertDefinitionsAreComplete();
      assertStaticChannelsAreDeclared();
      assertNoStaticIpcStringUsage();
      assertNoForbiddenIpcPatterns();
      assertAllRequestChannelsUsed();
      console.log("PASS check-ipc-schema");
    }

    await run();
  });
});

describe("runtime-boundaries", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const { builtinModules } = require("node:module");
    const { parse } = require("@babel/parser");
    const traverse = require("@babel/traverse").default;

    const root = _path.resolve(_repoRoot, "");
    const sourceRoot = path.join(root, "src");
    const nodeModules = new Set(builtinModules);
    const failures = [];
    const allowed = {
      main: new Set(["main", "shared"]),
      preload: new Set(["preload", "shared"]),
      renderer: new Set(["renderer", "shared"]),
      shared: new Set(["shared"]),
    };

    function resolveLocal(filename, specifier) {
      const candidate = path.resolve(path.dirname(filename), specifier);
      return [
        candidate,
        ...[".js", ".jsx", ".json", ".d.ts", "/index.js", "/index.jsx"].map(
          (suffix) => candidate + suffix,
        ),
      ].find((value) => fs.existsSync(value) && fs.statSync(value).isFile());
    }

    function checkImport(filename, specifier) {
      if (typeof specifier !== "string") return;
      const relative = path.relative(sourceRoot, filename);
      const sourceParts = relative.split(path.sep);
      const owner = sourceParts[0];
      if (!allowed[owner]) {
        failures.push(`${relative}: source must belong to an explicit runtime`);
        return;
      }
      if (specifier.startsWith(".")) {
        const target = resolveLocal(filename, specifier);
        if (!target) {
          failures.push(`${relative}: unresolved ${specifier}`);
          return;
        }
        const targetOwner = path
          .relative(sourceRoot, target)
          .split(path.sep)[0];
        const targetParts = path.relative(sourceRoot, target).split(path.sep);
        const targetRel = targetParts.join("/");
        if (
          sourceParts[0] === "main" &&
          sourceParts[1] === "utils" &&
          targetParts[0] !== "shared" &&
          !(targetParts[0] === "main" && targetParts[1] === "utils")
        ) {
          failures.push(
            `${relative}: main/utils cannot import domain module (${specifier})`,
          );
        }
        if (
          sourceParts[0] === "renderer" &&
          sourceParts[1] === "shared" &&
          targetParts[0] === "renderer" &&
          ["app", "features"].includes(targetParts[1])
        ) {
          failures.push(
            `${relative}: renderer/shared cannot depend on application or feature implementations`,
          );
        }
        if (
          sourceParts[0] === "renderer" &&
          sourceParts[1] === "features" &&
          targetParts[0] === "renderer" &&
          targetParts[1] === "app"
        ) {
          const allowedAppImport =
            sourceParts[2] === "terminal" &&
            targetRel === "renderer/app/state/AppContext.jsx";
          if (!allowedAppImport) {
            failures.push(
              `${relative}: renderer/features cannot depend on renderer/app (${specifier})`,
            );
          }
        }
        if (
          sourceParts[0] === "renderer" &&
          sourceParts[1] === "features" &&
          targetParts[0] === "renderer" &&
          targetParts[1] === "features" &&
          sourceParts[2] !== targetParts[2]
        ) {
          const sourceFeature = sourceParts[2];
          const targetFeature = targetParts[2];
          const allowedCrossFeature =
            ((sourceFeature === "file-manager" ||
              sourceFeature === "terminal") &&
              targetFeature === "transfers") ||
            (sourceFeature === "settings" &&
              targetRel ===
                "renderer/features/connections/components/OpenSSHImportDialog.jsx");
          if (!allowedCrossFeature) {
            failures.push(
              `${relative}: disallowed cross-feature import (${specifier})`,
            );
          }
        }
        if (!allowed[owner].has(targetOwner)) {
          failures.push(
            `${relative}: ${owner} cannot import ${targetOwner} (${specifier})`,
          );
        }
      } else {
        if (
          sourceParts[0] === "main" &&
          sourceParts[1] === "utils" &&
          !(
            specifier.startsWith("node:") ||
            nodeModules.has(specifier) ||
            specifier === "electron"
          )
        ) {
          failures.push(
            `${relative}: main/utils cannot import third-party or runtime package (${specifier})`,
          );
        }
        if (
          owner !== "main" &&
          (specifier.startsWith("node:") ||
            nodeModules.has(specifier) ||
            (specifier === "electron" && owner !== "preload"))
        ) {
          failures.push(
            `${relative}: ${specifier} is not available in ${owner}`,
          );
        }
      }
    }

    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(filename);
          continue;
        }
        if (!/\.jsx?$/.test(entry.name)) continue;
        const ast = parse(fs.readFileSync(filename, "utf8"), {
          sourceType: "unambiguous",
          plugins: ["jsx"],
        });
        traverse(ast, {
          ImportDeclaration({ node }) {
            checkImport(filename, node.source.value);
          },
          ExportNamedDeclaration({ node }) {
            checkImport(filename, node.source?.value);
          },
          ExportAllDeclaration({ node }) {
            checkImport(filename, node.source.value);
          },
          CallExpression({ node }) {
            if (
              node.callee.name === "require" ||
              node.callee.type === "Import" ||
              (node.callee.object?.name === "require" &&
                node.callee.property?.name === "resolve")
            ) {
              checkImport(filename, node.arguments[0]?.value);
            }
          },
        });
      }
    }

    walk(sourceRoot);
    assert.deepEqual(failures, [], failures.join("\n"));
    console.log("PASS check-runtime-boundaries");
  });
});

describe("module-cycles", () => {
  it("contains zero circular static imports or requires under src", async () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const { parse } = require("@babel/parser");
    const traverse = require("@babel/traverse").default;

    const root = _path.resolve(_repoRoot, "");
    const sourceRoot = path.join(root, "src");
    const graph = new Map();

    function resolveLocal(filename, specifier) {
      if (typeof specifier !== "string" || !specifier.startsWith(".")) {
        return null;
      }
      const candidate = path.resolve(path.dirname(filename), specifier);
      const match = [
        candidate,
        ...[".js", ".jsx", ".json", "/index.js", "/index.jsx"].map(
          (suffix) => candidate + suffix,
        ),
      ].find((value) => fs.existsSync(value) && fs.statSync(value).isFile());
      if (!match) return null;
      const rel = path.relative(root, match).replace(/\\/g, "/");
      return rel.startsWith("src/") && /\.(js|jsx)$/.test(rel) ? rel : null;
    }

    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(filename);
          continue;
        }
        if (!/\.jsx?$/.test(entry.name)) continue;
        const rel = path.relative(root, filename).replace(/\\/g, "/");
        const ast = parse(fs.readFileSync(filename, "utf8"), {
          sourceType: "unambiguous",
          plugins: ["jsx"],
        });
        const deps = new Set();
        const addEdge = (specifier) => {
          const target = resolveLocal(filename, specifier);
          if (target) deps.add(target);
        };
        traverse(ast, {
          ImportDeclaration({ node }) {
            addEdge(node.source.value);
          },
          ExportNamedDeclaration({ node }) {
            addEdge(node.source?.value);
          },
          ExportAllDeclaration({ node }) {
            addEdge(node.source.value);
          },
          CallExpression({ node }) {
            if (node.callee.name === "require") {
              addEdge(node.arguments[0]?.value);
            }
          },
        });
        graph.set(rel, [...deps]);
      }
    }

    walk(sourceRoot);

    let index = 0;
    const indices = new Map();
    const lowlink = new Map();
    const stack = [];
    const onStack = new Set();
    const cycles = [];

    function strongConnect(node) {
      indices.set(node, index);
      lowlink.set(node, index);
      index += 1;
      stack.push(node);
      onStack.add(node);

      for (const dep of graph.get(node) || []) {
        if (!indices.has(dep)) {
          strongConnect(dep);
          lowlink.set(node, Math.min(lowlink.get(node), lowlink.get(dep)));
        } else if (onStack.has(dep)) {
          lowlink.set(node, Math.min(lowlink.get(node), indices.get(dep)));
        }
      }

      if (lowlink.get(node) === indices.get(node)) {
        const scc = [];
        while (true) {
          const member = stack.pop();
          onStack.delete(member);
          scc.push(member);
          if (member === node) break;
        }
        if (scc.length > 1 || (graph.get(node) || []).includes(node)) {
          cycles.push(scc.reverse());
        }
      }
    }

    for (const node of graph.keys()) {
      if (!indices.has(node)) {
        strongConnect(node);
      }
    }

    assert.deepEqual(
      cycles,
      [],
      `Found module dependency cycles:\n${cycles
        .map((cycle) => `- ${cycle.join(" -> ")}`)
        .join("\n")}`,
    );
  });
});

describe("sftp-native-boundary", () => {
  it("preserves the public behavior and resource lifecycle", async () => {
    const fs = require("node:fs");
    const path = require("node:path");

    /**
     * SFTP Rust 边界守卫（方向 C：目录浏览读写热路径全量下沉 Rust，JS 只留任务编排）
     *
     * 断言三件事：
     * 1. JS 主进程 SFTP 相关模块不再 require("ssh2")，也不存在 ssh2 风格的
     *    callback SFTP shim（历史混血路径已于 2026-09 移除）。
     * 2. nativeSftpClient.js 发起的每一个 operation 都在 file_management sidecar
     *    的 SftpOperation 枚举（Rust 侧）中有对应实现，防止两侧漂移。
     * 3. fileHandlers/sftpHandlers 的目录读写入口只经过 nativeSftpClient，
     *    没有绕过 sidecar 的本地 SFTP 实现。
     */

    const repoRoot = _path.resolve(_repoRoot, "");

    function readSource(relativePath) {
      return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    }

    function assertNotContains(source, pattern, message) {
      if (pattern.test(source)) {
        throw new Error(`check-sftp-native-boundary: ${message}`);
      }
    }

    function rustSftpOperations() {
      const modRs = fs.readFileSync(
        path.join(repoRoot, "native-services/crates/sftp/src/protocol.rs"),
        "utf8",
      );
      const enumStart = modRs.indexOf("enum SftpOperation");
      if (enumStart === -1) {
        throw new Error(
          "check-sftp-native-boundary: SftpOperation enum missing from sidecar",
        );
      }
      const enumBody = modRs.slice(
        enumStart,
        modRs.indexOf("impl SftpOperation", enumStart),
      );
      const operations = [
        ...enumBody.matchAll(/#\[serde\(rename = "([a-zA-Z]+)"\)\]/g),
      ].map((match) => match[1]);
      if (operations.length === 0) {
        throw new Error(
          "check-sftp-native-boundary: no SftpOperation variants parsed from mod.rs",
        );
      }
      return new Set(operations);
    }

    function jsNativeOperations() {
      const clientSource = readSource("src/main/native/nativeSftpClient.js");
      const operations = [
        ...clientSource.matchAll(/operation:\s*"([a-zA-Z]+)"/g),
      ].map((match) => match[1]);
      if (operations.length === 0) {
        throw new Error(
          "check-sftp-native-boundary: no native operations found in nativeSftpClient.js",
        );
      }
      return new Set(operations);
    }

    function main() {
      const listJsFiles = (dir) =>
        fs
          .readdirSync(path.join(repoRoot, dir), { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
          .map((entry) => `${dir}/${entry.name}`)
          .sort();

      const guardedModules = [
        "src/main/native/nativeSftpClient.js",
        ...listJsFiles("src/main/native/sftp"),
        "src/main/file-transfer/filemanagementService.js",
        "src/main/file-transfer/transferScheduler.js",
        "src/main/file-transfer/resumableTransfer.js",
        "src/main/ipc/handlers/fileHandlers.js",
        ...listJsFiles("src/main/ipc/handlers/file-domains"),
        "src/main/ipc/handlers/sftpHandlers.js",
      ];

      for (const relativePath of guardedModules) {
        const source = readSource(relativePath);
        assertNotContains(
          source,
          /require\(["']ssh2["']\)|from\s+["']ssh2["']/,
          `${relativePath} must not depend on the ssh2 JS SFTP data plane`,
        );
        assertNotContains(
          source,
          /_createNativeSftpShim|_withBorrowedSftp|_toShimStats|_toShimDirEntry/,
          `${relativePath} must not reintroduce the ssh2-style SFTP shim`,
        );
        assertNotContains(
          source,
          /client\.sftp\(|sftp\.readdir\(|sftp\.fastGet\(|sftp\.fastPut\(/,
          `${relativePath} must not open JS-side SFTP channels; all SFTP I/O goes through the Rust sidecar`,
        );
      }

      const rustOps = rustSftpOperations();
      // closeSession 是 Rust 会话循环（run_sftp_session）直接处理的会话控制指令，
      // 不在 SftpOperation 枚举里，单独放行。
      const sessionControlOps = new Set(["closeSession"]);
      const jsOps = jsNativeOperations();
      for (const operation of jsOps) {
        if (!rustOps.has(operation) && !sessionControlOps.has(operation)) {
          throw new Error(
            `check-sftp-native-boundary: nativeSftpClient.js requests operation "${operation}" but the file_management sidecar does not implement it (Rust ops: ${[...rustOps].sort().join(", ")})`,
          );
        }
      }

      const rustOpList = [...rustOps].sort().join(", ");
      const jsOpList = [...jsOps].sort().join(", ");
      console.log(
        `[sftp-native-boundary] PASS: ${guardedModules.length} JS modules free of ssh2 data plane; ${jsOps.size} JS operations all implemented in Rust sidecar.`,
      );
      console.log(`[sftp-native-boundary] JS ops: ${jsOpList}`);
      console.log(`[sftp-native-boundary] Rust ops: ${rustOpList}`);
    }

    await main();
  });
});

describe("no-node-native-modules", () => {
  it("keeps native code in simpleshell-core instead of Node addons", () => {
    const assert = require("node:assert/strict");
    const pkg = require("../../package.json");
    const declared = { ...pkg.dependencies, ...pkg.devDependencies };
    // Replaced by the core's pty, serial-port, telnet and system-metrics
    // services; an addon would bring back Electron rebuilds.
    for (const name of [
      "node-pty",
      "serialport",
      "telnet-client",
      "systeminformation",
    ]) {
      assert.equal(declared[name], undefined, `${name} must not return`);
    }
    const forgeConfig = require("node:fs").readFileSync(
      _path.join(_repoRoot, "forge.config.js"),
      "utf8",
    );
    assert.match(forgeConfig, /onlyModules:\s*\[\]/);
  });
});

describe("no-ssh2-process-type", () => {
  it('bans runtime "ssh2" process-type literals across src', () => {
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");

    const root = _path.resolve(_repoRoot, "");
    const sourceRoot = path.join(root, "src");
    const literalPattern =
      /\btype\s*[!=]==\s*["']ssh2["']|\btype\s*:\s*["']ssh2["']|\[\s*["']ssh2["']/;
    const violations = [];

    function walk(directory) {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          walk(filename);
          continue;
        }
        if (!/\.jsx?$/.test(entry.name)) continue;
        const source = fs.readFileSync(filename, "utf8");
        if (literalPattern.test(source)) {
          violations.push(path.relative(root, filename).replace(/\\/g, "/"));
        }
      }
    }

    walk(sourceRoot);
    assert.deepEqual(
      violations,
      [],
      `Found legacy "ssh2" process-type literals:\n${violations.join("\n")}`,
    );
  });
});
