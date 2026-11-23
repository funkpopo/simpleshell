import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatFileSize } from "../../../shared/lib/formatters.js";
import { getMaxPreviewSizeBytes } from "../../../../shared/settings/uiSettingsDefaults.js";

const releasePath = async (cachePath) => {
  if (!cachePath) return;
  try {
    await window.terminalAPI?.releaseRuntimeFilePath?.(
      "file-cache",
      cachePath,
      {
        reason: "file-preview-close",
      },
    );
  } catch (error) {
    console.error("Failed to cleanup cache file:", error);
  }
};

const identity = (value) => value;

export default function useBinaryPreview({
  file,
  tabId,
  fullPath,
  transform = identity,
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState(null);
  const cachePathRef = useRef(null);
  const releaseCache = useCallback(async () => {
    const cachePath = cachePathRef.current;
    cachePathRef.current = null;
    await releasePath(cachePath);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setContent(null);
    const load = async () => {
      try {
        let maxPreviewSizeBytes = getMaxPreviewSizeBytes(10);
        if (
          Number(file?.size) > 1024 * 1024 &&
          window.terminalAPI?.loadUISettings
        ) {
          try {
            const res = await window.terminalAPI.loadUISettings();
            const settings = res?.success ? res.settings : res;
            if (settings) {
              maxPreviewSizeBytes = getMaxPreviewSizeBytes(settings);
            }
          } catch {
            /* fallback to default */
          }
        }
        if (file.size > maxPreviewSizeBytes) {
          throw new Error(
            t("filePreview.errors.fileTooLarge", {
              size: formatFileSize(file.size),
            }),
          );
        }
        if (!window.terminalAPI?.readFileAsBase64) {
          throw new Error(t("filePreview.errors.fileReadApiUnavailable"));
        }
        const response = await window.terminalAPI.readFileAsBase64(
          tabId,
          fullPath,
        );
        if (cancelled) {
          await releasePath(response?.cacheFilePath);
          return;
        }
        if (!response?.success) {
          throw new Error(
            response?.error || t("filePreview.errors.readContentFailed"),
          );
        }
        cachePathRef.current = response.cacheFilePath || null;
        setContent(transform(response.content));
      } catch (error) {
        if (!cancelled) setError(error.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      releaseCache();
    };
  }, [file, tabId, fullPath, releaseCache, t, transform]);

  return { loading, error, setError, content, releaseCache };
}
