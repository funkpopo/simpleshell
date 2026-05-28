import * as React from "react";
import PropTypes from "prop-types";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

const assertAccessibleLabel = (label) => {
  if (typeof label !== "string" || label.trim().length === 0) {
    throw new Error("AccessibleIconButton requires a non-empty translated label");
  }
};

const AccessibleIconButton = React.forwardRef(function AccessibleIconButton(
  {
    label,
    tooltip = label,
    children,
    tooltipProps,
    tooltipPlacement,
    disabled,
    ...iconButtonProps
  },
  ref,
) {
  assertAccessibleLabel(label);
  assertAccessibleLabel(tooltip);

  const button = (
    <IconButton
      {...iconButtonProps}
      ref={ref}
      aria-label={label}
      disabled={disabled}
    >
      {children}
    </IconButton>
  );

  return (
    <Tooltip
      title={tooltip}
      placement={tooltipPlacement}
      {...(tooltipProps || {})}
    >
      <span
        style={{
          display: "inline-flex",
          verticalAlign: "middle",
          pointerEvents: disabled ? "none" : undefined,
        }}
      >
        {button}
      </span>
    </Tooltip>
  );
});

AccessibleIconButton.propTypes = {
  children: PropTypes.node,
  disabled: PropTypes.bool,
  label: PropTypes.string.isRequired,
  tooltip: PropTypes.string,
  tooltipPlacement: PropTypes.oneOf([
    "bottom-end",
    "bottom-start",
    "bottom",
    "left-end",
    "left-start",
    "left",
    "right-end",
    "right-start",
    "right",
    "top-end",
    "top-start",
    "top",
  ]),
  tooltipProps: PropTypes.object,
};

export default AccessibleIconButton;
