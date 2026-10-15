/**
 * 远程资源快照合并模块（系统信息 + 指标样本）
 *
 * 资源监控面板每 5s 轮询原需两次独立远程调用：
 * - getRemoteSystemInfo：uname/发行版/主机名/内存/CPU 多次 SSH exec
 *   （含两次 /proc/stat 采样与 600ms 间隔）
 * - getRemoteMetricsSample：一次合并 exec 读取 /proc
 *
 * 这里改为单次 SSH exec 同时拉取系统信息与指标样本所需的全部数据，
 * 解析复用 metrics-sample 的解析器与差分状态（remoteCounterState），
 * 系统信息卡片的 CPU 使用率直接采用差分结果（比原 600ms 双采样更稳定）。
 * uname 含 Windows 或 uname 失败时降级为原两次独立实现，行为不变。
 */

const { t: translateLocale, getUiLanguage } = require("../../shared/mainI18n");
const configService = require("../settings/configService");
const { isSshClientUsable } = require("../utils/ssh-utils");
const {
  execSshCapture,
  parseProcStatCpu,
  parseProcMeminfo,
  parseProcNetDev,
  parseProcDiskstats,
  parseDfOutput,
  computePerSec,
  formatResult,
  remoteCounterState,
  getRemoteMetricsSample,
} = require("./metrics-sample");
const { getRemoteSystemInfo } = require("./remote-system");

const systemInfoText = (key, params = {}) =>
  translateLocale(key, { lng: getUiLanguage(configService), ...params });

const SNAPSHOT_MARKERS = Object.freeze([
  "---SIMPLESHELL-UNAME---",
  "---SIMPLESHELL-DISTRO---",
  "---SIMPLESHELL-HOST---",
  "---SIMPLESHELL-MEM---",
  "---SIMPLESHELL-CPU---",
  "---SIMPLESHELL-STAT---",
  "---SIMPLESHELL-NET---",
  "---SIMPLESHELL-DISK---",
  "---SIMPLESHELL-END---",
]);

/**
 * Linux 合并快照命令：一次 SSH exec 同时拉取系统信息（uname/发行版/主机名/CPU）
 * 与指标样本（stat/meminfo/net/diskstats/df），避免多次往返的开销与速率失真。
 * 发行版检测优先级与 getRemoteSystemInfo 一致：
 * /etc/os-release → lsb_release → /etc/redhat-release → /etc/debian_version（命中一种即停）。
 */
const REMOTE_RESOURCE_SNAPSHOT_COMMAND = [
  "uname -a 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[0]}`,
  'if [ -s /etc/os-release ]; then grep -E "^(NAME|VERSION)=" /etc/os-release 2>/dev/null; elif command -v lsb_release >/dev/null 2>&1; then lsb_release -a 2>/dev/null; elif [ -s /etc/redhat-release ]; then cat /etc/redhat-release 2>/dev/null; elif [ -s /etc/debian_version ]; then cat /etc/debian_version 2>/dev/null; fi',
  `echo ${SNAPSHOT_MARKERS[1]}`,
  "hostname 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[2]}`,
  "cat /proc/meminfo 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[3]}`,
  "awk '/^processor/{c++} END{print (c?c:1)+0}' /proc/cpuinfo 2>/dev/null",
  'grep "model name" /proc/cpuinfo 2>/dev/null | head -1',
  `echo ${SNAPSHOT_MARKERS[4]}`,
  "cat /proc/stat 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[5]}`,
  "cat /proc/net/dev 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[6]}`,
  "cat /proc/diskstats 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[7]}`,
  "df -P -k 2>/dev/null",
  `echo ${SNAPSHOT_MARKERS[8]}`,
].join("; ");

/** 按标记切分合并命令输出（sections[marker] = 该标记之前的分片内容） */
function splitSnapshotSections(output) {
  const sections = {};
  let cursor = 0;
  for (const marker of SNAPSHOT_MARKERS) {
    const idx = output.indexOf(marker, cursor);
    if (idx === -1) break;
    sections[marker] = output.slice(cursor, idx);
    cursor = idx + marker.length;
  }
  return sections;
}

/** 由发行版分片解析 os.distro/os.version/os.release（与原实现的优先级一致） */
function applyDistroInfo(os, distroText) {
  const distro = distroText.trim();
  if (!distro) {
    os.release = "Linux";
    return;
  }

  const nameMatch = distro.match(/NAME="([^"]+)"/);
  const distroIdMatch = distro.match(/Distributor ID:\s+(.+)/);
  if (nameMatch) {
    // os-release 格式
    os.distro = nameMatch[1];
    const versionMatch = distro.match(/VERSION="([^"]+)"/);
    if (versionMatch) os.version = versionMatch[1];
    os.release = `${os.distro || "Linux"} ${os.version || ""}`.trim();
    return;
  }

  if (distroIdMatch) {
    // lsb_release 格式
    os.distro = distroIdMatch[1].trim();
    const releaseMatch = distro.match(/Release:\s+(.+)/);
    if (releaseMatch) os.version = releaseMatch[1].trim();
    os.release = `${os.distro || "Linux"} ${os.version || ""}`.trim();
    return;
  }

  // redhat-release / debian_version 文件内容
  os.release = distro;
  os.distro = distro.split(" ")[0] || "Linux";
  const versionMatch = distro.match(/(\d+(\.\d+)+)/);
  if (versionMatch) os.version = versionMatch[1];
}

/** 由 CPU 分片（awk 核心数 + model name 行）解析 os.cpu 核心数与型号 */
function applyCpuInfo(cpu, cpuInfoText) {
  const lines = cpuInfoText
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return;

  if (/^\d+$/.test(lines[0])) {
    cpu.cores = parseInt(lines[0], 10) || 1;
  }
  for (const line of lines) {
    const match = line.match(/model name\s*:\s*(.*)/);
    if (match && match[1]) {
      cpu.model = match[1].trim();
      break;
    }
  }
}

/** 降级：非 Linux（Windows）或 uname 不可用时使用原两次独立实现 */
async function legacyResourceSnapshot(sshClient) {
  const [info, sample] = await Promise.all([
    getRemoteSystemInfo(sshClient),
    getRemoteMetricsSample(sshClient),
  ]);
  return { info, sample };
}

/**
 * 单次远程调用同时获取系统信息与指标样本。
 * @returns {Promise<{info: object, sample: object}>} 与
 * getRemoteSystemInfo / getRemoteMetricsSample 结果结构一致
 */
async function getRemoteResourceSnapshot(sshClient) {
  if (!isSshClientUsable(sshClient)) {
    throw new Error("SSH connection not available");
  }

  let output = null;
  try {
    output = await execSshCapture(sshClient, REMOTE_RESOURCE_SNAPSHOT_COMMAND);
  } catch {
    output = null;
  }

  if (!output || !output.includes(SNAPSHOT_MARKERS[8])) {
    // 合并命令不可用（非 Linux/超时）时降级为原两次独立实现
    return legacyResourceSnapshot(sshClient);
  }

  const sections = splitSnapshotSections(output);
  const unameText = (sections[SNAPSHOT_MARKERS[0]] ?? "").trim();
  const distroText = sections[SNAPSHOT_MARKERS[1]] ?? "";
  const hostText = (sections[SNAPSHOT_MARKERS[2]] ?? "").trim();
  const meminfoText = sections[SNAPSHOT_MARKERS[3]] ?? "";
  const cpuInfoText = sections[SNAPSHOT_MARKERS[4]] ?? "";
  const statText = sections[SNAPSHOT_MARKERS[5]] ?? "";
  const netdevText = sections[SNAPSHOT_MARKERS[6]] ?? "";
  const diskstatsText = sections[SNAPSHOT_MARKERS[7]] ?? "";
  const dfText = (sections[SNAPSHOT_MARKERS[8]] ?? "").trim();

  // uname 含 Windows：走原独立实现（wmic/PowerShell 路径）
  if (/Windows/i.test(unameText)) {
    return legacyResourceSnapshot(sshClient);
  }

  const unknownLabel = systemInfoText("common.unknown");
  const info = {
    isLocal: false,
    os: {
      type: unknownLabel,
      platform: unknownLabel,
      release: unknownLabel,
      hostname: unknownLabel,
      distro: unknownLabel,
      version: unknownLabel,
    },
    cpu: { model: unknownLabel, cores: 0, usage: 0 },
    memory: { total: 0, free: 0, used: 0, usagePercent: 0 },
    processes: [],
  };

  if (unameText) {
    if (unameText.includes("Linux")) {
      info.os.type = "Linux";
      info.os.platform = "linux";
      applyDistroInfo(info.os, distroText);
    } else {
      // 未识别的系统，与原实现一致：release 保存 uname 文本
      info.os.release = unameText;
    }
  }
  if (hostText) info.os.hostname = hostText;

  const memInfo = parseProcMeminfo(meminfoText) ?? {
    total: 0,
    used: 0,
    free: 0,
    usagePercent: 0,
  };
  info.memory = memInfo;

  applyCpuInfo(info.cpu, cpuInfoText);

  // ===== 指标样本（与 getRemoteMetricsSample 相同的差分逻辑） =====
  const ts = Date.now();
  const cpuStat = parseProcStatCpu(statText);
  const netCounters = parseProcNetDev(netdevText);
  const diskCounters = parseProcDiskstats(diskstatsText);
  const disks = parseDfOutput(dfText);

  const prev = remoteCounterState.get(sshClient) || null;
  const elapsed = prev ? ts - prev.ts : 0;

  // 系统信息卡片的 CPU 使用率直接采用差分结果；无上次样本时用开机以来均值兜底
  let cpu = null;
  if (cpuStat) {
    if (prev?.cpuStat) {
      const totalDiff = cpuStat.total - prev.cpuStat.total;
      const idleDiff = cpuStat.idle - prev.cpuStat.idle;
      if (totalDiff > 0) {
        cpu = ((totalDiff - idleDiff) / totalDiff) * 100;
      }
    } else {
      cpu = ((cpuStat.total - cpuStat.idle) / cpuStat.total) * 100;
    }
  }
  if (Number.isFinite(cpu)) {
    info.cpu.usage = Math.max(0, Math.min(100, Math.round(cpu)));
    cpu = Math.max(0, Math.min(100, Math.round(cpu)));
  } else {
    cpu = null;
  }

  remoteCounterState.set(sshClient, { ts, cpuStat, netCounters, diskCounters });

  const sample = formatResult(
    ts,
    cpu,
    memInfo,
    {
      rxPerSec: netCounters
        ? computePerSec(netCounters.rx, prev?.netCounters?.rx, elapsed)
        : null,
      txPerSec: netCounters
        ? computePerSec(netCounters.tx, prev?.netCounters?.tx, elapsed)
        : null,
    },
    {
      readPerSec: diskCounters
        ? computePerSec(
            diskCounters.readBytes,
            prev?.diskCounters?.readBytes,
            elapsed,
          )
        : null,
      writePerSec: diskCounters
        ? computePerSec(
            diskCounters.writeBytes,
            prev?.diskCounters?.writeBytes,
            elapsed,
          )
        : null,
    },
    disks,
  );

  return { info, sample };
}

module.exports = {
  getRemoteResourceSnapshot,
  legacyResourceSnapshot,
  // 暴露给测试/复用
  splitSnapshotSections,
  applyDistroInfo,
  applyCpuInfo,
  REMOTE_RESOURCE_SNAPSHOT_COMMAND,
};
