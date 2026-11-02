const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const EXECUTABLE =
  process.platform === "win32" ? "simpleshell-core.exe" : "simpleshell-core";
const CANDIDATE_DIRS = [
  "native-services/target/debug",
  "native-services/target/release",
  `native-services/bin/${process.platform}-${process.arch}`,
];

function findNativeHost() {
  const override = process.env.SIMPLESHELL_NATIVE_SERVICES_PATH;
  if (override && fs.existsSync(override)) return override;
  return (
    CANDIDATE_DIRS.map((directory) =>
      path.join(ROOT, directory, EXECUTABLE),
    ).find((filename) => fs.existsSync(filename)) || null
  );
}

/** The `simpleshell-core` binary used by native tests; throws when unbuilt. */
function nativeHostPath() {
  const binary = findNativeHost();
  if (!binary) {
    throw new Error(
      "simpleshell-core is not built; run cargo build --manifest-path native-services/Cargo.toml",
    );
  }
  return binary;
}

module.exports = { EXECUTABLE, findNativeHost, nativeHostPath };
