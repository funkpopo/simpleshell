const { parentPort, workerData } = require('worker_threads');
const fs = require('fs').promises;
const path = require('path');
const { createReadStream } = require('fs');
const { pipeline } = require('stream/promises');
const mime = require('mime-types');

// 处理来自主线程的消息
parentPort.on('message', async (message) => {
  try {
    const { type, id, ...data } = message;
    
    let result;
    switch (type) {
      case 'listFiles':
        result = await listFiles(data.path, data.options);
        break;
      case 'previewFile':
        result = await previewFile(data.path, data.options);
        break;
      case 'readFile':
        result = await readFileContent(data.path, data.options);
        break;
      case 'readImageFile':
        result = await readImageFile(data.path, data.options);
        break;
      case 'createFolder':
        result = await createFolder(data.path);
        break;
      case 'createFile':
        result = await createFile(data.path, data.content);
        break;
      case 'deleteFile':
        result = await deleteFile(data.path, data.isDirectory);
        break;
      case 'renameFile':
        result = await renameFile(data.oldPath, data.newPath);
        break;
      default:
        throw new Error(`未知操作类型: ${type}`);
    }
    
    parentPort.postMessage({ id, result });
  } catch (error) {
    parentPort.postMessage({ 
      id: message.id, 
      error: { message: error.message, stack: error.stack } 
    });
  }
});

// 列出目录中的文件
async function listFiles(dirPath, options = {}) {
  try {
    // 确保路径存在
    const stat = await fs.stat(dirPath);
    if (!stat.isDirectory()) {
      throw new Error('指定的路径不是目录');
    }
    
    // 读取目录内容
    const files = await fs.readdir(dirPath);
    
    // 获取每个文件/目录的详细信息
    const fileDetails = await Promise.all(files.map(async (fileName) => {
      const filePath = path.join(dirPath, fileName);
      try {
        const stats = await fs.stat(filePath);
        
        return {
          name: fileName,
          path: filePath,
          isDirectory: stats.isDirectory(),
          size: stats.size,
          mtime: stats.mtime.toISOString(),
          ctime: stats.ctime.toISOString(),
          // 如果不是目录，获取MIME类型
          mimeType: !stats.isDirectory() ? mime.lookup(filePath) || 'application/octet-stream' : null
        };
      } catch (error) {
        // 如果无法访问文件，返回基本信息
        return {
          name: fileName,
          path: filePath,
          error: error.message,
          isAccessible: false
        };
      }
    }));
    
    return { success: true, data: fileDetails };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 文件预览函数
async function previewFile(filePath, options = {}) {
  try {
    // 获取文件状态
    const stats = await fs.stat(filePath);
    
    // 获取MIME类型
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    const fileType = mimeType.split('/')[0];
    
    // 根据文件类型和大小决定预览方式
    let previewData;
    
    // 对于文本文件，直接读取内容
    if (fileType === 'text' || 
        mimeType === 'application/json' || 
        mimeType === 'application/xml' ||
        mimeType === 'application/javascript') {
      // 文本文件限制大小（5MB）
      if (stats.size > 5 * 1024 * 1024) {
        return { 
          success: true, 
          preview: {
            type: 'error',
            message: '文件过大，无法预览(>5MB)'
          }
        };
      }
      
      const content = await fs.readFile(filePath, 'utf-8');
      previewData = {
        type: 'text',
        content,
        mimeType
      };
    } 
    // 对于图片文件，读取为Base64
    else if (fileType === 'image') {
      // 图片文件限制大小（10MB）
      if (stats.size > 10 * 1024 * 1024) {
        return { 
          success: true, 
          preview: {
            type: 'error',
            message: '图片过大，无法预览(>10MB)'
          }
        };
      }
      
      const buffer = await fs.readFile(filePath);
      previewData = {
        type: 'image',
        content: buffer.toString('base64'),
        mimeType
      };
    } 
    // 其他类型文件不支持预览
    else {
      previewData = {
        type: 'unsupported',
        message: `不支持预览的文件类型: ${mimeType}`,
        mimeType
      };
    }
    
    const result = { 
      success: true, 
      preview: previewData,
      fileName: path.basename(filePath),
      fileSize: stats.size,
      mimeType
    };
    
    // 如果是临时文件且需要删除，添加删除操作
    if (options && options.deleteAfterPreview) {
      // 使用 setTimeout 确保文件在预览后删除
      setTimeout(async () => {
        try {
          await fs.unlink(filePath);
          console.log(`临时预览文件已删除: ${filePath}`);
        } catch (err) {
          console.error(`删除临时文件失败: ${err.message}`);
        }
      }, 1000);
    }
    
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 读取文本文件内容
async function readFileContent(filePath, options = {}) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return { success: true, content };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 读取图片文件为Base64
async function readImageFile(filePath, options = {}) {
  try {
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    
    return { 
      success: true, 
      data: `data:${mimeType};base64,${base64}`,
      mimeType 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 创建文件夹
async function createFolder(folderPath) {
  try {
    await fs.mkdir(folderPath, { recursive: true });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 创建文件
async function createFile(filePath, content = '') {
  try {
    await fs.writeFile(filePath, content);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 删除文件或目录
async function deleteFile(filePath, isDirectory) {
  try {
    if (isDirectory) {
      await fs.rmdir(filePath, { recursive: true });
    } else {
      await fs.unlink(filePath);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 重命名文件
async function renameFile(oldPath, newPath) {
  try {
    await fs.rename(oldPath, newPath);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
} 