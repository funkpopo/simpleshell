import React, {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
    const [open, setOpen] = useState(false);
    const title = useMemo(
      () => getPrimitiveText(tooltipTitle) || getPrimitiveText(children),
      [children, tooltipTitle],
    );

    const isOverflowing = useCallback(() => {
      const node = textRef.current;
      return Boolean(title && node && node.scrollWidth > node.clientWidth + 1);
    }, [title]);

    const openIfOverflowing = useCallback(() => {
      setOpen(isOverflowing());
    }, [isOverflowing]);

    const handleMouseEnter = useCallback(
      (event) => {
        openIfOverflowing();
        onMouseEnter?.(event);
      },
      [onMouseEnter, openIfOverflowing],
    );

    const handleMouseLeave = useCallback(
      (event) => {
        setOpen(false);
        onMouseLeave?.(event);
      },
      [onMouseLeave],
    );

    const handleFocus = useCallback(
      (event) => {
        openIfOverflowing();
        onFocus?.(event);
      },
      [onFocus, openIfOverflowing],
    );

    const handleBlur = useCallback(
      (event) => {
        setOpen(false);
        onBlur?.(event);
      },
      [onBlur],
    );

    useEffect(() => {
      setOpen(false);
    }, [title]);

    return (
      <Tooltip
        {...tooltipProps}
        title={title}
        open={Boolean(open && title)}
        disableHoverListener
        disableFocusListener
        disableTouchListener
      >
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
