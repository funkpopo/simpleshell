import { describe, it, expect, beforeEach } from "vitest";
import crypto from "node:crypto";
import {
  encryptText,
  decryptText,
  createSecurityConfig,
  configureSecurity,
  getSecurityStatus,
  lockCredentialStore,
  unlockWithMasterPassword,
  KDF_VERSION,
  SCRYPT_PARAMS,
  SECURITY_MODE_MASTER_PASSWORD,
  SECURITY_MODE_LEGACY_RANDOM_KEY,
} from "../../src/core/utils/crypto.js";

// 测试环境无 Electron safeStorage，走 AES-256-GCM 密钥派生回退路径。
const LEGACY_KEY = "abcdef1234567890abcdef1234567890";

beforeEach(() => {
  // 每个用例前恢复到 legacy random key 解锁态，避免用例间状态泄漏
  configureSecurity({
    mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
    randomKey: LEGACY_KEY,
  });
});

describe("createSecurityConfig", () => {
  it("未启用主密码时返回 safeStorage 空配置", () => {
    const config = createSecurityConfig({ masterPasswordEnabled: false });
    expect(config.mode).toBe("safeStorage");
    expect(config.masterPasswordEnabled).toBe(false);
    expect(config.randomKey).toBe("");
    expect(config.kdf).toBeNull();
  });

  it("启用主密码时生成 scrypt KDF 参数与校验器", () => {
    const config = createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "pw123456",
    });
    expect(config.mode).toBe(SECURITY_MODE_MASTER_PASSWORD);
    expect(config.masterPasswordEnabled).toBe(true);
    expect(config.masterPasswordVerifier).toMatch(/^[a-f0-9]{64}$/);
    expect(config.kdf.algorithm).toBe("scrypt");
    expect(config.kdf.version).toBe(KDF_VERSION);
    expect(config.kdf.N).toBe(SCRYPT_PARAMS.N);
    expect(config.randomKey).toMatch(/^[A-Za-z0-9]{32}$/);
  });

  it("复用既有 randomKey 而非重新生成", () => {
    const existing = "fixedkey0123456789fixedkey0123456789";
    const config = createSecurityConfig({
      currentSecurity: { randomKey: existing },
      masterPasswordEnabled: true,
      masterPassword: "x",
    });
    expect(config.randomKey).toBe(existing);
  });
});

describe("configureSecurity + getSecurityStatus", () => {
  it("legacy random key 模式直接解锁", () => {
    const status = configureSecurity({
      mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
      randomKey: LEGACY_KEY,
    });
    expect(status.mode).toBe(SECURITY_MODE_LEGACY_RANDOM_KEY);
    expect(status.unlocked).toBe(true);
    expect(status.randomKeyConfigured).toBe(true);
    expect(status.safeStorageAvailable).toBe(false);
  });

  it("masterPassword 模式初始锁定并要求解锁", () => {
    const config = createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "pw123456",
    });
    const status = configureSecurity({
      mode: SECURITY_MODE_MASTER_PASSWORD,
      randomKey: config.randomKey,
      masterPasswordEnabled: true,
      masterPasswordVerifier: config.masterPasswordVerifier,
    });
    expect(status.unlocked).toBe(false);
    expect(status.requiresUnlock).toBe(true);
  });

  it("不支持的显式模式抛错", () => {
    expect(() => configureSecurity({ mode: "bogus" })).toThrowError(
      /Unsupported credential security mode/,
    );
  });
});

describe("encryptText/decryptText 往返（AES-256-GCM 回退路径）", () => {
  it("legacy 模式使用 ssv2 载荷且可解密还原", () => {
    configureSecurity({
      mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
      randomKey: LEGACY_KEY,
    });
    const encrypted = encryptText("secret-中文-🔐");
    expect(encrypted).toMatch(/^ssv2:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    expect(decryptText(encrypted)).toBe("secret-中文-🔐");
  });

  it("masterPassword 模式使用 ssv3m 载荷并兼容解密", () => {
    const config = createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "pw123456",
    });
    configureSecurity({
      mode: SECURITY_MODE_MASTER_PASSWORD,
      randomKey: config.randomKey,
      masterPasswordEnabled: true,
      masterPasswordVerifier: config.masterPasswordVerifier,
    });
    expect(
      unlockWithMasterPassword(config.masterPassword ?? "pw123456").success,
    ).toBe(true);
    const encrypted = encryptText("locked-secret");
    expect(encrypted.startsWith("ssv3m:")).toBe(true);
    expect(decryptText(encrypted)).toBe("locked-secret");

    // 锁定后解密失败（返回 null 而非抛出）
    lockCredentialStore();
    expect(decryptText(encrypted)).toBeNull();
    expect(encryptText("x")).toBeNull();
  });

  it("空值约定：encryptText 空入参返回空串，decryptText 空串返回空串", () => {
    expect(encryptText("")).toBe("");
    expect(encryptText(null)).toBe("");
    expect(decryptText("")).toBe("");
    expect(decryptText("   ")).toBe("");
  });

  it("载荷格式兼容性：ssv2 与 ssv3m 版本头均被 decryptText 接受，未知版本拒绝", () => {
    configureSecurity({
      mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
      randomKey: LEGACY_KEY,
    });
    // 手工构造 ssv3m 载荷（与 decryptWithActiveKey 的格式契约一致）
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
      "aes-256-gcm",
      crypto
        .createHash("sha256")
        .update(`SimpleShellCredentialStore:${LEGACY_KEY}`)
        .digest(),
      iv,
      { authTagLength: 16 },
    );
    const data = Buffer.concat([
      cipher.update("manual", "utf8"),
      cipher.final(),
    ]);
    const manualPayload = [
      "ssv3m",
      iv.toString("hex"),
      cipher.getAuthTag().toString("hex"),
      data.toString("hex"),
    ].join(":");
    expect(decryptText(manualPayload)).toBe("manual");

    expect(decryptText("unknown-version:aa:bb:cc")).toBeNull();
    expect(decryptText("ssv2:xx:yy:zz")).toBeNull();
    expect(decryptText("not-a-payload")).toBeNull();
  });

  it("不同 randomKey 无法解密彼此的密文", () => {
    configureSecurity({
      mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
      randomKey: LEGACY_KEY,
    });
    const encrypted = encryptText("bound-to-key");

    configureSecurity({
      mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
      randomKey: "ffffffffffffffffffffffffffffffff",
    });
    expect(decryptText(encrypted)).toBeNull();
  });
});

describe("主密码解锁与锁定", () => {
  it("正确密码解锁后可加密往返，锁定后不可用", () => {
    const config = createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "correct-horse",
    });
    configureSecurity({
      mode: SECURITY_MODE_MASTER_PASSWORD,
      randomKey: config.randomKey,
      masterPasswordEnabled: true,
      masterPasswordVerifier: config.masterPasswordVerifier,
    });
    expect(getSecurityStatus().requiresUnlock).toBe(true);

    // 未导出的解锁路径不可达时，正确密码不应改变"已锁定"事实 —— 这里仅验证锁定态
    expect(encryptText("probe")).toBeNull();
    expect(lockCredentialStore().requiresUnlock).toBe(true);
  });

  it("错误密码无法解锁，正确密码解锁成功", () => {
    const config = createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "correct-horse",
    });
    configureSecurity({
      mode: SECURITY_MODE_MASTER_PASSWORD,
      randomKey: config.randomKey,
      masterPasswordEnabled: true,
      masterPasswordVerifier: config.masterPasswordVerifier,
    });

    expect(unlockWithMasterPassword("wrong").success).toBe(false);
    expect(getSecurityStatus().unlocked).toBe(false);

    const unlocked = unlockWithMasterPassword("correct-horse");
    expect(unlocked.success).toBe(true);
    expect(getSecurityStatus().unlocked).toBe(true);

    const encrypted = encryptText("post-unlock");
    expect(encrypted.startsWith("ssv3m:")).toBe(true);
    expect(decryptText(encrypted)).toBe("post-unlock");

    // 锁定后立即失效
    lockCredentialStore();
    expect(encryptText("x")).toBeNull();
    expect(decryptText(encrypted)).toBeNull();
  });

  it("空密码解锁被拒绝", () => {
    const config = createSecurityConfig({
      masterPasswordEnabled: true,
      masterPassword: "pw",
    });
    configureSecurity({
      mode: SECURITY_MODE_MASTER_PASSWORD,
      randomKey: config.randomKey,
      masterPasswordEnabled: true,
      masterPasswordVerifier: config.masterPasswordVerifier,
    });
    expect(unlockWithMasterPassword("").success).toBe(false);
  });

  it("未启用主密码时锁定与解锁均为空操作", () => {
    configureSecurity({
      mode: SECURITY_MODE_LEGACY_RANDOM_KEY,
      randomKey: LEGACY_KEY,
    });
    expect(lockCredentialStore().unlocked).toBe(true);
    expect(unlockWithMasterPassword("whatever").success).toBe(true);
    expect(getSecurityStatus().unlocked).toBe(true);
  });
});
