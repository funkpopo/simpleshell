const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const webpack = require("webpack");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".cache", "sftp-ui-check");
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(
  path.join(output, "index.html"),
  '<!doctype html><html><head><meta charset="UTF-8"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
);
const compiler = webpack({
  mode: "development",
  devtool: false,
  target: "electron-renderer",
  entry: path.join(__dirname, "fixtures", "sftp-renderer.jsx"),
  output: { path: output, filename: "fixture.js" },
  resolve: { extensions: [".js", ".jsx", ".json"] },
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            babelrc: false,
            configFile: false,
            presets: [["@babel/preset-react", { runtime: "automatic" }]],
          },
        },
      },
    ],
  },
  performance: { hints: false },
});
compiler.run((error, stats) => {
  compiler.close(() => {});
  if (error || stats.hasErrors()) {
    console.error(error || stats.toString({ all: false, errors: true }));
    process.exitCode = 1;
    return;
  }
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(
    require("electron"),
    [path.join(__dirname, "fixtures", "sftp-renderer-electron.js"), output],
    { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let log = "";
  child.stdout.on("data", (data) => {
    log += data;
  });
  child.stderr.on("data", (data) => {
    log += data;
  });
  const timeout = setTimeout(() => {
    child.kill();
    console.error("SFTP UI timed out", log);
    process.exitCode = 1;
  }, 45000);
  child.on("error", (error) => {
    clearTimeout(timeout);
    console.error(error);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    clearTimeout(timeout);
    fs.writeFileSync(path.join(output, "electron.log"), log);
    console.log(
      log
        .split(/\r?\n/)
        .filter((line) => /SFTP_UI|Error|FAIL/.test(line))
        .join("\n"),
    );
    process.exitCode = code === 0 ? 0 : 1;
  });
});
