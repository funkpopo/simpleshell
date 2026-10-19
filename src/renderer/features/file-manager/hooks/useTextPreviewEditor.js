import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useTheme, alpha } from "@mui/material/styles";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { openSearchPanel, search } from "@codemirror/search";
import {
  getCodemirrorLanguageIdFromFilename,
  loadCodemirrorLanguageExtension,
} from "../lib/filePreviewCodemirrorLanguages.js";
import { useTranslation } from "react-i18next";
import {
  normalizeEditorFontSetting,
  getFontFamily,
  resolveGlobalEditorFontSetting,
} from "../lib/previewFonts.js";

export default function useTextPreviewEditor({
  open,
  file,
  setContent,
  setModified,
  loading,
  savingFile,
  pendingRestoreSnapshot,
  isEditing,
  setIsEditing,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const isTextPreview = true;
  const [globalEditorFont, setGlobalEditorFont] = useState("system");
  const textEditorRef = useRef(null);
  const textEditorScrollElementRef = useRef(null);
  const textEditorScrollListenerRef = useRef(null);
  const textEditorScrollSnapshotRef = useRef({ top: 0, left: 0 });
  const shouldRestoreTextEditorScrollRef = useRef(false);
  const textEditorScrollRestoreModeRef = useRef("always");
  const [codemirrorLangExtensions, setCodemirrorLangExtensions] = useState([]);
  const [syntaxHighlightState, setSyntaxHighlightState] = useState({
    languageId: null,
    loading: false,
    error: null,
  });
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
  useEffect(() => {
    return () => {
      detachTextEditorScrollListener();
    };
  }, [detachTextEditorScrollListener]);
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
  return {
    textEditorRef,
    textEditorScrollSnapshotRef,
    captureTextEditorScrollPosition,
    queueTextEditorScrollRestore,
    restoreTextEditorScrollPosition,
    handleTextEditorCreate,
    globalEditorFont,
    codemirrorLangExtensions,
    syntaxHighlightState,
    textEditorExtensions,
    handleEditorChange,
    handleOpenTextSearch,
    switchToPreviewMode,
    switchToEditMode,
  };
}
