import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { joinPath, withSftpRetry } from "../fileManagerUtils.js";

const operations = {
  rename: {
    method: "renameFile",
    error: (t) => t("fileManager.errors.renameFailed"),
    retry: (t, counts) =>
      t("fileManager.messages.updateFailedRetrying", counts),
    maxRetries: 3,
  },
  createFolder: {
    method: "createFolder",
    error: (t) => t("fileManager.errors.createFolderFailed"),
    retry: (t, counts) =>
      t("fileManager.messages.createFolderFailedRetrying", counts),
    maxRetries: 3,
  },
  createFile: {
    method: "createFile",
    error: (t) => t("fileManager.errors.createFileFailed"),
    maxRetries: 0,
  },
};

/** Each name dialog owns its draft and the operation target captured on open. */
export default function useFileNameDialog({
  mode,
  tabId,
  currentPath,
  sshConnection,
  selectedFile,
  refreshDirectory,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const targetRef = useRef(null);
  const pendingRef = useRef(false);

  useEffect(() => {
    setOpen(false);
    setSubmitting(false);
    pendingRef.current = false;
    return () => {
      targetRef.current = null;
      pendingRef.current = false;
    };
  }, [tabId]);

  const openDialog = useCallback(() => {
    if (pendingRef.current || (mode === "rename" && !selectedFile)) return;
    targetRef.current = {
      tabId,
      path: currentPath,
      file: selectedFile,
      connection: sshConnection,
      refreshDirectory,
    };
    setName(mode === "rename" ? selectedFile.name : "");
    setError("");
    setOpen(true);
  }, [mode, tabId, currentPath, selectedFile, sshConnection, refreshDirectory]);

  const close = useCallback(() => {
    if (pendingRef.current) return;
    targetRef.current = null;
    setOpen(false);
    setError("");
  }, []);

  const submit = async (event) => {
    event?.preventDefault();
    const target = targetRef.current;
    if (!target || pendingRef.current) return;
    const nextName = mode === "rename" ? name : name.trim();
    const operation = operations[mode];
    const prereqError = !nextName.trim()
      ? t("fileManager.errors.emptyName")
      : !target.connection
        ? t("fileManager.errors.noConnection")
        : !window.terminalAPI?.[operation.method]
          ? t("fileManager.errors.fileApiNotAvailable")
          : null;
    if (prereqError) {
      setError(prereqError);
      return;
    }
    if (mode === "rename" && nextName === target.file.name) {
      close();
      return;
    }

    pendingRef.current = true;
    setSubmitting(true);
    setError("");
    const isCurrent = () => targetRef.current === target;
    let completed = false;
    try {
      const result = await withSftpRetry(
        () =>
          mode === "rename"
            ? window.terminalAPI.renameFile(
                target.tabId,
                joinPath(target.path, target.file.name),
                nextName,
              )
            : window.terminalAPI[operation.method](
                target.tabId,
                joinPath(target.path, nextName),
              ),
        {
          maxRetries: operation.maxRetries,
          baseDelay: 500,
          fallbackError: operation.error(t),
          onRetry: (current, max) => {
            if (isCurrent() && operation.retry) {
              setError(operation.retry(t, { current, max }));
            }
          },
        },
      );
      if (result.success) {
        completed = true;
        if (isCurrent()) {
          setOpen(false);
        }
        // Refresh is outside the mutation retry: a failed read must never repeat a mutation.
        await target.refreshDirectory(target.path);
      } else if (isCurrent()) {
        setError(result.error);
      }
    } finally {
      if (isCurrent()) {
        pendingRef.current = false;
        setSubmitting(false);
        if (completed) targetRef.current = null;
      }
    }
  };

  return { open, name, setName, error, submitting, openDialog, close, submit };
}
