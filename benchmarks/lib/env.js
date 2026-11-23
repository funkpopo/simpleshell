const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { monitorEventLoopDelay } = require("node:perf_hooks");

const ROOT = path.resolve(__dirname, "../..");
const DEFAULT_OUTPUT_DIR = path.join(ROOT, ".cache", "benchmarks");
const DEFAULT_BASELINE_PATH = path.join(DEFAULT_OUTPUT_DIR, "baseline.json");

const NATIVE_EXECUTABLE =
  process.platform === "win32" ? "simpleshell-core.exe" : "simpleshell-core";

function resolveNativeHost() {
  const candidates = [];
  if (process.env.SIMPLESHELL_NATIVE_SERVICES_PATH) {
    candidates.push(path.resolve(process.env.SIMPLESHELL_NATIVE_SERVICES_PATH));
  }

  const localCandidates = [
    path.join(
      ROOT,
      "native-services",
      "bin",
      `${process.platform}-${process.arch}`,
      NATIVE_EXECUTABLE,
    ),
    path.join(ROOT, "native-services", "target", "release", NATIVE_EXECUTABLE),
    path.join(ROOT, "native-services", "target", "debug", NATIVE_EXECUTABLE),
  ];
  candidates.push(...localCandidates);

  // When running from an isolated git worktree, fall back to the main repo checkout's staged binary.
  try {
    const commonDir = execFileSync(
      "git",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    if (commonDir) {
      const mainRepoRoot = path.dirname(commonDir);
      if (path.resolve(mainRepoRoot) !== path.resolve(ROOT)) {
        candidates.push(
          path.join(
            mainRepoRoot,
            "native-services",
            "bin",
            `${process.platform}-${process.arch}`,
            NATIVE_EXECUTABLE,
          ),
          path.join(
            mainRepoRoot,
            "native-services",
            "target",
            "release",
            NATIVE_EXECUTABLE,
          ),
        );
      }
    }
  } catch {
    // Ignore git resolution failures outside a git repository.
  }

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      process.env.SIMPLESHELL_NATIVE_SERVICES_PATH = candidate;
      return candidate;
    }
  }

  return null;
}

function requireNativeHost() {
  const binary = resolveNativeHost();
  if (!binary) {
    throw new Error(
      "simpleshell-core binary not found. Set SIMPLESHELL_NATIVE_SERVICES_PATH or build native-services.",
    );
  }
  return binary;
}

function stubMainRuntime() {
  const stubs = [
    [
      path.join(ROOT, "src/main/utils/logger.js"),
      {
        logToFile: () => {},
        initLogger: () => {},
        logError: () => {},
        getLogDirectoryPath: () => null,
        getLogFilePath: () => null,
        updateLogConfig: () => true,
      },
    ],
    [
      path.join(ROOT, "src/main/diagnostics/crashReporter.js"),
      {
        initializeCrashReporter: () => {},
        recordCrashMarker: () => {},
      },
    ],
  ];

  const previous = [];
  for (const [modulePath, exportsValue] of stubs) {
    let resolved;
    try {
      resolved = require.resolve(modulePath);
    } catch {
      resolved = modulePath;
    }
    previous.push({ resolved, entry: require.cache[resolved] });
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: exportsValue,
    };
  }

  return () => {
    for (const { resolved, entry } of previous) {
      if (entry) {
        require.cache[resolved] = entry;
      } else {
        delete require.cache[resolved];
      }
    }
  };
}

function startEventLoopMonitor(resolutionMs = 5) {
  const histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  histogram.enable();
  return () => {
    histogram.disable();
    const toMs = (ns) => Number((ns / 1e6).toFixed(3));
    return {
      p50Ms: toMs(histogram.percentile(50)),
      p95Ms: toMs(histogram.percentile(95)),
      p99Ms: toMs(histogram.percentile(99)),
      maxMs: toMs(histogram.max),
      meanMs: toMs(histogram.mean),
    };
  };
}

function listProcesses(imageName) {
  if (!imageName) return [];
  try {
    if (process.platform === "win32") {
      const output = execFileSync(
        "tasklist",
        ["/FO", "CSV", "/NH", "/FI", `IMAGENAME eq ${imageName}`],
        { encoding: "utf8", windowsHide: true },
      );
      return output
        .split(/\r?\n/)
        .filter((line) => line.startsWith('"'))
        .map((line) => {
          const cells = line.split('","').map((cell) => cell.replace(/"/g, ""));
          return {
            pid: Number(cells[1]),
            rssBytes:
              Number(String(cells[4] || "0").replace(/[^\d]/g, "")) * 1024,
          };
        })
        .filter((entry) => Number.isFinite(entry.pid) && entry.pid > 0);
    }
    const output = execFileSync("ps", ["-A", "-o", "pid=,rss=,comm="], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(
        (cells) => cells.length >= 3 && path.basename(cells[2]) === imageName,
      )
      .map((cells) => ({
        pid: Number(cells[0]),
        rssBytes: Number(cells[1]) * 1024,
      }));
  } catch {
    return [];
  }
}

function getNativeProcessesRssMB() {
  const binary = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
  if (!binary) return { count: 0, rssMB: 0 };
  const procs = listProcesses(path.basename(binary));
  const totalBytes = procs.reduce((sum, entry) => sum + entry.rssBytes, 0);
  return {
    count: procs.length,
    rssMB: Number((totalBytes / (1024 * 1024)).toFixed(2)),
  };
}

function getGitInfo() {
  try {
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { branch, commit };
  } catch {
    return { branch: null, commit: null };
  }
}

async function waitFor(
  predicate,
  { timeoutMs = 30000, pollMs = 5, label = "condition" } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${label} (${timeoutMs}ms)`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

function createRendererLoader(globals = {}, mocks = {}) {
  const babel = require("@babel/core");
  const cache = new Map();

  function load(filename) {
    if (/\.css$/i.test(filename)) {
      return {};
    }
    const resolved = require.resolve(path.resolve(filename));
    if (cache.has(resolved)) {
      return cache.get(resolved).exports;
    }

    const moduleRecord = { exports: {} };
    cache.set(resolved, moduleRecord);

    if (resolved.endsWith(".json")) {
      moduleRecord.exports = JSON.parse(fs.readFileSync(resolved, "utf8"));
      return moduleRecord.exports;
    }

    const { code } = babel.transformSync(fs.readFileSync(resolved, "utf8"), {
      filename: resolved,
      configFile: false,
      babelrc: false,
      presets: [
        [
          "@babel/preset-react",
          {
            runtime: "automatic",
            development: false,
          },
        ],
      ],
      plugins: [
        ({ types: t }) => ({
          visitor: {
            ImportDeclaration(nodePath) {
              const declaration = nodePath.node;
              if (declaration.specifiers.length === 0) {
                nodePath.replaceWith(
                  t.expressionStatement(
                    t.callExpression(t.identifier("require"), [
                      declaration.source,
                    ]),
                  ),
                );
                return;
              }
              nodePath.replaceWithMultiple(
                declaration.specifiers.map((specifier) => {
                  const required = t.callExpression(t.identifier("require"), [
                    declaration.source,
                  ]);
                  let value = required;
                  if (specifier.type === "ImportDefaultSpecifier") {
                    value = t.memberExpression(
                      t.callExpression(t.identifier("_interopRequireDefault"), [
                        required,
                      ]),
                      t.identifier("default"),
                    );
                  } else if (specifier.type === "ImportSpecifier") {
                    value = t.memberExpression(
                      required,
                      t.identifier(specifier.imported.name),
                    );
                  }
                  return t.variableDeclaration("const", [
                    t.variableDeclarator(specifier.local, value),
                  ]);
                }),
              );
            },
            ExportNamedDeclaration(nodePath) {
              const { declaration, source, specifiers } = nodePath.node;
              if (!declaration) {
                if (source) {
                  const reexportId =
                    nodePath.scope.generateUidIdentifier("reexport");
                  const statements = [
                    t.variableDeclaration("const", [
                      t.variableDeclarator(
                        reexportId,
                        t.callExpression(t.identifier("require"), [source]),
                      ),
                    ]),
                  ];
                  for (const specifier of specifiers) {
                    const exportMember = t.memberExpression(
                      t.identifier("exports"),
                      specifier.exported,
                      !t.isIdentifier(specifier.exported),
                    );
                    const rhs = t.isExportNamespaceSpecifier(specifier)
                      ? reexportId
                      : t.memberExpression(
                          reexportId,
                          specifier.local,
                          !t.isIdentifier(specifier.local),
                        );
                    statements.push(
                      t.expressionStatement(
                        t.assignmentExpression("=", exportMember, rhs),
                      ),
                    );
                  }
                  nodePath.replaceWithMultiple(statements);
                  return;
                }
                nodePath.replaceWithMultiple(
                  specifiers.map((specifier) =>
                    t.expressionStatement(
                      t.assignmentExpression(
                        "=",
                        t.memberExpression(
                          t.identifier("exports"),
                          specifier.exported,
                          !t.isIdentifier(specifier.exported),
                        ),
                        specifier.local,
                      ),
                    ),
                  ),
                );
                return;
              }
              const names =
                declaration.type === "FunctionDeclaration" ||
                declaration.type === "ClassDeclaration"
                  ? [declaration.id.name]
                  : declaration.declarations.flatMap((item) =>
                      Object.keys(t.getBindingIdentifiers(item.id)),
                    );
              nodePath.replaceWithMultiple([
                declaration,
                ...names.map((name) =>
                  t.expressionStatement(
                    t.assignmentExpression(
                      "=",
                      t.memberExpression(
                        t.identifier("exports"),
                        t.identifier(name),
                      ),
                      t.identifier(name),
                    ),
                  ),
                ),
              ]);
            },
            ExportAllDeclaration(nodePath) {
              nodePath.replaceWith(
                t.expressionStatement(
                  t.callExpression(
                    t.memberExpression(
                      t.identifier("Object"),
                      t.identifier("assign"),
                    ),
                    [
                      t.identifier("exports"),
                      t.callExpression(t.identifier("require"), [
                        nodePath.node.source,
                      ]),
                    ],
                  ),
                ),
              );
            },
            ExportDefaultDeclaration(nodePath) {
              const declaration = nodePath.node.declaration;
              const isDeclaration =
                declaration.type === "FunctionDeclaration" ||
                declaration.type === "ClassDeclaration";
              nodePath.replaceWithMultiple([
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(
                      t.memberExpression(
                        t.identifier("module"),
                        t.identifier("exports"),
                      ),
                      t.identifier("__esModule"),
                    ),
                    t.booleanLiteral(true),
                  ),
                ),
                t.expressionStatement(
                  t.assignmentExpression(
                    "=",
                    t.memberExpression(
                      t.memberExpression(
                        t.identifier("module"),
                        t.identifier("exports"),
                      ),
                      t.identifier("default"),
                    ),
                    isDeclaration ? t.toExpression(declaration) : declaration,
                  ),
                ),
              ]);
            },
          },
        }),
      ],
    });

    const localRequire = (specifier) => {
      if (Object.prototype.hasOwnProperty.call(mocks, specifier)) {
        return mocks[specifier];
      }
      if (/\.css$/i.test(specifier)) {
        return {};
      }
      if (specifier.startsWith(".")) {
        return load(path.resolve(path.dirname(resolved), specifier));
      }
      return require(specifier);
    };

    const wrapper = vm.runInThisContext(
      `(function(exports, require, module, __filename, __dirname, _interopRequireDefault, globalScope) { ${code}\n})`,
      { filename: resolved },
    );
    const prevGlobals = {};
    for (const [key, value] of Object.entries(globals)) {
      prevGlobals[key] = [key in globalThis, globalThis[key]];
      globalThis[key] = value;
    }
    try {
      wrapper(
        moduleRecord.exports,
        localRequire,
        moduleRecord,
        resolved,
        path.dirname(resolved),
        (mod) => (mod && mod.__esModule ? mod : { default: mod }),
        globalThis,
      );
    } finally {
      for (const [key, [hadKey, oldVal]] of Object.entries(prevGlobals)) {
        if (hadKey) globalThis[key] = oldVal;
        else delete globalThis[key];
      }
    }
    return moduleRecord.exports;
  }

  return load;
}

module.exports = {
  ROOT,
  DEFAULT_OUTPUT_DIR,
  DEFAULT_BASELINE_PATH,
  resolveNativeHost,
  requireNativeHost,
  stubMainRuntime,
  startEventLoopMonitor,
  listProcesses,
  getNativeProcessesRssMB,
  getGitInfo,
  waitFor,
  createRendererLoader,
};
