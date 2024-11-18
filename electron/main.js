const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const extract = require('extract-zip');

// 创建临时目录
ipcMain.handle('create-temp-dir', async () => {
  const tempDir = path.join(os.tmpdir(), `sftp-${Date.now()}`);
  await fs.promises.mkdir(tempDir, { recursive: true });
  return tempDir;
});

// 压缩文件夹
ipcMain.handle('compress-folder', async ({ sourcePath, targetPath }) => {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(targetPath);
    const archive = archiver('zip', {
      zlib: { level: 9 }
    });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourcePath, false);
    archive.finalize();
  });
});

// 解压文件夹
ipcMain.handle('extract-folder', async ({ zipPath, targetPath }) => {
  await extract(zipPath, { dir: targetPath });
});

// 清理临时目录
ipcMain.handle('cleanup-temp-dir', async (event, tempDir) => {
  await fs.promises.rm(tempDir, { recursive: true, force: true });
}); 