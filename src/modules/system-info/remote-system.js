const REMOTE_SYSTEM_INFO_CACHE_TTL_MS = 4000;
const REMOTE_PROCESS_LIST_CACHE_TTL_MS = 5000;
const remoteSystemInfoCache = new WeakMap();
const remoteProcessListCache = new WeakMap();

const cloneSystemInfo = (info) => ({
  ...info,
  os: info?.os ? { ...info.os } : {},
  cpu: info?.cpu ? { ...info.cpu } : {},
  memory: info?.memory ? { ...info.memory } : {},
  processes: Array.isArray(info?.processes) ? [...info.processes] : [],
});

async function getRemoteSystemInfo(sshClient) {
  const cached = remoteSystemInfoCache.get(sshClient);
  if (
    cached &&
    Date.now() - cached.timestamp < REMOTE_SYSTEM_INFO_CACHE_TTL_MS
  ) {
    return cloneSystemInfo(cached.data);
  }

  // 检查SSH连接是否有效
  if (!isSshClientUsable(sshClient)) {
    throw new Error("SSH连接不可用");
  }

  const result = {
    isLocal: false,
    os: {
      type: "未知",
      platform: "未知",
      release: "未知",
      hostname: "未知",
      distro: "未知",
      version: "未知",
    },
    cpu: { model: "未知", cores: 0, usage: 0 },
    memory: { total: 0, free: 0, used: 0, usagePercent: 0 },
    processes: [], // Initially empty, will be fetched on demand
  };

  // 捕获命令输出；命令失败/连接不可用时返回 null（保持原有“失败即跳过”的降级语义）
  const capture = async (command) => {
    try {
      const { stdout } = await execSshCapture(sshClient, command);
      return stdout;
    } catch {
      return null;
    }
  };

  // 获取基本操作系统信息
  const unameOutput = await capture("uname -a");
  if (unameOutput === null) {
    // uname 执行失败：与原实现一致，直接返回默认结构（不写缓存）
    return result;
  }

  // 解析基本操作系统信息
  const osInfo = unameOutput.trim();

  // 检测操作系统类型
  if (osInfo.includes("Linux")) {
    result.os.type = "Linux";
    result.os.platform = "linux";

    // 获取详细的Linux发行版信息：尝试多种方法，命中一种即停止
    const distroCommands = [
      'cat /etc/os-release | grep -E "^(NAME|VERSION)="',
      "lsb_release -a 2>/dev/null",
      "cat /etc/redhat-release 2>/dev/null",
      "cat /etc/debian_version 2>/dev/null",
    ];

    let distroResolved = false;
    for (const command of distroCommands) {
      const distroOutput = await capture(command);
      const output = distroOutput === null ? "" : distroOutput.trim();
      if (!output) continue;

      if (command.includes("/etc/os-release")) {
        // 解析os-release格式
        const nameMatch = output.match(/NAME="([^"]+)"/);
        const versionMatch = output.match(/VERSION="([^"]+)"/);

        if (nameMatch) {
          result.os.distro = nameMatch[1];
        }
        if (versionMatch) {
          result.os.version = versionMatch[1];
        }

        result.os.release =
          `${result.os.distro || "Linux"} ${result.os.version || ""}`.trim();
        distroResolved = true;
        break;
      } else if (command.includes("lsb_release")) {
        // 解析lsb_release格式
        const distroMatch = output.match(/Distributor ID:\s+(.+)/);
        const versionMatch = output.match(/Release:\s+(.+)/);

        if (distroMatch) {
          result.os.distro = distroMatch[1].trim();
        }
        if (versionMatch) {
          result.os.version = versionMatch[1].trim();
        }

        result.os.release =
          `${result.os.distro || "Linux"} ${result.os.version || ""}`.trim();
        distroResolved = true;
        break;
      } else if (
        command.includes("/etc/redhat-release") ||
        command.includes("/etc/debian_version")
      ) {
        // 直接使用文件内容
        result.os.release = output;
        result.os.distro = output.split(" ")[0] || "Linux";

        // 尝试提取版本号
        const versionMatch = output.match(/(\d+(\.\d+)+)/);
        if (versionMatch) {
          result.os.version = versionMatch[1];
        }

        distroResolved = true;
        break;
      }
    }

    if (!distroResolved) {
      // 所有命令都尝试过了，保存现有信息然后继续
      result.os.release = osInfo;
    }
  } else if (osInfo.includes("Windows")) {
    result.os.type = "Windows";
    result.os.platform = "win32";

    // Get Windows version
    const winOutput = await capture(
      "wmic os get Caption,Version,OSArchitecture /value",
    );
    if (winOutput !== null) {
      const captionMatch = winOutput.match(/Caption=(.+)/);
      const versionMatch = winOutput.match(/Version=(.+)/);
      const archMatch = winOutput.match(/OSArchitecture=(.+)/);

      if (captionMatch) {
        result.os.distro = captionMatch[1].trim();
      }
      if (versionMatch) {
        result.os.version = versionMatch[1].trim();
      }

      let archInfo = "";
      if (archMatch) {
        archInfo = ` (${archMatch[1].trim()})`;
      }

      result.os.release =
        `${result.os.distro || "Windows"} ${result.os.version || ""}${archInfo}`.trim();
    }
  } else {
    // 未识别的系统，直接保存uname信息
    result.os.release = osInfo;
  }

  // 获取主机名
  const hostnameOutput = await capture("hostname");
  if (hostnameOutput !== null) {
    result.os.hostname = hostnameOutput.trim();
  }

  // 获取内存信息（连接不可用/命令失败时跳过，继续后续步骤）
  // OpenWrt/BusyBox 的 `free -b` / 输出列通常不稳定，因此 Linux 改用 /proc/meminfo 解析
  const memCommand =
    result.os.platform === "win32"
      ? "wmic OS get FreePhysicalMemory,TotalVisibleMemorySize /Value"
      : "cat /proc/meminfo";

  const memOutput = await capture(memCommand);
  if (memOutput !== null) {
    try {
      if (result.os.platform === "win32") {
        // 解析Windows内存信息
        const freeMatch = memOutput.match(/FreePhysicalMemory=(\d+)/);
        const totalMatch = memOutput.match(/TotalVisibleMemorySize=(\d+)/);

        if (freeMatch && totalMatch) {
          // Windows返回的是KB，需要转换为字节
          const free = parseInt(freeMatch[1], 10) * 1024;
          const total = parseInt(totalMatch[1], 10) * 1024;
          const used = total - free;

          result.memory.total = total;
          result.memory.free = free;
          result.memory.used = used;
          result.memory.usagePercent = Math.round((used / total) * 100);
        }
      } else {
        // 解析Linux内存信息（kB -> bytes），优先使用 MemAvailable
        const toKib = (v) => {
          const n = parseInt(v, 10);
          return Number.isFinite(n) ? n : 0;
        };

        const memTotalKib = toKib(
          memOutput.match(/^MemTotal:\s+(\d+)/m)?.[1] ?? "0",
        );
        const memAvailableKib = toKib(
          memOutput.match(/^MemAvailable:\s+(\d+)/m)?.[1] ?? "NaN",
        );
        const memFreeKib = toKib(
          memOutput.match(/^MemFree:\s+(\d+)/m)?.[1] ?? "0",
        );
        const buffersKib = toKib(
          memOutput.match(/^Buffers:\s+(\d+)/m)?.[1] ?? "0",
        );
        const cachedKib =
          toKib(memOutput.match(/^Cached:\s+(\d+)/m)?.[1] ?? "0") +
          toKib(memOutput.match(/^SReclaimable:\s+(\d+)/m)?.[1] ?? "0");

        if (memTotalKib > 0) {
          // 以“可用内存”近似 free：优先 MemAvailable，否则用 MemFree+Buffers+Cached
          const freeLikeKib =
            memAvailableKib > 0
              ? memAvailableKib
              : memFreeKib + buffersKib + cachedKib;

          const totalBytes = memTotalKib * 1024;
          const freeBytes = Math.max(0, freeLikeKib * 1024);
          const usedBytes = Math.max(0, totalBytes - freeBytes);

          result.memory.total = totalBytes;
          result.memory.free = freeBytes;
          result.memory.used = usedBytes;
          result.memory.usagePercent = totalBytes
            ? Math.round((usedBytes / totalBytes) * 100)
            : 0;
        }
      }
    } catch {
      /* intentionally ignored */
    }
  }

  // 获取CPU核心数
  const cpuCommand =
    result.os.platform === "win32"
      ? "wmic cpu get NumberOfCores,Name"
      : "awk '/^processor/{c++} END{print (c?c:1)+0}' /proc/cpuinfo";

  const cpuOutput = await capture(cpuCommand);
  if (cpuOutput !== null) {
    try {
      if (result.os.platform === "win32") {
        // 解析Windows CPU核心数
        const lines = cpuOutput.trim().split("\n");
        if (lines.length >= 2) {
          const coresLine = lines[1].trim();
          result.cpu.cores = parseInt(coresLine, 10) || 1;
        }
      } else {
        // 解析Linux CPU核心数
        result.cpu.cores = parseInt(cpuOutput.trim(), 10) || 1;
      }
    } catch {
      /* intentionally ignored */
    }
  }

  // 获取CPU型号
  const modelCommand =
    result.os.platform === "win32"
      ? "wmic cpu get Name"
      : 'cat /proc/cpuinfo | grep "model name" | head -1';

  const modelOutput = await capture(modelCommand);
  if (modelOutput !== null) {
    try {
      if (result.os.platform === "win32") {
        // 解析Windows CPU型号
        const lines = modelOutput.trim().split("\n");
        if (lines.length >= 2) {
          result.cpu.model = lines[1].trim();
        }
      } else {
        // 解析Linux CPU型号
        const match = modelOutput.match(/model name\s*:\s*(.*)/);
        if (match && match[1]) {
          result.cpu.model = match[1].trim();
        }
      }
    } catch {
      /* intentionally ignored */
    }
  }

  // 获取CPU使用率（连接不可用时直接跳到收尾，与原逻辑一致）
  if (isSshClientUsable(sshClient)) {
    if (result.os.platform !== "win32") {
      // Linux/OpenWrt：用 /proc/stat 两次采样计算更稳定的 CPU 使用率
      const parseCpuStat = (statText) => {
        // 格式：cpu  user nice system idle iowait irq softirq steal guest guest_nice
        const line = statText
          .trim()
          .split("\n")
          .find((l) => l.startsWith("cpu "))
          ?.trim();
        if (!line) return null;

        const parts = line.split(/\s+/).slice(1);
        const nums = parts.map((v) => parseInt(v, 10) || 0);
        const total = nums.reduce((sum, n) => sum + n, 0);
        const idle = (nums[3] || 0) + (nums[4] || 0); // idle + iowait
        if (!total) return null;
        return { idle, total };
      };

      const sampleOnce = async () => {
        const out = await capture("cat /proc/stat");
        if (out === null) return null;
        try {
          return parseCpuStat(out);
        } catch {
          return null;
        }
      };

      const s1 = await sampleOnce();
      if (s1) {
        // 采样间隔太短会抖动，太长会增加 SSH 开销
        await new Promise((r) => setTimeout(r, 600));
        const s2 = await sampleOnce();
        if (s2) {
          const totalDiff = s2.total - s1.total;
          const idleDiff = s2.idle - s1.idle;
          const usedDiff = totalDiff - idleDiff;

          let usage = 0;
          if (totalDiff > 0 && usedDiff >= 0) {
            usage = (usedDiff / totalDiff) * 100;
          }

          result.cpu.usage = Math.max(0, Math.min(100, Math.round(usage)));
        }
      }
    } else {
      const usageOutput = await capture("wmic cpu get LoadPercentage");
      if (usageOutput !== null) {
        try {
          // 解析Windows CPU使用率
          const lines = usageOutput.trim().split("\n");
          if (lines.length >= 2) {
            result.cpu.usage = parseInt(lines[1].trim(), 10) || 0;
          }
        } catch {
          /* intentionally ignored */
        }
      }
    }
  }

  remoteSystemInfoCache.set(sshClient, {
    timestamp: Date.now(),
    data: cloneSystemInfo(result),
  });
  return result;
}

function isSshClientUsable(sshClient) {
  return (
    sshClient &&
    (!sshClient._readableState || !sshClient._readableState.ended) &&
    (!sshClient._sock || (sshClient._sock.readable && sshClient._sock.writable))
  );
}

/** 与 GNU ps --no-headers 等输出一致：pid ppid %cpu %mem user comm... */
function parsePsSixColumnLines(lines) {
  return lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) return null;

      const commandName = parts.slice(5).join(" ");
      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      const cpu = parseFloat(parts[2]);
      const mem = parseFloat(parts[3]);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;

      return {
        pid,
        ppid,
        cpu: Number.isFinite(cpu) ? cpu : 0,
        memory: Number.isFinite(mem) ? mem : 0,
        user: parts[4],
        name: commandName,
      };
    })
    .filter(Boolean);
}

/** BusyBox / procps 不含 GNU 列宽：pid ppid user comm... */
function parsePsFourColumnLines(lines) {
  return lines
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return null;

      const pid = parseInt(parts[0], 10);
      const ppid = parseInt(parts[1], 10);
      if (!Number.isFinite(pid) || !Number.isFinite(ppid)) return null;

      return {
        pid,
        ppid,
        cpu: 0,
        memory: 0,
        user: parts[2],
        name: parts.slice(3).join(" "),
      };
    })
    .filter(Boolean);
}

/** BusyBox `ps w` 常见列：PID USER VSZ STAT COMMAND */
function parsePsWideLines(lines) {
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (/^\s*PID\b/i.test(t)) continue;

    const m = t.match(/^(\d+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!m) continue;

    const pid = parseInt(m[1], 10);
    if (!Number.isFinite(pid)) continue;

    out.push({
      pid,
      ppid: 0,
      cpu: 0,
      memory: 0,
      user: m[2],
      name: m[5].trim(),
    });
  }
  return out;
}

/** /proc/PID/comm 回退：`pid|name`（无 CPU/内存百分比） */
function parseProcCommLines(lines) {
  return lines
    .map((line) => {
      const idx = line.indexOf("|");
      if (idx === -1) return null;
      const pid = parseInt(line.slice(0, idx), 10);
      const name = line.slice(idx + 1).trim();
      if (!Number.isFinite(pid) || !name) return null;

      return {
        pid,
        ppid: 0,
        cpu: 0,
        memory: 0,
        user: "",
        name,
      };
    })
    .filter(Boolean);
}

function looksLikePsHeaderLine(line) {
  const t = line.trim();
  return /^PID\b/i.test(t);
}

function sortRemoteProcesses(rows) {
  return [...rows].sort(
    (a, b) =>
      (b.memory || 0) - (a.memory || 0) ||
      (b.cpu || 0) - (a.cpu || 0) ||
      String(a.name || "").localeCompare(String(b.name || "")),
  );
}

function execSshCapture(sshClient, command) {
  return new Promise((resolve, reject) => {
    if (!isSshClientUsable(sshClient)) {
      reject(new Error("SSH连接不可用"));
      return;
    }

    sshClient.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      let stdout = "";
      let stderr = "";
      stream.on("data", (data) => {
        stdout += data.toString();
      });
      if (stream.stderr) {
        stream.stderr.on("data", (data) => {
          stderr += data.toString();
        });
      }

      stream.on("error", reject);
      stream.on("close", () => resolve({ stdout, stderr }));
    });
  });
}

/**
 * OpenWrt/Alpine 等 BusyBox 环境通常不支持 GNU ps 的 `-axo`、`user:宽` 语法。
 * 依次尝试：完整 GNU 列 → 通用 -eo → 仅 pid / ppid / user / comm → BusyBox 宽表 → procfs comm。
 */
const REMOTE_PS_STRATEGIES = [
  {
    cmd: "ps -axo pid,ppid,%cpu,%mem,user:20,comm --no-headers",
    parse: parsePsSixColumnLines,
    stripHeader: false,
  },
  {
    cmd: "ps -eo pid,ppid,%cpu,%mem,user,comm --no-headers 2>/dev/null",
    parse: parsePsSixColumnLines,
    stripHeader: false,
  },
  {
    cmd: "ps -eo pid,ppid,%cpu,%mem,user,comm 2>/dev/null",
    parse: parsePsSixColumnLines,
    stripHeader: true,
  },
  {
    cmd: "ps -eo pid,ppid,user,comm 2>/dev/null",
    parse: parsePsFourColumnLines,
    stripHeader: true,
  },
  {
    cmd: "ps ww 2>/dev/null || ps -ww 2>/dev/null || ps w 2>/dev/null",
    parse: parsePsWideLines,
    stripHeader: true,
  },
  {
    cmd:
      'for d in /proc/[0-9]*; do [ -r "$d/comm" ] || continue; pid="${d#/proc/}"; printf "%s|" "$pid"; tr \'\\0\' \' \' <"$d/comm" 2>/dev/null; echo; done',
    parse: parseProcCommLines,
    stripHeader: false,
  },
];

async function getRemoteProcessList(sshClient) {
  const cached = remoteProcessListCache.get(sshClient);
  if (
    cached &&
    Date.now() - cached.timestamp < REMOTE_PROCESS_LIST_CACHE_TTL_MS
  ) {
    return [...cached.data];
  }

  if (!isSshClientUsable(sshClient)) {
    throw new Error("SSH连接不可用");
  }

  let lastError = null;

  for (const strat of REMOTE_PS_STRATEGIES) {
    try {
      const { stdout } = await execSshCapture(sshClient, strat.cmd);
      const text = stdout.trim();
      if (!text) continue;

      let lines = text.split("\n").filter((l) => l.length > 0);
      if (strat.stripHeader && lines.length && looksLikePsHeaderLine(lines[0])) {
        lines = lines.slice(1);
      }

      const parsed = strat.parse(lines);
      if (parsed.length > 0) {
        const processes = sortRemoteProcesses(parsed);
        remoteProcessListCache.set(sshClient, {
          timestamp: Date.now(),
          data: processes,
        });
        return processes;
      }
    } catch (e) {
      lastError = e;
    }
  }

  if (lastError && lastError.message !== "SSH连接不可用") {
    console.warn(
      "[getRemoteProcessList] All strategies failed:",
      lastError.message,
    );
  }

  const empty = [];
  remoteProcessListCache.set(sshClient, {
    timestamp: Date.now(),
    data: empty,
  });
  return empty;
}

module.exports = {
  getRemoteSystemInfo,
  getRemoteProcessList,
};
