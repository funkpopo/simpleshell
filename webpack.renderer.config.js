const rules = require("./webpack.rules");
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
