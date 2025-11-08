const rules = require("./webpack.rules");
const path = require("path");
const fs = require("fs");

rules.push({
  test: /\.css$/,
  use: [{ loader: "style-loader" }, { loader: "css-loader" }],
});

module.exports = {
  // Put your normal webpack config below here
  module: {
    rules,
  },
  resolve: {
    extensions: [".js", ".jsx", ".json", ".ts", ".tsx", ".mjs"],
  },
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap("CopyPdfWorker", () => {
          // 确保输出目录存在
          const outputDir = path.join(__dirname, ".webpack", "renderer", "main_window");
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          // 查找 pdfjs-dist 包中的 worker 文件
          const pdfjsDistPath = path.join(__dirname, "node_modules", "pdfjs-dist", "build");
          const workerSrcPath = path.join(pdfjsDistPath, "pdf.worker.min.mjs");
          const workerDestPath = path.join(outputDir, "pdf.worker.min.mjs");

          // 如果源文件存在，复制它
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
