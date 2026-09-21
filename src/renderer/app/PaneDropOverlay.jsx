import Box from "@mui/material/Box";
import { useDragSelector } from "./state/AppContext.jsx";

export default function PaneDropOverlay() {
  const paneDropZone = useDragSelector((state) =>
    state.draggedTabIndex === null ? null : state.paneDropZone,
  );
  return (
    <>
      {paneDropZone
        ? [
            {
              zone: "left",
              sx: {
                left: 0,
                top: 0,
                bottom: 0,
                width: "25%",
              },
            },
            {
              zone: "right",
              sx: {
                right: 0,
                top: 0,
                bottom: 0,
                width: "25%",
              },
            },
            {
              zone: "top",
              sx: {
                left: 0,
                right: 0,
                top: 0,
                height: "25%",
              },
            },
            {
              zone: "bottom",
              sx: {
                left: 0,
                right: 0,
                bottom: 0,
                height: "25%",
              },
            },
          ].map(({ zone, sx }) => (
            <Box
              key={zone}
              sx={{
                position: "absolute",
                zIndex: 1300,
                pointerEvents: "none",
                border: "2px dashed",
                borderColor:
                  paneDropZone === zone ? "primary.main" : "transparent",
                bgcolor: paneDropZone === zone ? "action.focus" : "transparent",
                opacity: paneDropZone === zone ? 0.4 : 0,
                borderRadius: 1,
                m: 0.5,
                ...sx,
              }}
            />
          ))
        : null}
    </>
  );
}
