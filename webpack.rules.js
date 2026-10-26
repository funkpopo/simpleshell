// Rules shared by the main and renderer bundles. Forge passes `mode`
// ("development" | "production") to every webpack config factory.
module.exports = (mode) => [
  // 特殊处理 pdfjs-dist 的 ES 模块，避免 asset-relocator-loader 错误
  {
    test: /[/\\]node_modules[/\\]pdfjs-dist[/\\].+\.mjs$/,
    exclude: /pdf\.worker\./,
    type: "javascript/auto",
    resolve: {
      fullySpecified: false,
    },
  },
  // 将 PDF worker 文件作为资源文件处理
  {
    test: /[/\\]node_modules[/\\]pdfjs-dist[/\\]build[/\\]pdf\.worker\.min\.mjs$/,
    type: "asset/resource",
    generator: {
      filename: "pdf.worker.min.mjs",
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
      filename: "fonts/[name].[hash][ext]",
    },
  },
  {
    test: /\.jsx?$/,
    use: {
      loader: "babel-loader",
      options: {
        exclude: /node_modules/,
        presets: [
          [
            "@babel/preset-react",
            {
              runtime: "automatic",
              development: mode === "development",
            },
          ],
        ],
        // 解决大文件优化警告
        compact: false,
        // 启用缓存提升构建性能
        cacheDirectory: true,
        cacheCompression: false,
        envName: mode,
      },
    },
  },
];
