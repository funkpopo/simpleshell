import React, { memo, useCallback } from "react";
import { Box, Button, Typography } from "@mui/material";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

const MONO_FONT =
  '"Space Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace';

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
        "& .welcome-background--glow": {
          width: { xs: 300, md: 560 },
          height: { xs: 300, md: 560 },
          right: { xs: -210, md: -260 },
          top: { xs: 20, md: "6%" },
          border: "1px solid var(--welcome-glow-color)",
          borderRadius: "48% 52% 49% 51%",
          opacity: 0.72,
          boxShadow: (currentTheme) =>
            `0 0 0 68px ${alpha(currentTheme.palette.text.primary, 0.016)}, 0 0 0 136px ${alpha(currentTheme.palette.text.primary, 0.01)}`,
          animation: "welcome-glow var(--glow-speed, 18s) linear infinite",
          willChange: "transform",
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
          "& .welcome-background": {
            animation: "none",
            transform: "none",
            willChange: "auto",
          },
        },
        "@keyframes welcome-particles": {
          from: { transform: "translate3d(-1px, -1px, 0)" },
          to: { transform: "translate3d(1px, 1px, 0)" },
        },
        "@keyframes welcome-glow": {
          from: { transform: "translate3d(0, 0, 0) rotate(0deg)" },
          to: { transform: "translate3d(0, 0, 0) rotate(360deg)" },
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
        className="welcome-background welcome-background--grid"
      />
      <Box
        aria-hidden="true"
        className="welcome-background welcome-background--particles"
      />
      <Box
        aria-hidden="true"
        className="welcome-background welcome-background--glow"
      />
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
