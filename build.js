const { execSync } = require('child_process');
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

    // 构建前端
    console.log('Building frontend...');
    execSync('npm run electron:build', { stdio: 'inherit' });

    // 复制文件
    console.log('Copying backend files...');
    const unpackedDir = path.join('dist_electron', 'win-unpacked');
    const backendExe = path.join('backend', 'dist', 'service', 'service.exe');
    const internalDir = path.join('backend', 'dist', 'service', '_internal');

    // 复制 service.exe
    if (fs.existsSync(backendExe)) {
      console.log(`Copying ${backendExe} to ${unpackedDir}`);
      fs.copyFileSync(backendExe, path.join(unpackedDir, 'service.exe'));
    } else {
      throw new Error(`Backend executable not found at: ${backendExe}`);
    }

    // 复制 _internal 文件夹
    if (fs.existsSync(internalDir)) {
      console.log(`Copying ${internalDir} to ${unpackedDir}`);
      fs.cpSync(internalDir, path.join(unpackedDir, '_internal'), { 
        recursive: true,
        force: true 
      });
    } else {
      throw new Error(`Internal directory not found at: ${internalDir}`);
    }

    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
