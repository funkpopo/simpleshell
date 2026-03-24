import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
} from "react";
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
  Divider,
  Stack,
  Chip,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SaveIcon from "@mui/icons-material/Save";
import RestoreIcon from "@mui/icons-material/Restore";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import ZoomInIcon from "@mui/icons-material/ZoomIn";
import ZoomOutIcon from "@mui/icons-material/ZoomOut";
import { useTheme, alpha } from "@mui/material/styles";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, Decoration, lineNumbers } from "@codemirror/view";
import {
  EditorState,
  EditorSelection,
  RangeSetBuilder,
} from "@codemirror/state";
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
import { formatFileSize } from "../core/utils/formatters.js";
// 延迟导入 react-pdf 以避免 webpack 模块初始化问题
let Document, Page, pdfjs;
let reactPdfLoaded = false;

// 动态加载 react-pdf
const loadReactPdf = async () => {
  if (reactPdfLoaded) return;

  try {
    const reactPdfModule = await import("react-pdf");
    Document = reactPdfModule.Document;
    Page = reactPdfModule.Page;
    pdfjs = reactPdfModule.pdfjs;

    // 配置PDF.js worker - 使用本地文件
    if (typeof window !== "undefined" && pdfjs) {
      try {
        // 使用 webpack 的 require 来导入 worker 文件
        const workerPath = require("pdfjs-dist/build/pdf.worker.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
      } catch (e) {
        // 如果 require 失败，使用相对路径
        pdfjs.GlobalWorkerOptions.workerSrc = "./pdf.worker.min.mjs";
        console.warn("使用备用路径加载 PDF worker:", e);
      }
    }

    // 动态导入 CSS
    await import("react-pdf/dist/Page/AnnotationLayer.css");
    await import("react-pdf/dist/Page/TextLayer.css");

    reactPdfLoaded = true;
  } catch (error) {
    console.error("Failed to load react-pdf:", error);
    throw error;
  }
};

// 获取文件扩展名
const getFileExtension = (filename) => {
  return filename
    .slice(((filename.lastIndexOf(".") - 1) >>> 0) + 2)
    .toLowerCase();
};

// 判断是否是文本文件 - 支持绝大多数文件类型
const isTextFile = (filename) => {
  // 首先检查是否是明确的非文本文件类型
  if (isImageFile(filename) || isPdfFile(filename) || isBinaryFile(filename)) {
    return false;
  }

  // 对于其他所有文件，默认允许作为文本处理
  return true;
};

// 判断是否是二进制文件（不应该作为文本处理的文件）
const isBinaryFile = (filename) => {
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
    vue: javascript, // Vue 文件使用 JavaScript 高亮

    // Web 前端
    html: html,
    htm: html,
    xhtml: html,
    css: css,
    scss: css,
    sass: css,
    less: css,
    styl: css,
    stylus: css,

    // 数据格式
    json: json,
    jsonc: json,
    json5: json,
    geojson: json,

    // Python
    py: python,
    pyw: python,
    pyi: python,
    pyx: python,
    ipynb: json, // Jupyter notebooks are JSON

    // Java/Kotlin/Scala
    java: java,
    kt: java, // Kotlin 使用 Java 高亮
    kts: java,
    scala: java,
    sc: java,

    // C/C++/C#
    c: cpp,
    cpp: cpp,
    cc: cpp,
    cxx: cpp,
    c__: cpp,
    h: cpp,
    hpp: cpp,
    hxx: cpp,
    hh: cpp,
    cs: java, // C# 使用 Java 高亮

    // PHP
    php: php,
    phtml: php,
    php3: php,
    php4: php,
    php5: php,
    php7: php,
    phps: php,

    // Go
    go: go,
    mod: go, // go.mod 文件

    // Rust
    rs: rust,
    rlib: rust,

    // SQL
    sql: sql,
    mysql: sql,
    pgsql: sql,
    sqlite: sql,
    plsql: sql,

    // Markup
    xml: xml,
    svg: xml,
    xsl: xml,
    xslt: xml,
    xsd: xml,
    dtd: xml,
    plist: xml,

    // YAML
    yml: yaml,
    yaml: yaml,

    // Markdown
    md: markdown,
    markdown: markdown,
    mdown: markdown,
    mkd: markdown,
    mdx: markdown,
    rst: markdown, // reStructuredText
    adoc: markdown, // AsciiDoc
  };

  // 首先检查扩展名
  if (langMap[ext]) {
    return langMap[ext];
  }

  // 特殊文件名处理（无扩展名）
  if (baseName === "dockerfile" || baseName.startsWith("dockerfile.")) {
    return null; // Dockerfile 使用默认高亮
  }

  if (
    baseName === "makefile" ||
    baseName === "gnumakefile" ||
    baseName.startsWith("makefile.")
  ) {
    return null; // Makefile 使用默认高亮
  }

  if (
    baseName === "gemfile" ||
    baseName === "rakefile" ||
    baseName === "guardfile" ||
    baseName === "capfile" ||
    baseName === "vagrantfile" ||
    baseName === "berksfile" ||
    baseName === "puppetfile"
  ) {
    return null; // Ruby 文件，目前使用默认高亮
  }

  // CMake 文件
  if (baseName === "cmakelists.txt" || baseName.endsWith(".cmake")) {
    return null;
  }

  if (
    baseName === "package.json" ||
    baseName === "composer.json" ||
    baseName === "bower.json"
  ) {
    return json;
  }

  if (
    baseName.includes("requirements") &&
    (baseName.endsWith(".txt") || !baseName.includes("."))
  ) {
    return null; // Python requirements 文件
  }

  // 检查常见的文本文件扩展名
  const textExtensions = [
    "txt",
    "log",
    "out",
    "err",
    "tmp",
    "temp",
    "bak",
    "old",
    "orig",
  ];
  if (textExtensions.includes(ext)) {
    return null; // 纯文本文件
  }

  // Swift
  if (ext === "swift") {
    return null; // Swift 使用默认高亮
  }

  // Ruby
  if (ext === "rb" || ext === "erb" || ext === "rake") {
    return null; // Ruby 使用默认高亮
  }

  // Perl
  if (ext === "pl" || ext === "pm" || ext === "perl") {
    return null; // Perl 使用默认高亮
  }

  // Lua
  if (ext === "lua") {
    return null; // Lua 使用默认高亮
  }

  // R
  if (ext === "r" || ext === "R" || ext === "rmd" || ext === "Rmd") {
    return null; // R 使用默认高亮
  }

  if (
    baseName === "cargo.toml" ||
    baseName === "pyproject.toml" ||
    baseName === "gopkg.toml"
  ) {
    return null; // TOML 文件，使用默认高亮
  }

  // 配置文件
  if (baseName.endsWith(".toml")) {
    return null; // TOML
  }

  // Git 文件
  if (
    baseName === ".gitignore" ||
    baseName === ".gitattributes" ||
    baseName === ".gitmodules"
  ) {
    return null;
  }

  // 更多配置文件类型
  if (
    baseName === ".editorconfig" ||
    baseName === ".eslintrc" ||
    baseName === ".prettierrc" ||
    baseName === ".babelrc" ||
    baseName.endsWith(".eslintrc.js") ||
    baseName.endsWith(".prettierrc.js") ||
    baseName.endsWith(".babelrc.js")
  ) {
    return baseName.endsWith(".js") ? javascript : json;
  }

  if (
    baseName.endsWith(".ini") ||
    baseName.endsWith(".cfg") ||
    baseName.endsWith(".conf")
  ) {
    return null; // 配置文件
  }

  if (baseName.endsWith(".env") || baseName.startsWith(".env")) {
    return null; // 环境变量文件
  }

  // Shell 脚本
  if (
    baseName.endsWith(".sh") ||
    baseName.endsWith(".bash") ||
    baseName.endsWith(".zsh") ||
    baseName.endsWith(".fish") ||
    baseName.endsWith(".ksh") ||
    baseName.endsWith(".csh") ||
    baseName.endsWith(".tcsh") ||
    baseName === ".bashrc" ||
    baseName === ".zshrc" ||
    baseName === ".bash_profile" ||
    baseName === ".profile"
  ) {
    return null; // Shell 脚本，使用默认高亮
  }

  // PowerShell
  if (
    baseName.endsWith(".ps1") ||
    baseName.endsWith(".psm1") ||
    baseName.endsWith(".psd1")
  ) {
    return null;
  }

  // Batch files
  if (baseName.endsWith(".bat") || baseName.endsWith(".cmd")) {
    return null;
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

const formatSnapshotDate = (value) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value || "");
  }

  return date.toLocaleString();
};

const splitTextLines = (value) => String(value ?? "").split("\n");

const diffLineSequences = (currentLines, snapshotLines) => {
  const currentLength = currentLines.length;
  const snapshotLength = snapshotLines.length;
  const max = currentLength + snapshotLength;
  const trace = [];
  let vertices = new Map([[1, 0]]);

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(new Map(vertices));

    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const leftVertex = vertices.get(diagonal - 1);
      const rightVertex = vertices.get(diagonal + 1);

      let currentIndex;
      if (
        diagonal === -distance ||
        (diagonal !== distance &&
          (leftVertex ?? Number.NEGATIVE_INFINITY) <
            (rightVertex ?? Number.NEGATIVE_INFINITY))
      ) {
        currentIndex = rightVertex ?? 0;
      } else {
        currentIndex = (leftVertex ?? 0) + 1;
      }

      let snapshotIndex = currentIndex - diagonal;

      while (
        currentIndex < currentLength &&
        snapshotIndex < snapshotLength &&
        currentLines[currentIndex] === snapshotLines[snapshotIndex]
      ) {
        currentIndex += 1;
        snapshotIndex += 1;
      }

      vertices.set(diagonal, currentIndex);

      if (currentIndex >= currentLength && snapshotIndex >= snapshotLength) {
        const operations = [];
        let currentPointer = currentLength;
        let snapshotPointer = snapshotLength;

        for (
          let traceIndex = trace.length - 1;
          traceIndex >= 0;
          traceIndex -= 1
        ) {
          const traceVertices = trace[traceIndex];
          const traceDiagonal = currentPointer - snapshotPointer;

          let previousDiagonal;
          if (
            traceDiagonal === -traceIndex ||
            (traceDiagonal !== traceIndex &&
              (traceVertices.get(traceDiagonal - 1) ??
                Number.NEGATIVE_INFINITY) <
                (traceVertices.get(traceDiagonal + 1) ??
                  Number.NEGATIVE_INFINITY))
          ) {
            previousDiagonal = traceDiagonal + 1;
          } else {
            previousDiagonal = traceDiagonal - 1;
          }

          const previousCurrent = traceVertices.get(previousDiagonal) ?? 0;
          const previousSnapshot = previousCurrent - previousDiagonal;

          while (
            currentPointer > previousCurrent &&
            snapshotPointer > previousSnapshot
          ) {
            operations.push({
              type: "equal",
              currentText: currentLines[currentPointer - 1],
              snapshotText: snapshotLines[snapshotPointer - 1],
            });
            currentPointer -= 1;
            snapshotPointer -= 1;
          }

          if (traceIndex === 0) {
            break;
          }

          if (currentPointer === previousCurrent) {
            operations.push({
              type: "insert",
              snapshotText: snapshotLines[snapshotPointer - 1],
            });
            snapshotPointer -= 1;
          } else {
            operations.push({
              type: "delete",
              currentText: currentLines[currentPointer - 1],
            });
            currentPointer -= 1;
          }
        }

        return operations.reverse();
      }
    }
  }

  return [];
};

const buildSnapshotDiffData = (baseContent, currentContent) => {
  const baseLines = splitTextLines(baseContent);
  const currentLines = splitTextLines(currentContent);
  const operations = diffLineSequences(baseLines, currentLines);
  const rows = [];
  const summary = {
    changed: 0,
    added: 0,
    removed: 0,
  };

  let operationIndex = 0;
  let baseLineNumber = 1;
  let currentLineNumber = 1;

  while (operationIndex < operations.length) {
    const operation = operations[operationIndex];

    if (operation.type === "equal") {
      rows.push({
        type: "equal",
        baseLineNumber,
        baseText: operation.currentText ?? "",
        currentLineNumber,
        currentText: operation.snapshotText ?? "",
      });
      baseLineNumber += 1;
      currentLineNumber += 1;
      operationIndex += 1;
      continue;
    }

    const removedRows = [];
    const addedRows = [];

    while (
      operationIndex < operations.length &&
      operations[operationIndex].type !== "equal"
    ) {
      const blockOperation = operations[operationIndex];
      if (blockOperation.type === "delete") {
        removedRows.push({
          lineNumber: baseLineNumber,
          text: blockOperation.currentText ?? "",
        });
        baseLineNumber += 1;
      } else if (blockOperation.type === "insert") {
        addedRows.push({
          lineNumber: currentLineNumber,
          text: blockOperation.snapshotText ?? "",
        });
        currentLineNumber += 1;
      }
      operationIndex += 1;
    }

    const blockLength = Math.max(removedRows.length, addedRows.length);
    for (let rowIndex = 0; rowIndex < blockLength; rowIndex += 1) {
      const removedRow = removedRows[rowIndex] || null;
      const addedRow = addedRows[rowIndex] || null;

      if (removedRow && addedRow) {
        summary.changed += 1;
        rows.push({
          type: "changed",
          baseLineNumber: removedRow.lineNumber,
          baseText: removedRow.text,
          currentLineNumber: addedRow.lineNumber,
          currentText: addedRow.text,
        });
      } else if (removedRow) {
        summary.removed += 1;
        rows.push({
          type: "removed",
          baseLineNumber: removedRow.lineNumber,
          baseText: removedRow.text,
          currentLineNumber: null,
          currentText: "",
        });
      } else if (addedRow) {
        summary.added += 1;
        rows.push({
          type: "added",
          baseLineNumber: null,
          baseText: "",
          currentLineNumber: addedRow.lineNumber,
          currentText: addedRow.text,
        });
      }
    }
  }

  return {
    rows,
    summary,
    hasChanges: summary.changed > 0 || summary.added > 0 || summary.removed > 0,
  };
};

const getDiffPaneRole = (rowType, side) => {
  if (rowType === "equal") {
    return "equal";
  }

  if (side === "base") {
    if (rowType === "changed" || rowType === "removed") {
      return "removed";
    }
    if (rowType === "added") {
      return "empty";
    }
  }

  if (side === "current") {
    if (rowType === "changed" || rowType === "added") {
      return "added";
    }
    if (rowType === "removed") {
      return "empty";
    }
  }

  return "equal";
};

const buildDiffPaneData = (rows, side) => {
  const lines = rows.map((row) =>
    side === "base" ? (row.baseText ?? "") : (row.currentText ?? ""),
  );

  return {
    value: lines.join("\n"),
    lineNumbers: rows.map((row) =>
      side === "base"
        ? (row.baseLineNumber ?? "")
        : (row.currentLineNumber ?? ""),
    ),
    lineRoles: rows.map((row) => getDiffPaneRole(row.type, side)),
  };
};

const buildDiffLineDecorations = (paneData) => {
  const builder = new RangeSetBuilder();
  const lines = paneData.value.split("\n");
  let offset = 0;

  paneData.lineRoles.forEach((role, index) => {
    if (role !== "equal") {
      builder.add(
        offset,
        offset,
        Decoration.line({
          attributes: {
            class: `cm-diffLine cm-diffLine--${role}`,
          },
        }),
      );
    }

    const lineLength = lines[index]?.length ?? 0;
    offset += lineLength;
    if (index < lines.length - 1) {
      offset += 1;
    }
  });

  return builder.finish();
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
  const [editorFont, setEditorFont] = useState("system");
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState(null);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState(null);
  const [selectedSnapshotContent, setSelectedSnapshotContent] = useState(null);
  const [loadingSelectedSnapshot, setLoadingSelectedSnapshot] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const textEditorRef = useRef(null);
  const textEditorScrollElementRef = useRef(null);
  const textEditorScrollListenerRef = useRef(null);
  const textEditorScrollSnapshotRef = useRef({ top: 0, left: 0 });
  const shouldRestoreTextEditorScrollRef = useRef(false);
  const syncedContentRef = useRef(null);

  // PDF相关状态
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfLibLoaded, setPdfLibLoaded] = useState(false);

  // 缓存文件路径状态
  const [cacheFilePath, setCacheFilePath] = useState(null);

  const fullPath = path === "/" ? "/" + file?.name : path + "/" + file?.name;
  const isTextPreview = isTextFile(file?.name);
  const visibleSnapshots = useMemo(
    () => snapshots.filter((snapshot) => snapshot?.type !== "rollback-backup"),
    [snapshots],
  );
  const snapshotDiffData = useMemo(() => {
    if (
      typeof content !== "string" ||
      typeof selectedSnapshotContent !== "string"
    ) {
      return null;
    }

    return buildSnapshotDiffData(selectedSnapshotContent, content);
  }, [content, selectedSnapshotContent]);
  const snapshotDiffPaneData = useMemo(() => {
    if (!snapshotDiffData) {
      return null;
    }

    return {
      base: buildDiffPaneData(snapshotDiffData.rows, "base"),
      current: buildDiffPaneData(snapshotDiffData.rows, "current"),
    };
  }, [snapshotDiffData]);

  const detachTextEditorScrollListener = useCallback(() => {
    if (
      textEditorScrollElementRef.current &&
      textEditorScrollListenerRef.current
    ) {
      textEditorScrollElementRef.current.removeEventListener(
        "scroll",
        textEditorScrollListenerRef.current,
      );
    }

    textEditorScrollElementRef.current = null;
    textEditorScrollListenerRef.current = null;
  }, []);

  const captureTextEditorScrollPosition = useCallback(
    (view = textEditorRef.current) => {
      if (!view?.scrollDOM) {
        return;
      }

      textEditorScrollSnapshotRef.current = {
        top: view.scrollDOM.scrollTop,
        left: view.scrollDOM.scrollLeft,
      };
    },
    [],
  );

  const restoreTextEditorScrollPosition = useCallback(
    (view = textEditorRef.current) => {
      if (!shouldRestoreTextEditorScrollRef.current || !view?.scrollDOM) {
        return;
      }

      const { top, left } = textEditorScrollSnapshotRef.current;
      shouldRestoreTextEditorScrollRef.current = false;

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const activeView = textEditorRef.current;
          if (!activeView?.scrollDOM) {
            return;
          }

          activeView.scrollDOM.scrollTop = top;
          activeView.scrollDOM.scrollLeft = left;
          activeView.requestMeasure();
        });
      });
    },
    [],
  );

  const handleTextEditorCreate = useCallback(
    (view) => {
      detachTextEditorScrollListener();
      textEditorRef.current = view;

      if (!view?.scrollDOM) {
        return;
      }

      const handleScroll = () => {
        captureTextEditorScrollPosition(view);
      };

      textEditorScrollElementRef.current = view.scrollDOM;
      textEditorScrollListenerRef.current = handleScroll;
      view.scrollDOM.addEventListener("scroll", handleScroll, {
        passive: true,
      });

      restoreTextEditorScrollPosition(view);
    },
    [
      captureTextEditorScrollPosition,
      detachTextEditorScrollListener,
      restoreTextEditorScrollPosition,
    ],
  );

  useEffect(() => {
    if (!open) {
      detachTextEditorScrollListener();
      textEditorRef.current = null;
      textEditorScrollSnapshotRef.current = { top: 0, left: 0 };
      shouldRestoreTextEditorScrollRef.current = false;
      syncedContentRef.current = null;
    }
  }, [detachTextEditorScrollListener, open]);

  useEffect(() => {
    return () => {
      detachTextEditorScrollListener();
    };
  }, [detachTextEditorScrollListener]);

  useEffect(() => {
    if (!open) {
      setPendingRestoreSnapshot(null);
      setSelectedSnapshotContent(null);
      setShowCloseConfirm(false);
    }
  }, [open]);

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

  const refreshSnapshots = useCallback(async () => {
    if (!open || !isTextPreview || !window.terminalAPI?.listFileSnapshots) {
      setSnapshots([]);
      return;
    }

    setLoadingSnapshots(true);
    try {
      const response = await window.terminalAPI.listFileSnapshots(
        tabId,
        fullPath,
      );
      if (response?.success) {
        setSnapshots(
          Array.isArray(response.snapshots) ? response.snapshots : [],
        );
      } else {
        throw new Error(response?.error || "加载快照列表失败");
      }
    } catch (error) {
      setNotification({
        message: `加载时间点失败: ${error.message || "未知错误"}`,
        severity: "error",
      });
    } finally {
      setLoadingSnapshots(false);
    }
  }, [open, isTextPreview, tabId, fullPath]);

  const createSnapshot = useCallback(
    async (
      snapshotContent,
      {
        label = "已保存版本",
        type = "save",
        silent = false,
        successMessage = "已创建时间点",
        createdAt,
        force = false,
      } = {},
    ) => {
      if (
        !isTextPreview ||
        typeof snapshotContent !== "string" ||
        !window.terminalAPI?.createFileSnapshot
      ) {
        return null;
      }

      setCreatingSnapshot(true);
      try {
        const response = await window.terminalAPI.createFileSnapshot(
          tabId,
          fullPath,
          snapshotContent,
          {
            label,
            type,
            createdAt,
            force,
          },
        );

        if (!response?.success) {
          throw new Error(response?.error || "创建快照失败");
        }

        await refreshSnapshots();

        if (!silent) {
          setNotification({
            message: response.deduplicated
              ? "当前内容与最新时间点一致，未重复保存。"
              : successMessage,
            severity: "success",
          });
        }

        return response.snapshot || null;
      } catch (error) {
        if (!silent) {
          setNotification({
            message: `创建时间点失败: ${error.message || "未知错误"}`,
            severity: "error",
          });
        }
        return null;
      } finally {
        setCreatingSnapshot(false);
      }
    },
    [isTextPreview, tabId, fullPath, refreshSnapshots],
  );

  useEffect(() => {
    if (!open || !file) return;

    const loadFileContent = async () => {
      setLoading(true);
      setError(null);
      setPendingRestoreSnapshot(null);
      setSnapshots([]);
      syncedContentRef.current = null;
      textEditorScrollSnapshotRef.current = { top: 0, left: 0 };
      shouldRestoreTextEditorScrollRef.current = true;

      try {
        // 检查文件大小限制 (10MB = 10 * 1024 * 1024 bytes)
        const maxFileSize = 10 * 1024 * 1024;
        if (file.size && file.size > maxFileSize) {
          setError(
            `文件大小为 ${formatFileSize(file.size)}，超过了 10MB 的预览限制。请下载文件后在本地查看和编辑。`,
          );
          setLoading(false);
          return;
        }
        if (isTextFile(file.name)) {
          // 尝试读取文本文件
          if (window.terminalAPI && window.terminalAPI.readFileContent) {
            const response = await window.terminalAPI.readFileContent(
              tabId,
              fullPath,
            );
            if (response.success) {
              // 检查内容是否可能是二进制数据
              const content = response.content;
              if (typeof content === "string") {
                // 简单检查是否包含大量不可打印字符（可能是二进制文件）
                const nonPrintableCount = [...content].filter((char) => {
                  const code = char.charCodeAt(0);
                  return (
                    (code >= 0 && code <= 8) ||
                    (code >= 14 && code <= 31) ||
                    (code >= 127 && code <= 255)
                  );
                }).length;
                const nonPrintableRatio =
                  content.length > 0 ? nonPrintableCount / content.length : 0;

                if (nonPrintableRatio > 0.3) {
                  // 如果不可打印字符超过30%，可能是二进制文件
                  setError(
                    "该文件可能包含二进制数据，无法安全地作为文本显示。您可以尝试下载文件以在本地查看。",
                  );
                } else {
                  setContent(content);
                  syncedContentRef.current = content;
                  // 重置修改状态
                  setModified(false);
                }
              } else {
                setContent(response.content);
                syncedContentRef.current = response.content;
                setModified(false);
              }
            } else {
              // 如果读取失败，提供更友好的错误信息
              const errorMsg = response.error || "读取文件内容失败";
              if (errorMsg.includes("binary") || errorMsg.includes("二进制")) {
                setError(
                  "该文件包含二进制数据，无法作为文本显示。您可以下载文件以在本地查看。",
                );
              } else {
                setError(
                  errorMsg + "。如果这是文本文件，您可以尝试下载后查看。",
                );
              }
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
          // 首先加载 react-pdf 库
          try {
            await loadReactPdf();
            setPdfLibLoaded(true);
          } catch (err) {
            setError("无法加载 PDF 预览库: " + err.message);
            setLoading(false);
            return;
          }

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
          setError(
            "此文件类型被识别为二进制文件，无法作为文本预览。您可以下载文件在本地查看。",
          );
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
  }, [open, file, fullPath, tabId, createSnapshot]);

  useEffect(() => {
    if (!open || !isTextPreview || pendingRestoreSnapshot) {
      return;
    }

    restoreTextEditorScrollPosition();
  }, [
    editorFont,
    fullPath,
    isEditing,
    isTextPreview,
    open,
    pendingRestoreSnapshot,
    restoreTextEditorScrollPosition,
    theme.palette.mode,
  ]);

  useEffect(() => {
    if (!open || !isTextPreview) {
      setSnapshots([]);
      return;
    }

    refreshSnapshots();
  }, [open, isTextPreview, refreshSnapshots]);

  useEffect(() => {
    if (
      pendingRestoreSnapshot?.id &&
      !visibleSnapshots.some(
        (snapshot) => snapshot.id === pendingRestoreSnapshot.id,
      )
    ) {
      setPendingRestoreSnapshot(null);
      setSelectedSnapshotContent(null);
    }
  }, [pendingRestoreSnapshot, visibleSnapshots]);

  useEffect(() => {
    if (!pendingRestoreSnapshot?.id) {
      setSelectedSnapshotContent(null);
      setLoadingSelectedSnapshot(false);
      return;
    }

    if (!window.terminalAPI?.getFileSnapshot) {
      setNotification({
        message: "时间点读取API不可用",
        severity: "error",
      });
      setPendingRestoreSnapshot(null);
      setSelectedSnapshotContent(null);
      setLoadingSelectedSnapshot(false);
      return;
    }

    let cancelled = false;
    const snapshotId = pendingRestoreSnapshot.id;

    setLoadingSelectedSnapshot(true);

    const loadSelectedSnapshot = async () => {
      try {
        const response = await window.terminalAPI.getFileSnapshot(
          tabId,
          fullPath,
          snapshotId,
        );

        if (!response?.success) {
          throw new Error(response?.error || "读取时间点失败");
        }

        if (!cancelled) {
          setSelectedSnapshotContent(
            typeof response.snapshot?.content === "string"
              ? response.snapshot.content
              : "",
          );
        }
      } catch (error) {
        if (!cancelled) {
          setNotification({
            message: `加载差异失败: ${error.message || "未知错误"}`,
            severity: "error",
          });
          setPendingRestoreSnapshot((current) =>
            current?.id === snapshotId ? null : current,
          );
          setSelectedSnapshotContent(null);
        }
      } finally {
        if (!cancelled) {
          setLoadingSelectedSnapshot(false);
        }
      }
    };

    loadSelectedSnapshot();

    return () => {
      cancelled = true;
    };
  }, [pendingRestoreSnapshot, tabId, fullPath]);

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
    } catch {
      /* intentionally ignored */
    }
  };

  // 处理文本编辑
  const handleEditorChange = useCallback((value) => {
    setContent(value);
    setModified(true);
  }, []);

  const handleSelectSnapshot = useCallback(
    (snapshot) => {
      if (!snapshot?.id || restoringSnapshotId) {
        return;
      }

      if (pendingRestoreSnapshot?.id === snapshot.id) {
        shouldRestoreTextEditorScrollRef.current = true;
        setPendingRestoreSnapshot(null);
        setSelectedSnapshotContent(null);
        return;
      }

      captureTextEditorScrollPosition();
      shouldRestoreTextEditorScrollRef.current = true;
      setPendingRestoreSnapshot(snapshot);
    },
    [
      captureTextEditorScrollPosition,
      pendingRestoreSnapshot,
      restoringSnapshotId,
    ],
  );

  const handleClearSnapshotSelection = useCallback(() => {
    shouldRestoreTextEditorScrollRef.current = true;
    setPendingRestoreSnapshot(null);
    setSelectedSnapshotContent(null);
  }, []);

  // 处理保存文件
  const handleSaveFile = useCallback(async () => {
    if (!file || !isTextFile(file.name) || !modified) return;

    try {
      setSavingFile(true);
      const saveClickedAt = new Date().toISOString();
      const baselineContent = syncedContentRef.current;
      const shouldCreateInitialSnapshot =
        visibleSnapshots.length === 0 &&
        typeof baselineContent === "string" &&
        baselineContent !== content;

      if (window.terminalAPI && window.terminalAPI.saveFileContent) {
        const response = await window.terminalAPI.saveFileContent(
          tabId,
          fullPath,
          content,
        );

        if (response.success) {
          if (shouldCreateInitialSnapshot) {
            await createSnapshot(baselineContent, {
              label: "初始版本",
              type: "initial",
              silent: true,
              createdAt: saveClickedAt,
              force: true,
            });
          }
          await createSnapshot(content, {
            label: "已保存版本",
            type: "save",
            silent: true,
            createdAt: saveClickedAt,
            force: true,
          });
          syncedContentRef.current = content;
          setNotification({
            message: shouldCreateInitialSnapshot
              ? "文件保存成功，已保留初始版本"
              : "文件保存成功",
            severity: "success",
          });
          setModified(false);
          return true;
        } else {
          setNotification({
            message: `保存失败: ${response.error || "未知错误"}`,
            severity: "error",
          });
          return false;
        }
      } else {
        setNotification({
          message: "文件保存API不可用",
          severity: "error",
        });
        return false;
      }
    } catch (error) {
      setNotification({
        message: `保存失败: ${error.message || "未知错误"}`,
        severity: "error",
      });
      return false;
    } finally {
      setSavingFile(false);
    }
  }, [
    file,
    content,
    modified,
    tabId,
    fullPath,
    createSnapshot,
    visibleSnapshots.length,
  ]);

  useEffect(() => {
    if (!open) return;

    const selector = '[data-file-preview-dialog="true"]';
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;

      const key = (event.key || "").toLowerCase();

      const target = event.target;
      const activeElement = document.activeElement;
      const isInsideDialog =
        (target &&
          typeof target.closest === "function" &&
          target.closest(selector)) ||
        (activeElement &&
          typeof activeElement.closest === "function" &&
          activeElement.closest(selector));

      if (!isInsideDialog) return;

      if (key === "s") {
        event.preventDefault();
        event.stopPropagation();

        if (!isTextFile(file?.name) || !isEditing || savingFile || !modified) {
          return;
        }

        handleSaveFile();
        return;
      }

      if (key === "a") {
        if (!isTextFile(file?.name) || isEditing) {
          return;
        }

        const view = textEditorRef.current;
        if (!view) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        view.focus();
        const docLength = view.state.doc.length;
        view.dispatch({
          selection: EditorSelection.single(0, docLength),
          scrollIntoView: true,
        });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, file, isEditing, modified, savingFile, handleSaveFile]);

  // 切换编辑/预览模式
  const toggleEditMode = useCallback(() => {
    captureTextEditorScrollPosition();
    shouldRestoreTextEditorScrollRef.current = true;
    setIsEditing((current) => !current);
  }, [captureTextEditorScrollPosition]);

  const handleRestoreSnapshot = useCallback(async () => {
    if (
      !pendingRestoreSnapshot?.id ||
      !window.terminalAPI?.restoreFileSnapshot ||
      typeof content !== "string"
    ) {
      return;
    }

    setRestoringSnapshotId(pendingRestoreSnapshot.id);

    try {
      const response = await window.terminalAPI.restoreFileSnapshot(
        tabId,
        fullPath,
        pendingRestoreSnapshot.id,
        content,
      );

      if (!response?.success) {
        throw new Error(response?.error || "回退失败");
      }

      setContent(response.content);
      syncedContentRef.current = response.content;
      setModified(false);
      setIsEditing(true);
      setSnapshots(Array.isArray(response.snapshots) ? response.snapshots : []);
      setSelectedSnapshotContent(null);
      shouldRestoreTextEditorScrollRef.current = true;
      setNotification({
        message: `已回退到 ${formatSnapshotDate(pendingRestoreSnapshot.createdAt)}`,
        severity: "success",
      });
      setPendingRestoreSnapshot(null);
    } catch (error) {
      setNotification({
        message: `回退失败: ${error.message || "未知错误"}`,
        severity: "error",
      });
    } finally {
      setRestoringSnapshotId(null);
    }
  }, [pendingRestoreSnapshot, tabId, fullPath, content]);

  // 处理字体选择变更
  const handleFontChange = async (event) => {
    const newFont = event.target.value;
    captureTextEditorScrollPosition();
    shouldRestoreTextEditorScrollRef.current = true;
    setEditorFont(newFont);

    try {
      // 保存到config.json
      if (window.terminalAPI?.saveUISettings) {
        // 先获取当前设置
        const currentSettings =
          (await window.terminalAPI.loadUISettings()) || {};
        // 更新文件预览字体设置
        const updatedSettings = {
          ...currentSettings,
          filePreviewFont: newFont,
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

  const textEditorExtensions = useMemo(() => {
    if (!isTextPreview) {
      return [];
    }

    const nextExtensions = [];
    const languageModeFn = getLanguageMode(file?.name);
    if (languageModeFn) {
      nextExtensions.push(languageModeFn());
    }

    if (theme.palette.mode === "dark") {
      nextExtensions.push(oneDark);
    }

    const scrollbarTrackColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.06)
        : alpha(theme.palette.common.black, 0.05);
    const scrollbarThumbColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.18)
        : alpha(theme.palette.text.secondary, 0.24);
    const scrollbarThumbHoverColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.primary.light, 0.4)
        : alpha(theme.palette.primary.main, 0.36);

    nextExtensions.push(
      EditorView.theme({
        ".cm-editor": {
          fontFamily: getFontFamily(editorFont) + " !important",
          width: "100%",
          height: "100%",
        },
        ".cm-scroller": {
          overflowX: "hidden",
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: `${scrollbarThumbColor} ${scrollbarTrackColor}`,
          "&::-webkit-scrollbar": {
            width: "10px",
            height: "0px",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: scrollbarTrackColor,
            borderRadius: "999px",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: scrollbarThumbColor,
            borderRadius: "999px",
            border: `2px solid ${
              theme.palette.mode === "dark"
                ? alpha(theme.palette.background.default, 0.55)
                : alpha(theme.palette.background.paper, 0.9)
            }`,
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: scrollbarThumbHoverColor,
          },
        },
        ".cm-content": {
          fontFamily: getFontFamily(editorFont) + " !important",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          minHeight: "100%",
        },
      }),
    );

    nextExtensions.push(EditorView.lineWrapping);

    return nextExtensions;
  }, [editorFont, file?.name, isTextPreview, theme]);

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
    if (isTextPreview && modified && !savingFile) {
      setShowCloseConfirm(true);
      return;
    }

    await cleanupCache(); // 清理缓存
    onClose();
  };

  const handleDiscardAndClose = async () => {
    setShowCloseConfirm(false);
    await cleanupCache();
    onClose();
  };

  const handleSaveAndClose = async () => {
    if (!modified) {
      await handleDiscardAndClose();
      return;
    }

    const saved = await handleSaveFile();
    if (saved) {
      setShowCloseConfirm(false);
      await cleanupCache();
      onClose();
    }
  };

  const renderSnapshotPanel = () => {
    if (!isTextPreview) {
      return null;
    }

    return (
      <Box
        sx={{
          minWidth: 0,
          minHeight: { xs: 220, lg: "100%" },
          display: "flex",
          flexDirection: "column",
          borderTop: {
            xs: `1px solid ${theme.palette.divider}`,
            lg: "none",
          },
          borderLeft: {
            xs: "none",
            lg: `1px solid ${theme.palette.divider}`,
          },
          backgroundColor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.background.default, 0.35)
              : alpha(theme.palette.background.default, 0.55),
        }}
      >
        <Box
          sx={{
            px: 1.5,
            py: 1.25,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
          >
            <Typography variant="subtitle2">已保存版本</Typography>
            <Button
              size="small"
              onClick={refreshSnapshots}
              disabled={loadingSnapshots || creatingSnapshot}
            >
              刷新
            </Button>
          </Stack>
        </Box>

        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: "auto",
          }}
        >
          {loadingSnapshots ? (
            <Box
              sx={{
                height: "100%",
                minHeight: 180,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress size={24} />
            </Box>
          ) : visibleSnapshots.length === 0 ? (
            <Box sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">
                还没有可回退的已保存版本。
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {visibleSnapshots.map((snapshot, index) => (
                <React.Fragment key={snapshot.id}>
                  <ListItemButton
                    alignItems="flex-start"
                    onClick={() => handleSelectSnapshot(snapshot)}
                    selected={pendingRestoreSnapshot?.id === snapshot.id}
                    disabled={Boolean(restoringSnapshotId)}
                    sx={{
                      px: 1.5,
                      py: 1.25,
                      alignItems: "flex-start",
                    }}
                  >
                    <ListItemText
                      primary={snapshot.label || "时间点"}
                      secondary={
                        <Box
                          component="span"
                          sx={{
                            mt: 0.5,
                            display: "flex",
                            flexDirection: "column",
                            gap: 0.25,
                          }}
                        >
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {formatSnapshotDate(snapshot.createdAt)}
                          </Typography>
                          <Typography
                            component="span"
                            variant="caption"
                            color="text.secondary"
                          >
                            {formatFileSize(snapshot.size || 0)}
                          </Typography>
                        </Box>
                      }
                      primaryTypographyProps={{
                        variant: "body2",
                        fontWeight: 600,
                      }}
                    />
                  </ListItemButton>
                  {index < visibleSnapshots.length - 1 ? <Divider /> : null}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>
      </Box>
    );
  };

  const renderSnapshotDiffView = () => {
    const diffSummary = snapshotDiffData?.summary || {
      changed: 0,
      added: 0,
      removed: 0,
    };
    const languageModeFn = getLanguageMode(file?.name || "");
    const scrollbarTrackColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.06)
        : alpha(theme.palette.common.black, 0.05);
    const scrollbarThumbColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.18)
        : alpha(theme.palette.text.secondary, 0.24);
    const scrollbarThumbHoverColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.primary.light, 0.4)
        : alpha(theme.palette.primary.main, 0.36);
    const fontFamily = getFontFamily(editorFont);
    const vscodeGreenBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.success.main, 0.22)
        : alpha(theme.palette.success.main, 0.14);
    const vscodeRedBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.error.main, 0.22)
        : alpha(theme.palette.error.main, 0.14);
    const neutralBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.02)
        : alpha(theme.palette.common.black, 0.012);
    const neutralEmptyBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.012)
        : alpha(theme.palette.common.black, 0.008);
    const addedAccent = alpha(theme.palette.success.main, 0.9);
    const removedAccent = alpha(theme.palette.error.main, 0.9);
    const paneBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.background.paper, 0.76)
        : alpha(theme.palette.background.paper, 0.94);
    const gutterBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.background.default, 0.88)
        : alpha(theme.palette.background.default, 0.82);
    const headerBackground =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.background.default, 0.66)
        : alpha(theme.palette.background.default, 0.72);
    const diffEditorTheme = EditorView.theme({
      "&": {
        height: "100%",
        backgroundColor: paneBackground,
      },
      ".cm-editor": {
        height: "100%",
        fontFamily: `${fontFamily} !important`,
        backgroundColor: paneBackground,
      },
      "&.cm-editor.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        overflowX: "hidden",
        overflowY: "auto",
        scrollbarWidth: "thin",
        scrollbarColor: `${scrollbarThumbColor} ${scrollbarTrackColor}`,
        "&::-webkit-scrollbar": {
          width: "10px",
          height: "0px",
        },
        "&::-webkit-scrollbar-track": {
          backgroundColor: scrollbarTrackColor,
          borderRadius: "999px",
        },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: scrollbarThumbColor,
          borderRadius: "999px",
        },
        "&::-webkit-scrollbar-thumb:hover": {
          backgroundColor: scrollbarThumbHoverColor,
        },
      },
      ".cm-content": {
        fontFamily: `${fontFamily} !important`,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        overflowWrap: "anywhere",
        minHeight: "100%",
        paddingBottom: "24px",
      },
      ".cm-line": {
        padding: "0 12px",
      },
      ".cm-gutters": {
        backgroundColor: gutterBackground,
        color: theme.palette.text.secondary,
        borderRight: `1px solid ${theme.palette.divider}`,
      },
      ".cm-lineNumbers .cm-gutterElement": {
        minWidth: "38px",
        padding: "0 10px 0 8px",
      },
      ".cm-activeLine, .cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
      ".cm-selectionBackground, .cm-selectionLayer": {
        backgroundColor: "transparent !important",
      },
      ".cm-cursor, .cm-dropCursor": {
        display: "none",
      },
      ".cm-diffLine--added": {
        backgroundColor: vscodeGreenBackground,
        boxShadow: `inset 3px 0 0 ${addedAccent}`,
      },
      ".cm-diffLine--removed": {
        backgroundColor: vscodeRedBackground,
        boxShadow: `inset 3px 0 0 ${removedAccent}`,
      },
      ".cm-diffLine--empty": {
        backgroundColor: neutralEmptyBackground,
      },
      ".cm-diffLine--equal": {
        backgroundColor: neutralBackground,
      },
    });

    const createDiffPaneExtensions = (paneData) => {
      const extensions = [];

      if (languageModeFn) {
        extensions.push(languageModeFn());
      }

      if (theme.palette.mode === "dark") {
        extensions.push(oneDark);
      }

      extensions.push(
        lineNumbers({
          formatNumber: (lineNo) => `${paneData.lineNumbers[lineNo - 1] ?? ""}`,
        }),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        diffEditorTheme,
        EditorView.decorations.of(buildDiffLineDecorations(paneData)),
      );

      return extensions;
    };

    const diffPaneStyle = {
      height: "100%",
      flex: "1 1 auto",
      overflow: "hidden",
      width: "100%",
      maxWidth: "100%",
    };

    return (
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "column",
          backgroundColor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.background.default, 0.18)
              : alpha(theme.palette.background.default, 0.35),
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.5,
            borderBottom: `1px solid ${theme.palette.divider}`,
            backgroundColor:
              theme.palette.mode === "dark"
                ? alpha(theme.palette.background.paper, 0.7)
                : alpha(theme.palette.background.paper, 0.92),
          }}
        >
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1}
            alignItems={{ xs: "flex-start", md: "center" }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="subtitle2">版本差异</Typography>
              <Typography variant="caption" color="text.secondary">
                {formatSnapshotDate(pendingRestoreSnapshot.createdAt)}
                的已保存版本与当前内容对比
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                variant="outlined"
                label={`变更 ${diffSummary.changed}`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`新增 ${diffSummary.added}`}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`删除 ${diffSummary.removed}`}
              />
            </Stack>
          </Stack>
        </Box>

        {loadingSelectedSnapshot ? (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <CircularProgress size={24} />
          </Box>
        ) : !snapshotDiffData || !snapshotDiffPaneData ? (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              px: 3,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              暂时无法生成当前版本和已保存版本的差异。
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              flex: 1,
              minHeight: 0,
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(0, 1fr) minmax(0, 1fr)",
              },
              gridTemplateRows: {
                xs: "minmax(0, 1fr) minmax(0, 1fr)",
                md: "1fr",
              },
            }}
          >
            <Box
              sx={{
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
                borderRight: {
                  xs: "none",
                  md: `1px solid ${theme.palette.divider}`,
                },
                borderBottom: {
                  xs: `1px solid ${theme.palette.divider}`,
                  md: "none",
                },
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  backgroundColor: headerBackground,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  已保存版本
                </Typography>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <CodeMirror
                  key={`diff-base-${pendingRestoreSnapshot?.id}-${editorFont}-${theme.palette.mode}`}
                  value={snapshotDiffPaneData.base.value}
                  height="100%"
                  basicSetup={false}
                  editable={false}
                  extensions={createDiffPaneExtensions(
                    snapshotDiffPaneData.base,
                  )}
                  theme={theme.palette.mode}
                  style={diffPaneStyle}
                  className="file-preview-diff-pane file-preview-diff-pane-base"
                />
              </Box>
            </Box>
            <Box
              sx={{
                minWidth: 0,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <Box
                sx={{
                  px: 1.5,
                  py: 1,
                  borderBottom: `1px solid ${theme.palette.divider}`,
                  backgroundColor: headerBackground,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  当前内容
                </Typography>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <CodeMirror
                  key={`diff-current-${pendingRestoreSnapshot?.id}-${editorFont}-${theme.palette.mode}`}
                  value={snapshotDiffPaneData.current.value}
                  height="100%"
                  basicSetup={false}
                  editable={false}
                  extensions={createDiffPaneExtensions(
                    snapshotDiffPaneData.current,
                  )}
                  theme={theme.palette.mode}
                  style={diffPaneStyle}
                  className="file-preview-diff-pane file-preview-diff-pane-current"
                />
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    );
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
      const boxSx = {
        flex: "1 1 auto",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        minHeight: 0,
      };

      const cmStyle = {
        height: "100%",
        flex: "1 1 auto",
        overflow: "hidden",
        width: "100%",
        maxWidth: "100%",
      };

      return (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              lg: "minmax(0, 1fr) 280px",
            },
            gridTemplateRows: {
              xs: "minmax(0, 1fr) 240px",
              lg: "1fr",
            },
          }}
        >
          <Box sx={boxSx}>
            {pendingRestoreSnapshot ? (
              renderSnapshotDiffView()
            ) : (
              <CodeMirror
                value={content || ""}
                height="100%"
                extensions={textEditorExtensions}
                theme={theme.palette.mode}
                editable={isEditing}
                readOnly={!isEditing}
                onChange={handleEditorChange}
                style={cmStyle}
                className={
                  isEditing ? "file-preview-editor" : "file-preview-viewer"
                }
                onCreateEditor={handleTextEditorCreate}
              />
            )}
          </Box>
          {renderSnapshotPanel()}
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
              display: "block",
            }}
          />
        </Box>
      );
    }

    if (isPdfFile(file?.name)) {
      // 如果 PDF 库还未加载，显示加载状态
      if (!pdfLibLoaded || !Document || !Page) {
        return (
          <Box
            sx={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
            }}
          >
            <CircularProgress />
          </Box>
        );
      }

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
      maxWidth={isPdfFile(file?.name) ? "xl" : "lg"}
      fullWidth
      PaperProps={{
        "data-file-preview-dialog": "true",
        sx: {
          minHeight: isPdfFile(file?.name) ? "85vh" : "70vh",
          maxHeight: isPdfFile(file?.name) ? "95vh" : "85vh",
          minWidth: isPdfFile(file?.name)
            ? "min(1024px, 95vw)"
            : isTextPreview
              ? "min(1180px, 96vw)"
              : "min(900px, 90vw)",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      <DialogTitle sx={{ px: 2.5, py: 2 }}>
        <Stack spacing={1.5}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={1.5}
            alignItems={{ xs: "flex-start", md: "center" }}
            justifyContent="space-between"
          >
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="h6" component="div" noWrap>
                {file?.name}
                {modified ? (
                  <span style={{ color: theme.palette.warning.main }}> *</span>
                ) : null}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.5,
                  maxWidth: "100%",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {fullPath}
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
              useFlexGap
            >
              {file?.size ? (
                <Chip
                  size="small"
                  label={formatFileSize(file.size)}
                  variant="outlined"
                />
              ) : null}
              {isTextPreview ? (
                <Chip
                  size="small"
                  color={
                    pendingRestoreSnapshot
                      ? "info"
                      : modified
                        ? "warning"
                        : isEditing
                          ? "primary"
                          : "default"
                  }
                  label={
                    pendingRestoreSnapshot
                      ? "差异对比中"
                      : modified
                        ? "有未保存修改"
                        : isEditing
                          ? "编辑中"
                          : "只读预览中"
                  }
                  variant={
                    pendingRestoreSnapshot || modified || isEditing
                      ? "filled"
                      : "outlined"
                  }
                />
              ) : null}
              <IconButton onClick={handleClose}>
                <CloseIcon />
              </IconButton>
            </Stack>
          </Stack>

          <Stack
            direction={{ xs: "column", lg: "row" }}
            spacing={1}
            alignItems={{ xs: "stretch", lg: "center" }}
            justifyContent="space-between"
          >
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {isTextPreview ? (
                <>
                  <Button
                    size="small"
                    variant={isEditing ? "contained" : "outlined"}
                    startIcon={isEditing ? <VisibilityIcon /> : <EditIcon />}
                    onClick={toggleEditMode}
                    disabled={loading || savingFile}
                  >
                    {isEditing ? "切换到预览" : "切换到编辑"}
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleSaveFile}
                    disabled={!isEditing || !modified || savingFile || loading}
                  >
                    {savingFile ? "保存中..." : "保存"}
                  </Button>
                </>
              ) : null}
              <Button
                size="small"
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownload}
                disabled={loading || savingFile}
              >
                下载
              </Button>
            </Stack>

            {isTextPreview ? (
              <FormControl size="small" sx={{ minWidth: 140 }}>
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
            ) : null}
          </Stack>
        </Stack>
      </DialogTitle>
      <DialogContent
        dividers
        sx={{
          flex: "1 1 auto",
          p: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          width: "100%",
          maxWidth: "100%",
          "&::-webkit-scrollbar": {
            width: "8px",
            height: "8px",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor:
              theme.palette.mode === "dark" ? "#2d2d2d" : "#f1f1f1",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: theme.palette.mode === "dark" ? "#555" : "#888",
            borderRadius: "4px",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: theme.palette.mode === "dark" ? "#666" : "#555",
          },
        }}
      >
        {savingFile ? (
          <Box
            sx={{
              display: "flex",
              flex: 1,
              justifyContent: "center",
              alignItems: "center",
              height: "100%",
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
      <DialogActions sx={{ px: 2.5, py: 1.5 }}>
        {pendingRestoreSnapshot ? (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mr: "auto" }}
          >
            <Typography variant="caption" color="text.secondary">
              已选中版本：{formatSnapshotDate(pendingRestoreSnapshot.createdAt)}
            </Typography>
            <Button
              size="small"
              onClick={handleClearSnapshotSelection}
              disabled={Boolean(restoringSnapshotId) || loadingSelectedSnapshot}
            >
              取消选择
            </Button>
          </Stack>
        ) : (
          <Box sx={{ mr: "auto" }} />
        )}
        {pendingRestoreSnapshot ? (
          <Button
            color="warning"
            startIcon={<RestoreIcon />}
            onClick={handleRestoreSnapshot}
            disabled={
              Boolean(restoringSnapshotId) ||
              savingFile ||
              loadingSelectedSnapshot
            }
          >
            {restoringSnapshotId
              ? "回退中..."
              : loadingSelectedSnapshot
                ? "加载对比中..."
                : "回退到该版本"}
          </Button>
        ) : null}
        <Button onClick={handleClose} disabled={savingFile}>
          关闭
        </Button>
      </DialogActions>

      <Dialog
        open={showCloseConfirm}
        onClose={() => {
          if (!savingFile) {
            setShowCloseConfirm(false);
          }
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>还有未保存的修改</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            当前文件仍有未保存内容。你可以先保存，或者直接关闭并放弃这些修改。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowCloseConfirm(false)}
            disabled={savingFile}
          >
            取消
          </Button>
          <Button
            onClick={handleDiscardAndClose}
            color="inherit"
            disabled={savingFile}
          >
            放弃修改
          </Button>
          <Button
            onClick={handleSaveAndClose}
            variant="contained"
            disabled={savingFile}
            startIcon={<SaveIcon />}
          >
            {savingFile ? "保存中..." : "保存后关闭"}
          </Button>
        </DialogActions>
      </Dialog>

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

export default memo(FilePreview);
