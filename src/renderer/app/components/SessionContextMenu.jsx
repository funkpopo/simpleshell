import * as React from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import RefreshIcon from "@mui/icons-material/Refresh";
import PowerOffIcon from "@mui/icons-material/PowerOff";
import SplitscreenIcon from "@mui/icons-material/Splitscreen";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import HorizontalSplitIcon from "@mui/icons-material/HorizontalSplit";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import EditIcon from "@mui/icons-material/Edit";
import RestoreIcon from "@mui/icons-material/Restore";
import CampaignIcon from "@mui/icons-material/Campaign";
import ReconnectMenuSection from "../ReconnectMenuSection.jsx";
import { findGroupByTab } from "../../features/terminal/model/syncInputGroups";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import CopyAllIcon from "@mui/icons-material/CopyAll";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import Divider from "@mui/material/Divider";

const MAX_PANES = 4;

export default function SessionContextMenu({
  tabContextMenu,
  handleTabContextMenuClose,
  handleRefreshTerminal,
  t,
  handleCloseConnection,
  contextMenuTab,
  splitLayouts,
  handleUnsplitTab,
  handlePauseReconnect,
  handleResumeReconnect,
  syncGroups,
  handleJoinGroup,
  handleRemoveFromGroup,
  handleCreateGroup,
  tabs = [],
  closedTabsCount = 0,
  broadcastBarOpen = false,
  onDuplicateTab,
  onRenameTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onReopenClosedTab,
  onSplitTabRight,
  onSplitTabBottom,
  onToggleBroadcastBar,
  onCopyAllOutput = null,
  onExportScrollback = null,
}) {
  const paneCount = contextMenuTab
    ? splitLayouts?.[contextMenuTab.id]?.panes?.length || 1
    : 1;
  const sessionTabs = Array.isArray(tabs)
    ? tabs.filter((item) => item && item.id !== "welcome")
    : [];
  const canCloseOthers = Boolean(contextMenuTab && sessionTabs.length > 1);
  const currentTabIdx =
    contextMenuTab && Array.isArray(tabs)
      ? tabs.findIndex((item) => item.id === contextMenuTab.id)
      : -1;
  const canCloseRight = Boolean(
    contextMenuTab &&
    currentTabIdx >= 0 &&
    tabs.slice(currentTabIdx + 1).some((item) => item.id !== "welcome"),
  );
  const canReopenClosed = Number(closedTabsCount) > 0;
  const dispatchScrollbackAction = (action) => {
    const tabId = tabContextMenu.tabId;
    if (tabId) {
      const targetSessionKey = splitLayouts?.[tabId]?.focusedPaneId || tabId;
      if (action === "copyAll" && typeof onCopyAllOutput === "function") {
        onCopyAllOutput(targetSessionKey);
      } else if (
        action === "export" &&
        typeof onExportScrollback === "function"
      ) {
        onExportScrollback(targetSessionKey);
      } else {
        window.dispatchEvent(
          new CustomEvent("simpleshell:exportScrollback", {
            detail: { sessionKey: targetSessionKey, action },
          }),
        );
      }
    }
    handleTabContextMenuClose();
  };

  return (
    <Menu
      keepMounted
      open={tabContextMenu.mouseY !== null}
      onClose={handleTabContextMenuClose}
      anchorReference="anchorPosition"
      anchorPosition={
        tabContextMenu.mouseY !== null && tabContextMenu.mouseX !== null
          ? {
              top: tabContextMenu.mouseY,
              left: tabContextMenu.mouseX,
            }
          : undefined
      }
      slotProps={{
        paper: {
          style: {
            minWidth: "240px",
          },
        },
      }}
    >
      <MenuItem onClick={handleRefreshTerminal}>
        <ListItemIcon>
          <RefreshIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("tabMenu.refresh")}</ListItemText>
      </MenuItem>

      {onDuplicateTab && (
        <MenuItem
          disabled={!contextMenuTab}
          onClick={() => {
            if (contextMenuTab) onDuplicateTab(contextMenuTab.id);
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <ContentCopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("tabs.duplicate")}</ListItemText>
        </MenuItem>
      )}

      {onRenameTab && (
        <MenuItem
          disabled={!contextMenuTab}
          onClick={() => {
            if (contextMenuTab) onRenameTab(contextMenuTab.id);
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <EditIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("tabs.rename")}</ListItemText>
        </MenuItem>
      )}

      {onSplitTabRight && (
        <MenuItem
          disabled={!contextMenuTab || paneCount >= MAX_PANES}
          onClick={() => {
            if (contextMenuTab) onSplitTabRight(contextMenuTab.id);
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <VerticalSplitIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("terminal.pane.splitRight")}</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+Shift+E
          </Typography>
        </MenuItem>
      )}

      {onSplitTabBottom && (
        <MenuItem
          disabled={!contextMenuTab || paneCount >= MAX_PANES}
          onClick={() => {
            if (contextMenuTab) onSplitTabBottom(contextMenuTab.id);
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <HorizontalSplitIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("terminal.pane.splitBottom")}</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+Shift+H
          </Typography>
        </MenuItem>
      )}

      {contextMenuTab &&
        (splitLayouts[contextMenuTab.id]?.panes?.length || 0) > 1 && (
          <MenuItem onClick={handleUnsplitTab}>
            <ListItemIcon>
              <SplitscreenIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("tabMenu.unsplit")}</ListItemText>
          </MenuItem>
        )}

      <Divider />

      <MenuItem onClick={handleCloseConnection}>
        <ListItemIcon>
          <PowerOffIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("tabMenu.close")}</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+Shift+W
        </Typography>
      </MenuItem>

      {onCloseOtherTabs && (
        <MenuItem
          disabled={!canCloseOthers}
          onClick={() => {
            if (contextMenuTab) onCloseOtherTabs(contextMenuTab.id);
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <PowerOffIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("tabs.closeOthers")}</ListItemText>
        </MenuItem>
      )}

      {onCloseTabsToRight && (
        <MenuItem
          disabled={!canCloseRight}
          onClick={() => {
            if (contextMenuTab) onCloseTabsToRight(contextMenuTab.id);
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <PowerOffIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("tabs.closeRight")}</ListItemText>
        </MenuItem>
      )}

      {onReopenClosedTab && (
        <MenuItem
          disabled={!canReopenClosed}
          onClick={() => {
            onReopenClosedTab();
            handleTabContextMenuClose();
          }}
        >
          <ListItemIcon>
            <RestoreIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("tabs.reopenClosed")}</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+Shift+T
          </Typography>
        </MenuItem>
      )}

      {onToggleBroadcastBar && (
        <>
          <Divider />
          <MenuItem
            onClick={() => {
              onToggleBroadcastBar();
              handleTabContextMenuClose();
            }}
          >
            <ListItemIcon>
              <CampaignIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>
              {broadcastBarOpen
                ? t("broadcastBar.hide")
                : t("broadcastBar.show")}
            </ListItemText>
          </MenuItem>
        </>
      )}

      {contextMenuTab?.type === "ssh" && (
        <ReconnectMenuSection
          tabId={contextMenuTab.id}
          open={tabContextMenu.mouseY !== null}
          onPause={handlePauseReconnect}
          onResume={handleResumeReconnect}
        />
      )}

      {/* P1-5: Copy All Output & Scrollback Export */}
      {tabContextMenu.tabId &&
        tabContextMenu.tabId !== "welcome" && [
          <Divider key="scrollback-divider" />,
          <MenuItem
            key="copy-all-output"
            onClick={() => dispatchScrollbackAction("copyAll")}
          >
            <CopyAllIcon
              fontSize="small"
              sx={{
                mr: 1,
              }}
            />
            {t("terminal.copyAllOutput")}
          </MenuItem>,
          <MenuItem
            key="export-scrollback"
            onClick={() => dispatchScrollbackAction("export")}
          >
            <SaveAltIcon
              fontSize="small"
              sx={{
                mr: 1,
              }}
            />
            {t("terminal.exportScrollback")}
          </MenuItem>,
        ]}

      {/* 分组相关菜单项 */}
      {(() => {
        const tabId = tabContextMenu.tabId;
        if (!tabId) return null;
        const group = findGroupByTab(syncGroups, tabId);
        const groupMenuItems = [];
        if (group) {
          // 直接移动到其他分组（免去先移除再加入）
          syncGroups.forEach((g) => {
            if (g.groupId === group.groupId) return;
            groupMenuItems.push(
              <MenuItem
                key={`move-${g.groupId}`}
                onClick={() => handleJoinGroup(tabId, g.groupId)}
              >
                <DriveFileMoveOutlinedIcon
                  fontSize="small"
                  sx={{
                    mr: 1,
                    color: g.color,
                  }}
                />
                <ListItemText>{`${t("tabMenu.moveToGroup")} ${g.groupId.replace("G", "")}`}</ListItemText>
              </MenuItem>,
            );
          });
          groupMenuItems.push(
            <MenuItem
              key="remove-from-group"
              onClick={() => handleRemoveFromGroup(tabId)}
            >
              <PowerOffIcon
                fontSize="small"
                sx={{
                  color: group.color,
                  mr: 1,
                }}
              />
              <ListItemText>{`${t("tabMenu.removeFromGroup")} ${group.groupId.replace("G", "")}`}</ListItemText>
            </MenuItem>,
          );
        } else {
          syncGroups.forEach((g) => {
            groupMenuItems.push(
              <MenuItem
                key={g.groupId}
                onClick={() => handleJoinGroup(tabId, g.groupId)}
              >
                <AddIcon
                  fontSize="small"
                  sx={{
                    mr: 1,
                  }}
                />
                <ListItemText>
                  {t("tabMenu.joinGroup")} {g.groupId.replace("G", "")}
                </ListItemText>
              </MenuItem>,
            );
          });
          groupMenuItems.push(
            <MenuItem
              key="create-group"
              onClick={() => handleCreateGroup(tabId)}
            >
              <AddCircleOutlinedIcon
                fontSize="small"
                sx={{
                  mr: 1,
                }}
              />
              <ListItemText>{t("tabMenu.createGroup")}</ListItemText>
            </MenuItem>,
          );
        }
        if (groupMenuItems.length > 0) {
          return [<Divider key="group-divider-top" />, ...groupMenuItems];
        }
        return [];
      })()}
    </Menu>
  );
}
