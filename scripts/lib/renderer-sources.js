const fs = require("node:fs");
const path = require("node:path");
const babel = require("@babel/core");

const ROOT = path.resolve(__dirname, "../..");

function collectDirectorySources(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory);
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) return collectDirectorySources(relativePath);
      return /\.jsx?$/.test(entry.name)
        ? fs.readFileSync(path.join(ROOT, relativePath), "utf8")
        : "";
    })
    .join("\n\n");
}

function collectAppSources() {
  return collectDirectorySources("src/renderer/components/app");
}

function collectFileManagerSources() {
  return collectDirectorySources("src/renderer/components/filemanager");
}

// Extract the actual callback instead of depending on its former neighbouring
// declarations in a monolithic component. Missing callbacks fail the check.
function readRendererCallback(relativePath, name) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  const ast = babel.parseSync(source, {
    filename: relativePath,
    configFile: false,
    babelrc: false,
    presets: ["@babel/preset-react"],
  });
  let callback;
  babel.traverse(ast, {
    VariableDeclarator({ node }) {
      if (node.id.name === name && node.init) {
        callback = source.slice(node.start, node.end);
      }
    },
  });
  if (!callback) throw new Error(`Missing ${name} in ${relativePath}`);
  return callback;
}

module.exports = {
  collectAppSources,
  collectFileManagerSources,
  readRendererCallback,
};
