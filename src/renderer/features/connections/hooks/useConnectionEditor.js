import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNotification } from "../../../shared/notifications/NotificationContext";
import {
  SAVED_PASSWORD_MASK,
  DEFAULT_SERIAL_FORM,
  DEFAULT_MOSH_FORM,
  buildConnectionPayloadFromForm,
  getConnectionValidationSteps,
} from "../lib/connectionForm.js";

export default function useConnectionEditor({
  connections,
  setConnections,
  isSavingRef,
  open,
  createConnectionSignal,
  onCreateConnectionSignalConsumed,
}) {
  const { t, i18n } = useTranslation();
  const { showError, showSuccess } = useNotification();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogType, setDialogType] = useState("");
  const [dialogMode, setDialogMode] = useState("");
  const [selectedItem, setSelectedItem] = useState(null);
  const [formData, setFormData] = useState({
    name: "",
    host: "",
    port: 22,
    username: "",
    password: "",
    authType: "password",
    privateKeyPath: "",
    agentPath: "",
    agentForward: false,
    parentGroup: "",
    os: "",
    connectionType: "",
    protocol: "ssh", // 默认为SSH
    ...DEFAULT_SERIAL_FORM,
    ...DEFAULT_MOSH_FORM,
    passwordTouched: false,
    passwordRevealed: false,
    passwordMasked: false,
    // 代理配置
    enableProxy: false,
    proxyType: "http",
    proxyHost: "",
    proxyPort: 8080,
    proxyUsername: "",
    proxyPassword: "",
    proxyPasswordTouched: false,
    proxyUseDefault: true, // 使用默认代理配置
  });
  const [showPassword, setShowPassword] = useState(false);
  const [revealingPassword, setRevealingPassword] = useState(false);
  const [privateKeyCheck, setPrivateKeyCheck] = useState({
    status: "idle",
    message: "",
    permissions: null,
  });
  const [connectionTestResult, setConnectionTestResult] = useState(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const lastSavedDraftRef = useRef(null);
  const flushEditSaveRef = useRef(null);
  const [serialPorts, setSerialPorts] = useState([]);
  const [serialPortsLoading, setSerialPortsLoading] = useState(false);
  const handleAddConnection = useCallback((parentGroupId = null) => {
    setSelectedItem(null);
    setDialogType("connection");
    setDialogMode("add");
    setPrivateKeyCheck({ status: "idle", message: "", permissions: null });
    setConnectionTestResult(null);
    setFormData({
      name: "",
      host: "",
      port: 22,
      username: "",
      password: "",
      authType: "password",
      privateKeyPath: "",
      agentPath: "",
      agentForward: false,
      parentGroup: parentGroupId || "",
      os: "",
      connectionType: "",
      protocol: "ssh", // 默认为SSH
      ...DEFAULT_SERIAL_FORM,
      ...DEFAULT_MOSH_FORM,
      passwordTouched: false,
      passwordRevealed: false,
      passwordMasked: false,
      // 代理配置（保持字段完整，避免 undefined）
      enableProxy: false,
      proxyType: "http",
      proxyHost: "",
      proxyPort: 8080,
      proxyUsername: "",
      proxyPassword: "",
      proxyPasswordTouched: false,
      proxyUseDefault: true,
    });
    setShowPassword(false);
    setDialogOpen(true);
  }, []);
  useEffect(() => {
    if (!open || !createConnectionSignal) {
      return;
    }

    handleAddConnection();
    onCreateConnectionSignalConsumed?.();
  }, [
    createConnectionSignal,
    handleAddConnection,
    onCreateConnectionSignalConsumed,
    open,
  ]);
  const handleAddGroup = useCallback(() => {
    setSelectedItem(null);
    setDialogType("group");
    setDialogMode("add");
    setFormData({
      name: "",
    });
    setDialogOpen(true);
  }, []);
  const handleEdit = useCallback((item, parentGroup = null) => {
    setSelectedItem({
      ...item,
      parentGroupId: parentGroup ? parentGroup.id : null,
    });
    setDialogMode("edit");

    if (item.type === "group") {
      setDialogType("group");
      setPrivateKeyCheck({ status: "idle", message: "", permissions: null });
      setConnectionTestResult(null);
      setFormData({
        name: item.name,
      });
    } else {
      setDialogType("connection");
      setPrivateKeyCheck({ status: "idle", message: "", permissions: null });
      setConnectionTestResult(null);
      // 确保端口值与协议类型匹配
      const port =
        item.protocol === "serial"
          ? null
          : item.port || (item.protocol === "telnet" ? 23 : 22);
      const hasSavedPassword = Boolean(item.password);
      setFormData({
        name: item.name,
        host: item.host,
        port: port,
        username: item.username || "",
        password: hasSavedPassword ? SAVED_PASSWORD_MASK : "",
        authType: item.authType || "password",
        privateKeyPath: item.privateKeyPath || "",
        agentPath: item.agentPath || "",
        agentForward: item.agentForward === true,
        parentGroup: parentGroup ? parentGroup.id : "",
        os: item.os || "",
        connectionType: item.connectionType || "",
        protocol: item.protocol || "ssh",
        // 串口参数（仅 protocol 为 serial 时使用）
        ...DEFAULT_SERIAL_FORM,
        ...(item.protocol === "serial"
          ? {
              baudRate: item.baudRate || DEFAULT_SERIAL_FORM.baudRate,
              dataBits: item.dataBits || DEFAULT_SERIAL_FORM.dataBits,
              stopBits: item.stopBits || DEFAULT_SERIAL_FORM.stopBits,
              parity: item.parity || DEFAULT_SERIAL_FORM.parity,
              flowControl: item.flowControl || DEFAULT_SERIAL_FORM.flowControl,
            }
          : {}),
        // Mosh 参数（仅 protocol 为 mosh 时使用）
        ...DEFAULT_MOSH_FORM,
        ...(item.protocol === "mosh"
          ? {
              moshBinaryPath: item.moshBinaryPath || "",
              moshUseWsl: item.moshUseWsl === true,
              moshPredict: item.moshPredict || DEFAULT_MOSH_FORM.moshPredict,
              moshServerPort: item.moshServerPort || "",
            }
          : {}),
        passwordTouched: false,
        passwordRevealed: false,
        passwordMasked: hasSavedPassword,
        // 代理配置
        enableProxy: !!item.proxy,
        proxyType: item.proxy?.type || "http",
        proxyHost: item.proxy?.host || "",
        proxyPort: item.proxy?.port || 8080,
        proxyUsername: item.proxy?.username || "",
        proxyPassword: "",
        proxyPasswordTouched: false,
        proxyUseDefault:
          item.proxy?.useDefault !== undefined ? item.proxy.useDefault : true,
      });
    }

    setShowPassword(false);
    setDialogOpen(true);
  }, []);
  const handleDialogClose = useCallback(async () => {
    if (flushEditSaveRef.current && !(await flushEditSaveRef.current())) return;
    setDialogOpen(false);
    setConnectionTestResult(null);
    setShowPassword(false);
  }, []);
  const handleRefreshSerialPorts = useCallback(async () => {
    if (!window.terminalAPI?.listSerialPorts) {
      return;
    }
    setSerialPortsLoading(true);
    try {
      const result = await window.terminalAPI.listSerialPorts();
      if (result?.success && Array.isArray(result.data)) {
        setSerialPorts(result.data);
      } else {
        setSerialPorts([]);
      }
    } catch {
      setSerialPorts([]);
    } finally {
      setSerialPortsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (
      dialogOpen &&
      dialogType === "connection" &&
      formData.protocol === "serial"
    ) {
      handleRefreshSerialPorts();
    }
  }, [dialogOpen, dialogType, formData.protocol, handleRefreshSerialPorts]);
  const handleFormChange = useCallback((e) => {
    const { name, value } = e.target;

    setConnectionTestResult(null);
    setFormData((prev) => {
      // 如果修改的是协议字段，根据协议类型自动更新端口值
      if (name === "protocol") {
        if (value === "serial") {
          // 串口没有端口概念，清空端口字段
          return { ...prev, [name]: value, port: null };
        }
        // mosh 的端口为 SSH 引导端口，默认 22
        const defaultPort = value === "telnet" ? 23 : 22;
        // 只有在端口是默认值时才更新，如果用户已手动修改则保留
        if (prev.port === 22 || prev.port === 23 || prev.port === null) {
          return { ...prev, [name]: value, port: defaultPort };
        }
      }
      if (name === "password") {
        return {
          ...prev,
          [name]: value,
          passwordTouched: true,
          passwordRevealed: false,
          passwordMasked: false,
        };
      }
      if (name === "proxyPassword") {
        return { ...prev, [name]: value, proxyPasswordTouched: true };
      }
      return { ...prev, [name]: value };
    });
  }, []);
  const handleTogglePasswordVisibility = useCallback(async () => {
    if (showPassword) {
      setShowPassword(false);
      return;
    }

    if (dialogMode !== "edit" || !selectedItem?.id) {
      setShowPassword(true);
      return;
    }

    if (formData.passwordTouched && formData.passwordMasked !== true) {
      setShowPassword(true);
      return;
    }

    if (!window.terminalAPI?.getConnectionPassword) {
      showError(t("connectionManager.passwordRevealUnavailable"));
      return;
    }

    setRevealingPassword(true);
    try {
      const result = await window.terminalAPI.getConnectionPassword(
        selectedItem.id,
      );

      if (result?.success) {
        setFormData((prev) => ({
          ...prev,
          password: result.password || "",
          passwordMasked: false,
          passwordRevealed: true,
        }));
        setShowPassword(true);
        return;
      }

      if (result?.code === "MASTER_PASSWORD_NOT_CONFIGURED") {
        showError(t("connectionManager.passwordRevealRequiresMasterPassword"));
        return;
      }

      if (result?.code === "CREDENTIAL_STORE_LOCKED") {
        showError(t("connectionManager.passwordRevealRequiresUnlock"));
        return;
      }

      showError(result?.error || t("connectionManager.passwordRevealFailed"));
    } catch (error) {
      showError(error?.message || t("connectionManager.passwordRevealFailed"));
    } finally {
      setRevealingPassword(false);
    }
  }, [
    dialogMode,
    formData.passwordMasked,
    formData.passwordTouched,
    selectedItem,
    showError,
    showPassword,
    t,
  ]);
  useEffect(() => {
    if (
      !dialogOpen ||
      dialogType !== "connection" ||
      formData.protocol !== "ssh" ||
      formData.authType !== "privateKey"
    ) {
      setPrivateKeyCheck((previous) =>
        previous.status === "idle"
          ? previous
          : { status: "idle", message: "", permissions: null },
      );
      return undefined;
    }

    const privateKeyPath = String(formData.privateKeyPath || "").trim();
    if (!privateKeyPath) {
      setPrivateKeyCheck((previous) =>
        previous.status === "idle"
          ? previous
          : { status: "idle", message: "", permissions: null },
      );
      return undefined;
    }

    let cancelled = false;
    setPrivateKeyCheck({
      status: "checking",
      message: t("connectionManager.validation.privateKeyChecking"),
      permissions: null,
    });

    const timer = window.setTimeout(async () => {
      try {
        if (!window.terminalAPI?.checkPathExists) {
          if (!cancelled) {
            setPrivateKeyCheck({
              status: "warning",
              message: t("connectionManager.validation.privateKeyCannotVerify"),
              permissions: null,
            });
          }
          return;
        }

        const result = await window.terminalAPI.checkPathExists(privateKeyPath);
        if (cancelled) {
          return;
        }

        if (result?.success === false) {
          setPrivateKeyCheck({
            status: "error",
            message:
              result.error ||
              t("connectionManager.validation.privateKeyUnreadable"),
            permissions: null,
          });
          return;
        }

        if (!result?.exists) {
          setPrivateKeyCheck({
            status: "error",
            message: t("connectionManager.validation.privateKeyNotFound"),
            permissions: null,
          });
          return;
        }

        if (result.isFile === false) {
          setPrivateKeyCheck({
            status: "error",
            message: t("connectionManager.validation.privateKeyNotFile"),
            permissions: result.permissions || null,
          });
          return;
        }

        if (result.readable === false) {
          setPrivateKeyCheck({
            status: "error",
            message: t("connectionManager.validation.privateKeyUnreadable"),
            permissions: result.permissions || null,
          });
          return;
        }

        const permissions = result.permissions || null;
        const unsafe =
          permissions &&
          /^[0-7]{3,4}$/.test(permissions) &&
          (Number.parseInt(permissions, 8) & 0o077) !== 0;

        setPrivateKeyCheck({
          status: unsafe ? "warning" : "ok",
          message: unsafe
            ? t("connectionManager.validation.privateKeyUnsafe", {
                permissions,
              })
            : t("connectionManager.validation.privateKeyOk"),
          permissions,
        });
      } catch (error) {
        if (!cancelled) {
          setPrivateKeyCheck({
            status: "error",
            message:
              error?.message ||
              t("connectionManager.validation.privateKeyUnreadable"),
            permissions: null,
          });
        }
      }
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    dialogOpen,
    dialogType,
    formData.authType,
    formData.privateKeyPath,
    formData.protocol,
    t,
  ]);
  const validationSteps = useMemo(
    () => getConnectionValidationSteps(t, formData, privateKeyCheck),
    [formData, privateKeyCheck, t],
  );
  const firstInvalidStep = useMemo(
    () => validationSteps.find((step) => !step.ok),
    [validationSteps],
  );
  const canTestConnection =
    dialogType === "connection" &&
    formData.protocol === "ssh" &&
    !testingConnection &&
    !firstInvalidStep;
  const handleTestConnection = useCallback(async () => {
    if (dialogType !== "connection" || formData.protocol !== "ssh") {
      return;
    }

    const invalidStep = validationSteps.find((step) => !step.ok);
    if (invalidStep) {
      showError(invalidStep.message);
      setConnectionTestResult({
        success: false,
        message: invalidStep.message,
      });
      return;
    }

    if (!window.terminalAPI?.testSSHConnection) {
      const message = t("connectionManager.testUnavailable");
      setConnectionTestResult({ success: false, message });
      showError(message);
      return;
    }

    setTestingConnection(true);
    setConnectionTestResult(null);

    try {
      const payload = buildConnectionPayloadFromForm({
        formData,
        selectedItem,
        dialogMode,
      });
      const result = await window.terminalAPI.testSSHConnection({
        ...payload,
        language: i18n.language,
      });

      if (result?.success) {
        const message = t("connectionManager.testSuccess", {
          duration: Math.max(1, Math.round(Number(result.durationMs) || 1)),
        });
        setConnectionTestResult({ success: true, message });
        showSuccess(message);
        return;
      }

      const message =
        result?.advice || result?.error || t("connectionManager.testFailed");
      setConnectionTestResult({
        success: false,
        message,
        detail: result?.error || "",
        kind: result?.failureKind || "",
      });
      showError(message);
    } catch (error) {
      const message = error?.message || t("connectionManager.testFailed");
      setConnectionTestResult({ success: false, message });
      showError(message);
    } finally {
      setTestingConnection(false);
    }
  }, [
    dialogMode,
    dialogType,
    formData,
    i18n.language,
    selectedItem,
    showError,
    showSuccess,
    t,
    validationSteps,
  ]);
  const handleSave = useCallback(
    async (options = {}) => {
      const autoSave = options.autoSave === true;
      // 验证必填字段
      if (!formData.name || !formData.name.trim()) {
        showError(t("connectionManager.nameRequired"));
        return;
      }

      // 只有在创建连接时才检查主机地址（串口协议下为端口路径）
      if (
        dialogType === "connection" &&
        (!formData.host || !formData.host.trim())
      ) {
        if (formData.protocol === "serial") {
          showError(t("connectionManager.serialPortRequired"));
        } else {
          showError(t("connectionManager.hostRequired"));
        }
        return;
      }

      if (dialogType === "group") {
        const groupData = {
          id: selectedItem?.id || `group_${Date.now()}`,
          type: "group",
          name: formData.name,
          items: selectedItem?.items || [],
        };

        let newConnections;
        if (dialogMode === "add") {
          newConnections = [...connections, groupData];
        } else {
          newConnections = connections.map((item) =>
            item.id === selectedItem.id
              ? { ...item, name: formData.name }
              : item,
          );
        }

        setConnections(newConnections);

        // 保存到配置文件
        if (window.terminalAPI && window.terminalAPI.saveConnections) {
          isSavingRef.current = true;
          window.terminalAPI
            .saveConnections(newConnections)
            .catch(() => {
              showError(t("connectionManager.saveFailed"));
            })
            .finally(() => {
              setTimeout(() => {
                isSavingRef.current = false;
              }, 100);
            });
        }

        setDialogOpen(false);
        showSuccess(
          dialogMode === "add"
            ? t("connectionManager.createSuccess")
            : t("connectionManager.updateSuccess"),
        );
        return;
      }

      const invalidStep = validationSteps.find((step) => !step.ok);
      if (invalidStep) {
        showError(invalidStep.message);
        return;
      }

      // 处理连接保存
      const connectionData = buildConnectionPayloadFromForm({
        formData,
        selectedItem,
        dialogMode,
      });

      // 保存到本地状态
      let newConnections;
      if (dialogMode === "add") {
        if (formData.parentGroup) {
          // 添加到组内
          newConnections = connections.map((item) =>
            item.id === formData.parentGroup
              ? { ...item, items: [...(item.items || []), connectionData] }
              : item,
          );
        } else {
          // 添加到顶级
          newConnections = [...connections, connectionData];
        }
      } else {
        // 编辑连接
        const oldParentId = selectedItem.parentGroupId;
        const newParentId = formData.parentGroup;

        if (oldParentId === newParentId) {
          // 分组未改变，原地更新
          if (oldParentId) {
            // 在组内编辑
            newConnections = connections.map((group) =>
              group.id === oldParentId
                ? {
                    ...group,
                    items: group.items.map((item) =>
                      item.id === selectedItem.id ? connectionData : item,
                    ),
                  }
                : group,
            );
          } else {
            // 在顶级编辑
            newConnections = connections.map((item) =>
              item.id === selectedItem.id ? connectionData : item,
            );
          }
        } else {
          // 分组已改变，先删除后添加
          let tempConnections = [...connections];

          // 1. 从旧位置移除
          if (oldParentId) {
            const oldGroupIndex = tempConnections.findIndex(
              (g) => g.id === oldParentId,
            );
            if (oldGroupIndex > -1) {
              tempConnections[oldGroupIndex] = {
                ...tempConnections[oldGroupIndex],
                items: tempConnections[oldGroupIndex].items.filter(
                  (i) => i.id !== selectedItem.id,
                ),
              };
            }
          } else {
            tempConnections = tempConnections.filter(
              (i) => i.id !== selectedItem.id,
            );
          }

          // 2. 添加到新位置
          if (newParentId) {
            const newGroupIndex = tempConnections.findIndex(
              (g) => g.id === newParentId,
            );
            if (newGroupIndex > -1) {
              tempConnections[newGroupIndex] = {
                ...tempConnections[newGroupIndex],
                items: [
                  ...(tempConnections[newGroupIndex].items || []),
                  connectionData,
                ],
              };
            }
          } else {
            tempConnections.push(connectionData);
          }

          newConnections = tempConnections;
        }
      }

      isSavingRef.current = true;
      try {
        if (window.terminalAPI?.saveConnections) {
          const result =
            await window.terminalAPI.saveConnections(newConnections);
          if (result === false || result?.success === false)
            throw new Error(t("connectionManager.saveFailed"));
        }
      } catch {
        showError(t("connectionManager.saveFailed"));
        return false;
      } finally {
        isSavingRef.current = false;
      }

      setConnections(newConnections);
      if (dialogMode === "edit") {
        setSelectedItem({
          ...connectionData,
          parentGroupId: formData.parentGroup,
        });
      }
      if (!autoSave) {
        setDialogOpen(false);
        showSuccess(
          dialogMode === "add"
            ? t("connectionManager.createSuccess")
            : t("connectionManager.updateSuccess"),
        );
      }
      setConnectionTestResult(null);
      return true;
    },
    [
      dialogType,
      dialogMode,
      formData,
      selectedItem,
      connections,
      t,
      showError,
      showSuccess,
      validationSteps,
    ],
  );
  const autoSaveEnabled =
    dialogOpen &&
    dialogMode === "edit" &&
    dialogType === "connection" &&
    formData.protocol === "ssh";
  const editDraftSignature = JSON.stringify(formData);
  useEffect(() => {
    lastSavedDraftRef.current = editDraftSignature;
  }, [dialogOpen, dialogMode, selectedItem?.id]);
  useEffect(() => {
    if (!autoSaveEnabled) {
      flushEditSaveRef.current = null;
      return;
    }
    const saveDraft = async () => {
      if (lastSavedDraftRef.current === editDraftSignature) return true;
      const saved = await handleSave({ autoSave: true });
      if (saved) lastSavedDraftRef.current = editDraftSignature;
      return saved;
    };
    flushEditSaveRef.current = saveDraft;
    if (firstInvalidStep || lastSavedDraftRef.current === editDraftSignature)
      return;
    const timer = setTimeout(() => {
      void saveDraft();
    }, 700);
    return () => clearTimeout(timer);
  }, [autoSaveEnabled, editDraftSignature, firstInvalidStep, handleSave]);
  const groups = useMemo(
    () => connections.filter((connection) => connection.type === "group"),
    [connections],
  );
  return {
    handleAddConnection,
    handleAddGroup,
    handleEdit,
    dialogOpen,
    handleDialogClose,
    dialogMode,
    dialogType,
    formData,
    handleFormChange,
    handleRefreshSerialPorts,
    serialPortsLoading,
    serialPorts,
    setFormData,
    showPassword,
    handleTogglePasswordVisibility,
    revealingPassword,
    groups,
    validationSteps,
    connectionTestResult,
    autoSaveEnabled,
    handleTestConnection,
    canTestConnection,
    testingConnection,
    handleSave,
  };
}
