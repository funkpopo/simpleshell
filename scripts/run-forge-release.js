const { spawnSync } = require("node:child_process");

const forgeCommand =
  process.platform === "win32" ? "electron-forge.cmd" : "electron-forge";
const result = spawnSync(forgeCommand, process.argv.slice(2), {
  env: {
    ...process.env,
    NODE_ENV: "production",
  },
  shell: process.platform === "win32",
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
