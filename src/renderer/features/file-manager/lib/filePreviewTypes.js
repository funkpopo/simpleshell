import { getFileExtension } from "./filePreviewCodemirrorLanguages.js";

export const isTextFile = (filename) => {
  // 首先检查是否是明确的非文本文件类型
  if (isImageFile(filename) || isPdfFile(filename) || isBinaryFile(filename)) {
    return false;
  }

  // 对于其他所有文件，默认允许作为文本处理
  return true;
};

// 判断是否是二进制文件（不应该作为文本处理的文件）
export const isBinaryFile = (filename) => {
  const binaryExtensions = [
    // 压缩文件
    "zip",
    "rar",
    "7z",
    "tar",
    "gz",
    "bz2",
    "xz",
    "tar.gz",
    "tar.bz2",
    "tar.xz",
    // 可执行文件
    "exe",
    "dll",
    "so",
    "dylib",
    "app",
    "deb",
    "rpm",
    "msi",
    "pkg",
    // 音频文件
    "mp3",
    "wav",
    "flac",
    "aac",
    "ogg",
    "wma",
    "m4a",
    "opus",
    // 视频文件
    "mp4",
    "avi",
    "mkv",
    "mov",
    "wmv",
    "flv",
    "webm",
    "m4v",
    "3gp",
    // 字体文件
    "ttf",
    "otf",
    "woff",
    "woff2",
    "eot",
    // Office文档（二进制格式）
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "odt",
    "ods",
    "odp",
    // 其他二进制格式
    "bin",
    "dat",
    "db",
    "sqlite",
    "sqlite3",
    "mdb",
    "accdb",
    // 游戏/模拟器文件
    "rom",
    "iso",
    "img",
    "dmg",
    // 设计文件
    "psd",
    "ai",
    "sketch",
    "fig",
    // 数据库文件
    "frm",
    "myd",
    "myi",
    "ibd",
  ];

  const ext = getFileExtension(filename);
  return binaryExtensions.includes(ext);
};

// 判断是否是图片文件
export const isImageFile = (filename) => {
  const imageExtensions = [
    "jpg",
    "jpeg",
    "png",
    "gif",
    "bmp",
    "svg",
    "webp",
    "ico",
  ];
  const ext = getFileExtension(filename);
  return imageExtensions.includes(ext);
};

// 判断是否是PDF文件
export const isPdfFile = (filename) => {
  const ext = getFileExtension(filename);
  return ext === "pdf";
};

// 获取MIME类型
export const getMimeType = (filename) => {
  const ext = getFileExtension(filename);
  const mimeTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
  };
  return mimeTypes[ext] || "application/octet-stream";
};
