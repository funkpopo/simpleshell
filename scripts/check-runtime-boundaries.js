const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const root = path.resolve(__dirname, "..");
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
  const owner = relative.split(path.sep)[0];
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
    const targetOwner = path.relative(sourceRoot, target).split(path.sep)[0];
    const sourceParts = relative.split(path.sep);
    const targetParts = path.relative(sourceRoot, target).split(path.sep);
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
    if (!allowed[owner].has(targetOwner)) {
      failures.push(
        `${relative}: ${owner} cannot import ${targetOwner} (${specifier})`,
      );
    }
  } else if (
    owner !== "main" &&
    (specifier.startsWith("node:") ||
      nodeModules.has(specifier) ||
      (specifier === "electron" && owner !== "preload"))
  ) {
    failures.push(`${relative}: ${specifier} is not available in ${owner}`);
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
