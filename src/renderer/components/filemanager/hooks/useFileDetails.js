import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { formatAbsoluteDateTime } from "../../../utils/formatters.js";
import { joinPath } from "../fileManagerUtils.js";

/** Owns properties requests and the permission editor's captured file target. */
export default function useFileDetails({
  selectedFile,
  tabId,
  currentPath,
  refreshDirectory,
  showNotification,
}) {
  const { t } = useTranslation();
  const showOperationError = useCallback(
    (message) => showNotification(message, "error"),
    [showNotification],
  );
  const [showPropertiesDialog, setShowPropertiesDialog] = useState(false);

  const [propertiesLoading, setPropertiesLoading] = useState(false);

  const [propertiesData, setPropertiesData] = useState(null);

  const [showPermissionDialog, setShowPermissionDialog] = useState(false);

  const [permDialogPermissions, setPermDialogPermissions] = useState("644");

  const [permDialogOwner, setPermDialogOwner] = useState("");

  const [permDialogGroup, setPermDialogGroup] = useState("");

  const [permInitial, setPermInitial] = useState({
    permissions: "",
    owner: "",
    group: "",
  });
  const propertiesRequestRef = useRef(0);
  const permissionTargetRef = useRef(null);
  const [permissionSubmitting, setPermissionSubmitting] = useState(false);
  useEffect(() => {
    setShowPropertiesDialog(false);
    setPropertiesLoading(false);
    setPropertiesData(null);
    setShowPermissionDialog(false);
    setPermissionSubmitting(false);
    return () => {
      propertiesRequestRef.current += 1;
      permissionTargetRef.current = null;
    };
  }, [tabId]);

  const getFullPathForFile = useCallback(
    (file) => {
      if (!file) return "";
      return joinPath(currentPath || "/", file.name);
    },
    [currentPath],
  );

  const formatAbsoluteTime = useCallback(
    (timestamp) =>
      formatAbsoluteDateTime(timestamp, {
        fallback: t("fileManager.propertiesDialog.notAvailable"),
        requirePositiveNumber: true,
      }),
    [t],
  );

  const formatPermissionMode = useCallback((mode) => {
    if (!Number.isFinite(mode)) {
      return "";
    }
    return (mode & 0o777).toString(8).padStart(3, "0");
  }, []);

  const normalizePropertiesData = useCallback(
    (file, fullPath) => {
      if (!file) return null;
      return {
        name: file.name || "",
        type: file.isDirectory
          ? t("fileManager.fileTypes.folder")
          : t("fileManager.fileTypes.file"),
        path: fullPath || "",
        size: Number.isFinite(file.size) ? file.size : null,
        modifyTime: Number.isFinite(file.modifyTime) ? file.modifyTime : null,
        accessTime: Number.isFinite(file.accessTime) ? file.accessTime : null,
        createTime: Number.isFinite(file.createTime) ? file.createTime : null,
        permissions: formatPermissionMode(file.mode),
        uid: Number.isFinite(file.uid) ? file.uid : null,
        gid: Number.isFinite(file.gid) ? file.gid : null,
        isDirectory: Boolean(file.isDirectory),
      };
    },
    [formatPermissionMode, t],
  );

  const handleOpenProperties = useCallback(async () => {
    if (!selectedFile) return;

    const request = ++propertiesRequestRef.current;
    const fullPath = getFullPathForFile(selectedFile);
    setPropertiesData(normalizePropertiesData(selectedFile, fullPath));
    setShowPropertiesDialog(true);
    setPropertiesLoading(true);

    try {
      const [absolutePathResp, permissionResp] = await Promise.all([
        window.terminalAPI?.getAbsolutePath
          ? window.terminalAPI.getAbsolutePath(tabId, fullPath)
          : Promise.resolve(null),
        window.terminalAPI?.getFilePermissions
          ? window.terminalAPI.getFilePermissions(tabId, fullPath)
          : Promise.resolve(null),
      ]);

      if (request !== propertiesRequestRef.current) return;
      setPropertiesData((prev) => {
        if (!prev || request !== propertiesRequestRef.current) return prev;

        const mode =
          permissionResp?.stats?.mode ?? permissionResp?.mode ?? null;
        const uid = permissionResp?.stats?.uid ?? permissionResp?.uid;
        const gid = permissionResp?.stats?.gid ?? permissionResp?.gid;
        const statsSize = permissionResp?.stats?.size;
        const statsMtime = permissionResp?.stats?.mtime;
        const statsAtime = permissionResp?.stats?.atime;
        const statsCtime = permissionResp?.stats?.ctime;

        return {
          ...prev,
          path:
            absolutePathResp?.success && absolutePathResp?.path
              ? absolutePathResp.path
              : prev.path,
          permissions: formatPermissionMode(mode) || prev.permissions || "",
          uid: Number.isFinite(uid) ? uid : prev.uid,
          gid: Number.isFinite(gid) ? gid : prev.gid,
          size: Number.isFinite(statsSize) ? statsSize : prev.size,
          modifyTime: Number.isFinite(statsMtime)
            ? statsMtime * 1000
            : prev.modifyTime,
          accessTime: Number.isFinite(statsAtime)
            ? statsAtime * 1000
            : prev.accessTime,
          createTime: Number.isFinite(statsCtime)
            ? statsCtime * 1000
            : prev.createTime,
        };
      });
    } catch (e) {
      if (request !== propertiesRequestRef.current) return;
      showNotification(
        e?.message || t("fileManager.propertiesDialog.loadFailed"),
        "warning",
        3000,
      );
    } finally {
      if (request === propertiesRequestRef.current) setPropertiesLoading(false);
    }
  }, [
    selectedFile,
    getFullPathForFile,
    normalizePropertiesData,
    tabId,
    formatPermissionMode,
    showNotification,
    t,
  ]);

  const handleClosePropertiesDialog = useCallback(() => {
    propertiesRequestRef.current += 1;
    setShowPropertiesDialog(false);
    setPropertiesLoading(false);
    setPropertiesData(null);
  }, []);

  const handleOpenPermissions = useCallback(async () => {
    if (!selectedFile || permissionTargetRef.current?.submitting) return;
    const target = {
      tabId,
      path: currentPath,
      fullPath: getFullPathForFile(selectedFile),
      refreshDirectory,
    };
    permissionTargetRef.current = target;
    setShowPermissionDialog(false);
    try {
      const { fullPath } = target;
      // 默认权限
      const defaultPerm = selectedFile.isDirectory ? "755" : "644";
      setPermDialogPermissions(defaultPerm);
      setPermDialogOwner("");
      setPermDialogGroup("");
      setPermInitial({ permissions: defaultPerm, owner: "", group: "" });

      if (window.terminalAPI?.getFilePermissions) {
        const resp = await window.terminalAPI.getFilePermissions(
          tabId,
          fullPath,
        );
        if (permissionTargetRef.current !== target) return;
        if (resp?.success) {
          if (resp.permissions) {
            setPermDialogPermissions(resp.permissions);
          }
          // 预填 uid/gid（字符串），用户可改为名称
          const uid = resp.stats?.uid;
          const gid = resp.stats?.gid;
          const ownerStr =
            typeof uid === "number" || typeof uid === "string"
              ? String(uid)
              : "";
          const groupStr =
            typeof gid === "number" || typeof gid === "string"
              ? String(gid)
              : "";
          setPermDialogOwner(ownerStr);
          setPermDialogGroup(groupStr);
          setPermInitial({
            permissions: resp.permissions || defaultPerm,
            owner: ownerStr,
            group: groupStr,
          });
        }
      }
    } catch {
      // 忽略预取失败，使用默认
    }
    if (permissionTargetRef.current === target) setShowPermissionDialog(true);
  }, [selectedFile, tabId, currentPath, getFullPathForFile, refreshDirectory]);

  const handlePermissionDialogClose = useCallback(() => {
    if (permissionTargetRef.current?.submitting) return;
    permissionTargetRef.current = null;
    setShowPermissionDialog(false);
  }, []);

  const handlePermissionDialogSubmit = useCallback(
    async (e) => {
      if (e && e.preventDefault) e.preventDefault();
      const target = permissionTargetRef.current;
      if (!target || target.submitting) return;
      const { fullPath } = target;
      target.submitting = true;
      setPermissionSubmitting(true);
      const ops = [];
      try {
        // 权限变更
        if (
          permDialogPermissions &&
          permDialogPermissions !== permInitial.permissions &&
          window.terminalAPI?.setFilePermissions
        ) {
          ops.push(
            window.terminalAPI.setFilePermissions(
              target.tabId,
              fullPath,
              permDialogPermissions,
            ),
          );
        }

        // 所有者/组变更
        const ownerChanged = permDialogOwner !== permInitial.owner;
        const groupChanged = permDialogGroup !== permInitial.group;
        if (
          (ownerChanged || groupChanged) &&
          window.terminalAPI?.setFileOwnership
        ) {
          ops.push(
            window.terminalAPI.setFileOwnership(
              target.tabId,
              fullPath,
              permDialogOwner || undefined,
              permDialogGroup || undefined,
            ),
          );
        }

        if (ops.length > 0) {
          const results = await Promise.all(ops);
          const failed = results.find((r) => !r?.success);
          if (failed) {
            showOperationError(
              failed.error || t("fileManager.errors.permissionSetFailed"),
            );
          } else {
            await target.refreshDirectory(target.path);
          }
        }
      } catch (err) {
        showOperationError(
          `${t("fileManager.errors.permissionSetFailed")}: ${
            err?.message || t("fileManager.errors.unknownError")
          }`,
        );
      } finally {
        if (permissionTargetRef.current === target) {
          permissionTargetRef.current = null;
          setPermissionSubmitting(false);
          setShowPermissionDialog(false);
        }
      }
    },
    [
      permDialogPermissions,
      permDialogOwner,
      permDialogGroup,
      permInitial.permissions,
      permInitial.owner,
      permInitial.group,
      showOperationError,
      t,
    ],
  );

  return {
    handleOpenProperties,
    handleOpenPermissions,
    properties: {
      showPropertiesDialog,
      handleClosePropertiesDialog,
      propertiesLoading,
      propertiesData,
      formatAbsoluteTime,
    },
    permissions: {
      showPermissionDialog,
      handlePermissionDialogClose,
      handlePermissionDialogSubmit,
      permDialogPermissions,
      setPermDialogPermissions,
      permDialogOwner,
      setPermDialogOwner,
      permDialogGroup,
      setPermDialogGroup,
      permissionSubmitting,
    },
  };
}
