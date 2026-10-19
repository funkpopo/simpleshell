import { it, expect } from "vitest";
import webpack from "webpack";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

it("builds the minified production renderer and keeps feature libraries out of startup", async () => {
  const base = require("../../webpack.renderer.config.js");
  const output = path.join(root, ".cache/integration/production-renderer");
  const compiler = webpack({
    ...base,
    mode: "production",
    target: "electron-renderer",
    devtool: false,
    entry: path.join(root, "src/renderer/main.jsx"),
    output: {
      path: output,
      filename: "[name].js",
      chunkFilename: "[name].[contenthash].js",
      publicPath: "",
    },
    performance: { hints: false },
  });
  const stats = await new Promise((resolve, reject) =>
    compiler.run((error, stats) => {
      compiler.close(() => {});
      if (error || stats.hasErrors())
        reject(
          error || new Error(stats.toString({ all: false, errors: true })),
        );
      else resolve(stats);
    }),
  );
  const resources = (module) => [
    module.resource || "",
    ...[...(module.modules || [])].flatMap(resources),
  ];
  const allResources = [...stats.compilation.modules].flatMap(resources);
  const initial = [...stats.compilation.chunks]
    .filter((chunk) => chunk.canBeInitial())
    .flatMap((chunk) =>
      [...stats.compilation.chunkGraph.getChunkModulesIterable(chunk)].flatMap(
        resources,
      ),
    );
  expect(
    allResources.some((resource) =>
      /node_modules[\\/]react-icons[\\/]/.test(resource),
    ),
  ).toBe(false);
  expect(
    initial.some((resource) =>
      /node_modules[\\/](react-pdf|pdfjs-dist|@codemirror|@xterm)[\\/]/.test(
        resource,
      ),
    ),
  ).toBe(false);
  expect(
    allResources.some((resource) =>
      /node_modules[\\/]react-pdf[\\/]/.test(resource),
    ),
  ).toBe(true);
  await fs.writeFile(
    path.join(output, "bundle-report.json"),
    JSON.stringify(
      stats.toJson({ all: false, assets: true, chunks: true, warnings: true }),
      null,
      2,
    ),
  );
});
