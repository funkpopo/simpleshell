import React, { useState, useEffect, memo, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import RefreshIcon from "@mui/icons-material/Refresh";
import PublicIcon from "@mui/icons-material/Public";
import { useTheme } from "@mui/material/styles";
import Grid from "@mui/material/Grid";
import { useTranslation } from "react-i18next";
import WorldMap from "./WorldMap";
import Skeleton from "@mui/material/Skeleton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemButton from "@mui/material/ListItemButton";
import Divider from "@mui/material/Divider";
import HistoryIcon from "@mui/icons-material/History";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import Collapse from "@mui/material/Collapse";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { sidebarContentSx } from "./sidebarItemStyles";
// Common IP utilities (supports IPv4/IPv6 + private detection)
// Use require for reliable CJS interop in both renderer and main bundles
const ipUtils = require("../utils/ip");

// In-memory LRU + TTL; persisted records are stored in config.json via UI settings.
const CLIENT_IP_MEMORY_MAX = 64;
const CLIENT_IP_MEMORY_TTL_MS = 10 * 60 * 1000;
const clientIpMemoryCache = new Map();

function normalizeClientCacheKey(ip) {
  return ip && String(ip).trim()
    ? String(ip).trim().toLowerCase()
    : "__MY_IP__";
}

function getClientIpMemoryCached(ipKey) {
  const entry = clientIpMemoryCache.get(ipKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.ts > CLIENT_IP_MEMORY_TTL_MS) {
    clientIpMemoryCache.delete(ipKey);
    return null;
  }
  clientIpMemoryCache.delete(ipKey);
  clientIpMemoryCache.set(ipKey, entry);
  return entry.result;
}

function setClientIpMemoryCached(ipKey, result) {
  if (clientIpMemoryCache.has(ipKey)) {
    clientIpMemoryCache.delete(ipKey);
  }
  clientIpMemoryCache.set(ipKey, { ts: Date.now(), result });
  while (clientIpMemoryCache.size > CLIENT_IP_MEMORY_MAX) {
    const oldest = clientIpMemoryCache.keys().next().value;
    clientIpMemoryCache.delete(oldest);
  }
}

function normalizeIpQueryHistory(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      id: entry.id || Date.now(),
      ip: typeof entry.ip === "string" ? entry.ip : "",
      locationText:
        typeof entry.locationText === "string" ? entry.locationText : "",
      latitude: entry.latitude,
      longitude: entry.longitude,
      time: Number.isFinite(Number(entry.time))
        ? Number(entry.time)
        : Date.now(),
    }))
    .slice(0, 20);
}

async function saveIpQueryHistoryToConfig(history) {
  if (
    !window.terminalAPI?.loadUISettings ||
    !window.terminalAPI?.saveUISettings
  ) {
    return;
  }

  const settings = await window.terminalAPI.loadUISettings();
  const currentSettings =
    settings && typeof settings === "object" && !settings.success
      ? settings
      : {};
  await window.terminalAPI.saveUISettings({
    ...currentSettings,
    ipQueryHistory: normalizeIpQueryHistory(history),
  });
}

// IP地址查询组件
const IPAddressQuery = memo(({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [ipAddress, setIpAddress] = useState("");
  const [ipInfo, setIpInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const requestIdRef = useRef(0);
  const debounceTimerRef = useRef(null);

  useEffect(() => {
    if (!open || !window.terminalAPI?.loadUISettings) {
      return undefined;
    }

    let cancelled = false;
    window.terminalAPI
      .loadUISettings()
      .then((settings) => {
        if (!cancelled) {
          setHistory(normalizeIpQueryHistory(settings?.ipQueryHistory));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistory([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open]);

  // 查询IP信息
  const fetchIPInfo = async (ip = "") => {
    try {
      const ipKey = normalizeClientCacheKey(ip);
      const memHit = getClientIpMemoryCached(ipKey);
      if (memHit && memHit.ret === "ok") {
        setIpInfo(memHit);
        setLoading(false);
        setError(null);
        return;
      }

      const currentId = ++requestIdRef.current; // mark request
      setLoading(true);
      setError(null);

      // 通过preload API进行查询
      if (window.terminalAPI?.queryIpAddress) {
        const result = await window.terminalAPI.queryIpAddress(ip);

        // Ignore outdated responses
        if (currentId !== requestIdRef.current) {
          return;
        }

        if (result.ret === "ok") {
          setIpInfo(result);
          setClientIpMemoryCached(ipKey, result);
          const resolvedIp =
            ip && ip.trim() ? ip.trim() : result.data?.ip || "";
          const locArr = Array.isArray(result.data?.location)
            ? result.data.location
            : [];
          const locationText = locArr.filter(Boolean).join(" ");
          const entry = {
            id: Date.now(),
            ip: resolvedIp,
            locationText,
            latitude: result.data?.latitude,
            longitude: result.data?.longitude,
            time: Date.now(),
          };
          setHistory((prev) => {
            const deduped = prev.filter(
              (h) =>
                !(
                  h.ip === entry.ip &&
                  h.latitude === entry.latitude &&
                  h.longitude === entry.longitude
                ),
            );
            const next = [entry, ...deduped];
            const normalizedNext = next.slice(0, 20);
            void saveIpQueryHistoryToConfig(normalizedNext).catch(() => {});
            return normalizedNext;
          });
        } else {
          throw new Error(result.msg || t("ipAddressQuery.networkError"));
        }
      } else {
        throw new Error(t("ipAddressQuery.apiUnavailable"));
      }
    } catch (err) {
      setError(err.message || t("ipAddressQuery.networkError"));
    } finally {
      setLoading(false);
    }
  };

  // 处理查询按钮点击
  const handleQuery = useCallback(() => {
    const ip = ipAddress.trim();
    if (!ip) {
      setError(t("ipAddressQuery.invalidIp"));
      return;
    }
    const ipVer = ipUtils.isIP(ip);
    if (ipVer === 0) {
      setError(t("ipAddressQuery.invalidIp"));
      return;
    }
    if (ipUtils.isPrivateOrSpecial(ip)) {
      setError(t("ipAddressQuery.invalidIp"));
      return;
    }
    fetchIPInfo(ip);
  }, [ipAddress, t]);

  // 查询本机IP
  const handleQueryMyIP = useCallback(() => {
    setIpAddress("");
    fetchIPInfo();
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    void saveIpQueryHistoryToConfig([]).catch(() => {});
  }, []);

  // 当侧边栏打开时自动查询本机IP
  useEffect(() => {
    if (open && !ipInfo && !loading && !error) {
      const memHit = getClientIpMemoryCached(normalizeClientCacheKey(""));
      if (memHit && memHit.ret === "ok") {
        setIpInfo(memHit);
        return;
      }

      handleQueryMyIP();
    }
  }, [open, ipInfo, loading, error, handleQueryMyIP]);

  // 处理回车键按下事件
  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      // Debounce Enter-triggered query to avoid duplicates
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        handleQuery();
      }, 250);
    }
  };

  // Clear pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Invalidate any in-flight response
      requestIdRef.current++;
    };
  }, []);

  // 渲染查询结果
  const renderResult = () => {
    if (loading) {
      return (
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" width={120} height={28} />
          <Paper elevation={2} sx={{ p: 2, borderRadius: 1, mb: 2 }}>
            <Skeleton variant="text" width="60%" height={22} />
            <Skeleton variant="text" width="40%" height={22} />
          </Paper>
          <Skeleton variant="text" width={120} height={28} />
          <Paper elevation={2} sx={{ p: 2, borderRadius: 1 }}>
            <Skeleton variant="text" width="50%" height={20} />
            <Skeleton variant="text" width="40%" height={20} />
            <Skeleton variant="text" width="30%" height={20} />
          </Paper>
          <Box sx={{ mt: 2, height: "200px" }}>
            <Skeleton variant="rounded" width="100%" height={200} />
          </Box>
        </Box>
      );
    }

    if (error) {
      return (
        <Box sx={{ py: 2, textAlign: "center" }}>
          <Typography color="error" gutterBottom>
            {error}
          </Typography>
          <Button
            variant="outlined"
            color="primary"
            startIcon={<RefreshIcon />}
            onClick={() => (ipAddress ? handleQuery() : handleQueryMyIP())}
            sx={{ mt: 1 }}
          >
            {t("ipAddressQuery.retry")}
          </Button>
        </Box>
      );
    }

    if (!ipInfo) {
      return (
        <Box sx={{ py: 4, textAlign: "center" }}>
          <PublicIcon
            sx={{ fontSize: 60, color: "text.secondary", opacity: 0.7 }}
          />
          <Typography color="text.secondary" sx={{ mt: 2 }}>
            {t("ipAddressQuery.noData")}
          </Typography>
        </Box>
      );
    }

    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="subtitle1" gutterBottom fontWeight="bold">
          {t("ipAddressQuery.ipInfo")}
        </Typography>
        <Paper
          elevation={2}
          sx={{
            p: 2,
            borderRadius: 1,
            borderLeft: `4px solid ${theme.palette.primary.main}`,
            mb: 2,
          }}
        >
          <Grid container spacing={1}>
            <Grid size={12}>
              <Typography variant="body2">
                <strong>{t("ipAddressQuery.ipAddress")}:</strong>{" "}
                {ipInfo.data?.ip}
              </Typography>
            </Grid>
          </Grid>
        </Paper>
        <Typography variant="subtitle1" gutterBottom fontWeight="bold">
          {t("ipAddressQuery.location")}
        </Typography>
        <Paper
          elevation={2}
          sx={{
            p: 2,
            borderRadius: 1,
            borderLeft: `4px solid ${theme.palette.info.main}`,
          }}
        >
          <Grid container spacing={1}>
            {ipInfo.data?.location && ipInfo.data.location.length >= 1 && (
              <Grid size={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.country")}:</strong>{" "}
                  {ipInfo.data.location[0]}
                </Typography>
              </Grid>
            )}

            {ipInfo.data?.location && ipInfo.data.location.length >= 2 && (
              <Grid size={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.province")}:</strong>{" "}
                  {ipInfo.data.location[1]}
                </Typography>
              </Grid>
            )}

            {ipInfo.data?.location && ipInfo.data.location.length >= 3 && (
              <Grid size={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.city")}:</strong>{" "}
                  {ipInfo.data.location[2]}
                </Typography>
              </Grid>
            )}

            {ipInfo.data?.location && ipInfo.data.location.length >= 4 && (
              <Grid size={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.isp")}:</strong>{" "}
                  {ipInfo.data.location[4] || ipInfo.data.location[3]}
                </Typography>
              </Grid>
            )}
          </Grid>
        </Paper>
        {(() => {
          const latNum = Number(ipInfo.data?.latitude);
          const lonNum = Number(ipInfo.data?.longitude);
          const hasValidCoords =
            Number.isFinite(latNum) && Number.isFinite(lonNum);
          return hasValidCoords;
        })() && (
          <Box
            sx={{
              mt: 2,
              mb: 1,
              borderRadius: 1,
              overflow: "hidden",
              height: "200px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              backgroundColor: theme.palette.background.default,
            }}
          >
            <WorldMap
              key={`${ipInfo.data.latitude},${ipInfo.data.longitude}`}
              latitude={ipInfo.data.latitude}
              longitude={ipInfo.data.longitude}
            />
          </Box>
        )}
      </Box>
    );
  };

  return (
    <Paper
      sx={{
        width: 300,
        height: "100%",
        overflow: "hidden",
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
      elevation={4}
    >
      <Box sx={sidebarContentSx(theme, open)}>
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            px: 1.25,
            py: 0.75,
            minHeight: 44,
            flexShrink: 0,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Typography variant="subtitle1" fontWeight="medium">
            {t("ipAddressQuery.title")}
          </Typography>
          <Box>
            <IconButton
              size="small"
              onClick={onClose}
              sx={{ p: 0.5, "& .MuiSvgIcon-root": { fontSize: 18 } }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        <Box
          sx={{
            p: 2,
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <TextField
            fullWidth
            size="small"
            variant="outlined"
            label={t("ipAddressQuery.ipAddress")}
            placeholder={t("ipAddressQuery.inputPlaceholder")}
            value={ipAddress}
            onChange={(e) => setIpAddress(e.target.value)}
            onKeyDown={handleKeyDown}
            sx={{ mb: 1 }}
          />
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button
              variant="contained"
              color="primary"
              onClick={handleQuery}
              disabled={loading}
              sx={{ flex: 1 }}
            >
              {loading ? (
                <CircularProgress size={24} color="inherit" />
              ) : (
                t("ipAddressQuery.queryButton")
              )}
            </Button>
            <Button
              variant="outlined"
              onClick={handleQueryMyIP}
              disabled={loading}
              sx={{ flex: 1 }}
            >
              {t("ipAddressQuery.queryYourIP")}
            </Button>
          </Box>
        </Box>

        <Box
          sx={{
            flexGrow: 1,
            overflow: "auto",
          }}
        >
          {renderResult()}
        </Box>
        <Box
          sx={{
            borderTop: `1px solid ${theme.palette.divider}`,
            p: 1.5,
            display: "flex",
            flexDirection: "column",
            gap: 1,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <HistoryIcon fontSize="small" color="action" />
              <Typography variant="subtitle2">
                {t("ipAddressQuery.historyTitle")}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
                aria-label={t("ipAddressQuery.toggleHistory")}
              >
                <ExpandMoreIcon
                  fontSize="small"
                  sx={{
                    transform: historyOpen ? "rotate(0deg)" : "rotate(180deg)",
                    transition: theme.transitions.create("transform", {
                      duration: theme.transitions.duration.shortest,
                    }),
                  }}
                />
              </IconButton>
              <IconButton
                size="small"
                onClick={handleClearHistory}
                disabled={history.length === 0 || loading}
                aria-label={t("ipAddressQuery.clearHistory")}
              >
                <DeleteSweepIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
          <Collapse in={historyOpen} timeout="auto" unmountOnExit>
            <Box sx={{ maxHeight: 160, overflow: "auto" }}>
              {history.length === 0 ? (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ px: 1, py: 0.5 }}
                >
                  {t("ipAddressQuery.noHistory")}
                </Typography>
              ) : (
                <List dense disablePadding>
                  {history.map((h) => (
                    <React.Fragment key={h.id}>
                      <ListItem disableGutters disablePadding>
                        <ListItemButton
                          disabled={loading}
                          onClick={() => fetchIPInfo(h.ip)}
                          disableRipple
                          sx={{
                            minHeight: 44,
                            py: 0.75,
                            px: 1,
                            alignItems: "flex-start",
                            borderRadius: 1,
                            overflow: "hidden",
                          }}
                        >
                          <ListItemText
                            primaryTypographyProps={{
                              variant: "body2",
                              noWrap: true,
                            }}
                            secondaryTypographyProps={{
                              variant: "caption",
                              color: "text.secondary",
                              noWrap: true,
                            }}
                            primary={h.ip || t("ipAddressQuery.myIp")}
                            secondary={`${h.locationText || ""} ${new Date(h.time).toLocaleTimeString()}`}
                          />
                        </ListItemButton>
                      </ListItem>
                      <Divider component="li" />
                    </React.Fragment>
                  ))}
                </List>
              )}
            </Box>
          </Collapse>
        </Box>
      </Box>
    </Paper>
  );
});

IPAddressQuery.displayName = "IPAddressQuery";

export default IPAddressQuery;
