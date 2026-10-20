import { Z_INDEX } from "../../shared/constants/zIndex.js";
import { useSftpFollowSetting } from "../../features/file-manager/hooks/useSftpFollowSetting.js";
import { useAppDispatch, useShellSelector } from "../state/AppContext.jsx";
import { actions } from "../state/appReducer.js";
import Box from "@mui/material/Box";
import {
  ConnectionManagerWithSuspense as ConnectionManager,
  FileManagerWithSuspense as FileManager,
  ResourceMonitorWithSuspense as ResourceMonitor,
  IPAddressQueryWithSuspense as IPAddressQuery,
  SecurityToolsWithSuspense as SecurityTools,
  PortForwardingDialogWithSuspense as PortForwardingDialog,
  CommandHistoryWithSuspense as CommandHistory,
  ShortcutCommandsWithSuspense as ShortcutCommands,
  LocalTerminalSidebarWithSuspense as LocalTerminalSidebar,
} from "../LazyComponents.jsx";
import { shallowEqual } from "../state/subscriptionStore.js";
import { useDelayedPresence } from "../appShellUtils.js";
import { useCallback } from "react";

export default function SidebarPanels({
  resourceMonitorOpen,
  fileManagerOpen,
  localTerminalSidebarOpen,
  activeSidebarContentWidth,
  sidebarResizing,
  activeSessionKey,
  handleCloseResourceMonitor,
  resourceMonitorTabId,
  sidebarSessionContext,
  handleCloseConnectionManager,
  connections,
  handleConnectionsUpdate,
  handleOpenConnection,
  createConnectionSignal,
  setCreateConnectionSignal,
  fileManagerProps,
  handleCloseFileManager,
  updateFileManagerPath,
  updateFileManagerHistory,
  handleCloseShortcutCommands,
  handleSendCommand,
  handleCloseCommandHistory,
  handleCloseIpAddressQuery,
  setFallbackSidebarAfterClose,
  activeSession,
  handleCloseLocalTerminalSidebar,
  handleLaunchLocalTerminal,
}) {
  const dispatch = useAppDispatch();
  const {
    connectionManagerOpen,
    shortcutCommandsOpen,
    commandHistoryOpen,
    ipAddressQueryOpen,
    securityToolsOpen,
    portForwardingOpen,
    lastOpenedSidebar,
  } = useShellSelector(
    (state) => ({
      connectionManagerOpen: state.connectionManagerOpen,
      shortcutCommandsOpen: state.shortcutCommandsOpen,
      commandHistoryOpen: state.commandHistoryOpen,
      ipAddressQueryOpen: state.ipAddressQueryOpen,
      securityToolsOpen: state.securityToolsOpen,
      portForwardingOpen: state.portForwardingOpen,
      lastOpenedSidebar: state.lastOpenedSidebar,
    }),
    shallowEqual,
  );
  const resourceMonitorPresent = useDelayedPresence(resourceMonitorOpen);
  const connectionManagerPresent = useDelayedPresence(connectionManagerOpen);
  const fileManagerPresent = useDelayedPresence(fileManagerOpen);
  const shortcutCommandsPresent = useDelayedPresence(shortcutCommandsOpen);
  const commandHistoryPresent = useDelayedPresence(commandHistoryOpen);
  const ipAddressQueryPresent = useDelayedPresence(ipAddressQueryOpen);
  const securityToolsPresent = useDelayedPresence(securityToolsOpen);
  const portForwardingPresent = useDelayedPresence(portForwardingOpen);
  const localTerminalSidebarPresent = useDelayedPresence(
    localTerminalSidebarOpen,
  );
  const sftpFollowTerminalDirectory = useSftpFollowSetting();
  const consumeCreateConnectionSignal = useCallback(
    () => setCreateConnectionSignal(0),
    [setCreateConnectionSignal],
  );
  const closeSecurityTools = useCallback(() => {
    dispatch(actions.setSecurityToolsOpen(false));
    setFallbackSidebarAfterClose("password");
  }, [dispatch, setFallbackSidebarAfterClose]);
  const closePortForwarding = useCallback(() => {
    dispatch(actions.setPortForwardingOpen(false));
    setFallbackSidebarAfterClose("forwarding");
  }, [dispatch, setFallbackSidebarAfterClose]);
  return (
    <Box
      sx={{
        width: `${activeSidebarContentWidth}px`,
        height: "100%",
        position: "relative",
        // 仅拖拽期间提升合成层，避免常驻 willChange 占用资源
        willChange: sidebarResizing ? "width" : undefined,
        transition: (theme) =>
          sidebarResizing
            ? "none"
            : theme.transitions.create("width", {
                easing: theme.transitions.easing.sharp,
                duration: theme.transitions.duration.enteringScreen,
              }),
        overflow: "hidden",
      }}
    >
      {/* 业务侧栏可多开：后打开的以更高 z-index 覆盖，关闭后回退到先前打开的 */}
      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "resource"
              ? Z_INDEX.sidebarActive
              : Z_INDEX.sidebarResource,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {resourceMonitorPresent && (
          <ResourceMonitor
            sessionKey={activeSessionKey}
            open={resourceMonitorOpen}
            onClose={handleCloseResourceMonitor}
            currentTabId={resourceMonitorTabId}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "connection"
              ? Z_INDEX.sidebarActive
              : Z_INDEX.sidebarConnection,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {connectionManagerPresent && (
          <ConnectionManager
            open={connectionManagerOpen}
            onClose={handleCloseConnectionManager}
            initialConnections={connections}
            onConnectionsUpdate={handleConnectionsUpdate}
            onOpenConnection={handleOpenConnection}
            createConnectionSignal={createConnectionSignal}
            onCreateConnectionSignalConsumed={consumeCreateConnectionSignal}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "file"
              ? Z_INDEX.sidebarFileActive
              : Z_INDEX.sidebarFile,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {fileManagerPresent && (
          <FileManager
            key={fileManagerProps.tabId || "file-manager-empty"}
            open={fileManagerOpen}
            onClose={handleCloseFileManager}
            tabId={fileManagerProps.tabId}
            tabName={fileManagerProps.tabName}
            sshConnection={fileManagerProps.sshConnection}
            initialPath={fileManagerProps.initialPath}
            navigationState={fileManagerProps.navigationState}
            onPathChange={updateFileManagerPath}
            onNavigationStateChange={updateFileManagerHistory}
            sessionContext={sidebarSessionContext}
            followTerminalDirectory={sftpFollowTerminalDirectory}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "shortcut"
              ? Z_INDEX.sidebarShortcutActive
              : Z_INDEX.sidebarShortcut,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {shortcutCommandsPresent && (
          <ShortcutCommands
            open={shortcutCommandsOpen}
            onClose={handleCloseShortcutCommands}
            onSendCommand={handleSendCommand}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "history"
              ? Z_INDEX.sidebarHistoryActive
              : Z_INDEX.sidebarHistory,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {commandHistoryPresent && (
          <CommandHistory
            open={commandHistoryOpen}
            onClose={handleCloseCommandHistory}
            onSendCommand={handleSendCommand}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "ipquery"
              ? Z_INDEX.sidebarIpQueryActive
              : Z_INDEX.sidebarIpQuery,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {ipAddressQueryPresent && (
          <IPAddressQuery
            open={ipAddressQueryOpen}
            onClose={handleCloseIpAddressQuery}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "password"
              ? Z_INDEX.sidebarSecurityActive
              : Z_INDEX.sidebarSecurity,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {securityToolsPresent && (
          <SecurityTools
            open={securityToolsOpen}
            onClose={closeSecurityTools}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "forwarding"
              ? Z_INDEX.sidebarSecurityActive
              : Z_INDEX.sidebarSecurity,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {portForwardingPresent && (
          <PortForwardingDialog
            open={portForwardingOpen}
            activeTabId={
              activeSession?.type === "ssh" ? activeSessionKey : null
            }
            activeSessionConnected={activeSession?.status?.isConnected === true}
            onClose={closePortForwarding}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex:
            lastOpenedSidebar === "localTerminal"
              ? Z_INDEX.sidebarLocalTerminalActive
              : Z_INDEX.sidebarLocalTerminal,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {localTerminalSidebarPresent && (
          <LocalTerminalSidebar
            open={localTerminalSidebarOpen}
            onClose={handleCloseLocalTerminalSidebar}
            onLaunchTerminal={handleLaunchLocalTerminal}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>
    </Box>
  );
}
