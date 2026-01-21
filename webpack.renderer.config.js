// Renderer/preload bundles in Electron 40 can execute in a context where CommonJS globals
// like `__dirname` are not available (sandboxed preload execution).
// `@vercel/webpack-asset-relocator-loader` injects a runtime that uses `__dirname`, which
// breaks preload loading and results in a blank window. We keep the loader for the main
// process build (see `webpack.main.config.js`), but exclude it from the renderer build.
const baseRules = require("./webpack.rules");
const rules = baseRules.filter((rule) => {
  const use = rule && rule.use;
  if (!use) return true;
  if (typeof use === "string") return use !== "@vercel/webpack-asset-relocator-loader";
  if (Array.isArray(use)) {
    return !use.some((entry) => entry === "@vercel/webpack-asset-relocator-loader");
  }
  if (typeof use === "object") return use.loader !== "@vercel/webpack-asset-relocator-loader";
  return true;
});
const path = require("path");
const fs = require("fs");

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }],
});

module.exports = {
  module: {
    rules,
  },
  resolve: {
    extensions: [".js", ".jsx", ".json", ".ts", ".tsx", ".mjs"],
  },
  optimization: {
    usedExports: true,
  },
  cache: {
    type: 'filesystem',
    cacheDirectory: path.resolve(__dirname, '.webpack_cache'),
    buildDependencies: {
      config: [__filename],
    },
  },
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap("CopyPdfWorker", () => {
          const outputDir = path.join(__dirname, ".webpack", "renderer", "main_window");
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          const pdfjsDistPath = path.join(__dirname, "node_modules", "pdfjs-dist", "build");
          const workerSrcPath = path.join(pdfjsDistPath, "pdf.worker.min.mjs");
          const workerDestPath = path.join(outputDir, "pdf.worker.min.mjs");

          if (fs.existsSync(workerSrcPath)) {
            fs.copyFileSync(workerSrcPath, workerDestPath);
            console.log(`Copied PDF worker to: ${workerDestPath}`);
          } else {
            console.warn(`PDF worker file not found at: ${workerSrcPath}`);
          }
        });
      },
    },
  ],
};
