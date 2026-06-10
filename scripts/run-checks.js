const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const scriptsDir = __dirname;
const runnerName = path.basename(__filename);

const checkScripts = fs
  .readdirSync(scriptsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter((name) => /^check-[a-z0-9-]+\.js$/u.test(name))
  .filter((name) => name !== runnerName)
  .sort((left, right) => left.localeCompare(right));

if (checkScripts.length === 0) {
  throw new Error("No check scripts found in scripts/.");
}

for (const scriptName of checkScripts) {
  const relativePath = path.join("scripts", scriptName);
  process.stdout.write(`\n[checks] ${relativePath}\n`);

  const result = spawnSync(process.execPath, [path.join(scriptsDir, scriptName)], {
    cwd: path.resolve(scriptsDir, ".."),
    stdio: "inherit",
    windowsHide: true,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

process.stdout.write(`\n[checks] ${checkScripts.length} scripts passed.\n`);
