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
import PasteIcon from "@mui/icons-material/ContentPaste";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import SearchIcon from "@mui/icons-material/Search";
import SmartToyIcon from "@mui/icons-material/SmartToy";

const WebTerminalContextMenu = ({
  contextMenu,
  isActive,
  selectedText,
  onClose,
  onCopy,
  onPaste,
  onSendToAI,
  onSearch,
  onClear,
}) => {
  const theme = useTheme();

  return (
    <Menu
      open={contextMenu !== null}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        contextMenu !== null
          ? { top: contextMenu.mouseY, left: contextMenu.mouseX }
          : undefined
      }
      PaperProps={{
        sx: {
          boxShadow: theme.shadows[8],
          bgcolor: "background.paper",
          color: "text.primary",
        },
      }}
    >
      <MenuItem onClick={onCopy} disabled={!selectedText}>
        <ListItemIcon>
          <ContentCopyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>复制</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+;
        </Typography>
      </MenuItem>
      <MenuItem onClick={onPaste}>
        <ListItemIcon>
          <PasteIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>粘贴</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+&apos; / 中键
        </Typography>
      </MenuItem>
      <MenuItem onClick={onSendToAI} disabled={!selectedText}>
        <ListItemIcon>
          <SmartToyIcon fontSize="small" />
        </ListItemIcon>
        <ListItemText>发送到AI助手</ListItemText>
      </MenuItem>
      <Divider />
      {isActive && (
        <MenuItem onClick={onSearch}>
          <ListItemIcon>
            <SearchIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>搜索</ListItemText>
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
        <ListItemText>清空</ListItemText>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 2 }}>
          Ctrl+L
        </Typography>
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
  onClose: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
  onPaste: PropTypes.func.isRequired,
  onSendToAI: PropTypes.func.isRequired,
  onSearch: PropTypes.func.isRequired,
  onClear: PropTypes.func.isRequired,
};

export default React.memo(WebTerminalContextMenu);
