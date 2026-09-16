import { describe, it, expect } from "vitest";
import {
  DEFAULT_SSH_RETRY_CONFIG,
  FAILURE_REASON,
  buildSshRetryConfig,
  analyzeSshFailureReason,
  getEffectiveMaxRetries,
  isRetryWindowExpired,
  getRetryWindowExpiresAt,
  calculateRetryDelay,
} from "../../src/core/connection/ssh-retry-helper.js";

describe("buildSshRetryConfig", () => {
  it("无参调用返回默认弱网友好策略", () => {
    const config = buildSshRetryConfig();
    expect(config.maxRetries).toBe(DEFAULT_SSH_RETRY_CONFIG.maxRetries);
    expect(config.initialDelay).toBe(DEFAULT_SSH_RETRY_CONFIG.initialDelay);
    expect(config.totalTimeCapMs).toBe(DEFAULT_SSH_RETRY_CONFIG.totalTimeCapMs);
    expect(config.fastReconnect.enabled).toBe(true);
  });

  it("浅层覆盖与嵌套默认值合并", () => {
    const config = buildSshRetryConfig({
      maxRetries: 3,
      networkProbe: { intervalMs: 2500 },
    });
    expect(config.maxRetries).toBe(3);
    expect(config.networkProbe.intervalMs).toBe(2500);
    expect(config.networkProbe.tcpTimeoutMs).toBe(
      DEFAULT_SSH_RETRY_CONFIG.networkProbe.tcpTimeoutMs,
    );
  });
});

describe("analyzeSshFailureReason", () => {
  const cases = [
    [{ code: "ECONNREFUSED" }, FAILURE_REASON.CONNECTION_REFUSED],
    [{ code: "ENOTFOUND" }, FAILURE_REASON.HOST_UNRESOLVED],
    [{ code: "ECONNRESET" }, FAILURE_REASON.CONNECTION_RESET],
    [{ code: "EPIPE" }, FAILURE_REASON.CONNECTION_RESET],
    [{ code: "ETIMEDOUT" }, FAILURE_REASON.NETWORK],
    [{ message: "Authentication failure" }, FAILURE_REASON.AUTHENTICATION],
    [
      { message: "All configured authentication methods failed" },
      FAILURE_REASON.AUTHENTICATION,
    ],
    [{ code: "EPROXYUNAVAILABLE" }, FAILURE_REASON.PROXY_UNAVAILABLE],
    [{ message: "too many connections" }, FAILURE_REASON.RESOURCE],
    [{ message: "something odd" }, FAILURE_REASON.UNKNOWN],
  ];

  it.each(cases)("识别 %j", (error, expected) => {
    expect(analyzeSshFailureReason(error)).toBe(expected);
  });
});

describe("getEffectiveMaxRetries", () => {
  it("RESOURCE 类失败永不重试", () => {
    expect(getEffectiveMaxRetries(undefined, {}, FAILURE_REASON.RESOURCE)).toBe(
      0,
    );
  });

  it("认证失败默认不重试", () => {
    expect(
      getEffectiveMaxRetries(undefined, {}, FAILURE_REASON.AUTHENTICATION),
    ).toBe(0);
  });

  it("认证失败在显式开启后受 authFailureMaxRetries 与全局上限双重约束", () => {
    const sshConfig = { retryOnAuthFailure: true, authFailureMaxRetries: 2 };
    expect(
      getEffectiveMaxRetries(
        undefined,
        sshConfig,
        FAILURE_REASON.AUTHENTICATION,
      ),
    ).toBe(2);

    // authFailure.maxRetries 大于全局 maxRetries 时取较小者
    const capped = buildSshRetryConfig({
      maxRetries: 1,
      authFailure: { enabled: true, maxRetries: 5 },
    });
    expect(
      getEffectiveMaxRetries(capped, {}, FAILURE_REASON.AUTHENTICATION),
    ).toBe(1);
  });

  it("非法 maxRetries 归零", () => {
    expect(getEffectiveMaxRetries({ maxRetries: -1 }, {}, null)).toBe(0);
  });
});

describe("isRetryWindowExpired / getRetryWindowExpiresAt", () => {
  it("时间窗口未过期", () => {
    const startedAt = Date.now();
    expect(isRetryWindowExpired(startedAt, { totalTimeCapMs: 60_000 })).toBe(
      false,
    );
    expect(getRetryWindowExpiresAt(startedAt, { totalTimeCapMs: 60_000 })).toBe(
      startedAt + 60_000,
    );
  });

  it("时间窗口已过期", () => {
    const startedAt = Date.now() - 120_000;
    expect(isRetryWindowExpired(startedAt, { totalTimeCapMs: 120_000 })).toBe(
      true,
    );
  });

  it("无效配置视为无窗口限制", () => {
    expect(isRetryWindowExpired(Date.now(), { totalTimeCapMs: 0 })).toBe(false);
    expect(
      getRetryWindowExpiresAt(Date.now(), { totalTimeCapMs: 0 }),
    ).toBeNull();
  });
});

describe("calculateRetryDelay", () => {
  it("瞬时闪断（ECONNRESET）走快恢路径，仅加少量抖动", () => {
    const config = DEFAULT_SSH_RETRY_CONFIG;
    for (let i = 0; i < 50; i += 1) {
      const delay = calculateRetryDelay({
        retryConfig: config,
        attempt: 1,
        lastError: { code: "ECONNRESET" },
      });
      const base = config.fastReconnect.delay;
      const jitter = Math.min(100, base * 0.2);
      expect(delay).toBeGreaterThanOrEqual(Math.floor(base - jitter));
      expect(delay).toBeLessThanOrEqual(Math.ceil(base + jitter));
    }
  });

  it("指数退避按 attempt 增长且被 maxDelay 封顶", () => {
    const config = {
      useExponentialBackoff: true,
      initialDelay: 1000,
      exponentialFactor: 2,
      maxDelay: 5000,
      jitter: 0,
      fastReconnect: { enabled: false },
      smartReconnect: { enabled: false },
    };
    expect(calculateRetryDelay({ retryConfig: config, attempt: 1 })).toBe(1000);
    expect(calculateRetryDelay({ retryConfig: config, attempt: 3 })).toBe(4000);
    // 2^10 * 1000 远超 maxDelay，应被钳制
    expect(calculateRetryDelay({ retryConfig: config, attempt: 11 })).toBe(
      5000,
    );
  });

  it("关闭指数退避时使用固定 initialDelay", () => {
    const config = {
      useExponentialBackoff: false,
      initialDelay: 800,
      jitter: 0,
      fastReconnect: { enabled: false },
      smartReconnect: { enabled: false },
    };
    expect(calculateRetryDelay({ retryConfig: config, attempt: 4 })).toBe(800);
  });

  it("成功率低于阈值时自适应放大 1.5 倍", () => {
    const config = {
      initialDelay: 1000,
      jitter: 0,
      fastReconnect: { enabled: false },
      smartReconnect: {
        enabled: true,
        adaptiveDelay: true,
        networkQualityThreshold: 0.7,
      },
    };
    expect(
      calculateRetryDelay({
        retryConfig: config,
        attempt: 1,
        successRate: 0.3,
      }),
    ).toBe(1500);
    expect(
      calculateRetryDelay({
        retryConfig: config,
        attempt: 1,
        successRate: 0.9,
      }),
    ).toBe(1000);
  });

  it("抖动保持在 ±jitter 范围内", () => {
    const config = {
      initialDelay: 2000,
      jitter: 400,
      fastReconnect: { enabled: false },
      smartReconnect: { enabled: false },
    };
    for (let i = 0; i < 100; i += 1) {
      const delay = calculateRetryDelay({ retryConfig: config, attempt: 1 });
      expect(delay).toBeGreaterThanOrEqual(2000 - 400);
      expect(delay).toBeLessThanOrEqual(2000 + 400);
    }
  });

  it("非法 attempt 回退为第 1 次尝试", () => {
    const config = {
      initialDelay: 1000,
      jitter: 0,
      fastReconnect: { enabled: false },
      smartReconnect: { enabled: false },
    };
    expect(calculateRetryDelay({ retryConfig: config, attempt: 0 })).toBe(1000);
  });
});
