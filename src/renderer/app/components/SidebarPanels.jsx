import { useSftpFollowSetting } from "../../features/file-manager/hooks/useSftpFollowSetting.js";
import { useAppDispatch, useAppSelector } from "../state/AppContext.jsx";
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
  } = useAppSelector(
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
          zIndex: lastOpenedSidebar === "resource" ? 101 : 98,
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
          zIndex: lastOpenedSidebar === "connection" ? 101 : 99,
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
            onCreateConnectionSignalConsumed={() =>
              setCreateConnectionSignal(0)
            }
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: lastOpenedSidebar === "file" ? 103 : 96,
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
          zIndex: lastOpenedSidebar === "shortcut" ? 104 : 95,
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
          zIndex: lastOpenedSidebar === "history" ? 105 : 94,
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
          zIndex: lastOpenedSidebar === "ipquery" ? 106 : 93,
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
          zIndex: lastOpenedSidebar === "password" ? 107 : 92,
          width: "100%",
          height: "100%",
          display: "flex",
        }}
      >
        {securityToolsPresent && (
          <SecurityTools
            open={securityToolsOpen}
            onClose={() => {
              dispatch(actions.setSecurityToolsOpen(false));
              setFallbackSidebarAfterClose("password");
            }}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: lastOpenedSidebar === "forwarding" ? 107 : 92,
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
            onClose={() => {
              dispatch(actions.setPortForwardingOpen(false));
              setFallbackSidebarAfterClose("forwarding");
            }}
            sessionContext={sidebarSessionContext}
          />
        )}
      </Box>

      <Box
        sx={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: lastOpenedSidebar === "localTerminal" ? 108 : 91,
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
