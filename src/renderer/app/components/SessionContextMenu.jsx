import * as React from "react";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import RefreshIcon from "@mui/icons-material/Refresh";
import PowerOffIcon from "@mui/icons-material/PowerOff";
import SplitscreenIcon from "@mui/icons-material/Splitscreen";
import ReconnectMenuSection from "../ReconnectMenuSection.jsx";
import { findGroupByTab } from "../../features/terminal/model/syncInputGroups";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import ListItemText from "@mui/material/ListItemText";
import AddIcon from "@mui/icons-material/Add";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import Divider from "@mui/material/Divider";

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
}) {
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
            minWidth: "200px",
          },
        },
      }}
    >
      <MenuItem onClick={handleRefreshTerminal}>
        <RefreshIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("tabMenu.refresh")}
      </MenuItem>

      <MenuItem onClick={handleCloseConnection}>
        <PowerOffIcon
          fontSize="small"
          sx={{
            mr: 1,
          }}
        />
        {t("tabMenu.close")}
      </MenuItem>

      {/* 叠加合并后的分屏标签：提供拆分恢复入口（分屏创建仅由拖拽叠加/拖入终端区触发） */}
      {contextMenuTab &&
        (splitLayouts[contextMenuTab.id]?.panes?.length || 0) > 1 && (
          <MenuItem onClick={handleUnsplitTab}>
            <SplitscreenIcon
              fontSize="small"
              sx={{
                mr: 1,
              }}
            />
            {t("tabMenu.unsplit")}
          </MenuItem>
        )}

      {contextMenuTab?.type === "ssh" && (
        <ReconnectMenuSection
          tabId={contextMenuTab.id}
          open={tabContextMenu.mouseY !== null}
          onPause={handlePauseReconnect}
          onResume={handleResumeReconnect}
        />
      )}

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
