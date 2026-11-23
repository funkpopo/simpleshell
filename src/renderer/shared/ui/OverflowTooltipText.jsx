import React, { memo, useRef, useState } from "react";
import PropTypes from "prop-types";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";

const DEFAULT_TEXT_SX = {
  display: "block",
  minWidth: 0,
  maxWidth: "100%",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const getPrimitiveText = (value) => {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
};

const OverflowTooltipText = memo(
  ({
    children,
    component = "span",
    onBlur,
    onFocus,
    onMouseEnter,
    onMouseLeave,
    sx,
    tooltipProps,
    tooltipTitle,
    variant = "body2",
    ...typographyProps
  }) => {
    const textRef = useRef(null);
    const [openTitle, setOpenTitle] = useState(null);
    const title = getPrimitiveText(tooltipTitle) || getPrimitiveText(children);
    const open = Boolean(title && openTitle === title);

    const openIfOverflowing = () => {
      const node = textRef.current;
      const overflowing = Boolean(
        title && node && node.scrollWidth > node.clientWidth + 1,
      );
      if (overflowing) {
        setOpenTitle(title);
      }
    };

    const handleMouseEnter = (event) => {
      openIfOverflowing();
      onMouseEnter?.(event);
    };

    const handleMouseLeave = (event) => {
      if (openTitle !== null) {
        setOpenTitle(null);
      }
      onMouseLeave?.(event);
    };

    const handleFocus = (event) => {
      openIfOverflowing();
      onFocus?.(event);
    };

    const handleBlur = (event) => {
      if (openTitle !== null) {
        setOpenTitle(null);
      }
      onBlur?.(event);
    };

    const textNode = (
      <Typography
        {...typographyProps}
        ref={textRef}
        component={component}
        variant={variant}
        noWrap
        sx={[DEFAULT_TEXT_SX, ...(Array.isArray(sx) ? sx : [sx])]}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        {children}
      </Typography>
    );

    if (!open || !title) {
      return textNode;
    }

    return (
      <Tooltip
        {...tooltipProps}
        title={title}
        open
        disableHoverListener
        disableFocusListener
        disableTouchListener
      >
        {textNode}
      </Tooltip>
    );
  },
);

OverflowTooltipText.displayName = "OverflowTooltipText";

OverflowTooltipText.propTypes = {
  children: PropTypes.node,
  component: PropTypes.elementType,
  onBlur: PropTypes.func,
  onFocus: PropTypes.func,
  onMouseEnter: PropTypes.func,
  onMouseLeave: PropTypes.func,
  sx: PropTypes.oneOfType([PropTypes.array, PropTypes.func, PropTypes.object]),
  tooltipProps: PropTypes.object,
  tooltipTitle: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  variant: PropTypes.string,
};

export default OverflowTooltipText;
