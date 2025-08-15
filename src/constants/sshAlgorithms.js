/**
 * SSH连接算法配置常量
 * 包含现代SSH服务器兼容的算法列表，特别是支持ssh-ed25519
 */

const SSH_ALGORITHMS = {
  serverHostKey: [
    "ssh-ed25519", // 现代椭圆曲线算法，优先使用
    "ecdsa-sha2-nistp521", // ECDSA 521位
    "ecdsa-sha2-nistp384", // ECDSA 384位
    "ecdsa-sha2-nistp256", // ECDSA 256位
    "rsa-sha2-512", // RSA SHA2-512
    "rsa-sha2-256", // RSA SHA2-256
    "ssh-rsa", // 传统RSA（向后兼容）
    "ssh-dss", // DSS（向后兼容）
  ],
  kex: [
    "curve25519-sha256", // 现代密钥交换
    "curve25519-sha256@libssh.org", // libssh变体
    "ecdh-sha2-nistp521", // ECDH P-521
    "ecdh-sha2-nistp384", // ECDH P-384
    "ecdh-sha2-nistp256", // ECDH P-256
    "diffie-hellman-group16-sha512", // DH group 16
    "diffie-hellman-group14-sha256", // DH group 14 SHA256
    "diffie-hellman-group14-sha1", // DH group 14 SHA1（向后兼容）
    "diffie-hellman-group-exchange-sha256",
  ],
  cipher: [
    "chacha20-poly1305@openssh.com", // ChaCha20加密
    "aes256-gcm@openssh.com", // AES 256 GCM
    "aes128-gcm@openssh.com", // AES 128 GCM
    "aes256-ctr", // AES 256 CTR
    "aes192-ctr", // AES 192 CTR
    "aes128-ctr", // AES 128 CTR
    "aes256-gcm", // AES 256 GCM（标准）
    "aes128-gcm", // AES 128 GCM（标准）
  ],
  hmac: [
    "umac-128-etm@openssh.com", // UMAC 128 ETM
    "hmac-sha2-256-etm@openssh.com", // SHA2-256 ETM
    "hmac-sha2-512-etm@openssh.com", // SHA2-512 ETM
    "hmac-sha2-256", // SHA2-256
    "hmac-sha2-512", // SHA2-512
    "hmac-sha1", // SHA1（向后兼容）
  ],
};

/**
 * 获取优化的SSH算法配置
 * 根据连接类型和安全要求返回不同的算法配置
 */
function getSSHAlgorithms(options = {}) {
  const {
    securityLevel = "high", // 'high', 'medium', 'compatible'
    serverType = "modern", // 'modern', 'legacy'
  } = options;

  if (securityLevel === "compatible" || serverType === "legacy") {
    // 兼容模式：包含更多传统算法
    return {
      serverHostKey: SSH_ALGORITHMS.serverHostKey,
      kex: SSH_ALGORITHMS.kex,
      cipher: SSH_ALGORITHMS.cipher,
      hmac: SSH_ALGORITHMS.hmac,
    };
  }

  if (securityLevel === "high") {
    // 高安全模式：优先使用现代算法
    return {
      serverHostKey: SSH_ALGORITHMS.serverHostKey.slice(0, 6), // 排除最传统的算法
      kex: SSH_ALGORITHMS.kex.slice(0, 7),
      cipher: SSH_ALGORITHMS.cipher.slice(0, 6),
      hmac: SSH_ALGORITHMS.hmac.slice(0, 5),
    };
  }

  // 默认模式：平衡兼容性和安全性
  return SSH_ALGORITHMS;
}

/**
 * 获取基础SSH算法配置（用于保持向后兼容）
 */
function getBasicSSHAlgorithms() {
  return {
    serverHostKey: [
      "ssh-ed25519",
      "ecdsa-sha2-nistp256",
      "ecdsa-sha2-nistp384",
      "ecdsa-sha2-nistp521",
      "ssh-rsa",
      "ssh-dss",
    ],
    kex: [
      "curve25519-sha256", // Modern key exchange
      "curve25519-sha256@libssh.org", // libssh variant
      "ecdh-sha2-nistp256",
      "ecdh-sha2-nistp384",
      "ecdh-sha2-nistp521",
      "diffie-hellman-group16-sha512",
      "diffie-hellman-group14-sha256",
      "diffie-hellman-group14-sha1",
      "diffie-hellman-group-exchange-sha256",
      "diffie-hellman-group-exchange-sha1", // Fallback for older servers
      "diffie-hellman-group1-sha1", // Very old compatibility
    ],
    cipher: [
      "aes128-ctr",
      "aes192-ctr",
      "aes256-ctr",
      "aes128-gcm",
      "aes256-gcm",
      "aes128-cbc", // Fallback for older servers
      "aes192-cbc",
      "aes256-cbc",
      "3des-cbc", // Very old compatibility
    ],
    hmac: [
      "hmac-sha2-256",
      "hmac-sha2-512",
      "hmac-sha1",
      "hmac-sha1-96", // Additional fallback
      "hmac-md5", // Very old compatibility
    ],
  };
}

module.exports = {
  SSH_ALGORITHMS,
  getSSHAlgorithms,
  getBasicSSHAlgorithms,
};
