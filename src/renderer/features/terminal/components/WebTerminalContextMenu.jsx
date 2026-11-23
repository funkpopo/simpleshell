import React from "react";
import PropTypes from "prop-types";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CopyAllIcon from "@mui/icons-material/CopyAll";
import SaveAltIcon from "@mui/icons-material/SaveAlt";
import PasteIcon from "@mui/icons-material/ContentPaste";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SearchIcon from "@mui/icons-material/Search";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import CloseIcon from "@mui/icons-material/Close";
import CloseOtherPanesIcon from "@mui/icons-material/CallToAction";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircle";
import SelectAllIcon from "@mui/icons-material/SelectAll";
import VerticalSplitIcon from "@mui/icons-material/VerticalSplit";
import HorizontalSplitIcon from "@mui/icons-material/HorizontalSplit";
import Box from "@mui/material/Box";
import { useTranslation } from "react-i18next";
import { getWebTerminalContextMenuPaperSx } from "../../../shared/ui/contextMenuStyles";

const MAX_PANES = 4;

const WebTerminalContextMenu = ({
  contextMenu,
  isActive,
  selectedText,
  paneMenu = null,
  onClosePane,
  onCloseOtherPanes,
  onSplitRight,
  onSplitBottom,
  onCreateSyncGroup,
  onJoinSyncGroup,
  onLeaveSyncGroup,
  onClose,
  onCopy,
  onCopyAllOutput,
  onExportScrollback,
  onPaste,
  onSelectAll,
  onSendToAI,
  onSearch,
  onClear,
}) => {
  const theme = useTheme();
  const { t } = useTranslation();

  const runAndClose = (fn) => () => {
    fn?.();
    onClose();
  };
  const paneCount = paneMenu?.paneCount || 1;

  return (
    // transitionDuration=0 / disableAutoFocusItem / disableScrollLock:
    // 默认的关闭过渡动画叠加菜单 Paper 的 backdrop-filter 模糊,在 Electron 下会留下
    // 残影遮罩与菜单项高亮;与 FileManager 右键菜单保持一致,立即关闭可避免残留。
    <Menu
      slotProps={{
        paper: {
          sx: getWebTerminalContextMenuPaperSx(theme),
        },
      }}
      open={contextMenu !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu !== null
          ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
          : undefined
      }
      transitionDuration={0}
      disableAutoFocusItem
      disableScrollLock
    >
      <MenuItem onClick={onCopy} disabled={!selectedText}>
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("webTerminal.contextMenu.copy")}</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+; / Ctrl+Shift+C
        </Typography>
      </MenuItem>
      <MenuItem onClick={onPaste}>
        <ListItemIcon>
          <PasteIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("webTerminal.contextMenu.paste")}</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          {t("webTerminal.contextMenu.pasteShortcut")}
        </Typography>
      </MenuItem>
      {onSelectAll && (
        <MenuItem onClick={onSelectAll}>
          <ListItemIcon>
            <SelectAllIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("webTerminal.contextMenu.selectAll")}</ListItemText>
        </MenuItem>
      )}
      <MenuItem onClick={onSendToAI}>
        <ListItemIcon>
          <SmartToyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>
          {selectedText
            ? t("webTerminal.contextMenu.sendToAI")
            : t("terminal.explainRecentOutput")}
        </ListItemText>
      </MenuItem>
      <Divider />
      {isActive && (
        <MenuItem onClick={onSearch}>
          <ListItemIcon>
            <SearchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("webTerminal.contextMenu.search")}</ListItemText>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
            Ctrl+/
          </Typography>
        </MenuItem>
      )}
      <Divider />
      <MenuItem onClick={onClear}>
        <ListItemIcon>
          <ClearAllIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("webTerminal.contextMenu.clear")}</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+L
        </Typography>
      </MenuItem>
      {/* P1-5: Copy All Output & Scrollback Export */}
      <MenuItem onClick={onCopyAllOutput}>
        <ListItemIcon>
          <CopyAllIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("terminal.copyAllOutput")}</ListItemText>
      </MenuItem>
      <MenuItem onClick={onExportScrollback}>
        <ListItemIcon>
          <SaveAltIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("terminal.exportScrollback")}</ListItemText>
      </MenuItem>

      {/* 窗格管理（支持快捷键/右键分屏与关闭） */}
      <Divider />
      <MenuItem
        onClick={runAndClose(() => onSplitRight?.())}
        disabled={paneCount >= MAX_PANES || !onSplitRight}
      >
        <ListItemIcon>
          <VerticalSplitIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("terminal.pane.splitRight")}</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+Shift+E
        </Typography>
      </MenuItem>
      <MenuItem
        onClick={runAndClose(() => onSplitBottom?.())}
        disabled={paneCount >= MAX_PANES || !onSplitBottom}
      >
        <ListItemIcon>
          <HorizontalSplitIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("terminal.pane.splitBottom")}</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+Shift+H
        </Typography>
      </MenuItem>
      {paneMenu?.isInSplit ? (
        <>
          <MenuItem
            onClick={runAndClose(() => onCloseOtherPanes?.())}
            disabled={paneCount <= 1}
          >
            <ListItemIcon>
              <CloseOtherPanesIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("terminal.pane.closeOtherPanes")}</ListItemText>
          </MenuItem>
          <MenuItem onClick={runAndClose(() => onClosePane?.())}>
            <ListItemIcon>
              <CloseIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{t("terminal.pane.closePane")}</ListItemText>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
              Ctrl+Shift+W
            </Typography>
          </MenuItem>
        </>
      ) : null}

      {/* 同步输入分组：窗格可作为分组成员（paneId 透传） */}
      <Divider />
      {paneMenu?.currentGroupId ? (
        <MenuItem onClick={runAndClose(() => onLeaveSyncGroup?.())}>
          <ListItemIcon>
            <RemoveCircleOutlineIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{t("tabMenu.removeFromGroup")}</ListItemText>
        </MenuItem>
      ) : null}
      {(paneMenu?.syncGroups || []).map((group) =>
        group.groupId === paneMenu?.currentGroupId ? null : (
          <MenuItem
            key={group.groupId}
            onClick={runAndClose(() => onJoinSyncGroup?.(group.groupId))}
          >
            <ListItemIcon>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  bgcolor: group.color,
                }}
              />
            </ListItemIcon>
            <ListItemText>{`${t("tabMenu.joinGroup")} ${group.groupId}`}</ListItemText>
          </MenuItem>
        ),
      )}
      <MenuItem onClick={runAndClose(() => onCreateSyncGroup?.())}>
        <ListItemIcon>
          <AddCircleOutlinedIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>{t("tabMenu.createGroup")}</ListItemText>
      </MenuItem>
    </Menu>
  );
};

WebTerminalContextMenu.propTypes = {
  contextMenu: PropTypes.shape({
    mouseX: PropTypes.number.isRequired,
    mouseY: PropTypes.number.isRequired,
  }),
  isActive: PropTypes.bool,
  selectedText: PropTypes.string,
  paneMenu: PropTypes.shape({
    isInSplit: PropTypes.bool,
    paneCount: PropTypes.number,
    syncGroups: PropTypes.array,
    currentGroupId: PropTypes.string,
  }),
  onClosePane: PropTypes.func,
  onCloseOtherPanes: PropTypes.func,
  onSplitRight: PropTypes.func,
  onSplitBottom: PropTypes.func,
  onCreateSyncGroup: PropTypes.func,
  onJoinSyncGroup: PropTypes.func,
  onLeaveSyncGroup: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
  onCopyAllOutput: PropTypes.func,
  onExportScrollback: PropTypes.func,
  onPaste: PropTypes.func.isRequired,
  onSelectAll: PropTypes.func,
  onSendToAI: PropTypes.func.isRequired,
  onSearch: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
};

export default React.memo(WebTerminalContextMenu);
