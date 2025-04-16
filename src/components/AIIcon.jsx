import * as React from "react";
import brainSvg from "../assets/brain.svg";

function AIIcon(props) {
  return (
    <img
      src={brainSvg}
      alt="AI Assistant"
      style={{
        width:
          props.fontSize === "large"
            ? "32px"
            : props.fontSize === "small"
              ? "16px"
              : "24px",
        height:
          props.fontSize === "large"
            ? "32px"
            : props.fontSize === "small"
              ? "16px"
              : "24px",
        filter:
          props.color === "primary"
            ? "none"
            : `brightness(${props.color === "disabled" ? 0.5 : 1})`,
        opacity: props.color === "disabled" ? 0.5 : 1,
      }}
      {...props}
    />
  );
}

export default AIIcon;
