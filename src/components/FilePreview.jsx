import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  memo,
} from "react";
import Dialog from "./AccessibleDialog.jsx";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Button,
  Typography,
  Box,
  CircularProgress,
  Tooltip,
  ButtonGroup,
  Divider,
  Stack,
  Chip,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import { useNotification } from "../contexts/NotificationContext";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentCutIcon from "@mui/icons-material/ContentCut";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DownloadIcon from "@mui/icons-material/Download";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityIcon from "@mui/icons-material/Visibility";
import SaveIcon from "@mui/icons-material/Save";
import SearchIcon from "@mui/icons-material/Search";
import RestoreIcon from "@mui/icons-material/Restore";
import NavigateBeforeIcon from "@mui/icons-material/NavigateBefore";
import NavigateNextIcon from "@mui/icons-material/NavigateNext";
import SelectAllIcon from "@mui/icons-material/SelectAll";
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
import { oneDark } from "@codemirror/theme-one-dark";
import { openSearchPanel, search } from "@codemirror/search";
import {
  getCodemirrorLanguageIdFromFilename,
  getFileExtension,
  loadCodemirrorLanguageExtension,
} from "../utils/filePreviewCodemirrorLanguages.js";
import { useTranslation } from "react-i18next";
import {
  formatAbsoluteDateTime,
  formatFileSize,
} from "../core/utils/formatters.js";
import {
  CONSOLAS_FONT_FAMILY,
  FIRA_CODE_FONT_FAMILY,
  SPACE_MONO_FONT_FAMILY,
} from "../utils/fonts.js";
import { useGlobalTransfers } from "../store/globalTransferStore.js";
import {
  normalizeTransferProgress,
  createTransferUiHelpers,
} from "../utils/transferTaskHelpers.js";
import { compactContextMenuPaperSx } from "./contextMenuStyles";
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

const normalizeEditorFontSetting = (fontSetting) => {
  if (!fontSetting || typeof fontSetting !== "string") {
    return "system";
  }

  const normalized = fontSetting.trim().toLowerCase();
  switch (normalized) {
    case "fira code":
    case "fira-code":
      return "fira-code";
    case "space mono":
    case "space-mono":
      return "space-mono";
    case "consolas":
      return "consolas";
    case "system":
    default:
      return "system";
  }
};

// 获取字体族名称
const getFontFamily = (fontSetting) => {
  switch (normalizeEditorFontSetting(fontSetting)) {
    case "fira-code":
      return FIRA_CODE_FONT_FAMILY;
    case "consolas":
      return CONSOLAS_FONT_FAMILY;
    case "space-mono":
      return SPACE_MONO_FONT_FAMILY;
    case "system":
    default:
      return CONSOLAS_FONT_FAMILY;
  }
};

const resolveGlobalEditorFontSetting = (settings) => {
  if (!settings || typeof settings !== "object") {
    return "system";
  }

  const normalizedEditorFont = normalizeEditorFontSetting(settings.editorFont);
  if (settings.editorFont && normalizedEditorFont !== "system") {
    return normalizedEditorFont;
  }

  return settings.terminalFont || normalizedEditorFont;
};

const formatSnapshotDate = (value) =>
  formatAbsoluteDateTime(value, { fallback: String(value || "") });

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

const getEditorSelectedText = (view) => {
  if (!view?.state) {
    return "";
  }

  return view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => view.state.doc.sliceString(range.from, range.to))
    .join("\n");
};

const FilePreview = ({ open, onClose, file, path, tabId }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [modified, setModified] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const { showNotification: showGlobalNotification } = useNotification();

  // 通知适配器：沿用原本地 Snackbar 的行为（3 秒自动关闭、底部居中、标准样式）
  const setNotification = useCallback(
    (notification) => {
      if (!notification) {
        return;
      }
      showGlobalNotification(
        notification.message,
        notification.severity || "info",
        {
          autoHideDuration: 3000,
          anchorOrigin: { vertical: "bottom", horizontal: "center" },
          variant: "standard",
        },
      );
    },
    [showGlobalNotification],
  );

  const [globalEditorFont, setGlobalEditorFont] = useState("system");
  const [snapshots, setSnapshots] = useState([]);
  const [loadingSnapshots, setLoadingSnapshots] = useState(false);
  const [creatingSnapshot, setCreatingSnapshot] = useState(false);
  const [restoringSnapshotId, setRestoringSnapshotId] = useState(null);
  const [pendingRestoreSnapshot, setPendingRestoreSnapshot] = useState(null);
  const [selectedSnapshotContent, setSelectedSnapshotContent] = useState(null);
  const [loadingSelectedSnapshot, setLoadingSelectedSnapshot] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [contextMenu, setContextMenu] = useState(null);
  const textEditorRef = useRef(null);
  const textEditorScrollElementRef = useRef(null);
  const textEditorScrollListenerRef = useRef(null);
  const textEditorScrollSnapshotRef = useRef({ top: 0, left: 0 });
  const shouldRestoreTextEditorScrollRef = useRef(false);
  const textEditorScrollRestoreModeRef = useRef("always");
  const syncedContentRef = useRef(null);
  const syncedContentTimestampRef = useRef(null);
  const closeInProgressRef = useRef(false);

  const [codemirrorLangExtensions, setCodemirrorLangExtensions] = useState([]);
  const [syntaxHighlightState, setSyntaxHighlightState] = useState({
    languageId: null,
    loading: false,
    error: null,
  });

  // PDF相关状态
  const [numPages, setNumPages] = useState(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [scale, setScale] = useState(1.0);
  const [pdfLibLoaded, setPdfLibLoaded] = useState(false);

  // 缓存文件路径状态
  const [cacheFilePath, setCacheFilePath] = useState(null);

  const fullPath = path === "/" ? "/" + file?.name : path + "/" + file?.name;
  const {
    addTransferProgress,
    updateTransferProgress,
    scheduleTransferCleanup,
  } = useGlobalTransfers(tabId);
  const { markTransferCancelled, markTransferFailed, markTransferCompleted } =
    useMemo(
      () =>
        createTransferUiHelpers({
          updateTransferProgress,
          scheduleTransferCleanup,
        }),
      [updateTransferProgress, scheduleTransferCleanup],
    );
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

  const queueTextEditorScrollRestore = useCallback((mode = "always") => {
    textEditorScrollRestoreModeRef.current = mode;
    shouldRestoreTextEditorScrollRef.current = true;
  }, []);

  const restoreTextEditorScrollPosition = useCallback(
    (view = textEditorRef.current) => {
      if (!shouldRestoreTextEditorScrollRef.current || !view?.scrollDOM) {
        return;
      }

      const { top, left } = textEditorScrollSnapshotRef.current;
      const mode = textEditorScrollRestoreModeRef.current;
      shouldRestoreTextEditorScrollRef.current = false;
      textEditorScrollRestoreModeRef.current = "always";

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const activeView = textEditorRef.current;
          if (!activeView?.scrollDOM) {
            return;
          }

          if (mode === "if-top-jump") {
            const currentTop = activeView.scrollDOM.scrollTop;
            const currentLeft = activeView.scrollDOM.scrollLeft;
            const jumpedToTop = top > 4 && currentTop <= 4;
            const jumpedToLeft = left > 4 && currentLeft <= 4;

            if (!jumpedToTop && !jumpedToLeft) {
              return;
            }

            if (jumpedToTop) {
              activeView.scrollDOM.scrollTop = top;
            }
            if (jumpedToLeft) {
              activeView.scrollDOM.scrollLeft = left;
            }
          } else {
            activeView.scrollDOM.scrollTop = top;
            activeView.scrollDOM.scrollLeft = left;
          }

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

  const diffBaseViewRef = useRef(null);
  const diffCurrentViewRef = useRef(null);
  const diffScrollEchoRef = useRef(null);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const getContextMenuEditorView = useCallback(() => {
    switch (contextMenu?.kind) {
      case "text":
        return textEditorRef.current;
      case "diff-base":
        return diffBaseViewRef.current;
      case "diff-current":
        return diffCurrentViewRef.current;
      default:
        return null;
    }
  }, [contextMenu?.kind]);

  const openPreviewContextMenu = useCallback((event, kind) => {
    const target = event.target;
    if (
      target?.closest?.(
        ".cm-panel.cm-search, input, textarea, select, button, [role='button']",
      )
    ) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    let resolvedKind = kind;
    let view = null;

    if (kind === "text") {
      view = textEditorRef.current;
    } else if (kind === "diff") {
      if (target?.closest?.(".file-preview-diff-pane-base")) {
        resolvedKind = "diff-base";
        view = diffBaseViewRef.current;
      } else {
        resolvedKind = "diff-current";
        view = diffCurrentViewRef.current;
      }
    }

    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      kind: resolvedKind,
      canCopy: Boolean(getEditorSelectedText(view)),
    });
  }, []);

  const handleTextContextMenu = useCallback(
    (event) => openPreviewContextMenu(event, "text"),
    [openPreviewContextMenu],
  );

  const handleDiffContextMenu = useCallback(
    (event) => openPreviewContextMenu(event, "diff"),
    [openPreviewContextMenu],
  );

  const handleMediaContextMenu = useCallback((event) => {
    const target = event.target;
    if (target?.closest?.("button, [role='button']")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      mouseX: event.clientX + 2,
      mouseY: event.clientY - 6,
      kind: "media",
      canCopy: false,
    });
  }, []);

  const handleCopySelection = useCallback(async () => {
    const view = getContextMenuEditorView();
    const selectedText = getEditorSelectedText(view);
    handleContextMenuClose();

    if (!selectedText) {
      return;
    }

    try {
      await window.clipboardAPI?.writeText(selectedText);
    } catch (_error) {
      setNotification({
        message: t("filePreview.contextMenu.copyFailed"),
        severity: "error",
      });
    }
  }, [getContextMenuEditorView, handleContextMenuClose, t]);

  const handleCutSelection = useCallback(async () => {
    const view = textEditorRef.current;
    const selectedText = getEditorSelectedText(view);
    handleContextMenuClose();

    if (!view || !isEditing || pendingRestoreSnapshot || !selectedText) {
      return;
    }

    try {
      await window.clipboardAPI?.writeText(selectedText);
      const ranges = view.state.selection.ranges.filter(
        (range) => !range.empty,
      );
      const cursorPosition = ranges[0]?.from ?? 0;
      view.dispatch({
        changes: ranges.map((range) => ({
          from: range.from,
          to: range.to,
          insert: "",
        })),
        selection: EditorSelection.cursor(cursorPosition),
      });
      setContent(view.state.doc.toString());
      setModified(true);
      view.focus();
    } catch (_error) {
      setNotification({
        message: t("filePreview.contextMenu.cutFailed"),
        severity: "error",
      });
    }
  }, [handleContextMenuClose, isEditing, pendingRestoreSnapshot, t]);

  const handlePasteText = useCallback(async () => {
    const view = textEditorRef.current;
    handleContextMenuClose();

    if (!view || !isEditing || pendingRestoreSnapshot) {
      return;
    }

    try {
      const clipboardText = await window.clipboardAPI?.readText();
      if (typeof clipboardText !== "string" || !clipboardText) {
        view.focus();
        return;
      }

      const ranges = view.state.selection.ranges;
      const cursorPosition = (ranges[0]?.from ?? 0) + clipboardText.length;
      view.dispatch({
        changes: ranges.map((range) => ({
          from: range.from,
          to: range.to,
          insert: clipboardText,
        })),
        selection: EditorSelection.cursor(cursorPosition),
      });
      setContent(view.state.doc.toString());
      setModified(true);
      view.focus();
    } catch (_error) {
      setNotification({
        message: t("filePreview.contextMenu.pasteFailed"),
        severity: "error",
      });
    }
  }, [handleContextMenuClose, isEditing, pendingRestoreSnapshot, t]);

  const handleSelectAllContent = useCallback(() => {
    const view = getContextMenuEditorView();
    handleContextMenuClose();

    if (!view?.state) {
      return;
    }

    view.focus();
    view.dispatch({
      selection: EditorSelection.single(0, view.state.doc.length),
    });
  }, [getContextMenuEditorView, handleContextMenuClose]);

  // diff 双面板同步滚动：两侧行数一一对应，但开启自动换行后同一行
  // 在两侧的显示高度可能不同，因此按“行块 + 块内偏移比例”映射，
  // 而不是直接复制 scrollTop。
  const syncDiffPaneScroll = useCallback((sourceView, targetView) => {
    if (!sourceView?.scrollDOM || !targetView?.scrollDOM) {
      return;
    }

    const sourceScroller = sourceView.scrollDOM;
    const targetScroller = targetView.scrollDOM;

    const echo = diffScrollEchoRef.current;
    if (
      echo &&
      echo.scroller === sourceScroller &&
      Math.abs(sourceScroller.scrollTop - echo.top) < 2
    ) {
      // 同步对侧面板时触发的回声事件，直接吞掉，避免两个面板互相拉扯
      diffScrollEchoRef.current = null;
      return;
    }

    const maxSourceTop = Math.max(
      0,
      sourceScroller.scrollHeight - sourceScroller.clientHeight,
    );
    const maxTargetTop = Math.max(
      0,
      targetScroller.scrollHeight - targetScroller.clientHeight,
    );

    let targetTop;
    if (sourceScroller.scrollTop >= maxSourceTop - 1) {
      // 源面板已滚动到底时目标面板也滚到底，保证底部对齐
      targetTop = maxTargetTop;
    } else {
      const sourcePaddingTop = sourceView.documentPadding?.top ?? 0;
      const targetPaddingTop = targetView.documentPadding?.top ?? 0;
      const sourceY = Math.max(0, sourceScroller.scrollTop - sourcePaddingTop);
      const sourceBlock = sourceView.lineBlockAtHeight(sourceY);
      const sourceLine = sourceView.state.doc.lineAt(sourceBlock.from);
      const blockFraction =
        sourceBlock.height > 0
          ? Math.max(
              0,
              Math.min(1, (sourceY - sourceBlock.top) / sourceBlock.height),
            )
          : 0;

      const targetDoc = targetView.state.doc;
      const targetLine = targetDoc.line(
        Math.min(sourceLine.number, targetDoc.lines),
      );
      const targetBlock = targetView.lineBlockAt(targetLine.from);
      targetTop = Math.max(
        0,
        Math.min(
          targetBlock.top +
            blockFraction * targetBlock.height +
            targetPaddingTop,
          maxTargetTop,
        ),
      );
    }

    if (Math.abs(targetScroller.scrollTop - targetTop) < 1) {
      return;
    }

    diffScrollEchoRef.current = { scroller: targetScroller, top: targetTop };
    targetScroller.scrollTop = targetTop;
  }, []);

  const attachDiffPaneScrollSync = useCallback(
    (view, selfRef, otherRef) => {
      selfRef.current = view;

      if (!view?.scrollDOM) {
        return;
      }

      const handleScroll = () => {
        if (selfRef.current === view && otherRef.current) {
          syncDiffPaneScroll(view, otherRef.current);
        }
      };

      view.scrollDOM.addEventListener("scroll", handleScroll, {
        passive: true,
      });
    },
    [syncDiffPaneScroll],
  );

  const handleDiffBaseEditorCreate = useCallback(
    (view) => {
      attachDiffPaneScrollSync(view, diffBaseViewRef, diffCurrentViewRef);
    },
    [attachDiffPaneScrollSync],
  );

  const handleDiffCurrentEditorCreate = useCallback(
    (view) => {
      attachDiffPaneScrollSync(view, diffCurrentViewRef, diffBaseViewRef);
    },
    [attachDiffPaneScrollSync],
  );

  useEffect(() => {
    if (!open) {
      detachTextEditorScrollListener();
      textEditorRef.current = null;
      textEditorScrollSnapshotRef.current = { top: 0, left: 0 };
      shouldRestoreTextEditorScrollRef.current = false;
      textEditorScrollRestoreModeRef.current = "always";
      syncedContentRef.current = null;
      syncedContentTimestampRef.current = null;
      diffBaseViewRef.current = null;
      diffCurrentViewRef.current = null;
      diffScrollEchoRef.current = null;
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
      setContextMenu(null);
      closeInProgressRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    let cancelled = false;
    if (!open || !isTextPreview || !file?.name) {
      setCodemirrorLangExtensions([]);
      setSyntaxHighlightState({
        languageId: null,
        loading: false,
        error: null,
      });
      return;
    }
    const languageId = getCodemirrorLanguageIdFromFilename(file.name);
    if (!languageId) {
      setCodemirrorLangExtensions([]);
      setSyntaxHighlightState({
        languageId: null,
        loading: false,
        error: null,
      });
      return;
    }

    setCodemirrorLangExtensions([]);
    setSyntaxHighlightState({
      languageId,
      loading: true,
      error: null,
    });

    loadCodemirrorLanguageExtension(languageId)
      .then((ext) => {
        if (cancelled) {
          return;
        }

        setCodemirrorLangExtensions([ext]);
        setSyntaxHighlightState({
          languageId,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        setCodemirrorLangExtensions([]);
        setSyntaxHighlightState({
          languageId,
          loading: false,
          error: error?.message || t("filePreview.syntaxHighlightLoadFailed"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [open, isTextPreview, file?.name, t]);

  // 加载全局编辑器字体设置
  useEffect(() => {
    if (!open || !isTextPreview) {
      return;
    }

    let cancelled = false;
    const loadGlobalEditorFont = async () => {
      try {
        if (window.terminalAPI?.loadUISettings) {
          const response = await window.terminalAPI.loadUISettings();
          const settings = response?.success ? response.settings : response;
          if (!cancelled && settings) {
            setGlobalEditorFont(
              normalizeEditorFontSetting(
                resolveGlobalEditorFontSetting(settings),
              ),
            );
          }
        }
      } catch (error) {
        console.error("Failed to load global editor font setting:", error);
      }
    };

    loadGlobalEditorFont();

    return () => {
      cancelled = true;
    };
  }, [open, isTextPreview]);

  useEffect(() => {
    if (!open || !isTextPreview) {
      return undefined;
    }

    const handleSettingsChanged = (event) => {
      const settings = event.detail;
      if (settings?.editorFont || settings?.terminalFont) {
        captureTextEditorScrollPosition();
        queueTextEditorScrollRestore();
        setGlobalEditorFont(
          normalizeEditorFontSetting(resolveGlobalEditorFontSetting(settings)),
        );
      }
    };

    window.addEventListener("settingsChanged", handleSettingsChanged);
    return () => {
      window.removeEventListener("settingsChanged", handleSettingsChanged);
    };
  }, [
    captureTextEditorScrollPosition,
    isTextPreview,
    open,
    queueTextEditorScrollRestore,
  ]);

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
        throw new Error(
          response?.error || t("filePreview.errors.loadSnapshotsFailed"),
        );
      }
    } catch (error) {
      setNotification({
        message: t("filePreview.errors.loadSnapshotPointsFailed", {
          error: error.message || t("fileManager.errors.unknownError"),
        }),
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
        label = t("filePreview.savedVersionLabel"),
        type = "save",
        silent = false,
        successMessage = t("filePreview.snapshotCreated"),
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
          throw new Error(
            response?.error || t("filePreview.errors.createSnapshotFailed"),
          );
        }

        await refreshSnapshots();

        if (!silent) {
          setNotification({
            message: response.deduplicated
              ? t("filePreview.snapshotDeduplicated")
              : successMessage,
            severity: "success",
          });
        }

        return response.snapshot || null;
      } catch (error) {
        if (!silent) {
          setNotification({
            message: t("filePreview.errors.createSnapshotPointFailed", {
              error: error.message || t("fileManager.errors.unknownError"),
            }),
            severity: "error",
          });
        }
        return null;
      } finally {
        setCreatingSnapshot(false);
      }
    },
    [isTextPreview, tabId, fullPath, refreshSnapshots, t],
  );

  useEffect(() => {
    if (!open || !file) return;

    const loadFileContent = async () => {
      setLoading(true);
      setError(null);
      setPendingRestoreSnapshot(null);
      setSnapshots([]);
      syncedContentRef.current = null;
      syncedContentTimestampRef.current = null;
      textEditorScrollSnapshotRef.current = { top: 0, left: 0 };
      queueTextEditorScrollRestore();

      try {
        // 检查文件大小限制 (10MB = 10 * 1024 * 1024 bytes)
        const maxFileSize = 10 * 1024 * 1024;
        if (file.size && file.size > maxFileSize) {
          setError(
            t("filePreview.errors.fileTooLarge", {
              size: formatFileSize(file.size),
            }),
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
                  setError(t("filePreview.errors.binaryTextUnsafe"));
                } else {
                  setContent(content);
                  syncedContentRef.current = content;
                  syncedContentTimestampRef.current = new Date().toISOString();
                  // 重置修改状态
                  setModified(false);
                }
              } else {
                setContent(response.content);
                syncedContentRef.current = response.content;
                syncedContentTimestampRef.current = new Date().toISOString();
                setModified(false);
              }
            } else {
              // 如果读取失败，提供更友好的错误信息
              const errorMsg =
                response.error || t("filePreview.errors.readContentFailed");
              if (errorMsg.includes("binary") || errorMsg.includes("二进制")) {
                setError(t("filePreview.errors.binaryTextBlocked"));
              } else {
                setError(
                  t("filePreview.errors.readContentFailedWithHint", {
                    error: errorMsg,
                  }),
                );
              }
            }
          } else {
            setError(t("filePreview.errors.fileReadApiUnavailable"));
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
              setError(
                response.error || t("filePreview.errors.readContentFailed"),
              );
            }
          } else {
            setError(t("filePreview.errors.fileReadApiUnavailable"));
          }
        } else if (isPdfFile(file.name)) {
          // 读取PDF文件
          // 首先加载 react-pdf 库
          try {
            await loadReactPdf();
            setPdfLibLoaded(true);
          } catch (err) {
            setError(
              t("filePreview.errors.loadPdfPreviewFailed", {
                error: err.message,
              }),
            );
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
              setError(
                response.error || t("filePreview.errors.readContentFailed"),
              );
            }
          } else {
            setError(t("filePreview.errors.fileReadApiUnavailable"));
          }
        } else {
          setError(t("filePreview.errors.binaryPreviewBlocked"));
        }
      } catch (err) {
        setError(
          t("filePreview.errors.previewFailed", {
            error: err.message || t("fileManager.errors.unknownError"),
          }),
        );
      } finally {
        setLoading(false);
      }
    };

    loadFileContent();
    // 重置编辑状态
    setIsEditing(false);
  }, [
    open,
    file,
    fullPath,
    tabId,
    createSnapshot,
    queueTextEditorScrollRestore,
    t,
  ]);

  useEffect(() => {
    if (!open || !isTextPreview || pendingRestoreSnapshot) {
      return;
    }

    restoreTextEditorScrollPosition();
  }, [
    content,
    globalEditorFont,
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
        message: t("filePreview.errors.snapshotReadApiUnavailable"),
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
          throw new Error(
            response?.error || t("filePreview.errors.readSnapshotFailed"),
          );
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
            message: t("filePreview.errors.loadDiffFailed", {
              error: error.message || t("fileManager.errors.unknownError"),
            }),
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
  }, [pendingRestoreSnapshot, tabId, fullPath, t]);

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

    let transferId = null;
    try {
      if (!window.terminalAPI?.downloadFile) {
        throw new Error(t("fileManager.errors.fileApiNotAvailable"));
      }

      setNotification({
        message: t("fileManager.messages.startDownloadNamed", {
          name: file.name,
        }),
        severity: "info",
      });

      transferId = addTransferProgress({
        type: "download",
        progress: 0,
        fileName: file.name,
        statusText: t("fileManager.transfer.status.waitingForSaveLocation"),
        currentFile: file.name,
        transferredBytes: 0,
        totalBytes: file.size || 0,
        transferSpeed: 0,
        remainingTime: 0,
        processedFiles: 0,
        totalFiles: 1,
      });

      const result = await window.terminalAPI.downloadFile(
        tabId,
        fullPath,
        (
          progress,
          fileName,
          transferredBytes,
          totalBytes,
          transferSpeed,
          remainingTime,
          processedFiles,
          totalFiles,
          transferKey,
        ) => {
          if (!transferId) {
            return;
          }

          updateTransferProgress(transferId, {
            ...normalizeTransferProgress({
              progress,
              transferredBytes,
              totalBytes,
              transferSpeed,
              remainingTime,
              processedFiles,
              transferKey,
            }),
            fileName: fileName || file.name,
            statusText: t("fileManager.transfer.status.downloading"),
            currentFile: fileName || file.name,
            totalFiles: Math.max(1, totalFiles || 1),
          });
        },
      );

      if (result?.cancelled) {
        markTransferCancelled(transferId, {
          statusText: t("fileManager.transfer.status.downloadCancelled"),
          cancelMessage: t("fileManager.errors.downloadCancelledByUser"),
        });
        setNotification({
          message: t("fileManager.errors.downloadCancelledByUser"),
          severity: "info",
        });
        return;
      }

      if (result?.success) {
        markTransferCompleted(transferId, {
          fileName: file.name,
          statusText: t("fileManager.transfer.status.completed"),
          currentFile: "",
          processedFiles: 1,
          totalFiles: 1,
          downloadPath: result.downloadPath || "",
        });
        setNotification({
          message: t("fileManager.messages.downloadCompleted", {
            name: file.name,
          }),
          severity: "success",
        });
        return;
      }

      const errorMessage =
        result?.error || t("fileManager.errors.downloadFailed");
      markTransferFailed(transferId, errorMessage, {
        statusText: t("fileManager.transfer.status.downloadFailed"),
      });
      setNotification({
        message: `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
        severity: "error",
      });
    } catch (error) {
      const errorMessage =
        error?.message || t("fileManager.errors.downloadFailed");
      markTransferFailed(transferId, errorMessage, {
        statusText: t("fileManager.transfer.status.downloadFailed"),
      });
      setNotification({
        message: `${t("fileManager.errors.downloadFailed")}: ${errorMessage}`,
        severity: "error",
      });
    }
  };

  // 处理文本编辑
  const handleEditorChange = useCallback(
    (value, viewUpdate) => {
      captureTextEditorScrollPosition(viewUpdate?.view);
      queueTextEditorScrollRestore("if-top-jump");
      setContent(value);
      setModified(true);
    },
    [captureTextEditorScrollPosition, queueTextEditorScrollRestore],
  );

  const handleOpenTextSearch = useCallback(() => {
    if (
      !isTextPreview ||
      loading ||
      savingFile ||
      pendingRestoreSnapshot ||
      syntaxHighlightState.loading ||
      syntaxHighlightState.error
    ) {
      return;
    }

    const view = textEditorRef.current;
    if (!view) {
      return;
    }

    view.focus();
    openSearchPanel(view);
  }, [
    isTextPreview,
    loading,
    pendingRestoreSnapshot,
    savingFile,
    syntaxHighlightState.error,
    syntaxHighlightState.loading,
  ]);

  const handleSearchFromContextMenu = useCallback(() => {
    handleContextMenuClose();
    handleOpenTextSearch();
  }, [handleContextMenuClose, handleOpenTextSearch]);

  const handleDownloadFromContextMenu = useCallback(() => {
    handleContextMenuClose();
    handleDownload();
  }, [handleContextMenuClose, handleDownload]);

  const handleSelectSnapshot = useCallback(
    (snapshot) => {
      if (!snapshot?.id || restoringSnapshotId) {
        return;
      }

      if (pendingRestoreSnapshot?.id === snapshot.id) {
        queueTextEditorScrollRestore();
        setPendingRestoreSnapshot(null);
        setSelectedSnapshotContent(null);
        return;
      }

      captureTextEditorScrollPosition();
      queueTextEditorScrollRestore();
      setPendingRestoreSnapshot(snapshot);
    },
    [
      captureTextEditorScrollPosition,
      pendingRestoreSnapshot,
      queueTextEditorScrollRestore,
      restoringSnapshotId,
    ],
  );

  const handleClearSnapshotSelection = useCallback(() => {
    queueTextEditorScrollRestore();
    setPendingRestoreSnapshot(null);
    setSelectedSnapshotContent(null);
  }, [queueTextEditorScrollRestore]);

  // 处理保存文件
  const handleSaveFile = useCallback(async () => {
    if (!file || !isTextFile(file.name) || !modified) return;

    try {
      setSavingFile(true);
      const saveClickedAt = new Date().toISOString();
      const baselineContent = syncedContentRef.current;
      const baselineCreatedAt =
        syncedContentTimestampRef.current || saveClickedAt;
      // 历史记录只保留被本次保存替换掉的旧版本；当前文件内容不进入历史，
      // 避免出现与当前内容完全相同、diff 无差异的"已保存版本"记录。
      const shouldSnapshotBaseline =
        typeof baselineContent === "string" && baselineContent !== content;
      const isFirstSnapshot = visibleSnapshots.length === 0;

      if (window.terminalAPI && window.terminalAPI.saveFileContent) {
        const response = await window.terminalAPI.saveFileContent(
          tabId,
          fullPath,
          content,
        );

        if (response.success) {
          if (shouldSnapshotBaseline) {
            await createSnapshot(baselineContent, {
              label: isFirstSnapshot
                ? t("filePreview.initialVersionLabel")
                : t("filePreview.savedVersionLabel"),
              type: isFirstSnapshot ? "initial" : "save",
              silent: true,
              createdAt: baselineCreatedAt,
            });
          }
          syncedContentRef.current = content;
          syncedContentTimestampRef.current = saveClickedAt;
          setNotification({
            message:
              shouldSnapshotBaseline && isFirstSnapshot
                ? t("filePreview.saveSuccessWithInitial")
                : t("filePreview.saveSuccess"),
            severity: "success",
          });
          setModified(false);
          return true;
        } else {
          setNotification({
            message: t("filePreview.errors.saveFailed", {
              error: response.error || t("fileManager.errors.unknownError"),
            }),
            severity: "error",
          });
          return false;
        }
      } else {
        setNotification({
          message: t("filePreview.errors.saveApiUnavailable"),
          severity: "error",
        });
        return false;
      }
    } catch (error) {
      setNotification({
        message: t("filePreview.errors.saveFailed", {
          error: error.message || t("fileManager.errors.unknownError"),
        }),
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
    t,
  ]);

  useEffect(() => {
    if (!open || showCloseConfirm) return undefined;

    // 预览对话框是模态窗口，打开期间焦点被限制在对话框内，
    // 但初始焦点常落在 MUI Dialog 容器上（位于 Paper 之外），
    // 因此这里不再要求事件目标位于对话框内部，直接接管通用快捷键。
    const handleKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      if (event.defaultPrevented) return;

      const key = (event.key || "").toLowerCase();

      if (key === "f") {
        if (!isTextFile(file?.name) || pendingRestoreSnapshot) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        handleOpenTextSearch();
        return;
      }

      if (key === "s") {
        if (!isTextFile(file?.name)) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (!modified || savingFile || pendingRestoreSnapshot) {
          return;
        }

        handleSaveFile();
        return;
      }

      if (key === "a") {
        if (!isTextFile(file?.name) || pendingRestoreSnapshot) {
          return;
        }

        // 焦点位于输入框或编辑器内时，交由原生/编辑器自身处理全选
        const target = event.target;
        const tagName = String(target?.tagName || "").toLowerCase();
        if (
          target?.isContentEditable ||
          tagName === "input" ||
          tagName === "textarea" ||
          tagName === "select"
        ) {
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
  }, [
    open,
    showCloseConfirm,
    file,
    modified,
    savingFile,
    pendingRestoreSnapshot,
    handleOpenTextSearch,
    handleSaveFile,
  ]);

  const setTextEditorMode = useCallback(
    (nextIsEditing) => {
      if (isEditing === nextIsEditing) {
        return;
      }

      captureTextEditorScrollPosition();
      queueTextEditorScrollRestore();
      setIsEditing(nextIsEditing);
    },
    [captureTextEditorScrollPosition, isEditing, queueTextEditorScrollRestore],
  );

  const switchToPreviewMode = useCallback(() => {
    setTextEditorMode(false);
  }, [setTextEditorMode]);

  const switchToEditMode = useCallback(() => {
    setTextEditorMode(true);
  }, [setTextEditorMode]);

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
        throw new Error(
          response?.error || t("filePreview.errors.restoreFailed"),
        );
      }

      setContent(response.content);
      syncedContentRef.current = response.content;
      syncedContentTimestampRef.current = new Date().toISOString();
      setModified(false);
      setIsEditing(true);
      setSnapshots(Array.isArray(response.snapshots) ? response.snapshots : []);
      setSelectedSnapshotContent(null);
      queueTextEditorScrollRestore();
      setNotification({
        message: t("filePreview.restoredToVersion", {
          date: formatSnapshotDate(pendingRestoreSnapshot.createdAt),
        }),
        severity: "success",
      });
      setPendingRestoreSnapshot(null);
    } catch (error) {
      setNotification({
        message: t("filePreview.errors.restoreFailedWithMessage", {
          error: error.message || t("fileManager.errors.unknownError"),
        }),
        severity: "error",
      });
    } finally {
      setRestoringSnapshotId(null);
    }
  }, [
    pendingRestoreSnapshot,
    tabId,
    fullPath,
    content,
    queueTextEditorScrollRestore,
    t,
  ]);

  const textEditorExtensions = useMemo(() => {
    if (!isTextPreview) {
      return [];
    }

    const nextExtensions = [...codemirrorLangExtensions];

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
    const fontFamily = getFontFamily(globalEditorFont);
    const editorSurfaceColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.background.paper, 0.82)
        : theme.palette.background.paper;
    const panelBackgroundColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.background.default, 0.92)
        : alpha(theme.palette.background.paper, 0.98);
    const inputBackgroundColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.06)
        : alpha(theme.palette.common.black, 0.035);
    const controlBorderColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.common.white, 0.16)
        : alpha(theme.palette.common.black, 0.16);
    const controlHoverBackgroundColor =
      theme.palette.mode === "dark"
        ? alpha(theme.palette.primary.light, 0.16)
        : alpha(theme.palette.primary.main, 0.08);
    const activeLineBackgroundColor = isEditing
      ? theme.palette.mode === "dark"
        ? alpha(theme.palette.primary.light, 0.08)
        : alpha(theme.palette.primary.main, 0.055)
      : "transparent";

    nextExtensions.push(
      search(),
      EditorState.phrases.of({
        Find: t("filePreview.searchPanel.find"),
        Replace: t("filePreview.searchPanel.replace"),
        next: t("filePreview.searchPanel.next"),
        previous: t("filePreview.searchPanel.previous"),
        all: t("filePreview.searchPanel.all"),
        "match case": t("filePreview.searchPanel.matchCase"),
        regexp: t("filePreview.searchPanel.regexp"),
        "by word": t("filePreview.searchPanel.byWord"),
        replace: t("filePreview.searchPanel.replaceAction"),
        "replace all": t("filePreview.searchPanel.replaceAll"),
        close: t("filePreview.searchPanel.close"),
        "current match": t("filePreview.searchPanel.currentMatch"),
        "on line": t("filePreview.searchPanel.onLine"),
        "replaced match on line $": t(
          "filePreview.searchPanel.replacedMatchOnLine",
        ),
        "replaced $ matches": t("filePreview.searchPanel.replacedMatches"),
        "Go to line": t("filePreview.searchPanel.goToLine"),
        go: t("filePreview.searchPanel.go"),
      }),
      EditorView.theme({
        "&": {
          fontFamily: `${fontFamily} !important`,
          width: "100%",
          height: "100%",
          backgroundColor: editorSurfaceColor,
        },
        "&.cm-focused": {
          outline: "none",
        },
        ".cm-scroller": {
          overflowX: "hidden",
          overflowY: "auto",
          backgroundColor: editorSurfaceColor,
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
          fontFamily: `${fontFamily} !important`,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          overflowWrap: "anywhere",
          minHeight: 0,
          padding: "12px 0 16px",
          caretColor: isEditing ? theme.palette.primary.main : "transparent",
        },
        ".cm-line": {
          padding: "0 16px",
        },
        ".cm-gutters": {
          backgroundColor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.background.default, 0.72)
              : alpha(theme.palette.background.default, 0.7),
          color: theme.palette.text.secondary,
          borderRight: `1px solid ${theme.palette.divider}`,
        },
        ".cm-activeLine, .cm-activeLineGutter": {
          backgroundColor: activeLineBackgroundColor,
        },
        ...(isEditing
          ? {}
          : {
              ".cm-cursor, .cm-dropCursor": {
                display: "none",
              },
            }),
        ".cm-panels": {
          backgroundColor: panelBackgroundColor,
          color: theme.palette.text.primary,
          borderColor: theme.palette.divider,
          fontFamily: theme.typography.fontFamily,
        },
        ".cm-panels-bottom": {
          borderTop: `1px solid ${theme.palette.divider}`,
        },
        ".cm-panel.cm-search": {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "8px",
          padding: "10px 12px",
          position: "relative",
          backgroundColor: panelBackgroundColor,
          color: theme.palette.text.primary,
          fontSize: "0.875rem",
          lineHeight: 1.35,
        },
        ".cm-panel.cm-search input, .cm-panel.cm-search button, .cm-panel.cm-search label":
          {
            margin: 0,
            font: "inherit",
          },
        ".cm-panel.cm-search .cm-textfield": {
          minWidth: "min(280px, 100%)",
          height: "32px",
          padding: "4px 9px",
          border: `1px solid ${controlBorderColor}`,
          borderRadius: "6px",
          backgroundColor: inputBackgroundColor,
          color: theme.palette.text.primary,
          outline: "none",
        },
        ".cm-panel.cm-search .cm-textfield:focus": {
          borderColor: theme.palette.primary.main,
          boxShadow: `0 0 0 2px ${alpha(theme.palette.primary.main, 0.18)}`,
        },
        ".cm-panel.cm-search button": {
          height: "30px",
          minWidth: "34px",
          padding: "0 10px",
          border: `1px solid ${controlBorderColor}`,
          borderRadius: "6px",
          backgroundColor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.common.white, 0.05)
              : theme.palette.background.paper,
          color: theme.palette.text.primary,
          cursor: "pointer",
        },
        ".cm-panel.cm-search button:hover": {
          backgroundColor: controlHoverBackgroundColor,
          borderColor: alpha(theme.palette.primary.main, 0.42),
        },
        ".cm-panel.cm-search label": {
          display: "inline-flex",
          alignItems: "center",
          gap: "4px",
          color: theme.palette.text.secondary,
          fontSize: "0.8125rem",
          whiteSpace: "nowrap",
        },
        ".cm-panel.cm-search input[type=checkbox]": {
          width: "14px",
          height: "14px",
          margin: 0,
        },
        ".cm-panel.cm-search br": {
          display: "none",
        },
        ".cm-panel.cm-search [name=close]": {
          position: "static",
          marginLeft: "auto",
          width: "30px",
          minWidth: "30px",
          padding: 0,
          borderColor: "transparent",
          backgroundColor: "transparent",
          fontSize: "1rem",
        },
        ".cm-searchMatch": {
          backgroundColor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.warning.light, 0.34)
              : alpha(theme.palette.warning.main, 0.28),
        },
        ".cm-searchMatch-selected": {
          backgroundColor:
            theme.palette.mode === "dark"
              ? alpha(theme.palette.primary.light, 0.48)
              : alpha(theme.palette.primary.main, 0.3),
        },
      }),
    );

    nextExtensions.push(EditorView.lineWrapping);

    return nextExtensions;
  }, [
    codemirrorLangExtensions,
    globalEditorFont,
    isEditing,
    isTextPreview,
    t,
    theme,
  ]);

  // PDF相关事件处理
  const onDocumentLoadSuccess = ({ numPages }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  const onDocumentLoadError = (error) => {
    setError(
      t("filePreview.errors.pdfLoadFailed", {
        error: error.message,
      }),
    );
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
      window.terminalAPI.releaseRuntimeFilePath
    ) {
      try {
        await window.terminalAPI.releaseRuntimeFilePath(
          "file-cache",
          cacheFilePath,
          { reason: "file-preview-close" },
        );
        setCacheFilePath(null);
      } catch (error) {
        console.error("Failed to cleanup cache file:", error);
      }
    }
  };

  // 处理对话框关闭
  const handleClose = async () => {
    if (closeInProgressRef.current) {
      return;
    }

    if (savingFile) {
      return;
    }

    if (isTextPreview && modified) {
      setShowCloseConfirm(true);
      return;
    }

    closeInProgressRef.current = true;
    try {
      await cleanupCache(); // 清理缓存
      onClose();
    } finally {
      closeInProgressRef.current = false;
    }
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

  useEffect(() => {
    if (!open || showCloseConfirm) {
      return undefined;
    }

    const selector = '[data-file-preview-dialog="true"]';
    const handlePreviewEscape = (event) => {
      if (
        event.key !== "Escape" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      const target = event.target;
      const activeElement = document.activeElement;
      const isInsideDialog =
        (target &&
          typeof target.closest === "function" &&
          target.closest(selector)) ||
        (activeElement &&
          typeof activeElement.closest === "function" &&
          activeElement.closest(selector));

      if (!isInsideDialog) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      handleClose();
    };

    document.addEventListener("keydown", handlePreviewEscape, true);
    return () => {
      document.removeEventListener("keydown", handlePreviewEscape, true);
    };
  }, [handleClose, open, showCloseConfirm]);

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
            <Typography variant="subtitle2">
              {t("filePreview.savedVersions")}
            </Typography>
            <Button
              size="small"
              onClick={refreshSnapshots}
              disabled={loadingSnapshots || creatingSnapshot}
            >
              {t("common.refresh")}
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
          ) : (
            <List dense disablePadding>
              {visibleSnapshots.map((snapshot, index) => {
                const isSelected = pendingRestoreSnapshot?.id === snapshot.id;

                return (
                  <React.Fragment key={snapshot.id}>
                    <ListItemButton
                      alignItems="flex-start"
                      onClick={() => handleSelectSnapshot(snapshot)}
                      selected={isSelected}
                      disabled={Boolean(restoringSnapshotId)}
                      sx={{
                        px: 1.5,
                        py: 1.25,
                        alignItems: "flex-start",
                      }}
                    >
                      <ListItemText
                        primary={
                          snapshot.label ||
                          t("filePreview.snapshotFallbackLabel")
                        }
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
                    {isSelected ? (
                      <Box
                        sx={{
                          px: 1.5,
                          pt: 0.25,
                          pb: 1.25,
                          display: "flex",
                          flexDirection: "column",
                          gap: 0.75,
                        }}
                      >
                        <Button
                          size="small"
                          color="warning"
                          variant="contained"
                          startIcon={<RestoreIcon />}
                          onClick={handleRestoreSnapshot}
                          disabled={
                            Boolean(restoringSnapshotId) ||
                            savingFile ||
                            loadingSelectedSnapshot ||
                            Boolean(
                              snapshotDiffData && !snapshotDiffData.hasChanges,
                            )
                          }
                        >
                          {restoringSnapshotId
                            ? t("filePreview.restoring")
                            : loadingSelectedSnapshot
                              ? t("filePreview.loadingDiff")
                              : t("filePreview.restoreVersion")}
                        </Button>
                        <Button
                          size="small"
                          onClick={handleClearSnapshotSelection}
                          disabled={
                            Boolean(restoringSnapshotId) ||
                            loadingSelectedSnapshot
                          }
                        >
                          {t("filePreview.clearSelection")}
                        </Button>
                      </Box>
                    ) : null}
                    {index < visibleSnapshots.length - 1 ? <Divider /> : null}
                  </React.Fragment>
                );
              })}
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
    const fontFamily = getFontFamily(globalEditorFont);
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
        minHeight: 0,
        padding: "8px 0 12px",
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
      const extensions = [...codemirrorLangExtensions];

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
        onContextMenu={handleDiffContextMenu}
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
              <Typography variant="subtitle2">
                {t("filePreview.versionDiff")}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t("filePreview.diffDescription", {
                  date: formatSnapshotDate(pendingRestoreSnapshot.createdAt),
                })}
              </Typography>
            </Box>
            <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                variant="outlined"
                label={t("filePreview.changedCount", {
                  count: diffSummary.changed,
                })}
              />
              <Chip
                size="small"
                variant="outlined"
                label={t("filePreview.addedCount", {
                  count: diffSummary.added,
                })}
              />
              <Chip
                size="small"
                variant="outlined"
                label={t("filePreview.removedCount", {
                  count: diffSummary.removed,
                })}
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
              {t("filePreview.diffUnavailable")}
            </Typography>
          </Box>
        ) : !snapshotDiffData.hasChanges ? (
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
              {t("filePreview.noDifferences")}
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
                  {t("filePreview.savedVersionPane")}
                </Typography>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <CodeMirror
                  key={`diff-base-${pendingRestoreSnapshot?.id}-${globalEditorFont}-${theme.palette.mode}-${syntaxHighlightState.languageId || "plain"}`}
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
                  onCreateEditor={handleDiffBaseEditorCreate}
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
                  {t("filePreview.currentContentPane")}
                </Typography>
              </Box>
              <Box
                sx={{
                  flex: 1,
                  minHeight: 0,
                }}
              >
                <CodeMirror
                  key={`diff-current-${pendingRestoreSnapshot?.id}-${globalEditorFont}-${theme.palette.mode}-${syntaxHighlightState.languageId || "plain"}`}
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
                  onCreateEditor={handleDiffCurrentEditorCreate}
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
      // 没有任何历史记录时自动折叠历史侧边栏，编辑区占满整行
      const showHistoryPanel = visibleSnapshots.length > 0;

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
              lg: showHistoryPanel ? "minmax(0, 1fr) 280px" : "1fr",
            },
            gridTemplateRows: {
              xs: showHistoryPanel ? "minmax(0, 1fr) 240px" : "1fr",
              lg: "1fr",
            },
          }}
        >
          <Box sx={boxSx}>
            {syntaxHighlightState.error ? (
              <Box sx={{ p: 2, color: "error.main" }}>
                <Typography variant="body1">
                  {syntaxHighlightState.error}
                </Typography>
              </Box>
            ) : syntaxHighlightState.loading ? (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flex: 1,
                  gap: 1.5,
                }}
              >
                <CircularProgress size={24} />
                <Typography variant="body2" color="text.secondary">
                  {t("filePreview.loadingSyntaxHighlight", {
                    language: syntaxHighlightState.languageId,
                  })}
                </Typography>
              </Box>
            ) : pendingRestoreSnapshot ? (
              renderSnapshotDiffView()
            ) : (
              <Box
                onContextMenu={handleTextContextMenu}
                sx={{
                  height: "100%",
                  flex: "1 1 auto",
                  minHeight: 0,
                  overflow: "hidden",
                }}
              >
                <CodeMirror
                  value={content || ""}
                  height="100%"
                  extensions={textEditorExtensions}
                  theme={theme.palette.mode}
                  editable
                  readOnly={!isEditing}
                  onChange={handleEditorChange}
                  style={cmStyle}
                  className={
                    isEditing ? "file-preview-editor" : "file-preview-viewer"
                  }
                  onCreateEditor={handleTextEditorCreate}
                />
              </Box>
            )}
          </Box>
          {showHistoryPanel ? renderSnapshotPanel() : null}
        </Box>
      );
    }

    if (isImageFile(file?.name)) {
      return (
        <Box
          onContextMenu={handleMediaContextMenu}
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
          onContextMenu={handleMediaContextMenu}
          sx={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
          }}
        >
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
      <Box onContextMenu={handleMediaContextMenu} sx={{ p: 2 }}>
        <Typography variant="body1">
          {t("filePreview.unsupportedPreview")}
        </Typography>
      </Box>
    );
  };

  if (!file) return null;

  const isTextContextMenu = contextMenu?.kind === "text";
  const isEditorContextMenu =
    isTextContextMenu ||
    contextMenu?.kind === "diff-base" ||
    contextMenu?.kind === "diff-current";
  const canEditFromContextMenu =
    isTextContextMenu &&
    isEditing &&
    !pendingRestoreSnapshot &&
    !loading &&
    !savingFile &&
    !syntaxHighlightState.loading &&
    !syntaxHighlightState.error;
  const canSearchFromContextMenu =
    isTextContextMenu &&
    !pendingRestoreSnapshot &&
    !loading &&
    !savingFile &&
    !syntaxHighlightState.loading &&
    !syntaxHighlightState.error;

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
            {isTextPreview && syntaxHighlightState.languageId ? (
              <Chip
                size="small"
                color={syntaxHighlightState.error ? "error" : "info"}
                label={
                  syntaxHighlightState.error
                    ? t("filePreview.syntaxHighlightFailed")
                    : syntaxHighlightState.loading
                      ? t("filePreview.syntaxHighlightLoading")
                      : t("filePreview.syntaxHighlightReady", {
                          language: syntaxHighlightState.languageId,
                        })
                }
                variant={syntaxHighlightState.loading ? "outlined" : "filled"}
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
                    ? t("filePreview.status.diff")
                    : modified
                      ? t("filePreview.status.modified")
                      : isEditing
                        ? t("filePreview.status.editing")
                        : t("filePreview.status.readOnly")
                }
                variant={
                  pendingRestoreSnapshot || modified || isEditing
                    ? "filled"
                    : "outlined"
                }
              />
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
              {t("filePreview.savingFile")}
            </Typography>
          </Box>
        ) : (
          renderContent()
        )}
      </DialogContent>
      <DialogActions
        sx={{
          px: 2.5,
          py: 1.5,
          gap: 1,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <Button
          size="small"
          variant="outlined"
          startIcon={<DownloadIcon />}
          onClick={handleDownload}
          disabled={loading || savingFile}
        >
          {t("filePreview.download")}
        </Button>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          justifyContent="flex-end"
          flexWrap="wrap"
          useFlexGap
          sx={{ minWidth: 0 }}
        >
          {isTextPreview ? (
            <>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SearchIcon />}
                onClick={handleOpenTextSearch}
                disabled={
                  loading ||
                  savingFile ||
                  Boolean(pendingRestoreSnapshot) ||
                  syntaxHighlightState.loading ||
                  Boolean(syntaxHighlightState.error)
                }
              >
                {t("filePreview.searchPanel.open")}
              </Button>
              <ButtonGroup size="small" variant="outlined">
                <Button
                  variant={!isEditing ? "contained" : "outlined"}
                  startIcon={<VisibilityIcon />}
                  onClick={switchToPreviewMode}
                  disabled={
                    loading ||
                    savingFile ||
                    Boolean(pendingRestoreSnapshot) ||
                    syntaxHighlightState.loading ||
                    Boolean(syntaxHighlightState.error)
                  }
                >
                  {t("filePreview.previewMode")}
                </Button>
                <Button
                  variant={isEditing ? "contained" : "outlined"}
                  startIcon={<EditIcon />}
                  onClick={switchToEditMode}
                  disabled={
                    loading ||
                    savingFile ||
                    Boolean(pendingRestoreSnapshot) ||
                    syntaxHighlightState.loading ||
                    Boolean(syntaxHighlightState.error)
                  }
                >
                  {t("filePreview.editMode")}
                </Button>
              </ButtonGroup>
              <Button
                size="small"
                variant="contained"
                startIcon={<SaveIcon />}
                onClick={handleSaveFile}
                disabled={
                  !modified ||
                  savingFile ||
                  loading ||
                  Boolean(pendingRestoreSnapshot) ||
                  syntaxHighlightState.loading ||
                  Boolean(syntaxHighlightState.error)
                }
              >
                {savingFile ? t("filePreview.saving") : t("common.save")}
              </Button>
            </>
          ) : null}
          {isPdfFile(file?.name) ? (
            <>
              <ButtonGroup size="small" variant="outlined">
                <Tooltip title={t("filePreview.previousPage")}>
                  <span>
                    <IconButton
                      onClick={goToPrevPage}
                      disabled={pageNumber <= 1}
                      size="small"
                      aria-label={t("filePreview.previousPage")}
                    >
                      <NavigateBeforeIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("filePreview.nextPage")}>
                  <span>
                    <IconButton
                      onClick={goToNextPage}
                      disabled={pageNumber >= (numPages || 1)}
                      size="small"
                      aria-label={t("filePreview.nextPage")}
                    >
                      <NavigateNextIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </ButtonGroup>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ px: 0.5, whiteSpace: "nowrap" }}
              >
                {t("filePreview.pageStatus", {
                  page: pageNumber,
                  total: numPages || 0,
                })}
              </Typography>
              <ButtonGroup size="small" variant="outlined">
                <Tooltip title={t("filePreview.zoomIn")}>
                  <span>
                    <IconButton
                      onClick={zoomIn}
                      disabled={scale >= 3.0}
                      size="small"
                      aria-label={t("filePreview.zoomIn")}
                    >
                      <ZoomInIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t("filePreview.zoomOut")}>
                  <span>
                    <IconButton
                      onClick={zoomOut}
                      disabled={scale <= 0.5}
                      size="small"
                      aria-label={t("filePreview.zoomOut")}
                    >
                      <ZoomOutIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </ButtonGroup>
            </>
          ) : null}
          <Button size="small" onClick={handleClose} disabled={savingFile}>
            {t("common.close")}
          </Button>
        </Stack>
      </DialogActions>

      <Menu
        open={Boolean(contextMenu)}
        onClose={handleContextMenuClose}
        anchorReference="anchorPosition"
        anchorPosition={
          contextMenu
            ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
            : undefined
        }
        PaperProps={{
          "data-file-preview-context-menu": "true",
          sx: compactContextMenuPaperSx,
        }}
        transitionDuration={0}
        disableAutoFocusItem
        disableScrollLock
      >
        {isEditorContextMenu ? (
          <>
            {isTextContextMenu ? (
              <MenuItem
                onClick={handleCutSelection}
                disabled={!canEditFromContextMenu || !contextMenu?.canCopy}
              >
                <ListItemIcon>
                  <ContentCutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>{t("filePreview.contextMenu.cut")}</ListItemText>
                <Typography variant="caption" color="text.secondary">
                  Ctrl+X
                </Typography>
              </MenuItem>
            ) : null}
            <MenuItem
              onClick={handleCopySelection}
              disabled={!contextMenu?.canCopy}
            >
              <ListItemIcon>
                <ContentCopyIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>{t("filePreview.contextMenu.copy")}</ListItemText>
              <Typography variant="caption" color="text.secondary">
                Ctrl+C
              </Typography>
            </MenuItem>
            {isTextContextMenu ? (
              <MenuItem
                onClick={handlePasteText}
                disabled={!canEditFromContextMenu}
              >
                <ListItemIcon>
                  <ContentPasteIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  {t("filePreview.contextMenu.paste")}
                </ListItemText>
                <Typography variant="caption" color="text.secondary">
                  Ctrl+V
                </Typography>
              </MenuItem>
            ) : null}
            <Divider />
            <MenuItem onClick={handleSelectAllContent}>
              <ListItemIcon>
                <SelectAllIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>
                {t("filePreview.contextMenu.selectAll")}
              </ListItemText>
              <Typography variant="caption" color="text.secondary">
                Ctrl+A
              </Typography>
            </MenuItem>
            {isTextContextMenu ? (
              <MenuItem
                onClick={handleSearchFromContextMenu}
                disabled={!canSearchFromContextMenu}
              >
                <ListItemIcon>
                  <SearchIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText>
                  {t("filePreview.contextMenu.search")}
                </ListItemText>
                <Typography variant="caption" color="text.secondary">
                  Ctrl+F
                </Typography>
              </MenuItem>
            ) : null}
            <Divider />
          </>
        ) : null}
        <MenuItem
          onClick={handleDownloadFromContextMenu}
          disabled={loading || savingFile}
        >
          <ListItemIcon>
            <DownloadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("filePreview.contextMenu.download")}</ListItemText>
        </MenuItem>
      </Menu>

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
        <DialogTitle>{t("filePreview.unsavedTitle")}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            {t("filePreview.unsavedMessage")}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setShowCloseConfirm(false)}
            disabled={savingFile}
          >
            {t("common.cancel")}
          </Button>
          <Button
            onClick={handleDiscardAndClose}
            color="inherit"
            disabled={savingFile}
          >
            {t("filePreview.discardChanges")}
          </Button>
          <Button
            onClick={handleSaveAndClose}
            variant="contained"
            disabled={savingFile}
            startIcon={<SaveIcon />}
          >
            {savingFile
              ? t("filePreview.saving")
              : t("filePreview.saveAndClose")}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default memo(FilePreview);
