const path = require("path");
const fs = require("fs");

module.exports = {
  entry: {
    index: "./src/main.js",
    "workers/ai-worker": "./src/workers/ai-worker.js",
  },
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
    filename: "[name].js",
  },
  // 在构建后复制资源文件
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap("CopyAssets", () => {
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
          }
        });
      },
    },
  ],
};
