import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Button,
  Typography,
  Box,
  CircularProgress,
  Tooltip,
  Snackbar,
  Alert,
  ButtonGroup,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SaveIcon from "@mui/icons-material/Save";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { useTheme } from "@mui/material/styles";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { php } from "@codemirror/lang-php";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { oneDark } from "@codemirror/theme-one-dark";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

// 配置PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

// 获取文件扩展名
const getFileExtension = (filename) => {
  return filename
    .slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2)
    .toLowerCase();
};

// 判断是否是文本文件
const isTextFile = (filename) => {
  const textExtensions = [
    "txt",
    "log",
    "json",
    "js",
    "jsx",
    "html",
    "htm",
    "css",
    "scss",
    "sass",
    "less",
    "md",
    "markdown",
    "xml",
    "yml",
    "yaml",
    "conf",
    "config",
    "ini",
    "env",
    "sh",
    "bash",
    "zsh",
    "fish",
    "ps1",
    "py",
    "pyw",
    "java",
    "class",
    "c",
    "cpp",
    "cc",
    "cxx",
    "h",
    "hpp",
    "hxx",
    "php",
    "phtml",
    "rb",
    "go",
    "rs",
    "ts",
    "tsx",
    "vue",
    "sql",
    "mysql",
    "pgsql",
    "sqlite",
    "dockerfile",
    "dockerignore",
    "gitignore",
    "gitattributes",
    "makefile",
    "cmake",
    "gradle",
    "properties",
    "toml",
    "cfg",
    "editorconfig",
    "eslintrc",
    "prettierrc",
    "babelrc",
    "npmrc",
    "yarnrc",
    "gemfile",
    "podfile",
    "requirements",
    "package",
    "lock",
    "manifest",
    "cargo",
    "pyproject",
    "composer",
    "bower",
    "webpack",
    "vite",
    "rollup",
    "gulpfile",
    "gruntfile",
    "readme",
    "license",
    "changelog",
    "authors",
    "contributors",
    "todo",
    "fixme"
  ];
  const ext = getFileExtension(filename);
  const baseName = filename.toLowerCase();
  
  // 检查扩展名
  if (textExtensions.includes(ext)) {
    return true;
  }
  
  // 检查特殊文件名（没有扩展名的文件）
  const specialFiles = [
    "dockerfile",
    "makefile",
    "gemfile",
    "podfile",
    "vagrantfile",
    "gulpfile",
    "gruntfile",
    "rakefile",
    "procfile",
    "cmakelists",
    "readme",
    "license",
    "changelog",
    "authors",
    "contributors",
    "todo",
    "fixme"
  ];
  
  return specialFiles.some(name => baseName.includes(name));
};

// 判断是否是图片文件
const isImageFile = (filename) => {
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
const isPdfFile = (filename) => {
  const ext = getFileExtension(filename);
  return ext === "pdf";
};

// 获取MIME类型
const getMimeType = (filename) => {
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

// 获取文件对应的语言模式
const getLanguageMode = (filename) => {
  const ext = getFileExtension(filename);
  const baseName = filename.toLowerCase();
  
  // 主要通过扩展名判断
  const langMap = {
    // JavaScript/TypeScript
    js: javascript,
    jsx: javascript,
    ts: javascript,
    tsx: javascript,
    mjs: javascript,
    cjs: javascript,
    
    // Web 前端
    html: html,
    htm: html,
    xhtml: html,
    css: css,
    scss: css,
    sass: css,
    less: css,
    
    // 数据格式
    json: json,
    jsonc: json,
    json5: json,
    
    // Python
    py: python,
    pyw: python,
    pyi: python,
    
    // Java
    java: java,
    
    // C/C++
    c: cpp,
    cpp: cpp,
    cc: cpp,
    cxx: cpp,
    h: cpp,
    hpp: cpp,
    hxx: cpp,
    
    // PHP
    php: php,
    phtml: php,
    php3: php,
    php4: php,
    php5: php,
    
    // Go
    go: go,
    
    // Rust
    rs: rust,
    
    // SQL
    sql: sql,
    mysql: sql,
    pgsql: sql,
    sqlite: sql,
    
    // Markup
    xml: xml,
    svg: xml,
    xsl: xml,
    xslt: xml,
    
    // YAML
    yml: yaml,
    yaml: yaml,
    
    // Markdown
    md: markdown,
    markdown: markdown,
    mdown: markdown,
    mkd: markdown,
    mdx: markdown
  };
  
  // 首先检查扩展名
  if (langMap[ext]) {
    return langMap[ext];
  }
  
  // 特殊文件名处理（无扩展名）
  if (baseName === 'dockerfile' || baseName.startsWith('dockerfile.')) {
    return null; // Dockerfile 使用默认高亮
  }
  
  if (baseName === 'makefile' || baseName === 'gnumakefile' || baseName.startsWith('makefile.')) {
    return null; // Makefile 使用默认高亮
  }
  
  if (baseName === 'gemfile' || baseName === 'rakefile' || baseName === 'guardfile') {
    return null; // Ruby 文件，目前使用默认高亮
  }
  
  if (baseName === 'package.json' || baseName === 'composer.json' || baseName === 'bower.json') {
    return json;
  }
  
  if (baseName.includes('requirements') && (baseName.endsWith('.txt') || !baseName.includes('.'))) {
    return null; // Python requirements 文件
  }
  
  if (baseName === 'cargo.toml' || baseName === 'pyproject.toml') {
    return null; // TOML 文件，使用默认高亮
  }
  
  // 配置文件
  if (baseName.endsWith('.toml')) {
    return null; // TOML
  }
  
  if (baseName.endsWith('.ini') || baseName.endsWith('.cfg') || baseName.endsWith('.conf')) {
    return null; // 配置文件
  }
  
  if (baseName.endsWith('.env') || baseName.startsWith('.env')) {
    return null; // 环境变量文件
  }
  
  // Shell 脚本
  if (baseName.endsWith('.sh') || baseName.endsWith('.bash') || baseName.endsWith('.zsh') || baseName.endsWith('.fish')) {
    return null; // Shell 脚本，使用默认高亮
  }
  
  return null;
};

// 获取字体族名称
const getFontFamily = (fontSetting) => {
  switch (fontSetting) {
    case "fira-code":
      return '"Fira Code", "Consolas", "Monaco", "Courier New", monospace';
    case "consolas":
      return '"Consolas", "Monaco", "Courier New", monospace';
    case "space-mono":
      return '"Space Mono", "Consolas", "Monaco", "Courier New", monospace';
    case "system":
    default:
      return '"Consolas", "Monaco", "Courier New", monospace';
  }
};

// 字体选项定义
const fontOptions = [
  { value: "system", label: "系统默认" },
  { value: "consolas", label: "Consolas" },
  { value: "fira-code", label: "Fira Code" },
  { value: "space-mono", label: "Space Mono" },
];

const FilePreview = ({ open, onClose, file, path, tabId }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [modified, setModified] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [notification, setNotification] = useState(null);
  const [editorFont, setEditorFont] = useState("system");

  // PDF相关状态
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);

  // 缓存文件路径状态
  const [cacheFilePath, setCacheFilePath] = useState(null);

  const fullPath = path === "/" ? "/" + file?.name : path + "/" + file?.name;

  // 加载字体设置
  useEffect(() => {
    const loadFontSetting = async () => {
      try {
        // 从config.json加载文件预览字体设置
        if (window.terminalAPI?.loadUISettings) {
          const settings = await window.terminalAPI.loadUISettings();
          if (settings?.filePreviewFont) {
            setEditorFont(settings.filePreviewFont);
          }
        }
      } catch (error) {
        console.error("Failed to load font setting:", error);
      }
    };

    loadFontSetting();
  }, []);

  useEffect(() => {
    if (!open || !file) return;

    const loadFileContent = async () => {
      setLoading(true);
      setError(null);

      try {
        if (isTextFile(file.name)) {
          // 读取文本文件
          if (window.terminalAPI && window.terminalAPI.readFileContent) {
            const response = await window.terminalAPI.readFileContent(
              tabId,
              fullPath,
            );
            if (response.success) {
              setContent(response.content);
              // 重置修改状态
              setModified(false);
            } else {
              setError(response.error || "读取文件内容失败");
            }
          } else {
            setError("文件读取API不可用");
          }
        } else if (isImageFile(file.name)) {
          // 读取图片文件
          if (window.terminalAPI && window.terminalAPI.readFileAsBase64) {
            const response = await window.terminalAPI.readFileAsBase64(
              tabId,
              fullPath,
            );
            if (response.success) {
              setContent(response.content);
              // 保存缓存文件路径
              if (response.cacheFilePath) {
                setCacheFilePath(response.cacheFilePath);
              }
            } else {
              setError(response.error || "读取文件内容失败");
            }
          } else {
            setError("文件读取API不可用");
          }
        } else if (isPdfFile(file.name)) {
          // 读取PDF文件
          if (window.terminalAPI && window.terminalAPI.readFileAsBase64) {
            const response = await window.terminalAPI.readFileAsBase64(
              tabId,
              fullPath,
            );
            if (response.success) {
              // 将base64转换为正确的数据格式供react-pdf使用
              const binaryString = atob(response.content);
              const bytes = new Uint8Array(binaryString.length);
              for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
              }

              // react-pdf需要包含data属性的对象
              const pdfData = { data: bytes };
              setContent(pdfData);

              // 保存缓存文件路径
              if (response.cacheFilePath) {
                setCacheFilePath(response.cacheFilePath);
              }
              // 重置PDF状态
              setPageNumber(1);
              setNumPages(null);
              setScale(1.0);
            } else {
              setError(response.error || "读取文件内容失败");
            }
          } else {
            setError("文件读取API不可用");
          }
        } else {
          setError("不支持预览此类型的文件");
        }
      } catch (err) {
        setError("预览文件失败: " + (err.message || "未知错误"));
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
    // 重置编辑状态
    setIsEditing(false);
  }, [open, file, fullPath, tabId]);

  // 清理缓存 - 组件卸载时
  useEffect(() => {
    return () => {
      if (cacheFilePath) {
        cleanupCache();
      }
    };
  }, [cacheFilePath]);

  // 处理下载文件
  const handleDownload = async () => {
    if (!file) return;

    try {
      if (window.terminalAPI && window.terminalAPI.downloadFile) {
        await window.terminalAPI.downloadFile(
          tabId,
          fullPath,
          () => {}, // 简单进度回调
        );
      }
    } catch (error) {}
  };

  // 处理文本编辑
  const handleEditorChange = (value) => {
    setContent(value);
    setModified(true);
  };

  // 处理保存文件
  const handleSaveFile = async () => {
    if (!file || !isTextFile(file.name) || !modified) return;

    try {
      setSavingFile(true);

      if (window.terminalAPI && window.terminalAPI.saveFileContent) {
        const response = await window.terminalAPI.saveFileContent(
          tabId,
          fullPath,
          content,
        );

        if (response.success) {
          setNotification({
            message: "文件保存成功",
            severity: "success",
          });
          setModified(false);
        } else {
          setNotification({
            message: `保存失败: ${response.error || "未知错误"}`,
            severity: "error",
          });
        }
      } else {
        setNotification({
          message: "文件保存API不可用",
          severity: "error",
        });
      }
    } catch (error) {
      setNotification({
        message: `保存失败: ${error.message || "未知错误"}`,
        severity: "error",
      });
    } finally {
      setSavingFile(false);
    }
  };

  // 切换编辑/预览模式
  const toggleEditMode = () => {
    setIsEditing(!isEditing);
  };

  // 处理字体选择变更
  const handleFontChange = async (event) => {
    const newFont = event.target.value;
    setEditorFont(newFont);
    
    try {
      // 保存到config.json
      if (window.terminalAPI?.saveUISettings) {
        // 先获取当前设置
        const currentSettings = await window.terminalAPI.loadUISettings() || {};
        // 更新文件预览字体设置
        const updatedSettings = {
          ...currentSettings,
          filePreviewFont: newFont
        };
        // 保存更新后的设置
        await window.terminalAPI.saveUISettings(updatedSettings);
      }
    } catch (error) {
      console.error("Failed to save font setting:", error);
      setNotification({
        message: "字体设置保存失败",
        severity: "error",
      });
    }
  };

  // 处理通知关闭
  const handleCloseNotification = () => {
    setNotification(null);
  };

  // PDF相关事件处理
  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const onDocumentLoadError = (error) => {
    setError("PDF加载失败: " + error.message);
  };

  const goToPrevPage = () => {
    setPageNumber((prev) => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setPageNumber((prev) => Math.min(prev + 1, numPages || 1));
  };

  const zoomIn = () => {
    setScale((prev) => Math.min(prev + 0.2, 3.0));
  };

  const zoomOut = () => {
    setScale((prev) => Math.max(prev - 0.2, 0.5));
  };

  // 清理缓存文件
  const cleanupCache = async () => {
    if (
      cacheFilePath &&
      window.terminalAPI &&
      window.terminalAPI.cleanupFileCache
    ) {
      try {
        await window.terminalAPI.cleanupFileCache(cacheFilePath);
        setCacheFilePath(null);
      } catch (error) {
        console.error("Failed to cleanup cache file:", error);
      }
    }
  };

  // 处理对话框关闭
  const handleClose = async () => {
    await cleanupCache(); // 清理缓存
    onClose();
  };

  // 渲染文件内容
  const renderContent = () => {
    if (loading) {
      return (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "300px",
          }}
        >
          <CircularProgress size={40} />
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ p: 2, color: "error.main" }}>
          <Typography variant="body1">{error}</Typography>
        </Box>
      );
    }

    if (isTextFile(file?.name)) {
      const languageModeFn = getLanguageMode(file.name);
      const extensions = [];
      if (languageModeFn) {
        extensions.push(languageModeFn());
      }

      if (theme.palette.mode === "dark") {
        extensions.push(oneDark);
      }

      // 添加字体样式扩展和自适应宽度设置
      const fontExtension = EditorView.theme({
        '.cm-editor': {
          fontFamily: getFontFamily(editorFont) + ' !important',
          width: '100%',
        },
        '.cm-scroller': {
          overflow: 'auto',
        },
        '.cm-content': {
          fontFamily: getFontFamily(editorFont) + ' !important',
          whiteSpace: 'pre-wrap', // 允许换行
          wordBreak: 'break-word', // 长单词换行
          overflowWrap: 'break-word', // 强制换行
        }
      });
      extensions.push(fontExtension);

      // 添加扩展禁用水平滚动
      extensions.push(EditorView.lineWrapping);

      const boxSx = {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      };

      const cmStyle = {
        height: "100%",
        flex: "1 1 auto",
        overflow: "hidden", // 禁止容器级别的滚动条
        width: "100%",
        maxWidth: "100%",
      };

      if (isEditing) {
        return (
          <Box sx={boxSx}>
            <CodeMirror
              key={`editor-${editorFont}`}
              value={content || ""}
              height="100%"
              extensions={extensions}
              theme={theme.palette.mode}
              onChange={handleEditorChange}
              style={cmStyle}
              className="file-preview-editor"
            />
          </Box>
        );
      }
      // 预览模式
      return (
        <Box sx={boxSx}>
          <CodeMirror
            key={`viewer-${editorFont}`}
            value={content || ""}
            height="100%"
            extensions={extensions}
            editable={false}
            theme={theme.palette.mode}
            style={cmStyle}
            className="file-preview-viewer"
          />
        </Box>
      );
    }

    if (isImageFile(file?.name)) {
      return (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            height: "100%",
            overflow: "hidden", // 防止溢出
            padding: 2,
          }}
        >
          <img
            src={`data:${getMimeType(file.name)};base64,${content}`}
            alt={file.name}
            style={{ 
              maxWidth: "100%", 
              maxHeight: "100%",
              objectFit: "contain",
              display: "block"
            }}
          />
        </Box>
      );
    }

    if (isPdfFile(file?.name)) {
      return (
        <Box
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* PDF控制栏 */}
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 1,
              borderBottom: `1px solid ${theme.palette.divider}`,
              backgroundColor: theme.palette.background.paper,
              flexWrap: "wrap", // 允许换行
              gap: 1, // 添加间距
              minHeight: "48px", // 确保最小高度
            }}
          >
            <ButtonGroup size="small" variant="outlined">
              <Tooltip title="上一页">
                <span>
                  <IconButton
                    onClick={goToPrevPage}
                    disabled={pageNumber <= 1}
                    size="small"
                  >
                    <NavigateBeforeIcon />
                  </IconButton>
                </span>
              </Tooltip>
              <Tooltip title="下一页">
                <span>
                  <IconButton
                    onClick={goToNextPage}
                    disabled={pageNumber >= (numPages || 1)}
                    size="small"
                  >
                    <NavigateNextIcon />
                  </IconButton>
                </span>
              </Tooltip>
            </ButtonGroup>

            <Typography variant="body2" sx={{ mx: 2 }}>
              第 {pageNumber} 页，共 {numPages || 0} 页
            </Typography>

            <ButtonGroup size="small" variant="outlined">
              <Tooltip title="放大">
                <IconButton
                  onClick={zoomIn}
                  disabled={scale >= 3.0}
                  size="small"
                >
                  <ZoomInIcon />
                </IconButton>
              </Tooltip>
              <Tooltip title="缩小">
                <IconButton
                  onClick={zoomOut}
                  disabled={scale <= 0.5}
                  size="small"
                >
                  <ZoomOutIcon />
                </IconButton>
              </Tooltip>
            </ButtonGroup>
          </Box>

          {/* PDF内容区域 */}
          <Box
            sx={{
              flex: "1 1 auto",
              overflow: "hidden", // 防止溢出
              display: "flex",
              justifyContent: "center",
              alignItems: "flex-start",
              p: 2,
              backgroundColor: theme.palette.grey[100],
            }}
          >
            <Document
              file={content}
              onLoadSuccess={onDocumentLoadSuccess}
              onLoadError={onDocumentLoadError}
              loading={
                <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                  <CircularProgress />
                </Box>
              }
            >
              <Page
                pageNumber={pageNumber}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
              />
            </Document>
          </Box>
        </Box>
      );
    }

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="body1">
          无法预览此类型的文件。请下载后在本地查看。
        </Typography>
      </Box>
    );
  };

  if (!file) return null;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth={isPdfFile(file?.name) ? "lg" : "md"}
      fullWidth
      PaperProps={{
        sx: {
          minHeight: isPdfFile(file?.name) ? "80vh" : "60vh",
          maxHeight: isPdfFile(file?.name) ? "90vh" : "80vh",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {file?.name}
            {modified && (
              <span style={{ color: theme.palette.warning.main }}> *</span>
            )}
          </Typography>
          
          {/* 字体选择下拉菜单 - 仅在文本文件时显示 */}
          {isTextFile(file?.name) && (
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel id="font-select-label">字体</InputLabel>
              <Select
                labelId="font-select-label"
                value={editorFont}
                label="字体"
                onChange={handleFontChange}
              >
                {fontOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          
          <Box>
            {isTextFile(file?.name) && (
              <>
                <Tooltip
                  title={isEditing ? "切换到预览模式" : "切换到编辑模式"}
                >
                  <IconButton
                    color="primary"
                    onClick={toggleEditMode}
                    disabled={loading}
                  >
                    {isEditing ? <VisibilityIcon /> : <EditIcon />}
                  </IconButton>
                </Tooltip>

                <Tooltip title="保存文件">
                  <span>
                    <IconButton
                      color="primary"
                      onClick={handleSaveFile}
                      disabled={
                        !isEditing || !modified || savingFile || loading
                      }
                    >
                      <SaveIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </>
            )}
            <Tooltip title="下载文件">
              <IconButton
                color="primary"
                onClick={handleDownload}
                disabled={loading}
              >
                <DownloadIcon />
              </IconButton>
            </Tooltip>
            <Tooltip title="关闭">
              <IconButton onClick={handleClose}>
                <CloseIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          flex: "1 1 auto",
          p: 0, // 内边距由renderContent内部处理
          display: "flex",
          flexDirection: "column",
          overflow: "hidden", // 防止内容溢出
          width: "100%",
          maxWidth: "100%",
        }}
      >
        {savingFile ? (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "400px",
            }}
          >
            <CircularProgress size={40} />
            <Typography variant="body1" sx={{ ml: 2 }}>
              正在保存文件...
            </Typography>
          </Box>
        ) : (
          renderContent()
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>关闭</Button>
        {isTextFile(file?.name) && isEditing && (
          <Button
            onClick={handleSaveFile}
            color="primary"
            disabled={!modified || savingFile}
            startIcon={<SaveIcon />}
          >
            {savingFile ? "保存中..." : "保存"}
          </Button>
        )}
      </DialogActions>

      {/* 通知消息 */}
      <Snackbar
        open={notification !== null}
        autoHideDuration={3000}
        onClose={handleCloseNotification}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        {notification && (
          <Alert
            onClose={handleCloseNotification}
            severity={notification.severity}
            sx={{ width: "100%" }}
          >
            {notification.message}
          </Alert>
        )}
      </Snackbar>
    </Dialog>
  );
};

// 格式化文件大小
const formatFileSize = (bytes) => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

export default FilePreview;
