import React, { memo, useMemo } from "react";
import PropTypes from "prop-types";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";

/**
 * 轻量 SVG 折线图（资源监控历史曲线）。
 * - 无第三方图表依赖，纯 SVG 渲染，适配窄侧边栏
 * - values 中 null 表示该时刻无有效数据（首帧差分/采样失败），折线留空
 * - maxValue 固定刻度（如 CPU/内存 0-100%），否则按数据自动取整放大
 */
const CHART_HEIGHT = 52;
const GRID_RATIOS = [0.25, 0.5, 0.75];

const niceCeil = (value) => {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const mantissa = value / base;
  const nice = mantissa <= 1 ? 1 : mantissa <= 2 ? 2 : mantissa <= 5 ? 5 : 10;
  return nice * base;
};

const MetricHistoryChart = memo(
  ({ title, series, maxValue = null, formatValue = (v) => String(v) }) => {
    const pointCount = series.reduce(
      (max, s) => Math.max(max, s.values?.length || 0),
      0,
    );

    const scaleMax = useMemo(() => {
      if (Number.isFinite(maxValue) && maxValue > 0) {
        return maxValue;
      }
      let max = 0;
      for (const s of series) {
        for (const v of s.values || []) {
          if (Number.isFinite(v) && v > max) max = v;
        }
      }
      return niceCeil(max * 1.1);
    }, [series, maxValue]);

    const polylines = useMemo(() => {
      if (pointCount < 2) return [];
      const W = 100;
      const H = CHART_HEIGHT;
      const pad = 2;
      const usableH = H - pad * 2;

      return series.map((s) => {
        const points = [];
        (s.values || []).forEach((v, i) => {
          if (!Number.isFinite(v)) return;
          const x = (i / (pointCount - 1)) * W;
          const clamped = Math.max(0, Math.min(v, scaleMax));
          const y = pad + usableH - (clamped / scaleMax) * usableH;
          points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
        });
        return { color: s.color, points: points.join(" ") };
      });
    }, [series, pointCount, scaleMax]);

    const latest = useMemo(
      () =>
        series.map((s) => {
          const values = s.values || [];
          for (let i = values.length - 1; i >= 0; i -= 1) {
            if (Number.isFinite(values[i])) return values[i];
          }
          return null;
        }),
      [series],
    );

    return (
      <Box sx={{ minWidth: 0 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 1,
            mb: 0.25,
          }}
        >
          <Typography
            variant="caption"
            noWrap
            sx={{ minWidth: 0, fontSize: "0.7rem", color: "text.secondary" }}
          >
            {title}
          </Typography>
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 0.75,
              flexShrink: 0,
            }}
          >
            {series.map((s, idx) => (
              <Typography
                key={idx}
                variant="caption"
                component="span"
                sx={{
                  fontSize: "0.68rem",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  color: "text.primary",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 0.25,
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    bgcolor: s.color,
                    display: "inline-block",
                  }}
                />
                {latest[idx] == null ? "--" : formatValue(latest[idx])}
              </Typography>
            ))}
          </Box>
        </Box>
        <Box
          sx={{
            position: "relative",
            height: CHART_HEIGHT,
            borderRadius: 1,
            bgcolor: "action.hover",
            overflow: "hidden",
          }}
        >
          <svg
            width="100%"
            height="100%"
            viewBox={`0 0 100 ${CHART_HEIGHT}`}
            preserveAspectRatio="none"
            style={{ display: "block" }}
            aria-hidden="true"
          >
            {GRID_RATIOS.map((ratio) => {
              const y = 2 + (CHART_HEIGHT - 4) * (1 - ratio);
              return (
                <line
                  key={ratio}
                  x1="0"
                  x2="100"
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity="0.12"
                  strokeWidth="0.5"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
            {polylines.map(
              (line, idx) =>
                line.points && (
                  <polyline
                    key={idx}
                    points={line.points}
                    fill="none"
                    stroke={line.color}
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                ),
            )}
          </svg>
          {pointCount < 2 && (
            <Box
              sx={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Typography
                variant="caption"
                sx={{ fontSize: "0.65rem", color: "text.disabled" }}
              >
                ...
              </Typography>
            </Box>
          )}
        </Box>
      </Box>
    );
  },
);

MetricHistoryChart.displayName = "MetricHistoryChart";

MetricHistoryChart.propTypes = {
  title: PropTypes.node.isRequired,
  series: PropTypes.arrayOf(
    PropTypes.shape({
      values: PropTypes.arrayOf(PropTypes.number).isRequired,
      color: PropTypes.string.isRequired,
    }),
  ).isRequired,
  maxValue: PropTypes.number,
  formatValue: PropTypes.func,
};

export default MetricHistoryChart;
