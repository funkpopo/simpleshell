/**
 * 资源指标采样模块（监控历史曲线数据源）
 *
 * 与 system-info 的“快照”不同，这里输出的是带速率的增量样本：
 * - CPU 使用率（%）
 * - 内存使用率（%）与总量
 * - 网络吞吐（下行/上行 bytes/sec，与上次采样的差分）
 * - 磁盘 IO（读/写 bytes/sec，与上次采样的差分）
 * - 磁盘分区用量（df / wmic / systeminformation fsSize）
 *
 * 本地走 systeminformation；远程经 SSH 执行合并命令读取 /proc，
 * 差分状态按 sshClient 存放在 WeakMap 中（连接断开自动回收）。
 */

const os = require("os");
const si = require("systeminformation");
const { isSshClientUsable } = require("../../core/utils/ssh-utils");

const SECTOR_SIZE = 512;
// /proc/diskstats 中过滤掉虚拟/重叠设备，避免 dm-/loop 等与底层盘重复计数
const DISKSTATS_SKIP_PREFIXES = ["dm-", "loop", "ram", "zram", "md", "fd", "sr"];

// ===================== 差分状态 =====================

// 本地差分状态（单实例）
let localCounterState = null;
// 远程差分状态：sshClient -> { ts, cpuIdle, cpuTotal, netRx, netTx, diskRead, diskWrite }
const remoteCounterState = new WeakMap();

// ===================== 工具函数 =====================

const toFiniteNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const clampPercent = (value) =>
  Math.max(0, Math.min(100, Math.round(toFiniteNumber(value))));

/**
 * 由累计计数器差分计算每秒速率
 * @returns {number|null} 无上一次样本或间隔非法时返回 null（图表留空）
 */
const computePerSec = (current, previous, elapsedMs) => {
  if (!previous || !Number.isFinite(previous) || elapsedMs <= 0) {
    return null;
  }
  const delta = toFiniteNumber(current) - toFiniteNumber(previous);
  if (delta < 0) {
    // 计数器回绕/重置（如重启），本次不计算
    return null;
  }
  return (delta / elapsedMs) * 1000;
};

const formatResult = (ts, cpu, memory, net, diskIo, disks) => ({
  ts,
  cpu,
  memory,
  net,
  diskIo,
  disks,
});

// ===================== 本地实现 =====================

async function getLocalDiskUsage() {
  try {
    const fsSizes = await si.fsSize();
    return fsSizes
      .filter((d) => d && d.mount && d.size > 0)
      .map((d) => ({
        mount: d.mount,
        total: toFiniteNumber(d.size),
        used: toFiniteNumber(d.used),
        free: Math.max(0, toFiniteNumber(d.size) - toFiniteNumber(d.used)),
        usedPercent: clampPercent(d.use),
      }))
      .sort((a, b) => b.usedPercent - a.usedPercent);
  } catch (error) {
    console.error("[metrics-sample] getLocalDiskUsage failed:", error.message);
    return [];
  }
}

async function getLocalMetricsSample() {
  const ts = Date.now();

  const [load, mem, networkStats, fsStats, disks] = await Promise.all([
    si.currentLoad().catch(() => null),
    si.mem().catch(() => null),
    si.networkStats().catch(() => []),
    si.fsStats().catch(() => null),
    getLocalDiskUsage(),
  ]);

  // CPU
  const cpu = load ? clampPercent(load.currentLoad) : null;

  // 内存
  const memory = mem
    ? {
        total: toFiniteNumber(mem.total),
        used: toFiniteNumber(mem.used),
        free: toFiniteNumber(mem.available ?? mem.free),
        usagePercent:
          mem.total > 0
            ? clampPercent((toFiniteNumber(mem.used) / mem.total) * 100)
            : 0,
      }
    : { total: 0, used: 0, free: 0, usagePercent: 0 };

  // 网络：si.networkStats 自带 rx_sec/tx_sec；汇总所有非内部接口
  let rxPerSec = null;
  let txPerSec = null;
  if (Array.isArray(networkStats) && networkStats.length > 0) {
    let rx = 0;
    let tx = 0;
    let hasValue = false;
    for (const stat of networkStats) {
      if (!stat || stat.internal) continue;
      if (Number.isFinite(stat.rx_sec) && stat.rx_sec >= 0) {
        rx += stat.rx_sec;
        hasValue = true;
      }
      if (Number.isFinite(stat.tx_sec) && stat.tx_sec >= 0) {
        tx += stat.tx_sec;
        hasValue = true;
      }
    }
    if (hasValue) {
      rxPerSec = rx;
      txPerSec = tx;
    }
  }

  // 磁盘 IO：优先用 si 自带的速率，否则用累计字节数差分
  let readPerSec = null;
  let writePerSec = null;
  if (
    fsStats &&
    Number.isFinite(fsStats.rx_sec) &&
    fsStats.rx_sec >= 0 &&
    Number.isFinite(fsStats.wx_sec) &&
    fsStats.wx_sec >= 0
  ) {
    readPerSec = fsStats.rx_sec;
    writePerSec = fsStats.wx_sec;
  } else if (fsStats && Number.isFinite(fsStats.rx)) {
    const prev = localCounterState;
    const elapsed = prev ? ts - prev.ts : 0;
    readPerSec = computePerSec(fsStats.rx, prev?.readBytes, elapsed);
    writePerSec = computePerSec(fsStats.wx, prev?.writeBytes, elapsed);
  }
  localCounterState = {
    ts,
    readBytes: fsStats ? fsStats.rx : null,
    writeBytes: fsStats ? fsStats.wx : null,
  };

  return formatResult(
    ts,
    cpu,
    memory,
    { rxPerSec, txPerSec },
    { readPerSec, writePerSec },
    disks,
  );
}

// ===================== 远程实现 =====================

/**
 * Linux 合并采样命令：一次 SSH exec 拉取全部 /proc 数据与 df，
 * 避免多次往返带来的开销与速率失真。
 */
const REMOTE_METRICS_COMMAND =
  "cat /proc/stat 2>/dev/null; echo ---SIMPLESHELL-MEM---; cat /proc/meminfo 2>/dev/null; echo ---SIMPLESHELL-NET---; cat /proc/net/dev 2>/dev/null; echo ---SIMPLESHELL-DISK---; cat /proc/diskstats 2>/dev/null; echo ---SIMPLESHELL-DF---; df -P -k 2>/dev/null; echo ---SIMPLESHELL-END---";

function execSshCapture(sshClient, command, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    if (!isSshClientUsable(sshClient)) {
      reject(new Error("SSH connection not available"));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("SSH command timeout"));
    }, timeoutMs);

    try {
      sshClient.exec(command, (err, stream) => {
        if (err) {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(err);
          }
          return;
        }

        let stdout = "";
        stream.on("data", (data) => {
          stdout += data.toString();
        });
        stream.on("error", (e) => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(e);
          }
        });
        stream.on("close", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve(stdout);
          }
        });
      });
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
    }
  });
}

function parseProcStatCpu(text) {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.startsWith("cpu "));
  if (!line) return null;

  const nums = line.split(/\s+/).slice(1).map((v) => parseInt(v, 10) || 0);
  if (nums.length < 4) return null;
  const total = nums.reduce((sum, n) => sum + n, 0);
  const idle = (nums[3] || 0) + (nums[4] || 0); // idle + iowait
  if (total <= 0) return null;
  return { idle, total };
}

function parseProcMeminfo(text) {
  const toKib = (v) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : 0;
  };
  const totalKib = toKib(text.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? "0");
  if (totalKib <= 0) return null;

  const availableKib = toKib(
    text.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? "NaN",
  );
  const freeKib = toKib(text.match(/^MemFree:\s+(\d+)/m)?.[1] ?? "0");
  const buffersKib = toKib(text.match(/^Buffers:\s+(\d+)/m)?.[1] ?? "0");
  const cachedKib =
    toKib(text.match(/^Cached:\s+(\d+)/m)?.[1] ?? "0") +
    toKib(text.match(/^SReclaimable:\s+(\d+)/m)?.[1] ?? "0");

  const freeLikeKib =
    availableKib > 0 ? availableKib : freeKib + buffersKib + cachedKib;
  const total = totalKib * 1024;
  const free = Math.max(0, freeLikeKib * 1024);
  const used = Math.max(0, total - free);

  return {
    total,
    used,
    free,
    usagePercent: total > 0 ? clampPercent((used / total) * 100) : 0,
  };
}

function parseProcNetDev(text) {
  let rx = 0;
  let tx = 0;
  let found = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.includes("|")) continue;
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) continue;

    const iface = match[1].trim();
    if (!iface || iface === "lo") continue;

    const fields = match[2].trim().split(/\s+/).map((v) => parseInt(v, 10));
    if (!Number.isFinite(fields[0]) || !Number.isFinite(fields[8])) continue;

    rx += fields[0];
    tx += fields[8];
    found = true;
  }

  return found ? { rx, tx } : null;
}

function parseProcDiskstats(text) {
  // 两遍扫描：先收集设备名，再过滤“父盘在列表中的分区行”，
  // 避免 sda 与 sda1、nvme0n1 与 nvme0n1p1 重复计数
  const rows = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    // major minor name reads completed merges sectors_read ms_reading writes ...
    if (parts.length < 10) continue;
    const name = parts[2];
    if (!name || DISKSTATS_SKIP_PREFIXES.some((p) => name.startsWith(p))) {
      continue;
    }
    rows.push({ name, parts });
  }

  const names = new Set(rows.map((r) => r.name));
  const isPartitionOfListedDisk = (name) => {
    const m = name.match(/^(.*?)(\d+)$/);
    if (!m) return false;
    const base1 = m[1];
    const base2 = base1.endsWith("p") ? base1.slice(0, -1) : null;
    return (
      (base1 && names.has(base1)) || (base2 && names.has(base2))
    );
  };

  let readBytes = 0;
  let writeBytes = 0;
  let found = false;

  for (const { name, parts } of rows) {
    if (isPartitionOfListedDisk(name)) continue;

    const sectorsRead = parseInt(parts[5], 10);
    const sectorsWritten = parseInt(parts[9], 10);
    if (Number.isFinite(sectorsRead)) {
      readBytes += sectorsRead * SECTOR_SIZE;
      found = true;
    }
    if (Number.isFinite(sectorsWritten)) {
      writeBytes += sectorsWritten * SECTOR_SIZE;
      found = true;
    }
  }

  return found ? { readBytes, writeBytes } : null;
}

// df -P -k 输出过滤：伪文件系统与虚拟挂载点
const DF_SKIP_FS_PREFIXES = [
  "tmpfs",
  "devtmpfs",
  "udev",
  "none",
  "overlay",
  "squashfs",
  "cgroup",
  "proc",
  "sysfs",
  "devfs",
  "shm",
];
const DF_SKIP_MOUNT_PREFIXES = ["/proc", "/sys", "/dev", "/run", "/boot/efi"];

function parseDfOutput(text) {
  const disks = [];
  const seenMounts = new Set();

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("Filesystem")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;

    const [fs, totalK, usedK, availK, capacity, mount] = parts;
    if (DF_SKIP_FS_PREFIXES.some((p) => fs.startsWith(p))) continue;
    if (DF_SKIP_MOUNT_PREFIXES.some((p) => mount === p || mount.startsWith(`${p}/`))) {
      continue;
    }
    if (seenMounts.has(mount)) continue;

    const total = toFiniteNumber(totalK) * 1024;
    if (total <= 0) continue;
    const used = toFiniteNumber(usedK) * 1024;
    const free = Math.max(0, toFiniteNumber(availK) * 1024);
    const usedPercent = capacity.endsWith("%")
      ? clampPercent(capacity.slice(0, -1))
      : total > 0
        ? clampPercent((used / total) * 100)
        : 0;

    seenMounts.add(mount);
    disks.push({ mount, total, used, free, usedPercent });
  }

  return disks.sort((a, b) => b.usedPercent - a.usedPercent);
}

/** 仅采集磁盘用量（磁盘告警服务使用，开销最小） */
async function getRemoteDiskUsage(sshClient) {
  if (!isSshClientUsable(sshClient)) {
    throw new Error("SSH connection not available");
  }
  const dfOutput = await execSshCapture(sshClient, "df -P -k 2>/dev/null");
  return parseDfOutput(dfOutput || "");
}

/** Windows 远程兜底采样（无网络/磁盘 IO 速率） */
async function getWindowsRemoteMetricsSample(sshClient) {
  const ts = Date.now();

  const [cpuOutput, memOutput, diskOutput] = await Promise.all([
    execSshCapture(sshClient, "wmic cpu get LoadPercentage /value").catch(
      () => null,
    ),
    execSshCapture(
      sshClient,
      "wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /value",
    ).catch(() => null),
    execSshCapture(
      sshClient,
      "wmic logicaldisk get DeviceID,FreeSpace,Size /value",
    ).catch(() => null),
  ]);

  let cpu = null;
  if (cpuOutput) {
    const m = cpuOutput.match(/LoadPercentage=(\d+)/);
    if (m) cpu = clampPercent(m[1]);
  }

  let memory = { total: 0, used: 0, free: 0, usagePercent: 0 };
  if (memOutput) {
    const freeM = memOutput.match(/FreePhysicalMemory=(\d+)/);
    const totalM = memOutput.match(/TotalVisibleMemorySize=(\d+)/);
    if (freeM && totalM) {
      const total = parseInt(totalM[1], 10) * 1024;
      const free = parseInt(freeM[1], 10) * 1024;
      const used = Math.max(0, total - free);
      memory = {
        total,
        used,
        free,
        usagePercent: total > 0 ? clampPercent((used / total) * 100) : 0,
      };
    }
  }

  const disks = [];
  if (diskOutput) {
    const blocks = diskOutput.split(/(?:\r?\n){2,}/);
    for (const block of blocks) {
      const idM = block.match(/DeviceID=(\S+)/);
      const freeM = block.match(/FreeSpace=(\d+)/);
      const sizeM = block.match(/Size=(\d+)/);
      if (!idM || !sizeM) continue;
      const total = parseInt(sizeM[1], 10);
      if (!(total > 0)) continue;
      const free = freeM ? parseInt(freeM[1], 10) : 0;
      const used = Math.max(0, total - free);
      disks.push({
        mount: idM[1],
        total,
        used,
        free,
        usedPercent: clampPercent((used / total) * 100),
      });
    }
    disks.sort((a, b) => b.usedPercent - a.usedPercent);
  }

  return formatResult(
    ts,
    cpu,
    memory,
    { rxPerSec: null, txPerSec: null },
    { readPerSec: null, writePerSec: null },
    disks,
  );
}

async function getRemoteMetricsSample(sshClient) {
  if (!isSshClientUsable(sshClient)) {
    throw new Error("SSH connection not available");
  }

  let output = null;
  try {
    output = await execSshCapture(sshClient, REMOTE_METRICS_COMMAND);
  } catch {
    output = null;
  }

  if (output && output.includes("---SIMPLESHELL-END---")) {
    const ts = Date.now();
    const sections = {};
    const markers = [
      "---SIMPLESHELL-MEM---",
      "---SIMPLESHELL-NET---",
      "---SIMPLESHELL-DISK---",
      "---SIMPLESHELL-DF---",
      "---SIMPLESHELL-END---",
    ];
    let cursor = 0;
    for (const marker of markers) {
      const idx = output.indexOf(marker, cursor);
      if (idx === -1) break;
      sections[marker] = output.slice(cursor, idx);
      cursor = idx + marker.length;
    }

    // 分片与分隔标记的对应关系：
    // [MEM 前] = /proc/stat，[NET 前] = /proc/meminfo，[DISK 前] = /proc/net/dev，
    // [DF 前] = /proc/diskstats，[END 前] = df 输出
    const cpuStatText = sections["---SIMPLESHELL-MEM---"] ?? "";
    const meminfoText = sections["---SIMPLESHELL-NET---"] ?? "";
    const netdevText = sections["---SIMPLESHELL-DISK---"] ?? "";
    const diskstatsText = sections["---SIMPLESHELL-DF---"] ?? "";
    const dfText = sections["---SIMPLESHELL-END---"] ?? "";

    // CPU：与上次样本差分；无上次样本时用开机以来的均值兜底
    const cpuStat = parseProcStatCpu(cpuStatText);
    const memInfo = parseProcMeminfo(meminfoText) ?? {
      total: 0,
      used: 0,
      free: 0,
      usagePercent: 0,
    };
    const netCounters = parseProcNetDev(netdevText);
    const diskCounters = parseProcDiskstats(diskstatsText);
    const disks = parseDfOutput(dfText);

    const prev = remoteCounterState.get(sshClient) || null;
    const elapsed = prev ? ts - prev.ts : 0;

    let cpu = null;
    if (cpuStat) {
      if (prev?.cpuStat) {
        const totalDiff = cpuStat.total - prev.cpuStat.total;
        const idleDiff = cpuStat.idle - prev.cpuStat.idle;
        if (totalDiff > 0) {
          cpu = clampPercent(((totalDiff - idleDiff) / totalDiff) * 100);
        }
      } else {
        // 首个样本：开机以来的平均使用率
        cpu = clampPercent(((cpuStat.total - cpuStat.idle) / cpuStat.total) * 100);
      }
    }

    remoteCounterState.set(sshClient, {
      ts,
      cpuStat,
      netCounters,
      diskCounters,
    });

    const rxPerSec = netCounters
      ? computePerSec(netCounters.rx, prev?.netCounters?.rx, elapsed)
      : null;
    const txPerSec = netCounters
      ? computePerSec(netCounters.tx, prev?.netCounters?.tx, elapsed)
      : null;
    const readPerSec = diskCounters
      ? computePerSec(diskCounters.readBytes, prev?.diskCounters?.readBytes, elapsed)
      : null;
    const writePerSec = diskCounters
      ? computePerSec(
          diskCounters.writeBytes,
          prev?.diskCounters?.writeBytes,
          elapsed,
        )
      : null;

    return formatResult(
      ts,
      cpu,
      memInfo,
      { rxPerSec, txPerSec },
      { readPerSec, writePerSec },
      disks,
    );
  }

  // Linux 采样不可用时尝试 Windows 兜底
  return getWindowsRemoteMetricsSample(sshClient);
}

/** 本机磁盘用量（供磁盘告警服务使用） */
function getLocalHostname() {
  try {
    return os.hostname();
  } catch {
    return "local";
  }
}

module.exports = {
  getLocalMetricsSample,
  getRemoteMetricsSample,
  getLocalDiskUsage,
  getRemoteDiskUsage,
  getLocalHostname,
  // 暴露给测试/复用
  parseDfOutput,
  parseProcStatCpu,
  parseProcMeminfo,
};
