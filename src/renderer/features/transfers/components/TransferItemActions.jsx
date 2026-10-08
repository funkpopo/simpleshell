import { memo, useState } from "react";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Tooltip from "@mui/material/Tooltip";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import CloseIcon from "@mui/icons-material/Close";
import PauseIcon from "@mui/icons-material/Pause";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { getDangerHoverSx } from "../transferStatusStyles.jsx";

/**
 * 传输条目共享操作按钮组。回调签名统一为 (transfer) / (transfer, algorithm)，
 * 各宿主（TransferTag / TransferItemCard）按需组合。
 */

/** 删除按钮（危险色 hover）。size 控制按钮盒，iconSize 控制图标。
 *  variant: "record"（删除历史记录）| "delete"（删除任务）——静态 i18n 键。 */
export const TransferDeleteButton = memo(
  ({
    transfer,
    onDelete,
    variant = "record",
    size = 20,
    iconSize = 14,
    sx,
  }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    if (typeof onDelete !== "function") return null;
    return (
      <Tooltip
        title={
          variant === "delete"
            ? t("fileManager.transfer.delete")
            : t("fileManager.transfer.deleteRecord")
        }
      >
        <IconButton
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(transfer);
          }}
          aria-label={
            variant === "delete"
              ? t("fileManager.transfer.delete")
              : t("fileManager.transfer.deleteRecord")
          }
          sx={{
            width: size,
            height: size,
            color: theme.palette.text.secondary,
            ...getDangerHoverSx(theme),
            ...sx,
          }}
        >
          <CloseIcon sx={{ fontSize: iconSize }} />
        </IconButton>
      </Tooltip>
    );
  },
);
TransferDeleteButton.displayName = "TransferDeleteButton";

/**
 * 取消/终止按钮。variant: "pause"（侧栏，Pause 图标）| "stop"（浮窗，Close 图标）。
 */
export const TransferCancelButton = memo(
  ({ transfer, onCancel, variant = "pause", size = 20, iconSize = 14, sx }) => {
    const theme = useTheme();
    const { t } = useTranslation();
    if (typeof onCancel !== "function") return null;
    return (
      <Tooltip
        title={
          variant === "stop"
            ? t("fileManager.transfer.stop")
            : t("fileManager.transfer.pause")
        }
      >
        <IconButton
          size="small"
          onClick={() => onCancel(transfer)}
          aria-label={
            variant === "stop"
              ? t("fileManager.transfer.stop")
              : t("fileManager.transfer.pause")
          }
          sx={{
            width: size,
            height: size,
            color: theme.palette.text.secondary,
            ...getDangerHoverSx(theme),
            ...sx,
          }}
        >
          {variant === "stop" ? (
            <CloseIcon sx={{ fontSize: iconSize }} />
          ) : (
            <PauseIcon sx={{ fontSize: iconSize }} />
          )}
        </IconButton>
      </Tooltip>
    );
  },
);
TransferCancelButton.displayName = "TransferCancelButton";

/** 校验算法选择菜单（MoreVert 按钮 + sha256/md5 菜单），内部管理 anchor 状态。 */
export const TransferVerifyMenu = memo(({ transfer, onVerify }) => {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState(null);
  if (typeof onVerify !== "function") return null;
  return (
    <>
      <Tooltip title={t("fileManager.transfer.taskOptions")}>
        <IconButton
          size="small"
          aria-label={t("fileManager.transfer.taskOptions")}
          onClick={(event) => setMenuAnchor(event.currentTarget)}
        >
          <MoreVertIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={() => setMenuAnchor(null)}
      >
        {["sha256", "md5"].map((algorithm) => (
          <MenuItem
            key={algorithm}
            onClick={() => {
              setMenuAnchor(null);
              onVerify(transfer, algorithm);
            }}
          >
            {t("fileManager.transfer.verifyThisTask", {
              algorithm: algorithm.toUpperCase(),
            })}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
});
TransferVerifyMenu.displayName = "TransferVerifyMenu";

/** 展开/折叠按钮（文件列表）。 */
export const TransferExpandButton = memo(
  ({ expanded, onToggle, size = 20, iconSize = 16 }) => {
    const { t } = useTranslation();
    return (
      <Tooltip
        title={
          expanded
            ? t("fileManager.transfer.collapseDetails")
            : t("fileManager.transfer.viewDetails")
        }
      >
        <IconButton
          size="small"
          onClick={onToggle}
          aria-label={
            expanded
              ? t("fileManager.transfer.collapseDetails")
              : t("fileManager.transfer.viewDetails")
          }
          sx={{ width: size, height: size, p: 0 }}
        >
          {expanded ? (
            <ExpandLessIcon sx={{ fontSize: iconSize }} />
          ) : (
            <ExpandMoreIcon sx={{ fontSize: iconSize }} />
          )}
        </IconButton>
      </Tooltip>
    );
  },
);
TransferExpandButton.displayName = "TransferExpandButton";
