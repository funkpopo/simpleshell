const { defineConfig } = require('@vue/cli-service')

module.exports = defineConfig({
  transpileDependencies: true,
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,
      externals: ['@electron/remote'],
      files: [
        "**/*",
        "splash.html"
      ],
      extraFiles: [
        {
          from: "public/splash.html",
          to: "splash.html"
        }
      ]
    }
  },
  configureWebpack: {
    resolve: {
      fallback: {
        "path": require.resolve("path-browserify"),
        "fs": false
      }
    }
  },
  lintOnSave: false
})