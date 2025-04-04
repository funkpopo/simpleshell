<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { useI18n } from "../i18n";

// 使用i18n
const { t } = useI18n();

// 添加props接收SSH连接信息
const props = defineProps<{
  sshConnection?: {
    id: string;
    name: string;
    connectionId: string;
  } | null;
}>();

interface SystemInfo {
  osInfo: {
    platform: string;
    release: string;
    arch: string;
  };
  cpuInfo: {
    usage: number;
    model: string;
    cores: number;
  };
  memoryInfo: {
    total: number;
    free: number;
    used: number;
    usedPercentage: number;
  };
}

const systemInfo = ref<SystemInfo>({
  osInfo: {
    platform: "",
    release: "",
    arch: "",
  },
  cpuInfo: {
    usage: 0,
    model: "",
    cores: 0,
  },
  memoryInfo: {
    total: 0,
    free: 0,
    used: 0,
    usedPercentage: 0,
  },
});

// 记录上一次CPU统计信息，用于计算使用率
const lastCpuInfo = ref<{
  idle: number;
  total: number;
} | null>(null);

// 更新系统信息
const updateSystemInfo = async () => {
  try {
    if (props.sshConnection) {
      // 远程系统信息获取
      await updateRemoteSystemInfo();
    } else {
      // 本地系统信息获取
      const info = await window.api.getSystemInfo();
      systemInfo.value = info;
    }
    lastUpdateTime = Date.now();
  } catch (error) {
    console.error("获取系统信息失败:", error);
  }
};

// 获取远程系统信息
const updateRemoteSystemInfo = async () => {
  if (!props.sshConnection?.connectionId) return;

  try {
    // 获取操作系统信息
    const osInfoCmd = "uname -s -r -m";
    const osInfoResult = await window.api.sshExec({
      connectionId: props.sshConnection.connectionId,
      command: osInfoCmd,
    });

    if (osInfoResult.success && osInfoResult.output) {
      const [platform, release, arch] = osInfoResult.output.trim().split(" ");
      systemInfo.value.osInfo = {
        platform,
        release,
        arch,
      };
    }

    // 获取CPU信息
    const cpuInfoCmd =
      "cat /proc/cpuinfo | grep 'model name' | head -n1 && grep -c '^processor' /proc/cpuinfo && cat /proc/stat | grep '^cpu '";
    const cpuInfoResult = await window.api.sshExec({
      connectionId: props.sshConnection.connectionId,
      command: cpuInfoCmd,
    });

    if (cpuInfoResult.success && cpuInfoResult.output) {
      const [modelLine, cores, statLine] = cpuInfoResult.output
        .trim()
        .split("\n");
      const model = modelLine.split(":")[1]?.trim() || "Unknown CPU";

      // 解析CPU统计信息
      const cpuStats = statLine.split(/\s+/).slice(1).map(Number);
      const idle = cpuStats[3];
      const total = cpuStats.reduce((a, b) => a + b, 0);

      // 计算CPU使用率
      let usage = 0;
      if (lastCpuInfo.value) {
        const idleDiff = idle - lastCpuInfo.value.idle;
        const totalDiff = total - lastCpuInfo.value.total;
        usage = 100 - (idleDiff / totalDiff) * 100;
      }

      // 更新CPU信息
      systemInfo.value.cpuInfo = {
        model,
        cores: parseInt(cores) || 1,
        usage: Math.round(usage * 100) / 100,
      };

      // 保存当前统计信息用于下次计算
      lastCpuInfo.value = { idle, total };
    }

    // 获取内存信息
    const memInfoCmd =
      'cat /proc/meminfo | grep -E "^(MemTotal|MemFree|Buffers|Cached):"';
    const memInfoResult = await window.api.sshExec({
      connectionId: props.sshConnection.connectionId,
      command: memInfoCmd,
    });

    if (memInfoResult.success && memInfoResult.output) {
      const memLines = memInfoResult.output.trim().split("\n");
      const memInfo: Record<string, number> = {};

      memLines.forEach((line) => {
        const [key, value] = line.split(":");
        memInfo[key.trim()] = parseInt(value.trim().split(" ")[0]) * 1024; // 转换为字节
      });

      const total = memInfo.MemTotal;
      const free =
        memInfo.MemFree + (memInfo.Buffers || 0) + (memInfo.Cached || 0);
      const used = total - free;

      systemInfo.value.memoryInfo = {
        total,
        free,
        used,
        usedPercentage: Math.round((used / total) * 100 * 100) / 100,
      };
    }
  } catch (error) {
    console.error("获取远程系统信息失败:", error);
  }
};

let updateInterval: ReturnType<typeof setInterval>;
let lastUpdateTime = 0;

// 启动定时器
const startTimer = () => {
  clearInterval(updateInterval);
  updateSystemInfo(); // 立即执行一次更新
  lastUpdateTime = Date.now();
  updateInterval = setInterval(updateSystemInfo, 2000);
};

// 处理页面可见性变化
const handleVisibilityChange = () => {
  if (document.hidden) {
    // 页面隐藏时记录状态，但保持定时器运行
    // (backgroundThrottling: false 配置应该会确保定时器继续运行)
    console.log("页面隐藏，继续在后台运行");
  } else {
    // 页面重新可见时，如果自上次更新已过去较长时间，立即执行更新
    const timeSinceLastUpdate = Date.now() - lastUpdateTime;
    if (timeSinceLastUpdate > 3000) {
      // 如果超过3秒未更新
      console.log("页面重新可见，立即更新数据");
      updateSystemInfo();
      lastUpdateTime = Date.now();
    }
  }
};

onMounted(() => {
  startTimer();
  // 添加页面可见性事件监听
  document.addEventListener("visibilitychange", handleVisibilityChange);
});

onUnmounted(() => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }
  // 移除页面可见性事件监听
  document.removeEventListener("visibilitychange", handleVisibilityChange);
});

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

// 格式化百分比，保留2位小数
const formatPercentage = (value: number): string => {
  return value.toFixed(2);
};

// 计算进度条颜色
const getProgressColor = (value: number) => {
  if (value >= 90) return "#ff4757";
  if (value >= 80) return "#ff6b81";
  if (value >= 70) return "#FF7043";
  if (value >= 60) return "#FFA726";
  return "#4CAF50";
};

const cpuProgressStyle = computed(() => {
  const usage = systemInfo.value.cpuInfo.usage;
  const baseColor = getProgressColor(usage);

  // 根据使用率计算渐变
  return {
    width: `${usage}%`,
    background: `linear-gradient(to right, ${baseColor}, ${baseColor}dd)`,
    boxShadow: usage > 80 ? "0 0 8px rgba(255, 71, 87, 0.6)" : "none",
    animation: usage > 85 ? "pulse 1.5s infinite" : "none",
  };
});

const memoryProgressStyle = computed(() => {
  const usage = systemInfo.value.memoryInfo.usedPercentage;
  const baseColor = getProgressColor(usage);

  // 根据使用率计算渐变
  return {
    width: `${usage}%`,
    background: `linear-gradient(to right, ${baseColor}, ${baseColor}dd)`,
    boxShadow: usage > 80 ? "0 0 8px rgba(255, 71, 87, 0.6)" : "none",
    animation: usage > 85 ? "pulse 1.5s infinite" : "none",
  };
});

// 迷你进度条样式计算属性
const cpuMiniProgressStyle = computed(() => {
  const usage = systemInfo.value.cpuInfo.usage;
  const baseColor = getProgressColor(usage);

  return {
    height: `${usage}%`,
    background: `linear-gradient(to top, ${baseColor}, ${baseColor}dd)`,
    boxShadow: usage > 80 ? "0 0 8px rgba(255, 71, 87, 0.6)" : "none",
    animation:
      usage > 85
        ? "pulse 1.5s infinite, shimmer 2s infinite linear"
        : "shimmer 2s infinite linear",
  };
});

const memoryMiniProgressStyle = computed(() => {
  const usage = systemInfo.value.memoryInfo.usedPercentage;
  const baseColor = getProgressColor(usage);

  return {
    height: `${usage}%`,
    background: `linear-gradient(to top, ${baseColor}, ${baseColor}dd)`,
    boxShadow: usage > 80 ? "0 0 8px rgba(255, 71, 87, 0.6)" : "none",
    animation:
      usage > 85
        ? "pulse 1.5s infinite, shimmer 2s infinite linear"
        : "shimmer 2s infinite linear",
  };
});

// 监听SSH连接状态变化
watch(
  () => props.sshConnection,
  (newConn, oldConn) => {
    if (newConn?.connectionId !== oldConn?.connectionId) {
      // 重置lastCpuInfo
      lastCpuInfo.value = null;
      // 立即更新系统信息
      updateSystemInfo();
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="system-monitor">
    <!-- 迷你监控 -->
    <div class="mini-monitor">
      <!-- CPU 迷你进度条 -->
      <div
        class="mini-progress cpu"
        data-type="CPU"
        :title="`${t('system.cpu')}: ${formatPercentage(systemInfo.cpuInfo.usage)}%\n${t('system.model')}: ${systemInfo.cpuInfo.model}\n${t('system.cores')}: ${systemInfo.cpuInfo.cores}`"
      >
        <div class="mini-progress-bar" :style="cpuMiniProgressStyle"></div>
        <span class="mini-progress-text"
          >{{ formatPercentage(systemInfo.cpuInfo.usage) }}%</span
        >
      </div>

      <!-- 内存迷你进度条 -->
      <div
        class="mini-progress memory"
        data-type="MEM"
        :title="`${t('system.memory')}: ${formatPercentage(systemInfo.memoryInfo.usedPercentage)}%\n${t('system.used')}: ${formatBytes(systemInfo.memoryInfo.used)}\n${t('system.total')}: ${formatBytes(systemInfo.memoryInfo.total)}`"
      >
        <div class="mini-progress-bar" :style="memoryMiniProgressStyle"></div>
        <span class="mini-progress-text"
          >{{ formatPercentage(systemInfo.memoryInfo.usedPercentage) }}%</span
        >
      </div>
    </div>

    <!-- 常规监控内容 -->
    <div class="monitor-content">
      <div class="monitor-section">
        <h3>{{ t("system.os") }}</h3>
        <div class="info-item">
          <span>{{ t("system.platform") }}：</span>
          <span :title="systemInfo.osInfo.platform">{{
            systemInfo.osInfo.platform
          }}</span>
        </div>
        <div class="info-item">
          <span>{{ t("system.version") }}：</span>
          <span :title="systemInfo.osInfo.release">{{
            systemInfo.osInfo.release
          }}</span>
        </div>
        <div class="info-item">
          <span>{{ t("system.arch") }}：</span>
          <span :title="systemInfo.osInfo.arch">{{
            systemInfo.osInfo.arch
          }}</span>
        </div>
      </div>

      <div class="monitor-section">
        <h3>{{ t("system.cpu") }}</h3>
        <div class="info-item">
          <span>{{ t("system.model") }}：</span>
          <span :title="systemInfo.cpuInfo.model">{{
            systemInfo.cpuInfo.model
          }}</span>
        </div>
        <div class="info-item">
          <span>{{ t("system.cores") }}：</span>
          <span>{{ systemInfo.cpuInfo.cores }}</span>
        </div>
        <div class="info-item">
          <span>{{ t("system.usage") }}：</span>
          <div class="progress-bar">
            <div class="progress" :style="cpuProgressStyle"></div>
            <span class="progress-text"
              >{{ formatPercentage(systemInfo.cpuInfo.usage) }}%</span
            >
          </div>
        </div>
      </div>

      <div class="monitor-section">
        <h3>{{ t("system.memory") }}</h3>
        <div class="info-item">
          <span>{{ t("system.total") }}：</span>
          <span>{{ formatBytes(systemInfo.memoryInfo.total) }}</span>
        </div>
        <div class="info-item">
          <span>{{ t("system.used") }}：</span>
          <span>{{ formatBytes(systemInfo.memoryInfo.used) }}</span>
        </div>
        <div class="info-item">
          <span>{{ t("system.usage") }}：</span>
          <div class="progress-bar">
            <div class="progress" :style="memoryProgressStyle"></div>
            <span class="progress-text"
              >{{
                formatPercentage(systemInfo.memoryInfo.usedPercentage)
              }}%</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system-monitor {
  padding: 8px 4px 8px 0;
  color: var(--text-color);
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  scrollbar-width: thin;
  scrollbar-color: rgba(128, 128, 128, 0.4) transparent;
  overflow-y: auto;
  max-height: 100%;
  overflow-x: hidden;
}

/* 添加迷你监控样式 */
.right-sidebar-collapsed .system-monitor {
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  width: 40px;
  box-sizing: border-box;
  overflow: visible;
}

.right-sidebar-collapsed .monitor-section {
  width: 40px !important;
  padding: 0 !important;
  margin: 0 !important;
  background: none !important;
  box-shadow: none !important;
  display: flex;
  justify-content: center;
  overflow: visible;
}

/* 迷你进度条容器 */
.mini-monitor {
  display: none;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 8px 0;
  flex-direction: column;
  gap: 12px;
  align-items: center;
}

.right-sidebar-collapsed .mini-monitor {
  display: flex;
  height: auto;
  padding: 12px 0;
  gap: 20px;
  position: absolute;
  top: 0;
  left: 0;
  width: 40px;
  z-index: 100;
}

/* 迷你进度条样式 */
.mini-progress {
  width: 28px;
  height: 60px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
  position: relative;
  overflow: hidden;
  cursor: help;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  align-items: center;
  transition: all 0.3s ease;
  backdrop-filter: blur(1px);
}

/* 增加进度条悬停效果 */
.mini-progress:hover {
  transform: translateY(-2px);
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 4px 8px rgba(0, 0, 0, 0.15);
}

/* 折叠状态下优化mini-progress样式 */
.right-sidebar-collapsed .mini-progress {
  width: 32px;
  height: 80px;
  border-radius: 16px;
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.3),
    0 2px 4px rgba(0, 0, 0, 0.1);
}

/* 进度条内添加刻度线 */
.mini-progress::after {
  content: "";
  position: absolute;
  top: 5%;
  left: 0;
  width: 100%;
  height: 90%;
  background: repeating-linear-gradient(
    to bottom,
    transparent,
    transparent 19%,
    rgba(255, 255, 255, 0.1) 19%,
    rgba(255, 255, 255, 0.1) 20%
  );
  pointer-events: none;
}

.mini-progress::before {
  content: attr(data-type);
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 8px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.9);
  z-index: 2;
  letter-spacing: 0;
  padding: 1px 2px;
  border-radius: 3px;
  white-space: nowrap;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(2px);
}

/* 折叠状态下优化标签样式 */
.right-sidebar-collapsed .mini-progress::before {
  top: 6px;
  font-size: 10px;
  padding: 2px 4px;
  font-weight: 600;
}

.mini-progress-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  transition: height 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 -1px 0 rgba(0, 0, 0, 0.1) inset;
  background-size: 200% 100%;
  animation: shimmer 2s infinite linear;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: 0 0;
  }
}

/* 折叠状态下优化进度条样式 */
.right-sidebar-collapsed .mini-progress-bar {
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.4) inset,
    0 -1px 0 rgba(0, 0, 0, 0.2) inset;
}

.mini-progress-text {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  color: white;
  font-size: 7px;
  font-weight: 400;
  z-index: 1;
  white-space: nowrap;
  letter-spacing: -0.3px;
  padding: 1px 2px;
  text-shadow:
    0 1px 1px rgba(0, 0, 0, 0.7),
    0 0 3px rgba(0, 0, 0, 0.5);
  transition: all 0.3s ease;
}

/* 折叠状态下优化文本样式 */
.right-sidebar-collapsed .mini-progress-text {
  bottom: 6px;
  font-size: 10px;
  padding: 0;
  letter-spacing: 0;
  font-weight: 500;
  text-shadow:
    0 1px 2px rgba(0, 0, 0, 0.8),
    0 0 4px rgba(0, 0, 0, 0.6);
}

.mini-progress.cpu {
  --progress-color: #4caf50;
  --progress-gradient: linear-gradient(
    180deg,
    rgba(76, 175, 80, 0.9) 0%,
    rgba(76, 175, 80, 1) 50%,
    rgba(56, 142, 60, 1) 100%
  );
}

.mini-progress.memory {
  --progress-color: #2196f3;
  --progress-gradient: linear-gradient(
    180deg,
    rgba(33, 150, 243, 0.9) 0%,
    rgba(33, 150, 243, 1) 50%,
    rgba(25, 118, 210, 1) 100%
  );
}

/* 暗色主题下的迷你监控样式 */
.dark-theme .mini-progress {
  box-shadow:
    inset 0 2px 4px rgba(0, 0, 0, 0.4),
    0 1px 0 rgba(255, 255, 255, 0.05);
}

.dark-theme .mini-progress::before {
  background: rgba(0, 0, 0, 0.4);
}

.dark-theme .mini-progress-text {
  background: none;
}

.dark-theme .mini-progress-bar {
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.2) inset;
}

/* 隐藏折叠状态下的常规监控内容 */
.right-sidebar-collapsed .monitor-content {
  display: none;
}

/* 确保mini-monitor在折叠状态下可见 */
.right-sidebar-collapsed .system-monitor .mini-monitor {
  display: flex;
  opacity: 1;
  visibility: visible;
}

.monitor-section {
  margin-bottom: 8px;
  margin-left: 0;
  margin-right: 0;
  background: var(--section-bg-color);
  padding: 5px 10px;
  border-radius: 8px;
  box-shadow: var(--section-shadow);
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
}

.monitor-section:last-child {
  margin-bottom: 0;
}

.monitor-section h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: var(--text-color);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.info-item {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
  min-width: 0;
  width: 100%;
}

.info-item:last-child {
  margin-bottom: 0;
}

.info-item > span:first-child {
  min-width: 70px;
  max-width: 70px;
  flex: 0 0 70px;
  color: var(--text-color-light);
  white-space: nowrap;
  margin-right: 0px;
}

.info-item > span:last-child {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  padding-right: 0px;
  margin-left: 0;
}

.info-item > span:last-child:hover {
  position: relative;
}

.info-item > span:last-child[title] {
  cursor: help;
}

.progress-bar {
  flex: 1;
  min-width: 0;
  height: 16px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.2);
}

.progress {
  height: 100%;
  transition: all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  box-shadow:
    0 1px 0 rgba(255, 255, 255, 0.3) inset,
    0 -1px 0 rgba(0, 0, 0, 0.1) inset;
  min-width: 0;
  position: relative;
  overflow: hidden;
}

.progress::after {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0) 0%,
    rgba(255, 255, 255, 0.4) 50%,
    rgba(255, 255, 255, 0) 100%
  );
  width: 100%;
  transform: translateX(-100%);
  animation: shimmer-horizontal 2s infinite;
}

@keyframes shimmer-horizontal {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(100%);
  }
}

@keyframes pulse {
  0% {
    opacity: 0.8;
  }
  50% {
    opacity: 1;
  }
  100% {
    opacity: 0.8;
  }
}

.progress.warning {
  background: linear-gradient(to right, #ff4757, #ff6b81);
}

@property --progress-color {
  syntax: "<color>";
  initial-value: #4caf50;
  inherits: false;
}

.progress {
  --progress-color: #4caf50;
  background: linear-gradient(
    to right,
    var(--progress-color),
    color-mix(in srgb, var(--progress-color), white 20%)
  );
}

.progress[style*="width: 6"] {
  --progress-color: #ffa726;
}
.progress[style*="width: 7"] {
  --progress-color: #ff7043;
}
.progress[style*="width: 8"] {
  --progress-color: #ff4757;
}
.progress[style*="width: 9"] {
  --progress-color: #ff4757;
}

.progress-text {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  color: white;
  font-weight: 500;
  white-space: nowrap;
  min-width: 35px;
  text-align: right;
  z-index: 5;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  transition: all 0.3s ease;
}

:root {
  --text-color: #333;
  --text-color-light: #666;
  --section-bg-color: rgba(0, 0, 0, 0.05);
  --section-shadow: inset 0 1px 1px rgba(0, 0, 0, 0.1);
}

:root .dark-theme {
  --text-color: #fff;
  --text-color-light: #aaa;
  --section-bg-color: rgba(255, 255, 255, 0.05);
  --section-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.1);
}

/* 滚动条样式已移至全局CSS */
/* 组件特定的溢出处理 */
.system-monitor {
  overflow-y: auto;
  max-height: 100%;
  overflow-x: hidden;
}

/* 折叠状态下的布局调整 */
.right-sidebar-collapsed .system-monitor {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 0;
}
</style>
