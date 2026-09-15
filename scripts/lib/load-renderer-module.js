const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const babel = require("@babel/core");

// Execute the actual renderer modules under Node, with a shared module cache.
module.exports = function createLoader(globals = {}, mocks = {}) {
  const cache = new Map();
  function load(filename) {
    filename = require.resolve(path.resolve(filename));
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const { code } = babel.transformSync(fs.readFileSync(filename, "utf8"), {
      filename,
      configFile: false,
      babelrc: false,
      plugins: [
        ({ types: t }) => ({
          visitor: {
            ImportDeclaration(nodePath) {
              const declaration = nodePath.node;
              nodePath.replaceWithMultiple(
                declaration.specifiers.map((specifier) =>
                  t.variableDeclaration("const", [
                    t.variableDeclarator(
                      specifier.local,
                      t.memberExpression(
                        t.callExpression(t.identifier("require"), [
                          declaration.source,
                        ]),
                        t.identifier(
                          specifier.type === "ImportDefaultSpecifier"
                            ? "default"
                            : specifier.imported.name,
                        ),
                      ),
                    ),
                  ]),
                ),
              );
            },
            ExportNamedDeclaration(nodePath) {
              const declaration = nodePath.node.declaration;
              const names =
                declaration.type === "FunctionDeclaration"
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
          },
        }),
      ],
    });
    const localRequire = (name) =>
      Object.prototype.hasOwnProperty.call(mocks, name)
        ? mocks[name]
        : name.startsWith(".")
          ? load(path.resolve(path.dirname(filename), name))
          : require(name);
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: localRequire,
        process,
        console,
        setTimeout,
        clearTimeout,
        ...globals,
      },
      { filename },
    );
    return module.exports;
  }
  return load;
};
