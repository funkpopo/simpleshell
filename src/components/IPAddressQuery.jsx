import React, { useState, useEffect, memo, useCallback } from "react";
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
import Tooltip from "@mui/material/Tooltip";
import Grid from "@mui/material/Grid";
import Divider from "@mui/material/Divider";
import { useTranslation } from "react-i18next";

// IP地址查询组件
const IPAddressQuery = memo(({ open, onClose }) => {
  const theme = useTheme();
  const { t } = useTranslation();
  const [ipAddress, setIpAddress] = useState("");
  const [ipInfo, setIpInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 查询IP信息
  const fetchIPInfo = async (ip = "") => {
    try {
      setLoading(true);
      setError(null);

      // 通过preload API进行查询
      if (window.terminalAPI?.queryIpAddress) {
        const result = await window.terminalAPI.queryIpAddress(ip);
        
        if (result.ret === "ok") {
          setIpInfo(result);
        } else {
          throw new Error(result.msg || t("ipAddressQuery.networkError"));
        }
      } else {
        throw new Error("API不可用");
      }
    } catch (err) {
      setError(err.message || t("ipAddressQuery.networkError"));
    } finally {
      setLoading(false);
    }
  };

  // 处理查询按钮点击
  const handleQuery = useCallback(() => {
    if (!ipAddress.trim()) {
      setError(t("ipAddressQuery.invalidIp"));
      return;
    }
    fetchIPInfo(ipAddress);
  }, [ipAddress, t]);

  // 查询本机IP
  const handleQueryMyIP = useCallback(() => {
    setIpAddress("");
    fetchIPInfo();
  }, []);

  // 当侧边栏打开时自动查询本机IP
  useEffect(() => {
    if (open && !ipInfo && !loading && !error) {
      handleQueryMyIP();
    }
  }, [open, ipInfo, loading, error, handleQueryMyIP]);

  // 处理回车键按下事件
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && ipAddress.trim()) {
      handleQuery();
    }
  };

  // 渲染查询结果
  const renderResult = () => {
    if (loading) {
      return (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
          <Typography sx={{ ml: 2 }}>{t("ipAddressQuery.loading")}</Typography>
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
            onClick={() => ipAddress ? handleQuery() : handleQueryMyIP()}
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
          <PublicIcon sx={{ fontSize: 60, color: "text.secondary", opacity: 0.7 }} />
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
            mb: 2
          }}
        >
          <Grid container spacing={1}>
            <Grid item xs={12}>
              <Typography variant="body2">
                <strong>{t("ipAddressQuery.ipAddress")}:</strong> {ipInfo.data?.ip}
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
              <Grid item xs={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.country")}:</strong> {ipInfo.data.location[0]}
                </Typography>
              </Grid>
            )}
            
            {ipInfo.data?.location && ipInfo.data.location.length >= 2 && (
              <Grid item xs={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.province")}:</strong> {ipInfo.data.location[1]}
                </Typography>
              </Grid>
            )}
            
            {ipInfo.data?.location && ipInfo.data.location.length >= 3 && (
              <Grid item xs={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.city")}:</strong> {ipInfo.data.location[2]}
                </Typography>
              </Grid>
            )}
            
            {ipInfo.data?.location && ipInfo.data.location.length >= 4 && (
              <Grid item xs={12}>
                <Typography variant="body2">
                  <strong>{t("ipAddressQuery.isp")}:</strong> {ipInfo.data.location[4] || ipInfo.data.location[3]}
                </Typography>
              </Grid>
            )}
          </Grid>
        </Paper>
      </Box>
    );
  };

  return (
    <Paper
      sx={{
        width: open ? 300 : 0,
        height: "100%",
        overflow: "hidden",
        transition: theme.transitions.create("width", {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
        borderLeft: `1px solid ${theme.palette.divider}`,
        display: "flex",
        flexDirection: "column",
        borderRadius: 0,
      }}
      elevation={4}
    >
      {open && (
        <>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              p: 2,
              borderBottom: `1px solid ${theme.palette.divider}`,
            }}
          >
            <Typography variant="subtitle1" fontWeight="medium">
              {t("ipAddressQuery.title")}
            </Typography>
            <Box>
              <IconButton size="small" onClick={onClose}>
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
                fullWidth
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
              >
                {t("ipAddressQuery.queryYourIP")}
              </Button>
            </Box>
          </Box>

          <Box
            sx={{
              flexGrow: 1,
              overflow: "auto",
              height: "calc(100% - 130px)",
            }}
          >
            {renderResult()}
          </Box>
        </>
      )}
    </Paper>
  );
});

IPAddressQuery.displayName = "IPAddressQuery";

export default IPAddressQuery; 