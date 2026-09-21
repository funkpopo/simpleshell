import { lazy, Suspense } from "react";
import ErrorBoundary from "../../ErrorBoundary.jsx";
import LoadingFallback from "../../LoadingFallback.jsx";
import { useTranslation } from "react-i18next";
const FilePreview = lazy(() => import("../../FilePreview.jsx"));
export default function PreviewDialog({
  showPreview,
  handleClosePreview,
  filePreview,
  currentPath,
  tabId,
}) {
  const { t } = useTranslation();
  if (!(showPreview && filePreview)) return null;
  return (
    <ErrorBoundary componentName={t("filePreview.title")}>
      <Suspense
        fallback={<LoadingFallback message={t("filePreview.loading")} />}
      >
        <FilePreview
          open={showPreview}
          onClose={handleClosePreview}
          file={filePreview}
          path={currentPath}
          tabId={tabId}
        />
      </Suspense>
    </ErrorBoundary>
  );
}
