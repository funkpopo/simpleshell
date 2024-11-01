const { defineConfig } = require('@vue/cli-service')
const webpack = require('webpack')
const pkg = require('./package.json')

module.exports = defineConfig({
  transpileDependencies: true,
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        '__APP_VERSION__': JSON.stringify(pkg.version)
      })
    ],
    resolve: {
      fallback: {
        "path": require.resolve("path-browserify"),
        "fs": false,
        "crypto": false
      }
    },
    externals: {
      'fs': 'commonjs fs',
      'path': 'commonjs path'
    }
  },
  pluginOptions: {
    electronBuilder: {
      nodeIntegration: true,
      builderOptions: {
        productName: 'SimpleSSH',
        appId: 'com.example.simplessh',
        directories: {
          output: 'dist_electron',
          buildResources: 'build'
        },
        files: [
          {
            "from": "dist",
            "to": "app.asar/dist",
            "filter": ["**/*"]
          },
          "node_modules/**/*",
          "package.json",
          "background.js"
        ],
        extraResources: [
          {
            "from": "backend/dist/service.exe",
            "to": "."
          }
        ],
        asar: true
      },
      mainProcessFile: 'src/background.js',
      rendererProcessFile: 'src/main.js',
      outputDir: 'dist_electron'
    }
  },
  publicPath: './'
})
