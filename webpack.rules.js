module.exports = [
  // Add support for native node modules
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: "node-loader",
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: "@vercel/webpack-asset-relocator-loader",
      options: {
        outputAssetBase: "native_modules",
      },
    },
  },
  // 添加图标和其他资源文件的支持
  {
    test: /\.(ico|png|jpe?g|gif|svg)$/i,
    type: "asset/resource",
  },
  // 添加字体文件的支持
  {
    test: /\.(woff|woff2|eot|ttf|otf)$/i,
    type: "asset/resource",
    generator: {
      filename: 'fonts/[name].[hash][ext]',
    },
  },
  {
    test: /\.jsx?$/,
    use: {
      loader: "babel-loader",
      options: {
        exclude: /node_modules/,
        presets: ["@babel/preset-react"],
        plugins: [
          // 配置 Material-UI 图标按需导入
          [
            "import",
            {
              libraryName: "@mui/icons-material",
              libraryDirectory: "",
              camel2DashComponentName: false,
            },
            "core",
          ],
        ],
        // 解决大文件优化警告
        compact: false,
        // 启用缓存提升构建性能
        cacheDirectory: true,
        // 配置环境变量
        envName: process.env.NODE_ENV || "development",
      },
    },
  },
];
