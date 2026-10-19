import React, { Suspense } from "react";
import { Typography, Box, CircularProgress } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import CodeMirror from "@uiw/react-codemirror";
import { useTranslation } from "react-i18next";

import SnapshotPanel from "./SnapshotPanel.jsx";

const DiffPreview = React.lazy(() => import("./DiffPreview.jsx"));
export default function TextPreviewContent({
  visibleSnapshots,
  syntaxHighlightState,
  pendingRestoreSnapshot,
  diffBaseViewRef,
  diffCurrentViewRef,
  snapshotDiffData,
  globalEditorFont,
  codemirrorLangExtensions,
  handleDiffContextMenu,
  loadingSelectedSnapshot,
  snapshotDiffPaneData,
  handleTextContextMenu,
  content,
  textEditorExtensions,
  isEditing,
  handleEditorChange,
  handleTextEditorCreate,
  refreshSnapshots,
  loadingSnapshots,
  creatingSnapshot,
  handleSelectSnapshot,
  restoringSnapshotId,
  handleRestoreSnapshot,
  savingFile,
  handleClearSnapshotSelection,
}) {
  const theme = useTheme();
  const { t } = useTranslation();

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
          <Suspense fallback={<CircularProgress size={24} />}>
            <DiffPreview
              diffBaseViewRef={diffBaseViewRef}
              diffCurrentViewRef={diffCurrentViewRef}
              snapshotDiffData={snapshotDiffData}
              globalEditorFont={globalEditorFont}
              codemirrorLangExtensions={codemirrorLangExtensions}
              handleDiffContextMenu={handleDiffContextMenu}
              pendingRestoreSnapshot={pendingRestoreSnapshot}
              loadingSelectedSnapshot={loadingSelectedSnapshot}
              snapshotDiffPaneData={snapshotDiffPaneData}
              syntaxHighlightState={syntaxHighlightState}
            />
          </Suspense>
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
      {showHistoryPanel ? (
        <SnapshotPanel
          refreshSnapshots={refreshSnapshots}
          loadingSnapshots={loadingSnapshots}
          creatingSnapshot={creatingSnapshot}
          visibleSnapshots={visibleSnapshots}
          pendingRestoreSnapshot={pendingRestoreSnapshot}
          handleSelectSnapshot={handleSelectSnapshot}
          restoringSnapshotId={restoringSnapshotId}
          handleRestoreSnapshot={handleRestoreSnapshot}
          savingFile={savingFile}
          loadingSelectedSnapshot={loadingSelectedSnapshot}
          snapshotDiffData={snapshotDiffData}
          handleClearSnapshotSelection={handleClearSnapshotSelection}
        />
      ) : null}
    </Box>
  );
}
