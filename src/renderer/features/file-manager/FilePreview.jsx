import React, { memo } from "react";
import Dialog from "../../shared/ui/AccessibleDialog.jsx";
import {
  Box,
  Button,
  CircularProgress,
  DialogActions,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { isTextFile, isPdfFile } from "./lib/filePreviewTypes.js";

const TextPreview = React.lazy(() => import("./previews/TextPreview.jsx"));
const MediaPreview = React.lazy(() => import("./previews/MediaPreview.jsx"));
const PdfPreview = React.lazy(() => import("./previews/PdfPreview.jsx"));

class PreviewLoadBoundary extends React.Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error
      ? this.props.fallback(this.state.error)
      : this.props.children;
  }
}

function PreviewFallback({ onClose, error }) {
  const { t } = useTranslation();
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <Box sx={{ p: 4, display: "flex", justifyContent: "center" }}>
        {error ? (
          <Typography color="error">
            {t("filePreview.errors.previewFailed", { error: error.message })}
          </Typography>
        ) : (
          <CircularProgress />
        )}
      </Box>
      <DialogActions>
        <Button onClick={onClose}>{t("common.close")}</Button>
      </DialogActions>
    </Dialog>
  );
}

export default memo(function FilePreview(props) {
  const { file, open, path, tabId } = props;
  if (!open || !file) return null;
  const Preview = isTextFile(file.name)
    ? TextPreview
    : isPdfFile(file.name)
      ? PdfPreview
      : MediaPreview;
  return (
    <PreviewLoadBoundary
      key={JSON.stringify([tabId, path, file.name])}
      fallback={(error) => (
        <PreviewFallback onClose={props.onClose} error={error} />
      )}
    >
      <React.Suspense fallback={<PreviewFallback onClose={props.onClose} />}>
        <Preview {...props} />
      </React.Suspense>
    </PreviewLoadBoundary>
  );
});
