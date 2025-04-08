const path = require('path');
const fs = require('fs');

module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main.js',
  // Put your normal webpack config below here
  module: {
    rules: require('./webpack.rules'),
  },
  // 确保worker可以正确解析
  node: {
    __dirname: false,
    __filename: false,
  },
  // 明确指定输出
  output: {
    path: path.join(__dirname, '.webpack', 'main'),
    filename: 'index.js'
  },
  // 在构建后复制worker文件
  plugins: [
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tap('CopyWorkers', () => {
          // 确保workers目录存在
          const srcDir = path.join(__dirname, 'src', 'workers');
          const destDir = path.join(__dirname, '.webpack', 'main', 'workers');
          
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          
          // 复制ai-worker.js
          const aiWorkerSrc = path.join(srcDir, 'ai-worker.js');
          const aiWorkerDest = path.join(destDir, 'ai-worker.js');
          
          if (fs.existsSync(aiWorkerSrc)) {
            fs.copyFileSync(aiWorkerSrc, aiWorkerDest);
          }
          
          // 复制file-worker.js
          const fileWorkerSrc = path.join(srcDir, 'file-worker.js');
          const fileWorkerDest = path.join(destDir, 'file-worker.js');
          
          if (fs.existsSync(fileWorkerSrc)) {
            fs.copyFileSync(fileWorkerSrc, fileWorkerDest);
          }
          
          // 复制monitor-worker.js
          const monitorWorkerSrc = path.join(srcDir, 'monitor-worker.js');
          const monitorWorkerDest = path.join(destDir, 'monitor-worker.js');
          
          if (fs.existsSync(monitorWorkerSrc)) {
            fs.copyFileSync(monitorWorkerSrc, monitorWorkerDest);
          }
          
          // 复制资源文件夹
          const assetsSrcDir = path.join(__dirname, 'src', 'assets');
          const assetsDestDir = path.join(__dirname, '.webpack', 'main', 'assets');
          
          if (!fs.existsSync(assetsDestDir)) {
            fs.mkdirSync(assetsDestDir, { recursive: true });
          }
          
          // 复制资源文件
          if (fs.existsSync(assetsSrcDir)) {
            const files = fs.readdirSync(assetsSrcDir);
            files.forEach(file => {
              const srcFile = path.join(assetsSrcDir, file);
              const destFile = path.join(assetsDestDir, file);
              if (fs.statSync(srcFile).isFile()) {
                fs.copyFileSync(srcFile, destFile);
              }
            });
          }
        });
      }
    }
  ]
};
