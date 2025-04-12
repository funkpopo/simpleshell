module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: {
    index: './src/main.js',
    'workers/file-worker': './src/workers/file-worker.js',
    'workers/monitor-worker': './src/workers/monitor-worker.js',
    'workers/ai-worker': './src/workers/ai-worker.js'
  },
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
  output: {
    filename: '[name].js'
  }
};
