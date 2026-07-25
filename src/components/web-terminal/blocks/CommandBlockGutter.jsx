import React, { memo, useCallback, useState } from "react";
import PropTypes from "prop-types";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ReplayIcon from "@mui/icons-material/Replay";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import { useTranslation } from "react-i18next";
import { COMMAND_BLOCK_STATUS } from "./commandBlockModel.js";

const statusClassName = (status) => {
  switch (status) {
    case COMMAND_BLOCK_STATUS.RUNNING:
      return "command-block-gutter__dot--running";
    case COMMAND_BLOCK_STATUS.SUCCESS:
      return "command-block-gutter__dot--success";
    case COMMAND_BLOCK_STATUS.FAILED:
      return "command-block-gutter__dot--failed";
    case COMMAND_BLOCK_STATUS.CANCELLED:
      return "command-block-gutter__dot--cancelled";
    default:
      return "command-block-gutter__dot--unknown";
  }
};

const CommandBlockGutterItem = memo(function CommandBlockGutterItem({
  item,
  onToggleFold,
  onCopy,
  onRerun,
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [copyFlash, setCopyFlash] = useState(false);

  const handleCopy = useCallback(
    async (event) => {
      event.preventDefault();
      event.stopPropagation();
      const ok = await onCopy(item.command);
      if (ok) {
        setCopyFlash(true);
        window.setTimeout(() => setCopyFlash(false), 900);
      }
    },
    [item.command, onCopy],
  );

  const handleRerun = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onRerun(item.command);
    },
    [item.command, onRerun],
  );

  const handleFold = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      onToggleFold(item.id);
    },
    [item.id, onToggleFold],
  );

  let statusLabel = t("webTerminal.commandBlocks.status.unknown");
  if (item.status === COMMAND_BLOCK_STATUS.RUNNING) {
    statusLabel = t("webTerminal.commandBlocks.status.running");
  } else if (item.status === COMMAND_BLOCK_STATUS.SUCCESS) {
    statusLabel = t("webTerminal.commandBlocks.status.success");
  } else if (item.status === COMMAND_BLOCK_STATUS.FAILED) {
    statusLabel = t("webTerminal.commandBlocks.status.failed");
  } else if (item.status === COMMAND_BLOCK_STATUS.CANCELLED) {
    statusLabel = t("webTerminal.commandBlocks.status.cancelled");
  }

  return (
    <div
      className={`command-block-gutter__item${hovered ? " is-hovered" : ""}${
        item.isActive ? " is-active" : ""
      }${item.folded ? " is-folded" : ""}`}
      style={{
        top: `${Math.round(item.top)}px`,
        height: `${Math.max(14, Math.round(item.height))}px`,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-block-id={item.id}
      data-block-status={item.status}
    >
      {!item.folded && item.spanHeight > item.height + 2 ? (
        <div
          className="command-block-gutter__span"
          style={{ height: `${Math.round(item.spanHeight)}px` }}
          aria-hidden
        />
      ) : null}

      <Tooltip title={statusLabel} placement="right" enterDelay={400}>
        <span
          className={`command-block-gutter__dot ${statusClassName(item.status)}`}
          aria-label={statusLabel}
        />
      </Tooltip>

      {(hovered || item.isActive) && (
        <div className="command-block-gutter__actions">
          <Tooltip
            title={t("webTerminal.commandBlocks.fold")}
            placement="right"
          >
            <IconButton
              size="small"
              className="command-block-gutter__btn"
              onClick={handleFold}
              aria-label={t("webTerminal.commandBlocks.fold")}
              tabIndex={-1}
            >
              {item.folded ? (
                <UnfoldMoreIcon fontSize="inherit" />
              ) : (
                <UnfoldLessIcon fontSize="inherit" />
              )}
            </IconButton>
          </Tooltip>
          <Tooltip
            title={
              copyFlash
                ? t("webTerminal.commandBlocks.copied")
                : t("webTerminal.commandBlocks.copy")
            }
            placement="right"
          >
            <IconButton
              size="small"
              className="command-block-gutter__btn"
              onClick={handleCopy}
              aria-label={t("webTerminal.commandBlocks.copy")}
              tabIndex={-1}
            >
              <ContentCopyIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
          <Tooltip
            title={t("webTerminal.commandBlocks.rerun")}
            placement="right"
          >
            <IconButton
              size="small"
              className="command-block-gutter__btn"
              onClick={handleRerun}
              aria-label={t("webTerminal.commandBlocks.rerun")}
              tabIndex={-1}
              disabled={item.status === COMMAND_BLOCK_STATUS.RUNNING}
            >
              <ReplayIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </div>
      )}
    </div>
  );
});

CommandBlockGutterItem.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    command: PropTypes.string,
    status: PropTypes.string,
    folded: PropTypes.bool,
    top: PropTypes.number,
    height: PropTypes.number,
    spanHeight: PropTypes.number,
    isActive: PropTypes.bool,
  }).isRequired,
  onToggleFold: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
  onRerun: PropTypes.func.isRequired,
};

function CommandBlockGutter({
  items,
  hidden,
  onToggleFold,
  onCopy,
  onRerun,
}) {
  if (hidden || !items?.length) {
    return null;
  }

  return (
    <div className="command-block-gutter" aria-hidden={false}>
      {items.map((item) => (
        <CommandBlockGutterItem
          key={item.id}
          item={item}
          onToggleFold={onToggleFold}
          onCopy={onCopy}
          onRerun={onRerun}
        />
      ))}
    </div>
  );
}

CommandBlockGutter.propTypes = {
  items: PropTypes.arrayOf(PropTypes.object),
  hidden: PropTypes.bool,
  onToggleFold: PropTypes.func.isRequired,
  onCopy: PropTypes.func.isRequired,
  onRerun: PropTypes.func.isRequired,
};

CommandBlockGutter.defaultProps = {
  items: [],
  hidden: false,
};

export default memo(CommandBlockGutter);
