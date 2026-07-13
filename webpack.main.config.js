const path = require("path");
const fs = require("fs");

const copyDirectoryIfExists = (srcDir, destDir) => {
  if (!fs.existsSync(srcDir)) {
    return;
  }

  fs.rmSync(destDir, { recursive: true, force: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
};

const copyFileIfExists = (srcFile, destFile) => {
  if (!fs.existsSync(srcFile)) {
    return;
  }

  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  fs.copyFileSync(srcFile, destFile);
};

module.exports = {
  devtool:
    process.env.NODE_ENV === "development"
      ? "eval-cheap-module-source-map"
      : false,
  entry: {
    index: "./src/main.js",
    "workers/ai-worker": "./src/workers/ai-worker.js",
    "workers/sftp-transfer-worker": "./src/workers/sftp-transfer-worker.js",
  },
  resolve: {
    // Make optional native deps safe for bundling/package.
    alias: {
      // `ssh2` optionally loads this native module for cipher ordering.
      // We skip rebuilding it for Electron 40 (Node 24) on Windows, so bundle a shim.
      "cpu-features$": path.join(__dirname, "src", "shims", "cpu-features.js"),
    },
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

          // node-pty resolves native modules relative to the bundled main file.
          // Keep the upstream directory layout so conpty.node and its helper
          // files are available at runtime in Electron.
          copyDirectoryIfExists(
            path.join(__dirname, "node_modules", "node-pty", "prebuilds"),
            path.join(__dirname, ".webpack", "main", "prebuilds"),
          );
          copyDirectoryIfExists(
            path.join(__dirname, "node_modules", "node-pty", "lib", "worker"),
            path.join(__dirname, ".webpack", "main", "worker"),
          );
          copyDirectoryIfExists(
            path.join(__dirname, "node_modules", "node-pty", "lib", "shared"),
            path.join(__dirname, ".webpack", "main", "shared"),
          );
          copyFileIfExists(
            path.join(
              __dirname,
              "node_modules",
              "node-pty",
              "lib",
              "conpty_console_list_agent.js",
            ),
            path.join(
              __dirname,
              ".webpack",
              "main",
              "conpty_console_list_agent.js",
            ),
          );
          copyFileIfExists(
            path.join(__dirname, "node_modules", "node-pty", "lib", "utils.js"),
            path.join(__dirname, ".webpack", "main", "utils.js"),
          );
        });
      },
    },
  ],
};
