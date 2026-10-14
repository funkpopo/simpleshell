const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const webpack = require("webpack");
const HtmlWebpackPlugin = require("html-webpack-plugin");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cache", "production-csp-check");
const compiler = webpack({
  mode: "production",
  devtool: false,
  entry: path.join(__dirname, "fixtures", "production-csp-renderer.js"),
  output: { path: output, filename: "probe.js" },
  plugins: [
    new HtmlWebpackPlugin({
      template: path.join(root, "src/renderer/index.html"),
    }),
  ],
});

compiler.run((error, stats) => {
  compiler.close(() => {});
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  const html = fs.readFileSync(path.join(output, "index.html"), "utf8");
  assert.match(html, /Content-Security-Policy/i);
  assert.match(html, /script-src 'self'/);
  assert.doesNotMatch(html, /unsafe-eval|<%|ws:\/\//);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [path.join(__dirname, "fixtures", "production-csp-electron.js"), output],
    {
      cwd: root,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  const timeout = setTimeout(() => {
    child.kill();
    process.exitCode = 1;
  }, 30000);
  child.on("error", (spawnError) => {
    clearTimeout(timeout);
    console.error(spawnError);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    clearTimeout(timeout);
    if (code !== 0) process.exitCode = 1;
  });
});
