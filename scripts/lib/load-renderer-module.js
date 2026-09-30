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
    // JSON 资源按 Node 语义直接解析，不进入 Babel 转换
    if (filename.endsWith(".json")) {
      module.exports = JSON.parse(fs.readFileSync(filename, "utf8"));
      return module.exports;
    }
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
                declaration.specifiers.map((specifier) => {
                  const required = t.callExpression(t.identifier("require"), [
                    declaration.source,
                  ]);
                  // 默认导入走标准 Babel interop：CJS 包（如 i18next）无
                  // __esModule 标记时整包作为 default；本加载器转换的 ESM
                  // 模块带 __esModule 标记，直接取其 .default
                  const value =
                    specifier.type === "ImportDefaultSpecifier"
                      ? t.memberExpression(
                          t.callExpression(
                            t.identifier("_interopRequireDefault"),
                            [required],
                          ),
                          t.identifier("default"),
                        )
                      : t.memberExpression(
                          required,
                          t.identifier(specifier.imported.name),
                        );
                  return t.variableDeclaration("const", [
                    t.variableDeclarator(specifier.local, value),
                  ]);
                }),
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
        _interopRequireDefault: (mod) =>
          mod && mod.__esModule ? mod : { default: mod },
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
