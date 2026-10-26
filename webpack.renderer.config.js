const path = require("path");
const reactTransitionGroupContextPath =
  require.resolve("react-transition-group/esm/TransitionGroupContext.js");

module.exports = (_env, { mode }) => ({
  devtool: mode === "development" ? "cheap-module-source-map" : false,
  module: {
    rules: [
      ...require("./webpack.rules")(mode),
      {
        test: /\.css$/,
        use: [
          { loader: "style-loader" },
          {
            loader: "css-loader",
            options: {
              modules: {
                auto: true,
                namedExport: false,
                exportLocalsConvention: "as-is",
              },
            },
          },
        ],
      },
    ],
  },
  resolve: {
    // The isolated renderer has no Node globals. Packages such as vfile must
    // resolve their browser implementation even with an electron-renderer target.
    conditionNames: ["browser", "webpack", "import", "require", "default"],
    alias: {
      "react-transition-group/TransitionGroupContext$":
        reactTransitionGroupContextPath,
    },
    extensions: [".js", ".jsx", ".json", ".ts", ".tsx", ".mjs"],
  },
  optimization: {
    usedExports: true,
    splitChunks: {
      // Keep the application shell small and leave feature-specific libraries out of
      // the initial chunk. Higher-priority groups are checked before the generic
      // vendor group so a module is emitted into one deterministic chunk only.
      chunks: "all",
      cacheGroups: {
        codemirror: {
          test: /[\\/]node_modules[\\/](?:@codemirror|@lezer|@uiw[\\/]react-codemirror|codemirror)[\\/]/,
          name: "codemirror",
          priority: 40,
          reuseExistingChunk: true,
        },
        xterm: {
          test: /[\\/]node_modules[\\/]@xterm[\\/]/,
          name: "xterm",
          priority: 30,
          reuseExistingChunk: true,
        },
        mui: {
          // Emotion is MUI's styling runtime and belongs in the same cacheable chunk.
          test: /[\\/]node_modules[\\/](?:@mui|@emotion)[\\/]/,
          name: "mui",
          // Do not pull MUI modules used only by lazy feature chunks into startup.
          chunks: "initial",
          priority: 20,
          reuseExistingChunk: true,
        },
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: "vendor",
          // A single named all-chunks vendor bundle would promote dependencies from
          // lazy dialogs and sidebars into the initial page load.
          chunks: "initial",
          priority: 10,
          reuseExistingChunk: true,
        },
      },
    },
  },
  cache: {
    type: "filesystem",
    cacheDirectory: path.resolve(__dirname, ".webpack_cache"),
    buildDependencies: {
      config: [__filename],
    },
  },
});
