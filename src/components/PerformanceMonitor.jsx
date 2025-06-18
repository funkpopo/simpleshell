import React, { useState, useEffect, useRef } from "react";
import {
  Box,
  Card,
  CardContent,
  Typography,
  Grid,
  LinearProgress,
  Chip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  ExpandMore as ExpandMoreIcon,
  Refresh as RefreshIcon,
  Memory as MemoryIcon,
  Speed as SpeedIcon,
  Image as ImageIcon,
  Computer as ComputerIcon,
} from "@mui/icons-material";
import { imageSupport } from "../utils/imageSupport.js";

const PerformanceMonitor = ({ isVisible = false }) => {
  const [performanceData, setPerformanceData] = useState({
    fps: 0,
    averageFps: 0,
    frameCount: 0,
    renderer: "unknown",
    rendererState: "unknown",
  });

  const [memoryData, setMemoryData] = useState({
    used: 0,
    total: 0,
    percentage: 0,
  });

  const [imageData, setImageData] = useState({
    totalImages: 0,
    memoryUsage: 0,
    memoryLimit: 0,
    usagePercent: 0,
    supported: false,
  });

  const [systemInfo, setSystemInfo] = useState({
    webglSupport: false,
    deviceMemory: 0,
    cores: 0,
    performanceLevel: "unknown",
  });

  const intervalRef = useRef(null);

  // 更新性能数据
  const updatePerformanceData = () => {
    try {
      setPerformanceData({
        fps: Math.round(metrics.fps || 0),
        averageFps: Math.round(metrics.averageFps || 0),
        frameCount: metrics.frameCount || 0,
        renderer: rendererInfo.current || "unknown",
        rendererState: rendererInfo.state || "unknown",
      });

      // 获取图像统计信息
      const imageStats = imageSupport.getImageStats();
      const imageSupportInfo = imageSupport.getSupportInfo();

      setImageData({
        totalImages: imageStats.totalImages || 0,
        memoryUsage:
          Math.round(((imageStats.memoryUsage || 0) / 1024 / 1024) * 100) / 100, // MB
        memoryLimit: imageStats.memoryLimit
          ? Math.round(imageStats.memoryLimit / 1024 / 1024)
          : 0, // MB
        usagePercent: Math.round(imageStats.usagePercent || 0),
        supported: imageSupportInfo.initialized || false,
      });

      // 获取系统信息
      const rendererDetection = rendererInfo.webglSupport || {};
      const performanceDetection = rendererInfo.performanceLevel || {};

      setSystemInfo({
        webglSupport: rendererDetection.supported || false,
        deviceMemory: performanceDetection.metrics?.memory || 0,
        cores: performanceDetection.metrics?.cores || 0,
        performanceLevel: performanceDetection.performanceLevel || "unknown",
      });

      // 估算内存使用（简化版本）
      if (performance.memory) {
        const used = Math.round(
          performance.memory.usedJSHeapSize / 1024 / 1024,
        );
        const total = Math.round(
          performance.memory.totalJSHeapSize / 1024 / 1024,
        );
        setMemoryData({
          used,
          total,
          percentage: total > 0 ? Math.round((used / total) * 100) : 0,
        });
      }
    } catch (error) {
      console.error("性能数据更新失败:", error);
    }
  };

  // 手动刷新
  const handleRefresh = () => {
    updatePerformanceData();
  };

  // 定期更新数据
  useEffect(() => {
    if (isVisible) {
      updatePerformanceData();
      intervalRef.current = setInterval(updatePerformanceData, 2000); // 每2秒更新
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isVisible]);

  if (!isVisible) {
    return null;
  }

  // 获取性能等级颜色
  const getPerformanceColor = (level) => {
    switch (level) {
      case "high":
        return "success";
      case "medium":
        return "warning";
      case "low":
        return "error";
      default:
        return "default";
    }
  };

  // 获取FPS颜色
  const getFpsColor = (fps) => {
    if (fps >= 50) return "success";
    if (fps >= 30) return "warning";
    return "error";
  };

  return (
    <Box sx={{ p: 2, maxHeight: "80vh", overflow: "auto" }}>
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6">性能监控</Typography>
        <Tooltip title="刷新数据">
          <IconButton onClick={handleRefresh} size="small">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Box>

      <Grid container spacing={2}>
        {/* 渲染性能 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <SpeedIcon sx={{ mr: 1 }} />
                <Typography variant="h6">渲染性能</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    当前FPS
                  </Typography>
                  <Chip
                    label={performanceData.fps}
                    color={getFpsColor(performanceData.fps)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    平均FPS
                  </Typography>
                  <Chip
                    label={performanceData.averageFps}
                    color={getFpsColor(performanceData.averageFps)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    渲染器
                  </Typography>
                  <Typography variant="body1">
                    {performanceData.renderer}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    状态
                  </Typography>
                  <Typography variant="body1">
                    {performanceData.rendererState}
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* 内存使用 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <MemoryIcon sx={{ mr: 1 }} />
                <Typography variant="h6">内存使用</Typography>
              </Box>
              <Box sx={{ mb: 1 }}>
                <Typography variant="body2" color="textSecondary">
                  {memoryData.used}MB / {memoryData.total}MB (
                  {memoryData.percentage}%)
                </Typography>
                <LinearProgress
                  variant="determinate"
                  value={memoryData.percentage}
                  color={
                    memoryData.percentage > 80
                      ? "error"
                      : memoryData.percentage > 60
                        ? "warning"
                        : "primary"
                  }
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* 图像支持 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <ImageIcon sx={{ mr: 1 }} />
                <Typography variant="h6">图像支持</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    支持状态
                  </Typography>
                  <Chip
                    label={imageData.supported ? "已启用" : "未启用"}
                    color={imageData.supported ? "success" : "default"}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    图像数量
                  </Typography>
                  <Typography variant="body1">
                    {imageData.totalImages}
                  </Typography>
                </Grid>
                <Grid item xs={12}>
                  <Typography variant="body2" color="textSecondary">
                    图像内存: {imageData.memoryUsage}MB /{" "}
                    {imageData.memoryLimit}MB ({imageData.usagePercent}%)
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={imageData.usagePercent}
                    color={imageData.usagePercent > 80 ? "error" : "primary"}
                  />
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* 系统信息 */}
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
                <ComputerIcon sx={{ mr: 1 }} />
                <Typography variant="h6">系统信息</Typography>
              </Box>
              <Grid container spacing={2}>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    WebGL支持
                  </Typography>
                  <Chip
                    label={systemInfo.webglSupport ? "支持" : "不支持"}
                    color={systemInfo.webglSupport ? "success" : "error"}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    性能等级
                  </Typography>
                  <Chip
                    label={systemInfo.performanceLevel}
                    color={getPerformanceColor(systemInfo.performanceLevel)}
                    size="small"
                  />
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    CPU核心
                  </Typography>
                  <Typography variant="body1">
                    {systemInfo.cores || "N/A"}
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Typography variant="body2" color="textSecondary">
                    设备内存
                  </Typography>
                  <Typography variant="body1">
                    {systemInfo.deviceMemory || "N/A"}GB
                  </Typography>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* 详细信息 */}
      <Accordion sx={{ mt: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography>详细信息</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>指标</TableCell>
                  <TableCell>值</TableCell>
                  <TableCell>说明</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>总帧数</TableCell>
                  <TableCell>{performanceData.frameCount}</TableCell>
                  <TableCell>自启动以来渲染的总帧数</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>渲染器类型</TableCell>
                  <TableCell>{performanceData.renderer}</TableCell>
                  <TableCell>当前使用的渲染器</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>图像缓存</TableCell>
                  <TableCell>{imageData.totalImages}</TableCell>
                  <TableCell>当前缓存的图像数量</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

export default PerformanceMonitor;
