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
  Paper,
  Tooltip,
  Snackbar,
  Alert,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SaveIcon from "@mui/icons-material/Save";
import { useTheme } from "@mui/material/styles";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { xml } from "@codemirror/lang-xml";
import { oneDark } from "@codemirror/theme-one-dark";

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
    "css",
    "scss",
    "less",
    "md",
    "markdown",
    "xml",
    "yml",
    "yaml",
    "conf",
    "ini",
    "sh",
    "bash",
    "py",
    "java",
    "c",
    "cpp",
    "h",
    "php",
    "rb",
    "go",
    "ts",
    "tsx",
    "vue",
    "sql",
    "gitignore",
  ];
  const ext = getFileExtension(filename);
  return textExtensions.includes(ext);
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
  const langMap = {
    js: javascript,
    jsx: javascript,
    ts: javascript,
    tsx: javascript,
    html: html,
    htm: html,
    css: css,
    scss: css,
    less: css,
    json: json,
    py: python,
    python: python,
    xml: xml,
    svg: xml,
  };
  return langMap[ext] || null;
};

const FilePreview = ({ open, onClose, file, path, tabId }) => {
  const theme = useTheme();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [modified, setModified] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [notification, setNotification] = useState(null);

  const fullPath = path === "/" ? "/" + file?.name : path + "/" + file?.name;

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

  // 处理通知关闭
  const handleCloseNotification = () => {
    setNotification(null);
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
      if (isEditing) {
        // 编辑模式 - 使用 CodeMirror
        const languageMode = getLanguageMode(file.name);
        const extensions = [];

        if (languageMode) {
          extensions.push(languageMode());
        }

        // 根据主题添加编辑器主题
        if (theme.palette.mode === "dark") {
          extensions.push(oneDark);
        }

        return (
          <Box sx={{ width: "100%", height: "100%", minHeight: "400px" }}>
            <CodeMirror
              value={content || ""}
              height="400px"
              width="100%"
              extensions={extensions}
              onChange={handleEditorChange}
              theme={theme.palette.mode}
              style={{
                fontSize: "14px",
                fontFamily: "monospace",
                border: `1px solid ${theme.palette.divider}`,
                borderRadius: "4px",
              }}
            />
          </Box>
        );
      } else {
        // 预览模式 - 文本显示
        // 将文本内容拆分为行
        const lines = content ? content.split("\n") : [];

        return (
          <Box
            component="pre"
            sx={{
              width: "100%",
              maxHeight: "400px",
              overflowX: "auto",
              overflowY: "auto",
              backgroundColor:
                theme.palette.mode === "dark" ? "#1e1e1e" : "#f5f5f5",
              color: theme.palette.mode === "dark" ? "#d4d4d4" : "#333333",
              p: 2,
              borderRadius: 1,
              fontSize: "0.875rem",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              margin: 0,
            }}
          >
            {lines.map((line, index) => (
              <div key={index}>{line}</div>
            ))}
          </Box>
        );
      }
    }

    if (isImageFile(file?.name)) {
      return (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            height: "100%",
            overflow: "auto",
          }}
        >
          <img
            src={`data:${getMimeType(file.name)};base64,${content}`}
            alt={file.name}
            style={{ maxWidth: "100%", objectFit: "contain" }}
          />
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
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: "60vh",
          maxHeight: "80vh",
        },
      }}
    >
      <DialogTitle>
        <Box sx={{ display: "flex", alignItems: "center" }}>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {file?.name}
            {modified && (
              <span style={{ color: theme.palette.warning.main }}> *</span>
            )}
          </Typography>
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
              <IconButton onClick={onClose}>
                <CloseIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent dividers>
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
        <Button onClick={onClose}>关闭</Button>
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
