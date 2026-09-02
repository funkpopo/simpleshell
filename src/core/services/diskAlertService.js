/**
 * 磁盘空间告警服务
 *
 * 定期采样本机与所有活跃 SSH 会话的磁盘分区用量：
 * - 超过阈值（默认 90%）时向渲染层广播 disk:alertEvent（kind: "alert"）
 *   → 终端标签变黄 + 弹出通知
 * - 回落到阈值以下（含 5% 迟滞，避免反复横跳）时广播 kind: "clear"
 *
 * 设置存放在 config.json uiSettings.diskAlert：
 * { enabled, thresholdPercent, intervalSeconds }
 * 每次采样前重新读取，设置变更即时生效（间隔变化自动重排定时器）。
 */

const { logToFile } = require("../utils/logger");
const { broadcastToAllWindows } = require("../window/windowManager");
const { IPC_EVENT_CHANNELS } = require("../ipc/schema/channels");
const processManager = require("../process/processManager");
const configService = require("../../services/configService");
const { isSshClientUsable } = require("../utils/ssh-utils");
const {
  getLocalDiskUsage,
  getRemoteDiskUsage,
  getLocalHostname,
} = require("../../modules/system-info/metrics-sample");

const DEFAULT_SETTINGS = Object.freeze({
  // 默认关闭：定时 df 采样对用户是隐形的后台流量，需要用户在设置里显式开启
  enabled: false,
  thresholdPercent: 90,
  intervalSeconds: 60,
});

const STARTUP_DELAY_MS = 15000;
const MIN_INTERVAL_SECONDS = 30;
const MAX_INTERVAL_SECONDS = 3600;
// 清除阈值迟滞：回落到 threshold - 5% 以下才解除告警
const CLEAR_HYSTERESIS_PERCENT = 5;
const SSH_COMMAND_TIMEOUT_MS = 15000;

class DiskAlertService {
  constructor() {
    this.timer = null;
    this.stopped = true;
    // targetKey -> { alerted: Set<mount>, lastSampleTs }
    this.targetStates = new Map();
  }

  /** 读取设置（每次采样前调用，保证变更即时生效） */
  loadSettings() {
    try {
      const uiSettings = configService.loadUISettings();
      const raw = uiSettings?.diskAlert || {};
      const thresholdPercent = Number(raw.thresholdPercent);
      const intervalSeconds = Number(raw.intervalSeconds);
      return {
        enabled: raw.enabled === true,
        thresholdPercent:
          Number.isFinite(thresholdPercent) &&
          thresholdPercent >= 50 &&
          thresholdPercent <= 99
            ? Math.floor(thresholdPercent)
            : DEFAULT_SETTINGS.thresholdPercent,
        intervalSeconds:
          Number.isFinite(intervalSeconds) &&
          intervalSeconds >= MIN_INTERVAL_SECONDS &&
          intervalSeconds <= MAX_INTERVAL_SECONDS
            ? Math.floor(intervalSeconds)
            : DEFAULT_SETTINGS.intervalSeconds,
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  start() {
    if (!this.stopped && this.timer) {
      return;
    }
    this.stopped = false;
    this._schedule(STARTUP_DELAY_MS);
    logToFile("DiskAlertService started", "INFO");
  }

  stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    logToFile("DiskAlertService stopped", "INFO");
  }

  _schedule(delayMs) {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(async () => {
      if (this.stopped) return;
      const settings = this.loadSettings();
      if (settings.enabled) {
        try {
          await this.tick(settings);
        } catch (error) {
          logToFile(`DiskAlertService tick failed: ${error.message}`, "WARN");
        }
      }
      this._schedule(settings.intervalSeconds * 1000);
    }, delayMs);
  }

  /**
   * 执行一轮采样与告警判定（也可供手动触发）
   */
  async tick(settings = this.loadSettings()) {
    if (!settings.enabled) {
      return;
    }

    const targets = this._collectTargets();
    await Promise.all(
      targets.map((target) => this._checkTarget(target, settings)),
    );

    // 清理已消失目标的告警状态
    const activeKeys = new Set(targets.map((t) => t.targetKey));
    for (const key of this.targetStates.keys()) {
      if (!activeKeys.has(key)) {
        this.targetStates.delete(key);
      }
    }
  }

  /** 汇总本机 + 所有活跃 SSH 会话的采样目标（同一主机的多标签页聚合为一个目标） */
  _collectTargets() {
    const targets = [
      {
        targetKey: "__local__",
        tabId: null,
        tabIds: [],
        host: getLocalHostname(),
        isLocal: true,
        isSsh: false,
      },
    ];

    try {
      // 按连接聚合：同一 client（同一主机连接）可能被多个标签页引用，
      // 告警时所有引用该连接的标签页都应收到事件
      const clientGroups = new Map();
      for (const [, proc] of processManager.getAllProcesses()) {
        if (!proc || proc.type !== "ssh2") continue;
        const client = proc.connectionInfo?.client || proc.process;
        if (!client || !isSshClientUsable(client)) continue;

        const tabId =
          proc.config?.tabId != null ? String(proc.config.tabId) : null;
        const host = proc.config?.host || proc.config?.name || "SSH";

        let group = clientGroups.get(client);
        if (!group) {
          // targetKey 从连接配置派生（host:port:username），不含 tabId，
          // 目标增减后不会漂移；username 中的 ":" 转义避免 key 分段歧义
          const cfg = proc.config || {};
          const connKey = `ssh-${cfg.host || host}:${cfg.port || 22}:${String(
            cfg.username || "",
          ).replace(/:/g, "%3A")}`;
          group = {
            targetKey: connKey,
            tabIds: [],
            host,
            isLocal: false,
            isSsh: true,
            sshClient: client,
          };
          clientGroups.set(client, group);
          targets.push(group);
        }
        if (tabId && !group.tabIds.includes(tabId)) {
          group.tabIds.push(tabId);
        }
      }
    } catch (error) {
      logToFile(
        `DiskAlertService collect targets failed: ${error.message}`,
        "WARN",
      );
    }

    // 兼容旧字段：tabId 指向第一个标签页
    for (const target of targets) {
      if (target.isSsh) {
        target.tabId = target.tabIds[0] || null;
      }
    }

    return targets;
  }

  async _checkTarget(target, settings) {
    let disks;
    try {
      if (target.isLocal) {
        disks = await getLocalDiskUsage();
      } else {
        disks = await Promise.race([
          getRemoteDiskUsage(target.sshClient),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("disk usage timeout")),
              SSH_COMMAND_TIMEOUT_MS,
            ),
          ),
        ]);
      }
    } catch {
      // 采样失败（连接断开/超时）时保留现有状态，下一轮再试
      return;
    }

    if (!Array.isArray(disks)) return;

    const state = this.targetStates.get(target.targetKey) || {
      alerted: new Set(),
    };

    const over = disks.filter(
      (d) => d.usedPercent >= settings.thresholdPercent,
    );
    const recovered = disks.filter(
      (d) =>
        state.alerted.has(d.mount) &&
        d.usedPercent < settings.thresholdPercent - CLEAR_HYSTERESIS_PERCENT,
    );

    const newlyAlerted = over.filter((d) => !state.alerted.has(d.mount));

    if (newlyAlerted.length > 0) {
      for (const d of newlyAlerted) {
        state.alerted.add(d.mount);
      }
      this._emit(target, "alert", newlyAlerted, settings);
    }

    if (recovered.length > 0) {
      for (const d of recovered) {
        state.alerted.delete(d.mount);
      }
      this._emit(target, "clear", recovered, settings);
    }

    // 分区已从 df 消失（卸载等）时同步清理告警状态
    const mounts = new Set(disks.map((d) => d.mount));
    for (const mount of [...state.alerted]) {
      if (!mounts.has(mount)) {
        state.alerted.delete(mount);
      }
    }

    this.targetStates.set(target.targetKey, state);
  }

  _emit(target, kind, mounts, settings) {
    const buildPayload = (tabId) => ({
      kind,
      targetKey: target.targetKey,
      tabId,
      host: target.host,
      isLocal: target.isLocal,
      threshold: settings.thresholdPercent,
      mounts: mounts.map((d) => ({
        mount: d.mount,
        usedPercent: d.usedPercent,
        total: d.total,
        used: d.used,
        free: d.free,
      })),
      timestamp: Date.now(),
    });

    // 同一主机的所有关联标签页都要收到事件（否则部分标签不会变黄）
    const tabIds = target.isSsh ? target.tabIds : [null];
    try {
      for (const tabId of tabIds) {
        broadcastToAllWindows(
          IPC_EVENT_CHANNELS.DISK_ALERT_EVENT,
          buildPayload(tabId),
        );
      }
    } catch (error) {
      logToFile(`DiskAlertService broadcast failed: ${error.message}`, "WARN");
    }

    logToFile(
      `DiskAlertService ${kind}: ${target.host} ${mounts
        .map((d) => `${d.mount} ${d.usedPercent}%`)
        .join(", ")}`,
      kind === "alert" ? "WARN" : "INFO",
    );
  }
}

const diskAlertService = new DiskAlertService();

module.exports = diskAlertService;
