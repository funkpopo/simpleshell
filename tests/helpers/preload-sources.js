const fs = require("node:fs");
const path = require("node:path");

const preloadDirectory = path.resolve(__dirname, "../../src/preload");

function collectPreloadSources(directory = preloadDirectory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectPreloadSources(filename);
      return entry.name.endsWith(".js")
        ? fs.readFileSync(filename, "utf8")
        : "";
    })
    .join("\n\n");
}

module.exports = { collectPreloadSources };
