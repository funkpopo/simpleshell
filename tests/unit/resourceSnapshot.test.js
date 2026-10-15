import { describe, it, expect } from "vitest";

// 资源监控合并快照（P3）：单次远程调用同时获取系统信息与指标样本，
// 减少 SSH 往返。分片解析与发行版/CPU 解析优先级与原 getRemoteSystemInfo 一致。

const {
  splitSnapshotSections,
  applyDistroInfo,
  applyCpuInfo,
  REMOTE_RESOURCE_SNAPSHOT_COMMAND,
} = await import("../../src/main/system-info/resource-snapshot.js");

// 合并快照命令覆盖系统信息与指标样本所需的全部数据段
describe("REMOTE_RESOURCE_SNAPSHOT_COMMAND", () => {
  it("包含系统信息命令与指标样本命令", () => {
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("uname -a");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("/etc/os-release");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("hostname");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("/proc/meminfo");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("/proc/cpuinfo");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("/proc/stat");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("/proc/net/dev");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("/proc/diskstats");
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND).toContain("df -P -k");
    // 9 个分隔标记，一次 exec 完成全部采集
    expect(REMOTE_RESOURCE_SNAPSHOT_COMMAND.split("; echo ").length).toBe(10);
  });
});

describe("splitSnapshotSections", () => {
  it("按标记切分，sections[marker] 为该标记之前的分片", () => {
    const output = [
      "Linux box 5.15",
      "---SIMPLESHELL-UNAME---",
      'NAME="Ubuntu"',
      "---SIMPLESHELL-DISTRO---",
      "myhost",
      "---SIMPLESHELL-HOST---",
      "---SIMPLESHELL-END---",
    ].join("\n");

    const sections = splitSnapshotSections(output);
    expect(sections["---SIMPLESHELL-UNAME---"]).toBe("Linux box 5.15\n");
    expect(sections["---SIMPLESHELL-DISTRO---"]).toBe('\nNAME="Ubuntu"\n');
    expect(sections["---SIMPLESHELL-HOST---"]).toBe("\nmyhost\n");
    // 缺失的中间标记会终止切分（后续标记不再收集）
    expect(sections["---SIMPLESHELL-END---"]).toBeUndefined();
  });

  it("完整合并输出：全部 9 个标记切分，END 前为 df 输出", () => {
    const output = [
      "Linux box 5.15",
      "---SIMPLESHELL-UNAME---",
      'NAME="Ubuntu"',
      "---SIMPLESHELL-DISTRO---",
      "myhost",
      "---SIMPLESHELL-HOST---",
      "MemTotal:",
      "---SIMPLESHELL-MEM---",
      "8",
      "---SIMPLESHELL-CPU---",
      "cpu  1 2 3 4",
      "---SIMPLESHELL-STAT---",
      "eth0:",
      "---SIMPLESHELL-NET---",
      "nvme0n1 8 0 128",
      "---SIMPLESHELL-DISK---",
      "/dev/sda1 100 50 50 50% /",
      "---SIMPLESHELL-END---",
    ].join("\n");

    const sections = splitSnapshotSections(output);
    expect(sections["---SIMPLESHELL-STAT---"]).toContain("cpu  1 2 3 4");
    expect(sections["---SIMPLESHELL-END---"]).toContain("/dev/sda1");
  });
});

describe("applyDistroInfo", () => {
  it("os-release 格式：distro/version/release 与原实现一致", () => {
    const os = { release: "", distro: "", version: "" };
    applyDistroInfo(os, 'NAME="Ubuntu"\nVERSION="22.04"\n');
    expect(os.distro).toBe("Ubuntu");
    expect(os.version).toBe("22.04");
    expect(os.release).toBe("Ubuntu 22.04");
  });

  it("lsb_release 格式：Distributor ID/Release", () => {
    const os = { release: "", distro: "", version: "" };
    applyDistroInfo(os, "Distributor ID:\tDebian\nRelease:\t12\n\n");
    expect(os.distro).toBe("Debian");
    expect(os.version).toBe("12");
    expect(os.release).toBe("Debian 12");
  });

  it("redhat/debian 文件内容：release 为原文，distro 取首词，版本号正则提取", () => {
    const os = { release: "", distro: "", version: "" };
    applyDistroInfo(os, "CentOS Linux release 7.9.2009 (Core)");
    expect(os.release).toBe("CentOS Linux release 7.9.2009 (Core)");
    expect(os.distro).toBe("CentOS");
    expect(os.version).toBe("7.9.2009");
  });

  it("空分片：release 回退为 Linux，不影响 hostname/CPU 解析", () => {
    const os = { release: "", distro: "", version: "" };
    applyDistroInfo(os, "");
    expect(os.release).toBe("Linux");
  });
});

describe("applyCpuInfo", () => {
  it("解析核心数（awk 输出）与 model name 行", () => {
    const cpu = { model: "", cores: 0, usage: 0 };
    applyCpuInfo(cpu, "8\nmodel name\t: Intel(R) Xeon(R) CPU @ 2.30GHz\n");
    expect(cpu.cores).toBe(8);
    expect(cpu.model).toBe("Intel(R) Xeon(R) CPU @ 2.30GHz");
  });

  it("awk 失败时首行为 model name：核心数保持默认，型号仍可解析", () => {
    const cpu = { model: "", cores: 0, usage: 0 };
    applyCpuInfo(cpu, "model name\t: AMD Ryzen 9\n");
    expect(cpu.cores).toBe(0);
    expect(cpu.model).toBe("AMD Ryzen 9");
  });
});
