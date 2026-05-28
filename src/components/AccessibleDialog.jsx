import * as React from "react";
import PropTypes from "prop-types";
import Dialog from "@mui/material/Dialog";

const isEditableTarget = (target) => {
  if (!target) {
    return false;
  }

  const tagName = String(target.tagName || "").toLowerCase();
  return (
    target.isContentEditable ||
    tagName === "textarea" ||
    tagName === "select" ||
    (tagName === "input" && target.type !== "button" && target.type !== "submit")
  );
};

const focusElement = (element) => {
  if (!element || typeof element.focus !== "function") {
    return;
  }

  element.focus({ preventScroll: true });
};

const AccessibleDialog = React.forwardRef(function AccessibleDialog(
  {
    open,
    children,
    onClose,
    onKeyDown,
    defaultActionRef,
    onDefaultAction,
    initialFocusRef,
    restoreFocusRef,
    slotProps,
    PaperProps,
    ...dialogProps
  },
  ref,
) {
  const previouslyFocusedRef = React.useRef(null);
  const restoreTimerRef = React.useRef(null);
  const effectiveDisableEscapeKeyDown = false;

  React.useEffect(() => {
    if (open) {
      previouslyFocusedRef.current = document.activeElement;

      if (initialFocusRef?.current) {
        window.requestAnimationFrame(() => {
          focusElement(initialFocusRef.current);
        });
      }
      return undefined;
    }

    window.clearTimeout(restoreTimerRef.current);
    restoreTimerRef.current = window.setTimeout(() => {
      focusElement(restoreFocusRef?.current || previouslyFocusedRef.current);
    }, 0);

    return undefined;
  }, [initialFocusRef, open, restoreFocusRef]);

  React.useEffect(
    () => () => {
      window.clearTimeout(restoreTimerRef.current);
    },
    [],
  );

  const handleKeyDown = React.useCallback(
    (event) => {
      if (typeof onKeyDown === "function") {
        onKeyDown(event);
      }

      if (
        event.defaultPrevented ||
        event.key !== "Enter" ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        isEditableTarget(event.target)
      ) {
        return;
      }

      if (typeof onDefaultAction === "function") {
        event.preventDefault();
        onDefaultAction(event);
        return;
      }

      if (defaultActionRef?.current) {
        event.preventDefault();
        defaultActionRef.current.click();
      }
    },
    [defaultActionRef, onDefaultAction, onKeyDown],
  );

  const mergedPaperProps = {
    ...(PaperProps || {}),
    onKeyDown: handleKeyDown,
  };

  const mergedSlotProps = {
    ...(slotProps || {}),
    paper: {
      ...(slotProps?.paper || {}),
      onKeyDown: handleKeyDown,
    },
  };

  return (
    <Dialog
      {...dialogProps}
      ref={ref}
      open={open}
      onClose={onClose}
      disableEscapeKeyDown={effectiveDisableEscapeKeyDown}
      PaperProps={mergedPaperProps}
      slotProps={mergedSlotProps}
    >
      {children}
    </Dialog>
  );
});

AccessibleDialog.propTypes = {
  children: PropTypes.node,
  defaultActionRef: PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  disableEscapeKeyDown: PropTypes.bool,
  initialFocusRef: PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  onClose: PropTypes.func,
  onDefaultAction: PropTypes.func,
  onKeyDown: PropTypes.func,
  open: PropTypes.bool.isRequired,
  PaperProps: PropTypes.object,
  restoreFocusRef: PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  slotProps: PropTypes.object,
};

export default AccessibleDialog;
