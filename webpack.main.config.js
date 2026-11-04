const path = require("path");
const fs = require("fs");

// Asset relocation for the ssh2 fallback backend (its Pageant helper
// `pagent.exe` and optional crypto binding); removed together with ssh2.
// Main bundle only: the relocator injects a `__dirname` runtime that breaks
// the sandboxed renderer and preload.
const nativeModuleRules = [
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: "node-loader",
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    exclude: /[/\\]node_modules[/\\]pdfjs-dist[/\\]/,
    parser: { amd: false },
    use: {
      loader: "@vercel/webpack-asset-relocator-loader",
      options: {
        outputAssetBase: "native_modules",
      },
    },
  },
];

module.exports = (_env, { mode }) => ({
  devtool: mode === "development" ? "eval-cheap-module-source-map" : false,
  entry: {
    index: "./src/main/index.js",
  },
  module: {
    rules: [...nativeModuleRules, ...require("./webpack.rules")(mode)],
  },
  // 确保worker可以正确解析
  node: {
    __dirname: false,
    __filename: false,
  },
  // 明确指定输出
  // NOTE: @electron-forge/plugin-webpack 8.x expects the main bundle as
  // index.cjs (package.json "main" points to .webpack/main/index.cjs).
  output: {
    path: path.join(__dirname, ".webpack", "main"),
    filename: "[name].cjs",
  },
  // 在构建后复制资源文件
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap("CopyAssets", () => {
          // 复制资源文件夹
          const assetsSrcDir = path.join(__dirname, "src/renderer/assets");
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
});
