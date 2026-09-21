import * as React from "react";
import brainSvg from "../assets/brain.svg";
import { useTranslation } from "react-i18next";

function AIIcon(props) {
  const { t } = useTranslation();
  const { className = "", style, fontSize, color, ...imageProps } = props;
  return (
    <img
      src={brainSvg}
      alt={t("sidebar.ai")}
      className={`ai-icon ${className}`.trim()}
      style={{
        width:
          fontSize === "large"
            ? "32px"
            : fontSize === "small"
              ? "16px"
              : "24px",
        height:
          fontSize === "large"
            ? "32px"
            : fontSize === "small"
              ? "16px"
              : "24px",
        opacity: color === "disabled" ? 0.5 : 1,
        ...style,
      }}
      {...imageProps}
    />
  );
}

export default AIIcon;
