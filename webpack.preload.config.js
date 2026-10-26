module.exports = (_env, { mode }) => ({
  // Preload is part of the production application bundle as well. Keep source
  // maps opt-in for development only so packaged apps never expose source paths
  // or the original source through a sourceMappingURL.
  devtool: mode === "development" ? "eval-cheap-module-source-map" : false,
  optimization: {
    splitChunks: false,
    runtimeChunk: false,
  },
});
