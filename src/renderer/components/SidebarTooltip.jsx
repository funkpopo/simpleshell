import * as React from "react";
import PropTypes from "prop-types";
import Tooltip from "@mui/material/Tooltip";

/** 侧边栏图标：悬停显示，移开或超过此时长后隐藏 */
const SIDEBAR_TOOLTIP_MAX_MS = 1700;

function SidebarTooltip({ children, ...tooltipProps }) {
  const [open, setOpen] = React.useState(false);
  const timerRef = React.useRef(null);

  const clearTimer = React.useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => () => clearTimer(), [clearTimer]);

  const onEnter = React.useCallback(() => {
    clearTimer();
    setOpen(true);
    timerRef.current = window.setTimeout(() => {
      setOpen(false);
      timerRef.current = null;
    }, SIDEBAR_TOOLTIP_MAX_MS);
  }, [clearTimer]);

  const onLeave = React.useCallback(() => {
    clearTimer();
    setOpen(false);
  }, [clearTimer]);

  return (
    <Tooltip
      {...tooltipProps}
      open={open}
      disableHoverListener
      disableFocusListener
      disableTouchListener
      leaveDelay={0}
      enterDelay={0}
      enterNextDelay={0}
    >
      <span
        style={{ display: "inline-flex", verticalAlign: "middle" }}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
      >
        {children}
      </span>
    </Tooltip>
  );
}

SidebarTooltip.propTypes = {
  children: PropTypes.node,
};

export default SidebarTooltip;
