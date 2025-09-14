import { useTranslation } from "react-i18next";

// 格式化文件大小
export const formatFileSize = (bytes, t) => {
  if (bytes === 0) return `0 ${t("fileManager.units.bytes")}`;
  const k = 1024;
  const sizes = [
    t("fileManager.units.bytes"),
    t("fileManager.units.kb"),
    t("fileManager.units.mb"),
    t("fileManager.units.gb"),
    t("fileManager.units.tb"),
  ];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 获取文件图标
export const getFileIcon = (file) => {
  if (file.isDirectory) {
    return "folder";
  }

  const extension = file.name.split(".").pop().toLowerCase();
  const iconMap = {
    // 代码文件
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    java: "java",
    c: "c",
    cpp: "cpp",
    cs: "csharp",
    go: "go",
    rs: "rust",
    php: "php",
    rb: "ruby",
    swift: "swift",
    kt: "kotlin",
    scala: "scala",
    r: "r",

    // 标记和数据文件
    html: "html",
    css: "css",
    scss: "sass",
    sass: "sass",
    less: "less",
    xml: "xml",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",

    // 文档文件
    md: "markdown",
    markdown: "markdown",
    txt: "text",
    pdf: "pdf",
    doc: "word",
    docx: "word",
    xls: "excel",
    xlsx: "excel",
    ppt: "powerpoint",
    pptx: "powerpoint",

    // 图片文件
    jpg: "image",
    jpeg: "image",
    png: "image",
    gif: "image",
    svg: "image",
    bmp: "image",
    ico: "image",
    webp: "image",

    // 压缩文件
    zip: "archive",
    rar: "archive",
    tar: "archive",
    gz: "archive",
    bz2: "archive",
    xz: "archive",
    "7z": "archive",

    // 其他
    sh: "shell",
    bash: "shell",
    bat: "shell",
    cmd: "shell",
    ps1: "shell",
    sql: "database",
    db: "database",
    sqlite: "database",
  };

  return iconMap[extension] || "file";
};

// 判断是否为二进制文件
export const isBinaryFile = (fileName) => {
  const binaryExtensions = [
    // 可执行文件
    "exe", "dll", "so", "dylib", "app",
    // 压缩文件
    "zip", "rar", "tar", "gz", "bz2", "xz", "7z",
    // 图片文件
    "jpg", "jpeg", "png", "gif", "bmp", "ico", "webp", "svg",
    // 音频文件
    "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a",
    // 视频文件
    "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm",
    // 文档文件
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
    // 字体文件
    "ttf", "otf", "woff", "woff2", "eot",
    // 数据库文件
    "db", "sqlite", "mdb",
    // 其他二进制文件
    "bin", "dat", "iso", "img",
  ];

  const extension = fileName.split(".").pop().toLowerCase();
  return binaryExtensions.includes(extension);
};

// 判断是否为文本文件
export const isTextFile = (fileName) => {
  const textExtensions = [
    // 代码文件
    "js", "jsx", "ts", "tsx", "py", "java", "c", "cpp", "cs", "go", "rs", "php", "rb", "swift", "kt", "scala", "r",
    // 标记和配置文件
    "html", "css", "scss", "sass", "less", "xml", "json", "yaml", "yml", "toml", "ini", "conf", "cfg",
    // 文档文件
    "md", "markdown", "txt", "log", "csv", "tsv",
    // 脚本文件
    "sh", "bash", "bat", "cmd", "ps1", "sql",
    // 其他文本文件
    "env", "gitignore", "dockerignore", "editorconfig", "eslintrc", "prettierrc",
  ];

  const extension = fileName.split(".").pop().toLowerCase();
  return textExtensions.includes(extension) || !fileName.includes(".");
};

// 判断是否为图片文件
export const isImageFile = (fileName) => {
  const imageExtensions = ["jpg", "jpeg", "png", "gif", "bmp", "ico", "webp", "svg"];
  const extension = fileName.split(".").pop().toLowerCase();
  return imageExtensions.includes(extension);
};

// 排序文件列表
export const sortFiles = (files, sortBy = "name", sortOrder = "asc") => {
  return [...files].sort((a, b) => {
    // 文件夹始终排在前面
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;

    let comparison = 0;

    switch (sortBy) {
      case "name":
        comparison = (a.name || "").localeCompare(b.name || "", undefined, {
          numeric: true,
          sensitivity: "base",
        });
        break;
      case "size":
        comparison = (a.size || 0) - (b.size || 0);
        break;
      case "modifiedTime":
        comparison = new Date(a.modifiedTime || 0).getTime() - new Date(b.modifiedTime || 0).getTime();
        break;
      default:
        comparison = 0;
    }

    return sortOrder === "asc" ? comparison : -comparison;
  });
};

// 过滤文件列表
export const filterFiles = (files, searchTerm) => {
  if (!searchTerm) return files;

  const term = searchTerm.toLowerCase();
  return files.filter(file =>
    file.name.toLowerCase().includes(term)
  );
};

// 获取文件路径
export const getFilePath = (currentPath, fileName) => {
  if (currentPath === "/" || currentPath === "~") {
    return `${currentPath}/${fileName}`;
  }
  return `${currentPath}/${fileName}`;
};

// 解析路径
export const parsePath = (path) => {
  if (!path || path === "/") {
    return { dir: "/", base: "", name: "", ext: "" };
  }

  const parts = path.split("/");
  const base = parts.pop() || "";
  const dir = parts.join("/") || "/";
  const dotIndex = base.lastIndexOf(".");

  return {
    dir,
    base,
    name: dotIndex > 0 ? base.substring(0, dotIndex) : base,
    ext: dotIndex > 0 ? base.substring(dotIndex + 1) : "",
  };
};

// 规范化路径
export const normalizePath = (path) => {
  if (!path) return "/";

  // 移除多余的斜杠
  path = path.replace(/\/+/g, "/");

  // 移除末尾的斜杠（除非是根目录）
  if (path !== "/" && path.endsWith("/")) {
    path = path.slice(0, -1);
  }

  return path;
};