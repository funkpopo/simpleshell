const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

async function build() {
  try {
    // 清理之前的构建
    console.log('Cleaning previous builds...');
    if (fs.existsSync('dist_electron')) {
      fs.rmSync('dist_electron', { recursive: true, force: true });
    }
    if (fs.existsSync('backend/dist')) {
      fs.rmSync('backend/dist', { recursive: true, force: true });
    }

    // 构建后端
    console.log('Building backend...');
    execSync('cd backend && python -m PyInstaller --clean service.spec', { stdio: 'inherit' });

    // 确保目标目录存在
    const resourcesDir = path.join('dist_electron', 'win-unpacked', 'resources');
    fs.mkdirSync(resourcesDir, { recursive: true });

    // 构建前端
    console.log('Building frontend...');
    execSync('npm run electron:build', { stdio: 'inherit' });

    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
