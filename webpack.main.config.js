const path = require("path");
const fs = require("fs");

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: "./src/main.js",
  // Put your normal webpack config below here
  module: {
    rules: require("./webpack.rules"),
  },
  // 确保worker可以正确解析
  node: {
    __dirname: false,
    __filename: false,
  },
  // 明确指定输出
  output: {
    path: path.join(__dirname, ".webpack", "main"),
    filename: "index.js",
  },
  // 在构建后复制worker文件
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap("CopyWorkers", () => {
          // 确保workers目录存在
          const srcDir = path.join(__dirname, "src", "workers");
          const destDir = path.join(__dirname, ".webpack", "main", "workers");

          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          // 复制ai-worker.js
          const srcFile = path.join(srcDir, "ai-worker.js");
          const destFile = path.join(destDir, "ai-worker.js");

          if (fs.existsSync(srcFile)) {
            fs.copyFileSync(srcFile, destFile);
          }

          // 复制资源文件夹
          const assetsSrcDir = path.join(__dirname, "src", "assets");
          const assetsDestDir = path.join(
            __dirname,
            ".webpack",
            "main",
            "assets",
          );

          if (!fs.existsSync(assetsDestDir)) {
            fs.mkdirSync(assetsDestDir, { recursive: true });
          }

          if (fs.existsSync(assetsSrcDir)) {
            // 读取资源目录中的所有文件
            const assetFiles = fs.readdirSync(assetsSrcDir);

            // 复制每个文件
            assetFiles.forEach((file) => {
              const srcFilePath = path.join(assetsSrcDir, file);
              const destFilePath = path.join(assetsDestDir, file);

              if (fs.statSync(srcFilePath).isFile()) {
                fs.copyFileSync(srcFilePath, destFilePath);
              }
            });
          } else {
            console.error(`Assets directory not found at ${assetsSrcDir}`);
          }
        });
      },
    },
  ],
};
