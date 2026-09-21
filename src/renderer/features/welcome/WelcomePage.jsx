import React, { memo, useCallback } from "react";
import { Box, Button, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

const MONO_FONT =
  '"Space Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

const DAY_PLANET_POINTS = {
  n1: [18.2, 28.4],
  n2: [37.6, 31.2],
  n3: [51.4, 38.6],
  n4: [24.8, 43.1],
  n5: [43.5, 48.7],
  n6: [14.6, 57.4],
  n7: [34.1, 61.6],
  n8: [53.6, 58.3],
  n9: [27.8, 71.4],
  n10: [46.2, 68.7],
};

const DAY_PLANET_NODE_SCALES = {
  n1: 0.72,
  n2: 0.96,
  n3: 0.82,
  n4: 0.68,
  n5: 1,
  n6: 0.76,
  n7: 0.91,
  n8: 0.7,
  n9: 0.84,
  n10: 0.98,
};

const DAY_PLANET_NODES = Object.entries(DAY_PLANET_POINTS).map(
  ([id, [x, y]]) => ({
    id,
    x: `${x}%`,
    y: `${y}%`,
    scale: DAY_PLANET_NODE_SCALES[id],
  }),
);

const DAY_PLANET_MERIDIANS = [45, 37, 29, 21, 13, 6];

const DAY_PLANET_LATITUDES = [
  "M 15 18 C 32 27, 68 27, 85 18",
  "M 6 28 C 27 38, 73 38, 94 28",
  "M 2 39 C 27 45, 73 45, 98 39",
  "M 1 50 C 28 50, 72 50, 99 50",
  "M 2 61 C 27 55, 73 55, 98 61",
  "M 6 72 C 27 62, 73 62, 94 72",
  "M 15 82 C 32 73, 68 73, 85 82",
  "M 10 23 C 29 32, 71 32, 90 23",
  "M 3.5 34 C 27 42, 73 42, 96.5 34",
  "M 3.5 66 C 27 58, 73 58, 96.5 66",
  "M 10 77 C 29 68, 71 68, 90 77",
];

const DAY_PLANET_ROUTE_DURATION = "28s";

const toFixed = (value) => Number(value.toFixed(2));

const latitudeHop = (from, to) => {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const bulge = (50 - (y1 + y2) / 2) * 0.042;
  return `M ${x1} ${y1} C ${toFixed(x1 + (x2 - x1) / 3)} ${toFixed(y1 + (y2 - y1) / 3 + bulge * 0.55)}, ${toFixed(x1 + ((x2 - x1) * 2) / 3)} ${toFixed(y1 + ((y2 - y1) * 2) / 3 + bulge)}, ${x2} ${y2}`;
};

const meridianHop = (from, to, radius) =>
  `M ${from[0]} ${from[1]} A ${radius} 49 0 0 0 ${to[0]} ${to[1]}`;

const DAY_PLANET_ROUTES = [
  {
    id: "upper-sweep",
    d: latitudeHop(DAY_PLANET_POINTS.n1, DAY_PLANET_POINTS.n2),
    from: DAY_PLANET_POINTS.n1,
    to: DAY_PLANET_POINTS.n2,
    delay: "-1.2s",
  },
  {
    id: "north-east-link",
    d: latitudeHop(DAY_PLANET_POINTS.n2, DAY_PLANET_POINTS.n3),
    from: DAY_PLANET_POINTS.n2,
    to: DAY_PLANET_POINTS.n3,
    delay: "-3.4s",
  },
  {
    id: "western-arc",
    d: meridianHop(DAY_PLANET_POINTS.n1, DAY_PLANET_POINTS.n4, 39),
    from: DAY_PLANET_POINTS.n1,
    to: DAY_PLANET_POINTS.n4,
    delay: "-5.6s",
  },
  {
    id: "central-crossing",
    d: latitudeHop(DAY_PLANET_POINTS.n4, DAY_PLANET_POINTS.n5),
    from: DAY_PLANET_POINTS.n4,
    to: DAY_PLANET_POINTS.n5,
    delay: "-7.8s",
  },
  {
    id: "eastern-drop",
    d: meridianHop(DAY_PLANET_POINTS.n3, DAY_PLANET_POINTS.n8, 8),
    from: DAY_PLANET_POINTS.n3,
    to: DAY_PLANET_POINTS.n8,
    delay: "-10s",
  },
  {
    id: "southern-link",
    d: latitudeHop(DAY_PLANET_POINTS.n7, DAY_PLANET_POINTS.n10),
    from: DAY_PLANET_POINTS.n7,
    to: DAY_PLANET_POINTS.n10,
    delay: "-12.2s",
  },
  {
    id: "lower-west-arc",
    d: meridianHop(DAY_PLANET_POINTS.n6, DAY_PLANET_POINTS.n9, 35),
    from: DAY_PLANET_POINTS.n6,
    to: DAY_PLANET_POINTS.n9,
    delay: "-14.4s",
  },
  {
    id: "diagonal-transfer",
    d: latitudeHop(DAY_PLANET_POINTS.n5, DAY_PLANET_POINTS.n10),
    from: DAY_PLANET_POINTS.n5,
    to: DAY_PLANET_POINTS.n10,
    delay: "-16.6s",
  },
];

const dayRouteVars = (route) => ({
  "--route-delay": route.delay,
  "--route-duration": DAY_PLANET_ROUTE_DURATION,
});

const WelcomePage = ({
  topConnections,
  onOpenConnection,
  onCreateConnection,
}) => {
  const { t } = useTranslation();
  const hasConnections = Boolean(topConnections?.length);

  const handleOpenConnection = useCallback(
    (connection) => onOpenConnection?.(connection),
    [onOpenConnection],
  );

  return (
    <Box
      component="main"
      aria-label={t("welcome.title")}
      sx={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "auto",
        isolation: "isolate",
        bgcolor: "background.default",
        color: "text.primary",
        "& .welcome-background": {
          position: "fixed",
          zIndex: 0,
          pointerEvents: "none",
          userSelect: "none",
          contain: "layout style",
          transform: "translateZ(0)",
          backfaceVisibility: "hidden",
        },
        "& .welcome-background--day-atmosphere": {
          inset: 0,
          opacity: 0,
          background:
            "radial-gradient(ellipse 68% 72% at 101% -8%, var(--welcome-day-solar-bloom) 0%, var(--welcome-day-solar-haze) 35%, transparent 72%), radial-gradient(ellipse 42% 45% at 82% 80%, var(--welcome-day-ambient-haze) 0%, transparent 82%), linear-gradient(120deg, transparent 18%, var(--welcome-day-plane-wash) 56%, transparent 82%)",
          transition: "opacity 420ms cubic-bezier(0.2, 0, 0, 1)",
        },
        "& .welcome-background--particles": {
          inset: -24,
          opacity: 0.34,
          backgroundImage:
            "radial-gradient(circle at 12% 18%, var(--welcome-particle-color) 0 0.7px, transparent 1px), radial-gradient(circle at 73% 31%, var(--welcome-particle-color) 0 0.6px, transparent 0.9px), radial-gradient(circle at 38% 76%, var(--welcome-particle-color) 0 0.65px, transparent 1px)",
          backgroundSize: "137px 149px, 193px 181px, 229px 211px",
          animation:
            "welcome-particles var(--particle-speed, 0.6s) linear infinite alternate",
          willChange: "transform",
        },
        "& .welcome-background--day-orbits": {
          display: "none",
          width: { xs: 570, sm: 760, md: 1040 },
          height: { xs: 440, sm: 560, md: 740 },
          right: { xs: -302, sm: -347, md: -369 },
          top: { xs: 74, sm: "7%", md: "4%" },
          overflow: "visible",
          color: "var(--welcome-day-orbit-line)",
          transformOrigin: "52% 50%",
          animation:
            "welcome-day-orbit-drift 26s cubic-bezier(0.37, 0, 0.18, 1) infinite alternate",
          willChange: "transform",
          "& .welcome-day-orbit__arc": {
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1,
            vectorEffect: "non-scaling-stroke",
          },
          "& .welcome-day-orbit__arc--fine": {
            opacity: 0.44,
            strokeDasharray: "3 8",
          },
          "& .welcome-day-orbit__arc--strong": {
            stroke: "var(--welcome-day-orbit-line-strong)",
            strokeWidth: 1.25,
          },
          "& .welcome-day-orbit__axis": {
            fill: "none",
            stroke: "var(--welcome-day-orbit-axis)",
            strokeWidth: 1,
            strokeDasharray: "2 10",
            vectorEffect: "non-scaling-stroke",
          },
          "& .welcome-day-orbit__marker-ring": {
            fill: "var(--welcome-day-marker-field)",
            stroke: "var(--welcome-day-orbit-line-strong)",
            strokeWidth: 1,
            vectorEffect: "non-scaling-stroke",
          },
          "& .welcome-day-orbit__marker": {
            fill: "var(--welcome-day-marker)",
            transformBox: "fill-box",
            transformOrigin: "center",
            animation: "welcome-day-beacon 5.6s ease-in-out infinite",
          },
        },
        "& .welcome-background--planet": {
          width: { xs: 390, sm: 500, md: 680 },
          height: { xs: 390, sm: 500, md: 680 },
          right: { xs: -290, sm: -320, md: -330 },
          top: { xs: 92, sm: "12%", md: "11%" },
          overflow: "visible",
          borderRadius: "50%",
          background:
            "radial-gradient(circle at 27% 24%, var(--welcome-planet-highlight) 0%, var(--welcome-planet-mid) 21%, var(--welcome-planet-shadow) 56%, var(--welcome-planet-core) 78%)",
          boxShadow:
            "inset 26px 20px 58px var(--welcome-planet-inner-light), inset -64px -36px 96px var(--welcome-planet-inner-shadow), -8px -2px 18px var(--welcome-planet-rim), -20px -4px 54px var(--welcome-planet-atmosphere), -44px -8px 118px var(--welcome-planet-haze)",
          animation:
            "welcome-planet-drift var(--glow-speed, 18s) ease-in-out infinite alternate",
          willChange: "transform",
          "&::before": {
            content: '""',
            position: "absolute",
            inset: -2,
            borderRadius: "inherit",
            background:
              "conic-gradient(from 166deg, transparent 0deg 94deg, var(--welcome-planet-rim) 116deg, var(--welcome-planet-flare) 142deg, var(--welcome-planet-rim) 165deg, transparent 198deg 360deg)",
            filter: "blur(2px)",
            opacity: 0.96,
            maskImage:
              "radial-gradient(circle, transparent 0 70%, #000 70.6% 71.7%, transparent 72.4%)",
            WebkitMaskImage:
              "radial-gradient(circle, transparent 0 70%, #000 70.6% 71.7%, transparent 72.4%)",
            transformOrigin: "center",
            animation: "welcome-edge-light-shift 22s ease-in-out infinite",
            willChange: "transform, opacity, filter",
          },
        },
        "& .welcome-planet__rim-light": {
          position: "absolute",
          borderRadius: "50%",
          maskImage:
            "radial-gradient(circle, transparent 0 69.8%, #000 70.5% 72%, transparent 72.8%)",
          WebkitMaskImage:
            "radial-gradient(circle, transparent 0 69.8%, #000 70.5% 72%, transparent 72.8%)",
          transformOrigin: "center",
        },
        "& .welcome-planet__rim-light--secondary": {
          inset: -9,
          background:
            "conic-gradient(from 24deg, transparent 0deg 168deg, var(--welcome-corona-soft) 184deg, var(--welcome-planet-flare) 192deg, transparent 207deg 360deg)",
          filter: "blur(6px) drop-shadow(0 0 14px var(--welcome-planet-haze))",
          opacity: 0.56,
          animation: "welcome-rim-orbit-reverse 17s linear infinite",
        },
        "& .welcome-planet__rays": {
          position: "absolute",
          zIndex: -2,
          width: "72%",
          height: "66%",
          left: "-52%",
          top: "-17%",
          transformOrigin: "100% 100%",
          background:
            "conic-gradient(from 112deg at 100% 100%, transparent 0deg 5deg, var(--welcome-ray-soft) 8deg, var(--welcome-ray-light) 10deg, transparent 14deg 19deg, var(--welcome-ray-soft) 22deg, transparent 27deg 32deg, var(--welcome-ray-light) 34deg, transparent 38deg 360deg)",
          filter: "blur(6px)",
          opacity: 0.54,
          maskImage:
            "radial-gradient(circle at 100% 100%, #000 0%, rgba(0, 0, 0, 0.92) 20%, rgba(0, 0, 0, 0.48) 48%, transparent 82%)",
          WebkitMaskImage:
            "radial-gradient(circle at 100% 100%, #000 0%, rgba(0, 0, 0, 0.92) 20%, rgba(0, 0, 0, 0.48) 48%, transparent 82%)",
          animation: "welcome-rays-shift 7.5s ease-in-out infinite alternate",
        },
        "& .welcome-planet__day-grid": {
          position: "absolute",
          inset: 0,
          display: "none",
          overflow: "hidden",
          borderRadius: "50%",
          backgroundColor: "var(--welcome-day-planet-surface)",
          boxShadow: "inset 0 0 0 1px var(--welcome-day-planet-outline)",
          "&::before": {
            content: '""',
            position: "absolute",
            zIndex: 0,
            inset: 0,
            borderRadius: "inherit",
            background:
              "radial-gradient(circle at 23% 18%, var(--welcome-day-planet-light) 0%, transparent 31%), linear-gradient(138deg, transparent 39%, var(--welcome-day-planet-terminator) 78%, var(--welcome-day-planet-shadow) 100%)",
            pointerEvents: "none",
          },
          "&::after": {
            content: '""',
            position: "absolute",
            zIndex: 2,
            inset: 0,
            borderRadius: "inherit",
            background:
              "radial-gradient(circle at 38% 38%, transparent 0 34%, var(--welcome-day-sphere-shade-soft) 66%, var(--welcome-day-sphere-shade) 100%)",
            boxShadow: "inset -22px -8px 42px var(--welcome-day-sphere-edge)",
            pointerEvents: "none",
          },
        },
        "& .welcome-planet__day-mesh": {
          position: "absolute",
          zIndex: 1,
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          color: "var(--welcome-day-grid)",
          "& .welcome-planet__mesh-line": {
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 0.36,
            vectorEffect: "non-scaling-stroke",
          },
          "& .welcome-planet__mesh-line--minor": {
            opacity: 0.68,
            strokeWidth: 0.26,
          },
        },
        "& .welcome-planet__day-signals": {
          position: "absolute",
          zIndex: 4,
          inset: 0,
          width: "100%",
          height: "100%",
          overflow: "visible",
          "& .welcome-planet__route-trail": {
            fill: "none",
            stroke: "var(--welcome-day-signal)",
            strokeWidth: 0.9,
            strokeLinecap: "round",
            strokeDasharray: "0.48 1",
            strokeDashoffset: 0.48,
            vectorEffect: "non-scaling-stroke",
            opacity: 0,
            animation:
              "welcome-day-route-trail var(--route-duration) linear var(--route-delay) infinite",
          },
          "& .welcome-planet__route": {
            fill: "none",
            stroke: "var(--welcome-day-signal)",
            strokeWidth: 1.85,
            strokeLinecap: "round",
            strokeDasharray: "0.22 1",
            strokeDashoffset: 0.22,
            vectorEffect: "non-scaling-stroke",
            opacity: 0,
            filter: "drop-shadow(0 0 1.8px var(--welcome-day-signal-glow))",
            animation:
              "welcome-day-route var(--route-duration) linear var(--route-delay) infinite",
          },
          "& .welcome-planet__route-endpoint": {
            fill: "var(--welcome-day-planet-surface)",
            stroke: "var(--welcome-day-signal)",
            strokeWidth: 0.95,
            vectorEffect: "non-scaling-stroke",
            opacity: 0,
            transformBox: "fill-box",
            transformOrigin: "center",
            filter: "drop-shadow(0 0 2.2px var(--welcome-day-signal-glow))",
          },
          "& .welcome-planet__route-endpoint--source": {
            animation:
              "welcome-day-route-source var(--route-duration) ease-out var(--route-delay) infinite",
          },
          "& .welcome-planet__route-endpoint--target": {
            animation:
              "welcome-day-route-target var(--route-duration) ease-out var(--route-delay) infinite",
          },
        },
        "& .welcome-planet__day-node": {
          position: "absolute",
          zIndex: 3,
          left: "var(--node-x)",
          top: "var(--node-y)",
          width: 6,
          height: 6,
          border: "1.25px solid var(--welcome-day-node)",
          borderRadius: "50%",
          bgcolor: "var(--welcome-day-planet-surface)",
          opacity: 0.46,
          boxShadow: "0 0 0 1px var(--welcome-day-node-soft)",
          transform: "translate(-50%, -50%) scale(var(--node-depth-scale))",
          transformOrigin: "center",
        },
        ".light-theme & .welcome-background--planet": {
          opacity: 0.96,
          background: "var(--welcome-day-planet-surface)",
          boxShadow:
            "inset 16px 12px 42px var(--welcome-day-planet-light), inset -38px -28px 74px var(--welcome-day-planet-shadow), 0 0 0 1px var(--welcome-day-planet-outline), 0 22px 68px var(--welcome-day-edge-blur)",
        },
        ".light-theme & .welcome-background--planet::before, .light-theme & .welcome-planet__rim-light, .light-theme & .welcome-planet__rays":
          {
            display: "none",
          },
        ".light-theme & .welcome-planet__day-grid": {
          display: "block",
          background:
            "radial-gradient(circle at 24% 18%, var(--welcome-day-planet-light) 0%, transparent 33%), var(--welcome-day-planet-surface)",
        },
        ".light-theme & .welcome-background--day-atmosphere": {
          opacity: 1,
        },
        ".light-theme & .welcome-background--day-orbits": {
          display: "block",
        },
        ".light-theme & .welcome-background--grid": {
          opacity: 0.72,
          backgroundSize: "64px 64px",
          maskImage:
            "linear-gradient(90deg, rgba(0, 0, 0, 0.46) 0%, rgba(0, 0, 0, 0.78) 44%, transparent 96%)",
          WebkitMaskImage:
            "linear-gradient(90deg, rgba(0, 0, 0, 0.46) 0%, rgba(0, 0, 0, 0.78) 44%, transparent 96%)",
        },
        ".light-theme & .welcome-background--particles": {
          opacity: 0.14,
        },
        "& .welcome-background--grid": {
          inset: -48,
          backgroundImage:
            "linear-gradient(var(--color-grid) 1px, transparent 1px), linear-gradient(90deg, var(--color-grid) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
          animation:
            "welcome-grid var(--grid-speed, 0.9s) linear infinite alternate",
          willChange: "transform",
        },
        "@media (prefers-reduced-motion: reduce)": {
          "& .welcome-background, & .welcome-background--planet::before, & .welcome-planet__rim-light, & .welcome-planet__rays, & .welcome-planet__route, & .welcome-planet__route-trail, & .welcome-planet__route-endpoint, & .welcome-day-orbit__marker":
            {
              animation: "none",
              transform: "none",
              willChange: "auto",
            },
          "& .welcome-planet__day-node": {
            opacity: 0.5,
          },
        },
        "@keyframes welcome-particles": {
          from: { transform: "translate3d(-1px, -1px, 0)" },
          to: { transform: "translate3d(1px, 1px, 0)" },
        },
        "@keyframes welcome-planet-drift": {
          from: { transform: "translate3d(0, -4px, 0) scale(0.995)" },
          to: { transform: "translate3d(-10px, 8px, 0) scale(1.012)" },
        },
        "@keyframes welcome-day-orbit-drift": {
          from: { transform: "translate3d(0, -3px, 0) rotate(-0.35deg)" },
          to: { transform: "translate3d(-12px, 6px, 0) rotate(0.45deg)" },
        },
        "@keyframes welcome-day-beacon": {
          "0%, 100%": { opacity: 0.72, transform: "scale(0.86)" },
          "48%": { opacity: 1, transform: "scale(1.24)" },
        },
        "@keyframes welcome-edge-light-shift": {
          "0%, 100%": {
            opacity: 0.58,
            filter: "blur(3.5px)",
            transform: "rotate(-16deg) scale(0.995)",
          },
          "34%": {
            opacity: 0.94,
            filter: "blur(2px)",
            transform: "rotate(22deg) scale(1.006)",
          },
          "68%": {
            opacity: 0.72,
            filter: "blur(3px)",
            transform: "rotate(58deg) scale(1.012)",
          },
        },
        "@keyframes welcome-rim-orbit-reverse": {
          from: { transform: "rotate(360deg) scale(0.99)", opacity: 0.28 },
          "35%, 68%": { opacity: 0.72 },
          to: { transform: "rotate(0deg) scale(1.015)", opacity: 0.28 },
        },
        "@keyframes welcome-rays-shift": {
          from: { opacity: 0.22, transform: "rotate(-3deg) scale(0.96)" },
          to: { opacity: 0.56, transform: "rotate(4deg) scale(1.04)" },
        },
        "@keyframes welcome-day-route": {
          "0%, 4%, 20%, 100%": { opacity: 0, strokeDashoffset: 0.22 },
          "6%": { opacity: 1, strokeDashoffset: 0.08 },
          "16%": { opacity: 1, strokeDashoffset: -1 },
          "19%": { opacity: 0, strokeDashoffset: -1.08 },
        },
        "@keyframes welcome-day-route-trail": {
          "0%, 4%, 20%, 100%": { opacity: 0, strokeDashoffset: 0.48 },
          "7%": { opacity: 0.28, strokeDashoffset: 0.22 },
          "16%": { opacity: 0.16, strokeDashoffset: -1 },
          "19%": { opacity: 0, strokeDashoffset: -1.08 },
        },
        "@keyframes welcome-day-route-source": {
          "0%, 3%, 11%, 100%": { opacity: 0, transform: "scale(0.45)" },
          "5%": { opacity: 1, transform: "scale(1.08)" },
          "8.5%": { opacity: 0, transform: "scale(1.95)" },
        },
        "@keyframes welcome-day-route-target": {
          "0%, 15%, 22%, 100%": { opacity: 0, transform: "scale(0.45)" },
          "17%": { opacity: 1, transform: "scale(1.08)" },
          "20%": { opacity: 0, transform: "scale(1.95)" },
        },
        "@keyframes welcome-grid": {
          from: { transform: "translate3d(0, 0, 0)" },
          to: { transform: "translate3d(3px, 3px, 0)" },
        },
        "@keyframes welcome-rise": {
          from: { opacity: 0, transform: "translateY(12px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "@keyframes status-breathe": {
          "0%, 100%": { opacity: 0.42 },
          "50%": { opacity: 1 },
        },
      }}
    >
      <Box
        aria-hidden="true"
        className="welcome-background welcome-background--day-atmosphere"
      />
      <Box
        aria-hidden="true"
        className="welcome-background welcome-background--grid"
      />
      <Box
        aria-hidden="true"
        className="welcome-background welcome-background--particles"
      />
      <Box
        aria-hidden="true"
        component="svg"
        className="welcome-background welcome-background--day-orbits"
        viewBox="0 0 1000 700"
        preserveAspectRatio="xMidYMid meet"
        focusable="false"
      >
        <ellipse
          className="welcome-day-orbit__arc welcome-day-orbit__arc--fine"
          cx="612"
          cy="354"
          rx="444"
          ry="182"
          transform="rotate(-18 612 354)"
        />
        <ellipse
          className="welcome-day-orbit__arc welcome-day-orbit__arc--strong"
          cx="636"
          cy="348"
          rx="332"
          ry="136"
          transform="rotate(-18 636 348)"
        />
        <ellipse
          className="welcome-day-orbit__arc welcome-day-orbit__arc--fine"
          cx="649"
          cy="340"
          rx="258"
          ry="102"
          transform="rotate(-18 649 340)"
        />
        <path className="welcome-day-orbit__axis" d="M 212 561 L 982 112" />
        <path className="welcome-day-orbit__axis" d="M 386 109 L 876 596" />
        <circle
          className="welcome-day-orbit__marker-ring"
          cx="835"
          cy="226"
          r="8"
        />
        <circle className="welcome-day-orbit__marker" cx="835" cy="226" r="3" />
      </Box>
      <Box
        aria-hidden="true"
        className="welcome-background welcome-background--planet"
      >
        <Box className="welcome-planet__rays" />
        <Box className="welcome-planet__rim-light welcome-planet__rim-light--secondary" />
        <Box className="welcome-planet__day-grid">
          <Box
            component="svg"
            className="welcome-planet__day-mesh"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
          >
            <circle
              className="welcome-planet__mesh-line"
              cx="50"
              cy="50"
              r="49"
            />
            {DAY_PLANET_MERIDIANS.map((radius, index) => (
              <ellipse
                key={`meridian-${radius}`}
                className={`welcome-planet__mesh-line${index % 2 === 0 ? "" : " welcome-planet__mesh-line--minor"}`}
                cx="50"
                cy="50"
                rx={radius}
                ry="49"
              />
            ))}
            {DAY_PLANET_LATITUDES.map((path, index) => (
              <path
                key={`latitude-${index}`}
                className={`welcome-planet__mesh-line${index % 2 === 0 ? " welcome-planet__mesh-line--minor" : ""}`}
                d={path}
              />
            ))}
          </Box>
          <Box
            component="svg"
            className="welcome-planet__day-signals"
            viewBox="0 0 100 100"
            preserveAspectRatio="xMidYMid meet"
          >
            {DAY_PLANET_ROUTES.map((route) => (
              <React.Fragment key={route.id}>
                <Box
                  component="path"
                  className="welcome-planet__route-trail"
                  pathLength="1"
                  d={route.d}
                  sx={dayRouteVars(route)}
                />
                <Box
                  component="path"
                  className="welcome-planet__route"
                  pathLength="1"
                  d={route.d}
                  sx={dayRouteVars(route)}
                />
                <Box
                  component="circle"
                  className="welcome-planet__route-endpoint welcome-planet__route-endpoint--source"
                  cx={route.from[0]}
                  cy={route.from[1]}
                  r="1.15"
                  sx={dayRouteVars(route)}
                />
                <Box
                  component="circle"
                  className="welcome-planet__route-endpoint welcome-planet__route-endpoint--target"
                  cx={route.to[0]}
                  cy={route.to[1]}
                  r="1.15"
                  sx={dayRouteVars(route)}
                />
              </React.Fragment>
            ))}
          </Box>
          {DAY_PLANET_NODES.map((node) => (
            <Box
              key={node.id}
              className="welcome-planet__day-node"
              sx={{
                "--node-x": node.x,
                "--node-y": node.y,
                "--node-depth-scale": node.scale,
              }}
            />
          ))}
        </Box>
      </Box>
      <Box
        sx={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: 1040,
          minHeight: "100%",
          mx: "auto",
          px: { xs: 3, sm: 5, md: 7 },
          py: { xs: 4, md: 6 },
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            pb: 2,
            borderBottom: "1px solid",
            borderColor: "divider",
            fontFamily: MONO_FONT,
            animation: "welcome-rise 420ms cubic-bezier(0.2, 0, 0, 1) both",
          }}
        >
          <Typography
            component="div"
            sx={{
              fontFamily: "inherit",
              fontSize: "0.75rem",
              fontWeight: 700,
              letterSpacing: "0.16em",
            }}
          >
            SIMPLESHELL
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box
              aria-hidden="true"
              sx={{
                width: 5,
                height: 5,
                bgcolor: "success.main",
                borderRadius: "50%",
                animation: "status-breathe 2.4s ease-in-out infinite",
              }}
            />
            <Typography
              component="span"
              sx={{
                fontFamily: "inherit",
                color: "text.secondary",
                fontSize: "0.7rem",
                letterSpacing: "0.12em",
              }}
            >
              SSH / SFTP / LOCAL
            </Typography>
          </Box>
        </Box>

        <Box
          sx={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              md: "minmax(280px, 0.9fr) minmax(360px, 1.1fr)",
            },
            alignItems: "center",
            columnGap: { md: 9 },
            rowGap: 5,
            py: { xs: 6, md: 8 },
          }}
        >
          <Box
            sx={{
              maxWidth: 430,
              animation:
                "welcome-rise 520ms 60ms cubic-bezier(0.2, 0, 0, 1) both",
            }}
          >
            <Typography
              sx={{
                mb: 2,
                fontFamily: MONO_FONT,
                color: "text.secondary",
                fontSize: "0.75rem",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
              }}
            >
              {t("welcome.consoleLabel")}
            </Typography>
            <Typography
              component="h1"
              sx={{
                m: 0,
                mb: 2.5,
                fontSize: { xs: "2.75rem", sm: "3.75rem", md: "4.4rem" },
                fontWeight: 700,
                lineHeight: 0.92,
                letterSpacing: "-0.075em",
              }}
            >
              Simple
              <Box component="span" sx={{ color: "text.secondary" }}>
                Shell
              </Box>
            </Typography>
            <Button
              variant="contained"
              onClick={onCreateConnection}
              startIcon={<AddRoundedIcon />}
              sx={{
                minWidth: 190,
                minHeight: 42,
                justifyContent: "space-between",
                px: 2,
                borderRadius: "2px",
              }}
            >
              {t("welcome.newConnection")}
            </Button>
          </Box>

          <Box
            component="section"
            aria-labelledby="recent-connections-title"
            sx={{
              minWidth: 0,
              animation:
                "welcome-rise 560ms 130ms cubic-bezier(0.2, 0, 0, 1) both",
            }}
          >
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                pb: 1.5,
                borderBottom: "1px solid",
                borderColor: "text.primary",
              }}
            >
              <Typography
                id="recent-connections-title"
                variant="subtitle2"
                sx={{ fontSize: "0.875rem", letterSpacing: "0.06em" }}
              >
                {hasConnections
                  ? t("welcome.lastConnectedServers")
                  : t("welcome.exampleTitle")}
              </Typography>
              <Typography
                sx={{
                  fontFamily: MONO_FONT,
                  color: "text.secondary",
                  fontSize: "0.75rem",
                  letterSpacing: "0.12em",
                }}
              >
                {hasConnections
                  ? String(topConnections.length).padStart(2, "0")
                  : "CONFIG"}
              </Typography>
            </Box>

            {hasConnections ? (
              <Box component="ol" sx={{ p: 0, m: 0, listStyle: "none" }}>
                {topConnections.map((connection, index) => (
                  <Box
                    component="li"
                    key={connection.id || `${connection.host}-${index}`}
                  >
                    <Box
                      component="button"
                      type="button"
                      onClick={() => handleOpenConnection(connection)}
                      sx={{
                        appearance: "none",
                        width: "100%",
                        minHeight: 66,
                        p: 0,
                        display: "grid",
                        gridTemplateColumns: "30px minmax(0, 1fr) auto 24px",
                        alignItems: "center",
                        gap: 1.25,
                        color: "text.primary",
                        bgcolor: "transparent",
                        border: 0,
                        borderBottom: "1px solid",
                        borderColor: "divider",
                        textAlign: "left",
                        cursor: "pointer",
                        transition:
                          "background-color 160ms ease, padding 160ms ease",
                        "&:hover": {
                          bgcolor: (currentTheme) =>
                            alpha(currentTheme.palette.text.primary, 0.055),
                          px: 1,
                        },
                        "&:hover .connection-arrow": {
                          opacity: 1,
                          transform: "translateX(0)",
                        },
                      }}
                    >
                      <Typography
                        sx={{
                          fontFamily: MONO_FONT,
                          color: "text.disabled",
                          fontSize: "0.75rem",
                        }}
                      >
                        {String(index + 1).padStart(2, "0")}
                      </Typography>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontSize: "0.9375rem",
                            fontWeight: 650,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {connection.name || connection.host}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            mt: 0.25,
                            fontFamily: MONO_FONT,
                            color: "text.secondary",
                            fontSize: "0.75rem",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {connection.username
                            ? `${connection.username}@${connection.host}`
                            : connection.host}
                        </Typography>
                      </Box>
                      <Typography
                        sx={{
                          fontFamily: MONO_FONT,
                          color: "text.secondary",
                          fontSize: "0.7rem",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {(connection.protocol || "SSH").toUpperCase()}
                      </Typography>
                      <ArrowForwardRoundedIcon
                        className="connection-arrow"
                        sx={{
                          fontSize: 16,
                          opacity: 0,
                          transform: "translateX(-5px)",
                          transition: "all 160ms ease",
                        }}
                      />
                    </Box>
                  </Box>
                ))}
              </Box>
            ) : (
              <Box sx={{ pt: 2.5 }}>
                {[
                  ["HOST", "[IP]"],
                  ["PORT", "22"],
                  ["USER", "root / ubuntu / admin"],
                  ["AUTH", t("welcome.exampleAuth")],
                ].map(([label, value]) => (
                  <Box
                    key={label}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "76px 1fr",
                      gap: 2,
                      py: 1.25,
                      borderBottom: "1px solid",
                      borderColor: "divider",
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: MONO_FONT,
                        color: "text.secondary",
                        fontSize: "0.75rem",
                        letterSpacing: "0.08em",
                      }}
                    >
                      {label}
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: MONO_FONT,
                        fontSize: "0.8125rem",
                        textAlign: "right",
                        wordBreak: "break-word",
                      }}
                    >
                      {value}
                    </Typography>
                  </Box>
                ))}
                <Typography
                  variant="caption"
                  sx={{
                    display: "block",
                    mt: 2.5,
                    color: "text.secondary",
                    fontSize: "0.8125rem",
                    lineHeight: 1.6,
                  }}
                >
                  {t("welcome.emptyHint")}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        <Box
          sx={{
            pt: 2,
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "space-between",
            color: "text.disabled",
            animation:
              "welcome-rise 580ms 180ms cubic-bezier(0.2, 0, 0, 1) both",
          }}
        >
          <Typography
            sx={{
              fontFamily: MONO_FONT,
              fontSize: "0.7rem",
              letterSpacing: "0.12em",
            }}
          >
            {t("welcome.secureAccess")}
          </Typography>
          <Typography
            sx={{
              fontFamily: MONO_FONT,
              fontSize: "0.7rem",
              letterSpacing: "0.12em",
            }}
          >
            {t("welcome.systemReady")}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default memo(WelcomePage);
