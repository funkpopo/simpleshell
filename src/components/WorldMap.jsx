import React, { memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
} from "react-simple-maps";
import { useTheme } from "@mui/material/styles";
import geoData from "../assets/countries-110m.json";

const WorldMap = ({ latitude, longitude }) => {
  const theme = useTheme();

  const lat = Number(latitude);
  const lon = Number(longitude);

  const isValidCoordinates = latitude != null && longitude != null && !isNaN(lat) && !isNaN(lon);

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
        height: "auto",
      }}
      aria-label="World map"
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