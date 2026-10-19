import { Z_INDEX } from "../../shared/constants/zIndex.js";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeart";
import LinkIcon from "@mui/icons-material/Link";
import FolderIcon from "@mui/icons-material/Folder";
import AIIcon from "../../features/ai/AIIcon.jsx";
import SidebarTooltip from "../../shared/ui/SidebarTooltip.jsx";
import Paper from "@mui/material/Paper";
import HistoryIcon from "@mui/icons-material/History";
import PublicIcon from "@mui/icons-material/Public";
import VpnKeyIcon from "@mui/icons-material/VpnKey";
import SettingsEthernetIcon from "@mui/icons-material/SettingsEthernet";
import ComputerIcon from "@mui/icons-material/Computer";
import TerminalIcon from "@mui/icons-material/Terminal";
import FirstPageIcon from "@mui/icons-material/FirstPage";
import LastPageIcon from "@mui/icons-material/LastPage";
import { shallowEqual } from "../state/subscriptionStore.js";
import { useTranslation } from "react-i18next";
import {
  sidebarRailButtonSx,
  sidebarRailDividerSx,
} from "../../shared/ui/sidebarItemStyles";
import TransferSidebarButton from "../../features/transfers/TransferSidebarButton.jsx";
import { intentPreloadProps } from "../appShellUtils.js";
import { useShellSelector } from "../state/AppContext.jsx";

export default function SidebarRail({
  sidebarPosition,
  toggleConnectionManager,
  isFileManagerButtonDisabled,
  toggleFileManager,
  fileManagerOpen,
  toggleShortcutCommands,
  activeSession,
  toggleCommandHistory,
  toggleResourceMonitor,
  canMonitorCurrentSession,
  toggleIpAddressQuery,
  toggleSecurityTools,
  togglePortForwarding,
  toggleLocalTerminalSidebar,
  localTerminalSidebarOpen,
  transferSidebarButtonRef,
  transferSidebarOpen,
  resumableTransferCount,
  handleToggleTransferSidebar,
  aiPanelOpen,
  aiApiReachable,
  aiChatButtonRef,
  handleToggleGlobalAiChatWindow,
  toggleTheme,
  darkMode,
  handleToggleSidebarPosition,
}) {
  const { t } = useTranslation();
  const sidebarTooltipPlacement = "top";
  const {
    connectionManagerOpen,
    shortcutCommandsOpen,
    commandHistoryOpen,
    resourceMonitorOpen,
    ipAddressQueryOpen,
    securityToolsOpen,
    portForwardingOpen,
    aiChatStatus,
  } = useShellSelector(
    (state) => ({
      connectionManagerOpen: state.connectionManagerOpen,
      shortcutCommandsOpen: state.shortcutCommandsOpen,
      commandHistoryOpen: state.commandHistoryOpen,
      resourceMonitorOpen: state.resourceMonitorOpen,
      ipAddressQueryOpen: state.ipAddressQueryOpen,
      securityToolsOpen: state.securityToolsOpen,
      portForwardingOpen: state.portForwardingOpen,
      aiChatStatus: state.aiChatStatus,
    }),
    shallowEqual,
  );
  return (
    <Paper
      elevation={0}
      square={true}
      sx={(theme) => ({
        width: "var(--sidebar-rail-width, 48px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 1.25,
        gap: "var(--sidebar-rail-item-gap, 4px)",
        borderRadius: 0,
        zIndex: Z_INDEX.sidebarRail,
        flexShrink: 0,
        bgcolor: "background.paper",
        borderLeft:
          sidebarPosition === "right"
            ? `1px solid ${theme.palette.divider}`
            : "none",
        borderRight:
          sidebarPosition === "left"
            ? `1px solid ${theme.palette.divider}`
            : "none",
        boxShadow:
          theme.palette.mode === "dark"
            ? "inset 0 0 0 1px rgba(255,255,255,0.03)"
            : "none",
      })}
    >
      {/* 上：会话 / 连接 / 文件 / 历史 */}
      <SidebarTooltip
        title={t("sidebar.connections")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("connectionManager")}
          onClick={toggleConnectionManager}
          sx={(theme) => sidebarRailButtonSx(theme, connectionManagerOpen)}
          aria-label={t("sidebar.connections")}
        >
          <LinkIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={
          isFileManagerButtonDisabled
            ? t("fileManager.errors.connectionNotReady")
            : t("sidebar.files")
        }
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("fileManager")}
          onClick={toggleFileManager}
          sx={(theme) => sidebarRailButtonSx(theme, fileManagerOpen)}
          disabled={isFileManagerButtonDisabled}
          aria-label={t("sidebar.files")}
        >
          <FolderIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.shortcutCommands")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("shortcutCommands")}
          onClick={toggleShortcutCommands}
          sx={(theme) => sidebarRailButtonSx(theme, shortcutCommandsOpen)}
          disabled={!activeSession}
          aria-label={t("sidebar.shortcutCommands")}
        >
          <TerminalIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.history")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("commandHistory")}
          onClick={toggleCommandHistory}
          sx={(theme) => sidebarRailButtonSx(theme, commandHistoryOpen)}
          aria-label={t("sidebar.history")}
        >
          <HistoryIcon />
        </IconButton>
      </SidebarTooltip>

      <Box sx={sidebarRailDividerSx} />

      {/* 中：工具 — 监控 / IP / 安全 / 本地 / 传输 */}
      <SidebarTooltip
        title={t("sidebar.monitor")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("resourceMonitor")}
          onClick={toggleResourceMonitor}
          disabled={!canMonitorCurrentSession}
          sx={(theme) => sidebarRailButtonSx(theme, resourceMonitorOpen)}
          aria-label={t("sidebar.monitor")}
        >
          <MonitorHeartIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.ipQuery")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("ipAddressQuery")}
          onClick={toggleIpAddressQuery}
          sx={(theme) => sidebarRailButtonSx(theme, ipAddressQueryOpen)}
          aria-label={t("sidebar.ipQuery")}
        >
          <PublicIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.securityTool")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("securityTools")}
          onClick={toggleSecurityTools}
          sx={(theme) => sidebarRailButtonSx(theme, securityToolsOpen)}
          aria-label={t("sidebar.securityTool")}
        >
          <VpnKeyIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.portForwarding")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("portForwarding")}
          onClick={togglePortForwarding}
          sx={(theme) => sidebarRailButtonSx(theme, portForwardingOpen)}
          aria-label={t("sidebar.portForwarding")}
        >
          <SettingsEthernetIcon />
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.localTerminal")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("localTerminalSidebar")}
          onClick={toggleLocalTerminalSidebar}
          sx={(theme) => sidebarRailButtonSx(theme, localTerminalSidebarOpen)}
          aria-label={t("sidebar.localTerminal")}
        >
          <ComputerIcon />
        </IconButton>
      </SidebarTooltip>

      {
        <TransferSidebarButton
          ref={transferSidebarButtonRef}
          isOpen={transferSidebarOpen}
          resumableCount={resumableTransferCount}
          onClick={handleToggleTransferSidebar}
          tooltipPlacement={sidebarTooltipPlacement}
        />
      }

      <Box sx={sidebarRailDividerSx} />

      {/* 下：AI / 主题 / 位置切换 */}
      <SidebarTooltip
        title={
          aiPanelOpen && aiApiReachable === false
            ? t("sidebar.aiApiUnreachable")
            : t("sidebar.ai")
        }
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          {...intentPreloadProps("aiChatWindow")}
          ref={aiChatButtonRef}
          onClick={handleToggleGlobalAiChatWindow}
          sx={(theme) => ({
            position: "relative",
            ...sidebarRailButtonSx(theme, aiChatStatus === "visible"),
          })}
          aria-label={
            aiPanelOpen && aiApiReachable === false
              ? t("sidebar.aiApiUnreachable")
              : t("sidebar.ai")
          }
        >
          <AIIcon />
          {aiPanelOpen && (
            <Box
              sx={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: "50%",
                bgcolor: aiApiReachable === false ? "#f44336" : "#4caf50",
                boxShadow:
                  aiApiReachable === false
                    ? "0 0 4px #f44336"
                    : "0 0 4px #4caf50",
              }}
            />
          )}
        </IconButton>
      </SidebarTooltip>

      <SidebarTooltip
        title={t("sidebar.theme")}
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          onClick={toggleTheme}
          sx={(theme) => sidebarRailButtonSx(theme, false)}
          aria-label={t("sidebar.theme")}
        >
          {darkMode ? <DarkModeIcon /> : <LightModeIcon />}
        </IconButton>
      </SidebarTooltip>

      <Box
        sx={{
          flexGrow: 1,
        }}
      />

      <SidebarTooltip
        title={
          sidebarPosition === "left"
            ? t("sidebar.moveToRight")
            : t("sidebar.moveToLeft")
        }
        placement={sidebarTooltipPlacement}
      >
        <IconButton
          onClick={handleToggleSidebarPosition}
          sx={(theme) => sidebarRailButtonSx(theme, false)}
          aria-label={
            sidebarPosition === "left"
              ? t("sidebar.moveToRight")
              : t("sidebar.moveToLeft")
          }
        >
          {sidebarPosition === "left" ? <LastPageIcon /> : <FirstPageIcon />}
        </IconButton>
      </SidebarTooltip>
    </Paper>
  );
}
