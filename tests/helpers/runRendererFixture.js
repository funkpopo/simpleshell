import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import webpack from "webpack";
import HtmlWebpackPlugin from "html-webpack-plugin";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));

/** Compile the real renderer rules, then await an isolated Electron fixture. */
export async function runRendererFixture({
  name,
  entry,
  main,
  production = false,
}) {
  const base = require("../../webpack.renderer.config.js");
  const output = path.join(root, ".cache", "integration", name);
  await fs.mkdir(output, { recursive: true });
  const compiler = webpack({
    ...base,
    mode: production ? "production" : "development",
    devtool: false,
    target: "electron-renderer",
    entry: { fixture: path.join(root, "tests/fixtures", entry) },
    output: { path: output, filename: "[name].js", publicPath: "" },
    optimization: { ...base.optimization, minimize: production },
    plugins: [
      new HtmlWebpackPlugin(
        production
          ? { template: path.join(root, "src/renderer/index.html") }
          : {
              templateContent:
                '<!doctype html><html><head><meta charset="UTF-8"></head><body style="margin:0;overflow:hidden"><div id="root"></div></body></html>',
            },
      ),
    ],
    performance: { hints: false },
  });
  await new Promise((resolve, reject) =>
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors())
        reject(
          error || new Error(stats.toString({ all: false, errors: true })),
        );
      else resolve();
    }),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  await new Promise((resolve, reject) => {
    const child = spawn(
      require("electron"),
      [path.join(root, "tests/fixtures", main), output],
      {
        cwd: root,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
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
      reject(new Error(`${name} timed out\n${log}`));
    }, 70000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", async (code) => {
      clearTimeout(timeout);
      await fs.writeFile(path.join(output, "electron.log"), log);
      if (code === 0) resolve();
      else reject(new Error(`${name} exited ${code}\n${log}`));
    });
  });
  return output;
}
