import React, { memo, useState, useEffect } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import { useTheme } from "@mui/material/styles";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

const WorldMap = ({ latitude, longitude }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [geoData, setGeoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lat = Number(latitude);
  const lon = Number(longitude);

  const isValidCoordinates =
    latitude != null && longitude != null && !isNaN(lat) && !isNaN(lon);

  useEffect(() => {
    const loadGeoData = async () => {
      try {
        setLoading(true);
        // 使用dynamic import来加载JSON文件
        const data = await import("../assets/countries-110m.json");
        setGeoData(data.default || data);
        setError(null);
      } catch (err) {
        console.error("Failed to load geography data:", err);
        setError(t("worldMap.loadError"));
      } finally {
        setLoading(false);
      }
    };

    loadGeoData();
  }, []);

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "200px",
        }}
      >
        <CircularProgress size={24} />
        <Typography sx={{ ml: 1 }} variant="body2">
        {t("worldMap.loading")}
        </Typography>
      </Box>
    );
  }

  if (error || !geoData) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "200px",
        }}
      >
        <Typography variant="body2" color="error">
          {error || t("worldMap.dataUnavailable")}
        </Typography>
      </Box>
    );
  }

  return (
    <ComposableMap
      projection="geoMercator"
      projectionConfig={{
        rotate: [-10, 0, 0],
        scale: 120,
        center: [0, 20],
      }}
      style={{
        width: "100%",
        height: "100%",
      }}
      aria-label={t("worldMap.ariaLabel")}
    >
      <Geographies geography={geoData}>
        {({ geographies }) =>
          geographies.map((geo) => (
            <Geography
              key={geo.rsmKey}
              geography={geo}
              fill={theme.palette.divider}
              stroke={theme.palette.background.paper}
              style={{
                default: { outline: "none" },
                hover: { outline: "none" },
                pressed: { outline: "none" },
              }}
            />
          ))
        }
      </Geographies>
      {isValidCoordinates && (
        <Marker coordinates={[lon, lat]}>
          <g
            fill={theme.palette.error.main}
            stroke="#FFFFFF"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            transform="translate(-12, -24)"
          >
            <path d="M12 21.7C17.3 17 20 13 20 10a8 8 0 1 0-16 0c0 3 2.7 6.9 8 11.7z" />
            <circle cx="12" cy="10" r="3" fill="white" />
          </g>
        </Marker>
      )}
    </ComposableMap>
  );
};

export default memo(WorldMap);


