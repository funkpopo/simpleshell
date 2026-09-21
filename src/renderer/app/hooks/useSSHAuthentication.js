import * as React from "react";
import { actions } from "../state/appReducer.js";
import { findConnectionById } from "../appShellUtils.js";
export default function useSSHAuthentication({
  connectionsRef,
  terminalInstancesRef,
  dispatch,
  liveSessionKeysRef,
  liveSessionKeys,
}) {
  const [sshAuthDialogOpen, setSshAuthDialogOpen] = React.useState(false);

  const [sshAuthData, setSshAuthData] = React.useState(null);

  const [sshAuthConnectionConfig, setSshAuthConnectionConfig] =
    React.useState(null);

  const sshAuthRequestIdRef = React.useRef(null);

  React.useEffect(() => {
    if (!window.terminalAPI?.onSSHAuthRequest) return;

    const handleSSHAuthRequest = (data) => {
      if (!data?.requestId) return;
      if (data.cancelled) {
        if (sshAuthRequestIdRef.current === data.requestId) {
          sshAuthRequestIdRef.current = null;
          setSshAuthDialogOpen(false);
          setSshAuthData(null);
          setSshAuthConnectionConfig(null);
        }
        return;
      }
      if (sshAuthRequestIdRef.current === data.requestId) return;
      sshAuthRequestIdRef.current = data.requestId;

      // 查找对应的连接配置
      let connectionConfig = null;
      if (data.connectionId) {
        // 递归查找连接配置（复用模块级 findConnectionById）
        connectionConfig = findConnectionById(
          connectionsRef.current,
          data.connectionId,
        );
      }

      // 也可以从 tabId 获取配置
      if (
        !connectionConfig &&
        data.tabId &&
        terminalInstancesRef.current[`${data.tabId}-config`]
      ) {
        connectionConfig = terminalInstancesRef.current[`${data.tabId}-config`];
      }

      setSshAuthConnectionConfig(connectionConfig);
      setSshAuthData(data);
      setSshAuthDialogOpen(true);
    };

    const cleanup = window.terminalAPI.onSSHAuthRequest(handleSSHAuthRequest);

    return () => {
      if (cleanup) cleanup();
    };
  }, []);

  const handleSSHAuthConfirm = React.useCallback(
    async (authResult) => {
      const requestId = sshAuthRequestIdRef.current;
      if (!requestId) return;

      // 先消费当前请求，避免 IPC 返回前到达的下一步认证被旧回调清除。
      sshAuthRequestIdRef.current = null;
      setSshAuthDialogOpen(false);
      setSshAuthData(null);
      setSshAuthConnectionConfig(null);

      const targetTabId =
        sshAuthData?.tabId || sshAuthConnectionConfig?.tabId || null;
      if (targetTabId) {
        const configKey = `${targetTabId}-config`;
        const currentConfig =
          terminalInstancesRef.current?.[configKey] || sshAuthConnectionConfig;

        if (
          currentConfig &&
          ["username", "password", "privateKeyPath", "authType"].some(
            (field) => authResult?.[field] !== undefined,
          )
        ) {
          dispatch(
            actions.setTerminalInstances({
              ...terminalInstancesRef.current,
              [configKey]: {
                ...currentConfig,
                username:
                  authResult?.username !== undefined
                    ? authResult.username
                    : currentConfig.username,
                password:
                  authResult?.password !== undefined
                    ? authResult.password
                    : currentConfig.password,
                privateKeyPath:
                  authResult?.privateKeyPath !== undefined
                    ? authResult.privateKeyPath
                    : currentConfig.privateKeyPath,
                authType:
                  authResult?.authType || currentConfig.authType || "password",
              },
            }),
          );
        }
      }

      try {
        await window.terminalAPI.respondSSHAuth({ requestId, ...authResult });
      } catch (error) {
        console.error("Failed to respond SSH auth:", error);
      }
    },
    [dispatch, sshAuthConnectionConfig, sshAuthData],
  );

  const handleSSHAuthClose = React.useCallback(async () => {
    const requestId = sshAuthRequestIdRef.current;
    sshAuthRequestIdRef.current = null;
    setSshAuthDialogOpen(false);
    setSshAuthData(null);
    setSshAuthConnectionConfig(null);
    if (requestId) {
      try {
        await window.terminalAPI.respondSSHAuth({
          requestId,
          cancelled: true,
        });
      } catch (error) {
        console.error("Failed to cancel SSH auth:", error);
      }
    }
  }, []);

  React.useEffect(() => {
    if (
      sshAuthData?.tabId &&
      !liveSessionKeysRef.current.has(sshAuthData.tabId)
    ) {
      void handleSSHAuthClose();
    }
  }, [liveSessionKeys, sshAuthData, handleSSHAuthClose]);
  return {
    sshAuthDialogOpen,
    sshAuthData,
    sshAuthConnectionConfig,
    handleSSHAuthConfirm,
    handleSSHAuthClose,
  };
}
