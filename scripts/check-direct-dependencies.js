const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");
const { parse } = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const root = path.resolve(__dirname, "..");
const pkg = require("../package.json");
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
