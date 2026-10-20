import { useCallback, useEffect, useRef } from "react";
import { Typography, Box, CircularProgress, Stack, Chip } from "@mui/material";
import { useTheme, alpha } from "@mui/material/styles";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { useTranslation } from "react-i18next";
import { getFontFamily } from "../lib/previewFonts.js";
import {
  formatSnapshotDate,
  buildDiffLineDecorations,
} from "../lib/snapshotDiff.js";

export default function DiffPreview({
  diffBaseViewRef,
  diffCurrentViewRef,
  snapshotDiffData,
  globalEditorFont,
  codemirrorLangExtensions,
  handleDiffContextMenu,
  pendingRestoreSnapshot,
  loadingSelectedSnapshot,
  snapshotDiffPaneData,
  syntaxHighlightState,
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const diffScrollEchoRef = useRef(null);
  const scrollCleanupsRef = useRef(new Map());
  useEffect(() => {
    const cleanups = scrollCleanupsRef.current;
    return () => {
      cleanups.forEach((cleanup) => cleanup());
      cleanups.clear();
      diffBaseViewRef.current = null;
      diffCurrentViewRef.current = null;
    };
  }, [diffBaseViewRef, diffCurrentViewRef]);
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
      scrollCleanupsRef.current.get(selfRef)?.();
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
      scrollCleanupsRef.current.set(selfRef, () =>
        view.scrollDOM.removeEventListener("scroll", handleScroll),
      );
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

  const diffSummary = snapshotDiffData?.summary || {
    changed: 0,
    added: 0,
    removed: 0,
  };
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
                extensions={createDiffPaneExtensions(snapshotDiffPaneData.base)}
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
}
